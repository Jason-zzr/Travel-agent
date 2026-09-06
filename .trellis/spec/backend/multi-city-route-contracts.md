# Multi-city Route Contracts

> Additive STAGE-2 contract for one evidence-backed multi-city itinerary. It does not change the existing single-destination D4-D7 path.

## Scenario: Yunnan route recommendation and atomic selection

### 1. Scope / Trigger

- Applies only when confirmed `TravelBasics.itineraryIntent.kind === 'MULTI_CITY_ROUTE'` with two or more mandatory node cities.
- Covers D2 goal entry, gateway/place canonicalization, pure route construction, bounded source authorization, controlled manual route-leg evidence, event sourcing, SQLite projection, IPC, and the STAGE-2 route comparison surface.
- This file owns the route-core contract. Per-node D4, multi-leg D5 and unified D6/D7 are now implemented locally under their dedicated specs; booking, payment and live acceptance remain out of scope.

### 2. Signatures

- `deriveMultiCityItineraryGoal(basics: TravelBasics): ItineraryGoal`.
- `buildMultiCityRouteSourcePlan(goal: ItineraryGoal): MultiCityRouteSourcePlan`.
- `buildMultiCityRouteCandidates(input: BuildMultiCityRouteCandidatesInput): MultiCityRouteCandidateResult`.
- `CoordinatorService.previewMultiCityRoutes({ sessionId }): RoutePlanPreview`.
- `CoordinatorService.executeMultiCityRoutes(request: RoutePlanExecuteRequest, onProgress?): Promise<MultiCityRouteSnapshot>`.
- `ToolRegistryService.discoverRailOptionsBatch(requests, operationId?, onSettled?): Promise<RailBatchDiscoveryOutcome[]>`.
- `CoordinatorService.selectMultiCityRoute(request: RouteSelectRequest): Promise<MultiCityRouteSnapshot>`.
- `CoordinatorService.applyManualRouteLegEvidence(request: ManualRouteLegEvidenceRequest): Promise<MultiCityRouteSnapshot>`.
- `materializeManualRouteLegEvidence(input: ManualRouteLegEvidenceRequest, target: ManualRouteLegTarget, confirmedAt?): MaterializedManualRouteLegEvidence`.
- `CoordinatorService.multiCityRouteSnapshot({ sessionId }): MultiCityRouteSnapshot`.
- `CoordinatorService.cancelMultiCityRouteOperation({ operationId }): Promise<boolean>`.
- IPC channels are `itinerary-route:snapshot|preview|execute|select|manual-evidence-apply|progress|cancel`; preload exposes the typed `itineraryRoutes` bridge.
- Current events are `itinerary/route-candidates-prepared`, `itinerary/route-manual-evidence-applied`, and `itinerary/route-selected`, all `eventVersion: 2`.
- Migration `0007_multi_city_routes.sql` owns the route candidate, node, leg, stay-segment, and selection projections.

### 3. Contracts

- `destinationCities` is an unordered constraint set. Only the pure engine orders destinations; it enumerates bounded mandatory-city permutations and `BALANCED | LOW_TRANSIT | RELAXED` profiles.
- A strict multi-city goal requires `TravelBasics.originGatewayCity`. `originPlaceLabel` is optional display/context only. Rail arguments, source plans/outcomes, `ItineraryGoal.originCity`, route legs, stable IDs, digests, and public blocker text use the canonical gateway and must never substitute or expose the precise place label. Missing gateway fails closed without source/model calls.
- Every candidate conserves the trip date range and total nights, covers every MUST_GO place, connects the origin through ordered nodes and back to the origin, and uses stable route/node/leg/segment IDs derived from canonical versioned input.
- Claim attachment is fail-closed: a claim must belong to the same session and match the normalized route leg endpoints, date, and mode. Unknown duration or cost remains `null` and never ranks as zero.
- Kunming is optional route logic, not an interview question. It enters a candidate only when verified legs improve connection or risk versus a direct alternative; every candidate carries an explicit include/omit reason.
- Candidate dedupe uses city, node kind, nights, and leg modes. Return 2-3 materially different candidates, at most one per profile and at most one recommendation. Incomplete critical evidence preserves comparable candidates but makes all of them non-selectable and non-recommended.
- Preview makes zero ToolRegistry and ProviderRuntime calls. Its digest binds plan version, session, state, expiry, goal, topology signatures, ordered allowlist calls, call count, 15-second timeout, and `retryCount=0`; deduplicated calls may not exceed 24.
- Execute accepts only session/plan/digest/operation identities, performs all visibility, ownership, expiry, state, and one-shot checks before the first source call, then executes approved read-only Rail calls serially with no retry, fallback, or model call.
- One consumed multi-city plan owns exactly one temporary Rail session. `connect/initialize` receives 60 seconds once, `listTools` receives 15 seconds once, and each of at most 24 ordered `get-tickets` calls receives an independent 15 seconds. The session is never prewarmed or reused across plans and is awaited through one idempotent close on success, failure, cancellation, or shutdown.
- Every request that actually reaches `callTool` produces one sanitized ToolCallAudit. Connect/list failure produces zero tool audits; schema drift or a degraded/cancelled session stops later external calls and settles the remaining ordered items locally with bounded outcomes. There is no retry, fallback, provider switch, hidden concurrency, or model repair.
- Manual evidence apply is a separate LOCAL STAGE-2 mutation. The strict request contains `sessionId`, `routeId`, `legId`, `MANUAL_FLIGHT | MANUAL_COACH`, offset-aware `startAt/endAt`, label, nullable non-negative `costCents`, source label, credential-free HTTPS URL, summary, and `confirmed: true`. Main resolves the current leg and derives its endpoint cities, travel date, `ROUTE_GOAL_LEG` scope, duration, overnight flag, and transfer count; Renderer cannot provide or override them, and Main never fetches the supplied URL.
- A valid apply produces one deterministic `USER_RESEARCH / VERIFIED_BY_USER` `routeLeg` Claim with seven-day validity and one atomic `itinerary/route-manual-evidence-applied` event containing the Claim plus recomputed candidates/blockers. It bypasses ToolRegistry, ProviderRuntime, source health, retry and model audit. Source outcomes are preserved; an identical already-recorded fact returns the current snapshot with zero write.
- Independent source failures become bounded source outcomes. Successful normalized route-leg claims, source outcomes, blockers, and candidates are written together in one prepared event and one projection transaction. Preflight, invariant, and cancellation failures write no prepared event.
- Selection accepts only a current, complete candidate. One `itinerary/route-selected` event stores chosen/rejected rationale, nodes, legs, and stay segments and itself advances STAGE-2 to STAGE-3. No companion `stage/confirmed` event is permitted.
- `events.jsonl` remains authoritative. Route projections are disposable and must rebuild equivalently from JSONL; legacy events and single-destination state retain their existing defaults and reducers.
- `EvidenceScope` is additive: historical D4 Claims retain `ROUTE_NODE { routeId, nodeId }`; manual route-core Claims use `ROUTE_GOAL_LEG { fromCity, toCity, travelDate }`. Existing SQLite scope rows remain node-only; goal-leg scope is recoverable from the authoritative Claim/event JSON, so this feature adds no migration 0011.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Strict multi-city intent missing/invalid | legacy envelope or schema rejection; no route preview |
| Preview in non-STAGE-2 or without basics | `GATE_BLOCKED`; zero source/model calls |
| Strict multi-city basics omit the canonical gateway | `GATE_BLOCKED`; the precise place is never substituted; zero source/model calls |
| Extra execute fields, unknown plan, digest/session mismatch | `INPUT_INVALID`; reject before source |
| State drift or incomplete current stage | `GATE_BLOCKED`; pending plan cleared when stale; zero source calls |
| Expired/replayed plan or repeated operation | fail closed; no source call and no event |
| Rail connect/list setup fails | ordered bounded outcomes; `callTool=0`, ToolCallAudit=0, close once |
| Source call fails | bounded source outcome; independent calls may continue; no retry/fallback |
| Rail result schema drifts or source becomes degraded | audit the actual call, stop subsequent external calls, settle the remaining items locally, close once |
| Cancellation during Rail batch | stop subsequent external calls, close once, and write no prepared event |
| Candidate has UNKNOWN critical leg or blockers | visible but not recommended or selectable |
| Manual request is unconfirmed, has extras, unsafe/non-HTTPS URL, missing timezone offset, reversed time, negative cost, mode mismatch, stale route/leg, wrong local date, or cross-scope identity | `INPUT_INVALID`, `IPC_FORBIDDEN`, or `GATE_BLOCKED` before any event/Claim/call |
| Valid manual route-leg evidence | one deterministic Claim and one atomic event; pure candidate recompute; external/model/irreversible calls remain zero |
| Exact duplicate manual fact | return current snapshot; zero event and zero Claim write |
| Fewer than two materially different candidates | stable `GATE_BLOCKED` route blocker |
| Unknown/stale/cross-session routeId | `INPUT_INVALID` or `GATE_BLOCKED`; zero writes |
| Valid complete route selection | exactly one selected event; atomic STAGE-3 transition |
| SQLite removed | replay JSONL into equivalent route projections without changing JSONL bytes |

### 5. Good / Base / Bad Cases

- Good: the 10-day Guangzhou-Yunnan goal yields deterministic Dali/Lijiang/Xishuangbanna alternatives, includes Kunming only when verified connection evidence improves the route, explains the trade-off, and lets the user choose a complete route.
- Good: `originGatewayCity='广州'` with `originPlaceLabel='广州市区'` builds every route identity from `广州`, while the place label remains visible only as optional context.
- Good: the user confirms a current Guangzhou→Xishuangbanna flight with offset timestamps and an HTTPS reference; Main derives the leg scope/date, records one verified-by-user Claim, and recomputes all candidates locally.
- Good: one approved 19-call route plan connects Rail once with the 60-second cold-start budget, discovers once, executes all ordered calls serially with independent 15-second budgets, reports 19 settled progress updates, and closes once.
- Base: partial Rail fixtures produce candidates with explicit unknown legs, source outcomes, and manual evidence blockers; no candidate is labeled recommended and stage remains STAGE-2.
- Base: Rail setup fails before `callTool`; the first real setup error and local degraded remainders remain visible while ToolCallAudit stays empty.
- Base: a legacy single-destination session replays with empty route defaults and continues through its existing D4-D7 commands.
- Bad: asking the user for city order or Kunming preference before generating candidates, assigning `0` to missing time/cost, attaching a claim by display text alone, or synthesizing flight evidence from model knowledge.
- Bad: treating an airport/hotel/address string as the gateway city, accepting endpoints/date from Renderer, opening the supplied source URL, or presenting user-confirmed evidence as independent corroboration.
- Bad: passing the 15-second per-tool budget into Rail initialize, creating a new Rail process per planned call, retrying a timeout, or continuing external calls after schema drift/degradation.
- Bad: writing claims and candidates in separate events, appending `stage/confirmed` after route selection, or updating route tables directly from IPC.

### 6. Tests Required

- Strict intent and additive envelope tests, including unordered equality and unchanged legacy multi-destination rejection.
- Gateway/place tests prove legacy optional parsing, mandatory strict gateway, no precise-place substitution, and zero-call failure.
- Deterministic IDs/order/score across repeated runs; all three profiles; date/night/MUST_GO/connectivity/cross-session failures; material dedupe; null-safe ranking; Kunming include and omit.
- Preview zero-call proof; strict request parsing; digest/session/state/expiry/one-shot rejection before source; max-24 serial call plan; retry/fallback/model counters remain zero.
- A 19-item fake Rail batch proves exactly one session, one 60-second connect, one 15-second list, 19 ordered 15-second calls, 19 settled progress updates, one audit per actual call, and one close.
- Setup, call, schema-drift, degradation, cancellation, and shutdown fixtures prove exact external-call/audit counts, local remainders, zero retry/fallback/model calls, and deterministic close.
- Partial source outcome plus successful claims and gap candidates in one prepared event/transaction; cancellation and invariant failures produce zero prepared events.
- Exactly-one selected event, zero new `stage/confirmed`, atomic STAGE-3 state, and zero-write stale/repeated selection.
- Migration constraints/indexes/idempotence and delete-SQLite replay equality with unchanged JSONL bytes.
- Manual request/property tests cover extra fields, confirmation, mode, offset/date/order, cost, URL and cross-scope failures; coordinator tests assert one Claim/event, preserved outcomes, duplicate zero-write, incomplete/complete recommendation gates, and zero ToolRegistry/ProviderRuntime/model/source-health effects.
- Delete-SQLite replay must restore the same manual Claim, goal-leg scope, candidates, blockers and selection through migrations 0001–0010, with no migration 0011.
- Typed IPC authorization/visibility/safe errors plus full legacy test, lint, Node/Web typecheck, build, and LOCAL renderer/Electron smoke.

### 7. Wrong vs Correct

#### Wrong

```ts
const routeOrder = basics.destinationCities
const durationMinutes = claim.durationMinutes ?? 0
await Promise.all(plan.calls.map(callSource))
await record({ type: 'itinerary/route-selected', payload })
await record({ type: 'stage/confirmed', payload: { stage: 'STAGE_3' } })
```

#### Correct

```ts
const goal = deriveMultiCityItineraryGoal(basics)
const sourcePlan = buildMultiCityRouteSourcePlan(goal) // bounded, ordered, zero calls
const result = buildMultiCityRouteCandidates({ goal, claims, sourceOutcomes, now })
await toolRegistry.discoverRailOptionsBatch(
  sourcePlan.plannedCalls.map(({ args }) => args),
  operationId,
  onSettled,
)
await record({ type: 'itinerary/route-selected', eventVersion: 2, payload })
```

The engine, not input array order, owns route ordering. Nullable evidence stays nullable, source execution is auditable and serial, and the selected event is the sole stage transition.

For manual recovery, the same rule is:

```ts
const target = resolveCurrentLeg(request.sessionId, request.routeId, request.legId)
const { claim, scope } = materializeManualRouteLegEvidence(request, target)
const candidates = buildMultiCityRouteCandidates({ goal, claims: [...claims, claim], sourceOutcomes, now })
await record({
  type: 'itinerary/route-manual-evidence-applied',
  eventVersion: 2,
  payload: { goal, scope, claim, candidates: candidates.candidates, blockingReasons: candidates.blockingReasons }
})
```

Do not accept `fromCity`, `toCity`, `travelDate`, duration, overnight, transfer count, Claim identity, or evidence scope from Renderer.

## Scenario: pinned Rail MCP error-text envelope

### 1. Scope / Trigger

- Applies to the pinned stdio deployment `12306-mcp@0.3.10` at the Rail MCP result boundary.
- The package returns both successful `format=json` payloads and known tool failures through the same standard MCP text envelope. Failure text begins with `Error:` and the package does not set `isError: true`.
- This compatibility rule is Rail-specific. It does not change Map, Hotel, Search, XHS, IPC, event, projection, or route-ranking contracts.

### 2. Signatures

- `RailToolResultSchema: ZodType<McpTextToolResult>`.
- `validatedTextResult(payloadSchema, json, envelopeSchema): ZodTypeAny`.
- `SOURCE_DEFINITIONS.SRC_RAIL.tools['get-tickets'].resultForArgs({ format: 'json' })`.

### 3. Contracts

- Input envelope remains `{ content: [{ type: 'text', text: string }, ...], isError?: boolean }` with at least one text item.
- After envelope validation, only `firstMcpText(result).trimStart().startsWith('Error:')` is normalized to `isError: true`.
- An explicit `isError: true` skips business-payload parsing and reaches the existing ToolRegistry error gate.
- A successful `get-tickets(format=json)` result must still parse as `RailTicketsSchema`; no arbitrary wrapper, Markdown, HTML, or `structuredContent` fallback is accepted.
- `MCP_TOOL_ERROR` is generic and value-free. The package error body must not enter `AppError`, logs, ToolCallAudit, JSONL, SQLite, IPC, Inspector, exports, Claims, or fixtures.
- Batch execution keeps retry at zero. An isolated tool error becomes one failed audited outcome; later ordered calls continue only while the existing source-health contract allows them.

### 4. Validation & Error Matrix

| Rail result | Classification | Persisted effects |
|---|---|---|
| Standard text envelope containing schema-valid ticket JSON | success | Normal sanitized audit and eligible Claim/event path |
| Standard text envelope whose trimmed first text starts with `Error:` | `MCP_TOOL_ERROR` | One failed sanitized audit; no Claim/event for that item |
| Standard text envelope with explicit `isError: true` | `MCP_TOOL_ERROR` | One failed sanitized audit; payload is not parsed or retained |
| Non-`Error:` malformed JSON or schema-invalid ticket JSON | `SOURCE_DRIFT` | Immediate Rail degradation under the existing contract; no Claim/event |
| Empty content, non-text content, or `structuredContent`-only result | `SOURCE_DRIFT` | No compatibility fallback and no raw retention |

### 5. Good / Base / Bad Cases

- Good: `{ content: [{ type: 'text', text: '[{"train_no":"x","start_time":"07:25","arrive_time":"09:00"}]' }] }` passes the Rail ticket schema.
- Base: `{ content: [{ type: 'text', text: '  Error: station lookup failed' }] }` becomes `isError: true`, then fails safely as `MCP_TOOL_ERROR` without exposing the body.
- Bad: treating every non-JSON string as a tool error, accepting `structuredContent`, copying the error body into diagnostics, or applying the Rail rule to another provider.

### 6. Tests Required

- Parse a pinned-package-style `Error:` envelope and assert `isError === true`.
- Parse an explicit MCP error envelope and assert business JSON parsing is skipped.
- Assert a valid ticket array succeeds.
- Assert malformed JSON, schema-invalid tickets, empty/non-text content, and `structuredContent`-only results remain rejected.
- Keep the focused contract test in the normal full suite; full lint, Node/Web typecheck, build, and default/no-gpu route smoke must remain zero-call.

### 7. Wrong vs Correct

#### Wrong

```ts
const tickets = RailTicketsSchema.parse(JSON.parse(firstMcpText(result)))
```

This assumes `format=json` guarantees JSON on package failures and misclassifies known tool errors as schema drift.

#### Correct

```ts
const envelope = RailToolResultSchema.parse(result)
if (envelope.isError) throw new AppError('MCP_TOOL_ERROR', 'Rail tool returned an error.')
const tickets = RailTicketsSchema.parse(JSON.parse(firstMcpText(envelope)))
```

The Rail boundary classifies the pinned package error convention, while successful payloads retain strict schema validation.

## Scenario: VariFlight Phase A discovery-only scaffold

### 1. Scope / Trigger

- Applies only to `M0-YUNNAN-MULTI-CITY`; it does not release a general M0 flight engine.
- `SRC_FLIGHT` exists in external-source health/config typing, but its production `tools`, allowlist and `probeTool` remain empty/null until an approved real `tools/list` freezes the exact contract.

### 2. Signatures

- `createVariflightGateR1Preview(options?): VariflightGateR1Preview` creates an in-memory, zero-call 30-minute plan.
- `replaceVariflightGateR1Preview(artifactPath, { allowedRoot, now?, planId?, operationId? }): Promise<VariflightGateR1Preview>` replaces only a safely replaceable stored plan.
- `claimVariflightGateR1(artifactPath, { planId, digest, operationId }, { allowedRoot, now? }): Promise<AuthorizedVariflightDiscovery>` consumes the disk authorization before runtime initialization.
- `consumeAuthorizedVariflightDiscovery(value, now?): asserts value is AuthorizedVariflightDiscovery` consumes the in-memory capability exactly once.
- `runVariflightDiscoveryOnce(registry, authorization, now?): Promise<VariflightDiscoveryOutcome>` is the only Gate-bound discovery probe.

### 3. Contracts

- Main uses one explicit legacy `SSEClientTransport`; it never falls back to Streamable HTTP. Connect has an outer deadline that also covers waiting for the legacy SSE endpoint event, and close is idempotent.
- `ToolRegistryService.discoverSourceDescriptorsOnce` may perform only connect + `tools/list` + close, once, without a tool call, registration, blocked-tool audit, ToolCallAudit, Evidence, event, cache, model call or source-result persistence.
- `probe:variflight:discovery:preview` is a zero-call developer acceptance entrypoint. It may replace only an artifact whose stored status and timestamps consistently prove expiry or prior consumption; a still-active pending plan, malformed digest, impossible `EXPIRED` state, symlinked artifact, path escape or concurrent lock fails closed.
- The execute entrypoint accepts only the exact `planId + digest + operationId` from the current 30-minute preview. Before any database, Cordis, session or network initialization it writes an operation-scoped consumed marker with exclusive create; immediately before discovery it consumes the frozen in-memory authorization capability. The same authorization/operation cannot be replayed after success or failure, while an independently previewed and approved new operation is not blocked by an older marker.
- A plan is executable only while `createdAt <= now < expiresAt` and `expiresAt - createdAt === 30 minutes`; a future-created plan is not yet authorized and fails before discovery.
- Main artifact changes use a same-directory exclusive temporary file, file sync, close and atomic rename. Reads bind an opened regular-file handle to the path `dev/ino` observed under the artifact lock. If the durable consumed marker exists but the main artifact rename did not finish, a zero-call replacement may recover only after the marker parses as `CONSUMED`, matches the old digest/plan and has valid timestamps.
- Neither preview nor execute accepts an endpoint or retry override. The endpoint digest, connect/list/close sequence, descriptor bounds, zero tool calls, zero retries and allowed retained fields are all part of the canonical plan digest.
- LOCAL tests use a loopback SSE fixture. The ModelScope endpoint, attachment examples and user-provided Ctrip screenshot are never contacted or treated as provider schema evidence.
- Any real discovery requires a fresh exact Gate R presented to and precisely approved by the user after preview generation. Generating or locally validating a preview is never approval. Route integration, flight Claims, Evidence source/migration and UI remain Phase B work after discovery.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Wrong/extra tuple field, malformed artifact/digest, unsafe path, symlink or replaced inode | `INPUT_INVALID`; zero context/network/tool calls |
| `createdAt > now`, invalid 30-minute TTL, or `expiresAt <= now` | `GATE_BLOCKED`; no consumed capability and zero discovery calls |
| Active pending plan without a matching consumed marker | preview replacement is `GATE_BLOCKED` |
| Existing operation-scoped consumed marker | execution is rejected before discovery |
| Valid marker plus stale pending main artifact after rename failure | zero-call preview replacement may recover to a new independent plan |
| Missing, mutated or replayed in-memory capability | `GATE_BLOCKED` or `INPUT_INVALID`; registry is not invoked |

### 5. Good / Base / Bad Cases

- Good: exact current tuple writes one durable marker, atomically marks the main artifact consumed, consumes the frozen capability once, lists bounded descriptors and closes once.
- Base: main artifact replacement fails after marker persistence; no discovery starts, the operation remains consumed, and a later zero-call preview safely recovers from the matching marker.
- Bad: accepting a future-created plan, writing the main artifact by truncation, following a replaced symlink, deleting a consumed marker to retry, or treating preview generation as approval.

### 6. Tests Required

- Cover exact tuple, expired and not-yet-valid windows, disk and in-memory replay, failure replay, frozen authorization, path containment, state/time inconsistency, active-plan replacement and operation isolation.
- Cover recovery from a matching consumed marker while the main artifact still says `AWAITING_EXACT_APPROVAL`; mismatched or malformed markers must fail closed.
- Assert successful claim/replacement leaves no temporary artifact, and keep the isolated preview CLI smoke at `externalCalls=0` and `toolCallAttempts=0`.
- Keep the focused Gate suite in the normal full test command; format, lint, Node/Web typecheck and production build must pass without contacting the endpoint.

### 7. Wrong vs Correct

#### Wrong

```ts
if (Date.parse(plan.expiresAt) > Date.now()) await discoverSourceDescriptorsOnce('SRC_FLIGHT')
await writeFile(artifactPath, JSON.stringify(consumed))
```

#### Correct

```ts
const authorization = await claimVariflightGateR1(artifactPath, exactTuple, {
  allowedRoot,
  now
})
await runVariflightDiscoveryOnce(registry, authorization, now)
```

The claim validates the not-before/expiry window, creates the one-shot marker and atomically updates the artifact before any runtime or network object exists.

## Scenario: VariFlight Phase B strict input and Gate R-2 LOCAL guard

### 1. Scope / Trigger

- Applies after Gate R-1 has discovered the real `getFlightPriceByCities` descriptor and before any result-shape call.
- This slice freezes the input/descriptor contract, zero-call approval artifact lifecycle, and a Gate-bound ToolRegistry result-shape runner. Installing the runner does not register a production tool, define a result schema, generate a workspace plan, or authorize a provider call.

### 2. Signatures

- `VariflightFlightPriceArgsSchema` validates `{ dep_city, arr_city, dep_date }`.
- `createVariflightGateR2Preview({ args, now?, planId?, operationId? }): VariflightGateR2Preview` is pure and zero-call.
- `writeVariflightGateR2Preview(artifactPath, { allowedRoot, args, now?, planId?, operationId? }): Promise<VariflightGateR2Preview>` writes/replaces only a safe local artifact.
- `claimVariflightGateR2(artifactPath, exactTuple, { allowedRoot, now? }): Promise<AuthorizedVariflightResultProbe>` consumes the disk operation.
- `consumeAuthorizedVariflightResultProbe(value, now?): asserts value is AuthorizedVariflightResultProbe` consumes the in-memory capability once.
- `VariflightFlightPriceDescriptorInputSchema` verifies that the discovered tool still exposes the exact three strict fields and patterns before a call.
- `runVariflightResultProbeOnce(registry, authorization, now?): Promise<VariflightResultProbeOutcome>` consumes the in-memory capability before ToolRegistry and is the only Gate-bound result-shape runner.
- `ToolRegistryService.runVariflightResultShapeProbeOnce({ args, timeoutMs: 15_000, operationId })` owns the single diagnostic session and returns only a `JsonStructureSummary` plus safe counters/status.
- Developer command: `npm run probe:variflight:result:preview -- --dep-city JHG --arr-city CAN --dep-date 2026-09-17`.
- Exact-approved execute command: `npm run probe:variflight:result -- --plan-id <id> --digest <digest> --operation-id <id>`.

### 3. Contracts

- `dep_city` and `arr_city` match `^[A-Z]{3}$`; `dep_date` is a valid `YYYY-MM-DD` calendar date; all three are required and additional properties are rejected. The boundary does not trim, uppercase, coerce, infer, or model-repair input.
- The canonical plan digest binds `SRC_FLIGHT`, fixed legacy SSE endpoint digest, tool name, input-contract version/digest, exact args, one session, one future tool-call attempt, zero retry, 15-second call budget, 30-minute validity, structure-only retention, and zero production-registration mutation.
- Preview generation and artifact writing perform no connect, `tools/list`, `tools/call`, ToolRegistry, ProviderRuntime, Evidence, event, database, cache, health, audit, or model operation.
- Disk claim requires the exact `planId + digest + operationId`, a current `createdAt <= now < expiresAt` window, current endpoint/input-contract digests, a regular in-root artifact, and an unused operation-scoped marker. The returned frozen capability is accepted once by the process-local consumer.
- The execute CLI accepts only the exact tuple. It claims disk authorization before temporary database, Cordis, session, or network setup; the runner consumes the frozen process capability before invoking ToolRegistry. Success or failure consumes the authorization permanently, and no endpoint/retry override is accepted.
- The ToolRegistry diagnostic fixes `SRC_FLIGHT/getFlightPriceByCities`, performs one `connect -> tools/list -> call -> close`, validates the live descriptor and read-only policy through a diagnostic-only allowlist, and never retries. Descriptor drift stops before call; tool error/non-JSON/protocol drift returns a safe failure without retaining text values.
- `SOURCE_DEFINITIONS.SRC_FLIGHT` remains `allowlist=[]`, `tools={}`, `probeTool=null`, `discoveryOnly=true`. The diagnostic-only allowlist is not a production registration and the runner does not write ToolCallAudit, Evidence, blocked-tool audit, events, database, cache, health, or source-result state.
- One separately approved Gate R-2 LIVE probe has completed and retained only value-free structure evidence. A separately approved Phase C LOCAL slice has implemented strict envelope/raw/normalized structure schemas and a synthetic fixture; Evidence/DB schema, production registration, provider value semantics, route materialization and UI remain unimplemented.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Lowercase/whitespace/non-three-letter city, impossible date, missing or extra field | `INPUT_INVALID`; zero external calls and no artifact claim |
| Wrong tuple, malformed/tampered artifact, unsafe path, symlink or replaced inode | `INPUT_INVALID`; no capability |
| Future `createdAt`, invalid TTL, expired plan, endpoint or input-contract drift | `GATE_BLOCKED`; no provider call |
| Active unconsumed preview replacement | `GATE_BLOCKED`; old plan remains unchanged |
| Concurrent/replayed disk claim | At most one succeeds; later claims fail before any runtime |
| Missing, mutated or replayed in-memory capability | `GATE_BLOCKED` or `INPUT_INVALID`; no runner is invoked |
| Missing/wrong discovered tool or descriptor inputSchema drift | Fail closed before call; `callAttempts=0`, close once |
| Tool error, non-JSON text or invalid MCP text envelope | Safe failure, zero retry, raw text/value retention remains false, close once |
| Any attempt to use the empty production allowlist | Existing production ToolRegistry policy blocks it; only the exact Gate-bound diagnostic method may use its local temporary allowlist |

### 5. Good / Base / Bad Cases

- Good: `JHG`, `CAN`, `2026-09-17` produces one local preview whose output reports zero external calls and zero allowlist mutations; an injected fake session then proves one connect/list/call/close and value-free shape output.
- Base: an exact current tuple produces one frozen capability in LOCAL tests; the same disk operation and capability both reject replay, including after a failed call.
- Bad: silently uppercasing `jhg`, accepting `2026-02-30`, populating `SRC_FLIGHT.tools`, guessing a response schema from the descriptor description, letting preview create a session, or calling the diagnostic without a consumed capability.

### 6. Tests Required

- Accept the exact three-field input and reject lowercase, whitespace, short codes, invalid calendar dates and extras.
- Assert preview plan bindings, `previewExternalCalls=0`, `retryCount=0`, structure-only retention, disabled production registration and the exact ToolRegistry-bound execution entrypoint.
- Cover new-artifact write, exact tuple, not-before/expiry, contract drift, concurrent disk claims, frozen/one-shot capability and replay rejection.
- With injected sessions, assert single connect/list/call/close, strict descriptor validation, pre-call drift rejection, failed-call replay rejection, non-JSON redaction, no audit/Evidence persistence, and zero production registration mutation.
- Assert production flight allowlist/tools stay empty/null/discovery-only, and keep R-1 regression tests in the same focused suite.
- Full format, lint, Node/Web typecheck, tests and production build must pass without invoking the preview command against the workspace or contacting VariFlight.

### 7. Wrong vs Correct

#### Wrong

```ts
const args = { dep_city: input.dep_city.trim().toUpperCase(), ...input }
SOURCE_DEFINITIONS.SRC_FLIGHT.allowlist.add('getFlightPriceByCities')
await registry.runStructureDiagnosticOnce('SRC_FLIGHT', args)
```

#### Correct

```ts
const args = VariflightFlightPriceArgsSchema.parse(input)
const preview = createVariflightGateR2Preview({ args }) // zero calls
const authorization = await claimVariflightGateR2(artifactPath, exactTuple, options)
await runVariflightResultProbeOnce(registry, authorization, now)
// SRC_FLIGHT production registration remains empty until value semantics and the production contract are separately approved.
```

The LOCAL contract fails closed on ambiguous input and proves the runner with injected sessions. The subsequently exact-approved LIVE Gate R-2 was consumed once and may be cited only as structure evidence; it cannot be presented as validated field values, flight facts, prices, inventory, or a production result contract.

### 8. Gate R-2 LIVE structure evidence

- Consumed plan: `e6c6727c-587d-4b33-a848-3d3b060095bb`; one connect, list, call and close; zero retry.
- Retained artifact: `.trellis/tasks/09-01-variflight-mcp-flight-query/gate-r2-result-shape-evidence.json`.
- Observed top-level paths: `code`, `data`, `message`, `request_id`, `timestamp`; `data` is an object array and `cabins` may be empty or an object array.
- `resultSchema=NOT_RUN`, `contractStatus=UNPROVEN`, raw values retained=false, production registration mutations=0. The consumed authorization cannot be replayed.

### 9. Phase C LOCAL structure contract

- `VariflightFlightPriceToolResultSchema` accepts exactly one strict MCP text content block. Explicit `isError=true` may carry opaque text; success text must parse as JSON and satisfy `VariflightFlightPriceRawSchema`. Extra envelope/content keys, additional content blocks, structuredContent-only and malformed JSON fail closed.
- Raw top-level keys are exactly `code`, `data`, `message`, `request_id`, `timestamp`. Flight/cabin objects accept only the keys and primitive types in the retained R-2 path/type summary and reject empty objects. Because that summary aggregates array members, member fields are optional rather than falsely claimed as required.
- `normalizeVariflightFlightPriceStructure` returns `VariflightFlightPriceNormalizedSchema` with `mappingStatus=LOCAL_STRUCTURE_ONLY`. Copied provider fields retain `Raw` names. Missing `cabins` is `null`; an observed empty array remains `[]`.
- Timestamp units/timezone, date formats, price units/currency, share/stop semantics and RouteLeg derivations are not proven. `startAt`, `endAt`, `durationMinutes`, `costCents`, `currency`, `transferCount` and `overnightArrival` stay null; no Claim or RouteLeg may be produced from this contract.
- The synthetic fixture is LOCAL-only and must not contain or impersonate unretained LIVE provider values. Production `SRC_FLIGHT` remains `allowlist=[]`, `tools={}`, `probeTool=null`, `discoveryOnly=true`.
- Required regression coverage: empty data/cabins; missing-vs-empty cabins; unknown keys at envelope/raw/item/cabin levels; primitive drift; empty member objects; explicit tool errors; malformed JSON; and no invented business semantics.
- The Gate-bound pre-contract runner additionally covers explicit tool-error redaction with unchanged source health, one-attempt `MCP_TIMEOUT` with retry zero and close once, replay rejection after timeout, close-failure classification as `MCP_PROTOCOL_ERROR`, zero ToolCallAudit/Evidence persistence, and the retained manual alternative. These tests do not satisfy the future production health/audit/degradation contract.

## Scenario: VariFlight Gate R-3 LOCAL value-free semantics diagnostic

### 1. Scope / Trigger

- Applies only after the Gate R-2 structure evidence and Phase C LOCAL structure contract exist, and before any production `SRC_FLIGHT` registration or route integration.
- This slice installs a pure value-free classifier, an independent Gate R-3 preview/claim lifecycle, and a ToolRegistry-bound one-shot diagnostic runner. It does not generate a workspace preview, contact VariFlight, prove provider business semantics, or authorize production use.

### 2. Signatures

- `classifyVariflightValueSemantics(raw, approvedArgs): VariflightSemanticSummary` runs only in memory and returns fixed enums, booleans, counts, and JSON Pointer paths.
- `createVariflightGateR3Preview({ args, now?, planId?, operationId? }): VariflightGateR3Preview` is pure and zero-call.
- `writeVariflightGateR3Preview(artifactPath, options): Promise<VariflightGateR3Preview>` writes or safely replaces only the independent `gate-r3-preview.json` artifact.
- `claimVariflightGateR3(artifactPath, exactTuple, options): Promise<AuthorizedVariflightSemanticProbe>` consumes the disk operation before runtime initialization.
- `consumeAuthorizedVariflightSemanticProbe(value, now?): asserts value is AuthorizedVariflightSemanticProbe` consumes the frozen process capability once.
- `runVariflightSemanticProbeOnce(registry, authorization, now?): Promise<VariflightSemanticDiagnosticOutcome>` is the only Gate-bound semantics runner.
- `ToolRegistryService.runVariflightSemanticProbeOnce({ args, timeoutMs: 15_000, operationId })` owns one diagnostic session and returns only the value-free semantic summary plus safe counters/status.
- Developer commands are `probe:variflight:semantics:preview` and `probe:variflight:semantics`; neither command is part of normal application startup.

### 3. Contracts

- The classifier output contract is `variflight-value-semantics-classifier/v1`. It never returns field values, raw response text, flight numbers, city/airport names, dates, timestamps, prices, hashes, or reversible encodings.
- Classification is limited to `FORMAT_AND_CONSISTENCY_ONLY`: bounded path/type presence, string-format buckets, numeric finite/integer/non-negative facts, approved-input binding booleans, flight/cabin counts, and duplicate counts. `contractStatus` remains `UNPROVEN`.
- Timestamp units/timezone, currency, price/fee units, starting-price meaning, inventory/bookability, stop/share enum definitions, and top-level `code` mapping remain `UNPROVEN` unless a future authority source explicitly defines them. Field names and a single sample cannot upgrade them.
- The classifier accepts at most 64 flights and 64 cabins per flight. Exceeding a bound or encountering a structure-contract drift fails with `SOURCE_DRIFT`; no partial summary is retained.
- The Gate R-3 canonical digest binds the fixed endpoint, R-2 input-contract digest, classifier-contract digest, exact strict args, one session, one connect/list/call/close, retry zero, 15-second budgets, 30-minute validity, value-free retention, and zero production registration mutation.
- Gate R-3 has its own artifact, lock and operation-scoped consumed marker. Disk claim and process capability are both one-shot; exact tuple, not-before, expiry, digest drift, path/inode safety and replay are checked before session creation.
- The ToolRegistry diagnostic fixes `SRC_FLIGHT/getFlightPriceByCities`, validates the live descriptor and strict result envelope/raw schema, runs the classifier in memory, then discards raw values. It uses only a temporary diagnostic allowlist and writes no ToolCallAudit, Evidence, event, database, cache, health, Claim or route state.
- `SOURCE_DEFINITIONS.SRC_FLIGHT` remains `allowlist=[]`, `tools={}`, `probeTool=null`, `discoveryOnly=true`. Installing the R-3 code does not generate a preview and does not authorize a provider call.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Invalid/extra args or contract/digest drift | `INPUT_INVALID` or `GATE_BLOCKED`; zero external calls |
| Future-created, expired, replayed or concurrently claimed plan | fail closed before runtime; at most one disk claim succeeds |
| Missing/wrong descriptor or inputSchema drift | safe failure; `callAttempts=0`, close once |
| Connect or list failure | safe value-free failure; no provider call, close once |
| Tool error, timeout, non-JSON, strict envelope/raw drift, classifier bound breach | safe value-free failure; call at most once, retry zero, authorization consumed |
| Successful call followed by close failure | overall `MCP_PROTOCOL_ERROR`; semantic summary discarded |
| Currency/unit/timezone/enum definitions absent | diagnostic may succeed, but those dimensions remain `UNPROVEN` |
| Any raw/value leakage or persistence mutation | Gate failure; output is not admissible evidence |

### 5. Good / Base / Bad Cases

- Good: an injected strict response produces only fixed paths, enum states, booleans and counts; approved request bindings are classified without emitting either side's values.
- Base: a valid single sample has consistent city/date fields while currency, units, time semantics, inventory and stop/share meanings remain `UNPROVEN`.
- Base: connect/list failure returns safe counters and error code, with no call, retry, audit, Evidence or health mutation.
- Bad: retaining a flight number or price in the summary, hashing raw values, inferring milliseconds from magnitude, treating `seatnum` as bookable inventory, or mapping `code` by convention.
- Bad: sharing the R-2 artifact/consumed marker with R-3, generating a workspace preview as part of tests, or populating the production allowlist to make the diagnostic run.

### 6. Tests Required

- Classifier tests cover empty/missing arrays, input-binding consistency, string-format and numeric buckets, duplicate counts, conservative unknown semantics, strict schema drift, and 64-item bounds without value leakage.
- Gate tests cover pure zero-call preview bindings, exact tuple, unknown fields, not-before/expiry, contract drift, disk and memory replay, concurrent claims, operation isolation and safe artifact replacement.
- Injected runner tests cover one connect/list/call/close, descriptor drift before call, connect/list/tool/timeout/close failures, authorization replay rejection, and zero ToolCallAudit/Evidence/health/production-registration mutation.
- Full format, lint, Node/Web typecheck, test and production build must pass without invoking either workspace preview or execute CLI and without contacting VariFlight.

### 7. Wrong vs Correct

#### Wrong

```ts
const currency = raw.data[0]?.cabins?.[0]?.price ? 'CNY' : null
SOURCE_DEFINITIONS.SRC_FLIGHT.allowlist.add('getFlightPriceByCities')
await runVariflightSemanticProbeOnce(registry, authorization)
```

#### Correct

```ts
const summary = classifyVariflightValueSemantics(raw, approvedArgs)
// summary.classificationStatus === 'FORMAT_AND_CONSISTENCY_ONLY'
// summary.contractStatus === 'UNPROVEN'
// production SRC_FLIGHT registration remains empty
```

The LOCAL classifier and one-shot runner establish a safe historical diagnostic path. They do not establish provider value semantics, produce flight facts, authorize replay, or transfer authorization to FlyAI.

### 8. Gate R-3 LIVE format/consistency evidence

- Consumed plan: `705c378d-2954-466b-a083-6db956a39149`; one connect, list, call and close; retry zero; strict result schema valid.
- Retained artifact: `.trellis/tasks/09-01-variflight-mcp-flight-query/gate-r3-value-semantics-evidence.json`. It contains only paths, fixed enums, booleans and counts; raw/value retention and ToolCallAudit/Evidence/DB/cache/health/production-registration writes are zero.
- The single response contained two bounded flight members and one cabin member. The response city/date fields were format-valid and consistent with the approved input; date strings were format-valid and arrival dates were not earlier than departure dates in both comparable members.
- Planned-time fields were finite non-negative integers, but unit and timezone remain `UNKNOWN`. Price/stprice/seat fields were finite and non-negative where present, but currency, unit, starting-price meaning, inventory/bookability, stop/share enums and top-level code mapping remain `UNPROVEN`.
- `classificationStatus=FORMAT_AND_CONSISTENCY_ONLY` and `contractStatus=UNPROVEN` are final for this evidence. The consumed Gate cannot be replayed, and this evidence does not authorize a production result contract, `SRC_FLIGHT` registration, Claims, route materialization or UI.

## Scenario: FlyAI Phase A LOCAL CLI scaffold

### 1. Scope / Trigger

- Applies only to personal local research for `M0-YUNNAN-MULTI-CITY` after RollingGo Flight became unavailable. It is not a general flight engine and does not replace or reinterpret historical VariFlight evidence.
- Phase A authorized exact dependency installation, encrypted credential plumbing, a Main-only UtilityProcess runner, an independent Gate and local tests. Separate fresh approvals later authorized one Gate v4 preview and its exact-tuple execution; that authorization is consumed and does not authorize production registration, Claims, route materialization, UI, or another call.

### 2. Signatures

- `parseFlyaiFlightSearchInput(value, now?): FlyaiFlightSearchInput` accepts the strict Chinese-city/future-date request.
- `inspectFlyaiBundle(paths): Promise<FlyaiBundleBinding>` validates package metadata plus separate regular-file/realpath, SHA-256 and path digests for the bundle and local argv launcher without loading the bundle.
- `runFlyaiFlightCliStructureProbe(input, { executor, onProcessAttempt? }): Promise<FlyaiCliStructureResult>` owns one isolated process and returns only a value-free JSON structure summary.
- `flyaiFlightProbeErrorCode(error: unknown): ErrorCode` delegates to `serializeError` and is the only execute-entry error classifier.
- `create/write/claim/consumeFlyaiFlightGate*` own the independent 30-minute preview, disk claim and process capability.
- `ToolRegistryService.runFlyaiFlightStructureProbeOnce(...)` is the only Gate-bound entry and bypasses production source preparation/session/health/audit/persistence.
- Developer preview: `npm run probe:flyai:flight:preview -- --origin <ChineseCity> --destination <ChineseCity> --dep-date <future-YYYY-MM-DD>`; exact-approved execute: `npm run probe:flyai:flight -- --plan-id <id> --digest <digest> --operation-id <id>`. The underlying execute script is exactly `electron . -- --probe-flyai-flight-once`; the separator is part of the contract.

### 3. Contracts

- Dependency is exactly `@fly-ai/flyai-cli@1.0.16`. Package name/version, registry integrity, `bin.flyai`, Node engine, direct dependencies, absent install lifecycle scripts, regular-file/realpath, bundle SHA-256 and development/packaged path digest are fail-closed bindings. `resources/flyai-utility-process-launcher.cjs` has its own fixed regular-file/realpath, SHA-256 and path digest binding. Packaged execution resolves both only from `app.asar.unpacked`.
- The fixed vendor bundle contains an embedded credential fallback and `x-ff-ctx` handling. Runtime must read `FLYAI` from the existing Electron safeStorage channel and explicitly set `FLYAI_API_KEY`; an absent credential fails before `executor.fork`. The embedded value must never be reproduced or retained.
- Input is strict `{ origin, destination, depDate }`: origin/destination are unchanged Chinese city strings, depDate is a valid local calendar date strictly after the injected current date, and no trimming, coercion, normalization or extra keys are allowed.
- The runner uses Electron Main `utilityProcess.fork` only. Commander parses Electron UtilityProcess user arguments from argv[1], so the runner forks the fixed launcher with `[absoluteBundlePath, search-flight, --origin, ...]`; the launcher removes its own and the target-module slots, normalizes `search-flight` to argv[1], then loads the fixed bundle. Direct bundle fork, shell, PATH and npx fallback are forbidden. The process uses isolated temporary cwd/HOME/USERPROFILE, a minimal environment, ignored stdin and bounded stdout/stderr. Before fork it creates or reads one application-private non-secret UUID seed at `<userData>/flyai-runtime/device-id` and stages only that seed into the temporary HOME's `.flyai/device-id`; FlyAI config and credentials remain non-persistent. There is one CLI process attempt, zero application retries, a 15-second timeout, 1 MiB stdout limit and 8 KiB stderr limit.
- Sandbox removal uses bounded local filesystem retries to tolerate delayed Windows working-directory release. Exhaustion becomes `INTERNAL_INVARIANT_VIOLATED`; the raw filesystem error remains only as a Main-process cause. This does not retry the CLI or provider.
- Execute-entry failures always use the shared `serializeError` mapping. Unknown errors become `INTERNAL_ERROR`; ad-hoc `PROBE_FAILED` output is forbidden.
- The process-attempt observer changes from 0 to 1 immediately at the `executor.fork` boundary, including a fork that throws; bundle/Gate/credential/executor preparation failures remain 0. Timeout, cancel, fatal error, missing pipes or overflow terminate the process, await exit and reject if PID remains.
- stdout must be strict UTF-8 containing exactly one JSON line. It is immediately reduced to `JsonStructureSummary`. On a non-zero exit, `flyai-cli-stderr-classifier/v2` holds at most 8 KiB stderr only in memory and normalizes it to `HTTP_401 | HTTP_403 | HTTP_429 | HTTP_451_RISK_CONTROL | HTTP_OTHER_4XX | HTTP_5XX | CLI_USAGE_ERROR | JSON_RPC_ERROR | NETWORK_ERROR | INVALID_RESPONSE | UNKNOWN`; other `MCP HTTP nnn` values map to `INVALID_RESPONSE`. The first `Body:` line terminates diagnostic input, data listeners remain until the exit microtask settlement, only the fixed `failureCategory` may leave the runner, and buffered bytes are cleared. No raw stdout/stderr, scalar values, key, environment, provider URL, query or reversible digest enters the outcome, logs, artifact, Evidence, database, cache, health or UI. The 451 category describes the matched status form, not a proven provider root cause.
- Gate artifact, lock, operation-scoped consumed marker, private authorization Symbol and in-memory WeakSet are FlyAI-specific. Future previews use `flyai-flight-gate/v4`; the canonical digest binds package/integrity/bin/engine/dependencies, bundle hash/path digest, launcher relative path/hash/path digest, `flyai-utility-process-launcher/v1` target-module/normalized-command indexes, input contract, exact args, one CLI process, zero application retry, internal provider counts `UNKNOWN`, time/output limits, credential ID, application-private persistent device identity, classifier-v2 version/categories, value-free retention and zero production mutations. Legacy v1/v2/v3 artifacts remain parseable for historical replacement checks but are not executable. Disk claim precedes bootstrap/credential/executor work; ToolRegistry consumes the process capability before bundle inspection.
- `SOURCE_DEFINITIONS.SRC_FLIGHT` remains `allowlist=[]`, `tools={}`, `probeTool=null`, `discoveryOnly=true`. Existing `USER_RESEARCH / VERIFIED_BY_USER` manual flight evidence remains available and distinct from system `VERIFIED` evidence.
- One exact-approved Gate v4 execution completed with `LIVE_STRUCTURE_ONLY`: `stage=run`, one CLI process, zero application retries, internal provider request/retry `UNKNOWN`, and no raw/value retention. The retained summary proves only `data.itemList` length 10, `journeys` length 1, `segments` lengths 1 or 2, and observed member path/types; it does not prove scalar values, field semantics, price, inventory, flight facts, or production admissibility. The Gate is consumed and cannot be replayed.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Wrong/extra/normalized city or invalid/non-future date | `INPUT_INVALID`; no artifact claim or process |
| Package, bundle, launcher, path or authorization drift | `SOURCE_DRIFT` / `GATE_BLOCKED`; credential and process remain untouched where applicable |
| Missing encrypted credential | `SOURCE_UNCONFIGURED`; `cliProcessAttempts=0` |
| Device identity missing/corrupt/non-regular or cannot be staged | `INTERNAL_INVARIANT_VIOLATED`; `cliProcessAttempts=0` |
| fork throws or process exits non-zero | safe SOURCE/MCP error; `cliProcessAttempts=1`, no retry |
| timeout/cancel/fatal/missing pipe/stdout-stderr overflow | terminate, await exit, reject safely; no raw retention |
| PID remains after termination/exit | `INTERNAL_INVARIANT_VIOLATED` |
| Windows sandbox removal remains blocked after bounded local retries | `INTERNAL_INVARIANT_VIOLATED`; no raw path/error leaves Main |
| multiline/non-JSON/invalid UTF-8 stdout | `SOURCE_DRIFT`; no values retained |
| replayed/concurrent/expired/not-yet-valid Gate | fail before another process attempt |
| Unknown execute-entry exception | `INTERNAL_ERROR`; never `PROBE_FAILED` |

### 5. Good / Base / Bad Cases

- Good: the execute npm script places a literal `--` between `electron .` and application arguments; a path-only launch with dummy Gate arguments reaches Main and reports every external/process/credential counter as zero.
- Base: Windows delays releasing the sandbox cwd after exit; bounded local deletion retries succeed without changing CLI/provider attempt counts.
- Bad: omitting the Electron separator, exposing a raw `fs.rm` error/path, treating filesystem cleanup retries as provider retries, or returning the unregistered `PROBE_FAILED` string.

### 6. Tests Required

- Strict input and fixed args; legacy credential-file compatibility, safeStorage save/read/clear and Renderer non-reveal.
- Package/bundle/launcher/path binding, development and packaged `app.asar.unpacked` path-only smoke without requiring or executing the real FlyAI bundle.
- A real Electron UtilityProcess + harmless Commander fixture must reproduce the direct-load argv failure and prove the launcher places `search-flight` at argv[1].
- Fake executor success and failure matrix, exact 0/1 process-attempt accounting, stable device identity across distinct ephemeral homes, timeout/cancel/termination/exit, bounded value-free output, fixed stderr categories without raw text, cleanup failure redaction and stable top-level error classification.
- A package-script regression asserts the literal Electron argument separator; a zero-call Electron path-only smoke supplies plan/digest/operation arguments and proves `externalCalls=0`, `cliProcessAttempts=0`, and `credentialReads=0`.
- Gate canonical digest, exact tuple, validity window, path/inode/lock safety, concurrent claim, disk/in-memory replay and failure consumption.
- ToolRegistry isolation from production session, source health, ToolCallAudit, Evidence, database, cache, route and UI; production `SRC_FLIGHT` stays closed.

### 7. Wrong vs Correct

#### Wrong

```ts
await utilityProcess.fork(bundlePath, userArgs, { env: process.env })
SOURCE_DEFINITIONS.SRC_FLIGHT.allowlist.add('search-flight')
// package.json: "probe:flyai:flight": "electron . --probe-flyai-flight-once"
const code = error instanceof AppError ? error.code : 'PROBE_FAILED'
```

#### Correct

```ts
const authorization = await claimFlyaiFlightGate(artifactPath, exactTuple, gateOptions)
await tools.runFlyaiFlightStructureProbeOnce({ authorization, runtimePaths, onProcessAttempt })
// package.json: "probe:flyai:flight": "electron . -- --probe-flyai-flight-once"
// runner forks the hash-bound launcher, which normalizes search-flight to argv[1]
const code = flyaiFlightProbeErrorCode(error)
// one isolated process, value-free summary, production SRC_FLIGHT unchanged
```

Phase A completion and the 2026-09-03 failure fix are LOCAL evidence only. Historical Gate v2/v3 failures remain consumed; the later Gate v4 succeeded only at `LIVE_STRUCTURE_ONLY`. Internal provider request/retry counts remain `UNKNOWN`. Any further execution needs a fresh current-version zero-call preview and separate approval before one CLI process may run.

### 8. Repeated one-shot failure diagnosis

- A later exact-approved Gate v2 also consumed once and returned `MCP_TOOL_ERROR / UNKNOWN`, with one CLI process attempt, zero application retries and no admissible structure evidence.
- `UNKNOWN` is not an adequate diagnosis for the pinned vendor bundle. Static inspection proves that `MCP HTTP 451: ...`, `MCP: no body for SSE response`, generic 4xx statuses and CLI usage errors can all collapse into that one category. The official FlyAI repository also has an open `search_flight` HTTP 451 risk-control report for the same endpoint.
- The displayed `UNKNOWN` is therefore a confirmed cross-layer classifier coverage defect. HTTP 451 risk control is the leading provider-side hypothesis, but it is not a retained fact because raw stderr was correctly cleared and the consumed plan may not be replayed.
- The separately approved LOCAL change is complete: `flyai-cli-stderr-classifier/v2` distinguishes 451, other 4xx, SSE no-body and CLI usage failures while keeping raw stderr/body forbidden; focused 28/28 and full 295/295 tests pass.
- Future previews use `flyai-flight-gate/v3` and bind the classifier-v2 version and exact category list. Historical v1 and classifier-v1 v2 artifacts remain parseable for audit but fail execution policy; no preview or capability was generated by this LOCAL change.
- A local Windows UtilityProcess fixture delivered stderr before `exit`; the exit/drain race was not reproduced. Stable device identity, non-empty credential gating and current-run sandbox cleanup were independently confirmed, so they are no longer the leading hypotheses.
- A later `MCP_TOOL_ERROR / CLI_USAGE_ERROR` was reproduced offline with a real Electron UtilityProcess and a harmless Commander command: direct module loading left the module path at argv[1], so `search-flight` was not selected and `--origin` was rejected. The hash-bound launcher normalizes the command to argv[1]; focused 26/26 and full 298/298 tests pass. Future previews therefore use Gate v4 and historical v1/v2/v3 remain non-executable.

## Scenario: FlyAI Phase C LOCAL strict result contract

### 1. Scope

- Applies only to pure LOCAL parsing of synthetic payloads shaped by the consumed Gate v4 value-free path/type/array-length evidence.
- It does not alter the Gate v4 structure runner, retain a real payload, read credentials, start FlyAI, register `SRC_FLIGHT`, or produce Evidence, Claims, RouteLegs, events, database/cache/health writes, route state, or UI.

### 2. Contracts

- `FLYAI_FLIGHT_RESULT_CONTRACT_VERSION` remains the historical structure-probe binding. Phase C adds a separate `FLYAI_FLIGHT_LOCAL_RESULT_CONTRACT_VERSION = flyai-search-flight-result/local-structure-v1`; changing the consumed Gate binding is forbidden.
- `FlyaiFlightSearchRawSchema` strictly requires top-level `data`, `message`, `status`, and `systemMessage`; `data` strictly contains `itemList`.
- Item, journey, and segment schemas allow only keys and primitive types observed by Gate v4. Because the evidence aggregates array members, member fields are optional. Empty member objects, unknown keys, and type drift fail closed.
- Fields observed only as null (`systemMessage`, `tags`, `depCityAbroad`, `miles`, `quantity`, `stopInfos`) remain null-only until stronger evidence exists.
- `normalizeFlyaiFlightSearchStructure` outputs `mappingStatus=LOCAL_STRUCTURE_ONLY`, copies provider fields only to names ending in `Raw`, and fixes unproven time, duration, amount, currency, and transfer semantics to null.
- The production CLI runner continues to return only `JsonStructureSummary`; Phase C schema/normalizer is not wired into that path.

### 3. Validation

- Synthetic one-segment and two-segment cases prove accepted nesting without representing real flight facts.
- Negative cases cover top/data/member unknown keys, empty item/journey/segment objects, primitive type drift, and null-only field drift.
- Focused 10/10, full 301/301, format/lint, Node/Web typecheck, and production build pass with zero external calls, CLI process attempts, and credential reads.

## Route selection handoff to D4

- Selecting a route initializes one ordered research state per route node. Nodes containing MUST_GO places are `REQUIRED`; an optional route node not selected by the engine is represented as `SKIPPED`, not as an unresolved research task.
- The exact mappings are Dali→Erhai, Lijiang→Jade Dragon Snow Mountain, and Xishuangbanna→Xishuangbanna. Do not derive these from display-string substring matching.
- Every D4 command must resolve the currently selected route and node from main-process state. Renderer-provided route/node identity is only a reference to validate, never authority.
- Route selection remains the sole STAGE-2→STAGE-3 transition; the final required node confirmation is the sole multi-city D4 STAGE-3→STAGE-4 transition.
- The same frozen route/node/leg/segment identities continue through route-D5 and unified D6/D7. Timeline, tasks, Gate blockers and whole-route export must not reconstruct identity from display strings or split the selected route into separate sessions.
