# GLOSSARY

业务术语与领域概念的统一解释。目的只有一个：**并行开会话时不要各自发明一套叫法**。

术语的完整定义在 PRD 里，本文件给的是**一句话可判定的口径 + 对应的代码标识符 + 最容易搞混的那一对**。看到 `PRD:ID` 就去查 PRD，不要凭这里的一句话去实现细节逻辑。

---

## 1. 会话与包络

| 术语 | 代码标识 | 一句话口径 |
| --- | --- | --- |
| 会话 Session | `sessionId`, `ses_` 前缀 ULID | 一次完整的行前规划过程，从需求访谈到产出最终时间线。会话是**数据隔离单位**，不是"一次对话" |
| 包络 Envelope | `M0_ENVELOPE` | M0 保证质量的输入范围：单出发城市、单目的地、3–6 天、2–6 人、1 个住宿段（`PRD:M0-ENVELOPE`） |
| 拆会话 ENV-SPLIT | `linkedSessionGroup`, `splitIndex` | 输入超出包络时，把行程切成多个会话分别规划。**不是拒绝服务，也不是降质硬做**（`PRD:FR-107`） |
| 阶段 Stage | `STAGE_1`…`STAGE_5` | 规划流程的五个推进档位，每档需用户显式确认才能前进 |

**易混**：会话 ≠ 对话轮次。用户可以在同一会话里聊一百轮。
**易混**：拆会话产生的是**平行的多个 Session**，共享一个 `linkedSessionGroup`；M0 只做关联与并列查看，跨会话联合优化属 M1，不要顺手实现。

---

## 2. 证据体系

这是本项目最核心也最容易被简化掉的一块。**任何写进行程的事实性内容都必须挂 EvidenceClaim**（`PRD:EC-001`）。

| 术语 | 代码标识 | 一句话口径 |
| --- | --- | --- |
| 证据声明 EvidenceClaim | `EvidenceClaim`, `claimId` | 一条"谁在何时从哪里看到什么"的可追溯记录，14 个字段 |
| 内容身份 contentIdentity | `content_identity` | 这条信息**是谁说的**——官方、交易系统、独立用户、商业报价、疑似推广、未知 |
| 核验状态 verificationStatus | `verification_status` | 这条信息**可信到什么程度**——已核实、已互证、估算、未核验、冲突、过期、用户确认 |
| 来源 Source | `sourceId`, `SRC_*` | 一个外部数据通道（铁路 / 酒店 / 地图 / 搜索 / 小红书 UGC / 用户粘贴） |
| 溯源引用 sourceRef | `source_ref` | 具体到哪一次调用或哪一个 URL。**为空即视为模型臆测**（`PRD:hallucinationRule`） |
| 过期 STALE | `verificationStatus = 'STALE'` | 超过 `validUntil` 的 Claim。**转状态，不删行** |
| 冲突 CONFLICTED | `conflicts_with` | 两条 Claim 对同一 subject+predicate 给出不相容的值。系统**不自动裁决**，交用户 |

**易混：contentIdentity vs verificationStatus。** 前者是**出处属性**，后者是**可信度评价**。一条 `OFFICIAL` 的信息也可能是 `STALE`；一条 `INDEPENDENT_UGC` 也可能因为多源互证而 `CORROBORATED`。两个维度独立，不要合并成一个"可信度"字段——合并过一次就再也拆不回来了。

**易混：VERIFIED vs VERIFIED_BY_USER。** 前者是系统从权威来源核实的，后者是用户自己说"我确认过了"。二者在 Gate 判定里权重不同，不要归一。

**易混：ESTIMATED vs UNVERIFIED。** `ESTIMATED` 是系统主动算出来的（比如按距离估的通勤时间），有方法可解释；`UNVERIFIED` 是拿到了但没核过。前者可以进行程并标注，后者不能支撑 GATE_C。

**易混：小红书查询方向 vs 内容结论。** `POSITIVE_LOCATION` 表示用地点词搜索，`NEGATIVE_AVOIDANCE` 表示用“避雷 + 地点”搜索；两者都是 provenance，不是情感分类。`SRC_XHS` Claim 默认 `INDEPENDENT_UGC + UNVERIFIED`，不能因为来自“正向”查询就算推荐，也不能因为来自“避雷”查询就自动排除。

**易混：Travel Agent 验证 XHS 路线事实 vs VERIFIED 硬事实。** selected-route 节点默认由 Travel Agent 使用 XHS_STRICT 采集、校验、抽取与复核；这能验证来源身份、时效、结构与跨帖一致性，并把路线体验信号标为 `UNVERIFIED` 或 `CORROBORATED`。它不等于把开放时间、闭园或预约要求标为 `VERIFIED`；这些硬事实必须有独立 allowlisted 标准/官方来源，或明确的 `VERIFIED_BY_USER` 降级证据。

---

## 3. 行程结构

| 中文 | 代码 / 英文 | 本项目里的精确定义 |
| --- | --- | --- |
| 路线精排 | Route Refinement / SKILL-09 | 把 D5 半日骨架细化为有序项目，并只用 Claim-backed ETA 计算到达交通与显式缓冲的确定性步骤 |
| 发布核验门禁 | Verification Gate | publish 前在主进程重跑的硬校验；时间冲突、缓冲、每日 BACKUP、orphan claim 或未验证 HARD_LOCKED 任一存在都阻塞 |
| 孤立事实 | orphan claim | 时间、价格或政策等具体事实没有可定位 EvidenceClaim；不得通过 UI 隐藏或由模型常识补齐 |
| 显式缓冲 | bufferMinutes | 交通 ETA 之外单独可见的预留分钟；普通段至少 10，前往机场或车站至少 30 |
| 跨午夜 | crossesMidnight | endTime 的钟点早于 startTime 且显式标记为次日结束；冲突比较时 end 加 1440 分钟 |


| 术语 | 代码标识 | 一句话口径 |
| --- | --- | --- |
| 日骨架 DaySkeleton | `day_skeletons` | 某一天的粗粒度安排：日型、强度、上午/下午/晚上三段、用餐锚点。**先定骨架再填细节** |
| 日型 dayType | `day_type` | 抵达日 / 常规日 / 返程日 / 换酒店日 / 城际转移日。日型决定可用时长与强度上限 |
| 住宿段 StaySegment | `stay_segments` | 连续住同一家酒店的一段。M0 只允许 1 段 |
| 时间线 FinalTimeline | `timeline_items` | 带具体时刻的最终行程。是**产出物**，不是规划中间态 |
| 时间线版本 | `timeline_versions`, `is_current` | 每次发布产生一个新版本，旧版本保留可对比。任一时刻至多一个 current |
| 缓冲 buffer | `buffer_minutes` | 项目之间显式预留的机动时间。**必须可见**，不允许隐式吸收进时长里 |

### itemClass —— 这个项目**是什么性质**

| 值 | 口径 |
| --- | --- |
| `FIXED` | 时间不可动（航班、演出场次、预约时段） |
| `RECOMMENDED` | 系统推荐、用户已接受，可调 |
| `FLEXIBLE` | 时间弹性大，用来吸收延误 |
| `OPTIONAL` | 有余力才做，删掉不影响行程成立 |
| `BACKUP` | 备选，主项目失败时顶上，正常不出现在主视图 |

### anchorClass —— 这个项目**能不能被重排算法动**

| 值 | 口径 |
| --- | --- |
| `HARD_LOCKED` | 绝对不可动，动了行程就废（已出票的火车） |
| `CONFIRMED_EXTERNAL` | 外部已确认（酒店已订），动需用户重新处理外部事务 |
| `MUST` | 用户明确要求必须有 |
| `PREFERRED` | 用户倾向有 |
| `FLEXIBLE` | 随便动 |

**易混：itemClass vs anchorClass。** 一个说性质，一个说可动性，**两者不是同一个维度也不能互相推导**。反例：一个 `RECOMMENDED` 的餐厅可能是 `CONFIRMED_EXTERNAL`（已经订了位）；一个 `FIXED` 时间的免费展览可能是 `FLEXIBLE`（不去也无所谓）。写重排逻辑时只看 anchorClass，写展示逻辑时只看 itemClass。

---

## 4. 任务与就绪

| 术语 | 代码标识 | 一句话口径 |
| --- | --- | --- |
| 准备任务 PreparationTask | `tasks.kind = 'PREPARATION'` | 行前要做的事（带儿童药、打印证件复印件） |
| 预订任务 ReservationTicketTask | `tasks.kind = 'RESERVATION_TICKET'` | 需要用户**自己去外部平台完成**的订票订房动作。系统只生成待办与交接信息，永不代办 |
| 交接信息 handover | `handover_json` | 给用户去外部平台执行的最小安全说明：做什么、已核验渠道、所需信息类别、注意事项、截止与核验清单；不保存证件号、订单号、票号或页面正文 |
| 就绪闸门 Readiness Gate | `GATE_A` / `GATE_B` / `GATE_C` | 阶段推进前的检查点。**M0 只实现 GATE_C** |
| 阻塞 BLOCKED | `readiness = 'BLOCKED'` | 缺关键信息或证据不足，不允许推进。必须给出**具体缺什么**，不能只说"信息不足" |
| GATE_C 报告 | `GateCReport`, `latestGateC` | 用户显式执行的出发前检查快照；blockers 为空才 `ready=true`，不自动刷新天气/闭园或推进阶段 |

**七轴任务状态**：`userDecision`、`reservation`、`readiness`、`payment`、`document`、`refund`、`reminder`。**M0 只实现前三轴**，后四轴字段存在但恒为 `'NA'`（`PRD:tierRule`）。不要因为"字段都在了"就顺手实现——那是 M1/M2。

**易混：ReservationTicketTask 不代表系统会去预订。** 系统永不执行购买、支付、下单、占座、提交订单、正式预约、取消、改签、退款（`PRD:neverCut`）。这条是硬红线，看到任何"帮我订"的实现思路直接拒绝。

**易混：确认外部结果 ≠ 修改原时间线。** 用户确认已购票/已预约时生成 vN+1，仅把关联项的 `anchorClass` 改为 `CONFIRMED_EXTERNAL`；`itemClass`、时间、地点与旧版本都保持不变。

---

## 5. 工具与权限

| 术语 | 代码标识 | 一句话口径 |
| --- | --- | --- |
| 数据源 SourceAdapter | `McpSourceAdapter` | 对一个 MCP Server 的封装：连接、鉴权、超时、重试、schema 校验、降级 |
| 工具白名单 MCP-ALLOWLIST | `mcp/allowlist.ts` | 每个 source 允许注册的工具名硬清单。**取交集，不是取补集** |
| 权限档 | `AUTO_READ` / `SESSION_APPROVAL` / `HARD_CONFIRM` | 工具调用需要的用户介入程度 |
| 降级 DEGRADED | `source_health.status` | 某个 source 连不上或返回结构漂移。**降级必须对用户可见**，不能静默用兜底数据冒充 |
| 结构漂移 | schema parse 失败 | MCP 返回值与 schema 对不上。触发 source 降级，**不是**记个 warn 继续 |
| FlyAI LOCAL 基础 | `FLYAI`, `flyai-cli-stderr-classifier/v2`, `flyai-utility-process-launcher/v1`, `flyai-flight-gate/v4` | 已完成 exact CLI 依赖、加密凭据、Main-only UtilityProcess、稳定 device-id、无值失败分类与 argv launcher；Gate v4 已完成一次结构级执行并消费，但生产航班接入仍关闭 |
| FlyAI 真实结构级证据 | `LIVE_STRUCTURE_ONLY` | exact-approved Gate 只证明真实返回的 path/type/arrayLength；不保留业务值，也不证明字段语义、价格、库存、航班事实或生产可用性 |
| FlyAI 本地结构合同 | `flyai-search-flight-result/local-structure-v1`, `LOCAL_STRUCTURE_ONLY` | 只按 Gate v4 摘要校验已观测键/类型并保留 `*Raw`；未证明的时间、金额、币种、中转等语义固定为 `null`，且当前不接真实 runner 或 UI |
| VariFlight 历史诊断 | `gate-r1/r2/r3` artifacts | 旧 SSE 上已消费的 descriptor/structure/format-consistency 证据；不可重放、不可迁移到 FlyAI，业务值语义仍 `UNPROVEN` |
| Provider 内部调用未知 | `internalProviderRequestCount = 'UNKNOWN'`, `internalProviderRetryCount = 'UNKNOWN'` | FlyAI Gate 只能审计一次 CLI 进程，CLI 内部发出多少请求或重试不可观测，禁止猜测为 0 或 1 |

**易混：白名单是"允许清单"不是"禁止清单"。** 实现方式必须是"只有在清单里的工具才注册"，而不是"扫描到危险词才拒绝"。关键词扫描是**第二道**防线，不是第一道。RollingGo 在 OAuth 模式下会暴露下单/支付/盯价工具，靠关键词兜不住。

**易混：唤端类工具按非只读处理。** 高德的"生成专属地图""导航到目的地""打车"三项虽然不花钱，但会把用户推出应用去执行动作，一律拒绝注册。

**易混：LOCAL 可执行基础 ≠ LIVE Provider 能力；LIVE_STRUCTURE_ONLY ≠ 航班事实。** FlyAI 的 fake executor、classifier v2、argv launcher、Gate v4 合同与打包路径只证明本地护栏。2026-09-03 的 Gate v4 成功只额外证明真实 JSON 结构可被去值摘要接纳；它不证明任何标量值或业务语义，更不开放生产 `SRC_FLIGHT`。`HTTP_451_RISK_CONTROL` 也只代表匹配该状态形态，不证明服务器实际判因；人工 `VERIFIED_BY_USER` 仍与系统 `VERIFIED` 分开。

---

## 6. 模型与 Skill

| 术语 | 代码标识 | 一句话口径 |
| --- | --- | --- |
| Skill | `skills/sNN-*.ts` | 一段有明确输入输出契约的规划能力，对应 PRD 里一个编号 |
| 模型角色 role | `EXTRACTION` / `PLANNING` / `REVIEW` / `VISION` | 按任务类型分派模型，与具体 provider 解耦 |
| 模型渠道 channel | `DEEPSEEK_OFFICIAL` / `SHUAI_API` | 每个角色显式选择的调用通道；不从模型名推断 |
| 轻量模型网关 | `main/model-gateway.ts` | 仅在 Electron 主进程内做固定路径、最小请求、响应归一化和安全错误分类；无服务端、无 fallback、无网络重试 |
| ProviderRuntime | ctx key `provider` | 模型调用的统一出口，负责显式路由、超时、计费与逐次审计 |
| Schema 修复调用 | `PRD:schemaRepairRule` | 模型输出校验失败时显式再调用**一次**并独立审计；再失败标 BLOCKED。它不是网关网络重试 |
| 决策记录 DecisionLog | `decision_logs` | 一次用户选择的记录，**必须同时记下被放弃的方案与理由** |

**易混：DecisionLog 不是操作日志。** 它只记**用户做出选择**的时刻，且必须含 `rejected`。只记选中项的实现是错的——"当时为什么没选那个"是这个产品的核心价值之一。

---

## 7. 中英对照速查

写代码用英文标识符，写 UI 文案和提示词用下列中文，不要在两侧各造一套。

| 中文 | 标识符 |
| --- | --- |
| 会话 | session |
| 包络 / 超包络 | envelope / out-of-envelope |
| 证据 / 证据声明 | evidence / EvidenceClaim |
| 核验 / 已核实 / 已互证 | verify / VERIFIED / CORROBORATED |
| 估算 / 未核验 / 过期 / 冲突 | ESTIMATED / UNVERIFIED / STALE / CONFLICTED |
| 内容身份 | contentIdentity |
| 日骨架 | DaySkeleton |
| 住宿段 | StaySegment |
| 时间线 | timeline |
| 缓冲 | buffer |
| 锚定 | anchor |
| 就绪闸门 | Readiness Gate |
| 准备任务 / 预订任务 | PreparationTask / ReservationTicketTask |
| 交接信息 | handover |
| 数据源 / 降级 | source / degraded |
| 白名单 | allowlist |
| 阻塞 | blocked |

---

## 8. 标识符写法：连字符 vs 下划线

**PRD 的 id 用连字符，代码与数据库的值用下划线。** 两套写法都对，指的是同一个东西，不要互相"纠正"。

| PRD id（连字符） | 代码 / DB 值（下划线） |
| --- | --- |
| `SRC-RAIL` `SRC-HOTEL` `SRC-FLIGHT` `SRC-MAP` `SRC-SEARCH` `SRC-XHS` | `SRC_RAIL` `SRC_HOTEL` `SRC_FLIGHT` `SRC_MAP` `SRC_SEARCH` `SRC_XHS` |
| `STAGE-1` … `STAGE-5` | `STAGE_1` … `STAGE_5` |
| `M0-ENVELOPE` | `M0_ENVELOPE` |
| `AC-M0-08`、`FR-501`、`NFR-029` | （仅作引用，不进代码） |

Cordis 事件与 eventType 是第三套：`域/动作`，斜杠 + kebab。IPC 是第四套：`域:动作`。四套不要混。

---

## 9. 禁止使用的词

这些词在代码、注释、UI 文案、提示词里一律不出现，因为它们会把产品定位往红线外带：

- **预订 / 下单 / 支付 / 购买 / 出票**（描述系统行为时）→ 一律改为"生成预订待办""提供交接信息"。描述**用户自己**的动作时可以用。
- **盯价 / 监控 / 自动刷新**（描述系统行为时）→ M0 不做持续监控，用 `recheckAt` 提醒用户自己复查。
- **保证 / 确保 / 一定**（描述外部数据时）→ 外部数据永远只有 EvidenceClaim 那几档状态，没有"保证"。
- **智能推荐**（无证据支撑时）→ 没有 sourceRef 的内容不许叫推荐。
