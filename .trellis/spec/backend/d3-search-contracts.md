# D3 Serper Search and DeepSeek Streaming Contracts

## Scenario: BUILD-D3 independent search and grounded generation

### 1. Scope / Trigger

- Applies to `SRC_SEARCH`, the `deepseek_web_search` MCP tool, Serper result normalization, DeepSeek Responses streaming, Evidence UI progress, credential wiring, and safe audit fields.
- Triggered by changes to the search query/result schemas, `SERPER_SEARCH` or `DEEPSEEK` credential routing, MCP progress messages, source persistence, provider origins, model selection, or live acceptance.

### 2. Signatures

- MCP: `deepseek_web_search(query: SearchQuery, context: Context): SearchResult`.
- Pipeline: `run_search(query, *, environ, deepseek_client_factory, search_client_factory, progress_reporter): SearchResult`.
- Search transport: `POST https://google.serper.dev/search`, header `X-API-KEY`, JSON body `{ "q": string }`.
- Generation transport: `AsyncOpenAI.responses.create(model="deepseek-v4-flash", input=groundedPrompt, stream=true)` against `https://api.deepseek.com`.
- Main-process progress callback: `(payload: SearchStreamPayload) => void`, where `kind` is `SEARCH_STARTED`, `SEARCH_RESULTS`, `ANSWER_DELTA`, or `USAGE`.
- Final normalized display result: `{ answer, model, searchProvider, sources, usage, audit }`.

### 3. Contracts

- `SRC_SEARCH` requires two safeStorage credentials: `DEEPSEEK` and `SERPER_SEARCH`. The main process maps them only to child-process environment keys `DEEPSEEK_API_KEY` and `SERPER_API_KEY`; keys never enter renderer state, result payloads, logs, or evidence claims.
- Provider origins are fixed HTTPS origins with no userinfo, path, query, fragment, or non-default port: `api.deepseek.com` and `google.serper.dev`. The only supported model is `deepseek-v4-flash`.
- One invocation performs exactly one Serper request and one DeepSeek streaming Responses request. `SRC_SEARCH` has no retry, provider fallback, native DeepSeek `web_search`, or `open_page` call.
- Serper `organic[]` is normalized from `title`, `link`, and `snippet`: inspect at most 10 entries, retain only titled HTTPS URLs without userinfo, truncate snippets to 2,000 characters, deduplicate by URL, and preserve result order.
- The grounded prompt treats search results as untrusted data, instructs DeepSeek to use only supplied results, and uses numbered citations. The full structured source list comes from Serper, not from DeepSeek's opaque search internals.
- Progress order is `SEARCH_STARTED` -> `SEARCH_RESULTS` -> zero or more `ANSWER_DELTA` -> `USAGE`. Invalid progress JSON is ignored; the strict final result schema remains authoritative.
- Success requires a non-empty answer, at least one source, complete usage, `search_provider="serper-search"`, and audit literals `search_api_calls=1`, `native_web_search_calls=0`, `native_open_page_calls=0`, and `open_page_tokens=0`.
- Every accepted source becomes a `webSearchResult` EvidenceClaim with sanitized URL, title, snippet, and generated summary; validity is 24 hours.
- `BRAVE_SEARCH` remains parse-compatible only for version-1 credential files. It is hidden from Settings and is never routed by `SRC_SEARCH`.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Blank query or more than 4,000 characters | `INVALID_INPUT`; no external call |
| Missing key, wrong origin, or unsupported model | `CONFIGURATION`; no external call |
| Serper `401` / `403` or DeepSeek `401` / `403` | `UNAUTHORIZED`; no retry |
| Either provider returns `429` | `RATE_LIMITED`; no retry or fallback |
| Timeout / network failure / `5xx` | `TIMEOUT` or `UPSTREAM_UNAVAILABLE`; no raw body retained |
| Serper response is malformed | `INVALID_RESPONSE` |
| Serper yields no acceptable HTTPS result | `MISSING_CITATIONS`; DeepSeek is not called |
| DeepSeek stream yields no answer text | `MISSING_ANSWER` |
| DeepSeek stream omits terminal usage or has an invalid shape | `INVALID_RESPONSE` |
| MCP final envelope or result fails the strict Zod schema | `RESULT_SCHEMA_DRIFT` / `SOURCE_DRIFT` |
| Progress message fails its discriminated schema | Drop that progress message; continue validating the final result |

### 5. Good / Base / Bad Cases

- Good: Settings reports both `DEEPSEEK` and `SERPER_SEARCH` as `CONFIGURED`; sources appear before answer deltas; the final UI lists each source title and HTTPS URL; audit open-page counts and tokens are exactly zero.
- Base: Serper returns duplicate or non-HTTPS rows; normalization drops them, keeps valid ordered rows, and generation proceeds only when at least one valid source remains.
- Base: an old credential file still contains `BRAVE_SEARCH`; parsing succeeds, but the field is hidden and cannot satisfy the `SRC_SEARCH` credential gate.
- Bad: asking DeepSeek to perform opaque native search, fabricating citations from generated text, calling `open_page`, retrying after `429`, or falling back to another provider.
- Bad: accepting a renderer-only hot update after adding a credential ID. A stale Electron main process can reject `SERPER_SEARCH` even while the new Settings form is visible.

### 6. Tests Required

- Python unit tests for config/origin/model validation, Serper request shape, result filtering/deduplication/limit, grounded prompt injection defense, streaming deltas/usage, error classification, no retry, and exact audit literals.
- TypeScript schema tests for all progress variants, final success/failure unions, HTTPS source URLs, snake_case to camelCase usage/audit normalization, and strict rejection of drift.
- Main-process tests for the two-credential gate, environment mapping, `SRC_SEARCH` single attempt, progress forwarding, source persistence, legacy Brave parse-only behavior, and safe errors.
- Electron UI smoke for Settings save/status, source-first streaming, answer deltas, full source title/URL display, usage/audit display, and zero external calls in local smoke mode.
- Before any separately authorized live acceptance, restart the Electron dev main process after cross-process schema changes, re-save the credential, and assert `credential:list` returns `SERPER_SEARCH: CONFIGURED`. Run one fixed query, no retry, and retain no raw provider response.
- Required local gates: Python tests + Ruff + mypy; Node tests + ESLint + Prettier + Node/Web type checks; Electron build; XML and Trellis task validation.

### 7. Wrong vs Correct

#### Wrong

```ts
// Renderer hot-reloaded, but the old Electron main process still validates the prior enum.
await saveCredential('SERPER_SEARCH', key)
await retrySearchWithAnotherProvider(query)
```

```python
await client.responses.create(
    model="deepseek-v4-flash",
    tools=[{"type": "web_search"}],
    input=query,
)
```

#### Correct

```ts
// Restart the Electron main process after shared IPC/schema changes, then verify status.
await saveCredential('SERPER_SEARCH', key)
const status = await listCredentials()
// Assert SERPER_SEARCH is CONFIGURED before the single authorized search attempt.
```

```python
sources = await serper.search(query)  # one independent search request
prompt = build_grounded_prompt(query, sources)
answer = await deepseek.responses.create(
    model="deepseek-v4-flash",
    input=prompt,
    stream=True,
)
```

Independent search keeps complete sources visible and auditable. Streaming generation improves responsiveness without giving DeepSeek hidden retrieval authority, while the strict zero-valued native-search/open-page audit proves the boundary.
