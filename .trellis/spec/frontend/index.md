# Frontend Development Guidelines

> React renderer contract. D4 evidence, D5 planning, and D6 timeline views use typed snapshots and main-owned domain state.

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | View/component/shared boundary and naming | Contract baseline |
| [Component Guidelines](./component-guidelines.md) | Product, accessibility, and security behavior | Contract baseline |
| [Hook Guidelines](./hook-guidelines.md) | IPC subscription and snapshot boundary | Contract baseline |
| [State Management](./state-management.md) | Main-owned domain state and renderer snapshots | Contract baseline |
| [Quality Guidelines](./quality-guidelines.md) | Sandbox, validation, UX, and acceptance gates | Contract baseline |
| [Type Safety](./type-safety.md) | Shared Zod, IPC, and TypeScript rules | Contract baseline |
| [XHS Settings Login Contract](../backend/xhs-settings-login-contract.md) | Settings QR modal, sequential status checks, cancellation, and memory-only retention | Implemented locally |
| [Multi-city Route Contracts](./multi-city-route-contracts.md) | STAGE-2 goal confirmation, route comparison, current-session actions, evidence gaps, and responsive behavior | Implemented locally through node-D4, route-D5, and unified D6/D7 |
| [D4 Evidence Contracts](../backend/d4-evidence-contracts.md) | Cross-layer D4 snapshot, progress, formal manual editor, research cards, conflict display, and confirmation gates | Implemented D4 locally |
| [Route D5 Planning Contracts](./route-d5-planning-contracts.md) | Ordered multi-leg/multi-stay SKELETON workflow, one-shot plans, scope isolation, local patch, and narrow layouts | Implemented locally for Yunnan pilot |
| [D6 Timeline Contracts](./d6-timeline-contracts.md) | Timeline dates, route/buffer display, gate, evidence navigation, history, progress, and privacy | Implemented D6 locally |
| [D7 Tasks/Inspector Contracts](./d7-task-inspector-contracts.md) | Task filters/handover/writeback, GATE_C, safe Inspector, exports, and privacy | Implemented D7 locally |

## Pre-Development Checklist

1. Read `directory-structure.md` and `type-safety.md` for every frontend change.
2. Read `state-management.md` and `hook-guidelines.md` for IPC or state work.
3. Read `component-guidelines.md` for UI behavior and copy.
4. Read `quality-guidelines.md` before implementation and review.
5. Read the authoritative root document cited by the selected guide; root contracts outrank this compressed spec.

**Language:** Specifications are written in English; UI copy follows `GLOSSARY.md` terminology.
