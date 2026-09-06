# D7 Tasks and Inspector Renderer Contracts

## 1. Scope / Trigger

Use this contract for `TasksView`, `InspectorView`, D7 renderer IPC wrappers, GATE_C display, or export controls. Renderer stays sandboxed and receives only safe snapshots.

## 2. Signatures

```ts
getD7Snapshot(sessionId: string, routeId?: string): Promise<IpcResult<D7Snapshot>>
deriveTasks(sessionId: string, routeId?: string): Promise<IpcResult<D7Snapshot>>
updateTask(request: TaskUpdateRequest): Promise<IpcResult<D7Snapshot>>
runGateC(sessionId: string, routeId?: string): Promise<IpcResult<D7Snapshot>>
exportItinerary(request: ItineraryExportRequest): Promise<IpcResult<ExportResult>>
getInspectorSnapshot(query: InspectorQuery): Promise<IpcResult<InspectorSnapshot>>
exportDiagnostic(query: InspectorQuery): Promise<IpcResult<ExportResult>>
```

## 3. Contracts

- TASKS filters by priority and status, but every state is also expressed in text. Handover shows action, verified channel, minimum information, warnings, deadline, and checklist without Evidence/raw payload duplication.
- Confirmation sends only `sessionId`, `taskId`, `expectedUpdatedAt`, and a controlled action. Link opening and evidence navigation never update task state.
- GATE_C displays either every named blocker or an explicit READY result; UI does not infer readiness before the main process records the gate.
- Export controls select only `ICS` or `MARKDOWN`; save location/content generation remains main-owned.
- Inspector filters by session, optional ISO `from/to`, and limit 1–500. Tables show safe event/tool/model/blocked/health summaries only.
- Task-to-timeline/evidence navigation passes item/claim identity; no sourceRef, external body, credential, event payload, or raw arguments enter TASKS/Inspector markup.
- Multi-city tasks and Gate blockers show route/node/segment/leg labels; derive/update/gate/export include the current routeId reference and never construct topology locally. Legacy snapshots omit the field.
- Switching session invalidates prior requests through a request epoch. Delayed derive/gate/export responses are discarded rather than replacing the visible route snapshot.

## 4. Validation & Error Matrix

| Condition | UI behavior |
| --- | --- |
| No session or no current timeline | honest empty/prerequisite state; actions disabled |
| Stale task confirmation | show serialized hint; refresh snapshot; do not infer success |
| Missing official channel/deadline | show BLOCKED and missing field text |
| GATE_C blockers | show all blockers; never show READY wording |
| Inspector invalid range | prevent/serialize validation failure |
| Save dialog cancelled | remain unchanged; do not report an exported path |
| IPC error | show stable user hint; keep prior snapshot read-only |
| Delayed response from a prior session/route | discard it; never show its task/Gate success in the current view |

## 5. Good / Base / Bad Cases

- Good: keyboard user filters HIGH tasks, expands handover, confirms the external result, sees vN+1/current state, runs GATE_C, and exports without raw data exposure.
- Base: no tasks shows a clear derive action; no audit rows shows a real empty state.
- Bad: color alone conveys status; Renderer edits task objects locally; opening an official URL marks a task DONE; Inspector renders event payload JSON.

## 6. Tests Required

- SSR/renderer: pending/confirmed/blocked labels, route/node/segment/leg scope, filters, handover, scoped Gate READY/BLOCKED, whole-route export buttons, event/tool/model tables, stale-response isolation, 820/320 widths, and empty states.
- Privacy: markup excludes `sourceRef`, raw payload/content/arguments, credential words/values, and sensitive fixture sentinels.
- Electron: derive, confirm/skip, Gate C, timeline/evidence navigation, Inspector filter/export, visible focus, and zero external/model/irreversible actions.
- Quality: format, lint, web typecheck, production build, no-GPU smoke, and packaged smoke.

## 7. Wrong vs Correct

### Wrong

```tsx
<button onClick={() => setTask({ ...task, reservation: 'DONE' })}>已购票</button>
<pre>{JSON.stringify(event.payload)}</pre>
```

### Correct

```tsx
<button onClick={() => updateTask({
  sessionId,
  routeId: task.routeContext?.routeId,
  taskId: task.taskId,
  expectedUpdatedAt: task.updatedAt,
  action: 'CONFIRM_EXTERNAL_RESULT'
})}>确认外部结果</button>
```

The main process owns state transition, versioning, validation, and safe audit projection.
