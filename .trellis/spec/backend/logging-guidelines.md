# Logging Guidelines

> Normative observability contract from `ERROR_HANDLING.md`; the logger is not implemented yet.

## Sink and Format

- Write one JSON object per line to `<userData>/logs/app-YYYY-MM-DD.jsonl`.
- Also write to stdout in development. Retain disk logs for 14 days.
- Required fields: `ts`, `level`, `scope`, `msg`.
- Optional fields: `code`, `sessionId`, `durationMs`, `ctx`.
- Scopes follow directory ownership: `main.bootstrap`, `plugins.coordinator`, `mcp.rail`, `db.migrate`, `ipc.session`, `skill.s08`.

```json
{"ts":"2026-08-21T10:04:11.238Z","level":"error","scope":"mcp.rail","code":"SOURCE_DRIFT","msg":"rail response schema mismatch","ctx":{"keys":["data"],"missing":["arrive_time"]}}
```

## Levels

- `debug`: local investigation; not written to disk by default.
- `info`: successful lifecycle and significant domain transitions.
- `warn`: recoverable degradation, approaching quota, rejected registration.
- `error`: failed operation or invariant that requires visible action.

## Required Records

- MCP calls: start/end, duration, source/tool, and `ok`.
- Model calls: role, model, token counts, cost, duration, and `ok`.
- Tool registration rejection: `blocked_tools` row plus log line; do not invent a persisted event type.
- Source health transitions, Gate results, bootstrap loading/self-check, and each resource disposal result.

## Redaction

All logs, log context, Inspector data, and exports pass through one `redact()` function using an allowlist of safe keys. Never record:

- API keys, Bearer tokens, safeStorage ciphertext, or any fragment/prefix.
- Names, document numbers, contact details, health, or care information.
- Raw tool arguments or raw conversation text.
- Full TravelState serialization.

Use `args_digest` for tool audit data and structural key paths—not values—for schema drift.

For XHS `search_feeds` / `get_feed_detail` drift, `ctx.keys` may contain one deterministic structural fingerprint of the MCP envelope and parsed `content[0].text`: object keys are sorted and restricted to short ASCII identifiers, likely dynamic IDs/high-entropy keys use a fixed placeholder, arrays expose only the first element type, and depth, nodes, keys per object, and output length are hard-bounded. Scalar values, lengths, raw text, hashes, tokens, comments, credentials, and full arguments remain forbidden. Getter/proxy or traversal failures collapse to a fixed value-free failure marker so diagnostics never replace the primary `SOURCE_DRIFT`. The fingerprint is log-only and must not enter ToolCallAudit, SQLite, JSONL, IPC, Inspector, or exports.

An XHS `MCP_TIMEOUT` that expires before a result exists records the normal bounded tool audit (`source`, `tool`, `durationMs`, `ok=false`, safe error code) and no structural fingerprint. Absence of `keys` in that case means “no response available for schema inspection”, not “the schema is valid” and not “connect/login failed”.

## Sources

`ERROR_HANDLING.md` §§4, 6–7; `DATA_MODEL.md` §4.
