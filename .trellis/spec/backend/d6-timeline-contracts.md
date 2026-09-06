# D6 Timeline Contracts

## 1. Scope / Trigger

Use this contract for BUILD-D6 timeline preparation, publication, replay, projection, or recovery. Root PRD and control documents remain authoritative. D6 stays in `STAGE_5`, adds no local HTTP service, and defaults to stored EvidenceClaim compilation with `externalCalls=0`.

## 2. Signatures

```ts
prepareTimeline(input: { sessionId: string; routeId?: string; operationId: UUID }, onProgress?): Promise<D6Snapshot>
publishTimeline(input: { sessionId: string; routeId?: string; draftId: UUID }): Promise<D6Snapshot>
d6Snapshot(input: { sessionId: string; routeId?: string; version?: positiveInt }): D6Snapshot
cancelD6Operation(operationId: UUID): Promise<boolean>
```

IPC channels are `timeline:prepare`, `timeline:publish`, `timeline:snapshot`, `d6:cancel`, and push-only `d6:progress`. Persistence reuses `timeline_versions(session_id, version)`, `timeline_items`, and `decision_logs`; legacy D6 needs no migration, while `0010_unified_route_timeline.sql` adds nullable route scope to the disposable timeline projections.

## 3. Contracts

- `s09-route-refinement` and `s10-timeline` are pure: no DB, Provider, MCP client, Electron, or Renderer imports.
- A non-BACKUP item contains local date/time, item/anchor class, location, optional arrival transport, explicit buffer, optional cost, claim IDs, and verification summary.
- Every arrival transport has Claim-backed ETA. Buffers are at least 10 minutes, or 30 for station/airport destinations. BACKUP has zero duration, no transport, and zero buffer.
- A draft is ephemeral and session-bound. Publish accepts only its `draftId`; Renderer never returns a mutable timeline payload.
- `timeline/published` contains the complete new version, DecisionLog, source outcomes, verification rollup, and changed dates. Write schema is strict; replay schema permits additive future payload fields.
- Snapshot file is `snapshot-v1.json` with app version, session, seq, state, and validated event prefix. JSONL remains authoritative.
- When `selectedRouteId` is present, every multi-city item has a strict `TimelineRouteContext`. Normal days stay within the owning node/segment; transfer days retain checkout, every ordered route leg, and check-in. Missing route time, ETA, coordinate, or Claim is named and blocked rather than inferred.
- Multi-city drafts, versions, progress, and mutations carry the current routeId. Main re-resolves the selected route; Renderer identity is only a fail-closed reference. With no selected route, legacy compilation and identifiers remain unchanged.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Not STAGE-5 or missing transport/stay/anchors/skeleton/route-D5 confirmation | `GATE_BLOCKED`; no draft event |
| Missing/mismatched selected route or route context | `INPUT_INVALID` / `GATE_BLOCKED`; no draft/event/projection |
| Missing ETA, daily BACKUP, or concrete-fact Claim | non-publishable draft with named blocking item |
| Unverified HARD_LOCKED item | `GATE_BLOCKED`; no `timeline/published` |
| Time overlap, invalid cross-midnight marker, or buffer below minimum | validation/gate failure before append |
| Draft basis seq changed or draft expired | `GATE_BLOCKED` / `INPUT_INVALID`; discard draft |
| Operation reused | `OPERATION_REPLAYED` |
| Operation cancelled | `SOURCE_CANCELLED`; no partial event or projection |
| Corrupt/incompatible snapshot | warn and replay full JSONL |
| Corrupt middle JSONL or sequence gap | fail closed; snapshot must not mask it |

## 5. Good / Base / Bad Cases

- Good: stored route, backup, rail, stay, and POI Claims compile deterministically; publish increments the version and atomically changes current.
- Base: optional restaurant evidence is absent, the capability outcome is explicit, and no fact is invented.
- Bad: Renderer sends source/tool identity or a complete timeline; Coordinator trusts UI gate state; code writes timeline tables without a `timeline/published` event.

## 6. Tests Required

- Unit: 10/30-minute buffers, cross-midnight absolute minutes, BACKUP exclusion, orphan Claim, and HARD_LOCKED verification.
- Schema: strict IPC, zero-duration BACKUP, strict write/additive replay event payload.
- Integration: cancellation writes no event; two publishes produce v1/v2 and one current; item/decision projections are complete; old-version reads do not mutate current.
- Recovery: publish writes snapshot; delete SQLite and rebuild; snapshot+tail equals full replay; corrupt snapshot falls back; corrupt JSONL fails.
- Acceptance: legacy four-day smoke plus unified 10-day fixture show dates, route/node/segment/leg identity, ETA, buffer, collapsed backups, scoped gate, and history with `externalCalls=0`. Renderer tests cover 820/320 and stale-response isolation; a pre-page-load host GPU failure remains an environment failure, not an Electron interaction pass.

## 7. Wrong vs Correct

### Wrong

```ts
await db.prepare('insert into timeline_items ...').run(rendererTimeline)
```

### Correct

```ts
const payload = publishTimelineDraft({ draft: serverDraft, currentVersion, now })
await travelState.record({ sessionId, eventVersion: 2, type: 'timeline/published', payload })
```

The correct path preserves one fact source, revalidates in the main process, and makes SQLite disposable.
