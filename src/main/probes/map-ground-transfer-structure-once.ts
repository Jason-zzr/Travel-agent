import type { StructureDiagnosticOutcome, ToolRegistryService } from '../plugins/tool-registry'

export function runMapGroundTransferStructureDiagnosticOnce(
  tools: ToolRegistryService
): Promise<StructureDiagnosticOutcome> {
  return tools.runStructureDiagnosticOnce({
    sourceId: 'SRC_MAP',
    toolName: 'maps_distance',
    args: {
      origins: '121.4737,31.2304',
      destination: '121.4998,31.2397',
      type: '1'
    },
    timeoutMs: 15_000
  })
}
