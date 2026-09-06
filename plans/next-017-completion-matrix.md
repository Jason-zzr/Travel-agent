# NEXT-017 completion matrix

## Scope and evidence levels

- Task: `.trellis/tasks/08-30-next-017-r0-real-trip-manual-install-acceptance`
- Session: `01M1BRR11EFXB64KMRSEQ2GTP9`
- Selected route: `route_4d9299ab9458e5c2246e4329`
- Snapshot: `STAGE_3`, `lastSeq=19`, Claims `23`, tool calls `39`, model calls `0`
- Status vocabulary: `PROVEN` means the complete AC is satisfied; `PARTIAL` means only a strict subset is evidenced; `MISSING` means the acceptance outcome cannot yet be demonstrated.
- Evidence vocabulary: `LIVE` is an approved real-source/product-path result, `LOCAL` is an offline or synthetic verification result, and `USER-MANUAL` is a result that only the user can attest after operating Windows or Outlook.

## Acceptance matrix

| AC | Status | Evidence level | What is already evidenced | Missing proof before PASS |
|---|---|---|---|---|
| AC-01 | PARTIAL | LIVE + zero-call audit | The route-core Gate R was approved and consumed once: 19 planned calls, 19 outcomes, 17 successes, 2 empty results, 0 errors, `retryCount=0`, and `modelCalls=0`. The Dali manual D4 write added no source or model calls; historical XHS digests were not reused. | Complete both remaining required nodes, enter `STAGE_4`, then produce a fresh preview/digest, exact approval, one-shot execution, and audit for each of the 5 legs and 3 stays. No leg/stay authorization currently exists. |
| AC-02 | PARTIAL | LIVE + LOCAL | Current actions are read-only; current session has `modelCalls=0` and no recorded irreversible action. The current package/synthetic-export LOCAL baseline has zero credential-shaped findings. | After D5/D6/D7 completes, scan the current session's actual exports, logs, JSONL, SQLite, and task evidence for secrets, precise addresses, raw responses, and full tool arguments. Synthetic fixtures and a package-only scan do not prove final acceptance. |
| AC-03 | MISSING | Product-path snapshot | The selected route is fixed. Dali/Erhai is `CONFIRMED`; Kunming is non-required and `SKIPPED` with the route rationale retained. | Lijiang/Yulong and Xishuangbanna are `NOT_STARTED`; all 5 legs and 3 stays are `NOT_STARTED`; route-D5 confirmations, timeline versions/items, D7 tasks, GATE_C/decision logs, ICS, and Markdown are absent. The required one-session end-to-end identity chain therefore does not exist yet. |
| AC-04 | PARTIAL | LOCAL + future USER-MANUAL | The current installer candidate is identified: 104,973,007 bytes, SHA-256 `90559faed71636808a64ffc3e78ba14f40680fefb0e5cac757725a8baffb0350`, Authenticode `NotSigned`. | The user must run the installer and record SmartScreen/signature behavior, first launch, restart recovery, uninstall, removed program files/shortcuts/processes, and separately retained userData. No Windows acceptance step has been executed. |
| AC-05 | MISSING | Future USER-MANUAL | The Outlook checklist and UTC `Z` / Asia/Shanghai display contract are prepared. | The current route has no D6/D7 ICS. After export, the user must import it into Outlook and verify dates, start/end times, Asia/Shanghai display, cross-midnight events, and zero-duration BACKUP entries. |
| AC-06 | MISSING | Aggregate | The task remains `in_progress`, and defects are required to stay separate from acceptance work. | AC-01 through AC-05 must all be `PROVEN`, with both LIVE E2E and USER-MANUAL evidence complete and no blocking defect. No AC is currently fully proven. |

## Current blockers and order

1. **Immediate user-input gate:** supply independently checked Lijiang / Yulong Snow Mountain manual-research fields in `plans/lijiang-yulong-manual-research-input.md`: source name, optional credential-free HTTPS source URL, content identity, verification summary, fitness status and reason, opening hours, closure schedule, and reservation requirement.
2. After Lijiang is formally confirmed, collect and confirm the already templated Xishuangbanna node. The Xishuangbanna draft is intentionally out of sequence and has not been applied.
3. Only the final required-node confirmation may advance `STAGE_3→STAGE_4`; then create new per-leg/per-stay Gate R/M/H previews and obtain exact one-shot approvals.
4. Compile and verify D6/D7 only after route-D5 confirmation, then hand the identified installer and current-route ICS to the user for Gate U.

## Zero-action declaration

This completion audit was read-only. It generated no product IPC write, external/source/model call, planId, digest, operationId, installer execution, Outlook operation, or irreversible action.
