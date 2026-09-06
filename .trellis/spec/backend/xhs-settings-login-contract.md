# XHS Settings Login Contract

## 1. Scope / Trigger

This contract applies when Settings lets a user prepare the bundled Xiaohongshu MCP sidecar, obtain a login QR code, and scan it. It spans packaging, Main lifecycle, Renderer, preload, IPC, ToolRegistry, and the fixed `SRC_XHS` endpoint. It does not authorize content research, model calls, writes, automated authentication, or any externally managed Docker/container runtime. Successful login only establishes the session needed by later read-only operations: selected-route nodes default to XHS-first acquisition, but every node still requires its own zero-call preview, exact digest approval and one-shot execution.

## 2. Signatures

```ts
// Shared API
sources.xiaohongshuLoginQr(operationId: string): Promise<IpcResult<XhsLoginQrDisplay>>
sources.xiaohongshuStatus(operationId: string): Promise<IpcResult<XhsConnectionStatus>>

// Main service
tools.xhsLoginQr(timeoutMs?: number, operationId?: string): Promise<XhsLoginQrDisplay>

// Fixed MCP calls through the Main-owned sidecar
SRC_XHS.get_login_qrcode({})
SRC_XHS.check_login_status({})
```

IPC channels are `source:xiaohongshu-login-qr`, `source:xiaohongshu-status`, and the existing `source:cancel`. There is no database, event, file, clipboard, or model signature for login QR data.

## 3. Contracts

- Request: strict `{ operationId: UUID }`; Renderer cannot select endpoint, source, tool, arguments, timeout, or expiry.
- Package: pin one Windows amd64 binary, manifest, and Apache-2.0 license under exact `resources/xhs-mcp/` paths. Dev uses the repository resource; packaged mode uses `process.resourcesPath`. Main verifies regular files, realpath containment, exact version/commit/size/SHA-256 before spawn.
- Startup: only a login click or an exact-approved XHS research call may acquire a lease. Main fixes `127.0.0.1:18061`, refuses a pre-occupied port, starts with `shell:false`, uses a per-process 32-byte random Main-only `AUTH_TOKEN`, injects Bearer into its own HTTP session, and supplies only allowlisted environment variables plus app-owned cookies/cache/work paths.
- MCP QR success: either exactly two blocks in either order (one strict bounded text plus one strict `image/png`) or the exact text-only `你当前已处于登录状态`; PNG base64 must carry the PNG signature and decode to at most 512 KiB.
- MCP error: `isError=true` plus one or two bounded text blocks; ToolRegistry maps it to the existing safe MCP error path.
- Display response: strict discriminated union `QR_REQUIRED { imageDataUrl, hint, expiresAt } | ALREADY_LOGGED_IN`; Main constructs the fixed `data:image/png;base64,` prefix and a five-minute app-owned expiry only for `QR_REQUIRED`.
- Lifecycle: no app-start or initial-render spawn/download. Concurrent leases share one process. One QR request follows each explicit click; status reads start only after `QR_REQUIRED`, are sequential with fresh operation IDs, and stop on success, cancel, expiry, view teardown, or first failure. Renderer retains the initial login operation as the lifecycle identity, emits exactly one `source:cancel` for a terminal lifecycle, and emits no cancel when no login lifecycle was started. The last release idles briefly for adjacent calls; terminal UI paths and app quit force an immediate process-tree stop when no lease remains.
- Retention: QR bytes, data URL, prompt text, cookies, tokens, and raw envelope are memory-only and never enter logs, audits beyond the value-free tool-call record, JSONL, SQLite, Inspector, diagnostics, or exports.
- First use: Settings must disclose before the click that Chromium may require roughly 140–190MB of network download and can be cancelled. The application must not claim that the browser payload is bundled.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Missing/invalid UUID or extra request field | `INPUT_INVALID` at IPC parsing |
| Sidecar resource missing, replaced, symlinked, or digest/manifest drifted | `SOURCE_UNCONFIGURED`, no spawn |
| Fixed loopback port already occupied | `SOURCE_UNREACHABLE`, no spawn or attachment |
| Tool missing from discovery or local contract | `NOT_IN_ALLOWLIST` / `MCP_SCHEMA_INVALID` |
| Non-PNG, bad base64/signature, oversized image, extra block/field | `SOURCE_DRIFT`, no display DTO |
| MCP `isError=true` | `MCP_TOOL_ERROR`, raw text hidden |
| Connect/call timeout | existing `SOURCE_UNREACHABLE` / `MCP_TIMEOUT` mapping, no retry |
| User cancel or Settings teardown | close active session, `SOURCE_CANCELLED`, no degradation |
| Status is neither exact logged-in nor logged-out prefix | `SOURCE_DRIFT`, stop checks |

## 5. Good / Base / Bad Cases

- Good: user clicks once, Main validates/starts the bundled sidecar, receives text + PNG, Renderer shows the modal, a later strict status result is logged-in, QR state is cleared, and the idle sidecar stops.
- Base: no click means zero spawn, browser download, QR call, status call, cancel call, or content call. An exact text-only already-logged-in response reaches `ALREADY_LOGGED_IN` without fabricating an image.
- Bad: the port is occupied, artifact digest drifts, Renderer adds `toolName`, MCP sends JPEG/oversized/multiple images, or one status check fails; reject and stop without attachment, fallback, raw leakage, or hidden retry.

## 6. Tests Required

- Artifact/lifecycle: dev and packaged paths, manifest/digest/size/regular-file/containment, lazy zero-spawn, occupied-port refusal, singleton leases, Main-only auth/env, cancellation and app-quit cleanup.
- Schema: block order, PNG signature, base64 syntax, 512 KiB edge, exact already-logged-in text, unknown fields, explicit MCP error.
- ToolRegistry: fixed source/tool/empty args, one call, five-minute expiry, safe drift hint, session close, zero search/detail/model/write calls.
- IPC: authorized sender, strict UUID-only request, shared response decode, cancel channel.
- Renderer: zero-call initial render, first-use download disclosure, explicit login action, accessible dialog, duplicate-click lock, sequential status checks, exactly-one terminal lifecycle cancel, no-op teardown before login, success/expiry/cancel/unmount cleanup, stale-result rejection, and no legacy token input.
- Packaging/regression: exact three sidecar resources, no symlinks, digest/license verification, full format, lint, Node/Web typecheck, test, production build, and package verifier.

## 7. Wrong vs Correct

### Wrong

```ts
window.api.sources.call('get_login_qrcode', args)
localStorage.setItem('xhsQr', rawResult)
setInterval(checkStatus, 3000)
```

### Correct

```ts
window.api.sources.xiaohongshuLoginQr(operationId)
// Main fixes tool/args, returns only the validated display DTO.
// Renderer keeps it in component state and schedules the next status read
// only after the previous read completes.
```
