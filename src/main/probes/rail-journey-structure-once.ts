import type { StructureDiagnosticOutcome, ToolRegistryService } from '../plugins/tool-registry'

export function runRailJourneyStructureDiagnosticOnce(
  tools: ToolRegistryService
): Promise<StructureDiagnosticOutcome> {
  const date = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return tools.runStructureDiagnosticOnce({
    sourceId: 'SRC_RAIL',
    toolName: 'get-tickets',
    args: {
      date,
      fromStation: '上海虹桥',
      toStation: '杭州东',
      limitedNum: 3,
      format: 'json'
    },
    timeoutMs: 120_000
  })
}
