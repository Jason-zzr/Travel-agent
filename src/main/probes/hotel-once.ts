import type { LiveAcceptanceOutcome, ToolRegistryService } from '../plugins/tool-registry'

export function runHotelAcceptanceOnce(tools: ToolRegistryService): Promise<LiveAcceptanceOutcome> {
  return tools.runLiveAcceptanceOnce({
    sourceId: 'SRC_HOTEL',
    toolName: 'searchHotels',
    args: {
      originQuery: '上海酒店查询',
      place: '上海',
      placeType: '城市',
      size: 5,
      checkInParam: {
        adultCount: 2,
        checkInDate: '2026-09-15',
        stayNights: 2
      }
    },
    timeoutMs: 15_000
  })
}
