Variflight MCP 服务器
为 VariFlight 航班信息服务实现的模型上下文协议（MCP）服务器。该服务器提供了多种工具来查询航班信息、天气数据和飞行舒适度指标。

---
安装：
{
  "mcpServers": {
    "variflight-mcp": {
      "type": "sse",
      "url": "https://mcp.api-inference.modelscope.net/cd43171bbbf24d/sse"
    }
  }
}

---
可用工具
# 1.使用 IATA 代码搜索机场之间的航班：
{
  "mcpServers": {
    "variflight-mcp": {
      "type": "sse",
      "url": "https://mcp.api-inference.modelscope.net/cd43171bbbf24d/sse"
    }
  }
}

# 2.使用航班号搜索航班：
getFlightTransferInfo({
  depcity: "BJS",
  arrcity: "LAX",
  depdate: "2024-03-20"
})

# 3.获取详细的飞行舒适度指标：
flightHappinessIndex({
  fnum: "MU2157",
  date: "2024-03-20"
})

# 4.使用注册号跟踪飞机位置：
getRealtimeLocationByAnum({
  anum: "B2021"
})

# 5. 获取机场三天天气预报：
getFutureWeatherByAirport({
  airport: "PEK"
})

# 6.搜索可购买的航班选项并获取最低价格：
searchFlightItineraries({
  depCityCode: "BJS",  // Beijing
  arrCityCode: "SHA",  // Shanghai
  depDate: "2025-04-20"
})