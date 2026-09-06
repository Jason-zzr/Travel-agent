# Serper Search + DeepSeek Streaming MCP

独立、只读的 Python stdio MCP Server。Serper Search API 返回结构化搜索结果，DeepSeek 官方 Responses API 仅基于这些结果流式生成答案；不接入 SHUAI，也不启用 DeepSeek 原生 `web_search` / `open_page`。

## 安装

需要 Python 3.11+ 与 [uv](https://docs.astral.sh/uv/)。

```powershell
cd E:\Vibe-Coding\Travel-agent-APP\mcp-servers\deepseek-web-search
uv sync --frozen --extra dev
```

## 配置

在启动 MCP Host 之前设置 Serper Search 与官方 DeepSeek API Key：

```powershell
$env:DEEPSEEK_API_KEY = "你的官方 DeepSeek API Key"
$env:SERPER_API_KEY = "你的 Serper Search API Key"
```

可选变量：

- `DEEPSEEK_BASE_URL`：默认且只接受官方地址 `https://api.deepseek.com`（允许尾部 `/`）。
- `DEEPSEEK_MODEL`：默认且当前只接受 `deepseek-v4-flash`；DeepSeek Responses API 暂不支持 `deepseek-v4-pro`。
- `SERPER_BASE_URL`：默认且只接受官方地址 `https://google.serper.dev`（允许尾部 `/`）。

服务不读取 `.env`。不要把真实 Key 写入仓库、MCP JSON 或日志。

## 启动

```powershell
uv run deepseek-web-search-mcp
```

该命令使用 stdio，正常启动后不会显示网页或交互提示。

## Travel Agent 集成

Travel Agent 直接启动 `.venv\Scripts\deepseek-web-search-mcp.exe`，并从本机凭据存储注入两个 Key。应用运行时不会执行 `uv sync`，所以首次开发启动前必须先完成上面的安装步骤。缺少任一 Key 或本地可执行文件时，`SRC_SEARCH` 会保持 `UNCONFIGURED` 并给出配置提示。

## 其他 MCP Host 配置

先确保 MCP Host 进程继承了 `DEEPSEEK_API_KEY` 与 `SERPER_API_KEY`，再加入：

```json
{
  "mcpServers": {
    "deepseek-web-search": {
      "command": "uv",
      "args": [
        "--directory",
        "E:\\Vibe-Coding\\Travel-agent-APP\\mcp-servers\\deepseek-web-search",
        "run",
        "deepseek-web-search-mcp"
      ]
    }
  }
}
```

工具名为 `deepseek_web_search`，参数只有必填字符串 `query`。

## 返回与流式事件

- Serper 请求固定为 `POST https://google.serper.dev/search`，使用 `X-API-KEY` 认证且正文只发送 `q`。
- 最终结果保留 Serper `organic[]` 中最多 10 条有效、去重 HTTPS 结果，每条都含 `title`、`url`、`snippet`。
- MCP progress 依次发送 `SEARCH_STARTED`、`SEARCH_RESULTS`、一个或多个 `ANSWER_DELTA`、`USAGE`。
- `usage` 来自 DeepSeek 响应级 token 统计；`audit` 记录检索调用次数与 grounding 字符数。
- 因为原生网页工具未启用，`native_open_page_calls` 与 `open_page_tokens` 必须精确为 `0`，而不是估算值。
- 搜索结果被标记为不可信外部文本，不能覆盖系统指令。

## 验证

以下命令全部使用 fake client，不调用真实 API：

```powershell
uv run pytest
uv run ruff check .
uv run mypy src tests
```

真实搜索会分别向 Serper 与 DeepSeek 发起一次外部请求并可能产生费用；仅在明确授权后执行，失败不自动重试。
