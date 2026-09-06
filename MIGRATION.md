# MIGRATION & COMPATIBILITY

数据迁移、schema 演进、依赖版本兼容与升级陷阱。

前提认知：**这是单人自用应用，只有一个用户、一台机器、没有线上环境。** 所以"迁移"在这里的含义与服务端项目完全不同——大部分情况下**最优解是删库重建**，而不是写迁移脚本。本文件的重点是划清"哪些能删着重来、哪些必须严肃迁移"。

---

## 1. 三类数据，三种策略

| 数据 | 位置 | 策略 |
| --- | --- | --- |
| **事件日志** | `sessions/*/events.jsonl` | **必须严肃迁移**。它是唯一事实源，丢了就真丢了 |
| **SQLite 读模型** | `travel-harness.db` | **随便删**。改结构就删库重建，禁止写数据修补脚本 |
| **缓存与计数** | `cache/poi.db` | POI 缓存可删（代价是烧配额）；**`quota_counters` 不可删**，见下 |
| **凭据** | `<userData>/credentials.json` 中的 safeStorage 密文 | 不迁移、不导出，换机重录 |
| **模型路由** | `<userData>/provider-config.json` | 保留用户配置；按 version 兼容读取，见 §5 |

**`cache/poi.db` 里的 `quota_counters` 是例外，不在"随便删"之列。** 删掉它等于月度用量归零，80%/95% 熔断失去状态，而高德超额是**自动扣费**不是拒绝服务——这直接踩中 `PERFORMANCE.md` §5 的不可接受行为。要清缓存只 `DELETE FROM poi_cache`，不要删整个文件。

这条分工是整个数据模型的收益兑现点。早期开发可通过“改 `0001_init.sql` + 删库重建”快速迭代；但仓库已经存在 `0002_model_call_cost.sql` 与真实会话兼容要求，因此从 `0002` 起视为已进入 §2 的追加迁移阶段。现有迁移文件不可回写，新结构一律新增版本。

---

## 2. SQLite 迁移机制

`src/main/db/migrate.ts`，最小实现，不引入迁移框架。

```
open(db)
  → PRAGMA journal_mode = WAL
  → PRAGMA foreign_keys = ON
  → current = SELECT max(version) FROM schema_migrations   (表不存在则 0)
  → 逐个执行 migrations/ 中 version > current 的 .sql
      每个文件在自己的事务里：BEGIN → 执行 → INSERT schema_migrations → COMMIT
  → 任一失败：回滚该文件，抛 STORE_MIGRATION_FAILED，中止启动
```

规则：

- 文件名 `NNNN_描述.sql`，四位数字，从 `0001_init.sql` 起。
- **迁移文件一旦提交就不可修改**（M0 开发期例外，见 §1）。要改就加新文件。
- 每个文件一个事务。SQLite 支持事务内 DDL，所以失败能干净回滚。
- **不写 down 迁移。** 回滚手段是删库重建——这个项目有事实源，比 down 脚本可靠得多。
- 迁移失败**中止启动**，不要"跳过继续"。带着半迁移的库跑起来是最坏的结局。

当前版本：

- `0001_init.sql`：基础读模型。
- `0002_model_call_cost.sql`：模型调用渠道与成本字段。
- `0003_xiaohongshu_source.sql`：只扩展 `evidence_claims.source_id` 允许 `SRC_XHS`。由于 SQLite 不能直接修改 CHECK，迁移在单个事务中重建 `evidence_claims` 与引用它的 `stay_candidates`，复制全部旧行、重建索引，并以 `PRAGMA foreign_key_check` 验证。`stay_candidates.source_id` 自身的三来源约束不变。
- `0004_d5_transport_candidates.sql`：新增 D5 `transport_candidates` 查询投影，不修改 0001–0003。完整候选仍由 JSONL 事件和 TravelState 表达；删库重建时按事件重新生成推荐、选择、四段 JSON 与 Claim 引用。
- legacy BUILD-D6 不新增 migration：直接启用 0001 已有的 `timeline_versions`、`timeline_items` 与 `decision_logs`。完整 `timeline/published` 是重建依据；禁止为时间轴建立第二套事实表或回写 0001–0004。
- `0005_d7_task_links.sql`：只给既有 `tasks` 增加 `timeline_version`、`item_id`、`claim_ids`、`updated_at` 与两组索引，不回写 0001–0004。旧行允许关联列为 NULL；首次 SKILL-11 派生以稳定 taskId upsert 补齐。
- `0006_user_research_source.sql`：以事务表重建扩展 `evidence_claims.source_id=USER_RESEARCH`，并同步恢复引用外键与索引。
- `0007_multi_city_routes.sql`：新增 route candidate/node/leg/stay-segment/selection 投影，不改变旧单目的地行。
- `0008_node_scoped_d4.sql`：新增 ROUTE_NODE 研究状态、实体、Claim link、冲突与结果投影。
- `0009_multi_segment_d5.sql`：新增 route-D5 leg/options/anchors、stay/candidates/outcomes、day skeleton 与 confirmation 投影；外键引用 0007 路线拓扑，旧 D5 表保持不变。
- `0010_unified_route_timeline.sql`：为既有 timeline/task 读模型增加 nullable route/node/segment/leg 列、context JSON 与索引；旧行保持 NULL，不新建平行事实表。

启动时的版本关系：

| 情况 | 处理 |
| --- | --- |
| db 版本 < 代码版本 | 正常，执行迁移 |
| db 版本 == 代码版本 | 正常 |
| **db 版本 > 代码版本** | 用户降级了应用。**拒绝启动**并提示，不要试图运行——新版本写的列旧代码不认识，会静默丢数据 |

---

## 3. 事件 schema 演进

这才是真正需要小心的地方。事件日志要能被**未来任意版本的代码**重放。

### 硬规则

**已发布的 eventType 与其 payload 字段，语义永不改变。**

允许的演进：

- **加新 eventType**。旧日志里没有，reducer 直接不处理即可。
- **给已有 payload 加可选字段**。老事件缺该字段，reducer 必须能处理 `undefined`。
- **废弃 eventType**：停止产生新的，但 reducer **必须继续能处理老的**。标 `@deprecated` 注释，不删代码。

禁止的：

- 改已有字段的类型或含义。
- 删已有字段（reducer 会拿到 undefined 然后按新逻辑算错）。
- 把可选字段改成必填。
- **重排 seq 或重写历史事件**。

### 需要破坏性变更时

不要改老事件。做法是：加一个新 eventType，让 reducer 同时支持新旧两条路径。例如 `stay/selected` 要改结构，就加 `stay/selected-v2`，老事件走老 reducer 分支。

代价是 reducer 里会积累历史分支。对一个自用项目来说，这个代价远小于事实源不可信的代价。

### payload 版本标记

每个事件的 payload 里**不**放版本号——版本信息已经在 `eventType` 里了（`-v2` 后缀）。加一个 `schemaVersion` 字段只会让人产生"可以原地改结构"的错觉。

### Zod schema 的宽严

重放老事件用的 schema 必须是**宽松的**：

```ts
// ✅ 重放用：未知字段放行，缺失可选字段给默认值
const StaySelectedPayload = z.object({ ... }).passthrough()

// ❌ 不要用 .strict()，未来加了字段的事件重放老代码时会整体失败
```

写入时可以严格校验，**读取重放时必须宽松**。这两处用不同的 schema 是有意的，不要图省事合并。

当前实例：固定目的地确认只给 V2 `stage/confirmed` 增加可选 `confirmation={kind:'FIXED_DESTINATION',city}`。旧 V1/V2 事件没有该字段时继续按原语义回放，因此不新增数据库 migration、不重写历史事件，也不把该字段改为必填。

---

## 4. 快照的兼容性

`snapshot-v1.json` 是**纯优化，可随时丢弃**（DATA_MODEL §2）。因此快照不需要迁移策略：

- 快照文件里记 `appVersion`。
- 启动时若 `appVersion` 不兼容、JSON 损坏、seq 越界、事件前缀或 state 不一致，**直接忽略快照**，从头重放。
- 每次 `timeline/published` 或事件数达到 200 的倍数时，用临时文件 + fsync + rename 原子替换快照。

这比给快照写迁移逻辑简单得多，代价只是一次几秒的全量重建。

D6 集成测试已覆盖连续两次发布后的 snapshot+tail、删除 SQLite 后重建及损坏快照回退；JSONL 中间损坏仍按既有规则拒绝启动，不能被快照掩盖。

D7 的 `task/updated` 与 `gate/result` 写入 schema 保持 strict，重放 schema 使用 passthrough。用户确认型 `task/updated` 的任务、replacement timeline 与 DecisionLog 是一个不可拆分的事件和 SQLite 事务；删除数据库后必须从 JSONL 重建出同一 vN+1、任务三轴与最新 GATE_C。禁止通过迁移或 UPDATE 补写事件事实。

---

## 5. Provider 配置 v1 → v2

`<userData>/provider-config.json` 不是事件事实源，但包含用户手工录入的模型路由，不能靠删库重建。读取端必须使用 `version` 判别：

- version 1：单一 `provider + baseUrl`，四角色只保存模型与费率。继续可读、可调用；启动和读取不得改写文件。
- version 2：`channels` 固定保存 `DEEPSEEK_OFFICIAL / SHUAI_API` 两个 HTTPS 根地址，四角色分别保存 `channel / model / currency / rate`。
- 只有用户从新 SETTINGS 主动提交时才用临时文件 + rename 原子写入 version 2；禁止启动时静默迁移或部分补字段。
- 任一版本校验失败都抛 `INTERNAL_SCHEMA_MISMATCH` 并停止模型请求，不猜测渠道、不自动降级。
- 旧应用无法理解 version 2。代码回滚时必须保留用户文件并恢复事先备份的 version 1；禁止自动把 v2 折叠成 v1，因为四个角色可能使用不同渠道。

`credentials.json` 仍保持 version 1。新增 `SHUAI_API`、`SERPER_SEARCH` 与可选 `XIAOHONGSHU_MCP_AUTH` 都只是 Credential ID 枚举的加法扩展，不改密文容器格式，也不得删除或重命名 `AMAP / ROLLINGGO / OPENAI / DEEPSEEK / GEMINI` 条目。小红书 `xsec_token` 不是应用凭据，不得写入这个容器。

---

## 6. 依赖版本兼容与升级陷阱

### cordis —— 钉死 3.18.1，禁止升级

这是本项目最大的版本陷阱，已在 `PRD:pinnedVersion` 与 ARCHITECTURE §1 记录，此处补充**升级时会发生什么**：

- npm `latest` 指向 `4.0.0-rc.8`，**没有 4.x 稳定版**。`^3.18.1` 目前不会装到 4（插入符不跨 major，且 rc 不被默认选中），但 4.x 一旦发稳定版，任何一次 `npm update` 都会带过去。
- v4 是重写级不兼容：`ForkScope`/`MainScope` → `Fiber`，`Lifecycle` → `EventsService`，**`ready`/`dispose`/`fork` 三个生命周期事件被删除**。
- 后果最严重的一条：`ctx.on('dispose', fn)` 在 v4 上**不报错、不警告、永不触发**。MCP 子进程、SQLite 连接、文件句柄全部泄漏，而你在开发期看不出任何异常。
- v4 是 ESM-only，与 Electron 主进程的 CJS 打包冲突。

**强制措施**：`package.json` 写精确版本 `"cordis": "3.18.1"`；`bootstrap.ts` 启动时断言版本号以 `3.` 开头，否则抛错退出。这个断言看起来多余，但它是唯一能在升级事故发生时立刻暴露问题的东西。

如果将来真要升 4.x，那是一次**独立的迁移项目**，不是顺手 `npm update`。

### better-sqlite3

- **必须在 `dependencies`**，不能在 devDependencies——打包时会被排除，运行时报模块找不到。
- 13.x 随包发预编译产物，**不需要 electron-rebuild**。
- 升 major 版本时唯一要验的是预编译产物是否覆盖当前 Electron 的 ABI 版本。验法：`npm i` 后直接跑一次 `db/open.ts`，能打开就没问题。
- 换 Electron 大版本时要重新验这一条，因为 ABI 会变。

### Electron

- 目标 Windows 10 22H2+（`PRD:NFR-001`）。
- 升级时重点回归三处：preload 单文件打包是否仍生效、`safeStorage` API 行为、`app.getPath('userData')` 路径是否变化（变了等于用户数据"丢失"）。当前钉死 Electron `39.8.10` 并使用同步 `encryptString` / `decryptString`；未来若升级到提供异步方法的版本，必须单独做契约迁移与回归。
- **不要在 D1–D6 期间升 Electron。** 打包环节在 D7，升级引入的问题会没有时间处理。

### MCP SDK

- 已内置 cross-spawn 处理 Windows 上的 npx 解析，**禁止改用 `shell: true`**（引入命令注入面且无必要，`PRD:NFR-031-f`）。
- 升级时验 stdio 传输的子进程生命周期：`ctx.on('dispose')` 里的 `child.kill()` 是否真的杀掉了 npx 拉起的孙进程。

---

## 7. 外部数据源的兼容性

外部 MCP Server 不归我们控制，**它们会在没有通知的情况下变**。

| 源 | 已知脆弱点 | 应对 |
| --- | --- | --- |
| 12306-mcp | 靠正则匹配 12306 首页 HTML 建站点索引，**会周期性失效** | 抛 `SOURCE_DRIFT` 并立即标记 `SOURCE_ADAPTER_DEGRADED`；手工粘贴路径必须可用 |
| RollingGo 酒店 | API Key 模式与 OAuth 模式暴露的工具集不同；返佣加价，价格可能非中立 | 白名单只放 API Key 模式的 3 个只读工具；价格标 `COMMERCIAL_OFFER` |
| 高德 | **SSE 端点已于 2026-03-17 下线**，现用 streamable-http，key 走 URL query 不走 header | 端点变更需改 `src/main/mcp/sources/map.ts` 一处 |
| 小红书本地伴随 MCP | 用户登录态、上游页面与工具返回结构可能变化；`xsec_token` 只适合瞬时详情调用 | 固定 loopback endpoint 与三工具 allowlist；Schema 漂移失败关闭，重新登录由用户在伴随程序完成，应用不自动操作 |

工程约定：**每个 source 的返回值 schema 集中在 `shared/schema/mcp/<source>.ts`，一个文件对应一个源。** 源变了只改一个文件。禁止把字段解析散落在 skill 或视图里——那样一次上游变更要改十几处。

**版本探测不做。** M0 不实现 MCP server 版本协商或能力探测，成本高收益低。靠 schema 校验失败触发降级即可。

---

## 7. 升级路径与导出

### 换机

（`PRD:FR-509` / `NFR-028`）

导出包含：`events.jsonl`（全部会话）、快照、导出时的应用版本号。
导出**不含**：凭据（任何形式）、SQLite 库文件、缓存、日志。

导入流程：解压 → 校验版本 → 从 JSONL 全量重建 → 提示用户重新录入 API Key。

**凭据不迁移是刻意的决定**，不是偷懒。导出包一旦含凭据就成了一个明文密钥文件，风险远大于重录几个 Key 的麻烦。

导出前必须过一道显式的凭据字段剔除（`PRD:NFR-028-a`），不是依赖"调用方没写进去"。新增导出格式时必须同步走这道剔除。

### 应用升级

同机覆盖安装。启动时按 §2 执行 SQLite 迁移，按 §3/§4 处理事件与快照。用户数据在 `userData` 目录，不随安装包更新。

**`cache/poi.db` 的两张表不走 §2 的迁移机制**——它是独立库，建表语句直接写在 `mcp/poi-cache.ts` 的 `CREATE TABLE IF NOT EXISTS` 里。结构要改就删 `poi_cache`（`quota_counters` 除外，见 §1）。

**升级前不做自动备份。** 但首次运行新版本时，如果检测到迁移版本跨度 > 1，提示用户"建议先导出一份"。

---

## 8. M0 明确不做的

写在这里是为了防止编码助手"顺手补全"：

- 数据库 down 迁移脚本
- 快照格式迁移
- MCP server 版本协商
- 凭据迁移 / 密钥托管
- 自动备份与回滚
- 多设备同步
- 事件日志压缩或归档

以上任何一项被提出，对照 `PRD:implementationTiers` 检查 tier，非 M0 直接拒绝。

---

## 8. D4 ranking 的无迁移事件演进

PRD:FR-309 不新增 SQLite migration。`research/checklist-prepared` V2 只增加可选 `xhsSampleSummary`、`attractionRankings` 与 `finalClaims`；缺失这些字段的旧 JSONL 事件继续按空摘要、空排序与无内嵌 final Claims 回放。现有 `evidence_claims` 表自 0003 起已允许 `SRC_XHS`，final Claims 仍投影到同一表。

升级验证必须同时覆盖：旧 checklist 字节不改即可重放；新 checklist 在清空 SQLite 投影后从 JSONL 恢复 summary、rankings 与 final Claims；恢复过程 externalCalls=0、modelCalls=0。不得为可选事件字段伪造 0006 migration，也不得回写历史 JSONL。

---

## 9. migration 0008 与 ROUTE_NODE 双读

0008 为多城市选中路线新增节点研究投影和 EvidenceClaim scope 关联，不修改历史 JSONL。迁移按既有 runner 顺序执行且必须幂等；旧 0001–0007 测试库没有 scope/节点表时，读取路径返回 `scope=null` 并跳过新投影写入，不能把兼容性检测误当成数据缺失或启动失败。

新 V2 节点事件必须完整携带 `sessionId + routeId + nodeId`，所有嵌套对象 scope 相等后才可回放。删除 SQLite 后的重建只从 snapshot/JSONL 恢复节点队列、实体/Claim 链接、冲突、处置与确认；重建过程保持纯本地、零来源、零模型调用。历史事件字节不得补写 scope，迁移失败仍按事务回滚并阻止应用继续启动。

---

## 10. migration 0009 与 route-D5 平行演进

0009 不把旧 `transport_candidates`、`day_skeletons` 或 `stay_candidates` 转换成多段结构，而是新增 `route_d5_*` 表。这样 0001–0008 JSONL/SQLite fixture 可继续走 legacy reducer/projection；存在选中 RouteCandidate 的新 session 才写 route-D5 投影。表存在性检查只服务旧 fixture 兼容，不能在新数据库上静默跳过 0009。

七类新事件固定为 eventVersion=2，并在 session/route 身份下进一步绑定 leg 或 node/segment。写 schema 严格，replay schema 只允许加法字段；当前版本分支必须排在宽松 legacy union 前。`route-d5/confirmed` 是该分支唯一 STAGE-4→STAGE-5 事件，禁止再补写 `stage/confirmed`。

升级验证至少覆盖：从 0001 顺序运行到 0009、foreign_key_check 为空、重复迁移不改数据、旧 D5 fixtures 可读、跨 leg/segment 事件 fail closed，以及删除 SQLite 后仅用未改写 JSONL 恢复等价 route-D5 状态。恢复过程不得创建 pending plan、启动 MCP 或调用模型。

---

## 11. migration 0010 与 unified D6/D7 加法投影

0010 只扩展 `timeline_versions`、`timeline_items` 与 `tasks`：版本行保存 nullable routeId，item/task 保存 nullable route/node/segment/leg 标量与完整 context JSON。无 selected route 的 legacy event/row 不补写 identity；旧 0001–0009 fixture 继续按原 schema 语义回放，新数据库则必须顺序完成 0010 后才能持久化多城市 scope。

升级验证至少覆盖：0001→0010 顺序执行、重复启动不改 schema/data、route 索引存在、旧行新增列为 NULL、统一 timeline/task 从 JSONL 恢复后 scope 等价，以及旧单城市 D6/D7 taskId 与 event counts 不变。重建过程仍是纯 reducer/projection，不读取真实来源、不调用模型、不重新生成 routeId，也不改写历史 JSONL。

## 12. Route core 人工交通证据的无迁移演进

`itinerary/route-manual-evidence-applied` 是 additive V2 event；它同时携带 deterministic `USER_RESEARCH / VERIFIED_BY_USER` routeLeg Claim、`ROUTE_GOAL_LEG { fromCity, toCity, travelDate }` scope、重算后的 candidates 与 blockers。reducer、`evidenceClaimsForEvent`、路线 projection、snapshot 与 JSONL replay 都以加法方式识别该事件；旧事件 payload、sequence、ID 与字节不回写。

不创建 `0011`。现有 `evidence_claims.value_json` 与 route `detail_json` 足以承载 goal-leg scope；node-only scope 关联表继续只服务 `ROUTE_NODE`，读取 goal-leg Claim 时从已校验的 routeLeg value 恢复。升级/恢复验证必须从空 SQLite 顺序运行 0001–0010，再仅用原 JSONL 得到相同 Claim、candidates、blockers 与 selection；过程不得生成 pending plan、访问证据 URL、启动 MCP/Provider 或调用模型。LOCAL 回放等价不等于真实旅行 LIVE 验收。
