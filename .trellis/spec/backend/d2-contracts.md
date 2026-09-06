# D2 Interview, Provider, and Split Contracts

## Scenario: BUILD-D2 cross-layer flow

### 1. Scope / Trigger

- Applies to model-channel routing/calls, STAGE-1 interview state, envelope decisions, split recovery, and their IPC/UI consumers.
- Triggered by changes to `provider-config.json`, `model_calls`, D2 event payloads, Coordinator commands, or CHAT IPC.

### 2. Signatures

- `ProviderRuntime.invokeStructured<T>({ sessionId, role, system, user, schema }): Promise<T>`.
- `buildChatRequest({ profile, baseUrl, apiKey, model, system, user, signal }): ModelGatewayRequest`.
- `resolveModelRoute(config, role): ResolvedModelRoute`.
- `provider:save` accepts only `ProviderConfig { version: 2, channels, roles }`; `provider:get` returns the additive `ProviderConfigSummary`.
- `CoordinatorService.submitChatTurn(sessionId, text): Promise<ChatTurnOutcome>`.
- `CoordinatorService.confirmBasics(sessionId): Promise<SessionSummary | ChatTurnOutcome>`.
- `CoordinatorService.chooseEnvelope(request): Promise<SessionSummary[]>`.
- `TravelBasics.itineraryIntent` is either `null` or a strict `MULTI_CITY_ROUTE` intent whose `destinationCities` equal the mandatory node-city set without order semantics.
- `deriveMultiCityItineraryGoal(basics): ItineraryGoal` is the only D2-to-route goal derivation entry point.
- Migration `0002_model_call_cost.sql` adds `cost_status`, `cost_currency`, and input/output rate snapshots to `model_calls`.

### 3. Contracts

- Version 2 stores two explicit channels, `DEEPSEEK_OFFICIAL` and `SHUAI_API`; each required `EXTRACTION`, `PLANNING`, `REVIEW`, and `VISION` role selects one channel, one model, one currency, and optional input/output rate snapshots.
- Channel `baseUrl` values are HTTPS origins without a path, query, or fragment. The internal gateway owns the fixed `/v1/chat/completions` suffix.
- Provider config contains no key. `DEEPSEEK_OFFICIAL` reads the existing `DEEPSEEK` safeStorage credential; `SHUAI_API` reads its own `SHUAI_API` credential.
- Version 1 files remain readable and are never rewritten during read. Only an explicit Settings save writes version 2.
- `provider:get` preserves the legacy `provider`, `baseUrl`, and `models` summary fields and adds `version` plus resolved `routes`; version 2 returns `provider: null` and `baseUrl: null`.
- Routing is determined only by `roles[role].channel`. Model names never select a channel, and the gateway performs no retry or fallback. The single schema-repair invocation remains a separate, explicit `ProviderRuntime` call.
- Every network attempt writes one audit row; raw prompt, raw response, and key are never persisted or sent to the renderer.
- New events use `eventVersion: 2`. D1 events without a version remain readable.
- Split intent is the parent's `envelope/decision`; its immutable `splitPlan` contains all child IDs, event IDs, timestamps, basics, contiguous indexes, handoffs, and DecisionLog identity.
- A valid strict multi-city intent uses the additive one-session envelope: one origin, 2-6 destination nodes, 3-31 days, 2-8 stay segments, and the existing traveler bounds. It never calls `buildSplitPlan` and array order never becomes route order.
- Missing or invalid itinerary intent keeps the legacy envelope unchanged. The wider envelope must never be inferred merely from multiple `destinationCities`.
- IPC errors expose only `{ code, klass, userHint }`. An out-of-envelope chat failure additionally carries a structured comparison.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Missing config or key | `PROVIDER_UNCONFIGURED` or `MODEL_UNAUTHORIZED`; no request |
| Non-HTTPS or path-bearing channel root | schema rejection; no save and no request |
| `401` / `403` | `MODEL_UNAUTHORIZED` with credential vs policy-specific fixed hint |
| `429` + `insufficient_quota` | `QUOTA_EXHAUSTED` classification; no automatic retry |
| Other `429` | `RATE_LIMITED` classification; no automatic retry |
| `404`, `413`, `5xx`, or unknown response | fixed safe category/hint; no raw provider body retained |
| First invalid model JSON | exactly one repair call |
| Second invalid model JSON | `MODEL_OUTPUT_INVALID`; no TravelState event |
| More than one destination | `INPUT_OUT_OF_ENVELOPE`; comparison; no stage advance |
| Valid strict multi-city intent within its bounds | one session; no split plan; preserve region goal and MUST_GO set |
| Multi-city destinations differ from mandatory node-city set | schema rejection; no wider envelope and no route preview |
| Illegal V2 stage skip/backtrack | `EVENT_INVALID` before append |
| Planned event ID with different content | `INTERNAL_INVARIANT_VIOLATED`; fail closed |
| Fuzzy destination before D3 sources | `GATE_BLOCKED`; persist criteria, do not invent candidates |

### 5. Good / Base / Bad Cases

- Good: EXTRACTION explicitly selects `SHUAI_API`, the gateway calls `https://api.shuaiapi.com/v1/chat/completions`, audits `provider='SHUAI_API'`, and never consults the model name for routing.
- Base: a version 1 Provider file is resolved through the legacy profile, summarized additively, and left byte-for-byte unchanged until the user saves version 2.
- Base: D1 `session/created` and forward-only legacy `stage/confirmed { stage }` replay with V2 defaults.
- Good: `云南` plus unordered `{大理, 丽江, 西双版纳}` and three MUST_GO places survives interview confirmation and passes the strict multi-city envelope without asking for route order or Kunming preference.
- Bad: treating the input array as a route, silently enabling the wider envelope for legacy multi-destination input, or asking the user to decide whether Kunming is needed before evidence-backed route comparison.
- Bad: appending `/v1` in Settings and again in the gateway, silently changing channels after `429`, or persisting a provider error body.
- Bad: placing the legacy `session/created` Zod branch first. Zod strips unknown V2 fields and silently loses linked-group/basics data.
- Bad: executing `0001_init.sql` inside a transaction without removing runtime `PRAGMA journal_mode`; SQLite rejects the migration.

### 6. Tests Required

- D1 database + `0002` migration, idempotent second run, and column assertions.
- Version 2 atomic save/summary, version 1 read-without-rewrite, explicit role-to-channel credential selection, fixed path construction, response normalization, safe error classification, and one audit row per attempt.
- SETTINGS Electron smoke saves two channel roots plus four explicit role routes and asserts zero external calls.
- Five-turn canonical interview and exact two-attempt invalid-output audit.
- Multi-city extraction/confirmation preserves region goal, MUST_GO mapping, and unordered node-city equality; strict intent passes its one-session envelope while identical legacy input remains out of envelope.
- Exact envelope violation, split/shrink four-axis comparison, and no `stage/confirmed` before choice.
- Split child indexes/group/DecisionLog/handoff assertions plus delete-DB replay.
- IPC request/result parsing, error redaction, Node/Web type checks, lint, and Electron build.

### 7. Wrong vs Correct

#### Wrong

```ts
z.union([LegacySessionCreatedPayloadSchema, SessionCreatedV2PayloadSchema])
database.transaction(() => database.exec(migration1Sql))()
const channel = config.roles[role].model.includes('deepseek') ? 'DEEPSEEK_OFFICIAL' : 'SHUAI_API'
for (let attempt = 0; attempt < 3; attempt += 1) await callProvider(channel)
const routeOrder = basics.destinationCities // input order is not a route decision
```

#### Correct

```ts
z.union([SessionCreatedV2PayloadSchema, LegacySessionCreatedPayloadSchema])
database.transaction(() => database.exec(stripRuntimePragmas(migration1Sql)))()
const route = resolveModelRoute(config, role)
await callProvider(route) // one network attempt; no hidden fallback/retry
const goal = deriveMultiCityItineraryGoal(basics) // route engine chooses bounded orders
```

The event ordering preserves additive fields. The migration form keeps connection PRAGMAs in `openDatabase()` while schema DDL remains transactional. Explicit route resolution prevents model-name inference and unapproved provider switching.
