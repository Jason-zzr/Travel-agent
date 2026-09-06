# Backend Directory Structure

> Contract derived from `ARCHITECTURE.md`. D0 established the Electron entry and preload boundary; the remaining backend layout is a D1 target.

## Layout

```text
src/
├─ shared/                 # Runtime schemas, types, events, IPC contract; zero Node dependencies
├─ main/
│  ├─ index.ts             # Electron entry: app.whenReady() -> bootstrap()
│  ├─ bootstrap.ts         # Root Cordis context and ordered plugin loading
│  ├─ plugins/             # One kernel service per file
│  ├─ mcp/                 # MCP lifecycle, allowlist, quota, cache, source adapters
│  ├─ skills/              # One sNN-* skill per file
│  ├─ db/                  # Open, migrate, migrations, and DB name mapping
│  ├─ ipc/                 # One handler file per domain plus wrap.ts
│  ├─ credentials.ts       # The only safeStorage import
│  ├─ credential-store.ts  # Versioned ciphertext persistence; Electron-free for tests
│  └─ paths.ts             # The only source of disk paths
├─ preload/index.ts        # Single-file contextBridge whitelist
└─ renderer/               # UI only
test/                      # Read-only acceptance fixtures and verification scripts
```

## Ownership and Boundaries

- `src/shared/` must have no Node dependencies and is the only code shared by main, preload, and renderer.
- A Cordis kernel service is one plugin file. Services are obtained only through `inject`; never import a service instance across modules.
- Every MCP source has one adapter under `src/main/mcp/sources/` and one return schema under `src/shared/schema/mcp/`.
- Database name conversion between TypeScript camelCase and SQL snake_case occurs only in `src/main/db/`.
- Acceptance scripts under `test/` may read SQLite and JSONL but must not import `src/`.
- Parallel lanes own one directory only. Cross-directory changes return to the main integration lane.

## Naming

- Files and directories: kebab-case.
- Types and classes: PascalCase; no `I` prefix.
- Cordis service keys: fixed camelCase short names.
- Skills: `sNN-semantic-name.ts`.
- Cordis and persisted events: `domain/action`; IPC channels: `domain:action`.

## Forbidden Patterns

- Module-level service or database singletons.
- Combining multiple kernel services in one plugin.
- Constructing disk paths outside `src/main/paths.ts`.
- Putting Node imports into `src/shared/` or renderer code.
- Adding a second MCP invocation or tool-registration path outside `ToolRegistry`.

## Current Example

- `src/main/bootstrap.ts` loads and asserts the eight D1 Cordis plugins from `src/main/plugins/`.
- `src/main/index.ts` owns the sandboxed Electron window, binds credential IPC to that window, and waits for `AppKernel.stop()` before quit.
- `src/preload/index.ts` exposes only the typed credential status/save/clear wrappers; it never exposes `ipcRenderer` itself.
- `src/main/mcp/stdio-client.ts` plus `plugins/tool-registry.ts` are the single D1 rail MCP path.

## Sources

`ARCHITECTURE.md` §§2–4, 6; `COLLABORATION.md` §§1–2, 7.
