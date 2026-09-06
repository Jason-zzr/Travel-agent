# Backend Quality Guidelines

> Quality gate from the project contracts. D0 established lint, type-check, and build commands; business and acceptance testing remain pending.

## Required Patterns

- TypeScript `strict: true` and `noUncheckedIndexedAccess`.
- No `any` or `@ts-ignore`; use `unknown`, type guards, and Zod at every external boundary.
- Derive runtime-backed types with `z.infer`; do not duplicate schema interfaces.
- Use `import type` for type-only imports.
- Obtain services through Cordis `inject`; pin `cordis` exactly to `3.18.1`.
- Register scope cleanup with `ctx.on('dispose')`, but do not treat Cordis 3.18.1 `root.stop()` as an awaitable resource barrier: `AppKernel.stop()` must explicitly await MCP/JSONL cleanup and close SQLite before calling `root.stop()` once.
- Use Cordis timers, never raw `setInterval`/`setTimeout`.
- Keep the only write path event-first and replayable.

## Security and Scope Gates

- `ToolRegistry` is the only registration/invocation gateway. Apply allowlist intersection and write/action keyword rejection.
- MCP request builders select the minimum fields; never serialize TravelState or conversation history wholesale.
- External free text is isolated as untrusted content before model use.
- M0 never purchases, books, pays, locks prices, cancels, refunds, or launches navigation/ride-hailing.
- New work must map to an M0 PRD identifier; otherwise reject scope expansion.

## Validation

- Before freezing an interface: full `tsc --noEmit` with zero errors.
- Each completed task: type-check, start the app, manually exercise the feature, and provide a handoff.
- Acceptance scripts remain read-only and assert SQLite/JSONL evidence directly.
- Replay correctness, no residual MCP process, no secret leakage, no unreferenced claims, and zero write-capable tool calls are release blockers.
- Performance budgets: IPC snapshot <100ms target; DB query <10ms; MCP timeout 15s; model timeout 60s; >300ms shows progress; >3s is cancellable.

## Review Search

Search every change for:

- `ctx.effect(` (Cordis v4-only pattern)
- `JSON.stringify(state` near outbound requests or prompts
- direct SQLite business writes outside `TravelStateService.apply`
- raw `setInterval` / `setTimeout`
- `shell: true` in MCP process launch

## Current Limitation

`npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` are active gates. D1 tests cover credentials, JSONL corruption, eight-service registration, WAL/foreign keys, ten-event replay, and byte-identical rebuild; Electron safeStorage and the visible shell have separate smoke evidence under `test/artifacts/`.

## Sources

`ARCHITECTURE.md` §§4–8; `COLLABORATION.md` §§4–7; `PERFORMANCE.md` §§1, 5–6.
