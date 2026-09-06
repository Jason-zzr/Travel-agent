# COLLABORATION

多会话并行分派、接口冻结、交接格式与完成标准。

适用场景：开发者一人，用 Codex + Claude 多开会话与 subagent 并行推进。**唯一的集成者是开发者本人**——会话之间不互相合并代码，全部由本人逐个合入（`PRD:PAR-4`）。

长期路线见 `PRD:implementationTiers` 的 M1/M2 分层与 `PRD:descopeOrder` 的砍量顺序，本文件不复述。

---

## 1. 串行骨干与并行 lane

`PRD:BUILD-PARALLEL` 定义的分工，这里给可执行的形态。

### 必须串行、必须本人做（不许分派）

| 环节 | 天 | 为什么不能并行 |
| --- | --- | --- |
| 环境前置与实名认证 | **D0** | 高德未实名全部配额为 0，卡住所有人 |
| 八个内核服务 + Cordis 装配 | **D1** | 所有 lane 的地基，接口在这里定型 |
| 第一条 MCP 通道打通 | **D1** | 首条成本是后续的 3–5 倍，踩完坑后面才好复制 |
| 打包与干净环境验证 | **D7** | 依赖全部产物 |

D0 是**挂机日**：装依赖、跑脚手架、注册账号、实名认证、拿 Key。不写业务代码。别跳过它去抢 D1。

### 可并行的五条 lane

| lane | 目录（唯一） | 前置 | 可并行天 |
| --- | --- | --- | --- |
| `LANE-SCHEMA` | `src/shared/schema/` | 无 | D1 起 |
| `LANE-SKILL` | `src/main/skills/` | schema 冻结 | D4–D6 |
| `LANE-VIEW` | `src/renderer/src/views/` | IPC 契约冻结 | D4–D6 |
| `LANE-AC` | 验收清单与测试脚本 | PRD | 全程 |
| `LANE-RESEARCH` | 只读，产出文档 | 无 | 全程 |

**铁律（`PRD:PAR-2`）：一个 lane 只改一个目录。** 跨目录的改动一律回到主线由本人做。

`src/shared/` 是主线专属——`LANE-SCHEMA` 是唯一例外，且它产出的是**待冻结的草案**，由本人 review 后合入并冻结，冻结前其他 lane 不得依赖。

**并行省下的时间回补 D1 风险，不用来扩大 M0 范围。** 这条是 v1.1 的明确纪律。

---

## 2. 接口先行冻结

并行的前提是接口已定。冻结顺序：

```
D1 结束前冻结：八个 ctx key + 服务方法签名     → ARCHITECTURE §4.1
                shared/errors.ts 错误码         → ERROR_HANDLING §2
                （D1 的 bootstrap 自检就要抛 INTERNAL_SERVICE_NOT_READY，
                  错误码枚举必须此时就定下来）
D2 结束前冻结：shared/schema/ 核心 schema      → ARCHITECTURE §3 目录 + DATA_MODEL §3 字段
D3 结束前冻结：shared/ipc-contract.ts          → ARCHITECTURE §5
```

截至 BUILD-D3 本地门禁，`shared/ipc-contract.ts` 已完成 source config / health / probe / query / cancel / evidence / tool-call / blocked-tool 的加法冻结。2026-08-25 又为 Search 流式展示加法冻结 `source:progress`：只承载带 `operationId` 的 `SEARCH_STARTED / SEARCH_RESULTS / ANSWER_DELTA / USAGE`，不得复用为任意 MCP 消息透传。后续 lane 可以新增通道，但不得改名、删字段或另建绕过 sender-bound handler 的平行接口。

2026-08-24 的轻量模型网关增量保持同一纪律：`provider:save` 只接受 v2 `channels + roles`，`provider:get` 摘要保留旧 `configured / provider / baseUrl / models` 字段并新增 `version / routes`。后续不得把凭据加入 summary、另建直达供应商的 Renderer IPC，或绕过 `ProviderRuntime` 调用模型。

**冻结的含义**：可以加，不能改，不能删。lane 需要改已冻结的接口时，**停下来问主线**，不要在自己的目录里定义一个"临时的"平行类型——那是最难发现也最难合并的冲突。

冻结物必须先 `tsc --noEmit` 通过再宣布冻结。带类型错误的接口不算冻结。

---

## 3. 开会话的标准 prompt

每个并行会话的开场必须包含这四段，缺一不可。**不要指望助手自己去翻文档**。

```
【项目】E:\Vibe-Coding\Travel-agent-APP，Travel-native Agent Harness
【必读】按顺序读：
  1. intelligent-travel-agent-prd-v1.1.xml 的 cordisContract / mcpDataLayer / NFR-031
  2. ARCHITECTURE.md 全文
  3. <本 lane 相关的那份文档>
【你的 lane】LANE-XXX，只允许修改 <目录>。任何其他文件的改动，
  向我报告，不要自己动手。
【本轮任务】<具体到 PRD 编号>
【硬约束】
  - cordis 钉 3.18.1，析构写 ctx.on('dispose')，不许用 ctx.effect
  - 禁止 any，外部数据一律先过 Zod
  - 服务只能通过 inject 获取，禁止模块级单例
  - 不提新功能。有想法先对照 PRD:implementationTiers 查 tier，非 M0 直接放弃
【产出】代码 + 一段交接说明（格式见 COLLABORATION.md §4）
```

最后两条比听起来重要。编码助手在这个项目上最常见的两种失误是**引入 cordis v4 写法**和**顺手扩大范围**，两者都不会报错。

---

## 4. 交接格式

一个 lane 交回来时必须附这段。**没有交接说明的产出不合入**，因为你合入时已经忘了当时的上下文。

```markdown
### 交接：LANE-XXX / <任务名> / <日期>

**做完了**
- <具体到文件与函数>

**没做完 / 故意没做**
- <项> —— 原因

**改了哪些文件**
- 新增：…
- 修改：…
- （若碰了 lane 外的文件，单列并说明原因）

**依赖的接口**
- 用到的 ctx key、schema、IPC 通道、错误码（逐个列出）
- 是否需要主线新增/修改接口：是/否，若是则具体说明

**验证**
- tsc --noEmit：通过 / 失败
- 手工验证：<做了什么，看到什么>

**给下一个人的坑**
- <踩到的、不明显的东西>
```

「给下一个人的坑」这一栏不要留空。这个项目静默失败点密集（ERROR_HANDLING §7），踩过的坑不写下来，下一个会话会原样再踩一遍。

---

## 5. 完成标准

### 单个任务算完成

全部满足才算，缺一条就是"没做完"：

1. `tsc --noEmit` 零错误。
2. 无 `any`，无 `@ts-ignore`（确需时必须写明理由）。
3. 涉及外部数据的都过了 Zod。
4. 涉及资源的都在 `ctx.on('dispose')` 里释放了。
5. 应用能启动，相关功能手工走通一遍。
6. 交接说明已写。

### 一天算完成（`PRD:workflowGuidance`）

**当天结束时仓库必须处于可运行状态**，且已按 `D3: 接入 SRC-MAP 并实现令牌桶 (NFR-029)` 格式提交。

不允许"今天先把架子搭一半，明天补完"。7 天窗口下，一个跨天的半成品会连锁拖垮后面。宁可砍范围也要当天收口——砍量顺序照 `PRD:descopeOrder`。

### M0 算完成

以 `PRD:AC-M0-*` 验收项为准，逐条勾。**验收清单是 PRD 的，不在本文件重复维护**——重复一份必然会漂移。

`LANE-AC` 的职责就是把 PRD 的 AC 项转成可执行的检查步骤，产出到 `TODO.md` 的验收段。

route-node D4 的交接不得把“请用户填写事实”当成默认完成方案。按 `PRD:FR-302` 与 `PRD:BUILD-D4`，Travel Agent 必须先通过 bundled XHS MCP 取得并验证可追溯的路线体验证据，用户只负责每个 digest 的授权、结果选择与冲突裁决；硬事实另走独立 allowlisted 来源。只有自动路径失败或不足且用户显式选择时，交接才可进入 `USER_RESEARCH / VERIFIED_BY_USER` 降级，并必须保留失败证据与原 provenance。

---

## 6. 合入流程

```
lane 产出 → 本人读交接说明 → 读 diff
  → 检查：有没有碰 lane 外的文件？有没有 v4 写法？有没有扩范围？
  → 合入 → 跑全量 tsc --noEmit → 启动一次
  → 提交
```

**逐个合入，不要攒。** 两个 lane 同时合入时如果出问题，你分不清是谁引起的。

**禁止会话之间互相合并**（`PRD:PAR-4`）。让 A 会话去合并 B 会话的代码，等于把集成责任交给一个看不到全局的参与者。

### 合入时必查的四件事

这四件在 diff 里很容易滑过去，但都是**不会报错**的问题：

1. `ctx.effect(` —— cordis v4 写法，3.18.1 上不存在。
2. `JSON.stringify(state` 出现在请求体或提示词构造附近 —— 违反出站最小化。
3. 直接写 SQLite 而没走 `TravelStateService.apply` —— 会被下次重建静默抹掉。
4. `setInterval` / `setTimeout` 裸用 —— 不会被 Cordis 回收。

建议直接配成 grep 检查跑一遍，比人眼可靠。

---

## 7. 分派与不分派

**适合分派**：边界清晰、接口已冻、产出可独立验证的活。写 Skill、写视图组件、写 schema、把 AC 转成检查脚本、查外部文档。

**不适合分派**：

- 跨目录的改动。
- 需要判断"这个该不该做"的决策——tier 归属、范围取舍、砍量顺序，一律本人决定。
- 调试静默失败。远程会话看不到你的运行时状态，来回描述的成本高于自己查。
- 任何触及安全红线的实现（白名单、凭据、出站最小化）。这些属 `neverCut`，出错代价不对称，本人写本人查。

---

## 8. 当前开放问题

不阻塞开工，但会影响排期判断：

- **OQ-021（P1）**：12306-mcp 无 SLA，靠正则匹配首页 HTML，会周期性失效。**D5 前必须实测一次手工粘贴降级路径真的能走通**——这是它挂掉时的唯一出路。
- **OQ-023（已解决，2026-08-24）**：不在代码中固定四角色模型，也不实现自动选模。用户在 SETTINGS 为 EXTRACTION / PLANNING / REVIEW / VISION 分别显式选择 `DEEPSEEK_OFFICIAL` 或 `SHUAI_API` 并填写模型名；`ProviderRuntime` 只执行已保存路由。
