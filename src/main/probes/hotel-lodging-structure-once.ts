import type { StructureDiagnosticOutcome, ToolRegistryService } from '../plugins/tool-registry'

export function runHotelLodgingStructureDiagnosticOnce(
  tools: ToolRegistryService
): Promise<StructureDiagnosticOutcome> {
  const checkInDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return tools.runStructureDiagnosticOnce({
    sourceId: 'SRC_HOTEL',
    toolName: 'searchHotels',
    args: {
      originQuery: '上海酒店查询',
      place: '上海',
      placeType: '城市',
      size: 3,
      checkInParam: {
        adultCount: 2,
        checkInDate,
        stayNights: 2
      }
    },
    timeoutMs: 15_000
  })
}
