import { z } from 'zod'
import { JsonStructureSummarySchema } from './json-structure-summary'

export const FLYAI_PACKAGE_NAME = '@fly-ai/flyai-cli'
export const FLYAI_PACKAGE_VERSION = '1.0.16'
export const FLYAI_PACKAGE_INTEGRITY =
  'sha512-Ksi06xvJSJcdhmfoDbpAnA84K4/pF+SkLsa5ZLvNruUc3e2EpoGaI6FcJXKTODvB/evprfy5pdRzW3lVazqfkA=='
export const FLYAI_BIN_RELATIVE_PATH = 'dist/flyai-bundle.cjs'
export const FLYAI_UTILITY_PROCESS_LAUNCHER_RELATIVE_PATH =
  'resources/flyai-utility-process-launcher.cjs'
export const FLYAI_FLIGHT_COMMAND = 'search-flight'
export const FLYAI_FLIGHT_INPUT_CONTRACT_VERSION = 'flyai-search-flight-input/v1'
export const FLYAI_FLIGHT_RESULT_CONTRACT_VERSION = 'flyai-search-flight-result/structure-v1'
export const FLYAI_FLIGHT_LOCAL_RESULT_CONTRACT_VERSION =
  'flyai-search-flight-result/local-structure-v1'

const ChineseCityNameSchema = z.string().regex(/^\p{Script=Han}+$/u, {
  message: 'FlyAI city names must use Chinese characters without normalization.'
})

const IsoDateSchema = z.string().date()

export const FlyaiFlightSearchInputSchema = z
  .object({
    origin: ChineseCityNameSchema,
    destination: ChineseCityNameSchema,
    depDate: IsoDateSchema
  })
  .strict()

export function createFlyaiFlightSearchInputSchema(
  currentDate: string
): z.ZodEffects<typeof FlyaiFlightSearchInputSchema> {
  const validatedCurrentDate = IsoDateSchema.parse(currentDate)
  return FlyaiFlightSearchInputSchema.superRefine((value, context) => {
    if (value.depDate <= validatedCurrentDate) {
      context.addIssue({
        code: 'custom',
        path: ['depDate'],
        message: 'FlyAI departure date must be in the future.'
      })
    }
  })
}

export function parseFlyaiFlightSearchInput(
  input: unknown,
  currentDate: string
): FlyaiFlightSearchInput {
  return createFlyaiFlightSearchInputSchema(currentDate).parse(input)
}

export function toFlyaiFlightCliArgs(input: FlyaiFlightSearchInput): FlyaiFlightCliArgs {
  return [
    FLYAI_FLIGHT_COMMAND,
    '--origin',
    input.origin,
    '--destination',
    input.destination,
    '--dep-date',
    input.depDate
  ]
}

const ObservedStringSchema = z.string()
const ObservedBooleanSchema = z.boolean()
const ObservedNumberSchema = z.number().finite()

// Gate v4 retained only path/type entries aggregated across array members.
// The key set and primitive types can be strict, but member presence cannot be
// claimed from that evidence and therefore remains optional.
export const FlyaiFlightSearchSegmentRawSchema = z
  .object({
    arrCityAbroad: ObservedBooleanSchema.optional(),
    arrCityCode: ObservedStringSchema.optional(),
    arrCityName: ObservedStringSchema.optional(),
    arrDateTime: ObservedStringSchema.optional(),
    arrStationCode: ObservedStringSchema.optional(),
    arrStationName: ObservedStringSchema.optional(),
    arrTerminal: ObservedStringSchema.optional(),
    arrWeek: ObservedStringSchema.optional(),
    depCityAbroad: z.null().optional(),
    depCityCode: ObservedStringSchema.optional(),
    depCityName: ObservedStringSchema.optional(),
    depDateTime: ObservedStringSchema.optional(),
    depStationCode: ObservedStringSchema.optional(),
    depStationName: ObservedStringSchema.optional(),
    depTerminal: ObservedStringSchema.optional(),
    depWeek: ObservedStringSchema.optional(),
    duration: ObservedStringSchema.optional(),
    marketingTransportName: ObservedStringSchema.optional(),
    marketingTransportNo: ObservedStringSchema.optional(),
    miles: z.null().optional(),
    quantity: z.null().optional(),
    seatClassName: ObservedStringSchema.optional(),
    stopInfos: z.null().optional(),
    transportType: ObservedStringSchema.optional()
  })
  .strict()
  .refine((segment) => Object.keys(segment).length > 0, {
    message: 'FlyAI segment must contain at least one observed field.'
  })

export const FlyaiFlightSearchJourneyRawSchema = z
  .object({
    journeyType: ObservedStringSchema.optional(),
    segments: z.array(FlyaiFlightSearchSegmentRawSchema).optional(),
    totalDuration: ObservedStringSchema.optional(),
    transferDuration: ObservedStringSchema.optional()
  })
  .strict()
  .refine((journey) => Object.keys(journey).length > 0, {
    message: 'FlyAI journey must contain at least one observed field.'
  })

export const FlyaiFlightSearchItemRawSchema = z
  .object({
    journeys: z.array(FlyaiFlightSearchJourneyRawSchema).optional(),
    jumpUrl: ObservedStringSchema.optional(),
    tags: z.null().optional(),
    ticketPrice: ObservedStringSchema.optional(),
    totalDuration: ObservedStringSchema.optional()
  })
  .strict()
  .refine((item) => Object.keys(item).length > 0, {
    message: 'FlyAI item must contain at least one observed field.'
  })

export const FlyaiFlightSearchRawSchema = z
  .object({
    data: z.object({ itemList: z.array(FlyaiFlightSearchItemRawSchema) }).strict(),
    message: ObservedStringSchema,
    status: ObservedNumberSchema,
    systemMessage: z.null()
  })
  .strict()

const NullableStringSchema = z.string().nullable()
const NullableBooleanSchema = z.boolean().nullable()

export const FlyaiFlightSearchSegmentNormalizedSchema = z
  .object({
    arrivalCityAbroadRaw: NullableBooleanSchema,
    arrivalCityCodeRaw: NullableStringSchema,
    arrivalCityNameRaw: NullableStringSchema,
    arrivalDateTimeRaw: NullableStringSchema,
    arrivalStationCodeRaw: NullableStringSchema,
    arrivalStationNameRaw: NullableStringSchema,
    arrivalTerminalRaw: NullableStringSchema,
    arrivalWeekRaw: NullableStringSchema,
    departureCityAbroadRaw: z.null(),
    departureCityCodeRaw: NullableStringSchema,
    departureCityNameRaw: NullableStringSchema,
    departureDateTimeRaw: NullableStringSchema,
    departureStationCodeRaw: NullableStringSchema,
    departureStationNameRaw: NullableStringSchema,
    departureTerminalRaw: NullableStringSchema,
    departureWeekRaw: NullableStringSchema,
    durationRaw: NullableStringSchema,
    marketingTransportNameRaw: NullableStringSchema,
    marketingTransportNumberRaw: NullableStringSchema,
    milesRaw: z.null(),
    quantityRaw: z.null(),
    seatClassNameRaw: NullableStringSchema,
    stopInfosRaw: z.null(),
    transportTypeRaw: NullableStringSchema,
    startAt: z.null(),
    endAt: z.null(),
    durationMinutes: z.null(),
    transferCount: z.null()
  })
  .strict()

export const FlyaiFlightSearchJourneyNormalizedSchema = z
  .object({
    journeyTypeRaw: NullableStringSchema,
    segments: z.array(FlyaiFlightSearchSegmentNormalizedSchema).nullable(),
    totalDurationRaw: NullableStringSchema,
    transferDurationRaw: NullableStringSchema,
    durationMinutes: z.null(),
    transferDurationMinutes: z.null(),
    transferCount: z.null()
  })
  .strict()

export const FlyaiFlightSearchItemNormalizedSchema = z
  .object({
    journeys: z.array(FlyaiFlightSearchJourneyNormalizedSchema).nullable(),
    jumpUrlRaw: NullableStringSchema,
    tagsRaw: z.null(),
    ticketPriceRaw: NullableStringSchema,
    totalDurationRaw: NullableStringSchema,
    costCents: z.null(),
    currency: z.null(),
    durationMinutes: z.null()
  })
  .strict()

export const FlyaiFlightSearchNormalizedSchema = z
  .object({
    sourceId: z.literal('SRC_FLIGHT'),
    sourceTool: z.literal(FLYAI_FLIGHT_COMMAND),
    contractVersion: z.literal(FLYAI_FLIGHT_LOCAL_RESULT_CONTRACT_VERSION),
    mappingStatus: z.literal('LOCAL_STRUCTURE_ONLY'),
    providerStatusRaw: ObservedNumberSchema,
    providerMessageRaw: ObservedStringSchema,
    providerSystemMessageRaw: z.null(),
    items: z.array(FlyaiFlightSearchItemNormalizedSchema)
  })
  .strict()

export function normalizeFlyaiFlightSearchStructure(input: unknown): FlyaiFlightSearchNormalized {
  const raw = FlyaiFlightSearchRawSchema.parse(input)
  return FlyaiFlightSearchNormalizedSchema.parse({
    sourceId: 'SRC_FLIGHT',
    sourceTool: FLYAI_FLIGHT_COMMAND,
    contractVersion: FLYAI_FLIGHT_LOCAL_RESULT_CONTRACT_VERSION,
    mappingStatus: 'LOCAL_STRUCTURE_ONLY',
    providerStatusRaw: raw.status,
    providerMessageRaw: raw.message,
    providerSystemMessageRaw: raw.systemMessage,
    items: raw.data.itemList.map((item) => ({
      journeys:
        item.journeys?.map((journey) => ({
          journeyTypeRaw: journey.journeyType ?? null,
          segments:
            journey.segments?.map((segment) => ({
              arrivalCityAbroadRaw: segment.arrCityAbroad ?? null,
              arrivalCityCodeRaw: segment.arrCityCode ?? null,
              arrivalCityNameRaw: segment.arrCityName ?? null,
              arrivalDateTimeRaw: segment.arrDateTime ?? null,
              arrivalStationCodeRaw: segment.arrStationCode ?? null,
              arrivalStationNameRaw: segment.arrStationName ?? null,
              arrivalTerminalRaw: segment.arrTerminal ?? null,
              arrivalWeekRaw: segment.arrWeek ?? null,
              departureCityAbroadRaw: null,
              departureCityCodeRaw: segment.depCityCode ?? null,
              departureCityNameRaw: segment.depCityName ?? null,
              departureDateTimeRaw: segment.depDateTime ?? null,
              departureStationCodeRaw: segment.depStationCode ?? null,
              departureStationNameRaw: segment.depStationName ?? null,
              departureTerminalRaw: segment.depTerminal ?? null,
              departureWeekRaw: segment.depWeek ?? null,
              durationRaw: segment.duration ?? null,
              marketingTransportNameRaw: segment.marketingTransportName ?? null,
              marketingTransportNumberRaw: segment.marketingTransportNo ?? null,
              milesRaw: null,
              quantityRaw: null,
              seatClassNameRaw: segment.seatClassName ?? null,
              stopInfosRaw: null,
              transportTypeRaw: segment.transportType ?? null,
              startAt: null,
              endAt: null,
              durationMinutes: null,
              transferCount: null
            })) ?? null,
          totalDurationRaw: journey.totalDuration ?? null,
          transferDurationRaw: journey.transferDuration ?? null,
          durationMinutes: null,
          transferDurationMinutes: null,
          transferCount: null
        })) ?? null,
      jumpUrlRaw: item.jumpUrl ?? null,
      tagsRaw: null,
      ticketPriceRaw: item.ticketPrice ?? null,
      totalDurationRaw: item.totalDuration ?? null,
      costCents: null,
      currency: null,
      durationMinutes: null
    }))
  })
}

export const FlyaiCliStructureResultSchema = z
  .object({
    cliProcessAttempts: z.literal(1),
    applicationRetryCount: z.literal(0),
    internalProviderRequestCount: z.literal('UNKNOWN'),
    internalProviderRetryCount: z.literal('UNKNOWN'),
    rawResponseRetained: z.literal(false),
    valueRetention: z.literal(false),
    summary: JsonStructureSummarySchema.extend({ payloadKind: z.literal('JSON') })
  })
  .strict()

export type FlyaiFlightSearchInput = z.infer<typeof FlyaiFlightSearchInputSchema>
export type FlyaiCliStructureResult = z.infer<typeof FlyaiCliStructureResultSchema>
export type FlyaiFlightSearchRaw = z.infer<typeof FlyaiFlightSearchRawSchema>
export type FlyaiFlightSearchNormalized = z.infer<typeof FlyaiFlightSearchNormalizedSchema>
export type FlyaiFlightCliArgs = readonly [
  typeof FLYAI_FLIGHT_COMMAND,
  '--origin',
  string,
  '--destination',
  string,
  '--dep-date',
  string
]
