# D5 Planning Contracts

## Scope and authority

This guide compresses the implemented BUILD-D5 local contract. The authoritative requirements remain `intelligent-travel-agent-prd-v1.1.xml`; root `ARCHITECTURE.md`, `DATA_MODEL.md`, `ERROR_HANDLING.md`, `PERFORMANCE.md`, and `MIGRATION.md` control implementation details.

## Evidence-first inputs

- Transport accepts `SRC_RAIL/railJourney` and `SRC_MAP/groundTransfer` claims already recorded for the session. Each direction has exactly `FIRST_MILE`, `WAIT`, `INTERCITY`, and `LAST_MILE` legs.
- Rail source rows keep internal `train_no` separate from user-visible `start_train_code`. Candidate display, selection, lookup, and Claims use `start_train_code`; legacy local fixtures without that field may fall back to `train_no`, but a real dual-field row must never expose the internal identifier as the service code.
- Skeleton items must be confirmed, non-excluded ResearchEntity values with a usable `coordinates` claim. Missing coordinates are not inferred.
- Lodging accepts only Claim-backed `lodgingCandidate` values from `SRC_HOTEL`, `SRC_SEARCH`, or `USER_PASTE`. Hotel claims must have `COMMERCIAL_OFFER` identity.
- Missing total cost, occupancy, cancellation, or position facts remain null/UNKNOWN. Never multiply a nightly minimum by nights.

## Persistent events and projections

The version-2 event set is additive:

- `transport/candidates-prepared`
- `transport/candidate-selected`
- `skeleton/updated` with full days plus `changedDates`, boundary anchors, and the stay segment
- `stay/candidates-prepared`
- `stay/selected`

Skeleton confirmation continues to use the existing `stage/confirmed` event for STAGE-4 to STAGE-5. JSONL is authoritative. SQLite projection writes occur only in `TravelStateService`; migration `0004_d5_transport_candidates.sql` adds the queryable transport projection.

For a local skeleton edit, `changedDates` contains exactly the target date. Only that `day_skeletons` row and the stay-position assessment are rewritten; existing stay candidates and selection are cleared. No model or external-source call is made.

## Deterministic gates

- Every direction has the four ordered legs and arithmetic totals match.
- Arrival/departure anchors are both `HARD_LOCKED` and derive from the selected transport.
- D5 uses only ARRIVAL_DAY, NORMAL_DAY, and DEPARTURE_DAY.
- Every half-day cluster has pairwise straight-line distance at most 8 km.
- Stay Segment nights equal `nightDates.length` and the skeleton has `nights + 1` unique dates.
- STAGE-4 confirmation lists all missing conditions through stable `GATE_BLOCKED` output.
- `roomFitsParty=false/null` cannot be recommendation eligible; cancellation has explicit FREE_UNTIL, NON_REFUNDABLE, or UNKNOWN state.

## IPC and renderer

Shared Zod contracts define `d5:snapshot`, `rail:preview/discover/select`, `source-plan:preview/execute`, `transport:prepare/select`, `skeleton:prepare/patch/confirm`, `stay:prepare/paste/select`, and bounded `d5:progress`. Main handlers validate the sender and visible session. Renderer owns only the returned D5 snapshot and temporary form state.

The default source flow is two-stage. Stage A derives the outbound and return Rail queries from confirmed fixed dates and cities, then performs exactly two authorized `get-tickets` calls. Selection is local and materializes no Claim. Stage B preview accepts the exact origin address once, derives geocode misses, four timed transfers, and one Hotel query, and returns an address-free plan plus canonical digest. Execute accepts only `planId`, `digest`, `operationId`, and `sessionId`; source/tool identity and coordinates never come from Renderer.

Stage A owns one temporary Rail MCP session per authorized round trip. Production Rail is pinned to `npx(.cmd) --offline -y 12306-mcp@0.3.10`; the exact package and dependencies must already exist in the npm cache, and there is no registry fallback. `connect/initialize` receives the 60-second cold-start budget; `listTools` and each serial `get-tickets` call retain independent 15-second limits. The session passes the existing allowlist/schema gate once, writes one redacted audit per actual tool call, and awaits the same idempotent close on success, failure, or cancellation. Connect failures expose only bounded main-process diagnostic categories for cache miss, spawn, early exit, invalid protocol, initialize timeout, or unknown failure; raw stderr, commands, environment, paths, PID, and exit codes are discarded. Connect/discovery failures create no tool-call audit, an outbound failure skips the return call, and no phase retries or prewarms the Rail process.

Unknown errors before the first Rail tool audit are normalized at their narrow boundary without expanding the public vocabulary: configuration/credential or source-state failures use `INTERNAL_SERVICE_NOT_READY`, session construction uses `SOURCE_UNREACHABLE`, connect/list discovery uses `MCP_PROTOCOL_ERROR`, and local registration uses `INTERNAL_SERVICE_NOT_READY`; existing `AppError` values pass through. A plain tool transport failure uses `SOURCE_UNREACHABLE` in both the public result and its audit. Close failures are mapped safely after awaiting close and never replace an existing primary error. Local regression must combine Coordinator/ToolRegistry with the real local stdio transport and prove initialize=1, list=1, call=2, audit=2, fixed order, zero retry, and no child process after close; this is LOCAL evidence only.

Rail discovery, selected options, and pending source plans are session-bound and expire after ten minutes. Each external operation ID is consumed once. The exact address exists only in the pending main-process plan and transient hashed geocode cache; it is cleared on replacement, expiry, success, or failure and is excluded from IPC results, Evidence, JSONL, SQLite, and tool audit values. Rail, coordinate, and transfer Claims remain drafts until every transport call succeeds, then persist together before the existing transport event is appended. The legacy typed `sourceParameters` entry remains additive compatibility and follows the same one-shot and atomic-transport rules.

## Verification

Local gates must prove four-leg provenance, boundary anchors, full date/night coverage, 8 km clustering, target-row-only recompute, zero model calls, three-source outcomes, non-null lodging Claim IDs, JSONL byte stability after SQLite deletion/rebuild, malformed schema rejection, duplicate-operation rejection, exact-address non-persistence, atomic transport Claims, and no external calls in renderer smoke. `ToolRegistry` owns separately tested one-shot materializers for real `get-tickets`, `maps_geo`, `maps_distance`, and `searchHotels` results. The 2026-08-29 hosted diagnostics froze Rail and Hotel directly and froze Map as `results[].distance/duration` with official metre/second semantics; each final contract returned `resultSchema=VALID`, with no retry or raw-response retention. Local tests prove the derived Hotel parameters, fixed call counts, geocode cache behavior, timed transfer windows, compatibility entry, and explicit Hotel failure outcome. On 2026-08-29, one live Coordinator process/session passed `get-tickets×2`, selected G1974/G239, then passed `maps_geo×4`, `maps_distance×4`, and `searchHotels×1`; all 11 external audits succeeded with zero retry, producing `railJourney×2`, `groundTransfer×4`, `lodgingCandidate×5`, and `transport/candidates-prepared`. The exact address was absent from every retained file. A post-run harness assertion incorrectly expected local `materializeSelectedRailOption` to emit two additional tool audits; the product contract explicitly performs no new query and no tool audit for this local materialization, so SQLite/JSONL evidence is authoritative and strict live-session continuity is complete.

## Yunnan multi-segment route-D5 extension

This additive path applies only when a current multi-city `selectedRouteId` exists in STAGE-4. It does not reinterpret or migrate the legacy outbound/return D5 path.

- Identity is always `sessionId + routeId + legId` or `sessionId + routeId + nodeId + segmentId`. Main resolves current ownership; renderer identity is only a reference to validate.
- `MultiSegmentD5Snapshot` exposes ordered leg/stay states, one route day per itinerary date, `nextRequiredWorkItem`, blockers, and final confirmation. The selected RouteCandidate is the only topology source.
- Each Rail discovery, two-ended transfer preparation, and stay fetch has a separate zero-call preview and one-shot execution plan. Plans bind action, exact scope, state sequence, digest, expiry, ordered calls, exact call count, timeout, and retry=0.
- A new preview replaces the same scope/action plan. Exact origin addresses remain only in pending main-process memory and transient geocode cache; replacement, a Cordis expiry timer, and plan consumption clear them. They never enter progress, event payloads, SQLite, logs, Inspector, or IPC responses.
- `MANUAL_FLIGHT` and `MANUAL_COACH` have no automatic source path. Route core may already contain a STAGE-2 `USER_RESEARCH / VERIFIED_BY_USER` `routeLeg` Claim created through `itinerary-route:manual-evidence-apply`; route-D5 only consumes it after exact session, endpoint-city, travel-date, mode and `ROUTE_GOAL_LEG` scope checks. A missing/mismatched Claim stays blocked. Route-D5 never creates or upgrades that Claim and never treats user confirmation as independent corroboration.
- Seven route-D5 V2 events own leg options/selection/transfers, skeleton, stay candidates/selection, and the sole final confirmation. Migration 0009 projects them into new `route_d5_*` tables with 0007 topology foreign keys. Final Claims and their prepared event share one record transaction.
- A transfer date may reference multiple ordered `routeLegIds`; anchors use the first departure and last arrival. Non-transfer attractions stay within their owning node and the 8 km rule never crosses nodes. A local patch changes exactly one date and clears only its owning stay segment candidates/selection.
- `route-d5/confirmed` is the only STAGE-4 to STAGE-5 transition and requires every required leg plan, every stay selection, complete date/night coverage, anchors, and route skeleton invariants.

Required local coverage includes route topology, mixed Rail/manual modes, replaced/expired/stale/cross-scope plans before calls, atomic failure/cancel, segment isolation, migration 0009/legacy fixtures, strict IPC/progress identity, SSR, 820/320 px, and full legacy regression. Automated gates keep externalCalls=0, modelCalls=0, and irreversibleActions=0. A host GPU failure before Electron page load is recorded as an environment failure, never substituted with SSR success.
