# Frontend Directory Structure

> React contract from `ARCHITECTURE.md`. D0 established the renderer entry and placeholder shell; domain views remain D4 targets.

## Layout

```text
src/
├─ preload/index.ts
└─ renderer/
   ├─ index.html
   └─ src/
      ├─ App.tsx
      ├─ views/
      │  ├─ chat/
      │  ├─ skeleton/
      │  ├─ timeline/
      │  ├─ evidence/
      │  ├─ tasks/
      │  ├─ inspector/
      │  └─ settings/
      ├─ components/
      └─ ipc.ts
```

## Organization

- `App.tsx` owns the three-column application shell.
- Feature-specific UI stays in `views/<domain>/`.
- `components/` contains presentation components shared by multiple views; do not abstract a single-use component.
- `ipc.ts` is a thin wrapper around the preload `window.api` contract.
- Shared schemas and IPC types live in `src/shared/`, which must remain free of Node dependencies.
- The renderer never imports Electron, MCP, database, filesystem, credential, or main-process modules.

## Naming

- Files/directories: kebab-case, except conventional React entry components such as `App.tsx`.
- Components/types: PascalCase. Values/functions: camelCase.
- IPC channels use `domain:action`; Cordis/persisted events use `domain/action` and must not be substituted for IPC names.

## Examples Status

`src/renderer/src/App.tsx` is the D1 SETTINGS shell and `src/renderer/src/ipc.ts` validates typed credential results. Domain `views/`, shared components, and snapshot hooks remain D4 targets.

## Sources

`ARCHITECTURE.md` §§2–3, 5–6.
