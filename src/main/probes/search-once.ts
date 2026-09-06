import type { LiveAcceptanceOutcome, ToolRegistryService } from '../plugins/tool-registry'

export function runSearchAcceptanceOnce(
  tools: ToolRegistryService
): Promise<LiveAcceptanceOutcome> {
  return tools.runLiveAcceptanceOnce({
    sourceId: 'SRC_SEARCH',
    toolName: 'deepseek_web_search',
    args: {
      query: '上海市人民广场开放信息 官方'
    },
    timeoutMs: 60_000
  })
}
