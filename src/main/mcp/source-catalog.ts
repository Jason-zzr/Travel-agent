import { z } from 'zod'
import {
  firstMcpText,
  McpTextToolResultSchema,
  type McpTextToolResult
} from '../../shared/schema/mcp/common'
import { HotelSearchNormalizedSchema, HotelToolResultSchema } from '../../shared/schema/mcp/hotel'
import {
  MapDistanceRawSchema,
  MapGeocodeNormalizedSchema,
  MapGeocodeRawSchema,
  MapToolResultSchema
} from '../../shared/schema/mcp/map'
import {
  RailCurrentDateSchema,
  RailTicketsSchema,
  RailToolResultSchema
} from '../../shared/schema/mcp/rail'
import { DeepSeekSearchResultSchema } from '../../shared/schema/mcp/search'
import {
  XhsFeedDetailPayloadSchema,
  XhsLoginQrMcpResultSchema,
  XhsMcpTextToolResultSchema,
  XhsSearchFeedsPayloadSchema
} from '../../shared/schema/mcp/xiaohongshu'
import type { CredentialId } from '../../shared/schema/credentials'
import type { ExternalSourceId } from '../../shared/schema/source'

export interface ToolContract {
  args: z.ZodTypeAny
  result: z.ZodTypeAny
  resultForArgs?: (args: Record<string, unknown>) => z.ZodTypeAny
  structureOnly?: true
}

export interface SourceDefinition {
  sourceId: ExternalSourceId
  credentialId: CredentialId | null
  additionalCredentialIds?: readonly CredentialId[]
  optionalCredentialIds?: readonly CredentialId[]
  allowlist: ReadonlySet<string>
  tools: Readonly<Record<string, ToolContract>>
  probeTool: string | null
  discoveryOnly?: true
  capabilityImpact: string
  manualAlternative: string
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const textResult = RailToolResultSchema
function validatedTextResult(
  schema: z.ZodTypeAny,
  json = false,
  envelopeSchema: z.ZodType<McpTextToolResult> = McpTextToolResultSchema
): z.ZodTypeAny {
  return envelopeSchema.superRefine((result, context) => {
    if (result.isError) return
    try {
      const text = firstMcpText(result)
      schema.parse(json ? JSON.parse(text) : text)
    } catch (error) {
      if (error instanceof z.ZodError) {
        for (const issue of error.issues) {
          context.addIssue({ ...issue, path: ['content', 0, 'text', ...issue.path] })
        }
      } else {
        context.addIssue({
          code: 'custom',
          path: ['content', 0, 'text'],
          message: 'Expected schema-valid JSON text.'
        })
      }
    }
  })
}

const railTools: Readonly<Record<string, ToolContract>> = {
  'get-current-date': {
    args: z.object({}).strict(),
    result: validatedTextResult(RailCurrentDateSchema, false, RailToolResultSchema)
  },
  'get-stations-code-in-city': {
    args: z.object({ city: z.string().min(1) }).strict(),
    result: textResult
  },
  'get-station-code-of-citys': {
    args: z.object({ citys: z.string().min(1) }).strict(),
    result: textResult
  },
  'get-station-code-by-names': {
    args: z.object({ stationNames: z.string().min(1) }).strict(),
    result: textResult
  },
  'get-station-by-telecode': {
    args: z.object({ stationTelecode: z.string().regex(/^[A-Za-z]{3}$/) }).strict(),
    result: textResult
  },
  'get-tickets': {
    args: z
      .object({
        date,
        fromStation: z.string().min(1),
        toStation: z.string().min(1),
        trainFilterFlags: z
          .string()
          .regex(/^[GDZTKOFS]*$/)
          .max(8)
          .default(''),
        earliestStartTime: z.number().min(0).max(24).default(0),
        latestStartTime: z.number().min(0).max(24).default(24),
        sortFlag: z.enum(['', 'startTime', 'arriveTime', 'duration']).default(''),
        sortReverse: z.boolean().default(false),
        limitedNum: z.number().int().nonnegative().default(0),
        format: z.enum(['text', 'csv', 'json']).default('text')
      })
      .strict(),
    result: textResult,
    resultForArgs: (args) =>
      args['format'] === 'json'
        ? validatedTextResult(RailTicketsSchema, true, RailToolResultSchema)
        : textResult
  },
  'get-interline-tickets': {
    args: z
      .object({
        date,
        fromStation: z.string().min(1),
        toStation: z.string().min(1),
        middleStation: z.string().default(''),
        showWZ: z.boolean().default(false),
        trainFilterFlags: z
          .string()
          .regex(/^[GDZTKOFS]*$/)
          .max(8)
          .default(''),
        earliestStartTime: z.number().min(0).max(24).default(0),
        latestStartTime: z.number().min(0).max(24).default(24),
        sortFlag: z.enum(['', 'startTime', 'arriveTime', 'duration']).default(''),
        sortReverse: z.boolean().default(false),
        limitedNum: z.number().int().positive().default(10),
        format: z.enum(['text', 'json']).default('text')
      })
      .strict(),
    result: textResult
  },
  'get-train-route-stations': {
    args: z
      .object({
        trainCode: z.string().min(1),
        departDate: date,
        format: z.enum(['text', 'json']).default('text')
      })
      .strict(),
    result: textResult
  }
}

const mapTools: Readonly<Record<string, ToolContract>> = {
  maps_direction_walking: {
    args: z.object({ origin: z.string(), destination: z.string() }).strict(),
    result: MapToolResultSchema
  },
  maps_direction_transit_integrated: {
    args: z
      .object({
        origin: z.string(),
        destination: z.string(),
        city: z.string(),
        cityd: z.string().optional()
      })
      .strict(),
    result: MapToolResultSchema
  },
  maps_direction_driving: {
    args: z.object({ origin: z.string(), destination: z.string() }).strict(),
    result: MapToolResultSchema
  },
  maps_geo: {
    args: z.object({ address: z.string().min(1), city: z.string().min(1) }).strict(),
    result: validatedTextResult(MapGeocodeRawSchema, true)
  },
  maps_regeocode: {
    args: z.object({ location: z.string().min(1) }).strict(),
    result: MapToolResultSchema
  },
  maps_around_search: {
    args: z
      .object({ location: z.string(), keywords: z.string(), radius: z.string().optional() })
      .strict(),
    result: MapToolResultSchema
  },
  maps_search_detail: {
    args: z.object({ id: z.string().min(1) }).strict(),
    result: MapToolResultSchema
  },
  maps_text_search: {
    args: z.object({ keywords: z.string().min(1), city: z.string().optional() }).strict(),
    result: MapToolResultSchema
  },
  maps_weather: {
    args: z.object({ city: z.string().min(1) }).strict(),
    result: MapToolResultSchema
  },
  maps_distance: {
    args: z
      .object({ origins: z.string(), destination: z.string(), type: z.string().optional() })
      .strict(),
    result: validatedTextResult(MapDistanceRawSchema, true)
  }
}

const hotelTools: Readonly<Record<string, ToolContract>> = {
  searchHotels: {
    args: z
      .object({
        originQuery: z.string().min(1),
        place: z.string().min(1),
        placeType: z.string().min(1),
        countryCode: z.string().length(2).optional(),
        size: z.number().int().min(1).max(20).default(5),
        checkInParam: z.object({
          adultCount: z.number().int().min(1).max(6),
          checkInDate: date,
          stayNights: z.number().int().min(1).max(28)
        }),
        filterOptions: z
          .object({
            distanceInMeter: z.number().positive().optional(),
            starRatings: z.tuple([z.number().min(0).max(5), z.number().min(0).max(5)]).optional()
          })
          .optional(),
        hotelTags: z.record(z.unknown()).optional()
      })
      .strict(),
    result: validatedTextResult(HotelSearchNormalizedSchema, true)
  },
  getHotelDetail: {
    args: z
      .object({
        hotelId: z.union([z.string(), z.number()]).optional(),
        name: z.string().optional(),
        dateParam: z.record(z.unknown()).optional(),
        occupancyParam: z.record(z.unknown()).optional(),
        localeParam: z.record(z.unknown()).optional()
      })
      .strict(),
    result: HotelToolResultSchema
  },
  getHotelSearchTags: { args: z.object({}).strict(), result: HotelToolResultSchema }
}

const xhsTools: Readonly<Record<string, ToolContract>> = {
  get_login_qrcode: {
    args: z.object({}).strict(),
    result: XhsLoginQrMcpResultSchema
  },
  check_login_status: {
    args: z.object({}).strict(),
    result: McpTextToolResultSchema
  },
  search_feeds: {
    args: z
      .object({
        keyword: z.string().trim().min(1).max(4000),
        filters: z
          .object({
            sort_by: z.enum(['综合', '最新', '最多点赞', '最多评论', '最多收藏']).optional(),
            note_type: z.enum(['不限', '视频', '图文']).optional(),
            publish_time: z.enum(['不限', '一天内', '一周内', '半年内']).optional(),
            search_scope: z.enum(['不限', '已看过', '未看过', '已关注']).optional(),
            location: z.enum(['不限', '同城', '附近']).optional()
          })
          .strict()
          .optional()
      })
      .strict(),
    result: validatedTextResult(XhsSearchFeedsPayloadSchema, true, XhsMcpTextToolResultSchema)
  },
  get_feed_detail: {
    args: z
      .object({
        feed_id: z
          .string()
          .trim()
          .min(8)
          .max(100)
          .regex(/^[A-Za-z0-9_-]+$/),
        xsec_token: z.string().min(1).max(4096),
        load_all_comments: z.literal(false).default(false)
      })
      .strict(),
    result: validatedTextResult(XhsFeedDetailPayloadSchema, true, XhsMcpTextToolResultSchema)
  }
}

export const SOURCE_DEFINITIONS: Readonly<Record<ExternalSourceId, SourceDefinition>> = {
  SRC_RAIL: {
    sourceId: 'SRC_RAIL',
    credentialId: null,
    allowlist: new Set(Object.keys(railTools)),
    tools: railTools,
    probeTool: 'get-current-date',
    capabilityImpact: '车次日期与时刻无法自动核验',
    manualAlternative: '请在 12306 查询后手工粘贴车次信息。'
  },
  SRC_MAP: {
    sourceId: 'SRC_MAP',
    credentialId: 'AMAP',
    allowlist: new Set(Object.keys(mapTools)),
    tools: mapTools,
    probeTool: 'maps_geo',
    capabilityImpact: '地点坐标与段间交通时间无法自动核验',
    manualAlternative: '请手工提供地点与预计通勤时间。'
  },
  SRC_HOTEL: {
    sourceId: 'SRC_HOTEL',
    credentialId: 'ROLLINGGO',
    allowlist: new Set(Object.keys(hotelTools)),
    tools: hotelTools,
    probeTool: 'getHotelSearchTags',
    capabilityImpact: '酒店库存、房型与取消政策无法自动核验',
    manualAlternative: '请从常用平台粘贴酒店候选。'
  },
  SRC_SEARCH: {
    sourceId: 'SRC_SEARCH',
    credentialId: 'DEEPSEEK',
    additionalCredentialIds: ['SERPER_SEARCH'],
    allowlist: new Set(['deepseek_web_search']),
    tools: {
      deepseek_web_search: {
        args: z.object({ query: z.string().min(1).max(4000) }).strict(),
        result: validatedTextResult(DeepSeekSearchResultSchema, true)
      }
    },
    probeTool: 'deepseek_web_search',
    capabilityImpact: '公开页面与最新公告无法自动检索',
    manualAlternative: '请粘贴官方页面或手工确认开放信息。'
  },
  SRC_XHS: {
    sourceId: 'SRC_XHS',
    credentialId: null,
    allowlist: new Set(Object.keys(xhsTools)),
    tools: xhsTools,
    probeTool: 'check_login_status',
    capabilityImpact: '小红书正向体验与避雷信号无法自动交叉核验',
    manualAlternative: '请在小红书手工搜索目的地和“避雷 + 目的地”，再粘贴公开链接。'
  },
  SRC_FLIGHT: {
    sourceId: 'SRC_FLIGHT',
    credentialId: null,
    allowlist: new Set(),
    tools: {},
    probeTool: null,
    discoveryOnly: true,
    capabilityImpact: '航班时刻、机场与展示价格无法自动核验',
    manualAlternative: '请从常用平台核对航班后，通过现有人工航班证据入口确认。'
  }
}

export { HotelSearchNormalizedSchema, MapGeocodeNormalizedSchema, RailCurrentDateSchema }
