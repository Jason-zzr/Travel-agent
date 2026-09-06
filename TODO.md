# TODO — 验收步骤与下一步

**职责**：可执行的验收检查步骤（§4）与每天收工清单（§5）。当前状态、完成声明与阻塞见 `PROGRESS.xml`；版本历史见 `CHANGELOG.xml`；路线与砍量见 `ROADMAP.xml`。

最后更新：2026-09-05

---

## 1. 文档地图

| 文件 | 管什么 | 什么时候读 |
| --- | --- | --- |
| `PROGRESS.xml` | **当前状态、完成声明、阻塞、交接证据** | 新开会话第一件事 |
| `ROADMAP.xml` | 分层、发布、砍量顺序、绝不可砍 | 范围决策时 |
| `CHANGELOG.xml` | 版本历史摘要 | 追溯某版决定了什么时 |
| `intelligent-travel-agent-prd-v1.1.xml` | **要做什么**。需求、tier、验收、七日计划。**唯一需求权威源** | 开工前必读 `cordisContract` / `mcpDataLayer` / `NFR-031` 三节 |
| `ARCHITECTURE.md` | 怎么落地。目录、命名、Cordis 装配、IPC、安全实现 | 所有人，全文必读 |
| `DATA_MODEL.md` | 建表 SQL、JSONL 格式、关键约束 | 碰数据、碰事件、碰 schema 时 |
| `GLOSSARY.md` | 术语口径与易混对照 | 写提示词、写 UI 文案、命名时 |
| `ERROR_HANDLING.md` | 错误码、降级、日志、脱敏、Inspector 埋点 | 写任何会失败的代码时 |
| `PERFORMANCE.md` | 延迟目标、配额预算、不可接受行为 | 碰外部调用、碰性能时 |
| `MIGRATION.md` | 迁移机制、事件演进、依赖升级陷阱 | 改 schema、升依赖时 |
| `COLLABORATION.md` | lane 分派、接口冻结、交接格式、完成标准 | 开并行会话前 |

**分工纪律**：PRD 定义需求语义，八份文档定义实施形态。冲突时需求以 PRD 为准，实施以文档为准。文档**不复述** PRD 已有内容，只用 `PRD:ID` 指过去。

---

## 2. 下一步

父任务 **云南多城市路线推荐** 的 LOCAL 子交付、FlyAI Phase C、独立 D7 package verifier 修复与 bundled XHS MCP sidecar 均已完成 LOCAL 实现；用户已选择 `route_4d9299ab9458e5c2246e4329`，真实 session 停在 STAGE_3。v1.1.59 起，required node 的默认事实获取改为 Travel Agent 使用 XHS_STRICT，用户逐节点批准一次性计划并从带来源、时效、状态与不确定性的结果中选择。既有大理/洱海人工事实仍是 `VERIFIED_BY_USER`，不得改称 MCP 已验证；后续节点需要新 preview/digest。开放时间、闭园与预约等硬事实还需独立 allowlisted 标准/官方来源，否则保持 UNKNOWN/BLOCKED；人工研究仅在自动路径失败或不足后由用户显式选择。

> 当前自动测试为 316/316，format、lint、双端 typecheck、Electron default/no-gpu smoke、`build:win` 与 D7 package verifier 均通过；两种 smoke 均保持 `electronSandbox=true`、`rendererConsoleErrors=0`、`externalCalls=0`。当前 installer 为 109714739 bytes、SHA-256 `a58f2309d2a0f99588ab80d6de0142062fe7f87ba3ee5072e7115f51bcaa189c`、`NotSigned`、未执行。本轮没有启动真实 XHS binary、下载 Chromium、扫码、内容查询或模型调用，不能冒充 LIVE 验收。

#### Route-node XHS 主路径门禁

- **构造**：读取 selected route 的 `nextRequiredNodeId`，为精确 `sessionId + routeId + nodeId` 生成 XHS_STRICT 零调用 preview；冻结 `search_feeds×4 + get_feed_detail×30`、`EXTRACTION×6 + REVIEW×1`、串行、60 秒、`retry=0`、provider routes、planId、digest 与 TTL。Settings 登录单独处理，不计为研究批准。
- **期望**：获该节点精确批准后才执行一次。Travel Agent 完成采集、schema 校验、抽取、复核与候选投影；UI 展示 canonical source、freshness、UGC identity、UNVERIFIED/CORROBORATED、推荐/避雷、体力适配和不确定性，用户只选择或裁决。XHS-only 的开放/闭园/预约保持 UNKNOWN/BLOCKED；独立补证需另一份 Gate。失败不重试、不自动转人工。
- **在哪看**：`src/shared/schema/d4.ts`、`src/main/plugins/coordinator.ts`、`src/main/plugins/tool-registry.ts`、`src/preload/index.ts`、`src/renderer/src/ipc.ts`、`.trellis/spec/backend/d4-evidence-contracts.md` 与 `.trellis/spec/frontend/multi-city-route-contracts.md`。本次只改变控制契约，尚未生成或消费新的节点 Gate。

#### Bundled XHS MCP sidecar 门禁（LOCAL）

- **构造**：开发态与 packaged 路径分别解析固定资源；对 binary/manifest/license 检查普通文件、realpath containment、版本、commit、大小和 SHA-256。用 fake process/session 构造零点击、并发 lease、Main-only auth/env、二维码/已登录两种响应及取消/退出。
- **期望**：应用启动和 Settings 初始渲染 spawn/download/call 均为 0；只有显式登录或精确批准研究才启动固定 `127.0.0.1:18061` sidecar。端口占用或 artifact drift 在 spawn 前 fail closed；Renderer 不见 endpoint/token/cookies/path。安装包恰含三项 XHS resource；最后 lease、取消、过期、成功、失败和退出都回收进程树。
- **在哪看**：`src/main/mcp/xhs-sidecar.ts`、`src/main/mcp/xhs-sidecar.test.ts`、`src/shared/schema/mcp/xiaohongshu.ts`、`src/renderer/src/SettingsView.tsx`、`electron-builder.yml` 与 `test/verify-package.mjs`。真实二维码/登录、Chromium 下载及 XHS 内容查询仍需用户操作或新的精确授权。

`BLK-NEXT017-02` 的产品能力缺口和 XHS 响应兼容缺口均已完成 LOCAL 修复，但第四次 LIVE 尝试证明首个 XHS 搜索仍可能在 60 秒预算内超时。代码与审计把失败定位到 `session.callTool('search_feeds', ..., 60_000)`；伴随容器无 OOM/重启/crash，官方源码与同型 issue 指向搜索页等待及筛选 DOM 契约。连接、工具发现、登录和搜索能力必须分开判断。直接事件注入、盲目加时、删筛选、缩样本、隐式探针或重试仍禁止。

D7 的后端与前端契约已同步到 `.trellis/spec/backend/d7-task-gate-export-contracts.md` 与 `.trellis/spec/frontend/d7-task-inspector-contracts.md`；真实验收前不得把 LOCAL 门禁表述为 LIVE 完成。

#### 多城市 Rail 计划级单会话补充门禁（LOCAL）

- **构造**：先验证路线 preview 保持零调用、19 项冻结顺序与 digest 不变，再用受控 fake Rail session 执行完整 19 项批次；另造 connect/list 失败、首项 schema drift、来源降级与取消。
- **期望**：每个已消费计划只创建一个临时 session；`connect=60_000` 一次、`listTools=15_000` 一次、19 个 `callTool=15_000` 严格串行、retry=0、close 一次。每个实际调用写一条审计并推进一次 settled progress；setup 失败 call/audit 为 0，drift/degraded/cancel 后不再发出外部调用，剩余项仅生成本地有界结果。
- **在哪看**：`src/main/plugins/tool-registry.ts`、`src/main/plugins/coordinator.ts`、`src/main/d5.test.ts`、`src/main/itinerary-route.test.ts` 与 `.trellis/spec/backend/multi-city-route-contracts.md`。真实 Rail 必须另行生成新 preview/digest 并精确批准，已消费摘要不得重试。
- **最新 LIVE**：2026-09-01 修复后 19 项计划实际审计 12 次，9 成功、3 `MCP_TOOL_ERROR`，剩余 7 项未再外发；证明单 session 与 Error 文本兼容均生效。该摘要已消费，不得重试。

#### Rail Error 文本信封兼容（LOCAL）

- **构造**：向正式 `SRC_RAIL/get-tickets(format=json)` result contract 分别输入固定包风格 `Error:` text、显式 `isError:true`、合法 tickets JSON、非法/字段不兼容 JSON、空/non-text content 与 structuredContent-only。
- **期望**：仅 Rail 的 `Error:` 文本与显式错误进入 `MCP_TOOL_ERROR`，业务正文不解析、不记录；合法 JSON 通过，其余未知结构继续 `SOURCE_DRIFT`。Map/Hotel/Search/XHS、timeout、retry、IPC、事件和路线比较不变。
- **在哪看**：`src/shared/schema/mcp/rail.ts`、`src/main/mcp/source-catalog.ts`、`src/main/rail-response-envelope.test.ts` 与 `.trellis/spec/backend/multi-city-route-contracts.md`。LOCAL 207/207 和两种零调用 smoke 不替代新 Gate R 的 LIVE 复验。

#### 固定目的地 STAGE-2→STAGE-3 显式确认（LOCAL）

- **构造**：STAGE-2 basics 中恰好一个固定城市；分别提交匹配城市、错城市、额外字段、非当前窗口与不可见 session。
- **期望**：仅匹配请求追加一条 `stage/confirmed` 并进入 STAGE-3，`confirmation.kind='FIXED_DESTINATION'`；候选为空且 selectedCandidateId 为 null。其余请求返回 `INPUT_INVALID`/`IPC_FORBIDDEN`，事件数不变且错误不泄露内部消息。
- **在哪看**：`src/main/d4.test.ts`、`src/main/ipc/fixed-destination.test.ts`、`test/renderer/d4-ui-render.test.ts` 与 `test/electron/d4-ui-smoke.mjs`。

---

## 3. 砍量参考

落后时按顺序整条砍，见 `ROADMAP.xml → descopeOrder`。`neverCut` 五项任何时候不许动。

---

## 4. 验收检查步骤

> 验收项本身以 `PRD:AC-M0-01` 至 `AC-M0-35` 为准，本节只写"怎么验"，不复述判据。
>
> 每条固定三行：**构造**（怎么造输入）/ **期望**（应该发生什么）/ **在哪看**（哪个视图、哪张表、哪条日志）。
> `★` 是 `neverCut` 五项（`NFR-019` / `EC-001` / `HK-001` / `NFR-017` / `M0-ENVELOPE`）的直接验证，任何时候不许跳过。`⚙` 表示已归属到 §4.0 的某个脚本。
> 标「**LANE-AC 判定线**」的地方是 PRD 没给数、由本 lane 定的阈值，要改只改那一处。

### 4.0 通用前置

**哨兵凭据。** 从 D0 起，所有 Key 一律先录入可全盘检索的哨兵串再换真值：高德 `sk-ACCEPT-AMAP-7f3a9c`、RollingGo `mcp_ACCEPT-RG-7f3a9c`。`AC-M0-03` / `AC-M0-32` 全靠它——真 Key 无法 grep 验证，不要等到 D7 才想起来。（前缀刻意不模仿真实 Key 格式，高德实际是 32 位十六进制；哨兵好找比像真更重要。）

**哨兵串不是有效凭据。** 用它验的是"凭据存取链路"，不是"外部源能连通"。任何期望里出现"仍可用"的地方都必须落到 `credentials.ts` 的返回值上，不能拿 `source_health` 当代理。

**两种"重启"要分开做。** 只重启进程验的是 SQLite 还在；**删掉 `travel-harness.db`、`-wal`、`-shm` 三个文件再启动**验的才是从 JSONL 重建。`AC-M0-01` 两种都要跑。

**时间轴类查询一律限定当前版本。** `timeline_items` 按 `(session_id, version)` 分属多个版本，`AC-M0-17` 的构造还会主动造出第二个版本。不 join `timeline_versions` 取 `is_current = 1` 就会把两版行混在一起排序，产生大量假阳性。`AC-M0-20/21/22/24` 全部适用。

**禁止用直写 SQLite 来构造夹具数据。** 违反 `ARCHITECTURE.md` §5 第一条禁令，且会被下次重建抹掉。所有构造一律走事件（`EventLogService.append`）。

**测试夹具目录。** `test/` 在仓库根，已录入 `ARCHITECTURE.md` §3 目录树。校验脚本**只读**：直连 SQLite 与 JSONL 做断言，不 import `src/` 下任何模块，所以不受接口冻结节奏约束。

**需要的夹具，D1 之后即可开始写：**

| 夹具 / 脚本 | 覆盖 | 要点 |
| --- | --- | --- |
| `test/fixtures/evil-mcp-server.mjs` | `AC-M0-08` | 最小 stdio MCP server，四个工具，见 `AC-M0-08` 构造 |
| `test/fixtures/drift-mcp-server.mjs` | `AC-M0-09` | 返回值比 `shared/schema/mcp/rail.ts` 少一个字段（删 `arrive_time`） |
| `test/verify-rebuild.mjs` | `AC-M0-01` | 比对两次 `travel_states.state_json` 的 SHA256 |
| `test/verify-timeline.mjs` | `AC-M0-20/21/24/28` | 时刻自洽、缓冲下限、每日 BACKUP、ICS 全量回比 |
| `test/verify-geo.mjs` | `AC-M0-16` | 读 `day_skeletons` 三段 JSON 算段内两两直线距离 |
| `test/verify-no-secrets.mjs` | `AC-M0-03/32` | 全盘检索哨兵串、`sk-`、`mcp_`、`Bearer `、密文前缀 |
| `test/verify-integrity.mjs` | `AC-M0-06/17/29/30` | 事件行数、model_calls 增量、白名单三查、`source_ref` 形态 |

---

### D1 内核（AC-M0-01 / 02 / 03 / 31）

#### AC-M0-01 ★ ⚙ 重启恢复

- **构造**：新建会话（这一步本身会写一条 `session/created`，`seq = 1`），再推进到 `STAGE_2` 并写 10 条事件：`basics/updated` ×3、`stage/confirmed` ×1、`evidence/added` ×5、`decision/logged` ×1。确认 `events.jsonl` 末行 `seq == 11`。任务管理器**强杀**主进程（不走 `before-quit`，否则测的是优雅退出）。
- **期望**：① 直接重启后 stage 与 `state_json` 与杀进程前逐字节相同，`sessions.last_seq == 11`；② **删掉 `.db` / `-wal` / `-shm` 后再启动，结果仍然逐字节相同**。
- **在哪看**：`test/verify-rebuild.mjs` 比对 SHA256。任一处不同即整个数据模型失效（`PERFORMANCE.md` §5 正确性类）。
- **D6 后补跑一次**：11 条事件触不到快照（阈值 200 条或每次 `timeline/published`），所以上面验的是纯全量重放。发布一次时间轴产生 `snapshot-*.json` 后再删库重建，才验得到"从快照起 + 增量重放"这条真正会出 bug 的路径。

#### AC-M0-02 插件独立性与回收

- **构造**：bootstrap 完成后打印八个 ctx key；对某个插件的 fork 调用 `.dispose()`。**再单独跑一次反例**：故意把某个 `ctx.set` 的 key 拼错重启。
- **期望**：八个 key 齐全；dispose 后该插件的事件监听不再触发，且每个资源都有关闭日志；反例场景必须抛 `INTERNAL_SERVICE_NOT_READY` **并打出缺失的名字**。
- **在哪看**：`scope=main.bootstrap` 的自检日志、dispose 日志。**同一处顺带断言 cordis 版本检查已生效**（`ERROR_HANDLING.md` §7：启动时断言版本号以 `3.` 开头）——那是 `ARCHITECTURE.md` §8 的头号升级陷阱，没有别的 AC 覆盖它。反例不跑等于没验自检。

#### AC-M0-03 ★ ⚙ 凭据不落明文

- **构造**：设置页录入哨兵串，重启，再读一次。
- **期望**：重启后 `credentials.get(sourceId)` 返回与录入时**逐字节相同**的串，且不抛 `CRED_UNAVAILABLE` / `CRED_DECRYPT_FAILED`；全盘检索哨兵串 **0 命中**。
- **在哪看**：`test/verify-no-secrets.mjs` 扫 `<userData>` 全目录。**必须包含 `travel-harness.db-wal`**——未 checkpoint 的页留在 WAL 里，只查 `.db` 会漏。同时查 `sessions/*/events.jsonl` 与 `logs/`。
- **不要**拿 `source_health='OK'` 当"凭据可用"的判据：哨兵串在真实源上必然鉴权失败，那样这条会因为与 AC 无关的原因挂掉。

#### AC-M0-31 凭据三态

- **构造**：三种分别跑——(a) mock `safeStorage.isEncryptionAvailable()` 返回 `false`；(b) mock `decryptString` 抛错；(c) 从未配置该源。
- **期望**：(a) 抛 `CRED_UNAVAILABLE` 且**不降级为明文存储**；(b) 抛 `CRED_DECRYPT_FAILED`，该条密文被清除，SETTINGS 显示"需重新录入"；(c) **不是错误**——状态为 `source_health.status='UNCONFIGURED'`，引导去设置页，只有在该源真被调用时才抛 `SOURCE_UNCONFIGURED`。三种场景下应用均不崩溃，且该 source 的对外请求数为 0。
- **在哪看**：SETTINGS 三态文案（不得回显任何字符，掩码前缀也不行）；`SELECT count(*) FROM tool_calls WHERE source_id=?` 应为 0。
- **已确认（2026-08-22）**：密文容器固定为 `<userData>/credentials.json`，格式 version 1，只含 safeStorage base64 密文并原子替换写入。测试既覆盖 mock `decryptString` 抛错，也可直接破坏该文件中的密文字段验证重录状态。

---

### D2 访谈与包络（AC-M0-04 / 05 / 06 / 33 / 34）

#### AC-M0-04 五轮内出确认卡

- **构造**：新会话输入原句「我们一家想五月去成都玩四天」，之后**只回答系统问到的**，不主动补充。
- **期望**：≤5 轮产出完整基础信息确认卡片，含出发城市、目的地、日期区间、人数与构成、预算档、强度偏好。
- **在哪看**：卡片 UI。轮次口径钉死为「一次用户发言 + 一次系统回复 = 一轮」，**计数取 UI 上的用户消息条数**。不要用 `model_calls` 的 `role='EXTRACTION'` 条数代替——一轮可以触发多次调用，`AC-M0-06` 的修复重试更是刻意产生两条，拿它计轮会误判。

#### AC-M0-05 ★ 超包络的最小拒绝

- **构造**：输入「想去成都和重庆两个城市」。
- **期望**：抛 `INPUT_OUT_OF_ENVELOPE`，说明当前版本只支持单目的地并给收窄选项。**关键反例：不许静默降级成只规划成都。**
- **在哪看**：就地表单提示 + 错误码。**本条与 `AC-M0-33` 相互独立，两条都要跑**：33 只要求出对比卡片且不推进，不要求走 `AppError` 路径；一个只渲染卡片的实现会让 33 过、05 挂。先跑 05 是因为它更快，能早暴露"静默降级"。

#### AC-M0-06 ⚙ 修复重试恰好一次

- **构造**：记下时刻 `T0`，在 `ProviderRuntime` 上加测试开关，强制 `s01` 连续两次返回 `{"garbage":1}`。
- **期望**：`SELECT count(*) FROM model_calls WHERE role='EXTRACTION' AND created_at > T0` **恰好为 2**（三条以上说明写成了循环）；第二次失败后抛 `MODEL_OUTPUT_INVALID` 并标 `BLOCKED`。
- **在哪看**：上述查询；**`events.jsonl` 行数在整个过程中不变**——"绝不写入状态"只能靠事件日志行数验，看 UI 看不出来。
- **注**：用时间窗而非"该步骤"筛选，是因为 `model_calls` 没有 `skill_id` 列。若主线后续加了这一列（需走 `MIGRATION.md`），这条可以收紧。

#### AC-M0-33 ★ 超包络对比卡片

- **构造**：输入明确超包络的行程（两个城市，或中途换酒店）。
- **期望**：① 指出**具体超出哪个维度**（不是笼统"超出范围"）；② 至少两个方案（`ENV-SPLIT` 拆会话 / 缩小到包络内）的对比卡片；③ 四个维度齐全：能拿到什么、拿不到什么、需手工承担什么、规划质量差异；④ 用户未选择前不推进。
- **在哪看**：卡片 UI；④ 的判据是 `events.jsonl` 无新增 `stage/confirmed`。

#### AC-M0-34 ★ 拆会话落库

- **构造**：在上述对比中选「拆会话」。
- **期望**：① 创建 N 个子会话，`linked_session_group` 相同，`split_index` 从 1 连续；② 每个子会话**单独**校验落在包络内；③ 可并列查看；④ `decision_logs` 一行且 `chosen_json` / `rejected_json` / `rationale` 均非空；⑤ **每个子会话的首日 / 末日 `day_skeletons` 上有衔接点标注**（`PRD:FR-107` 与 `ENV-SPLIT` 的 `userBurden`：不得让用户到最后才发现中间是断的）——这一环最容易漏实现。
- **在哪看**：`sessions` 表、`decision_logs` 表、`day_skeletons`、`envelope/decision` 事件。**反例：不要顺手做跨会话预算汇总或统一时间轴，那是 M1。**

---

### D3 数据源与白名单（AC-M0-07 / 08 / 09）

#### AC-M0-07 连通状态与降级

- **构造**：四源配齐，SETTINGS 点探针；禁用网卡后**再点两次**探针。
- **期望**：首次四源 `OK`；断网后变 `DEGRADED`，顶部横幅说明**具体缺什么能力**（例：「12306 数据源不可用，车次时刻需要你手工粘贴」），不是"服务异常"。
- **在哪看**：`source_health` 表 + Inspector 健康状态灯。**注意：连接类降级阈值是 `fail_streak >= 2`，一次探针只加 1，所以必须点两次才降级**（`ERROR_HANDLING.md` §3）。只点一次会误判成"降级没生效"。

#### AC-M0-08 ★ 写工具被拒注册

- **构造**：挂载 `test/fixtures/evil-mcp-server.mjs`，暴露**四个**工具，allowlist 里只放 `searchHotels` 与 `confirmBooking`：

  | 工具 | 在 allowlist | 预期 | 验的是哪道防线 |
  | --- | --- | --- | --- |
  | `createOrder` | 否 | 拒绝 | 第一道：白名单取交集 |
  | `payOrder` | 否 | 拒绝 | 第一道 |
  | `confirmBooking`（描述含"预订确认"） | **是** | **仍然拒绝** | 第二道：写语义关键词扫描 |
  | `searchHotels`（描述里含"预订"二字但只读） | 是 | **正常注册** | 关键词不误伤 |

- **期望**：三条工具被拒、一条注册成功，且三条被拒的 `reason` 区分得出是哪道防线拦的。`confirmBooking` 这一条是关键——它在 allowlist 里，只有关键词扫描能拦住它，对应 `PRD` 第 460 行「即使它出现在未来版本的 allowedTools 中也必须拒绝」。只放前两个工具的夹具**根本跑不到第二道防线**。
- **在哪看**：`SELECT tool_name, reason FROM blocked_tools WHERE source_id='evil-fixture' AND created_at >= T0` 应恰为 `{createOrder, payOrder, confirmBooking}` 三行；Inspector 白名单审计区块可见。**不要断言全表行数**——该表跨会话、不参与清空，跑第二遍就会翻倍。
- **`reason` 取值已定死**（`ARCHITECTURE.md` §7）：只取 `NOT_IN_ALLOWLIST` 与 `WRITE_KEYWORD_HIT` 两个常量，定义在 `shared/errors.ts`。断言要**逐条比对 reason**，不只是数行数——一个只做关键词扫描、没做白名单取交集的实现，会把三条全记成 `WRITE_KEYWORD_HIT`，行数却完全正确。

#### AC-M0-09 ★ 结构漂移单次降级

- **构造**：先用正常 rail server 写入若干条 `SRC_RAIL` 的 `evidence_claims`，再切到 `test/fixtures/drift-mcp-server.mjs` 调用一次。
- **期望**：① `source_health.status = 'DEGRADED'`；② **`fail_streak` 仍为 0**——这是判定"没把漂移混进超时计数器"的唯一硬证据，只看 status 变了不够；③ 不发生重试（`tool_calls` 只有 1 条）；④ 之后 5 分钟内该源调用快速失败，不发新请求；⑤ 不再新增来自该源的 `evidence_claims` 行；⑥ **降级前已写入的该源 Claim 仍在表里，且 `verification_status` 变为 `'STALE'`**（`PRD:MCP-HEALTH`：已获取的事实保留但降级；`DATA_MODEL.md` §4：过期是转状态不是删行）。
- **在哪看**：`source_health` 表（重点看 `fail_streak`）；日志中需**同时**出现 `code=SOURCE_DRIFT`（单次校验失败，`ctx.missing` 含 `arrive_time`）与 `code=SOURCE_ADAPTER_DEGRADED`（整体降级的状态变化记录）。两个码是不同的事，只验前者会漏掉"降级动作没真正发生"。

---

### D4 证据体系（AC-M0-10 / 11 / 12 / 13）

#### AC-M0-10 跨源去重

- **构造**：同一景点三种叫法（「武侯祠」/「成都武侯祠博物馆」/「武侯祠·锦里」）出现在三个独立来源引用中。
- **期望**：① 三条 Claim 都保留各自 `subject`、`source_id` 与 `source_ref`；② D4 `ResearchEntity` 投影归并为一个 `canonicalSubject`，其 `aliases` 覆盖三种叫法，`claimIds` 恰好引用三条 Claim。
- **在哪看**：`src/main/d4.test.ts` 的 AC-M0-10 夹具与 CHAT 的研究实体卡片。**反例：去重时改写或删掉任何原始 Claim 都算失败——去重的是派生实体，不是来源证据。**

#### AC-M0-11 推广内容标记

- **构造**：手工粘贴一段带推广特征的文案（含「福利」「下单立减」「专属优惠码」）。
- **期望**：`content_identity = 'SUSPECTED_PROMOTION'`；用它作为某个推荐的**唯一**支撑时应被拒绝或要求补第二来源。
- **在哪看**：`evidence_claims` 行；推荐生成路径的拒绝提示。

#### AC-M0-12 体力风险标注

- **构造**：成员设为 2 大 + 1 位 70 岁老人 + 1 小孩；候选中放一个需长时间爬坡的景点。
- **期望**：该项被标体力风险或排除，**理由文字明确指向成员构成**，不是泛泛的"可能较累"。
- **在哪看**：D4 CHAT 研究实体卡片中的成员适配状态与理由；D5 / D6 才把确认结果带入 SKELETON / TIMELINE。**不要去查 `decision_logs`**——体力风险是系统自动标注，没有用户选择，落 `decision_logs` 违反 `GLOSSARY.md` §6「DecisionLog 不是操作日志」。

#### AC-M0-13 冲突不自裁

- **构造**：两个来源对同一景点开放时间给不同值（09:00–17:00 与 08:30–18:00）。
- **期望**：两条 Claim 均 `verification_status='CONFLICTED'` 且 `conflicts_with` 互指；UI 同时展示两方来源；**系统不得自行择一，也不得取交集**。若该开放时间支撑 `MUST_GO` 硬锚点，推进以稳定错误码 `GATE_BLOCKED` 阻塞，并在原因中明确指出未解决的证据冲突；用户选择某一 Claim 或标记未知后才能继续。
- **在哪看**：`evidence_claims.conflicts_with`；证据视图。

#### D4-MANUAL-01 正式人工研究显式降级

- **构造**：先呈现自动来源失败或证据不足，并由用户显式选择人工降级；再在 STAGE-3 填写一个研究项及一个关联同 session `USER_PASTE` 的研究项。每项填写来源名称并逐项确认，安全 HTTPS URL 可选；MUST_GO 分别确认开放时间、闭园安排、预约要求和 `checkedAt`。
- **期望**：一次提交只追加一个 `research/checklist-prepared` V2 事件；产物为 `USER_RESEARCH / VERIFIED_BY_USER`，原 `USER_PASTE` 仍为 `UNVERIFIED`。非 HTTPS、userinfo、凭据型 query、跨 session Claim、未确认项、重复项或全 EXCLUDE 均零写失败；过期或非 KNOWN 硬锚点不解除 Gate；`externalCalls=0`、`modelCalls=0`。
- **在哪看**：`src/main/d4-manual-research.test.ts`、`src/main/ipc/manual-research.test.ts`、`test/renderer/d4-ui-render.test.ts` 与 `test/electron/d4-ui-smoke.mjs`。UI 必须写“用户核验”，不得写成独立来源佐证；未提交草稿不得进入 JSONL/SQLite。

#### D4-XHS-01 固定样本与完整详情

- **构造**：四条固定 query 返回含跨查询/跨组重复的服务端有序行。
- **期望**：全局首次出现优先，推荐/避雷各恰好 15；不足在详情前整批失败。成功时严格串行 `search_feeds×4 + get_feed_detail×30`，所有详情 `load_all_comments=false`，无补位或重试。

#### D4-XHS-01A 响应包装兼容与失败边界

- **构造**：分别注入旧搜索数组、官方 `{feeds,count}`、旧详情对象、官方 `{feed_id,data}`，以及 count 不匹配、空/非 JSON、未知 wrapper、`structuredContent`、外层/内层/请求 ID 冲突。
- **期望**：四种已知格式归一为同一 canonical 结构；未知或冲突格式统一以 `SOURCE_DRIFT` fail-closed。首个 search 失败严格为 `1 search + 0 detail + 0 model + 0 Claim`；首个 detail 失败严格为 `4 search + 1 detail + 0 model + 0 Claim`，不重试、不替换、不写 final projection。错误、工具审计和结果序列化均不得出现 `xsecToken`、评论、raw payload 或凭据。
- **在哪看**：`src/shared/schema/mcp/xiaohongshu.ts`、`src/main/mcp/source-catalog.ts`、`src/main/d4-xhs-ranking.test.ts`、`src/main/d4.test.ts` 与 `.trellis/tasks/archive/2026-08/08-30-xhs-mcp-response-shape-compat/research/local-validation.md`。

#### D4-XHS-01B 零调用结构诊断

- **构造**：向既有 ToolRegistry 单 session 的 `search_feeds` / `get_feed_detail` 注入未知 wrapper、非 JSON、缺 text、循环、异常键和超限结构；标量中放入 token/comment/credential/raw sentinel。
- **期望**：仍以 `SOURCE_DRIFT` 立即降级且零重试；日志保留 `missing` 并只在 `keys` 写入最多 2,048 字符的节点类型/受限键路径，sentinel 命中为 0。成功路径、其他来源、ToolCallAudit、SQLite、JSONL、IPC、Inspector、导出与事件/状态均不增加诊断数据。
- **在哪看**：`src/main/mcp/xhs-structural-fingerprint.ts`、`src/main/plugins/tool-registry.ts`、`src/main/mcp/source-health.ts`、`src/main/d4-xhs-ranking.test.ts` 与 `src/main/d4.test.ts`。

#### D4-XHS-02 严格模型批次

- **构造**：30 条来源 Claim，分别注入批次遗漏、未知 Claim、跨目的地与非法 REVIEW ID。
- **期望**：仅成功路径执行 `EXTRACTION×6 + REVIEW×1`，每次 `repairInvalid=false`；任一失败不写 final Claim、ranking 或 checklist。

#### D4-XHS-03 排序与排除门

- **期望**：`score=3R−4A+fit`，FIT=+2、UNKNOWN=0、RISK=-3；MIXED 双向计数。避雷证据保留且只扣分；仅 EXCLUDE、身份歧义、纯推广与非 ATTRACTION 不入榜，tie-break 稳定。

#### D4-XHS-04 preview、IPC 与原子回放

- **期望**：preview 不写事件且来源/模型调用均为 0，返回当前 provider/model、四 query、4+30、6+1 与 digest；execute 只接收 sessionId/planId/digest/operationId。final Claims、summary、rankings 与 checklist 以一个事件追加并可从 JSONL 恢复。

#### D4-XHS-05 UI 与秘密残留

- **期望**：CHAT 显示调用摘要、digest、UGC 未核验、公式拆解、family fit、避雷原因与原帖；不得出现 `xsec_token`、评论、raw response、Authorization 或 prompt 原文。

---

### D5 交通、骨架与住宿（AC-M0-14 ~ 19 / 35）

#### VariFlight Phase A 补充门禁（LOCAL）

> Historical / non-production：以下 R-1/R-2/R-3 仅记录旧 VariFlight SSE 的已消费诊断，不是当前 FlyAI 合同、授权或值语义。

- **范围**：`SRC_FLIGHT` 只属于 `M0-YUNNAN-MULTI-CITY`；生产 allowlist 与 tools 均为空，不能产生 Evidence Claim、路线事件或 UI 航班事实。
- **传输**：仅使用 `SSEClientTransport` 的 legacy SSE，不 fallback。LOCAL HTTP SSE 夹具需覆盖 initialize、`tools/list`、connect deadline、幂等 close；测试不得访问附件 endpoint。
- **发现入口**：`discoverSourceDescriptorsOnce('SRC_FLIGHT')` 只允许 connect + `tools/list` + close，`toolCallAttempts=0`，无 ToolCallAudit、blocked tool、Evidence 或原始工具结果持久化，且只执行一次不重试。
- **Gate 边界**：Phase A 批准不含 Gate R-1。零调用 preview 命令只可替换状态与有效期一致的已过期/已消费计划，不得覆盖仍有效计划；未来 `createdAt`、路径/inode 替换、非原子主文件更新均须 fail closed。真实 `tools/list` 必须经专用 CLI 绑定新的 planId/digest/operationId，并在任何网络初始化前写入 operation-scoped 持久化消费；运行时授权需冻结并在 discovery 前消费，30 分钟窗口必须满足 `createdAt <= now < expiresAt`，同一 authorization/operation 成功或失败均不可重放。主 artifact 以 sync + atomic rename 更新；若消费 marker 已落盘而主 artifact 未更新，只有匹配旧 digest/计划/时间的 marker 可触发零调用恢复，旧消费不得阻断新的独立授权，且不提供 retry/endpoint 参数。真实 inputSchema 未落地前不得根据附件示例添加生产工具契约。
- **Gate R-1 结果**：2026-09-01 精确批准的 descriptor-only Gate 已消费一次并成功完成 `connect=1 / tools/list=1 / close=1`；发现 9 个工具，`toolCallAttempts=0`、`retryCount=0`、raw retention=0。`getFlightPriceByCities(dep_city, arr_city, dep_date)` 是 Phase B 唯一候选生产工具，但在新的 Gate R-2 一次返回结构验证前，生产 allowlist/tools 必须继续为空；其他天气、实时位置、舒适度与自然语言推荐工具不进入首期路线查询。
- **Phase B LOCAL 输入**：`dep_city/arr_city` 只接受大写三字 IATA，`dep_date` 只接受有效 `YYYY-MM-DD`，对象必须 strict；不得 trim、自动大写、容错日期或接受额外字段。
- **Gate R-2 LOCAL 护栏与 runner**：preview 绑定固定 endpoint、输入契约 digest、严格 args、一次未来 call、零 retry、30 分钟有效期、结构摘要 retention 与 exact 三元组；磁盘 operation 与内存 capability 各 one-shot。execute runner 无 fresh exact approval 时必须在 ToolRegistry 前零调用拒绝；获批后也只能固定执行一次 connect/list/call/close，以临时诊断 allowlist 校验 descriptor，不修改生产 allowlist/tools、不写 audit/Evidence/cache/health、不保留 raw。
- **Gate R-2 LIVE 结果**：2026-09-01 fresh exact plan 已消费一次，connect/list/call/close 各 1、retry=0、errorCode=null；仅保留 `gate-r2-result-shape-evidence.json` 的 JSON path/type/arrayLength。该 Gate 的 `resultSchema=NOT_RUN`、`contractStatus=UNPROVEN`，生产 allowlist/tools/probeTool 仍为空；已消费 Gate 不可重放。
- **Phase C LOCAL structure contract**：已新增 `variflight-get-flight-price-by-cities-result/local-structure-v1`。MCP envelope 只接受一个 strict text block；raw 顶层固定 `code/data/message/request_id/timestamp`，flight/cabin 只允许 R-2 已观测键与标量类型，unknown/type drift/空成员对象 fail closed。R-2 摘要无法证明数组成员 required，因此成员字段保持 optional；缺失 cabins 归一为 `null`，显式空数组保持 `[]`。
- **禁止补造值语义**：provider 时间戳单位/时区、日期格式、价格单位/币种、share/stop 含义未被结构摘要证明；normalized 仅复制 `*Raw` 字段，并把 `startAt/endAt/durationMinutes/costCents/currency/transferCount/overnightArrival` 固定为 `null`。4/4 focused、241/241 全量与完整质量门通过；这不是航班事实或生产结果契约。
- **pre-contract runner 失败矩阵**：fake session 已覆盖显式 tool error、MCP_TIMEOUT 与 close failure；分别锁定正文不泄露/health 不变、call=1/retry=0/close=1/authorization 不可重放、以及安全 MCP_PROTOCOL_ERROR。所有路径 ToolCallAudit=0、Evidence=0，人工航班替代文案存在；runner 7/7、全量 243/243。生产降级链路仍未实现，不能据此勾选完整 AC。
- **Gate R-3 LOCAL**：已实现 `variflight-value-semantics-classifier/v1`、独立 Gate artifact/claim/consumed marker、磁盘/进程双层 one-shot、strict CLI 与 ToolRegistry-bound runner。分类器只保留固定路径、布尔、枚举和计数，最大 64 flights × 64 cabins；时间单位/时区、币种、费用单位、起价、库存、stop/share 与 code 映射继续 `UNPROVEN`。focused 20/20、全量 263/263 与完整质量门通过，externalCalls=0、toolCallAttempts=0。
- **Gate R-3 LIVE 结果**：fresh exact Gate 已消费一次，connect/list/call/close 各 1、retry=0、resultSchema=VALID。只保留 `gate-r3-value-semantics-evidence.json` 的路径/布尔/枚举/计数；请求绑定与日期格式/关系一致，时间单位/时区、币种/金额单位、起价、库存、stop/share/code 仍 `UNPROVEN`，raw/value/产品持久化/生产注册写入均为 0。
- **Phase D 提案**：已新增 `phase-d-semantic-authority-proposal.md`。OQ-VF-002 比较 authority-first、更多受控样本与 raw-only production registration；推荐先取得官方字段定义，再以 externalCalls=0 实现 manifest/admissibility。更多样本不能单独证明业务语义，raw-only 注册没有路线价值。
- **OQ-VF-002 结果**：用户已选择 A authority-first；官方字段定义成为生产合同硬前置。本轮只同步文档，externalCalls=0。
- **OQ-VF-003 结果**：用户已提供 VariFlight 官方 Aviation MCP 页面，单页只读核验完成。它证明工具用途、三个必填参数、IATA/日期格式和工具失败文本，但没有返回字段表或 Schema；authority matrix 见任务目录，providerExternalCalls=0。
- **OQ-VF-004 结果**：用户确认没有其他可用官方字段字典、返回 Schema 或供应商答复。安装附件仅为 reference-only，且其旧 ModelScope SSE 与当前官方 streamable HTTP 端点冲突；既有 Gate 证据不得跨端点复用。
- **下一步 OQ-VF-005**：推荐 M0 正式维持人工航班证据；备选是另开只面向开发者、无价格/库存/Claim/RouteLeg 语义的 raw-only 诊断范围。两者都不自动授权实现或新 Gate。
- **LOCAL 样例**：携程截图中的 JHG→CAN、2026-09-17、AQ1042 10:05–12:35 ¥589 起与 CZ2104 12:00–14:35 ¥750 起仅可作手写 fixture，不能表述为 VariFlight 返回或可预订保证。

#### FlyAI Phase A 补充门禁（LOCAL）

- **精确依赖与供应链**：只允许 `@fly-ai/flyai-cli@1.0.16`；package name/version、`bin.flyai`、Node engine、direct dependency、无安装 lifecycle、registry integrity、bundle SHA-256 与 regular-file/realpath 必须全部匹配。UtilityProcess launcher 也必须匹配固定相对路径、SHA-256、regular-file/realpath 与 packaged unpacked 路径。固定 bundle 内置供应方 fallback credential/x-ff-ctx 的风险需显式保留，但具体值不得进入仓库、日志或文档；应用必须用用户加密 Key 覆盖，缺 Key 在 fork 前失败。
- **凭据与输入**：`FLYAI` 只追加到既有 credential enum，沿用 Main IPC + Electron `safeStorage`；Renderer 只显示三态且不回显。`search-flight` 只接受 strict `{ origin, destination, depDate }`，城市必须为原样中文，日期必须是有效且相对本地当前日严格未来的 `YYYY-MM-DD`，不 trim、不归一化、不接额外字段。
- **Main-only runner**：只用 `utilityProcess.fork` 执行固定 unpacked launcher，不启 shell；launcher 把目标 bundle 作为 argv[2]，移除 launcher/target 模块槽并将 `search-flight` 归一到 Commander 的 argv[1] 后再加载固定 bundle。每个获批操作最多一个 CLI 进程、应用重试 0，隔离 cwd/HOME/USERPROFILE 与最小 env，15 秒超时、stdout 1 MiB、stderr 8 KiB，失败/取消/超限后 kill 并等待 exit，残留 PID 视为 invariant failure。CLI 内部 provider 请求与重试次数始终记 `UNKNOWN`。
- **独立 Gate**：FlyAI 使用自己的 artifact/lock/consumed marker、私有 authorization symbol 和进程内 one-shot 集合；未来新 preview 使用 `flyai-flight-gate/v4`，canonical digest 绑定 package/integrity/bin/bundle hash/path digest、launcher hash/path digest/argv 契约、严格 args、单进程、未知内部请求、时间/输出上限、稳定 device-id、classifier v2 精确枚举与零生产写入。历史 v1/v2/v3 只可审计、不可执行；claim 必须先于 bootstrap、凭据读取和 fork，preview 与 execute 不复用任何 VariFlight artifact 或旧批准。
- **结果与生产隔离**：成功只接受严格 UTF-8 的单行 JSON 并立即转成去值化结构摘要；classifier v2 仅保留固定 `failureCategory`，首个 `Body:` 起的 stderr 不参与分类，原文、Key、环境、URL/query 与业务值不进入 outcome、日志、artifact、Evidence、DB/cache/health。专用 ToolRegistry 入口不调用 `prepareSource()` 或生产 session；`SRC_FLIGHT` 必须持续 `allowlist=[]`、`tools={}`、`probeTool=null`、`discoveryOnly=true`，人工 `USER_RESEARCH / VERIFIED_BY_USER` 航班路径继续保留。
- **LOCAL 修复证据**：focused 26/26、全量 298/298、format/lint、Node/Web typecheck、production build、build:unpack 与 packaged path-only smoke 通过；smoke 只检查 unpacked bundle/launcher 的路径、version/integrity/hash，未 require/import/执行真实 bundle。
- **Gate v4 LIVE_STRUCTURE_ONLY**：fresh preview 与 exact tuple 分别获批后只执行一次；`stage=run`、`cliProcessAttempts=1`、`applicationRetryCount=0`、内部 provider request/retry=`UNKNOWN`、raw/value retention=false。去值摘要只证明 `data.itemList` 长度 10、`journeys` 长度 1、`segments` 长度 1 或 2及成员字段 path/type，`truncated=false`；不得据此声明航班号、时刻、价格、库存、字段语义或生产可用性。Gate v4 已消费且不可重放。
- **Phase C LOCAL 合同**：`flyai-search-flight-result/local-structure-v1` 已实现。顶层与 item/journey/segment 只允许 Gate v4 已观测键/类型；成员字段 optional，未知键、类型漂移与空对象 fail closed。normalized 只保留 `*Raw`，时间、时长、金额、币种、中转等未证明语义固定 `null`；focused 10/10、全量 301/301 与本地质量门通过。
- **下一步**：本地参考展示、真实 runner 合同接入与生产路线接入均未自动获批，需重新定界；生产 `SRC_FLIGHT` 与 route/UI 保持关闭。任何更多真实执行都需要 fresh current-version zero-call preview 与新的 exact tuple approval；历史 Gate v2/v3/v4 均不可重放。

#### 云南 route-core 交通证据恢复补充门禁（LOCAL）

- **出发地权威字段**：multi-city 确认同时覆盖必填 gateway city 与可选精确集合点；Rail、goal、source plan/outcome、RouteLeg、stable ID 与 digest 只能出现 gateway。缺 gateway 时 `GATE_BLOCKED` 且零调用，不得用机场/车站/酒店/地址猜城市。
- **人工交通输入**：只对当前 critical `UNVERIFIED` 的 `MANUAL_FLIGHT / MANUAL_COACH` 显示表单；端点/日期只读。用户只提交方式、带 offset 起止时刻、标签、可选费用、来源名、安全 HTTPS URL、摘要与 `confirmed=true`，Main 派生 scope/端点/日期/时长/跨夜/换乘。
- **写前门禁与原子性**：unknown field、未确认、mode/date/timezone/order/cost/URL、stale/跨 session/route/leg/scope 在事件前拒绝；合法输入只产生一个 deterministic `USER_RESEARCH / VERIFIED_BY_USER` Claim 与一个 `itinerary/route-manual-evidence-applied` V2 事件，保留 source outcomes 并纯函数重算 candidates；重复事实零写。
- **推荐 Gate 与恢复**：critical legs 未齐时所有路线保持 blocked；全部补齐后最多一个 recommendation，选择仍由用户执行。删除 SQLite 后仅以原 JSONL 和 migrations 0001–0010 恢复相同 Claim/candidates/blockers/selection；无 migration 0011。
- **在哪看**：`src/main/manual-route-evidence.test.ts`、`src/main/itinerary-route.test.ts`、`src/main/ipc/itinerary-route.test.ts`、`test/renderer/itinerary-route-ui-render.test.ts`、`test/electron/itinerary-route-ui-smoke.mjs`。整条 LOCAL 路径固定 `externalCalls=0`、`modelCalls=0`、`irreversibleActions=0`，不代表真实 session 已填写或 LIVE 已验收。

#### 云南多城市 route-D5 补充门禁（LOCAL）

- **构造**：选中广州→大理→丽江→西双版纳→广州的 10 天路线，含 Rail 与 MANUAL_FLIGHT、4 个 RouteLeg、3 个 RouteStaySegment；可选路线允许昆明节点。
- **期望**：leg/stay 队列顺序与上游 route 完全一致；每个 source preview 为 0 调用并只授权一个 leg/segment，替换/过期/stale/cross-scope plan 在来源前拒绝；人工航班缺 Claim 时保持 BLOCKED。
- **骨架与局部更新**：`route_d5_day_skeletons` 每日期一行，跨城日使用有序 `routeLegIds`，普通日景点不得跨 node；“仅更新当天”只重写目标日并清除 owning segment 的住宿候选/选择，相邻 segment 不变。
- **最终 Gate**：全部 required leg plan、全部 stay 选择、10 天日期/9 晚覆盖与 boundary anchors 完整前，`route-d5/confirmed` 计数必须为 0；通过后只追加该一个 STAGE-4→STAGE-5 事件。
- **在哪看**：`src/main/route-d5.test.ts`、`src/main/ipc/route-d5.test.ts`、`test/renderer/route-d5-ui-render.test.ts`、`test/electron/route-d5-ui-smoke.mjs` 与 migration 0009。Electron 宿主错误不能用 SSR 替代。

#### 云南多城市 unified D6/D7 补充门禁（LOCAL）

- **构造**：使用已确认的广州→大理→丽江→西双版纳→广州 10 天 Route-D5 fixture，含 4 个 RouteLeg、3 个 RouteStaySegment、3 个 MUST_GO、普通日与 transfer day。
- **期望**：只生成一个 routeId 一致的 TimelineVersion；普通日不跨 node/segment，transfer day 显式保留 checkout、有序 leg、check-in、10/30 分钟缓冲与每日零时长 BACKUP。缺时刻、ETA、Claim 或官方交接时点名阻塞，不虚构。
- **任务与 Gate**：每个高影响 leg、stay segment 与需预约/复核 MUST_GO 有稳定且去重的 route-scoped task；GATE_C 以 route/node/segment/leg 点名缺口，旧单城市全局天气/闭园规则保持不变。
- **导出与界面**：ICS/Markdown 覆盖整条当前 route，保留跨午夜与 BACKUP 且不含精确私人地址/原始 Evidence；D6/D7 route 标签、迟到响应隔离和 820/320 px 规则可由 Renderer 测试与专用 Electron fake-session smoke 核对。
- **在哪看**：`src/main/route-d5.test.ts`、`src/main/d6.test.ts`、`src/main/d7.test.ts`、`test/renderer/d6-ui-render.test.ts`、`test/renderer/d7-ui-render.test.ts`、`test/electron/unified-d6-d7-ui-smoke.mjs` 与 migration 0010。Electron 宿主错误不能用 SSR 替代。

#### AC-M0-14 门到门总时长

- **构造**：选定一个铁路往返方案。
- **期望**：展示的是门到门总时长，且拆得出「出发地→车站」「候车」「乘车」「车站→住宿」四段，**接驳段有 `SRC_MAP` 的 Claim 支撑**。
- **在哪看**：D5 只能看交通方案卡片 UI + 该方案引用的 `claim_ids` 中至少一条 `source_id='SRC_MAP'`。**反例：只显示车次时刻表时长即失败。**
- **当前实现**：`transport_candidates` 投影表（迁移 0004）已有门到门总时长、四段 JSON、引用 Claim；`materializeRailJourney` / `materializeMapGroundTransfer` / `materializeHotelLodgingCandidates` 已产生对应 Claim，三源 `resultSchema=VALID`。2026-08-29 同一 Coordinator 会话已连续完成 Rail×2、Map×8、Hotel×1 的 11/11 LIVE 验收；该历史授权不覆盖云南 route-D5 的任何真实调用。

#### AC-M0-15 抵达日压缩

- **构造**：抵达时刻设为 16:40。
- **期望**：`day_type='ARRIVAL_DAY'` 的可用时长压到晚间段；`morning_json` / `afternoon_json` 为空或只含接驳与入住；不安排需完整半日的项目。
- **在哪看**：`day_skeletons` 该行的三段 JSON。

#### AC-M0-16 ⚙ 半日内地理邻近

- **构造**：正常四天行程，跑到骨架产出。
- **期望**：`day_skeletons` 的**同一段内**各项目两两直线距离 ≤ **8 km**（**LANE-AC 判定线**）；不出现跨城折返。
- **在哪看**：`test/verify-geo.mjs`。**读 `day_skeletons` 不读 `timeline_items`**——AC-M0-16 挂在 D5，而 `timeline_items` 要 D6 编译后才有行。
- **公交时长不作脚本判据**：`location_json` 只有坐标，算公交时长得调 SRC-MAP，验收脚本反复跑会烧搜索配额。

#### AC-M0-17 ⚙ 局部重算

- **构造**：发布 v1 后，在 SKELETON 视图只改第二天下午。记下时刻 `T0`。
- **期望**：只有第二天的 `day_skeletons` 行与住宿评估被重算，**其余日期行逐字节不变**；`SELECT count(*) FROM model_calls WHERE created_at > T0` **≤ 5**（**LANE-AC 判定线**）。
- **在哪看**：改动前后 dump `day_skeletons` 做 diff，除目标行外 0 差异；上述计数查询。

#### AC-M0-18 可比较总成本

- **构造**：3 晚的住宿段。夹具数据刻意让**含税服务费后的总价 ≠ 单价×3**，差额取一个好认的常数（例 +18800 分）。
- **期望**：每个候选的 `total_cost_cents` 覆盖全部 3 晚且等于夹具里的真实总价；`free_cancel_until` 有值，或明确标注"不可免费取消"。
- **在哪看**：`stay_candidates` 表 + 列表 UI。**反例：`free_cancel_until` 为 NULL 时在界面上显示空白，用户会读成"可取消"。**

#### AC-M0-19 房型可住人数

- **构造**：2 大 2 小。
- **期望**：`room_fits_party=0` 与 `NULL` 的候选**可以出现在列表里但必须带徽标**（分别标"不满足 4 人入住"与"人数信息缺失"），且**不得作为系统的首选推荐项**。NULL 不得当作满足（`PRD:FR-513`）。
- **在哪看**：`stay_candidates.room_fits_party` + UI 徽标 + 推荐位取的是哪一条。

#### AC-M0-35 来源分布透明度

- **构造**：跑到住宿阶段，三个来源都有结果；随后**人为把 `SRC_HOTEL` 改为返回空数组**再跑一次。
- **期望**：① 列表混排，每条标来源与 `contentIdentity`；② `source_id='SRC_HOTEL'` 对应 Claim 的 `content_identity` 必须是 `COMMERCIAL_OFFER` 且视觉可识别；③ 顶部显示各来源候选数与总数；④ **`stay_candidates.claim_id IS NULL` 的行数为 0**；⑤ 空结果场景下明确告知"酒店源本次无结果"并给手工粘贴入口。
- **在哪看**：列表顶部计数条；`SELECT c.source_id, e.content_identity, count(*) FROM stay_candidates c LEFT JOIN evidence_claims e ON e.claim_id = c.claim_id GROUP BY 1,2`。
- **坑：空结果 ≠ 降级。** 空结果时 `source_health` 仍是 `OK`，不要复用降级横幅。

---

### D6 时间轴（AC-M0-20 ~ 24）

> 本组四条的所有查询都要先 join `timeline_versions` 取 `is_current = 1`，见 §4.0。

#### AC-M0-20 ⚙ 缓冲可见且有下限（LOCAL 已通过）

- **构造**：行程含前往车站的交通段（M0 主路径走铁路）。
- **期望**：① 每个交通段 `buffer_minutes >= 10`；② 前往**机场或火车站**的段 `buffer_minutes >= 30`；③ **必须存在至少一个 ②类段**——否则查询返回 0 行是因为没东西可查，本条应判为"未执行"而不是"通过"。
- **在哪看**：`test/verify-timeline.mjs`。缓冲不允许隐式吸收进时长里，UI 上要能看见。
- **本地证据**：`src/main/d6.test.ts` 与 `test/electron/d6-ui-smoke.mjs` 覆盖普通 10 分钟、车站 30 分钟及 UI 可见性，externalCalls=0。

#### AC-M0-21 ⚙ 时刻自洽（LOCAL 已通过）

- **构造**：任一已发布版本。
- **期望**：按 `(date, start_time)` 排序后，`item[i+1].start_time >= item[i].end_time + 段间时长`，0 违规。
- **在哪看**：`test/verify-timeline.mjs`。**三个必须处理的边界：** ① 只取 `is_current=1` 的版本；② `item_class='BACKUP'` 的项不参与校验；③ `end_time < start_time` 表示跨午夜，比较时要加 24 小时。
- **本地证据**：`timelineOrderConflicts` 单测覆盖跨午夜与 BACKUP 排除；Coordinator 集成测试覆盖两版本唯一 current。

#### AC-M0-22 ★ 两次点击追溯（LOCAL 已通过）

- **构造**：在时间轴上分别挑一个**时刻**、一个**价格**、一条**政策**。
- **期望**：第 1 次点击该字段弹出证据卡，第 2 次点"来源"显示 `source_ref`、`observed_at`、`content_identity`、`verification_status`。三类字段都要试通。
- **在哪看**：TIMELINE → EVIDENCE 视图。硬校验：当前版本中含具体事实的 `timeline_items`，`claim_ids IS NULL OR claim_ids='[]'` 的行数应为 0——这条同时兜住 `AC-M0-30`。
- **本地证据**：D6 renderer test 验证“定位证据”入口且不暴露 sourceRef/toolName/credential/rawContent；EVIDENCE 只展示结构化 Claim 元数据。

#### AC-M0-23 未验证硬锚点阻塞发布（LOCAL 已通过）

- **构造**：走 `evidence/added` 事件写入一条 `verification_status='UNVERIFIED'` 的 Claim，让它支撑一个 `anchor_class='HARD_LOCKED'` 的项。
- **期望**：发布按钮禁用，抛 `GATE_BLOCKED`，阻塞清单**点名该项与缺的具体证据**，不是"信息不足"。
- **在哪看**：阶段推进按钮状态 + 缺项清单 UI + `gate/result` 事件 payload。
- **本地证据**：SKILL-10 单测和 Electron smoke 均验证按钮禁用、点名阻塞且 `timeline/published` 数量不变。

#### AC-M0-24 ⚙ 每日备选（LOCAL 已通过）

- **构造**：四天行程。
- **期望**：当前版本中每天至少 1 条 `item_class='BACKUP'`；BACKUP 不计入当日时长，主视图默认折叠。
- **在哪看**：按 `date` 分组统计 BACKUP 数量，最小值 >= 1。
- **本地证据**：四日 Electron smoke 每日一条 BACKUP，`details` 默认闭合；BACKUP 不进入冲突链。

---

### D7 任务、闸门与导出（AC-M0-25 ~ 28 / 32）

#### AC-M0-25 预订待办不代办（LOCAL 已通过）

- **构造**：行程含需预约的景点。
- **期望**：生成 `kind='RESERVATION_TICKET'` 的任务，`handover_json` 含官方渠道说明与截止时间，`due_at` 非空；系统未发起任何预约请求。
- **在哪看**：`tasks` 表 + Inspector 调用时间轴。"未发起"的硬证明直接用 **`AC-M0-29` 的三条 SELECT**。
- **本地证据**：`src/main/d7.test.ts` 由 OFFICIAL Claim 派生稳定 `RESERVATION_TICKET`、official channel、dueAt；D7 smoke 的 tool/model/external/irreversible 均为 0。

#### AC-M0-26 回填已购票（LOCAL 已通过）

- **构造**：在任务上回填「已购票」。
- **期望**：对应 `timeline_items.anchor_class` 变为 `CONFIRMED_EXTERNAL`；`decision_logs` 新增一行且 `rejected_json` 非空。
- **在哪看**：两张表。**反例：`item_class` 不应跟着变**——两者是正交维度（`GLOSSARY.md` §3）。
- **本地证据**：确认动作单事件生成 vN+1、重映射任务 itemId、保持 `itemClass=FIXED`、写非空 rejected alternatives；删除 SQLite 后从 JSONL 重建一致。

#### AC-M0-27 GATE_C 只给阻塞清单（LOCAL 已通过）

- **构造**：① 留一个 `priority='HIGH'` 且 `user_decision='PENDING'` 的任务；② 走 `evidence/added` 事件写一条支撑硬锚点的 Claim，把 `observedAt` 设得足够早（价格类 15 分钟窗口），使算出的 `validUntil` 落在过去，触发过期扫描使其转 `STALE`。
- **期望**：GATE_C 输出阻塞清单，**两条都点名**；不得给出"可以出发"之类的放行结论。
- **在哪看**：GATE 结果 UI + `gate/result` 事件 payload。
- **不要**直接 `UPDATE evidence_claims SET valid_until=...`：违反写路径禁令、会被下次重建抹掉，且不会自动让 `verification_status` 翻成 `STALE`。
- **本地证据**：固定 Claim/任务夹具同时产生 `HIGH_PRIORITY_TASK_PENDING` 与 `HARD_ANCHOR_STALE`，`ready=false`，完整 `gate/result` 可重放。

#### AC-M0-28 ⚙ 导出可用且干净（LOCAL 自动门已通过；人工导入待验）

- **构造**：导出 ICS。
- **期望**：能被 Windows 日历 / Outlook 正确导入；**解析 ICS 后与当前版本 `timeline_items` 逐条全量比对**起止时刻；文件内哨兵串 0 命中。**时区：ICS 必须带 `TZID` 或用 UTC，裸写本地时间在导入端会漂。**
- **在哪看**：`test/verify-timeline.mjs` 做全量回比 + 日历应用做导入。**若 `FR-509` 已按 `PRD:BUILD-CUT` order=4 砍到只剩 Markdown，本条改验 Markdown 导出，凭据检索部分照做不减。**
- **本地证据**：解析器按稳定 UID 全量回比 current timeline；普通/跨午夜起止 UTC 一致，零时长 BACKUP 用无 DTEND 的 VEVENT 表达。Windows 日历/Outlook 人工导入尚未执行。

#### AC-M0-32 ⚙ 导出包与诊断包无凭据（LOCAL 已通过）

- **构造**：完整跑一遍后导出行程包与诊断包。
- **期望**：全文检索哨兵串、`sk-`、`mcp_`、`Bearer ` 均 0 命中；**另检索当前 safeStorage 密文的前 16 字节 base64**。
- **在哪看**：`test/verify-no-secrets.mjs`。**必须解压后逐文件查**——直接 grep zip 会因压缩而漏检。
- **本地证据**：ICS、Markdown、诊断 JSON 与 `app.asar` 分别执行秘密扫描；asar 仅允许 out/package.json/production node_modules，0 个禁入路径、0 个凭据形态值；失败写盘路径删除 temp。

---

### 全周（AC-M0-29 / 30）

#### AC-M0-29 ★ ⚙ 不可逆动作次数为零

- **构造**：端到端跑完整流程一次。
- **期望**：三条同时成立——① `ToolRegistry` 注册表快照中不含任何写类工具；② `tool_calls` 中每条的 `tool_name` 都能在 allowlist 中找到；③ `blocked_tools` 中的工具名在 `tool_calls` 里 0 命中。
- **在哪看**：`test/verify-integrity.mjs`。**这条本质是"证明某事没发生"，只能靠"注册入口唯一 + 注册表即白名单"来证**。

#### AC-M0-30 ★ ⚙ 无来源事实数为零

- **构造**：端到端跑完整流程一次。
- **期望**：`evidence_claims.source_ref` 全部匹配 `^(https?://|tool:)` 之一；当前版本时间轴中所有具体事实项的 `claim_ids` 非空。
- **在哪看**：`test/verify-integrity.mjs`。**只查 `IS NULL` 没用**——`source_ref` 本来就是 `NOT NULL`，真正要挡的是 `"unknown"` / `"model"` / `"-"` 这类占位串（`PRD:hallucinationRule`）。

---

### 4.9 执行顺序建议

D1 当天先跑 `AC-M0-01`（两种重启都跑）与 `AC-M0-02` 的反例，这两条挂了后面全是白做。`AC-M0-08` / `AC-M0-09` 的夹具在 D1 之后就能写，**不要等到 D3 当天现写**——它们是两条 `neverCut` 验收的唯一手段，现写会被挤掉。`AC-M0-29` / `AC-M0-30` 每天收工时顺手跑一次，成本低且能早暴露污染。

**诊断包已冻结**：只含 event identity/type/time、tool/model 安全摘要、blocked tools、source health、appVersion 与错误码；不含 event payload、Evidence 原值/sourceRef、工具参数/响应、basics 个人信息或 credentials。

**已知的坑（勿重踩）：**

- `AC-M0-01` 必须**删库重跑**一次，且 `session/created` 占 `seq=1`，写 10 条业务事件后末行是 `seq=11`。D6 已由集成测试补跑连续发布、快照 + 增量、删库重建与坏快照回退路径。
- `AC-M0-07` 要**点两次探针**才降级（`fail_streak >= 2`），点一次会误判成没生效。
- `AC-M0-08` 的夹具必须有第四个工具——一个**在白名单里但描述含"预订确认"**的 `confirmBooking`，否则第二道关键词防线根本跑不到。
- `AC-M0-09` 的判定重点是 `fail_streak` 仍为 0；日志里要同时有 `SOURCE_DRIFT` **和** `SOURCE_ADAPTER_DEGRADED` 两个码；降级前已写入的 Claim 要转 `STALE` 而不是被删。
- D6 那组的所有查询都要 join `timeline_versions` 取 `is_current = 1`——`AC-M0-17` 会造出第二个版本。
- `AC-M0-20` 若行程里没有机场段，"机场段 buffer >= 30" 查出 0 行会被当成通过。必须断言"至少存在一个前往机场**或车站**的段"。
- `AC-M0-21` 的跨午夜项（`end_time < start_time`）不加 24 小时会大量误报。
- 构造数据一律走事件，不许直写 SQLite。`AC-M0-23` / `AC-M0-27` 尤其容易顺手写 UPDATE。

---

## 5. 每天收工前

`PRD:workflowGuidance` 的硬要求，逐条过：

- [ ] `tsc --noEmit` 零错误
- [ ] 应用能启动，当天做的功能手工走通一遍
- [ ] 四项 grep 检查（`COLLABORATION.md` §6）：`ctx.effect(`、`JSON.stringify(state`、绕过 `TravelStateService.apply` 直写 SQLite、裸用 `setInterval`
- [ ] 退出后任务管理器无残留 node 进程
- [ ] `PROGRESS.xml` 的 `currentState`、`completionDeclarations`、`nextActions` 已更新
- [ ] 当前目录不是 Git 仓库，记录"无提交"即可

**不允许跨天的半成品。** 宁可砍范围也要当天收口。
