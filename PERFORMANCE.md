# PERFORMANCE & SLO

性能阈值、资源与配额预算、不可接受行为清单。

定位纪律：**这是单人单机自用应用，没有并发用户，没有 QPS 压力。** 真正的约束不是吞吐量，而是三样东西——**外部配额（会自动扣费）**、**模型成本（每次规划的钱）**、**交互不能卡死**。不要在这个项目上做无谓的性能优化；下面没写阈值的地方就是不需要管。

---

## 1. 交互延迟目标

| 操作 | 目标 | 上限 | 超限后的行为 |
| --- | --- | --- | --- |
| 应用冷启动到可交互 | < 2s | 4s | 超 4s 查是不是在启动时同步重建了会话 |
| 打开已有会话（有快照） | < 500ms | 1.5s | 检查快照是否生效 |
| 从 JSONL 全量重建（500 事件） | < 3s | 8s | 加快照频率 |
| IPC 读取快照 | < 100ms | 300ms | 见 §4 序列化 |
| 单次 SQLite 查询 | < 10ms | 50ms | 加索引 |
| 单次 MCP 工具调用 | < 3s | **15s 超时** | 重试 1 次后降级 |
| 单次模型调用 | < 20s | **60s 超时** | 抛 `MODEL_TIMEOUT` |
| 一个完整 Skill（含多次调用） | < 90s | 180s | 拆步骤，不要拉长超时 |
| 一次完整规划（端到端） | < 15 min | — | 含用户思考与确认时间，不是纯机器时间 |

**唯一的硬性 UI 规则**：任何超过 300ms 的操作必须有进度反馈，任何超过 3s 的操作必须可取消。规划过程动辄几十秒，没有取消按钮的话用户只能杀进程——而杀进程会留下孤儿 MCP 子进程。

模型调用的 60 秒上限对应**一次网络尝试**。超时、限流、额度不足或上游失败都不允许自动重试或切换渠道；只有模型返回内容不符合 Zod 契约时，才允许上层发起一次可见、可审计的 Schema 修复调用。

---

## 2. 主进程不许阻塞

better-sqlite3 是**同步 API**，跑在主进程。单条查询几毫秒无所谓，但下面几件事会把整个 UI 冻住（Electron 主进程阻塞 = 窗口无响应）：

- 全量重建时循环执行几百条 INSERT → **必须包在一个事务里**（`db.transaction(...)`），不然每条一次 fsync，几百条能跑十几秒。包事务后同样数据通常在百毫秒级。
- 大 JSON 的 `JSON.parse` / `stringify`（TravelState 可能几百 KB）→ 见 §4。
- 同步读整个 events.jsonl → 用流式按行读，不要 `readFileSync` 后 `split('\n')`。

**禁止在主进程做任何 CPU 密集计算。** 本项目实际上没有这类需求；如果你发现自己在写循环嵌套的路径优化算法，先回头确认那是不是 M1 范围。

---

## 3. 外部配额预算

这是本项目唯一会**真实花钱**的地方，也是唯一必须做硬熔断的地方。

### 高德（`PRD:OQ-022` 已核验）

| 桶 | 月配额 | 说明 |
| --- | --- | --- |
| 搜索类（三工具共享） | **5000 次/月** | 真正的瓶颈 |
| 天气 | 5000 次/月 | 用量很小 |
| 路径规划类 | 150000 次/月 | 实际用不完 |
| QPS | **3** | 本地令牌桶按 2 限 |

关键事实：**未实名认证时全部配额为 0**；**超额不拒绝服务而是自动扣费**。前者已前置到 `PRD:BUILD-D0`，后者靠熔断兜。

单次完整规划的搜索类预算：**目标 ≤ 20 次，硬红线 30 次**。按目标值算每月约 250 次规划，个人自用绰绰有余。超过 20 次说明代码在重复查同一个 POI——查缓存；超过 30 次按 §5 视为 bug。

节流三件套（`PRD:NFR-029` / `NFR-030`）：

1. **POI 缓存**：名称→坐标永不过期，跨会话跨项目复用。放独立的 `cache/poi.db`，删主库时不受影响。这一条能省掉绝大部分搜索调用。
2. **月度计数**：`quota_counters` 按自然月分桶。80% 横幅提示，**95% 硬熔断**。
3. **单令牌桶**：全局串行，QPS 2。

**`maps_search_detail` 不自动调用**（v1.1 已砍）。只在用户明确点开某个 POI 时才调。自动批量拉详情是烧配额最快的方式。

### 12306-mcp

免费无鉴权，无配额，但**无 SLA**（`PRD:OQ-021` 仍开放）。它靠正则匹配 12306 首页 HTML 建站点索引，会周期性失效。因此：

- 不要在启动时预热它。用到才连。
- Stage A 和多城市路线计划每次授权都只创建一个临时 Rail session：`connect/initialize` 的冷启动预算为 60 秒；`listTools` 与每个 `get-tickets` 仍各自 15 秒，冻结调用严格串行且不重试。多城市计划最多 24 次调用；不得把 15 秒工具预算传给 initialize，也不得逐项重复冷启动。
- 站点索引只在该临时 session 内复用；成功、失败或取消后立即关闭，不跨授权操作常驻。
- 它挂了是**预期情况**不是异常，降级路径（手工粘贴车次）必须真的能走通，D5 前要实测一次。

### RollingGo 酒店

Bearer 鉴权，配额未知。保守处理：单次会话对同一住宿段**至多 3 次查询**（初次 + 用户改条件 2 次）。用户继续改条件时提示"已查询 3 次，继续会消耗额度"。

### 模型成本

| 指标 | 目标 | 上限 |
| --- | --- | --- |
| 单次完整规划 | < ¥3 | ¥10 |
| 单次模型调用输入 token | < 20k | 50k |

超 50k 输入基本只有一个原因：**把整个 TravelState 或全部对话历史塞进提示词**。这同时也违反出站最小化（`PRD:outboundMinimizationRule`）。做法是按 Skill 需要显式挑字段，不要 `JSON.stringify(state)`。

成本按 `model_calls.provider + cost_currency` 聚合。`provider` 必须是实际渠道 `DEEPSEEK_OFFICIAL` 或 `SHUAI_API`，不能从模型名推断；角色费率由用户在 SETTINGS 明确录入，缺费率时标 `UNKNOWN`，不得伪造估算值。

### D5 局部重算

D5 当前本地骨架生成与局部调整是确定性计算，不调用 ProviderRuntime；因此夹具验收的 `model_calls.created_at > T0` 应为 0，天然低于 AC-M0-17 的上限 5。局部调整事件的 `changedDates` 只能包含目标日，SQLite 不得先删除整会话骨架再重写。若未来引入已批准的规划模型，仍须保持未受影响日期行逐字节不变，并把每次调用写入 `model_calls`。

云南 route-D5 不把整条路线压成一个大操作。每个 Rail leg 的授权计划最多 1 次 `get-tickets`；每个接驳计划最多包含必要 geocode miss 与两次 `maps_distance`，总调用上限 6；每个 stay segment 最多 1 次 geocode miss + 1 次 Hotel，计划上限 2。所有计划串行、retry=0、十分钟到期，并显示 exact call count；route skeleton prepare/patch、Rail/住宿选择与 final Gate 都是 externalCalls=0/modelCalls=0 的本地操作。总路线进度是这些最小单元的完成度，不允许用隐藏并发或自动重试缩短表面耗时。

### D6 确定性编译

D6 prepare/publish 默认只读取 TravelState 与已落盘 EvidenceClaim，`model_calls=0`、`externalCalls=0`。主时间轴按本地日期和绝对分钟稳定排序，BACKUP 不参与时长链；历史版本查看只拉所选版本且不写状态。legacy 四日 smoke 的 105 项历史证据保留；2026-08-31 的 unified 路径用同一纯本地编译器处理 10 日 route/node/segment/leg 项并纳入 191 项全量回归，不引入网络等待。该证据不代表真实 Map/餐厅延迟或配额已验收。

### D7 确定性收口

D7 task derive/update、GATE_C、ICS/Markdown 生成与 Inspector 查询均不调用 ProviderRuntime 或 ToolRegistry，因此 LOCAL 验收固定 `externalCalls=0`、`modelCalls=0`、`irreversibleActions=0`。unified 路径按已有 item 数量线性派生 route-scoped tasks/blockers/export，不为 route、node、segment 或 leg 启动并发查询。Inspector 单次查询 limit 限制为 1–500，按 session/time 使用既有索引读取；诊断导出只序列化该有界安全摘要。packaged smoke 使用唯一临时 userData 验证 legacy 启动、v1→v2 回填、GATE_C、重启恢复与零调用，不把安装器执行或真实来源延迟混入自动门禁。

成本实时显示在 Inspector（`push:cost-updated`）。自用场景下"这次跑了多少钱"会被反复看，不要做成需要点进去才看得到。

---

## 4. 数据规模与序列化

| 对象 | 预期规模 | 处理 |
| --- | --- | --- |
| 单会话事件数 | 200–800 | 每 200 条一次快照；重建 SLO 按上界 800 事件不超过 8s |
| TravelState JSON | 100–500 KB | 见下 |
| 单会话 EvidenceClaim | 100–400 条 | 有索引，无压力 |
| timeline_items | legacy 30–80 条/版本；云南 10 日试点按实际 item 有界 | 按日期/绝对分钟稳定排序；不按节点并发拉取 |
| events.jsonl 单文件 | < 10 MB | 无压力 |
| 日志文件 | < 5 MB/天，保留 14 天 | 超期删除 |

**TravelState 不要整块推给渲染进程。** 每次状态变化推全量会导致：主进程 stringify + IPC 结构化克隆 + 渲染进程 parse，几百 KB 反复来回。做法：

- `push:state-updated` 只推 `{ sessionId, changedPaths }`。
- 渲染进程按需调 `session:snapshot` 并**带 slice 参数**（`'timeline' | 'tasks' | 'evidence' | 'skeleton' | 'meta'`），只拉自己关心的那块。
- 一个通道带参数，不为每个切片开独立通道。各视图各拉各的切片，互不影响。

这条在数据量小的时候看不出差别，但 timeline 视图会随每次编辑高频刷新，是唯一容易做出卡顿感的地方。

---

## 5. 不可接受行为清单

出现下列任何一条，**视为 bug，必须修，不接受"能跑就行"**：

**正确性类**

- 主进程阻塞超过 1 秒导致窗口无响应。
- 从 JSONL 重建后状态与重建前不一致。这是事件溯源的根基，不一致即整个数据模型失效。
- 删掉 `.db` 后应用无法启动或数据丢失。
- 退出后 MCP 子进程仍存活（任务管理器里能看到残留的 node）。
- 任何 EvidenceClaim 落库时 `source_ref` 为空。

**安全类**（前三条属 `PRD:neverCut`，第四条属 `NFR-022` / `PRIVACY-001`，同样不许违反）

- API Key 出现在日志、JSONL、SQLite 明文列、导出包或 Inspector 的任何位置。
- 任何具备写能力的工具被成功注册进 ToolRegistry。
- 系统执行了不可逆的外部动作（见下条）。
- 同行人姓名/证件/联系方式出现在发往任何外部服务的请求体里。
- 系统执行了购买、支付、下单、占座、提交订单、正式预约、取消、改签、退款中的任何一项。

**成本类**

- 单次完整规划的高德搜索类调用超过 30 次。
- 单次完整规划的模型成本超过 ¥10。
- 配额熔断未生效导致实际扣费。
- 重建会话时触发了任何外部调用（reducer 必须是纯函数，见 DATA_MODEL §5）。

**体验类**

- 降级后静默使用模型知识填充数据，用户看不出这块是编的。
- 阻塞时只说"信息不足"而不说具体缺哪几条。
- 超过 3 秒的操作没有取消按钮。

---

## 6. 怎么测

不做压测，不搭监控。M0 阶段的验证手段就三样：

1. **Inspector 面板**。跑一次完整规划，看调用次数、成本、耗时。这是最主要的手段。
2. **一次性脚本**。重建一致性用脚本验：重建两次，比对 `travel_states.state_json` 是否逐字节相同。
3. **任务管理器**。退出应用后确认没有残留 node 进程。

D7 自动门先以 unpacked exe + 唯一临时 userData 跑完整 LOCAL 流程，验证 better-sqlite3 原生模块、事件恢复与零调用；这不等同于干净 Windows 机器上的 NSIS 安装。实际执行安装/卸载并测冷启动仍需单独批准或由用户手工验收。

---

## 7. D4 30 帖精确预算（PRD:FR-309）

该预算是 selected-route required node 的默认事实获取预算，不是可被 UI 悄悄替换的“增强模式”。每个节点独立 preview、独立批准、独立消费；Settings 登录不计入该预算，也不授权 execute。硬事实补证使用另一份独立标准/官方来源预算，不能并入或隐藏在本批次。

一次获批执行的硬预算为 `search_feeds=4`、`get_feed_detail=30`、`EXTRACTION=6`、`REVIEW=1`、`retry=0`。34 次 MCP 读取在一个临时 session 中严格串行，避免并发触发伴随服务限流；30 条正文各最多 4,000 字符，总详情正文最多 120,000 字符。模型每批固定五帖，避免一次 prompt 无界增长。

preview 的性能与成本目标是纯本地：externalCalls=0、modelCalls=0。execute 不设隐式超时重试、并发提速或 schema repair；单次耗时增长必须如实展示进度，不能通过缩减 15/15、跳过详情或省略 REVIEW 伪造更快完成。LOCAL 门禁始终要求 externalCalls=0、modelCalls=0、irreversibleActions=0。

`connect`、`listTools`、登录态与 `search_feeds` 业务可用性是四个独立信号；前三者成功不得推断搜索能在预算内完成。伴随服务的搜索由浏览器页面契约驱动，若首个搜索耗尽 60 秒调用预算，按 `MCP_TIMEOUT` 整体停止且 retry=0。不得用提高超时、静默删筛选、缩减样本或替换帖子掩盖上游不稳定；任何搜索能力探针本身也算真实调用，必须进入新的 preview/digest 和精确授权。
