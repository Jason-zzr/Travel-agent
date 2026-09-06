# D7 Task, Gate, Export, and Packaging Contracts

## 1. Scope / Trigger

Use this contract for BUILD-D7 task derivation, task result writeback, GATE_C, Inspector audit reads, itinerary/diagnostic export, or Windows packaging. D7 consumes the current published D6 timeline and stored EvidenceClaims only; the LOCAL path performs no source or model calls.

## 2. Signatures

```ts
deriveTasks(input: { sessionId: string; routeId?: string }): Promise<D7Snapshot>
updateTask(input: TaskUpdateRequest): Promise<D7Snapshot>
runGateC(input: { sessionId: string; routeId?: string }): Promise<D7Snapshot>
d7Snapshot(input: { sessionId: string; routeId?: string }): D7Snapshot
prepareItineraryExport(input: ItineraryExportRequest): PreparedExport
inspector.snapshot(input: InspectorQuery): Promise<InspectorSnapshot>
```

IPC channels are `d7:snapshot`, `task:derive`, `task:update`, `gate-c:run`, `itinerary:export`, `inspector:snapshot`, and `inspector:diagnostic-export`. Migration `0005_d7_task_links.sql` adds timeline/item/claim/update linkage; `0010_unified_route_timeline.sql` adds nullable route/node/segment/leg scope and indexes to existing task projections.

## 3. Contracts

- `s11-task-derivation` is deterministic and imports no DB, Provider, MCP, Electron, or Renderer code. Legacy stable task identity remains based on session, timeline version, item, and kind; route tasks additionally include stable leg/segment scope to deduplicate one owning task per route unit.
- A task carries its source timeline/item/claims, owner, due/recheck time, priority, three M0 axes, four constant `NA` axes, and bounded handover fields. Missing official channel or deadline remains visible as BLOCKED; code never invents either.
- `task/updated` is strict on write and additive on replay. A user-confirmed external result carries the full task post-state, replacement timeline vN+1, and a DecisionLog in one event; SQLite projection is one transaction and old versions remain read-only.
- `gate/result` stores the complete GATE_C report. `ready` is true exactly when blockers are empty; stale/conflicted/unverified hard anchors and unfinished HIGH tasks block.
- Export DTOs are explicit allowlists. The main process builds content, scans serialized output for secret-shaped values, writes a same-directory temp file, fsyncs, and renames. Renderer never supplies file content.
- Inspector returns event metadata, tool argument digests, model-call summaries, blocked tools, and source health. It never returns event payloads, tool arguments/responses, Evidence values/sourceRef, or credentials.
- Packaged `app.asar` may contain only `out/**`, `package.json`, production `node_modules/**`, the `resources` directory marker, and exact `resources/flyai-utility-process-launcher.cjs`; `resources/**` is not a wildcard allowance. The launcher and `node_modules/@fly-ai/flyai-cli/dist/flyai-bundle.cjs` must both be ASAR-unpacked regular files whose on-disk SHA-256 matches ASAR integrity metadata. The launcher participates in the product credential-shape scan. Source, tests, `.tmp`, other resources, MCP development environments, user data, and credentials are excluded. NSIS is x64 and unsigned unless a separate signing task is approved.
- For a selected multi-city route, tasks and Gate blockers preserve `TimelineRouteContext`; leg, stay segment, MUST anchor, and route coverage failures use dedicated codes. Weather is checked per actual stay node and closure/recheck evidence per relevant MUST item. Legacy global checks remain unchanged.
- ICS/Markdown export one current whole route in chronological order. Route labels may include safe city/leg names but never a precise private address, Evidence value/sourceRef, credential, PNR, or document.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| No current published timeline | `GATE_BLOCKED`; no task event |
| Missing/mismatched routeId or task/blocker route scope | fail closed before derive/update/gate/export; zero writes |
| Task stale-write (`expectedUpdatedAt` mismatch) | fail closed; no event or projection |
| Confirmation does not map to current item | `GATE_BLOCKED` / `INPUT_INVALID`; no vN+1 |
| HIGH task incomplete or hard-anchor Claim unusable | GATE_C `ready=false` with named blocker |
| Export secret scanner hit | export fails and temp file is removed |
| Inspector `from > to` or limit outside 1–500 | strict request rejection |
| Unexpected app.asar root or credential-shaped product value | packaging verification fails |
| FlyAI launcher/bundle missing, packed inside ASAR, non-regular, or digest-mismatched | packaging verification fails before installer acceptance |
| Any resource other than the exact FlyAI launcher | `unexpected packaged paths`; no prefix-based resource allowance |
| Unsigned installer | report `NotSigned`; never claim signing |

## 5. Good / Base / Bad Cases

- Good: verified reservation evidence produces one stable task; user confirmation appends one atomic event, creates vN+1, preserves `itemClass`, and GATE_C becomes READY only after blockers clear.
- Base: incomplete evidence still produces a HIGH/BLOCKED task with an honest handover gap and zero external/model calls.
- Bad: Renderer sends a complete task/timeline or export body; Coordinator mutates current rows in place; Inspector exposes raw payload; packaging includes `.venv`, `.tmp`, tests, or user data.

## 6. Tests Required

- Unit: task stability/deduplication, missing/expired evidence, BACKUP exclusion, GATE_C blocker classes, ICS UTC/cross-midnight/zero-duration BACKUP behavior, and secret scanner cleanup.
- Integration: strict write/additive replay, task confirmation vN+1, non-empty rejected alternatives, `itemClass` preservation, JSONL-to-SQLite rebuild, and safe Inspector filtering.
- Renderer/Electron: task filters, route/node/segment/leg labels, handover, confirm/skip, scoped blocked/ready text, whole-route export, stale-response isolation, 820/320 layout, and zero calls.
- Packaging: production build, x64 unpacked launch with fresh userData, restart recovery, exact app.asar allowlist negative cases, launcher/bundle unpacked integrity, launcher credential-shape scan, NSIS artifact existence, and Authenticode status reporting.

## 7. Wrong vs Correct

### Wrong

```ts
db.prepare('update timeline_items set anchor_class = ?').run('CONFIRMED_EXTERNAL')
await writeFile(rendererPath, rendererContent)
```

### Correct

```ts
await travelState.record({ type: 'task/updated', payload: completePostState })
await atomicWriteExport(mainBuiltAllowlistedContent, dialogSelectedPath)
```

The correct path preserves JSONL authority, creates history instead of mutating it, and keeps filesystem and secret boundaries in the main process.
