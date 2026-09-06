# Route D5 Planning Frontend Contracts

## Scope

Use this surface only for a validated STAGE-4 snapshot with a current multi-city `selectedRouteId`. A session without that route continues to use the legacy D5 view.

## State and identity

- Main owns all route-D5 domain state. The renderer holds one validated `MultiSegmentD5Snapshot` plus local plan, progress, address, Claim-ID, stay-paste, and day-patch drafts.
- Actionable state must match the current `sessionId + routeId`. Leg and stay actions additionally send the exact shared scope object; components never send topology, source/tool overrides, coordinates, timeouts, retry counts, or call budgets.
- Key the route view by session/route identity. Switching either identity unmounts the old view, clears preview/operation/address state, unsubscribes progress, and exposes no stale mutation action while the next snapshot loads.
- Progress is accepted only when operationId, full scope, and route identity all match the active operation. Terminal progress clears both render state and the mutable cancellation reference.

## User flow

- Show route legs and stay segments in coordinator-provided sequence, with status, mode, date, blockers, evidence uncertainty, and completion counts.
- Rail preview is per leg. A selected Rail option enables only that leg's transfer preview. Exact Guangzhou origin/return address is cleared from the input as soon as preview is submitted and never rendered in the plan card.
- Manual flight/coach copy explicitly says there is no automatic query and accepts only existing matching Claim IDs, including a current STAGE-2 `USER_RESEARCH / VERIFIED_BY_USER` route-leg Claim created by the route-core manual form. It must not offer a second evidence editor in STAGE-4, imply a fallback/independent corroboration, or invent duration/cost.
- The route skeleton shows one card per date. Transfer days are visually and textually distinct; normal-day patch edits only confirmed attraction entity IDs for that date and explains that adjacent nodes stay unchanged.
- Each stay segment has an independent fetch preview, candidate list, USER_PASTE form, source/verification/unknown fields, and selection. A failed or edited segment must not visually clear another segment.
- The final Gate action is enabled only when Main returns no blockers. Recommendation or readiness is never recomputed in JSX.

## Authorization and safety

- A plan card shows action, exact ordered calls, exact count, retry=0, planId, digest, and expiry semantics before execute appears.
- Operations over 300 ms show bounded progress and active operations expose cancel. Safe failures render only `userHint`.
- Never render raw MCP/model responses, Evidence values, credentials, sourceRef, exact addresses, stacks, or filesystem paths.
- Do not use booking/payment/cancellation language; all source work is read-only evidence gathering.

## Responsive and test requirements

- At 820 px and 320 px the sidebar, plan, leg/stay cards, option buttons, paste form, and day patch remain one vertical keyboard-operable flow with no desktop minimum width or horizontal overflow.
- SSR covers ordered Rail/manual/stay content and local patch labels with zero side effects. IPC tests cover sender, visibility, strict payloads, safe errors, and progress scope. Electron smoke uses fake handlers and fresh temporary userData; a host GPU failure before page load is reported as an environment failure rather than an interaction pass.
- After final route-D5 confirmation, the same route/node/leg/segment identity is handed to unified D6/D7. Renderer must not split the route, infer identity from labels, or drop scope when navigating from SKELETON to TIMELINE/TASKS.
