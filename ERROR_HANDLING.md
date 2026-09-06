# ERROR_HANDLING & OBSERVABILITY

错误分类、错误码表、降级规则、日志规范与 Inspector 埋点。

原则：**这是个单人自用的本地应用，没有告警系统，唯一的"监控"是开发者本人和 Inspector 面板。** 所以本文件的重点不是分级告警，而是**让失败在第一时间以可读的方式暴露出来**——这个项目最大的风险是静默失败（Cordis 依赖未就绪不打日志、SQLite 直写被重建抹掉、cordis v4 的 dispose 永不触发）。

---

## 1. 错误分类

跨 IPC 的稳定分类固定为五类，全部来自 `ErrorClassSchema`：

| 类 | 特征 | 处理 | 用户可见 |
| --- | --- | --- | --- |
| **INTERNAL** | 服务未注册、内部 schema 不一致、事件断言失败、凭据容器不可读 | **立刻抛，不要兜底**。开发期崩掉比带病运行好 | 固定错误码与可操作提示 |
| **SOURCE** | MCP、地图、酒店、搜索等只读数据源失败 | 按 §3 的 Source 规则降级或快速失败 | 顶部降级横幅，说明“缺什么” |
| **MODEL** | 模型渠道未配置、鉴权、超时或输出失败 | 停止当前模型步骤；不自动切换渠道 | 显示对应固定提示 |
| **INPUT** | 用户输入不合法或超出包络 | 返回可操作的提示 | 就地提示或方案对比卡 |
| **GATE** | 证据或任务条件不足以推进 | 停在当前阶段，列出**具体缺哪几条** | 阶段推进按钮禁用 + 缺项清单 |

**INTERNAL 类禁止兜底。** 看到 `catch (e) { return defaultValue }` 就是引入静默失败。唯一例外是渲染进程的顶层 ErrorBoundary（防止白屏）。

---

## 2. 错误码

格式 `域_原因`，SCREAMING_SNAKE，全部枚举在 `src/shared/errors.ts`。**错误码是稳定契约**，改名要同步改文档；新增只允许追加。

```ts
export type ErrorClass = 'INPUT' | 'GATE' | 'MODEL' | 'SOURCE' | 'INTERNAL'

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    options?: {
      klass?: ErrorClass,
      userHint?: string,
      cause?: unknown,
    },
  ) { super(message) }

  readonly klass: ErrorClass
  readonly userHint: string
}
```

| 错误码 | 类 | 何时抛 | userHint 要点 |
| --- | --- | --- | --- |
| `INTERNAL_SERVICE_NOT_READY` | INTERNAL | bootstrap 自检发现 ctx key 缺失 | 报缺失服务并停止启动 |
| `INTERNAL_INVARIANT_VIOLATED` | INTERNAL | 断言失败、幂等内容冲突 | 停止写入并报告错误码 |
| `INTERNAL_SCHEMA_MISMATCH` | INTERNAL | 本机配置或内部数据过不了自身 Schema | 清除或重新配置，不发外部请求 |
| `INTERNAL_ERROR` | INTERNAL | 未识别异常的最终封装 | 操作失败，查看本机日志 |
| `EVENT_INVALID` / `EVENT_SEQUENCE_GAP` / `EVENT_LOG_CORRUPT` | INTERNAL | 事件非法、seq 不连续或 JSONL 中间损坏 | 停止重放/写入并报告具体错误码 |
| `IPC_FORBIDDEN` | INTERNAL | 非主窗口 sender 调用受保护 IPC | 拒绝调用，不泄漏数据 |
| `CRED_UNAVAILABLE` / `CRED_DECRYPT_FAILED` | INTERNAL | safeStorage 不可用或密文无法解开 | 不发请求；提示重新录入 |
| `SOURCE_UNCONFIGURED` | SOURCE | 该 source 未录入凭据/配置，或固定离线运行时未预灌 | 去设置页配置对应来源，或完成明确的本地运行时安装 |
| `SOURCE_UNREACHABLE` / `SOURCE_CANCELLED` | SOURCE | 连接失败、超时或用户取消 | 说明能力影响；取消不计入降级 |
| `SOURCE_DRIFT` | SOURCE | 返回值 Zod 校验失败 | 数据格式已变化，本轮改用手工输入 |
| `SOURCE_ADAPTER_DEGRADED` | SOURCE | 连续失败或单次结构漂移触发降级 | 显示能力影响和人工替代 |
| `SOURCE_RATE_LIMITED` / `SOURCE_QUOTA_EXHAUSTED` | SOURCE | 本地令牌桶、对方限流或月度熔断 | 提示稍后重试或本月停用 |
| `MCP_TIMEOUT` / `MCP_PROTOCOL_ERROR` / `MCP_SCHEMA_INVALID` / `MCP_TOOL_ERROR` | SOURCE | MCP 传输、协议、Schema 或工具错误 | 使用固定脱敏提示，不展示原文 |
| `NOT_IN_ALLOWLIST` / `WRITE_KEYWORD_HIT` | INTERNAL | 工具注册被白名单或写语义门拒绝 | 只进 Inspector 审计，不执行工具 |
| `PROVIDER_UNCONFIGURED` | MODEL | 尚未保存四角色模型路由 | 去设置页配置渠道与模型 |
| `MODEL_TIMEOUT` | MODEL | 网络不可达、Abort 或 HTTP 408 | 检查网络后由用户重新发起；系统不自动重试 |
| `MODEL_OUTPUT_INVALID` | MODEL | 输出 Schema 失败，或渠道返回配置、限流、额度、上游、非 JSON 等安全分类 | 使用对应固定提示；不得展示上游正文 |
| `MODEL_UNAUTHORIZED` | MODEL | 缺少所选渠道凭据，或 HTTP 401/403 | 去设置页重新录入或检查供应商策略 |
| `INPUT_OUT_OF_ENVELOPE` / `INPUT_INVALID` | INPUT | 超出 M0-ENVELOPE 或通用输入校验失败 | 提供方案对比或指出具体字段 |
| `GATE_BLOCKED` | GATE | Gate 未通过 | 列出缺失证据项 |

Rail stdio connect 不新增跨 IPC 错误码。`PACKAGE_CACHE_MISS/SPAWN_FAILED` 对外映射 `SOURCE_UNCONFIGURED`，`INITIALIZE_TIMEOUT` 映射 `MCP_TIMEOUT`，提前退出、无效协议与未知连接失败映射 `MCP_PROTOCOL_ERROR`。这些类别只允许进入 main-process 日志的 `errorCode` 白名单字段；stderr 原文、命令、参数、环境、路径、PID 与退出码不得保留。

XHS 内置 sidecar 同样不新增跨 IPC 错误码。资源缺失、manifest/大小/SHA-256/realpath 不匹配映射 `SOURCE_UNCONFIGURED`；固定 `127.0.0.1:18061` 已被占用映射 `SOURCE_UNREACHABLE`；启动/提前退出/HTTP 协议失败映射 `MCP_PROTOCOL_ERROR`；Chromium 首次准备超时映射 `MCP_TIMEOUT`。Renderer 只收到固定 userHint；二进制路径、端口探测细节、进程/PID、AUTH_TOKEN、cookies、环境、stdout/stderr 与原始 MCP 正文不得进入 IPC、日志、审计或诊断。取消、过期、成功和应用退出都走同一确定性停止路径，取消不计入来源降级。

### 跨 IPC 传递

`Error` 实例过不了结构化克隆，跨 IPC 会退化成 `{}`。**所有 IPC handler 必须包一层**：

```ts
// src/main/ipc/wrap.ts
export async function asIpcResult<T>(operation: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, data: await operation() }
  } catch (error) {
    return { ok: false, error: serializeError(error) }
  }
}
```

`serialize` **只输出 `code` / `klass` / `userHint`**，不输出 `message`、`cause`、`stack`——技术细节留在主进程日志里，避免把内部路径或参数泄到渲染层。

---

## 3. 降级规则

### 模型调用（与 Source 重试分开）

`ProviderRuntime` 的一次 `invokeRaw()` 只允许一次网络请求。网关不得自动重试、fallback、切换渠道、模型或分组：

| 条件 | 内部安全分类 | 对外稳定错误 |
| --- | --- | --- |
| 401 | `UNAUTHORIZED` | `MODEL_UNAUTHORIZED` |
| 403 | `POLICY_DENIED` | `MODEL_UNAUTHORIZED` |
| 408、Abort、网络不可达 | `TIMEOUT` | `MODEL_TIMEOUT` |
| 404 | `CONFIGURATION` | `MODEL_OUTPUT_INVALID` |
| 413 | `INPUT_REJECTED` | `MODEL_OUTPUT_INVALID` |
| 429 `rate_limit_exceeded` | `RATE_LIMITED` | `MODEL_OUTPUT_INVALID`，固定限流提示 |
| 429 `insufficient_quota` | `QUOTA_EXHAUSTED` | `MODEL_OUTPUT_INVALID`，固定额度提示 |
| 500 / 502 / 503 | `UPSTREAM_UNAVAILABLE` | `MODEL_OUTPUT_INVALID` |
| 非 JSON、响应 Schema 漂移、其他状态 | `INVALID_RESPONSE` | `MODEL_OUTPUT_INVALID` |

分类只读取受限的 `code` 字段用于区分两类 429，不保留错误字段值、响应正文或未知结构。模型结构化输出第一次校验失败时，`invokeStructured()` 可以发起一次显式 Schema 修复；这是第二次独立模型调用并写第二条 `model_calls`，不是网络重试。第二次仍失败才把该步骤标为 `BLOCKED`。

### 单次调用

```
调用 → 超时(默认 15s) 或 网络错误
  → 来源专属契约允许时重试 1 次（指数退避 1s）
  → 仍失败 → fail_streak += 1，抛 SOURCE_UNREACHABLE
```

只读不自动等于可重试。D3 Search/XHS、D5 Rail 往返发现、结构/真实验收 one-shot 路径均由各自冻结契约明确禁止重试；其中 D5 Rail 的 connect、listTools、出程与返程任何阶段失败都立即停止。

Settings 小红书登录的 `get_login_qrcode` 同样是 one-shot：非 PNG、非法 base64、解码后超过 512 KiB、content block 数量/类型错误或未知顶层字段统一按 `SOURCE_DRIFT` 失败关闭，Renderer 只收到固定安全提示。登录状态检查串行且不重叠；取消、离开、5 分钟过期或任一检查失败都会停止后续检查并清除内存二维码，不重放二维码工具，也不记录提示文本、图片、data URL 或原始 MCP envelope。

Zod 校验失败**不重试**——重试一次结构也不会变。直接抛 `SOURCE_DRIFT` 并把原始返回值的**结构摘要**（键路径列表，不含值）写进日志，这是排查来源契约漂移时唯一有用的东西。D4 XHS 单 session 严格路径只在既有 `search_feeds` / `get_feed_detail` 失败分支，对已返回的 MCP envelope 与 `content[0].text` JSON 生成一个最多 2,048 字符的确定性结构指纹：对象键稳定排序且只允许短 ASCII identifier，疑似动态 ID/高熵键使用固定占位符，数组只观察首元素类型，深度、节点数与每对象键数均硬截断；循环安全标记，getter/proxy 或遍历异常收敛为固定无值指纹且不得覆盖主 `SOURCE_DRIFT`。该指纹只进入日志 allowlist 的 `keys`，不得包含标量值、长度、raw text、hash、feed ID、token、标题、正文、评论、凭据或完整参数，也不得进入审计、SQLite、JSONL、IPC、Inspector 或导出。成功路径和其他来源不写此字段，schema、降级、零重试、零 partial Claim 与事件/状态边界均不变。

### source 级降级

两条独立的触发路径，**不要合并成一个计数器**：

| 触发 | 条件 | 依据 |
| --- | --- | --- |
| 连续失败 | `fail_streak >= 2`（连接/超时类） | `PRD:MCP-HEALTH` |
| **结构漂移** | **单次 Zod 校验失败即降级**，不进 fail_streak 计数 | `PRD:AC-M0-09` |

漂移之所以一次就降级，是因为它意味着上游结构变了，重试多少次都一样；而超时可能只是网络抖动。**按 fail_streak 计漂移会直接挂掉 AC-M0-09。**

降级即 `source_health.status = 'DEGRADED'`，之后 5 分钟内该 source 的调用直接快速失败，不再发请求。任意一次成功即 `fail_streak = 0` 并恢复 `OK`。

注意重试会放大 streak 的实际请求数：阈值 2 配上"每次失败重试 1 次"，意味着 4 次真实请求后才降级。这是刻意的余量。

**降级后必须做的两件事**（`PRD:MCP-HEALTH`）：

1. 顶部横幅告诉用户**具体缺什么能力**，不是"服务异常"。例：「12306 数据源不可用，车次时刻需要你手工粘贴」。
2. 该来源本应提供的字段一律标 `UNVERIFIED` 或留空，**禁止用模型知识填充冒充**。这是 neverCut 里的可追溯性红线。

### FlyAI CLI Phase A LOCAL

FlyAI 只存在于 Gate-bound、Main-only UtilityProcess 诊断入口，不进入生产 SourceAdapter 健康/重试链。package/bin/integrity/bundle/path 或 launcher/hash/path 漂移统一 `SOURCE_DRIFT`；缺加密凭据为 `SOURCE_UNCONFIGURED`；strict 输入失败为 `INPUT_INVALID`；Gate 过期、尚未生效、tuple 不匹配、并发或重放为 `GATE_BLOCKED`/`INPUT_INVALID`；fork/pipe/fatal/非零退出/非单行 JSON 为 `MCP_PROTOCOL_ERROR`、`MCP_TOOL_ERROR` 或 `SOURCE_DRIFT`；15 秒超时为 `MCP_TIMEOUT`，取消为 `SOURCE_CANCELLED`。所有分支 fail closed、应用不重试，若进程已尝试则必须 terminate 并等待 exit；残留 PID 升级为 `INTERNAL_INVARIANT_VIOLATED`。开发脚本必须用 `electron . -- --probe-flyai-flight-once` 分隔 Electron 与应用参数，缺少分隔符导致的 Main 前退出不能归因于 provider。UtilityProcess 下 Commander 从 argv[1] 读取命令，因此只能 fork 已绑定 launcher；launcher 参数非法或无法加载已绑定 bundle 均不得回退为直接 fork、shell 或 PATH 调用。

非零退出仍统一使用 `MCP_TOOL_ERROR`，但 runner 可在内存中读取最多 8 KiB stderr。`flyai-cli-stderr-classifier/v2` 仅按固定供应方前缀归一为 `HTTP_401`、`HTTP_403`、`HTTP_429`、`HTTP_451_RISK_CONTROL`、`HTTP_OTHER_4XX`、`HTTP_5XX`、`CLI_USAGE_ERROR`、`JSON_RPC_ERROR`、`NETWORK_ERROR`、`INVALID_RESPONSE` 或 `UNKNOWN`；未落入 4xx/5xx 的其他 `MCP HTTP nnn` 归 `INVALID_RESPONSE`。首个 `Body:` 起的内容不参与分类，对外只允许 `failureCategory` 枚举；stderr 原文、HTTP body、JSON-RPC message、stack、URL、header 与 Key 不得进入日志、artifact、IPC 或错误 cause，并在分类后清空内存缓冲。`HTTP_451_RISK_CONTROL` 只说明匹配固定 HTTP 451 形态，不证明服务器实际判因；无分类证据时必须返回 `UNKNOWN`，不得根据退出耗时猜测鉴权或网络原因。

FlyAI 的 HOME/USERPROFILE 继续按操作隔离。为了避免 CLI 每次随机生成新的 `x-ff-ctx` 设备身份，Main 在 fork 前创建或读取应用专属 `<userData>/flyai-runtime/device-id` UUID 种子，再只把该种子复制到 sandbox `.flyai/device-id`；不得复用真实用户 HOME，也不得持久化 FlyAI config 或凭据。种子缺失可原子创建，非普通文件、损坏或无法读取统一在 fork 前返回 `INTERNAL_INVARIANT_VIOLATED`，因此 `cliProcessAttempts=0`。

Windows 释放 UtilityProcess 工作目录可能晚于 exit 事件。sandbox 删除允许 `fs.rm` 的有界本地重试；该重试不增加 `cliProcessAttempts`，也不代表 provider retry。删除仍失败时固定抛 `INTERNAL_INVARIANT_VIOLATED` 并保留原始错误仅作 Main 内 cause；未知异常统一通过 `serializeError` 映射为 `INTERNAL_ERROR`。不得输出未进入 `ErrorCode` 契约的 `PROBE_FAILED`，也不得让 cleanup 原始路径、错误正文或 stack 覆盖安全分类。

审计只把一次 CLI 进程记为 `cliProcessAttempts=0|1`；CLI 内部 provider request/retry 无法观测，必须显式记 `UNKNOWN`，不得猜成 1 或 0。成功只返回去值化结构摘要，失败也不得泄露 Key、env、stdout/stderr、provider URL/正文或业务值。Phase A LOCAL、packaged path-only smoke、VariFlight 历史 R-1/R-2/R-3 都不能生成航班事实；任何自动证据不足时保持 RouteLeg `UNKNOWN` 并继续使用明确的 `USER_RESEARCH / VERIFIED_BY_USER` 人工航班入口。

### D4 研究失败与确认阻塞

selected-route D4 默认由 `SRC_XHS` 的 XHS_STRICT 计划获取节点事实；legacy single-destination 的 Source Subagent 仍可串行使用 `SRC_SEARCH`、`SRC_MAP` 与可选 `SRC_XHS`。逐源结果彼此独立。任一来源失败时，把原始 `AppError.code`、`capabilityImpact` 与 `manualAlternative` 写入 `sourceResearchFailures` 并继续展示已有证据；XHS 失败还保留 `POSITIVE_LOCATION` / `NEGATIVE_AVOIDANCE` 查询方向，以免两路错误在 UI 中互相覆盖。禁止静默换源、自动 fallback 或用模型常识补齐；人工降级必须由用户在看见失败/不足后显式选择。用户取消使用 `SOURCE_CANCELLED`，不增加 `fail_streak`、不触发降级，也不写空 EvidenceClaim。

`SRC_XHS` 的每路研究固定 `maxAttempts=1`。搜索成功、单条详情失败时保留已经归一化的搜索行并增加安全的 `detailFailureCount`；不得把详情失败当成理由重放搜索。伴随服务未启动或未登录时显示明确的能力影响与手工替代，不自动下载、启动、扫码或访问小红书。上游返回的 `xsec_token`、评论正文与原始错误值不进入 `sourceResearchFailures`、日志或任何 renderer payload。

D4 不新增 `EVIDENCE_CONFLICT_UNRESOLVED` 外部错误码。研究确认失败统一返回稳定的 `GATE_BLOCKED`，但 `userHint` 必须逐项列出可操作原因：研究清单为空或全部 EXCLUDE、推广内容是唯一支撑、`MUST_GO` 实体身份仍为 `AMBIGUOUS`、必去项缺少可用开放/预约硬锚点，或硬锚点冲突尚未由用户裁决。XHS-only 硬事实即使多帖一致也保持 UNKNOWN/BLOCKED；只有另行批准的独立 allowlisted 标准/官方来源，或显式人工降级中未过期且 `status=KNOWN` 的独立硬锚 Claim，才可支撑 Gate。UNKNOWN、NOT_APPLICABLE 与 STALE 都不能被“已确认”标记伪装成可用事实。原始双方 Claim 始终保持 `CONFLICTED`；用户裁决记录在 `conflictResolutions`，不能通过覆盖证据伪造“来源已一致”。

`research:user-paste` 只接受不含 userinfo 与凭据型 query 参数的 HTTPS URL；非法 URL 以 `INPUT_INVALID` 在 IPC 边界拒绝，正文与 URL 都不得进入通用日志。D4 progress 只发送 operationId、sessionId、阶段、来源和固定短消息，任何额外字段都被严格 Schema 拒绝。

`research:manual-checklist-prepare` 是显式人工结构化入口，不是 Source Subagent 的自动 fallback。Main 在写事件前一次性 strict 校验全部条目、逐项确认、来源名称、安全可选 HTTPS URL、MUST_GO 三类独立硬锚、同 session USER_PASTE 关联、重复项和至少一个非 EXCLUDE 实体；任一失败统一安全序列化为 `INPUT_INVALID` 或既有阶段/权限错误，事件、Claim、实体与 stage 都保持不变。成功只允许记录 mode、计数与 confirmedAt 等安全摘要；sourceLabel、URL、summary、硬锚值与完整 Evidence value 不得进入通用日志、progress、Inspector、诊断导出或错误 IPC。该入口不读取 URL，不调用来源/模型，也不创建 tool/model audit。

### D5 规划与骨架确认阻塞

D5 缺少成对 Rail 往返、首末 Map 接驳、坐标、完整住宿段或 Claim-backed 住宿候选时稳定返回 `GATE_BLOCKED`，`userHint` 必须指出要补的证据类型。四段顺序、总时长算术、半日 8 km 上限、日期/住宿夜覆盖或候选引用不一致时在事件追加前失败关闭，禁止把部分结果投影成成功状态。

STAGE-4 确认统一列出交通选择、两个硬锚点、骨架、住宿段、日期覆盖和地理约束缺口。`skeleton:patch` 发现目标日期、ResearchEntity 或可用坐标不存在时不得改写任何日期；成功时只更新 `changedDates` 中的行并使旧住宿候选失效。`d5:progress` 只含 operationId、sessionId、阶段和短消息，不携带 Claim 原值或完整 TravelState。

多城市 route-D5 在相同错误词表上增加完整身份门禁：每个命令必须匹配当前 `sessionId + routeId + legId` 或 `sessionId + routeId + nodeId + segmentId`。跨 scope、route/state drift、过期/replaced/重复 plan、operationId 复用或不可见 session 在任何来源调用与事件前 fail closed。单个 Hotel 失败只把目标 segment 标为 FAILED/BLOCKED；Rail/Map 关键调用失败或取消时不写半成品 final transport Claim/事件。route-D5 自动执行仍不生成航班/大巴证据；缺少端点、日期、方式与 `ROUTE_GOAL_LEG` scope 完全匹配的现有 Claim 时返回 `GATE_BLOCKED`，不得自动改成铁路或把未知时长/费用当 0。

STAGE-2 `itinerary-route:manual-evidence-apply` 是独立的受控人工写路径，不是来源 fallback。sender 未授权为 `IPC_FORBIDDEN`；未知字段、未确认、非 flight/coach、无时区 offset、倒序时刻、负费用、非 credential-free HTTPS URL 或起始本地日期不等于当前 leg 日期为 `INPUT_INVALID`；不可见 session、非 STAGE-2、缺当前 goal/route/leg、已验证 leg、mode/route/state drift 或跨 scope 为 `GATE_BLOCKED`/`INPUT_INVALID`。所有检查在写 Claim/event 前完成，失败零写、零来源、零模型；相同已验证事实重复提交幂等零写。成功只追加一个 `itinerary/route-manual-evidence-applied` V2 事件并本地重算，不触发 ToolRegistry、ProviderRuntime、source health、retry 或 URL fetch。

`route-d5:progress` 只允许 operationId、完整 scope、调用计数与固定阶段；不含地址、外部响应、Claim value 或凭据。同 scope/action 新 preview 会替换旧 pending plan，十分钟 Cordis timer 与 execute 消费路径都清除精确地址。最终 `route-d5/confirmed` 只有在全部 required leg/stay、日期/夜数、boundary anchors 与 route day skeleton 完整时才能追加，否则返回第一项可操作 blocker 且 STAGE-4 不变。

### D6 时间轴发布阻塞

D6 缺少 STAGE-5 交通/住宿选择、两个硬锚点、完整骨架、路线 ETA、每日 BACKUP 或可用 Claim 时返回 `GATE_BLOCKED`，阻塞清单必须点名条目与缺口。invalid time、跨午夜标记不一致、buffer 下限不足、orphan claim、主线冲突以及未验证 HARD_LOCKED 均在 `timeline/published` 追加前失败关闭。

prepare 只产生主进程内的短期 draft；publish 必须重新校验 basis seq 与全部 gate，不能信任 Renderer。取消、Schema drift 或任一必需事实失败时不得写 `timeline/published` 或 SQLite 半成品。`d6:progress` 只含 operationId、sessionId、固定阶段与安全短消息，不含地址、Claim 原值、sourceRef、外部正文、凭据或完整 TravelState。

### D7 任务、GATE_C 与导出失败

D7 没有 current published timeline 时返回 `GATE_BLOCKED`，不得派生空任务后伪装成功。任务更新必须复核 `expectedUpdatedAt`、current version、item/claim link；任一不一致都在追加 `task/updated` 前失败关闭。只有 `CONFIRM_EXTERNAL_RESULT` 能把 reservation/readiness 置为 DONE/READY 并生成 replacement timeline；打开链接、查看证据或渲染侧状态变化不产生事件。

GATE_C 的失败不是异常：报告 `ready=false` 并逐项列出 HIGH 任务、渠道/截止、硬锚点及天气/闭园证据缺口，再以 `gate/result` 留痕。存在 blocker 时用户提示不得包含 READY/可以出发等放行措辞。

导出内容在主进程先过 allowlist DTO 和秘密扫描。命中凭据键/值或测试哨兵时统一抛 `INTERNAL_INVARIANT_VIOLATED`，关闭并删除同目录临时文件；取消保存对话框不产生成功路径。Inspector 查询的 from/to 逆序或 limit 不在 1–500 时以 `INPUT_INVALID`/strict schema 失败，不猜测修正。

### 配额熔断

月度用量达到阈值的 **80%** 时横幅提示；达到 **95%** 时停止该桶的所有调用，抛 `SOURCE_QUOTA_EXHAUSTED`。留 5% 余量是因为高德**超额不拒绝服务而是自动扣费**（`PRD:OQ-022`），熔断必须发生在对方限流之前。

限速：全局单令牌桶，**QPS 上限 2**（高德标称 3，留一档余量）。所有高德调用串行通过该桶。

---

## 4. 日志

### 格式

JSONL 写 `<userData>/logs/app-YYYY-MM-DD.jsonl`，同时在开发模式下打印到 stdout。保留 14 天，超期删除。

```json
{"ts":"2026-08-21T10:04:11.238Z","level":"error","scope":"mcp.rail","code":"SOURCE_DRIFT","sessionId":"ses_01J...","msg":"queryTrain 返回值校验失败","ctx":{"keys":["data","list[].train_no"],"missing":["arrive_time"]}}
```

固定字段：`ts` `level` `scope` `msg`。可选：`code` `sessionId` `durationMs` `ctx`。

`level` 四档：`debug`（默认不写盘）、`info`、`warn`、`error`。

`scope` 用点号分层，与目录对应：`main.bootstrap`、`plugins.coordinator`、`mcp.rail`、`db.migrate`、`ipc.session`、`skill.s08`。

### 必须记的事件

- 每次 MCP 工具调用（进/出、耗时、ok）
- 每次模型调用（角色、模型、token、成本、耗时）
- 每次工具注册被拒（写 `blocked_tools` 表 + 日志）。PRD 第 458 行称之为 `tool/blocked` **审计事件**，但它既不在 `PRD:eventCatalog` 也不在持久化 eventType 目录里——**它不是事件，就是一条表记录加一行日志**，不要为它新增事件类型
- 每次 source 状态变化（OK ↔ DEGRADED）
- 每次 Gate 判定结果
- bootstrap 的插件装载顺序与自检结果
- dispose 时每个资源的关闭结果（**这条不能省**，孤儿 MCP 子进程只能靠它排查）

### 脱敏（硬要求）

日志、`ctx` 字段、Inspector 展示、导出包，**四处一律**不得出现：

- API Key、Bearer token、safeStorage 密文或其任何片段（含前缀后缀）
- 同行人姓名、证件号、联系方式、健康与照护信息
- 完整的工具调用参数原文（用 `args_digest`，见 DATA_MODEL §4）
- 用户对话原文（只记长度与轮次；需要看原文去 JSONL）

实现方式：统一走 `redact(obj)`，按**键名白名单**放行，不是按黑名单屏蔽。黑名单一定会漏。

```ts
const LOG_SAFE_KEYS = new Set(['sessionId','toolName','sourceId','code','durationMs',
  'ok','stage','gateId','claimId','count','keys','missing'])
```

---

## 5. 凭据的三类异常

`credentials.ts` 是唯一 import `safeStorage` 的文件，它必须区分三种失败并给不同提示（`PRD:NFR-017`）：

| 情况 | 判定 | 处理 |
| --- | --- | --- |
| **平台不可用** | `safeStorage.isEncryptionAvailable() === false` | 抛 `CRED_UNAVAILABLE`。**不降级为明文存储**，宁可不能用 |
| **密文解不开** | `decryptString` 抛错 | 抛 `CRED_DECRYPT_FAILED`，清掉该条密文，提示重新录入 |
| **未配置** | 根本没有这条记录 | 不是错误。状态 `UNCONFIGURED`，引导去设置页 |

Electron `39.8.10` 的 safeStorage API 是同步方法，但仍必须在 `app.whenReady()` 之后调用。回显永远是 `已配置 / 未配置 / 需重新录入` 三态，**不回显任何字符，连掩码前缀也不行**。密文只允许存在于 `<userData>/credentials.json` 的 version 1 base64 字段中，并以临时文件 flush 后原子替换；任何导出与诊断必须排除该文件。

关于安全边界的表述纪律：Windows 上 safeStorage 背后是 DPAPI，**只防同机其他 Windows 用户，不防同一用户下的其他进程**。UI 文案与文档一律写"已加密存储在本机，不随导出包外流"，**禁止写成"防止恶意软件读取"**。

---

## 6. Inspector 埋点

Inspector 是本项目唯一的可观测面板（`PRD:ARCH-001` 的 InspectorService），它必须能回答这五个问题。写代码时**先确认埋点齐了再写视图**。

| 问题 | 数据来源 | 面板区块 |
| --- | --- | --- |
| 这条信息哪来的？ | `evidence_claims` + `source_ref` | 证据溯源，从行程项反查 |
| 刚才发生了哪些状态事件？ | `events.jsonl` | 按会话/时间过滤的 eventId、seq、type、actor、createdAt；不含 payload |
| 刚才调了哪些外部工具？ | `tool_calls` | 调用时间轴，含 argsDigest、耗时与失败 |
| 哪些工具被拒了、为什么？ | `blocked_tools` | 白名单审计（`PRD:AC-M0-08`） |
| 花了多少钱？ | `model_calls` | 按会话/时间过滤的角色、渠道、模型、token、成本与耗时 |
| 现在哪个数据源是坏的？ | `source_health` | 健康状态灯 |

三条实现约束：

- Inspector **只读**。它订阅事件与查表，任何情况下不得写入或触发外部调用。
- 面板对用户全程可见，不是隐藏的调试模式。可追溯性是产品特性不是开发工具。
- 成本数字实时推送（`push:cost-updated`），因为"跑一次要花多少钱"是自用场景里最会被反复看的数。
- Inspector 与诊断导出只使用安全摘要：禁止 event payload、tool args/response、Evidence value/sourceRef、basics 个人信息、credentials 或日志正文。

---

## 7. 开发期的静默失败清单

这个项目已知的、会**不报错也不打日志**的坑。每条都配了强制的显式检查：

| 坑 | 强制检查 |
| --- | --- |
| Cordis 插件依赖未就绪，停在等待且无日志 | bootstrap 自检八个 ctx key，缺则抛 `INTERNAL_SERVICE_NOT_READY` |
| cordis v4 上 `ctx.on('dispose')` 永不触发 | 启动时断言 cordis 版本以 `3.` 开头，否则抛 |
| `interface Events` 漏类型参数导致声明合并不生效 | tsc 会把事件名推成 `never`，开 `strict` 即可暴露 |
| 直接写 SQLite，被下次重建静默抹掉 | 仓储层写方法全部私有，只允许 `TravelStateService.apply` 调用 |
| reducer 中途 return，状态停在半路 | 重建后校验最终 seq == JSONL 末行 seq |
| `setInterval` 不被 Cordis 回收 | ESLint 禁用 `setInterval`/`setTimeout`，只许 `ctx.interval`/`ctx.timeout` |
| MCP 子进程变孤儿 | `before-quit` 必须 await dispose；dispose 每个资源都打日志 |
| FlyAI 在 bundle/凭据阶段失败却误报已启动进程，或失败后遗留 UtilityProcess | 在 `executor.fork` 边界记录唯一 0→1 attempt；所有终止路径等待 exit 并断言 PID 消失；sandbox 删除使用有界本地重试并将耗尽归类为 `INTERNAL_INVARIANT_VIOLATED` |
| Electron 把 FlyAI execute 参数误当成自身开关，或顶层输出 `PROBE_FAILED` | package script 固定 `electron . -- --probe-flyai-flight-once`；execute 顶层只输出 `serializeError` 产生的稳定 `ErrorCode` |
| FlyAI 每次临时 HOME 生成不同设备身份，或非零退出只剩笼统错误 | 持久化应用专属非敏感 device-id 种子并复制进临时 HOME；stderr 仅在内存中归一为固定 `failureCategory` 后清空，禁止输出 provider 原文 |
| FlyAI `exit` 边界的尾随 stderr 被过早移除监听，重新退化为 UNKNOWN | stderr data 监听只延后到既有 exit 微任务结算点清理；仍受 8 KiB 上限、`Body:` 截断和分类后清零约束 |
| FlyAI UtilityProcess 让 bundle 路径占据 Commander 的 argv[1]，使 `--origin` 误报 CLI_USAGE_ERROR | 只 fork 受 hash/realpath 绑定的 launcher，由其移除 launcher/target 模块槽并把 `search-flight` 归一到 argv[1]；Gate v4 同时绑定 launcher 文件/路径摘要与 argv 契约 |
| 把 VariFlight 历史结构/格式证据或 FlyAI LOCAL 结构摘要当作 LIVE 航班值 | 生产 `SRC_FLIGHT` 保持空注册；只有独立 approved Gate 的安全结果可进入后续评审，人工事实必须标 `VERIFIED_BY_USER` |
| 外键约束形同虚设 | 打开连接后立刻 `PRAGMA foreign_keys = ON` 并读回校验 |

---

## 8. D4 30 帖严格失败语义（PRD:FR-309）

此通路覆盖通用“结构化输出可修复一次”的规则：六次 EXTRACTION 与一次 REVIEW 全部传 `repairInvalid=false`，首个非法 JSON、schema mismatch、批次遗漏/重复/未知 Claim、跨 session/目的地或 REVIEW ID 不完整均返回 `MODEL_OUTPUT_INVALID`，不发修复调用、不重试、不换 Provider。

四个查询任一失败、推荐/避雷任一组不足 15、任一详情失败或 noteId 漂移都整批 fail closed；不跨组补足、不缩样本、不换帖、不保留 partial ranking。取消、plan 过期、digest/state/provider route 变化同样要求重新预览与重新授权。

来源正文 Claims 可在模型阶段失败前已作为可追溯来源留存；但 final Claims、ranking、checklist 与 stage 必须全部缺席。七次模型全部成功后，final Claims 与 checklist 通过一个事件原子追加。安全错误只返回稳定 code/userHint，不附 token、query raw result、评论、prompt 或内部 stack。

---

## 9. node-scoped D4 的失败边界

所有 routeResearch 命令在任何事件、Claim 或 projection 写入前校验 visible session、当前选中 route、节点存在且 required、状态允许以及所有嵌套 scope 相等。跨 route/node 的 entityId、claimId、USER_PASTE、conflict 或 disposition 均 fail closed；stale preview、digest/state drift、重复 operation 与取消继续保持零 final 写入。

单个节点的来源或模型失败不得污染相邻节点，也不得将该节点标为 CONFIRMED。昆明被路线省略时是合法 `SKIPPED`，对它执行研究则返回安全业务错误。只有最终 required 节点确认事件可携带 stage transition；任何提前推进或重复确认都被 reducer 拒绝。

Electron default/no-gpu smoke 若在页面加载前以宿主 GPU 进程错误退出，只能记录为环境验证失败；不得用 SSR/build 结果替代并宣称 Electron 通过。该环境错误不会授权重装、修改持久配置或执行真实来源。

---

## 10. unified D6/D7 route scope 的失败边界

存在当前 selected route 的 session，所有 D6/D7 mutation 必须在写 event 前校验 `sessionId + routeId`、当前 stage、route-D5 confirmation、draft/task 所有权与 basis sequence。缺 routeId、跨 route 的 draft/task/context、迟到 operation 或当前路线漂移一律 fail closed；只读 snapshot 可省略 routeId 以兼容 legacy，但返回的 route identity 必须来自 Main 当前状态。

多城市编译不得用模型或地点标题补时刻、ETA、坐标、费用、官方渠道或截止时间。缺口进入 named blocking item 或 route-scoped Gate blocker；GATE_C 使用 `ROUTE_LEG_UNVERIFIED`、`STAY_SEGMENT_UNVERIFIED`、`MUST_ANCHOR_UNVERIFIED` 与 `ROUTE_COVERAGE_INCOMPLETE` 点名具体 scope。Renderer 迟到响应由 request epoch 丢弃，不能回退显示上一 session/route 的“成功”状态。
