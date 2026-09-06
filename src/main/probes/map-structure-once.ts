import type { StructureDiagnosticOutcome, ToolRegistryService } from '../plugins/tool-registry'

export function runMapStructureDiagnosticOnce(
  tools: ToolRegistryService
): Promise<StructureDiagnosticOutcome> {
  return tools.runStructureDiagnosticOnce({
    sourceId: 'SRC_MAP',
    toolName: 'maps_geo',
    args: { address: '上海市人民广场', city: '上海' },
    timeoutMs: 15_000
  })
}
