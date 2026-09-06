import { z } from 'zod'
import { firstMcpText } from './common'

export const VARIFLIGHT_FLIGHT_PRICE_TOOL_NAME = 'getFlightPriceByCities'
export const VARIFLIGHT_FLIGHT_PRICE_INPUT_CONTRACT_VERSION =
  'variflight-get-flight-price-by-cities-input/v1'
export const VARIFLIGHT_FLIGHT_PRICE_RESULT_CONTRACT_VERSION =
  'variflight-get-flight-price-by-cities-result/local-structure-v1'

const IataCityCodeSchema = z.string().regex(/^[A-Z]{3}$/)

export const VariflightFlightPriceArgsSchema = z
  .object({
    dep_city: IataCityCodeSchema,
    arr_city: IataCityCodeSchema,
    dep_date: z.string().date()
  })
  .strict()

const DescriptorStringFieldSchema = (pattern: string): z.ZodTypeAny =>
  z.object({ type: z.literal('string'), pattern: z.literal(pattern) }).passthrough()

const VariflightFlightPriceRequiredFieldsSchema = z
  .array(z.enum(['dep_city', 'arr_city', 'dep_date']))
  .length(3)
  .refine((fields) => new Set(fields).size === 3)

export const VariflightFlightPriceDescriptorInputSchema = z
  .object({
    type: z.literal('object'),
    properties: z
      .object({
        dep_city: DescriptorStringFieldSchema('^[A-Z]{3}$'),
        arr_city: DescriptorStringFieldSchema('^[A-Z]{3}$'),
        dep_date: DescriptorStringFieldSchema('^\\d{4}-\\d{2}-\\d{2}$')
      })
      .strict(),
    required: VariflightFlightPriceRequiredFieldsSchema,
    additionalProperties: z.literal(false)
  })
  .passthrough()

const ObservedStringSchema = z.string()
const ObservedNumberSchema = z.number().finite()

// Gate R-2 retained only a path/type summary aggregated across array members.
// The known key set and observed primitive types can therefore be strict, but
// member-level presence cannot be claimed and remains optional.
export const VariflightFlightPriceCabinRawSchema = z
  .object({
    cabinclass: ObservedStringSchema.optional(),
    cabincode: ObservedStringSchema.optional(),
    classname: ObservedStringSchema.optional(),
    discount: ObservedNumberSchema.optional(),
    price: ObservedNumberSchema.optional(),
    seatnum: ObservedNumberSchema.optional(),
    stprice: ObservedNumberSchema.optional()
  })
  .strict()
  .refine((cabin) => Object.keys(cabin).length > 0, {
    message: 'VariFlight cabin must contain at least one observed field.'
  })

export const VariflightFlightPriceItemRawSchema = z
  .object({
    arraptccity: ObservedStringSchema.optional(),
    arraptcname: ObservedStringSchema.optional(),
    arrcitycode: ObservedStringSchema.optional(),
    arrdate: ObservedStringSchema.optional(),
    cabins: z.array(VariflightFlightPriceCabinRawSchema).optional(),
    depaptccity: ObservedStringSchema.optional(),
    depaptcname: ObservedStringSchema.optional(),
    depcitycode: ObservedStringSchema.optional(),
    depdate: ObservedStringSchema.optional(),
    distance: ObservedNumberSchema.optional(),
    flightarrcode: ObservedStringSchema.optional(),
    flightarrtimeplandate: ObservedNumberSchema.optional(),
    flightcompany: ObservedStringSchema.optional(),
    flightdepcode: ObservedStringSchema.optional(),
    flightdeptimeplandate: ObservedNumberSchema.optional(),
    flighthterminal: ObservedStringSchema.optional(),
    flightno: ObservedStringSchema.optional(),
    flightterminal: ObservedStringSchema.optional(),
    food: ObservedStringSchema.optional(),
    generic: ObservedStringSchema.optional(),
    oilfee: ObservedStringSchema.optional(),
    shareflag: ObservedNumberSchema.optional(),
    shareflightno: ObservedStringSchema.optional(),
    stopairportcode: ObservedStringSchema.optional(),
    stopairportname: ObservedStringSchema.optional(),
    stopcity: ObservedStringSchema.optional(),
    stopcityname: ObservedStringSchema.optional(),
    stopflag: ObservedNumberSchema.optional(),
    tax: ObservedStringSchema.optional()
  })
  .strict()
  .refine((flight) => Object.keys(flight).length > 0, {
    message: 'VariFlight flight must contain at least one observed field.'
  })

export const VariflightFlightPriceRawSchema = z
  .object({
    code: ObservedNumberSchema,
    data: z.array(VariflightFlightPriceItemRawSchema),
    message: ObservedStringSchema,
    request_id: ObservedStringSchema,
    timestamp: ObservedStringSchema
  })
  .strict()

const VariflightFlightPriceTextContentSchema = z
  .object({ type: z.literal('text'), text: z.string() })
  .strict()

// Phase C intentionally narrows the generic MCP envelope to one text block so
// no unvalidated secondary payload or structuredContent can cross this boundary.
export const VariflightFlightPriceToolResultSchema = z
  .object({
    content: z.array(VariflightFlightPriceTextContentSchema).length(1),
    isError: z.boolean().optional()
  })
  .strict()
  .superRefine((result, context) => {
    // Explicit MCP errors may carry provider-defined opaque text.
    if (result.isError) return
    try {
      VariflightFlightPriceRawSchema.parse(JSON.parse(firstMcpText(result)))
    } catch (error) {
      if (error instanceof z.ZodError) {
        for (const issue of error.issues) {
          context.addIssue({ ...issue, path: ['content', 0, 'text', ...issue.path] })
        }
      } else {
        context.addIssue({
          code: 'custom',
          path: ['content', 0, 'text'],
          message: 'Expected schema-valid VariFlight JSON text.'
        })
      }
    }
  })

const NullableStringSchema = z.string().nullable()
const NullableNumberSchema = z.number().finite().nullable()

export const VariflightFlightPriceCabinNormalizedSchema = z
  .object({
    cabinClassRaw: NullableStringSchema,
    cabinCodeRaw: NullableStringSchema,
    classNameRaw: NullableStringSchema,
    discountRaw: NullableNumberSchema,
    priceRaw: NullableNumberSchema,
    seatCountRaw: NullableNumberSchema,
    standardPriceRaw: NullableNumberSchema
  })
  .strict()

export const VariflightFlightPriceItemNormalizedSchema = z
  .object({
    flightNumberRaw: NullableStringSchema,
    flightCompanyRaw: NullableStringSchema,
    departureCityCodeRaw: NullableStringSchema,
    arrivalCityCodeRaw: NullableStringSchema,
    departureAirportCityRaw: NullableStringSchema,
    arrivalAirportCityRaw: NullableStringSchema,
    departureAirportNameRaw: NullableStringSchema,
    arrivalAirportNameRaw: NullableStringSchema,
    departureDateRaw: NullableStringSchema,
    arrivalDateRaw: NullableStringSchema,
    flightDepartureCodeRaw: NullableStringSchema,
    flightArrivalCodeRaw: NullableStringSchema,
    departurePlannedTimeRaw: NullableNumberSchema,
    arrivalPlannedTimeRaw: NullableNumberSchema,
    flightTerminalRaw: NullableStringSchema,
    flightHTerminalRaw: NullableStringSchema,
    distanceRaw: NullableNumberSchema,
    foodRaw: NullableStringSchema,
    genericRaw: NullableStringSchema,
    oilFeeRaw: NullableStringSchema,
    shareFlagRaw: NullableNumberSchema,
    sharedFlightNumberRaw: NullableStringSchema,
    stopFlagRaw: NullableNumberSchema,
    stopAirportCodeRaw: NullableStringSchema,
    stopAirportNameRaw: NullableStringSchema,
    stopCityRaw: NullableStringSchema,
    stopCityNameRaw: NullableStringSchema,
    taxRaw: NullableStringSchema,
    cabins: z.array(VariflightFlightPriceCabinNormalizedSchema).nullable(),
    startAt: z.null(),
    endAt: z.null(),
    durationMinutes: z.null(),
    costCents: z.null(),
    currency: z.null(),
    transferCount: z.null(),
    overnightArrival: z.null()
  })
  .strict()

export const VariflightFlightPriceNormalizedSchema = z
  .object({
    sourceId: z.literal('SRC_FLIGHT'),
    sourceTool: z.literal(VARIFLIGHT_FLIGHT_PRICE_TOOL_NAME),
    contractVersion: z.literal(VARIFLIGHT_FLIGHT_PRICE_RESULT_CONTRACT_VERSION),
    mappingStatus: z.literal('LOCAL_STRUCTURE_ONLY'),
    providerCodeRaw: ObservedNumberSchema,
    providerMessageRaw: ObservedStringSchema,
    providerRequestIdRaw: ObservedStringSchema,
    providerTimestampRaw: ObservedStringSchema,
    flights: z.array(VariflightFlightPriceItemNormalizedSchema)
  })
  .strict()

export function normalizeVariflightFlightPriceStructure(
  input: z.input<typeof VariflightFlightPriceRawSchema>
): VariflightFlightPriceNormalized {
  const raw = VariflightFlightPriceRawSchema.parse(input)
  return VariflightFlightPriceNormalizedSchema.parse({
    sourceId: 'SRC_FLIGHT',
    sourceTool: VARIFLIGHT_FLIGHT_PRICE_TOOL_NAME,
    contractVersion: VARIFLIGHT_FLIGHT_PRICE_RESULT_CONTRACT_VERSION,
    mappingStatus: 'LOCAL_STRUCTURE_ONLY',
    providerCodeRaw: raw.code,
    providerMessageRaw: raw.message,
    providerRequestIdRaw: raw.request_id,
    providerTimestampRaw: raw.timestamp,
    flights: raw.data.map((flight) => ({
      flightNumberRaw: flight.flightno ?? null,
      flightCompanyRaw: flight.flightcompany ?? null,
      departureCityCodeRaw: flight.depcitycode ?? null,
      arrivalCityCodeRaw: flight.arrcitycode ?? null,
      departureAirportCityRaw: flight.depaptccity ?? null,
      arrivalAirportCityRaw: flight.arraptccity ?? null,
      departureAirportNameRaw: flight.depaptcname ?? null,
      arrivalAirportNameRaw: flight.arraptcname ?? null,
      departureDateRaw: flight.depdate ?? null,
      arrivalDateRaw: flight.arrdate ?? null,
      flightDepartureCodeRaw: flight.flightdepcode ?? null,
      flightArrivalCodeRaw: flight.flightarrcode ?? null,
      departurePlannedTimeRaw: flight.flightdeptimeplandate ?? null,
      arrivalPlannedTimeRaw: flight.flightarrtimeplandate ?? null,
      flightTerminalRaw: flight.flightterminal ?? null,
      flightHTerminalRaw: flight.flighthterminal ?? null,
      distanceRaw: flight.distance ?? null,
      foodRaw: flight.food ?? null,
      genericRaw: flight.generic ?? null,
      oilFeeRaw: flight.oilfee ?? null,
      shareFlagRaw: flight.shareflag ?? null,
      sharedFlightNumberRaw: flight.shareflightno ?? null,
      stopFlagRaw: flight.stopflag ?? null,
      stopAirportCodeRaw: flight.stopairportcode ?? null,
      stopAirportNameRaw: flight.stopairportname ?? null,
      stopCityRaw: flight.stopcity ?? null,
      stopCityNameRaw: flight.stopcityname ?? null,
      taxRaw: flight.tax ?? null,
      cabins:
        flight.cabins?.map((cabin) => ({
          cabinClassRaw: cabin.cabinclass ?? null,
          cabinCodeRaw: cabin.cabincode ?? null,
          classNameRaw: cabin.classname ?? null,
          discountRaw: cabin.discount ?? null,
          priceRaw: cabin.price ?? null,
          seatCountRaw: cabin.seatnum ?? null,
          standardPriceRaw: cabin.stprice ?? null
        })) ?? null,
      startAt: null,
      endAt: null,
      durationMinutes: null,
      costCents: null,
      currency: null,
      transferCount: null,
      overnightArrival: null
    }))
  })
}

export type VariflightFlightPriceArgs = z.infer<typeof VariflightFlightPriceArgsSchema>
export type VariflightFlightPriceRaw = z.infer<typeof VariflightFlightPriceRawSchema>
export type VariflightFlightPriceToolResult = z.infer<typeof VariflightFlightPriceToolResultSchema>
export type VariflightFlightPriceNormalized = z.infer<typeof VariflightFlightPriceNormalizedSchema>
