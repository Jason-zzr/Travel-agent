# Frontend Type Safety

> Shared TypeScript and IPC contract. D0 enables strict compiler checks; concrete domain and IPC types remain pending D1.

## Compiler Rules

- TypeScript 5.x with `strict: true` and `noUncheckedIndexedAccess`.
- `any`, `@ts-ignore`, and unreviewed assertions are forbidden.
- Use `unknown` plus a type guard when narrowing cannot come from a schema.
- Use `import type` for type-only dependencies.

## Type Organization

- Runtime schemas: `src/shared/schema/<domain>.ts`.
- MCP response schemas: one file per source under `src/shared/schema/mcp/`.
- Pure types: `src/shared/types/`.
- IPC channel names, request types, response types, and push payloads: `src/shared/ipc-contract.ts`.
- Shared code must have zero Node dependencies.

## Runtime Validation

- External data is `unknown` until parsed by Zod.
- Derive TypeScript types with `z.infer<typeof Schema>`; do not maintain duplicate interfaces.
- Validate each MCP response and each model Skill output.
- IPC handlers return a discriminated result union; renderer code narrows on `ok`.

```ts
const parsed = EvidenceClaimSchema.parse(raw)
type EvidenceClaim = z.infer<typeof EvidenceClaimSchema>
```

## Forbidden Patterns

- `as DomainType` on raw IPC, MCP, persisted JSON, or model output.
- Importing a main-process type through a runtime module.
- Re-declaring a shared enum or IPC payload inside a component.
- Leaking SQL snake_case fields into renderer/domain types.

## Current Example

- `tsconfig.node.json` and `tsconfig.web.json` explicitly enable `strict` and `noUncheckedIndexedAccess`.
- `src/preload/index.d.ts` uses the shared handwritten `TravelHarnessApi`; `renderer/src/ipc.ts` validates credential, Provider, session, chat, comparison, and usage result unions with Zod before components consume them.
- Serialized failures contain only `code`, `klass`, and `userHint`. CHAT's out-of-envelope failure may additionally carry `comparison`; no raw error message or full TravelState crosses IPC.

## Sources

`ARCHITECTURE.md` §§3, 5–6; `ERROR_HANDLING.md` §2.

## D4 XHS shared boundary

`XhsRankingPreview`, `XhsRankingExecuteRequest`, progress, sample summary, attraction ranking, extraction batches, and checklist-event additions are owned by `src/shared/schema/d4.ts`, `src/shared/schema/mcp/xiaohongshu.ts`, `src/shared/schema/session-event.ts`, and `src/shared/ipc-contract.ts`. Preload and renderer import those types and parse IPC results; components must not redeclare query/filter/provider/count shapes or cast raw MCP/model/event payloads. Execute payload contains no user-supplied keyword, filter, provider, model, or count field.
