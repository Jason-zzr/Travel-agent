# Backend Development Guidelines

> Backend contract for the Electron main process. D0–D7 domain contracts are implemented and indexed below.

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Main/shared/MCP/DB/IPC ownership and naming | Contract baseline |
| [Database Guidelines](./database-guidelines.md) | Event source, SQLite read model, migrations | Contract baseline |
| [Error Handling](./error-handling.md) | Error classes, IPC serialization, degradation | Contract baseline |
| [Quality Guidelines](./quality-guidelines.md) | Required patterns, safety and validation gates | Contract baseline |
| [Logging Guidelines](./logging-guidelines.md) | Structured JSONL logging and redaction | Contract baseline |
| [D2 Contracts](./d2-contracts.md) | Provider, interview, event, split-recovery, and IPC contracts | Implemented D2 |
| [Multi-city Route Contracts](./multi-city-route-contracts.md) | Strict itinerary intent, deterministic route candidates, source authorization, atomic selection, replay, and IPC | Implemented locally through node-D4, route-D5, and unified D6/D7 |
| [D3 Search Contracts](./d3-search-contracts.md) | Serper sources, DeepSeek streaming, credentials, progress, and audit contracts | Implemented D3 |
| [XHS Settings Login Contract](./xhs-settings-login-contract.md) | Explicit QR login, strict image/IPC validation, cancellation, and memory-only retention | Implemented locally |
| [D4 Evidence Contracts](./d4-evidence-contracts.md) | Destination convergence, Source Subagent, entity resolution, verification gates, IPC, UI, and replay | Implemented D4 |
| [D5 Planning Contracts](./d5-planning-contracts.md) | Legacy single-stay D5 plus the additive Yunnan route-scoped multi-leg/multi-stay contract | Implemented locally; legacy LIVE continuity passed |
| [D6 Timeline Contracts](./d6-timeline-contracts.md) | Route refinement, publish gate, version projection, snapshot recovery, IPC, and zero-call acceptance | Implemented locally; live Map/restaurant pending |
| [D7 Task/Gate/Export Contracts](./d7-task-gate-export-contracts.md) | Task derivation/writeback, GATE_C, safe export/Inspector, replay, and Windows packaging | Implemented locally; real trip and installer execution pending |

## Pre-Development Checklist

1. Read `directory-structure.md` for every backend change.
2. Read `database-guidelines.md` for events, SQLite, migrations, or replay.
3. Read `error-handling.md` and `logging-guidelines.md` for any fallible path or external call.
4. Read `quality-guidelines.md` before implementation and review.
5. Read the authoritative root document cited by the selected guide; root contracts outrank this compressed spec.

**Language:** Specifications are written in English; UI copy follows `GLOSSARY.md` terminology.
