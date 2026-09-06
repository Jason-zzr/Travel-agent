# Travel Harness

Travel Harness 是一个面向国内家庭游的本地优先 Windows 桌面 Agent。它通过对话收集需求，调用只读数据源形成可追溯证据，并把模型调用、成本和工具行为留在本机审计。

当前已完成：

- Electron 主进程、Cordis 服务内核、JSONL 事实源与 SQLite 读模型。
- CHAT、SKELETON、TIMELINE、TASKS、SETTINGS、EVIDENCE、INSPECTOR 七个界面。
- Rail、Amap、RollingGo Hotel、Serper Search + DeepSeek，以及应用内置的小红书 MCP 五类既有只读数据源及白名单、Schema、降级和 Evidence 链路；RollingGo Flight 已下线维护。
- 主进程内轻量模型网关：四个角色可分别选择 DeepSeek 官方或帅 API。
- BUILD-D4 目的地与研究证据闭环：固定城市通过正式 `destination:confirm-fixed` UI/IPC 显式进入 STAGE-3，模糊意向仍走 2–4 个候选；只读 Source Subagent、跨源实体归并、推广识别、成员适配、冲突双边展示与用户裁决保持不变。
- D4 小红书 30 帖严格排序通路是 selected-route required node 的默认事实获取路径：零调用预览绑定 route/node 与一次性 digest，按四条固定查询冻结推荐/避雷各 15 帖，串行读取 30 条正文详情，经 6×5 EXTRACTION 与 1 次 REVIEW 后用 `3R−4A+fit` 本地排序；Travel Agent 展示来源、时效、核验状态、不确定性与避雷理由，用户只批准、选择或裁决。
- XHS UGC 可佐证路线体验、拥挤、体力、服务与避雷，但不能独立验证开放时间、闭园或预约要求；硬事实需要另一份独立 allowlisted 标准/官方来源计划，否则保持 UNKNOWN/BLOCKED。D4 正式人工研究只在自动路径失败或不足后由用户显式选择，生成 `USER_RESEARCH / VERIFIED_BY_USER`，不得自动 fallback 或改写为 MCP provenance。
- BUILD-D5 证据闭环已完成：铁路往返与地图接驳组成四段门到门候选，生成抵达/离开硬锚点、日级骨架和单住宿段；三个住宿来源按整段总价混排。局部调整只重写目标日期和住宿评估，不调用模型。
- 云南多城市试点已完成 route core、node-scoped D4、multi-segment D5 与 unified D6/D7 LOCAL：Travel Agent 在同一 10 天目标内维护 route/node/segment/leg 身份，编译一条连续时间轴，派生逐路段/住宿段/MUST_GO 任务与 scoped GATE_C，并导出整程 ICS/Markdown；旧单城市 D5–D7 保持兼容。
- 云南 route core 现将城际 gateway 与可选精确集合点分开：路线、Rail 参数和 digest 只使用 gateway，缺 gateway 时不猜测并零调用阻塞。STAGE-2 的关键人工航班/大巴缺口可由用户在只读端点/日期表单中确认；Main 派生 `ROUTE_GOAL_LEG` scope 并以一个 `USER_RESEARCH / VERIFIED_BY_USER` Claim 和一个原子事件本地重算路线，不访问填写的 URL、不调用来源或模型。
- `SRC_FLIGHT` 当前只具备 FlyAI Phase A、稳定 device-id 与 failure-classifier v2 LOCAL 基础：精确安装 `@fly-ai/flyai-cli@1.0.16`，接入 FLYAI safeStorage、严格输入、Main-only UtilityProcess runner、独立 one-shot Gate 与 packaged path-only smoke。此前一个 Gate v2 已消费并以 `MCP_TOOL_ERROR / UNKNOWN` 失败；未来 preview 使用 Gate v3，历史 v1/v2 不可执行。本轮未生成 preview、读取 Key、启动或调用 FlyAI；生产 allowlist/tools/probeTool 仍为空/空/null，人工航班入口继续保留。
- BUILD-D6 本地闭环已完成：SKILL-09/10 把已确认 D5 状态与已落盘 EvidenceClaim 编译为分钟级时间轴，显式展示 ETA、10/30 分钟缓冲、核验状态与每日 BACKUP；连续发布保留历史版本，未验证硬锚点会阻塞发布。
- BUILD-D7 本地闭环已完成：SKILL-11 从当前时间轴与已存 Claim 确定性派生准备/预订待办；用户回填外部结果时生成新时间轴版本，GATE_C 点名未完成高优任务与失效硬锚点；ICS、Markdown 和 allowlist-only 诊断导出均在主进程执行秘密扫描后原子写盘。Inspector 已支持按会话、时间和条数查看事件、工具、模型、拒绝工具与来源健康的安全摘要。

## 模型路由

模型请求只从 Electron 主进程发出，不监听本地端口，也不启动独立网关服务。

| 角色 | 用途 | 可选渠道 |
| --- | --- | --- |
| `EXTRACTION` | 从对话中提取结构化旅行需求 | `DEEPSEEK_OFFICIAL` / `SHUAI_API` |
| `PLANNING` | 生成规划结果 | `DEEPSEEK_OFFICIAL` / `SHUAI_API` |
| `REVIEW` | 复核结构与约束 | `DEEPSEEK_OFFICIAL` / `SHUAI_API` |
| `VISION` | 视觉相关步骤 | `DEEPSEEK_OFFICIAL` / `SHUAI_API` |

每个角色都显式保存渠道、模型、币种和可选费率。系统不根据模型名猜测渠道，不自动切换 Provider、模型或分组，也不做网络重试或 fallback。通用结构化输出校验失败时仅允许一次显式 Schema 修复调用；D4 30 帖严格通路显式设置 `repairInvalid=false`，首个非法结果即整批失败。

### 本地录入

在 SETTINGS 中：

1. 在“数据源与模型密钥”按需录入 `DeepSeek`、“帅 API（第三方模型）”、`Serper Search` 或 `FlyAI 航班参考` 的 API Key。`SRC_SEARCH` 同时需要 Serper Search 与 DeepSeek；所有凭据经 Electron `safeStorage` 加密，界面只显示状态，不回显内容。FlyAI Phase A 不会自动读取或调用该 Key。
2. 在“模型路由”填写渠道根地址：
   - DeepSeek 官方：`https://api.deepseek.com`
   - 帅 API：`https://api.shuaiapi.com`
3. 为四个角色分别选择渠道并填写该渠道实际支持的模型名。
4. 点击“保存模型路由”。网关会自行追加 `/v1/chat/completions`，根地址不要带 `/v1`、查询参数或路径。
5. 在“只读数据源”点击“登录小红书”时，应用按需启动并校验内置 sidecar；二维码只显示在应用内，扫码后应用会在 5 分钟内串行检查登录状态。取消、离开或失败不会自动重试。登录只建立会话，不授权任何 route-node 内容研究。

旧版 version 1 Provider 配置仍可读取和调用；只有用户从新 SETTINGS 主动保存时才写入 version 2。

> D3 的 `SRC_SEARCH` 是独立 stdio MCP 通道，不经过轻量模型网关，也不会自动改接帅 API。Serper Search 通过固定 `POST /search` 请求返回最多 10 条有效结构化来源，`deepseek-v4-flash` 只基于这些来源流式生成；DeepSeek 原生 `web_search` / `open_page` 禁用，所以页面打开次数与 token 审计精确为 0。

> D4 的 `SRC_XHS` 是固定版本、应用内置的 Windows x64 sidecar。Main 在每次按需启动前校验 binary/manifest/license、大小与 SHA-256，固定绑定 `http://127.0.0.1:18061/mcp`，使用随机 Main-only token 与 app-owned cookies/cache/work；Renderer 不可见端点、token 或路径。只注册 `get_login_qrcode`、`check_login_status`、`search_feeds`、`get_feed_detail`；登录工具仅在 Settings 的显式点击后调用，二维码只在 Renderer 内存展示，不写日志、SQLite、JSONL 或文件。`xsec_token` 只在同一研究批次的详情边界短暂使用。小红书内容始终从 `INDEPENDENT_UGC / UNVERIFIED` 起步，查询方向不等于情感事实。

> 旧双路研究入口只为 legacy single-destination 保留。selected-route required node 默认使用新的 30 帖严格入口：同一临时 MCP session 固定执行四条查询与 30 条详情，推荐/避雷各 15 且全局去重；任一组不足或任一详情失败都不补位、不降样本、不重试。真实执行前 UI 必须展示当前 session/route/node、EXTRACTION/REVIEW provider/model、四条 query、`4+30` 来源读取、`6+1` 模型调用、零重试与 digest，并取得该节点的新明确批准。

## 安全边界

- 所有旅行数据源只读；应用不代替用户预订、下单、支付、取消、改签或退款。
- API Key、Authorization、Prompt 原文和模型原始响应不得进入 Renderer、日志、SQLite、JSONL、导出包或测试 artifact。
- 每次真实模型请求只使用角色保存的渠道，并在 `model_calls.provider` 记录实际传输与计费方。
- 模型或数据源错误 fail closed；未知响应不会被猜测映射为有效结果。

## 本地开发

要求：Windows 10 22H2+ 或 Windows 11 64 位、Node.js 22+。

```powershell
npm install
# 由明确的安装/运维步骤预灌 12306-mcp@0.3.10 及其依赖到 npm 缓存
Push-Location mcp-servers/deepseek-web-search
uv sync --frozen
Pop-Location
npm run dev
```

应用运行时只启动已安装的本地 MCP 可执行文件，不会隐式运行 `uv sync`。Rail 固定执行 `npx(.cmd) --offline -y 12306-mcp@0.3.10`，不会访问 registry 或在线补包；精确版本及其依赖未预灌时会以 `SOURCE_UNCONFIGURED` 安全失败。当前 D3 只覆盖源码开发运行；安装包内置 Python 运行时另行处理。

质量门：

```powershell
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

### VariFlight Gate R-1 开发验收

> Historical / non-production：以下 R-1/R-2/R-3 命令与 artifact 只记录旧 VariFlight SSE 的已消费诊断边界，不得重放、迁移到 FlyAI 或作为生产航班值语义。

生成新的 30 分钟零调用 preview：

```powershell
npm run probe:variflight:discovery:preview
```

该命令只替换状态与有效期一致的已过期或已消费计划，写入新的 `planId + digest + operationId`，固定 `externalCalls=0`、`toolCallAttempts=0`。它不会连接 VariFlight，也不构成执行授权。把完整计划展示给用户并取得对当前三元组的 fresh exact approval 后，才可运行：

```powershell
npm run probe:variflight:discovery -- --plan-id <approved-plan-id> --digest <approved-digest> --operation-id <approved-operation-id>
```

执行入口不接受 endpoint 或 retry 参数；它在任何网络初始化前持久化消费当前 operation，并在进程内再次消费 authorization，随后至多完成一次 `connect → tools/list → close`。同一 authorization/operation 无论成功失败均不可重放，只允许保留有界的 `name/description/inputSchema`，不调用任何 MCP 工具、不写 Evidence/ToolCallAudit、不保留原始工具结果。计划过期、摘要/端点/状态漂移或未精确批准时必须停止并重新生成 preview。

### VariFlight Gate R-2 LOCAL preview 与受控 execute

以下命令只校验严格参数并生成本地 30 分钟计划，不连接 VariFlight、不调用工具、不修改生产 allowlist：

```powershell
npm run probe:variflight:result:preview -- --dep-city JHG --arr-city CAN --dep-date 2026-09-17
```

preview 固定报告 `externalCalls=0`、`toolCallAttempts=0`、`productionAllowlistMutations=0`。只有把该次完整计划展示给用户并取得其 exact `planId + digest + operationId` 批准后，才可运行：

```powershell
npm run probe:variflight:result -- --plan-id <approved-plan-id> --digest <approved-digest> --operation-id <approved-operation-id>
```

execute 不接受 endpoint 或 retry 参数；它先消费磁盘与进程内 one-shot authorization，再通过 ToolRegistry 固定完成至多一次 `connect → tools/list → getFlightPriceByCities → close`。只保留去值化 JSON 结构摘要，不写生产注册、Evidence、ToolCallAudit、缓存或 health。

当前 Gate R-2 已精确批准并消费一次：调用成功、retry=0，结构证据见任务目录的 `gate-r2-result-shape-evidence.json`；该 Gate 的 `resultSchema=NOT_RUN`、`contractStatus=UNPROVEN`。Phase C LOCAL 已据此实现 strict 单 text envelope、只允许已观测键/类型的 raw Schema 与 `LOCAL_STRUCTURE_ONLY` normalized Schema；未证明的时间、价格、币种、经停与 RouteLeg 语义保持 `null`。生产 allowlist 仍为空，该三元组不可重放，本地合同也不能作为航班号、价格或库存验收。

### VariFlight Gate R-3 LOCAL 入口

R-3 去值化分类器、独立 one-shot Gate 与 ToolRegistry-bound runner 已完成 LOCAL 测试。以下 preview 命令只有在用户另行明确授权后才可运行；它只生成 30 分钟本地计划，不连接 VariFlight：

```powershell
npm run probe:variflight:semantics:preview -- --dep-city JHG --arr-city CAN --dep-date 2026-09-17
```

fresh Gate R-3 已经 exact approval 消费一次，不可重放。`gate-r3-value-semantics-evidence.json` 只保留路径、布尔、枚举和计数：请求绑定与日期格式/关系一致，但时间单位/时区、币种/金额单位、起价、库存、stop/share 与 code 映射仍为 `UNPROVEN`。生产 allowlist 继续为空；生产结果契约与路线接入需独立审定。

下一阶段的非执行范围见 `phase-d-semantic-authority-proposal.md`：推荐先取得官方字段定义，再 LOCAL 实现 semantic authority manifest 与 production-admissibility evaluator。该提案不授权 provider 调用、生产注册或路线接入。

OQ-VF-002 的 authority-first 与资料上限结论继续作为 VariFlight 历史边界：安装附件仅为 reference-only，旧 SSE 与当前官方 streamable HTTP 端点冲突，不能迁移旧 Gate。RollingGo Flight 下线后，用户另行选择 FlyAI 作为仅本人研究的本地航班参考；人工 M0 航班证据仍永久保留，FlyAI 的 preview、LIVE 结构探针与生产/路线接入分别需要后续独立批准。

### FlyAI Phase A LOCAL

当前 build 只具备本地安全基础，不会自动启动 FlyAI。依赖固定为 `@fly-ai/flyai-cli@1.0.16`；Main 在任何未来执行前校验 package/integrity/bin/bundle hash/path，使用 `utilityProcess.fork` 创建至多一个隔离 CLI 进程，应用重试为 0，CLI 内部 provider request/retry 记为 `UNKNOWN`。15 秒超时、1 MiB stdout、8 KiB stderr、kill + exit 等待与严格单行 JSON/去值化摘要均在本地 fake tests 覆盖。供应方 bundle 内置 credential fallback/x-ff-ctx 的风险已记录；应用必须从 safeStorage 取得用户 `FLYAI` Key 并显式覆盖环境，缺 Key 在 fork 前失败。

`flyai-cli-stderr-classifier/v2` 只输出固定无值类别，区分 HTTP 451、其余 4xx、5xx、SSE no-body 与 CLI usage 等形态；首个 `Body:` 起的内容不参与分类。未来新 preview 使用 `flyai-flight-gate/v3` 并绑定 classifier v2；历史 v1/v2 artifact 可审计但不可执行。

以下命令只检查 packaged bundle 路径、regular-file、version/integrity/hash，不 require/import/执行 bundle，也不读取凭据或生成 Gate：

```powershell
npm run build:unpack
npm run smoke:flyai:path:packaged
```

Gate preview 命令已经实现，但**当前没有可执行 preview**；此前 Gate v2 已消费且不可重放。只有用户另行明确授权生成 fresh Gate v3 zero-call preview 后，才可执行：

```powershell
npm run probe:flyai:flight:preview -- --origin 西双版纳 --destination 广州 --dep-date 2026-09-17
```

preview 只生成 30 分钟计划并固定 `externalCalls=0`、`cliProcessAttempts=0`；必须展示完整 `planId + digest + operationId`、exact args、单个 CLI 进程与内部计数 `UNKNOWN`。随后仍需用户对当前三元组另行 exact approval，才能运行一次 `npm run probe:flyai:flight -- --plan-id ... --digest ... --operation-id ...`。执行成功也只保留去值化 JSON 结构，不写生产 source、audit、Evidence、DB/cache/health、Claim、RouteLeg 或 UI；失败后 Gate 不可重放。

本地 UI smoke 不调用外部服务：

```powershell
npm run smoke:d3-ui
npm run smoke:d4-render
npm run smoke:d4-ui
npm run smoke:d5-render
npm run smoke:d5-ui
npm run smoke:route-d5-render
npm run smoke:route-d5-ui:no-gpu
npm run smoke:itinerary-route-ui:no-gpu
npm run smoke:d6-render
npm run smoke:d6-ui:no-gpu
npm run smoke:d7-render
npm run smoke:d7-ui:no-gpu
npm run verify:d7-exports
```

D4 的可移植渲染门禁、Electron 冒烟，以及 D5 的事件回放、静态 Renderer 与隔离 Electron no-gpu smoke 都只使用本地夹具；D5 还断言 `model_calls=0` 与 `externalCalls=0`。2026-08-29 经精确授权，Rail `get-tickets`、Map `maps_distance` 与 Hotel `searchHotels` 的 D5 只读结果契约已分别完成结构诊断；同日固定离线 Stage A 两次真实 `get-tickets` 成功，独立 Stage B 串行完成 `maps_geo×4`、`maps_distance×4`、`searchHotels×1`，9/9 成功、零重试且未保留原始响应。这些已消费的授权不覆盖后续任意真实行程查询。新的 Rail、酒店、Serper、DeepSeek、地图或小红书调用，以及小红书伴随程序下载、启动与登录，仍需用户针对具体动作另行授权，不能由本地门禁替代。

SKELETON 视图不再要求手工填写来源 JSON。Stage A 从已确认的出发城市、目的城市与固定日期生成 Rail 查询预览；一次授权按需以固定离线包启动一个临时 Rail session，以 60 秒预算连接，再以独立 15 秒预算串行执行两次 `get-tickets`，无重试并在结束后关闭，用户随后选择往返车次。connect 失败只保留白名单诊断类别，不保留 stderr、命令或路径。Stage B 只接收一次精确出发地址，由主进程派生地理编码缺口、四段接驳坐标/时刻，以及住宿 `place/checkInDate/stayNights/adultCount`，展示完整调用清单后再单独授权。执行 IPC 只回传 `planId + digest`，精确地址不会进入响应、Evidence、JSONL、SQLite 或审计。旧 `sourceParameters` 仍保留为兼容入口，但 Renderer 不再暴露它。

2026-08-29 同一实际 Coordinator 会话连续完成 Stage A 与 Stage B：固定离线 Rail `get-tickets×2` 选择 G1974/G239，随后执行 `maps_geo×4`、`maps_distance×4`、`searchHotels×1`。11/11 外部调用成功、零重试，生成 2 条铁路、4 条接驳和 5 条酒店候选 Claim；精确地址、原始响应和工具参数明文均未持久化，退出后无残留查询进程。临时验收脚本在全部调用后因错误期待本地 Rail 物化写额外审计而事后退出，SQLite/JSONL 证明确认产品调用与产物完整，BUILD-D5 因此收口。

BUILD-D6 于 2026-08-29 完成 LOCAL 验收：format、lint、双端 typecheck、105/105 自动测试、生产构建和 Electron no-gpu smoke 通过。四日夹具验证普通/车站缓冲、跨午夜、每日 BACKUP、两次发布与旧版本只读、未核验 HARD_LOCKED 阻塞、取消无 partial、快照/JSONL 重建，`externalCalls=0`、`modelCalls=0`。这不等于真实地图 ETA 或餐厅营业/绕路信息已验收；任何实源调用仍需新的参数级精确授权。

BUILD-D7 于 2026-08-29 完成 LOCAL 验收：115/115 自动测试、D7 renderer/Electron no-gpu smoke、ICS/Markdown/诊断秘密扫描、删除 SQLite 后 JSONL 重建、production/unpacked/packaged smoke 与 x64 NSIS 构建通过；所有 D7 自动流程均记录 `externalCalls=0`、`modelCalls=0`、`irreversibleActions=0`。安装器未执行且 Authenticode 状态为 `NotSigned`；真实天气/闭园/预约规则刷新和真实下一趟旅行仍需另行精确授权，R0 尚未退出。

2026-08-30 固定目的地 STAGE-2→STAGE-3 显式确认修复完成 LOCAL 验收：126/126 自动测试、format/lint/双端 typecheck、production build、D4/D5 renderer 与 Electron no-gpu smoke 通过；`stage/confirmed.confirmation` 为可选加法字段，旧事件与模糊候选路径兼容。`externalCalls=0`、`modelCalls=0`、`irreversibleActions=0`，NEXT-017 Stage A/B 未执行。

2026-08-30 D4 小红书 30 帖严格通路完成 LOCAL 实现：135/135 自动测试、format/lint、双端 typecheck、production build、D4/D5 renderer 与 Electron no-gpu smoke 通过；测试覆盖 4+30、15/15、首个详情失败零重试、6+1 no-repair、确定性排序与别名/歧义边界、preview 零调用、单事件 final Claims/checklist 回放和 ranking UI。真实 XHS/模型调用、伴随程序操作、安装器与真实旅行验收均未执行。

2026-08-30 XHS 响应形态零调用诊断完成 LOCAL 实现：只在现有 30 帖单 session 的 `search_feeds` / `get_feed_detail` schema drift 分支，把最多 2,048 字符、仅含节点类型与受限结构键的指纹写入安全日志 `keys`；疑似动态 ID/高熵键被占位，遍历异常也不会覆盖主 `SOURCE_DRIFT`。原 `missing`、立即降级、零重试、零 partial Claim、事件/状态不推进保持不变。34/34 定向与 144/144 全量测试、format/lint、双端 typecheck、production build、D4 Electron no-gpu smoke 均通过，`externalCalls=0`、`modelCalls=0`、`irreversibleActions=0`。该 LOCAL 任务完成时真实 XHS envelope 仍未知，前三份历史 digest 均不可复用；后续第四份 LIVE 结果见下段。

2026-08-30 第四份 D4 XHS 计划经精确批准后只执行一次：首个 `search_feeds` 在 60,021 ms 返回 `MCP_TIMEOUT`，新增一条失败审计后立即停止。后续 3 search、30 detail 与 7 model calls 均为 0；总 `tool_calls=3`、`model_calls=0`、事件=5，session 保持 STAGE_3，实体/排序/Claims 为空。该超时没有进入结构指纹分支，不能证明真实 envelope；四份 digest 均已消费且不可重试。

随后完成的零调用诊断把本次故障域收敛到 XHS 伴随服务内部的浏览器搜索等待/页面契约不稳定：connect 与 listTools 已完成，容器无 OOM、重启或 crash 证据，而上游搜索实现会在导航稳定、`__INITIAL_STATE__` 和筛选面板条件上受 60 秒页面 deadline 约束。具体卡住的 DOM 条件没有被安全日志证明。连接、工具发现、登录与搜索能力因此必须分开判断；不得用加长超时、盲重试、静默删筛选或缩减 15/15 掩盖失败。用户已选择并完成正式人工研究路径的 LOCAL 实现；它不生成第五份 digest，也不修改或重试四份已消费的 XHS 计划。157/157 自动测试及完整本地质量门通过，真实 session 的人工填写、STAGE-3→STAGE-4 与 NEXT-017 后续验收仍未执行。

2026-08-31，云南多城市父任务完成第二个子节点：选中路线的 D4 研究现按 `routeId + nodeId` 严格隔离。大理（洱海）、丽江（玉龙雪山）和西双版纳为 required 节点，昆明是否研究由已选路线决定并可标为 `SKIPPED`；只有最后一个 required 节点确认后才原子推进到 STAGE-4。标准/XHS/人工/粘贴路径、Claims、冲突和 Gate 共用同一节点所有权校验。LOCAL 验证为 177/177 自动测试、format/lint、双端 typecheck、build、SSR 与 migration 0001–0008 校验通过；Electron default/no-gpu smoke 因宿主 GPU 进程在页面加载前退出而未通过。真实来源、模型、安装器、部署和提交均未执行。

2026-08-31，云南父任务完成第三个子节点：multi-segment D5 使用 `sessionId + routeId + legId` 或 `sessionId + routeId + nodeId + segmentId` 隔离逐段计划、选择与失败；migration 0009 投影七类 route-D5 V2 事件，SKELETON 显示 4 段交通、3 段住宿、10 天日骨架、节点内 8 km 聚类与目标日局部更新。187/187 自动测试、format/lint、双端 typecheck、production build、SSR 与 migration 校验通过，三类调用计数为 0。专用 Electron default/no-gpu smoke 都在加载页面前遇到宿主 GPU `-1073741515/ERR_FAILED`，未声明通过。

2026-08-31，云南父任务第四个子节点 unified D6/D7 完成 LOCAL：选中 Route-D5 的身份贯通 TimelineVersion、TimelineItem、task、GATE_C 与整程导出，migration 0010 只为 disposable SQLite timeline/task 投影增加 nullable route scope。普通日与 transfer day 保留同日多腿、checkout/check-in、10/30 分钟缓冲、每日 BACKUP 与 MUST 锚；D6/D7 Renderer 显示路线标签并丢弃迟到 session 响应，CSS 覆盖 820/320。191/191 自动测试、format/lint、双端 typecheck、production build 与导出秘密扫描通过，三类调用计数为 0；统一 Electron default/no-gpu smoke 仍在页面加载前遭同一宿主 GPU 失败，未声明交互通过。

2026-08-31，云南 route-core 交通证据恢复完成 LOCAL：multi-city gateway/place 分离，`itinerary-route:manual-evidence-apply` 以 Main 派生端点/日期/scope 的方式生成 deterministic `USER_RESEARCH / VERIFIED_BY_USER` routeLeg Claim，并在一个 V2 事件内保留 source outcomes、重算 candidates/blockers；重复事实零写，删除 SQLite 后可从未改写 JSONL 经 migrations 0001–0010 等价恢复，无 migration 0011。197/197 自动测试、format/lint、双端 typecheck 与 production build 通过。标准 Electron sandbox 仍因 managed host 的 renderer/GPU 子进程在页面加载前退出而未通过；同机 `--no-sandbox --disable-gpu` 专用 fake-session smoke 已覆盖 blocked、人工补证、session 切换、320 px 与最终单一推荐并通过。全程 `externalCalls=0`、`modelCalls=0`、`irreversibleActions=0`；真实 session、LIVE 来源与安装器仍未执行。

Windows 打包：

```powershell
npm run build:unpack
npm run smoke:d7-packaged
npm run build:win
npm run verify:d7-package
```

`electron-builder.yml` 使用正向白名单：`app.asar` 仅包含 `out/**`、`package.json` 与生产依赖；测试、源码文档、`.tmp`、MCP 开发 `.venv`、用户数据库、JSONL、日志和凭据配置不进产物。当前安装包只生成 Windows x64 NSIS，不自动执行、签名、发布或上传。

## 文档入口

- [产品与实施状态](./TODO.md)
- [系统架构](./ARCHITECTURE.md)
- [数据模型](./DATA_MODEL.md)
- [错误与降级](./ERROR_HANDLING.md)
- [性能与配额](./PERFORMANCE.md)
- [兼容与迁移](./MIGRATION.md)
- [术语表](./GLOSSARY.md)
- [协作规则](./COLLABORATION.md)
- [第三方复用声明](./THIRD_PARTY_NOTICES.md)
- [权威产品契约](./intelligent-travel-agent-prd-v1.1.xml)
- [FlyAI / VariFlight 航班任务与 Gate 边界](./.trellis/tasks/09-01-variflight-mcp-flight-query/implement.md)
