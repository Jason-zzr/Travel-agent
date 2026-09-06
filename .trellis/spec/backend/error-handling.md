# Error Handling

> Normative contract from `ERROR_HANDLING.md`; implementation files do not exist yet.

## Error Model

Use `AppError` with a stable `ErrorCode` and one class:

- `BUG`: invariant, registration, migration, or internal schema failure. Throw immediately.
- `EXTERNAL`: provider, MCP, credential, timeout, rate, quota, or schema-drift failure. Degrade explicitly.
- `USER`: invalid or out-of-envelope input. Return an actionable correction.
- `BLOCKED`: evidence or Gate requirements are unmet. Stay in the current stage and list exact missing items.

Error codes use `DOMAIN_REASON` in SCREAMING_SNAKE and are append-only in `src/shared/errors.ts`.

## IPC Boundary

Every IPC handler uses `src/main/ipc/wrap.ts` and returns:

```ts
type IpcResult<T> = { ok: true; data: T } | { ok: false; error: SerializedError }
```

Never throw an `Error` across IPC. Serialization exposes only `code`, `klass`, and `userHint`; keep `message`, `cause`, `stack`, paths, and parameters in redacted main-process logs.

## External Failure Policy

- Timeout/network failures: retry one time after one-second backoff, then increment `fail_streak`.
- A frozen source-specific one-shot contract overrides that generic retry policy. D3 Search/XHS, D5 Rail round-trip discovery, and structure/live acceptance do not retry; D5 Rail stops on connect, discovery, outbound, or return failure.
- Connection failures degrade at `fail_streak >= 2`.
- Zod response drift: do not retry; emit `SOURCE_DRIFT`, degrade immediately, and keep `fail_streak` unchanged.
- On the D4 XHS one-session `search_feeds` / `get_feed_detail` path only, schema drift also derives one bounded structural fingerprint from the already-returned result. Likely dynamic identifier keys are masked, and diagnostic traversal failures return a fixed safe marker rather than replacing the primary error. This diagnostic does not relax the schema or add a probe, call, retry, fallback, Claim, event, or state transition.
- If D4 XHS returns no result before the `callTool` deadline, classify it as `MCP_TIMEOUT`; no response means there is nothing to fingerprint. Do not infer an envelope shape, extend the timeout, retry, drop filters, shrink the frozen sample, or treat successful connect/list/login checks as search readiness.
- Degraded sources fast-fail for five minutes. Never fill missing data with model knowledge.
- Quota usage warns at 80% and hard-stops at 95%.
- Model output schema repair is attempted exactly once; a second failure becomes `MODEL_OUTPUT_INVALID` and `BLOCKED`.

## Credential Failures

- Encryption unavailable -> `CRED_UNAVAILABLE`; never fall back to plaintext.
- Decryption failure -> `CRED_DECRYPT_FAILED`, clear that ciphertext, require re-entry.
- Missing credential -> `UNCONFIGURED`, not an exception until the source is invoked.
- Electron `39.8.10` uses synchronous `encryptString` / `decryptString` after app ready. safeStorage provides cryptography only; version 1 base64 ciphertext is persisted atomically in `<userData>/credentials.json`.

## Forbidden Patterns

- One broad catch that collapses BUG, EXTERNAL, USER, and BLOCKED.
- `catch { return defaultValue }` for BUG-class failures.
- Retrying schema drift or counting it as a connectivity streak.
- Generic user text such as “service error” or “information insufficient” without the affected capability/item.
- Logging or serializing raw external payloads, credentials, or internal stack details to the renderer.

## Sources

`ERROR_HANDLING.md` §§1–3, 5, 7; `ARCHITECTURE.md` §5.

## D4 XHS strict override

The D4 30-post path explicitly overrides the generic one-repair model rule. All six EXTRACTION calls and the single REVIEW call use `repairInvalid=false`; the first invalid result is `MODEL_OUTPUT_INVALID` with no repair, retry, provider switch, or fallback. Four-search/15+15 shortage, any detail failure, digest/state/route drift, expiry, and cancellation are whole-operation failures. Source-detail Claims may remain auditable, but final Claims, ranking, checklist, and stage change must all be absent unless the complete 6+1 pipeline succeeds.

## Unified D6/D7 route scope

For a selected multi-city route, mutation requests must match current session/route plus draft/task identity before any event or projection write. Missing ETA, time, coordinate, Claim, official handover, or deadline remains an explicit blocking item; no model/source fallback is allowed. Route Gate failures name the leg, stay segment, MUST anchor, or coverage scope without returning raw Evidence or private address values.

## Pinned Rail package error text

`12306-mcp@0.3.10` may return a standard MCP text envelope whose trimmed first text begins with `Error:` without setting `isError`. The Rail envelope schema alone normalizes this documented package convention to `isError: true`; ToolRegistry then emits generic `MCP_TOOL_ERROR`, writes one value-free failed audit for an actual call, and produces no Claim or event for that item. Do not copy the error body into logs or persisted state.

Non-`Error:` malformed JSON, schema-invalid tickets, empty/non-text content, and `structuredContent`-only results remain `SOURCE_DRIFT`. Do not retry, infer the missing payload, or widen this compatibility rule to other providers.
