from __future__ import annotations

import asyncio
import json
import os
import sys
from collections.abc import Mapping
from typing import cast

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.types import CallToolResult, TextContent


async def _tool_contract() -> tuple[str, object, CallToolResult]:
    child_env = dict(os.environ)
    child_env.pop("DEEPSEEK_API_KEY", None)
    child_env.pop("SERPER_API_KEY", None)
    executable_name = (
        "deepseek-web-search-mcp.exe" if os.name == "nt" else "deepseek-web-search-mcp"
    )
    executable = os.path.join(os.path.dirname(sys.executable), executable_name)
    assert os.path.isfile(executable)
    parameters = StdioServerParameters(
        command=executable,
        args=[],
        env=child_env,
    )
    async with (
        stdio_client(parameters) as (reader, writer),
        ClientSession(reader, writer) as session,
    ):
        await session.initialize()
        response = await session.list_tools()
        assert len(response.tools) == 1
        tool = response.tools[0]
        result = await session.call_tool(tool.name, {"query": "weather"})
        return tool.name, tool.inputSchema, result


def test_stdio_server_initializes_and_lists_one_tool() -> None:
    name, schema, result = asyncio.run(_tool_contract())
    schema_map = cast(Mapping[str, object], schema)
    properties = cast(Mapping[str, object], schema_map["properties"])
    query_schema = cast(Mapping[str, object], properties["query"])

    assert name == "deepseek_web_search"
    assert schema_map["required"] == ["query"]
    assert query_schema["type"] == "string"
    assert query_schema["minLength"] == 1
    assert query_schema["maxLength"] == 4000

    content = result.content[0]
    assert isinstance(content, TextContent)
    payload = json.loads(content.text)
    assert payload == {
        "ok": False,
        "answer": None,
        "model": "deepseek-v4-flash",
        "search_provider": "serper-search",
        "sources": [],
        "usage": None,
        "audit": None,
        "error_code": "CONFIGURATION",
        "message": "Serper Search 或 DeepSeek 官方 API 配置无效，请检查环境变量。",
    }
