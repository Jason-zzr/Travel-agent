# Multi-city Route Frontend Contracts

> Renderer contract for confirming an unordered Yunnan goal and comparing evidence-backed route candidates in STAGE-2.

## Scenario: Compare and select a current-session route

### 1. Scope / Trigger

- Applies when the current session snapshot has a strict multi-city itinerary goal in STAGE-2.
- Owns the gateway/place confirmation copy, vertical route cards, route source authorization surface, controlled manual route-leg form, progress/cancel behavior, selection visibility, accessibility, and narrow-screen layout.
- Does not own route construction, evidence scoring, stage mutation, booking actions, or downstream D4-D7 entity/timeline/task rendering.

### 2. Signatures

- `ItineraryRouteCard` receives a validated `MultiCityRouteSnapshot`, preview/progress state, and typed preview/execute/select/manual-evidence/cancel callbacks from `ChatView`.
- Renderer boundary parses `MultiCityRouteSnapshotSchema`, `RoutePlanPreviewSchema`, and strict request/result schemas from `src/shared/schema/itinerary.ts`.
- Preload exposes `window.travelHarness.itineraryRoutes.snapshot|preview|execute|select|applyManualEvidence` and progress/cancel methods through the shared `TravelHarnessApi` contract.
- Mutations send only current identity fields: sessionId, planId, digest, operationId, or routeId. Components never send topology, score, evidence, provider, tool, retry, or call-count overrides.

### 3. Contracts

- The confirmation surface renders region goal plus the complete MUST_GO set and states that city order is decided by Travel Agent comparison. It never asks the user to preselect order or whether Kunming should be included.
- The confirmation surface separates required `originGatewayCity` from optional `originPlaceLabel`. Gateway drives intercity planning; the place label is display/context only. Missing gateway shows a local actionable blocker and never causes the Renderer to guess from an airport, station, hotel, or address.
- Only `snapshot.sessionId === activeId` is renderable as actionable route state. Null, loading, stale, expired, or different-session snapshots expose no execute/select action.
- Route cards are vertically comparable and show profile, route spine, node nights, legs and modes, evidence status, explicit unknown duration/cost, risks, score breakdown, material differences, and Kunming include/omit reason.
- Recommendation is an explanatory label, never an auto-selection. A route is selectable only when the main-owned snapshot says hard constraints and critical evidence are complete and blocking reasons are empty.
- Renderer keeps domain state read-only. After preview, execute, select, or a state-updated push, it reloads the typed current-session snapshot rather than patching a local canonical candidate.
- Only a current critical `UNVERIFIED` `MANUAL_FLIGHT` or `MANUAL_COACH` leg exposes the manual evidence form. Endpoints and travel date are read-only. The user enters mode, offset-aware start/end, label, nullable cost, source label, credential-free HTTPS URL, summary, and an explicit confirmation; the request never contains endpoints, date, scope, Claim identity, duration, overnight, or transfer count.
- Drafts are keyed by `sessionId + routeId + legId`. A session/route switch clears actionable state and uses the dirty-draft guard; concurrent submit is disabled. Success reloads Main's snapshot, resets only the submitted draft, and states that external/model calls are zero without claiming independent verification.
- Progress exceeding 300 ms is visible; cancellable execution exposes cancel while active. Safe IPC failures show `userHint` only and must not render raw arguments, evidence values, external responses, credentials, paths, stacks, or exact private addresses.
- At narrow widths, cards, nodes, and legs stack without horizontal clipping. Keyboard focus remains visible and color is not the sole status/risk carrier.

### 4. Validation & Error Matrix

| Condition | UI result |
|---|---|
| Current snapshot absent/loading | `aria-busy` or non-mutating empty state; no execute/select controls |
| Snapshot session differs from active session | discard for actions and request the current snapshot |
| Goal exists but candidates are not prepared | show region/MUST_GO confirmation and zero-call preview action |
| Strict multi-city goal lacks gateway | show the gateway blocker; precise place remains optional and is not promoted |
| Preview expired or state changed | hide execute, show safe refresh guidance, request a new preview |
| Candidate has critical evidence gap | show exact blockers/manual evidence guidance; no select control |
| Current critical manual flight/coach is unverified | show one strict user-confirmed form with read-only endpoints/date; no source fetch |
| Manual submission is invalid/stale/cross-session | preserve the draft, render only safe `userHint`, and keep selection hidden |
| Manual submission succeeds | reload Main snapshot, clear the target draft, keep at most one recommendation, and show zero external/model calls |
| Duration or cost is null | show explicit unknown copy; never render zero |
| Kunming included/omitted | show the engine-provided reason and added travel/rest trade-off |
| Execute is active | show typed progress and cancel; disable duplicate execution |
| Select succeeds | reload snapshot and render STAGE-3 state from Main; no optimistic stage mutation |
| IPC failure | show only serialized code/class/userHint semantics |

### 5. Good / Base / Bad Cases

- Good: three current-session candidates are readable in one vertical flow, one complete route has an evidence-backed recommendation reason, Kunming trade-offs are explicit, and keyboard selection reloads STAGE-3 from Main.
- Good: the user can see “广州” as required gateway and “广州市区” as optional precise place, then fill the only blocked flight leg without re-entering endpoints or date.
- Base: all routes have a manual-flight gap; cards remain comparable, recommendation/select are absent, and the missing capability is named.
- Base: switching sessions immediately removes old route actions while the new snapshot loads.
- Bad: presenting destination input order as the proposed route, hiding unknown values, auto-selecting the recommended card, or showing a select button for a stale/incomplete candidate.
- Bad: deriving gateway from the place field, accepting a user-edited endpoint/date, auto-opening the evidence URL, or labeling `VERIFIED_BY_USER` as an independent source check.
- Bad: duplicating route schemas in JSX, casting IPC data, or recomputing evidence completeness in the renderer.

### 6. Tests Required

- Render region goal, all MUST_GO places, 2-3 route cards, one recommendation explanation, score/risk/evidence fields, unknown values, and Kunming include/omit reasons.
- Null and different-session snapshot tests assert that execute/select labels and buttons are absent.
- Blocked candidates show exact gaps and have no select control; a complete current candidate exposes one keyboard-reachable select action.
- Manual-form tests assert read-only endpoints/date, strict submitted fields, explicit confirmation, safe errors, submit disabling, session/route/leg draft isolation, snapshot reload, duplicate stability, and exactly one recommendation only after all critical legs are complete.
- Preview authorization copy reflects frozen call count, serial zero-retry behavior, digest/expiry, and no editable source/tool/provider fields.
- Session switch, progress/cancel, safe IPC error, focus-visible, and narrow-width stacked CSS checks.
- Renderer SSR plus LOCAL Electron smoke run with fake/injected data at 820/320 px, keyboard operation, no horizontal overflow, and zero external/model/irreversible calls.

### 7. Wrong vs Correct

#### Wrong

```tsx
const complete = candidate.legs.every((leg) => leg.durationMinutes !== null)
setStage('STAGE_3')
return <button onClick={() => select({ ...candidate })}>选择</button>
```

#### Correct

```tsx
const currentRoute = routeSnapshot?.sessionId === activeId ? routeSnapshot : null
const selectable = candidate.score.criticalEvidenceComplete && candidate.blockingReasons.length === 0
return selectable ? <button onClick={() => select(candidate.routeId)}>选择此路线</button> : null
```

Main owns completeness and stage transitions. Renderer validates the snapshot, isolates it by session, and sends only the selected identity.

Manual recovery follows the same authority rule:

```tsx
await itineraryRoutes.applyManualEvidence({
  sessionId,
  routeId,
  legId,
  mode,
  startAt,
  endAt,
  label,
  costCents,
  sourceLabel,
  sourceUrl,
  summary,
  confirmed: true
})
await reloadRouteSnapshot(sessionId)
```

Never send `fromCity`, `toCity`, `travelDate`, evidence scope, derived duration, or candidate mutations from JSX.

### 8. STAGE-3 node research UX

- Render the selected route as an ordered node queue with REQUIRED, ACTIVE, CONFIRMED and SKIPPED status. Default to the first required node, then follow the coordinator-provided `nextRequiredNodeId`.
- Show current node dates, kind and exact MUST_GO place IDs. Optional Kunming appears only when present in the selected route; a skipped Kunming has no execute or confirm action.
- `XHS_STRICT` is the primary required-node action. Its preview must display frozen source/model counts and return a zero-call plan before explicit execute. Standard/official-source preview is a secondary, separately authorized action only when hard operational anchors need independent corroboration. Do not expose editable source, tool, provider, model, timeout or retry fields.
- Present Travel Agent results as evidence-backed choices with canonical source, freshness, UGC identity, verification/corroboration status, uncertainty, recommendation/avoidance reason and member-fit reason. User selection or conflict resolution must not rewrite source truth.
- Keep the formal manual form hidden during the normal XHS path. Show it only after an automatic failure or evidence insufficiency is visible and the user explicitly chooses manual degradation; label its Claims as `USER_RESEARCH / VERIFIED_BY_USER`, never as MCP-verified.
- Filter snapshots, progress and actions by exact `sessionId + routeId + nodeId`. Switching any identity clears stale preview/operation state; manual drafts key by the same triple and retain the existing dirty-draft guard.
- Preserve legacy single-destination D4 only when no multi-city route is selected. Narrow layouts remain one vertical flow with keyboard-reachable actions.
- Renderer tests must prove XHS-first action order, independent hard-fact corroboration, explicit manual degradation, exact route-node isolation, and unchanged dirty-draft protection.
