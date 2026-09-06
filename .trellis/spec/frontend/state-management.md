# State Management

> Normative state boundary from `ARCHITECTURE.md`. D1 adds ephemeral SETTINGS progress/message state only; TravelState remains main-owned.

## Model

- The main process owns TravelState. JSONL is the fact source and SQLite is the queryable read model.
- The renderer holds read-only per-view snapshots and ephemeral UI state only.
- Do not add Redux, Zustand, MobX, or another global state library.

## Categories

- **Domain state:** TravelState and evidence-backed planning data; main process only.
- **Snapshot state:** one view slice returned by `session:snapshot`; replace when invalidated.
- **Ephemeral UI state:** open panels, selected rows, local drafts, focus, and progress display; component/hook local.
- **Credentials:** accepted briefly by the settings form, sent over IPC, then cleared; never cached in renderer state.

## Read and Write Flow

```text
User confirmation -> typed IPC -> Coordinator -> EventLogService.append
-> TravelStateService.apply -> Cordis event -> push:state-updated
-> renderer requests one snapshot slice
```

- `push:state-updated` carries only `{ sessionId, changedPaths }`.
- `session:snapshot` always includes one slice parameter: `timeline | tasks | evidence | skeleton | meta`.
- Do not create separate snapshot channels per slice and do not transfer the full TravelState.
- Unified D6/D7 snapshots are scoped by `sessionId + routeId`; routeId is Main-returned identity, not renderer authority. Each async refresh or mutation owns a monotonically increasing request epoch, and progress additionally matches operationId. Switching session invalidates prior snapshot/operation state before the next read; delayed results are discarded.

## Forbidden Patterns

- Local mutation of domain entities followed by optimistic persistence.
- A renderer-side canonical TravelState store.
- Writing via database/preload shortcuts that bypass Coordinator and EventLogService.
- Silent fallback to model-derived or stale values after source degradation.

## Sources

`ARCHITECTURE.md` §§2, 5, 8; `PERFORMANCE.md` §4.
