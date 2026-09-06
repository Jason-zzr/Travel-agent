# Component Guidelines

> Product and security contract for React components. D0 established React function-component syntax; product composition patterns remain pending.

## Responsibilities

- Components render read-only snapshot data and local ephemeral UI state.
- Domain mutations call typed IPC commands; components never mutate TravelState or access main-process resources.
- At STAGE-2, a known single destination renders an explicit typed `destination:confirm-fixed` action; it must not auto-advance or fabricate candidate cards. A fuzzy intent keeps the existing candidate-generation/selection path, and successful confirmation visibly refreshes STAGE-3 state.
- Session-scoped cards must receive only a snapshot whose `sessionId` equals the current `activeId`. While the current snapshot is absent, render an `aria-busy` loading state with no mutation actions; never reuse the previous session's snapshot as a temporary fallback.

```tsx
// Correct: a session switch cannot expose stale actions or data.
const currentD4 = d4?.sessionId === activeId ? d4 : null
return <DestinationCandidatesCard snapshot={currentD4} />
```
- Surface source, content identity, verification status, freshness, cost, and uncertainty wherever a factual recommendation is shown.
- Missing data must be explicit (`unknown`, `not configured`, `cannot verify`, or the domain-specific equivalent); never render an ambiguous blank.
- External failures name the missing capability and the manual fallback. Gate failures list exact missing items.

## Props and Types

- Define props with explicit TypeScript types; no `any`.
- Reuse types from `src/shared/` when they cross the process boundary.
- Do not cast raw IPC payloads inside components. Validation and contract decoding happen at the boundary.
- Keep credentials out of component state after submission. Settings show only `Configured`, `Not configured`, or `Re-entry required`; never show masks or prefixes.

## Accessibility

- All M0 workflows are keyboard reachable.
- Focus is visible.
- Color is never the only carrier of source, status, conflict, or risk.
- Operations over 300ms show progress; operations over 3s provide cancellation.
- A top-level ErrorBoundary may prevent a blank renderer; BUG failures must still be visible and must not silently default.
- Renderer tests for session-scoped actions must include a null/stale snapshot case and assert that no mutation label or button is present before the current snapshot loads.

## Language and Safety

- Do not claim external data is guaranteed or certain.
- When describing system behavior, do not use language implying booking, ordering, payment, purchase, ticket issuance, monitoring, or automatic refresh.
- Reservation tasks are user handoffs, not system-executed transactions.

## Styling Status

The D0 scaffold uses local CSS and a minimal function component in `src/renderer/src/App.tsx`. No product styling system, component library, or reusable props/composition pattern has been selected; do not introduce one as part of an unrelated task.

## Sources

`ARCHITECTURE.md` §§2, 5–7; `ERROR_HANDLING.md` §§1, 5; `GLOSSARY.md` §§2–9; `PERFORMANCE.md` §1.

## D4 XHS ranking surface

- With no current-session preview, render only the zero-call preview action; never expose execute from stale or another-session data.
- The authorization card shows destination, all four queries, 4+30 source reads, 6+1 model calls, retry=0, EXTRACTION/REVIEW provider and model, digest, and expiry semantics. Renderer cannot edit keywords, filters, provider, or counts.
- Ranking rows show rank, subject, score, exact `3R−4A+fit` breakdown, family-fit status/reasons, avoidance reasons and canonical source URLs, plus a visible `UGC 未核验` marker.
- Avoidance evidence is not an automatic delete. Missing avoidance remains explicit; EXCLUDE, ambiguous identity, and promotion-only entities do not appear in ranking.
- Never render xsec_token, comments, raw MCP/model responses, prompts, or credential-bearing URLs.
