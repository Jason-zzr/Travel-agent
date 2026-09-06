import type { LiveAcceptanceOutcome, ToolRegistryService } from '../plugins/tool-registry'

export function runMapAcceptanceOnce(tools: ToolRegistryService): Promise<LiveAcceptanceOutcome> {
  return tools.runLiveAcceptanceOnce({
    sourceId: 'SRC_MAP',
    toolName: 'maps_geo',
    args: { address: '上海市人民广场', city: '上海' },
    timeoutMs: 15_000
  })
}
