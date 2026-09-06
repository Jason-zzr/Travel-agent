# Third-Party Notices

## Xiaohongshu MCP

Travel Harness redistributes the official Windows x64 binary of `xpzouying/xiaohongshu-mcp` v2.5.0, commit `6583124dfda92312b6bc19a042a6acfae63fe498`, under the Apache License 2.0.

Source and release: `https://github.com/xpzouying/xiaohongshu-mcp/releases/tag/v2.5.0`. The packaged file `xiaohongshu-mcp-windows-amd64.exe` is pinned to 15,601,664 bytes and SHA-256 `3578c9fcf3e7be0b79564aeceef8c4f38e0072d9357ca1f911ee14cd37bd454c`. A complete license copy is distributed beside the binary as `xhs-mcp/LICENSE.txt`.

Travel Harness starts this component only after an explicit login or separately authorized Xiaohongshu research action. The component is restricted to loopback with a per-process in-memory authorization token; upstream write-capable tools are not registered. Chromium is not included in the installer and may be downloaded by the component only after the user initiates login.

## DeepSeek Harness

The event-log append rollback pattern in `src/main/plugins/event-log.ts` was adapted from DeepSeek Harness, commit `141eb6fef83422698aef7a981029e843e8161534`.

MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## FlyAI CLI

Travel Harness includes the exact npm dependency `@fly-ai/flyai-cli@1.0.16` for a Gate-bound, Electron Main-only local flight-reference probe. The package manifest declares the license as MIT. The published tarball inspected for this build did not include a separate `LICENSE` file or populated author/repository metadata; those omissions should be rechecked before redistribution or any version upgrade.

Pinned npm registry integrity: `sha512-Ksi06xvJSJcdhmfoDbpAnA84K4/pF+SkLsa5ZLvNruUc3e2EpoGaI6FcJXKTODvB/evprfy5pdRzW3lVazqfkA==`.

The fixed bundle also contains a vendor-provided embedded credential fallback and `x-ff-ctx` handling. Travel Harness requires a user-supplied credential from Electron `safeStorage`, explicitly overrides `FLYAI_API_KEY`, and fails before process creation when that credential is absent. The embedded value is intentionally not reproduced in source, logs, documentation, artifacts, or UI.

This notice records a LOCAL dependency and supply-chain boundary only. Phase A did not execute the bundle; one later exact-approved Gate v2 was consumed and failed without producing admissible structure evidence. The subsequent classifier-v2/Gate-v3 LOCAL work did not read a real key, generate a workspace preview, execute FlyAI, or call the provider. RollingGo Flight is unavailable and VariFlight R-1/R-2/R-3 remain historical, non-production diagnostic evidence; neither is represented as FlyAI capability.

## Portkey Gateway

The narrow provider-profile/request-transform pattern in `src/main/model-gateway.ts` was adapted from Portkey Gateway v1.15.1, commit `580c2421ff10ab4a753438b1c12637c0e5706798`, specifically `src/services/transformToProviderRequest.ts` and `src/providers/deepseek/api.ts`. Travel Harness does not embed Portkey's server, dynamic registry, retry/fallback engine, streaming, telemetry, or permissive transformer types.

MIT License

Copyright (c) 2024 Portkey, Inc

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
