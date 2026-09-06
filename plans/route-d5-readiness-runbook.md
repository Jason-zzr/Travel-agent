# Route-D5 readiness runbook

> 状态：只读准备完成，仍被 node-D4 阶段门禁阻挡。本文档不是 D5 preview，没有 planId / digest / operationId，不授权 Rail、Map、Hotel 或任何其他调用。

## 固定路线身份

- Session：`01M1BRR11EFXB64KMRSEQ2GTP9`
- Selected route：`route_4d9299ab9458e5c2246e4329`
- 当前阶段：`STAGE_3`
- D5 可执行前置：丽江 / 玉龙雪山与西双版纳两个剩余 required node 都完成确认，由最后一个 node 的确认事件原子推进为 `STAGE_4`。

## Leg 队列

| 序号 | Leg ID | 城市 | 日期 | 方式 | 当前状态 |
|---:|---|---|---|---|---|
| 1 | `leg_3e336c9a26e50f8f9d85bc40` | 广州 → 大理 | 2026-09-08 | `RAIL` | `NOT_STARTED / NOT_RUN` |
| 2 | `leg_4378ef8fb51febb47eee54da` | 大理 → 丽江 | 2026-09-11 | `RAIL` | `NOT_STARTED / NOT_RUN` |
| 3 | `leg_510176cc8dd600bd65e4561e` | 丽江 → 西双版纳 | 2026-09-14 | `RAIL` | `NOT_STARTED / NOT_RUN` |
| 4 | `leg_022ab128cb93afe89976ab4c` | 西双版纳 → 昆明 | 2026-09-17 | `RAIL` | `NOT_STARTED / NOT_RUN` |
| 5 | `leg_6c6daed447e5d65b85cf03b0` | 昆明 → 广州 | 2026-09-17 | `RAIL` | `NOT_STARTED / NOT_RUN` |

当前 Rail 候选数、已选候选数、leg anchor 数均为 0。

## Stay 队列

| 序号 | Segment ID | Node ID | 城市 | 入住 → 离店 | 晚数 | 当前状态 |
|---:|---|---|---|---|---:|---|
| 1 | `segment_ad441c19d4c6009f750cbb21` | `node_8c312fc99d71f40ee5809d40` | 大理 | 2026-09-08 → 2026-09-11 | 3 | `NOT_STARTED` |
| 2 | `segment_19f1a283fcd6c13a928ec5af` | `node_0543edb9fbe96ced16f22131` | 丽江 | 2026-09-11 → 2026-09-14 | 3 | `NOT_STARTED` |
| 3 | `segment_ceca094613617efbf6b401fd` | `node_473310983e2cebd05b7e1896` | 西双版纳 | 2026-09-14 → 2026-09-17 | 3 | `NOT_STARTED` |

当前 Hotel 候选数、已选住宿数、stay outcome 数均为 0。

## STAGE_4 后的正式顺序

1. 通过正式 renderer → preload → IPC 读取 Route-D5 snapshot，确认 `nextRequiredWorkItem` 指向 leg 1。
2. 对当前 leg 生成零调用 `DISCOVER_RAIL` preview；展示完整 scope、调用顺序/数量、超时、`retryCount=0`、planId、digest 和过期时间。
3. 只有位于该最终摘要之后的 Gate R 精确批准，才可单次 execute；然后由用户选择该 leg 的 Rail 候选。
4. 对同一 leg 生成零调用 `PREPARE_TRANSFERS` preview；只有 Gate M 精确批准才可单次执行 Map geocode / ground-transfer 调用。精确地址仅能存在于 Main 短生命 pending plan，不进入本文档。
5. 当前 leg 达到 `READY` 后才处理下一 leg；按序完成 5 个 leg，不并发、不重试、不复用授权。
6. 全部 leg `READY` 后才生成 10 天日级 skeleton，再按序处理 3 个 stay：零调用 `FETCH_STAY` preview → Gate H 精确批准 → 单次 Hotel/Map execute → 用户选择候选。
7. 只有 5 个 leg 均 `READY`、3 个 stay 均 `SELECTED`、日级 skeleton 和 boundary anchors 完整且 blocker 为 0，才能使用 ROUTE scope 确认，追加 `route-d5/confirmed` 并从 `STAGE_4` 进入 `STAGE_5`。

## 未授权与未知项

- 本轮没有生成任何 D5 preview；因此没有已冻结的调用数、planId、digest、operationId 或可执行授权。
- 不在 `STAGE_4` 时不得调用 `RouteD5Service.preview`。
- 不根据城市常识预填车站、住宿区、坐标、时间、价格或接驳距离。
- 任何参数、scope、调用顺序/数量、digest 或过期状态变化，都必须废弃旧 preview 并重新取得授权。
