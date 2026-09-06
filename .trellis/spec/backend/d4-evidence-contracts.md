# D4 Destination and Evidence Contracts

## Scenario: BUILD-D4 destination convergence and evidence-governed research

### 1. Scope / Trigger

- Applies to STAGE-2 fixed-destination confirmation and destination candidates, STAGE-3 research, Source Subagent isolation, SKILL-03/04/05, EvidenceClaim verification, ResearchEntity projection, D4 SessionEvents, IPC, CHAT/EVIDENCE UI, and replay.
- Triggered by changes to `src/shared/schema/d4.ts`, D4 event variants, Coordinator D4 methods, entity resolution, source task permissions, research confirmation gates, or D4 renderer cards.
- Authoritative product semantics remain in `PRD:FR-201..308`, `PRD:verificationGate`, and `PRD:AC-M0-10..13`.

### 2. Signatures

- `CoordinatorService.generateDestinationCandidates(request, onProgress?): Promise<D4Snapshot>`
- `CoordinatorService.confirmFixedDestination(request): Promise<D4Snapshot>`
- `CoordinatorService.selectDestination(request): Promise<D4Snapshot>`
- `CoordinatorService.prepareResearch(request, onProgress?): Promise<D4Snapshot>`
- `CoordinatorService.prepareManualResearch(request): Promise<D4Snapshot>`
- `CoordinatorService.addUserPaste(request): Promise<EvidenceClaim>`
- `CoordinatorService.setResearchDisposition(request): Promise<D4Snapshot>`
- `CoordinatorService.resolveResearchConflict(request): Promise<D4Snapshot>`
- `CoordinatorService.confirmResearch(request): Promise<D4Snapshot>`
- `SourceSubagentRunner.runSerial(tasks, operationId?): Promise<SourceSubagentResult[]>`
- `buildResearchEntities({ destinationCity, claims, kinds, aliases, travelers }): ResearchEntity[]`
- `materializeFacts(sessionId, destinationCity, sourceClaims, extraction): ResearchSkillOutput`
- IPC invoke channels: `destination:generate`, `destination:confirm-fixed`, `destination:select`, `research:prepare`, `research:manual-checklist-prepare`, `research:user-paste`, `research:disposition`, `research:conflict-resolve`, `research:confirm`, `d4:snapshot`, `d4:cancel`.
- IPC push channel: `d4:progress`.

### 3. Contracts

- Long-running generate/prepare calls require a UUID `operationId`. Every progress push includes the same operationId and sessionId and one of `DESTINATION_STARTED`, `RESEARCH_STARTED`, `SOURCE_COMPLETED`, or `COMPLETED`.
- A fixed destination never enters candidate generation. `confirmFixedDestination` requires STAGE-2, complete basics, exactly one destination city, and normalized request-city equality; it appends exactly one `stage/confirmed` with optional `confirmation.kind=FIXED_DESTINATION`, keeps candidates empty and selectedCandidateId null, and performs zero source/model calls.
- Source Subagent input is strict and minimal: taskId, sessionId, sourceId, destination, reviewed query, allowlisted toolName, and anonymous age-band/count/stamina/functional-limit constraints. It never receives credentials, Context, full TravelState, raw conversation history, or another source result.
- Allowed SourceSubagent source/tool pairs are exactly `SRC_SEARCH/deepseek_web_search`, `SRC_MAP/maps_geo`, and `SRC_XHS/search_feeds`. Calls go through ToolRegistry only, execute serially, and never retry, switch source, or fallback. XHS tasks additionally carry `POSITIVE_LOCATION` or `NEGATIVE_AVOIDANCE`; the ToolRegistry-owned adapter may enrich the first two rows per polarity through `get_feed_detail`, always with `load_all_comments=false`.
- `SRC_XHS` connects only to the fixed loopback companion endpoint and registers `check_login_status`, `search_feeds`, and `get_feed_detail`. It retains at most ten canonical sources per polarity, caps each detail at 4,000 characters, and never persists `xsec_token`, comments, Authorization, raw responses, or token estimates.
- Research extraction consumes only Claim IDs returned by the current destination operation. Historical claims from earlier operations in the same session are not eligible merely because they are still stored.
- `ResearchFactDraft.destinationCity` must exactly match the selected destination after NFKC and trim normalization. A mismatch invalidates the complete structured result before any final Claim is appended.
- SKILL-04 stores `kind` and aliases by final Claim ID. Entity grouping keys include selected destination, entity kind, and normalized subject.
- Claims merge into one ResearchEntity only when there is deterministic identity evidence or every member has strict structured kind metadata. Unknown same-name claims without that support remain separate `AMBIGUOUS` entities with distinct IDs.
- Entity grouping never deletes, overwrites, or coalesces EvidenceClaim rows. `canonicalSubject`, `aliases`, and `claimIds` are a derived projection.
- Promotion markers force `SUSPECTED_PROMOTION`; promotion/commercial-only active support cannot confirm unless the entity is excluded. Obvious hard-anchor conflicts keep every source Claim `CONFLICTED` with bilateral `conflictsWith`; user resolution is separate state and never rewrites source truth.
- D4 state is persisted only through version-2 events: `destination/candidates-generated`, `destination/selected`, `research/checklist-prepared`, `research/disposition-set`, `research/conflict-resolved`, and `research/confirmed`. Replay must rebuild byte-equivalent TravelState without external calls.
- USER_PASTE remains `UNVERIFIED`, never enters SKILL-04 as a fact source, and only accepts credential-free HTTPS URLs when a URL is supplied. `SRC_XHS + INDEPENDENT_UGC + UNVERIFIED` may enter bounded research extraction as a lead, but query polarity is provenance rather than sentiment truth and cannot independently satisfy a verified hard-fact gate.
- Formal manual research is an explicit STAGE-3 degradation path after automatic acquisition fails or remains insufficient, never the selected-route default and never an automatic fallback. It opens only after the user explicitly chooses it. It bypasses SourceSubagentRunner, ToolRegistry, ProviderRuntime, and XHS planning, so external/model/irreversible calls remain zero. Each strict item requires a readable source label, optional credential-free HTTPS URL, item confirmation, and either direct entry or an optional same-session USER_PASTE link.
- A validated manual submission appends exactly one `research/checklist-prepared` version-2 event containing deterministic `USER_RESEARCH / VERIFIED_BY_USER` finalClaims, deterministic ResearchEntities, `sourceFailures=[]`, and a no-value `manualResearchSummary`. USER_PASTE is not upgraded. Unsubmitted drafts remain renderer memory only.
- Every MUST_GO manual item carries independently confirmed OPENING_HOURS, CLOSURE_SCHEDULE, and RESERVATION_REQUIREMENT anchors with checkedAt. Only an unexpired `KNOWN` anchor may satisfy the existing usable-anchor gate; UNKNOWN, NOT_APPLICABLE, and STALE remain visible but do not unlock confirmation.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Candidate count is outside 2–4, duplicates a city, or references another session's Claim | `MODEL_OUTPUT_INVALID` or `INPUT_INVALID`; do not persist candidates |
| Fixed-destination confirmation has no basics, wrong stage, zero/multiple cities, city mismatch, stale duplicate, unauthorized sender, invisible session, or extra request fields | `INPUT_INVALID` or `IPC_FORBIDDEN`; append no event and do not call the coordinator after IPC rejection |
| User selects a missing/stale candidate | `INPUT_INVALID`; remain STAGE-2 |
| Source/tool pair is not frozen or returned source/tool identity mismatches | `INTERNAL_SCHEMA_MISMATCH`; no alternate tool |
| XHS companion is unavailable, logged out, returns malformed IDs/URLs, or has no traceable note rows | Preserve a polarity-specific source failure and manual alternative; do not retry or synthesize a Claim |
| XHS detail fails after search succeeds | Preserve normalized search rows, increment the bounded detail failure audit, and do not expose the transient `xsec_token` |
| One or more XHS UGC posts assert opening hours, closure, or reservation requirements without an independent allowlisted hard-fact source | Keep the hard anchor `UNKNOWN`/`GATE_BLOCKED`; multiple UGC rows may corroborate experience signals but cannot produce `VERIFIED` hard facts |
| One Source Subagent fails | Preserve a `sourceResearchFailures` item with code, capability impact, and manual alternative; keep other completed results |
| User cancels a source task | `SOURCE_CANCELLED`; no health degradation and no empty Claim |
| Research fact references an unknown Claim, USER_PASTE, another session, or another destination | `MODEL_OUTPUT_INVALID`; append no final research Claim |
| Same normalized name has incompatible kinds | Keep separate ResearchEntities |
| Same normalized name lacks deterministic or strict structured identity support | Keep separate `AMBIGUOUS` ResearchEntities |
| USER_PASTE URL is non-HTTPS, has userinfo, or credential-like query parameters | `INPUT_INVALID` at IPC boundary |
| Manual item is unconfirmed, lacks a source label, has an unsafe URL, duplicates an item, links a non-USER_PASTE/cross-session Claim, or every item is EXCLUDE | `INPUT_INVALID`; append no event or Claim and make no source/model call |
| Manual MUST_GO omits one of the three anchors, has a future checkedAt, or marks KNOWN without a value | `INPUT_INVALID`; append no event or Claim |
| Checklist is empty, non-excluded entity is promotion-only, MUST_GO identity is ambiguous, hard-anchor evidence is unusable, or MUST_GO hard-anchor conflict is unresolved | `GATE_BLOCKED` with actionable userHint; remain STAGE-3 |
| D4 progress/result payload fails shared Zod schema | Reject/drop the invalid payload; never guess fields |

### 5. Good / Base / Bad Cases

- Good: three source Claims for known 武侯祠 aliases remain three evidence rows and project to one deterministic attraction entity with all aliases and Claim IDs.
- Good: the current 成都 operation returns Claim A while an older 重庆 Claim B remains in the session; only Claim A enters research extraction.
- Base: one source fails while another succeeds; the checklist uses only the successful current-operation Claims and shows the failed capability plus manual alternative.
- Base: XHS positive and avoidance searches both return canonical source rows; the UI presents the two groups separately and keeps all rows `UNVERIFIED` until independent evidence corroborates a fact.
- Base: several XHS posts agree on a scenic route and stamina profile, so the experience signal becomes `CORROBORATED`; their repeated opening-hours claim still remains unusable as a verified hard anchor until an independent allowlisted source confirms it.
- Base: two unsupported entities share a display name; they remain separate and `AMBIGUOUS` until identity evidence is obtained.
- Good: a direct manual item and a same-session USER_PASTE-linked item are individually confirmed and atomically project to USER_RESEARCH / VERIFIED_BY_USER entities without changing the linked USER_PASTE Claim.
- Base: a manual MUST_GO anchor is confirmed UNKNOWN or is older than 24 hours; the item remains visible, but research confirmation stays GATE_BLOCKED until a current KNOWN anchor exists.
- Bad: grouping only by normalized subject, allowing a FOOD entity and an ATTRACTION entity to merge.
- Bad: scanning all session evidence after a source task and silently reusing old destination claims.
- Bad: resolving a conflict by overwriting the losing Claim or changing both Claims to VERIFIED.
- Bad: treating USER_PASTE as a verified source because it contains a URL.
- Bad: logging the manual source label/URL/value, silently fetching the supplied URL, or calling an extraction model to complete the form.
- Bad: asking the user to retype route facts that the approved XHS plan can acquire, or upgrading repeated UGC claims about opening/closure/reservation directly to `VERIFIED`.

### 6. Tests Required

- Unit tests for known-alias grouping without Claim deletion; destination + kind isolation; ambiguous same-name separation; strict structured grouping metadata; promotion override; freshness; corroboration; bilateral conflicts; and member-fit reasons.
- SKILL-04 tests must reject unknown sourceClaimId, USER_PASTE, cross-session source, and destination mismatch; assert no final Claim append on failure.
- Coordinator tests must prove research selection is limited to current-operation Claim IDs and that source failures/cancellation do not fallback or degrade incorrectly. XHS tests must prove exactly two ordered polarity tasks, one search plus at most two details per polarity, no retries, no comment pagination, canonical credential-free URLs, transient-token exclusion, and rejection of every non-allowlisted/write tool.
- Event/replay test must delete SQLite, rebuild from JSONL, compare candidates, selected destination, entities, disposition, resolutions, stage, and Claim conflict relationships, and confirm JSONL bytes are unchanged.
- IPC schema/handler tests must reject credential-bearing USER_PASTE URLs, malformed UUIDs, extra progress fields, cross-session IDs, invalid conflict resolutions, fixed-destination extra fields, unauthorized senders, invisible sessions, and unsafe error leakage.
- Manual-path tests must cover strict payloads, safe URL/userinfo/query rejection, source labels, per-item and per-anchor confirmation, duplicates/all-EXCLUDE, deterministic redacted Claims, USER_PASTE ownership/type isolation, stale/KNOWN Gate behavior, one-event atomicity, migration 0006 preservation/idempotence, and zero external/model calls.
- Renderer test must show canonical entity + aliases, promotion block, member-specific fitness reason, source failure/manual alternative, both conflict sides, and separate XHS positive/avoidance UGC groups with zero external calls.
- Renderer/Electron tests must exercise direct and linked manual items through the real preload channel, show USER_RESEARCH / VERIFIED_BY_USER as user-confirmed rather than independently corroborated, and protect unsaved in-memory drafts on session/stage navigation.
- Selected-route renderer tests must make XHS_STRICT the primary node action, keep the manual form hidden until an automatic failure/insufficiency is shown and the user explicitly chooses degradation, and preserve source/freshness/status/uncertainty in every selectable result.
- Renderer tests must pass only a snapshot whose sessionId matches the active session; null or stale snapshots render an `aria-busy` state and expose neither fixed confirmation nor candidate generation.
- Required local gates: Prettier, ESLint, Node/Web type checks, complete Node tests, production build, XML parse, Trellis task validation, and process-residue check. A real external query requires a separate exact authorization and is not implied by local PASS.

### 7. Wrong vs Correct

#### Wrong

```ts
// Reuses every eligible Claim ever stored in the session.
const claims = tools.listEvidence(sessionId).filter(isEligibleResearchSource)

// Name-only grouping merges cross-kind or unsupported same-name entities.
const key = normalizeEvidenceSubject(claim.subject)

// A session switch briefly exposes the previous session's actions.
return <DestinationCandidatesCard snapshot={d4} />
```

#### Correct

```ts
const currentIds = new Set(
  sourceResults.flatMap((result) => (result.status === 'SUCCEEDED' ? result.claimIds : []))
)
const claims = tools
  .listEvidence(sessionId)
  .filter((claim) => currentIds.has(claim.claimId) && isEligibleResearchSource(claim))

const kind = kinds.get(claim.claimId) ?? 'ATTRACTION'
const key = `${selectedDestination}\n${kind}\n${normalizeEvidenceSubject(claim.subject)}`
// If deterministic/strict structured support is absent, emit one AMBIGUOUS entity per Claim.

const currentD4 = d4?.sessionId === activeId ? d4 : null
return <DestinationCandidatesCard snapshot={currentD4} />
```

The current-operation Claim set prevents destination bleed across repeated research runs. Destination + kind scoping and conservative identity resolution prevent plausible-looking but unsupported entity merges while preserving every source row for audit.

## Scenario: XHS 30-post strict ranking path

### 1. Scope / Trigger

- This path is the default acquisition path for every selected-route required node and remains additive only for legacy single-destination D4. Apply it when changing XHS 30-post sampling, structured extraction/review, deterministic attraction ranking, its preview/execute IPC, or checklist-event projection.
- It is a strict one-shot path: local preview does not authorize execute, and failure requires a new preview and authorization rather than an implicit retry.

### 2. Signatures

- `CoordinatorService.previewXhsRanking({ sessionId }): Promise<XhsRankingPreview>`
- `CoordinatorService.executeXhsRanking({ sessionId, planId, digest, operationId }, onProgress?): Promise<D4Snapshot>`
- `runXhsRankingBatch({ destinationCity, invoke, onProgress? }): Promise<XhsRankingBatchResult>`
- `XhsRankingSkill.run({ sessionId, destinationCity, sourceClaims, travelers, dispositions? }): Promise<XhsRankingSkillOutput>`
- IPC invokes: `research:xhs-ranking-preview` and `research:xhs-ranking-execute`; progress remains on typed `d4:progress`.

### 3. Contracts

- For a selected route, the primary node action is `XHS_STRICT`. Travel Agent owns acquisition, transport/schema validation, structured extraction, review and deterministic projection; the user authorizes the exact plan and chooses among evidence-backed results or resolves conflicts, but does not transcribe the default fact set.
- XHS UGC may corroborate route experience, crowding, stamina, service and avoidance signals. It remains `INDEPENDENT_UGC` and cannot by itself satisfy OPENING_HOURS, CLOSURE_SCHEDULE or RESERVATION_REQUIREMENT hard anchors, even when multiple posts agree.
- Missing hard anchors require a separate allowlisted standard/official-source plan with its own preview, digest and exact approval. XHS execute must not silently chain that plan, switch source, or infer official status from a creator profile.
- Only after the automatic path fails or remains insufficient may the UI offer formal manual research; choosing it requires an explicit user action and preserves `USER_RESEARCH / VERIFIED_BY_USER` provenance.
- Preview is local-only and freezes destination, four queries, fixed filters, recommendation/avoidance sample sizes 15/15, search/detail calls 4/30, detail-character limit 4,000, EXTRACTION/REVIEW calls 6/1, retry=0, `loadAllComments=false`, provider/model routes, TTL, planId, and digest.
- Execute accepts only sessionId, planId, digest, and operationId. It validates STAGE-3, state digest, route digest, expiry, and one-shot consumption before opening one temporary XHS session.
- Companion transport, tool discovery, login readiness, and search capability are separate states. Successful connect/list/login checks never prove that `search_feeds` can finish inside its call budget; a search-capability probe is a real source call and must itself be frozen in a newly authorized plan.
- Search order is deterministic. Every search result must satisfy the shared non-empty feed schema; candidates use global first-seen feed-id dedupe and freeze exactly 15 recommendation-origin plus 15 avoidance-origin posts before any detail request.
- XHS keeps the standard MCP `content[0].text` envelope. The JSON inside that text accepts only the reviewed legacy and official transport shapes: search is either the legacy feed array or `{feeds,count}`, while detail is either the legacy `{note,...}` object or `{feed_id,data}`. The shared XHS payload schemas normalize both versions before D3/D4 adapters consume them; `count` must equal `feeds.length`, and official detail `feed_id` must equal `data.note.noteId` before the adapter separately compares the normalized ID with the requested/frozen feed ID. Unknown `data`/`result` wrappers, `structuredContent`, and non-text content remain invalid.
- When either XHS result schema drifts inside the existing one-session ToolRegistry call, SourceHealth receives the existing `missing` paths plus an optional bounded, value-free structural fingerprint for the allowlisted log `keys` field. Successful results and non-XHS sources produce no such diagnostic; source degradation, zero retry, zero partial Claim, and unchanged event/state behavior remain mandatory.
- Detail order is the frozen recommendation 15 followed by avoidance 15. All 30 requests are serial, pass `load_all_comments=false`, cap retained title/description text at 4,000 characters, and keep `xsec_token` only in the in-memory request boundary.
- Model processing is exactly six five-post EXTRACTION calls plus one REVIEW. Every call sets `repairInvalid=false`; coverage, session, source, destination, duplicate-subject, and review-ID violations abort before final output.
- Ranking is pure: `3*recommendCount - 4*avoidCount + fit`, with FIT=2, UNKNOWN=0, RISK=-3. MIXED counts once in each direction. Non-ATTRACTION, EXCLUDE, AMBIGUOUS identity, and promotion-only support are excluded; avoidance evidence remains visible.
- One `research/checklist-prepared` V2 event may carry `xhsSampleSummary`, `attractionRankings`, and `finalClaims`. It is appended once and projects final evidence plus D4 state in one SQLite transaction; legacy events remain valid.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Preview session is not current STAGE-3 with exactly one destination | Reject locally; make zero source/model calls |
| EXTRACTION or REVIEW route is missing | `PROVIDER_UNCONFIGURED`; do not create an executable plan |
| Plan is expired, consumed, digest-mismatched, state-drifted, or route-drifted | Reject before opening XHS; require a new preview/authorization |
| Any search response is empty/malformed, or the global sample has fewer than 15 posts in either group | Fail the complete operation before details; no cross-group fill or smaller sample |
| Search wrapper count conflicts with feeds, detail outer/inner ID conflicts, the normalized detail ID differs from the request, or the JSON uses an unknown wrapper | `SOURCE_DRIFT`; stop at that call with no retry, replacement, model call, or final projection |
| Any detail fails or returns a different note ID | Stop at the first failure; no retry, replacement, model call, final Claim, ranking, checklist, or stage change |
| `search_feeds` returns no result before its call deadline | `MCP_TIMEOUT`; stop the complete operation with no retry, timeout extension, filter removal, smaller sample, schema fingerprint, model call, or partial projection |
| EXTRACTION/REVIEW output is invalid or has missing/unknown IDs | `MODEL_OUTPUT_INVALID`; no repair, provider switch, fallback, or partial output |
| Operation is cancelled | Close the temporary source session and persist no final ranking output |
| XHS-only output contains a hard operational fact | Preserve it as an attributed UGC lead, leave the hard anchor UNKNOWN, and block confirmation until a separately authorized independent source or explicit manual verification exists |

### 5. Good / Base / Bad Cases

- Good: four searches freeze 15/15 globally unique posts, all 30 details succeed, six no-repair EXTRACTION batches and one REVIEW succeed, and one atomic checklist event projects the final Claims and ranking.
- Good: the user approves a node-scoped XHS plan, Travel Agent presents sourced route options, and the user selects one without re-entering any fact; a separate approved source later confirms its reservation rule.
- Base: later search rows repeat earlier feed IDs; first-seen order remains stable and duplicates do not change the frozen sample.
- Base: one signal is MIXED; its post counts once as recommendation and once as avoidance, and both evidence directions remain inspectable.
- Bad: replacing a failed detail with another search row, shrinking the sample, retrying the request, repairing invalid model JSON, or ranking the completed subset.
- Bad: persisting xsec_token, comments, raw MCP/model responses, prompts, or provider credentials in event, Claim, audit, or renderer state.
- Bad: opening the manual form by default, treating Settings login as research approval, or merging independent hard-fact verification into the XHS digest.

### 6. Tests Required

- Assert exact four-query order/filters, 15/15 global dedupe, 30 serial detail arguments/order, `load_all_comments=false`, 4,000-character cap, and absence of token/comment/raw retention.
- Assert legacy and official search/detail payloads normalize to the same canonical values through the shared schema, Source Catalog and D3/D4 adapters. Reject count mismatch, empty/unknown/non-JSON payloads, `structuredContent`, outer/inner/request ID mismatch, and prove ToolRegistry audit/log/serialized errors retain only safe summaries.
- Assert group shortage fails before detail; first detail failure stops at total calls `4 search + 1 detail`, with no retry or replacement.
- Assert a first-search timeout is audited around `callTool`, stops at one search attempt, produces no schema fingerprint, and cannot be reclassified as connect/list/login failure or repaired by a hidden readiness probe.
- Assert exactly six EXTRACTION plus one REVIEW invocation and `repairInvalid=false` for all seven calls; invalid coverage or review IDs produce no output.
- Assert score, MIXED, stable tie order, alias merge, ambiguous separation, promotion-only/EXCLUDE gates, family-fit adjustment, and preserved avoidance evidence.
- Assert preview makes zero source/model calls; event replay is byte-equivalent with zero calls; strict IPC and ranking UI expose only the frozen safe summary.
- Assert selected-route nodes default to XHS_STRICT, Settings login does not authorize execute, user selection does not rewrite source Claims, manual degradation requires explicit choice, and XHS-only hard anchors stay UNKNOWN/GATE_BLOCKED.

### 7. Wrong vs Correct

#### Wrong

```ts
const detail = await retry(() => getFeedDetail(candidate))
if (!detail) candidates.push(nextSearchRow)
const extraction = await provider.invokeStructured({ repairInvalid: true })
```

#### Correct

```ts
const detail = await invoke('get_feed_detail', {
  feed_id: candidate.feedId,
  xsec_token: candidate.xsecToken,
  load_all_comments: false
})
const extraction = await provider.invokeStructured({
  role: 'EXTRACTION',
  repairInvalid: false,
  schema: XhsExtractionBatchSchema
})
```

The strict path fails closed because replacement, retries, and schema repair would change the user-authorized call budget and make the final ranking irreproducible from the frozen plan.

### 8. Selected-route node scope

- Multi-city D4 uses one strict `ROUTE_NODE` scope: `routeId + nodeId`. Every entity, Claim, source failure, manual/XHS summary, conflict and progress item must either carry that exact scope or be rejected before writes.
- Resolve node ownership once through the selected route. Required nodes are processed in route order; omitted optional nodes are `SKIPPED` and are never executable research targets.
- XHS strict preview is the selected-route default and remains 34 external/7 model calls. Standard preview remains 7 external/2 model calls and is used as a separately authorized independent corroboration path when hard anchors need it. Both are zero-call previews, 60-second one-shot plans, serial, `retry=0`, and digest-bound to the current node state; neither approval covers the other.
- USER_PASTE remains `UNVERIFIED`; USER_RESEARCH remains `VERIFIED_BY_USER`. Their route/node IDs cannot be inferred from entity names or renderer state.
- Only the final required node confirmation may atomically carry STAGE-3→STAGE-4. Earlier confirmations update only their node.
