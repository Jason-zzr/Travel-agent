# Frontend Quality Guidelines

> Frontend quality gate. D0 established lint, type-check, build, and a sandboxed Electron smoke test.

## Required Patterns

- Renderer sandbox enabled, `nodeIntegration` disabled, and `contextIsolation` enabled.
- Preload is a single bundle and exposes handwritten whitelist wrappers only; never expose `ipcRenderer`.
- All data access uses the typed `window.api`/`renderer/src/ipc.ts` boundary.
- Factual UI includes EvidenceClaim traceability and explicit uncertainty.
- Current timeline queries and displays use only the current version.
- Local edits trigger local recomputation; unrelated dates remain unchanged.

## Testing and Acceptance

- Type-check must pass with zero errors before interface freeze or task completion.
- Manually exercise keyboard navigation, visible focus, progress, cancellation, errors, degradation, and empty/unknown states.
- Verify UI assertions against SQLite/JSONL acceptance evidence where applicable; UI appearance alone cannot prove persistence or absence of actions.
- Settings must never reveal credential characters. Exports and diagnostics must pass secret scans.
- Timeline must show explicit buffers, trace facts within two clicks, and expose daily backups without counting them as scheduled duration.

## Forbidden Patterns

- Renderer imports from Electron main, Node, MCP, database, filesystem, or credential code.
- Direct `ipcRenderer` exposure or cross-IPC thrown errors.
- Full TravelState pushes, mutable renderer mirrors, or untyped payload casts.
- Empty placeholders that imply success (for example, blank cancellation policy).
- Color-only statuses, hidden degradation, generic blocking text, or certainty language for external data.
- UI affordances that imply the system can book, pay, cancel, refund, navigate, or summon a ride.

## Current Limitation

`npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` are active gates. `src/main/index.ts`, `src/preload/index.ts`, and `electron.vite.config.ts` are the security-boundary examples. D6 retains the four-day legacy smoke and adds unified D6/D7 SSR coverage for route scope, privacy and 820/320 widths plus a dedicated fake-session Electron smoke for route-scoped mutations, stale responses and legacy compatibility. A host GPU/runtime failure before page load is recorded as environment failure, not interaction success. Dedicated accessibility tooling remains pending.

## Sources

`ARCHITECTURE.md` §§2, 5–8; `ERROR_HANDLING.md` §§1–2, 5; `PERFORMANCE.md` §§1, 4–6; `TODO.md` §5.

## Navigation smoke regression (2026-09-10)

`test/electron/d3-ui-smoke.mjs` asserts the visible navigation labels independently:
规划 / 路线骨架 / 行程 / 待办 / 证据 / 运行记录 / 设置.
A copy change must update both the expected labels and click selectors; do not import
production labels into expected test data, since that would hide a broken label mapping.
The internal View identifiers remain CHAT / SKELETON / TIMELINE / TASKS / EVIDENCE /
INSPECTOR / SETTINGS. Localized labels do not rename IPC or stored domain values.

Run `npm.cmd run build` to completion before running tests or Electron smoke;
FlyAI utility fixtures read build output and can fail if it is being rewritten.
Then run `npm.cmd run smoke:d3-ui` and `npm.cmd run smoke:d3-ui:no-gpu` outside an
incompatible outer automation sandbox while retaining Electron sandbox=true,
contextIsolation=true and nodeIntegration=false. Both modes must verify evidence,
inspector, settings, fixture QR/status/cancel, zero renderer errors and externalCalls=0.
The default smoke currently disables hardware acceleration too; its pass proves the
default smoke configuration, not accelerated GPU rendering or real XHS login.