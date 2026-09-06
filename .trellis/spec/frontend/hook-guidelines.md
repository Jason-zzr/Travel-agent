# Hook Guidelines

> Only boundary rules are established. The repository has no hooks yet; do not invent a hook framework or data library.

## Allowed Responsibilities

- A hook may subscribe to a preload push event, request one typed snapshot slice, and manage loading/error/cancellation state.
- A hook may hold ephemeral view state such as selection, disclosure, or draft input.
- Shared domain facts remain in the main-process TravelState read model.

## Snapshot Pattern

1. Subscribe to the relevant `push:*` event through the typed preload API.
2. Check `sessionId` and `changedPaths`.
3. Request only the affected `session:snapshot` slice: `timeline`, `tasks`, `evidence`, `skeleton`, or `meta`.
4. Replace the view snapshot; do not mutate or merge domain state locally.
5. Unsubscribe during cleanup.

## Data Fetching

- Do not add React Query, SWR, or another state/data library without a separate architecture decision.
- Never fetch MCP, SQLite, filesystem, or credentials directly from a hook.
- Treat IPC results as `{ ok: true, data } | { ok: false, error }`; do not expect thrown cross-process errors.
- Long operations expose progress and cancellation through the IPC contract.

## Naming and Mistakes

- Custom hooks use the `use*` prefix.
- Do not create a hook solely to wrap a one-line value or a single-use handler.
- Do not keep a mutable TravelState mirror, request the full snapshot, or forget event unsubscription.
- Do not hide `EXTERNAL`/`BLOCKED` state by returning empty arrays or default objects.

## Examples Status

No real hook implementation exists. Add references after the first snapshot subscription hook is implemented.

## Sources

`ARCHITECTURE.md` §§2, 5; `PERFORMANCE.md` §§1, 4; `ERROR_HANDLING.md` §§1–3.
