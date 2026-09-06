# D6 Timeline Renderer Contracts

## 1. Scope / Trigger

Use this contract for `D6View`, D6 renderer IPC wrappers, timeline evidence navigation, or version display. Renderer remains sandboxed and read-only with respect to domain state.

## 2. Signatures

```ts
getD6Snapshot(sessionId: string, version?: number, routeId?: string): Promise<IpcResult<D6Snapshot>>
prepareTimeline(request: TimelinePrepareRequest): Promise<IpcResult<D6Snapshot>>
publishTimeline(request: TimelinePublishRequest): Promise<IpcResult<D6Snapshot>>
subscribeD6Progress(listener: (event: D6ProgressEvent) => void): () => void
cancelD6Operation(operationId: string): Promise<IpcResult<boolean>>
```

## 3. Contracts

- Group items by date. Show time, location, item/anchor class, arrival mode, ETA, explicit buffer, cost state, verification status, and Claim count.
- BACKUP uses native collapsed `details` by default and must not look like scheduled duration.
- Publish is enabled only for the visible current draft with `gate.publishable=true`; main-process gate remains authoritative.
- Version selection calls snapshot with `version`; it never publishes, rolls back, or changes current. Mark current/history with text, not color alone.
- Evidence navigation passes only sessionId and claim IDs into EVIDENCE. D6 markup must not contain sourceRef, tool name, credential, raw content, or DB data.
- Progress text is bounded and cancellable. Display empty, blocked, unknown cost, and unverified states explicitly.
- A multi-city snapshot displays one route spine plus node/segment/leg scope for each relevant item. Prepare/publish return the current routeId as a reference, while Main remains authoritative; legacy snapshots omit routeId.
- Every async refresh/mutation is guarded by a request epoch. Switching session invalidates the old snapshot and operation immediately; a delayed prior response or unrelated progress event must not overwrite the new identity.

## 4. Validation & Error Matrix

| Condition | UI behavior |
| --- | --- |
| No session | disable actions; direct user to CHAT |
| Non-STAGE-5 session | disable prepare |
| No published version | show empty timeline and prepare action |
| Draft blocked | list every blocking item and disable publish |
| Unknown cost/transport | show explicit unknown/no-transport text |
| Prepare exceeds user tolerance | show progress; expose cancel while operation exists |
| IPC error | show serialized `userHint`; do not infer success |
| Delayed response from a prior session/route | discard it; keep the current identity and snapshot |

## 5. Good / Base / Bad Cases

- Good: a four-day legacy or ten-day unified current version is readable without expanding backups; every transport exposes ETA/buffer and route scope; evidence is one navigation click away.
- Base: no timeline yet shows an honest empty state and local prepare action.
- Bad: old-version selection changes current; a color-only badge communicates verification; UI reconstructs facts from raw source output.

## 6. Tests Required

- SSR: dates, ETA, 30-minute station buffer, evidence status/link, collapsed backup summary, gate, current marker, and local-only call count.
- Privacy: markup excludes `sourceRef`, `toolName`, `credential`, and `rawContent`.
- Electron: legacy prepare/publish/history plus a dedicated fake multi-city session that checks route-scoped mutations, stale session responses, legacy compatibility, and 820/320 widths. A host failure before page load is not an interaction pass.
- Quality: format, lint, web typecheck, build, SSR route labels/privacy, and default/no-GPU smoke attempts.

## 7. Wrong vs Correct

### Wrong

```tsx
<button onClick={() => publishTimeline(localEditedTimeline)}>发布</button>
```

### Correct

```tsx
<button disabled={!snapshot.draft?.gate.publishable} onClick={() => publishTimeline({
  sessionId: snapshot.sessionId,
  routeId: snapshot.draft?.routeId,
  draftId: snapshot.draft!.draftId
})}>发布为新版本</button>
```

Only the opaque draft reference crosses IPC; the main process owns validation and facts.
