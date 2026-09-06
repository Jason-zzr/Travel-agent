import { z } from 'zod'
import { AppError } from '../../shared/errors'
import type {
  VariflightFlightPriceArgs,
  VariflightFlightPriceRaw
} from '../../shared/schema/mcp/flight'

const MAX_FLIGHTS = 64
const MAX_CABINS_PER_FLIGHT = 64

export const VARIFLIGHT_SEMANTIC_CLASSIFIER_CONTRACT_VERSION =
  'variflight-value-semantics-classifier/v1'

const EvidenceStatusSchema = z.enum(['FORMAT_PROVEN', 'CONSISTENCY_PROVEN', 'UNPROVEN'])
const PathSchema = z.string().regex(/^\$\/[A-Za-z0-9_/*-]+$/)
const CountSchema = z.number().int().nonnegative()

const FormatCountsSchema = z
  .object({
    empty: CountSchema,
    date: CountSchema,
    dateTime: CountSchema,
    iata: CountSchema,
    flightNumber: CountSchema,
    numeric: CountSchema,
    other: CountSchema
  })
  .strict()

const StringFieldSummarySchema = z
  .object({
    path: PathSchema,
    presentCount: CountSchema,
    missingCount: CountSchema,
    formats: FormatCountsSchema
  })
  .strict()

const NumericFieldSummarySchema = z
  .object({
    path: PathSchema,
    presentCount: CountSchema,
    missingCount: CountSchema,
    finiteCount: CountSchema,
    integerCount: CountSchema,
    nonNegativeCount: CountSchema
  })
  .strict()

const RequestBindingFieldSchema = z
  .object({
    path: PathSchema,
    presentCount: CountSchema,
    missingCount: CountSchema,
    formatInvalidCount: CountSchema,
    mismatchCount: CountSchema,
    allMatchApprovedInput: z.boolean().nullable(),
    status: EvidenceStatusSchema
  })
  .strict()

const DateFieldSemanticsSchema = z
  .object({
    path: PathSchema,
    presentCount: CountSchema,
    missingCount: CountSchema,
    validDateCount: CountSchema,
    invalidDateCount: CountSchema,
    status: EvidenceStatusSchema
  })
  .strict()

const TimeFieldSemanticsSchema = z
  .object({
    path: PathSchema,
    presentCount: CountSchema,
    integerCount: CountSchema,
    nonNegativeCount: CountSchema,
    unit: z.literal('UNKNOWN'),
    timezone: z.literal('UNKNOWN'),
    status: z.literal('UNPROVEN')
  })
  .strict()

export const VariflightSemanticSummarySchema = z
  .object({
    schemaVersion: z.literal('variflight-value-semantics-summary/v1'),
    contractStatus: z.literal('UNPROVEN'),
    classificationStatus: z.literal('FORMAT_AND_CONSISTENCY_ONLY'),
    flightCount: CountSchema,
    cabinCount: CountSchema,
    requestBinding: z
      .object({
        departureCity: RequestBindingFieldSchema,
        arrivalCity: RequestBindingFieldSchema,
        departureDate: RequestBindingFieldSchema
      })
      .strict(),
    stringFormats: z.array(StringFieldSummarySchema).max(32),
    numericSemantics: z.array(NumericFieldSummarySchema).max(16),
    dateSemantics: z
      .object({
        departure: DateFieldSemanticsSchema,
        arrival: DateFieldSemanticsSchema,
        comparableCount: CountSchema,
        arrivalOnOrAfterDepartureCount: CountSchema,
        relationshipStatus: EvidenceStatusSchema
      })
      .strict(),
    timeSemantics: z
      .object({
        departure: TimeFieldSemanticsSchema,
        arrival: TimeFieldSemanticsSchema
      })
      .strict(),
    priceSemantics: z
      .object({
        amountFields: z.array(NumericFieldSummarySchema).length(2),
        feeFields: z.array(StringFieldSummarySchema).length(2),
        explicitCurrencyMetadataPresent: z.literal(false),
        explicitUnitMetadataPresent: z.literal(false),
        startingPriceMeaning: z.literal('UNPROVEN'),
        inventoryMeaning: z.literal('UNPROVEN'),
        status: z.literal('UNPROVEN')
      })
      .strict(),
    cabinStructure: z
      .object({
        flightsWithCabinsField: CountSchema,
        flightsWithoutCabinsField: CountSchema,
        flightsWithEmptyCabins: CountSchema,
        cabinCount: CountSchema,
        status: z.enum(['STRUCTURE_OBSERVED', 'UNPROVEN'])
      })
      .strict(),
    stopShareSemantics: z
      .object({
        flagFields: z.array(NumericFieldSummarySchema).length(2),
        explicitEnumDefinitionPresent: z.literal(false),
        status: z.literal('UNPROVEN')
      })
      .strict(),
    topLevelStatus: z
      .object({
        path: z.literal('$/code'),
        mapping: z.literal('UNKNOWN'),
        status: z.literal('UNPROVEN')
      })
      .strict(),
    conflicts: z
      .object({
        requestBinding: CountSchema,
        dateFormat: CountSchema,
        duplicateFlights: CountSchema
      })
      .strict(),
    rawResponseRetained: z.literal(false),
    valueRetention: z.literal(false)
  })
  .strict()

export type VariflightSemanticSummary = z.infer<typeof VariflightSemanticSummarySchema>

const FLIGHT_STRING_KEYS = [
  'arraptccity',
  'arraptcname',
  'arrcitycode',
  'arrdate',
  'depaptccity',
  'depaptcname',
  'depcitycode',
  'depdate',
  'flightarrcode',
  'flightcompany',
  'flightdepcode',
  'flighthterminal',
  'flightno',
  'flightterminal',
  'food',
  'generic',
  'oilfee',
  'shareflightno',
  'stopairportcode',
  'stopairportname',
  'stopcity',
  'stopcityname',
  'tax'
] as const

const FLIGHT_NUMBER_KEYS = [
  'distance',
  'flightarrtimeplandate',
  'flightdeptimeplandate',
  'shareflag',
  'stopflag'
] as const

const CABIN_STRING_KEYS = ['cabinclass', 'cabincode', 'classname'] as const
const CABIN_NUMBER_KEYS = ['discount', 'price', 'seatnum', 'stprice'] as const
const DateSchema = z.string().date()

export function classifyVariflightSemantics(
  raw: VariflightFlightPriceRaw,
  args: VariflightFlightPriceArgs
): VariflightSemanticSummary {
  assertBounds(raw)
  const flights = raw.data
  const cabins = flights.flatMap((flight) => flight.cabins ?? [])
  const flightCount = flights.length
  const cabinCount = cabins.length

  const stringFormats = [
    summarizeStrings('$/message', [raw.message], 1),
    summarizeStrings('$/request_id', [raw.request_id], 1),
    summarizeStrings('$/timestamp', [raw.timestamp], 1),
    ...FLIGHT_STRING_KEYS.map((key) =>
      summarizeStrings(
        `$/data/*/${key}`,
        flights.flatMap((flight) => (flight[key] === undefined ? [] : [flight[key]])),
        flightCount
      )
    ),
    ...CABIN_STRING_KEYS.map((key) =>
      summarizeStrings(
        `$/data/*/cabins/*/${key}`,
        cabins.flatMap((cabin) => (cabin[key] === undefined ? [] : [cabin[key]])),
        cabinCount
      )
    )
  ]

  const numericSemantics = [
    summarizeNumbers('$/code', [raw.code], 1),
    ...FLIGHT_NUMBER_KEYS.map((key) =>
      summarizeNumbers(
        `$/data/*/${key}`,
        flights.flatMap((flight) => (flight[key] === undefined ? [] : [flight[key]])),
        flightCount
      )
    ),
    ...CABIN_NUMBER_KEYS.map((key) =>
      summarizeNumbers(
        `$/data/*/cabins/*/${key}`,
        cabins.flatMap((cabin) => (cabin[key] === undefined ? [] : [cabin[key]])),
        cabinCount
      )
    )
  ]

  const departureCity = summarizeBinding(
    '$/data/*/depcitycode',
    flights.flatMap((flight) => (flight.depcitycode === undefined ? [] : [flight.depcitycode])),
    flightCount,
    args.dep_city,
    isIata
  )
  const arrivalCity = summarizeBinding(
    '$/data/*/arrcitycode',
    flights.flatMap((flight) => (flight.arrcitycode === undefined ? [] : [flight.arrcitycode])),
    flightCount,
    args.arr_city,
    isIata
  )
  const departureDate = summarizeBinding(
    '$/data/*/depdate',
    flights.flatMap((flight) => (flight.depdate === undefined ? [] : [flight.depdate])),
    flightCount,
    args.dep_date,
    isDate
  )

  const departureDates = flights.flatMap((flight) =>
    flight.depdate === undefined ? [] : [flight.depdate]
  )
  const arrivalDates = flights.flatMap((flight) =>
    flight.arrdate === undefined ? [] : [flight.arrdate]
  )
  const departureDateSemantics = summarizeDates('$/data/*/depdate', departureDates, flightCount)
  const arrivalDateSemantics = summarizeDates('$/data/*/arrdate', arrivalDates, flightCount)
  let comparableCount = 0
  let arrivalOnOrAfterDepartureCount = 0
  for (const flight of flights) {
    if (!flight.depdate || !flight.arrdate || !isDate(flight.depdate) || !isDate(flight.arrdate)) {
      continue
    }
    comparableCount += 1
    if (flight.arrdate >= flight.depdate) arrivalOnOrAfterDepartureCount += 1
  }

  const departureTime = findNumeric(numericSemantics, '$/data/*/flightdeptimeplandate')
  const arrivalTime = findNumeric(numericSemantics, '$/data/*/flightarrtimeplandate')
  const price = findNumeric(numericSemantics, '$/data/*/cabins/*/price')
  const standardPrice = findNumeric(numericSemantics, '$/data/*/cabins/*/stprice')
  const oilFee = findString(stringFormats, '$/data/*/oilfee')
  const tax = findString(stringFormats, '$/data/*/tax')
  const stopFlag = findNumeric(numericSemantics, '$/data/*/stopflag')
  const shareFlag = findNumeric(numericSemantics, '$/data/*/shareflag')
  const flightsWithCabinsField = flights.filter((flight) => flight.cabins !== undefined).length
  const flightsWithEmptyCabins = flights.filter((flight) => flight.cabins?.length === 0).length

  return VariflightSemanticSummarySchema.parse({
    schemaVersion: 'variflight-value-semantics-summary/v1',
    contractStatus: 'UNPROVEN',
    classificationStatus: 'FORMAT_AND_CONSISTENCY_ONLY',
    flightCount,
    cabinCount,
    requestBinding: { departureCity, arrivalCity, departureDate },
    stringFormats,
    numericSemantics,
    dateSemantics: {
      departure: departureDateSemantics,
      arrival: arrivalDateSemantics,
      comparableCount,
      arrivalOnOrAfterDepartureCount,
      relationshipStatus:
        flightCount > 0 &&
        comparableCount === flightCount &&
        arrivalOnOrAfterDepartureCount === comparableCount
          ? 'CONSISTENCY_PROVEN'
          : 'UNPROVEN'
    },
    timeSemantics: {
      departure: unknownTimeSemantics(departureTime),
      arrival: unknownTimeSemantics(arrivalTime)
    },
    priceSemantics: {
      amountFields: [price, standardPrice],
      feeFields: [oilFee, tax],
      explicitCurrencyMetadataPresent: false,
      explicitUnitMetadataPresent: false,
      startingPriceMeaning: 'UNPROVEN',
      inventoryMeaning: 'UNPROVEN',
      status: 'UNPROVEN'
    },
    cabinStructure: {
      flightsWithCabinsField,
      flightsWithoutCabinsField: flightCount - flightsWithCabinsField,
      flightsWithEmptyCabins,
      cabinCount,
      status: flightsWithCabinsField > 0 ? 'STRUCTURE_OBSERVED' : 'UNPROVEN'
    },
    stopShareSemantics: {
      flagFields: [stopFlag, shareFlag],
      explicitEnumDefinitionPresent: false,
      status: 'UNPROVEN'
    },
    topLevelStatus: { path: '$/code', mapping: 'UNKNOWN', status: 'UNPROVEN' },
    conflicts: {
      requestBinding:
        departureCity.mismatchCount + arrivalCity.mismatchCount + departureDate.mismatchCount,
      dateFormat: departureDateSemantics.invalidDateCount + arrivalDateSemantics.invalidDateCount,
      duplicateFlights: duplicateCount(flights)
    },
    rawResponseRetained: false,
    valueRetention: false
  })
}

function assertBounds(raw: VariflightFlightPriceRaw): void {
  if (raw.data.length > MAX_FLIGHTS) {
    throw new AppError('SOURCE_DRIFT', 'VariFlight semantic sample exceeds flight limit.')
  }
  if (raw.data.some((flight) => (flight.cabins?.length ?? 0) > MAX_CABINS_PER_FLIGHT)) {
    throw new AppError('SOURCE_DRIFT', 'VariFlight semantic sample exceeds cabin limit.')
  }
}

function summarizeStrings(
  path: string,
  values: string[],
  parentCount: number
): z.infer<typeof StringFieldSummarySchema> {
  const formats = { empty: 0, date: 0, dateTime: 0, iata: 0, flightNumber: 0, numeric: 0, other: 0 }
  for (const value of values) formats[classifyString(value)] += 1
  return StringFieldSummarySchema.parse({
    path,
    presentCount: values.length,
    missingCount: Math.max(0, parentCount - values.length),
    formats
  })
}

function summarizeNumbers(
  path: string,
  values: number[],
  parentCount: number
): z.infer<typeof NumericFieldSummarySchema> {
  return NumericFieldSummarySchema.parse({
    path,
    presentCount: values.length,
    missingCount: Math.max(0, parentCount - values.length),
    finiteCount: values.filter(Number.isFinite).length,
    integerCount: values.filter(Number.isInteger).length,
    nonNegativeCount: values.filter((value) => value >= 0).length
  })
}

function summarizeBinding(
  path: string,
  values: string[],
  parentCount: number,
  approvedValue: string,
  validateFormat: (value: string) => boolean
): z.infer<typeof RequestBindingFieldSchema> {
  const formatInvalidCount = values.filter((value) => !validateFormat(value)).length
  const mismatchCount = values.filter((value) => value !== approvedValue).length
  const allMatchApprovedInput = values.length === 0 ? null : mismatchCount === 0
  return RequestBindingFieldSchema.parse({
    path,
    presentCount: values.length,
    missingCount: Math.max(0, parentCount - values.length),
    formatInvalidCount,
    mismatchCount,
    allMatchApprovedInput,
    status:
      parentCount > 0 &&
      values.length === parentCount &&
      formatInvalidCount === 0 &&
      mismatchCount === 0
        ? 'CONSISTENCY_PROVEN'
        : 'UNPROVEN'
  })
}

function summarizeDates(
  path: string,
  values: string[],
  parentCount: number
): z.infer<typeof DateFieldSemanticsSchema> {
  const validDateCount = values.filter(isDate).length
  const invalidDateCount = values.length - validDateCount
  return DateFieldSemanticsSchema.parse({
    path,
    presentCount: values.length,
    missingCount: Math.max(0, parentCount - values.length),
    validDateCount,
    invalidDateCount,
    status:
      parentCount > 0 && values.length === parentCount && invalidDateCount === 0
        ? 'FORMAT_PROVEN'
        : 'UNPROVEN'
  })
}

function unknownTimeSemantics(
  field: z.infer<typeof NumericFieldSummarySchema>
): z.infer<typeof TimeFieldSemanticsSchema> {
  return TimeFieldSemanticsSchema.parse({
    path: field.path,
    presentCount: field.presentCount,
    integerCount: field.integerCount,
    nonNegativeCount: field.nonNegativeCount,
    unit: 'UNKNOWN',
    timezone: 'UNKNOWN',
    status: 'UNPROVEN'
  })
}

function findString(
  values: z.infer<typeof StringFieldSummarySchema>[],
  path: string
): z.infer<typeof StringFieldSummarySchema> {
  const match = values.find((value) => value.path === path)
  if (!match) throw new AppError('INTERNAL_INVARIANT_VIOLATED', 'Semantic string path missing.')
  return match
}

function findNumeric(
  values: z.infer<typeof NumericFieldSummarySchema>[],
  path: string
): z.infer<typeof NumericFieldSummarySchema> {
  const match = values.find((value) => value.path === path)
  if (!match) throw new AppError('INTERNAL_INVARIANT_VIOLATED', 'Semantic numeric path missing.')
  return match
}

function classifyString(value: string): keyof z.infer<typeof FormatCountsSchema> {
  if (value.length === 0) return 'empty'
  if (isDate(value)) return 'date'
  if (!Number.isNaN(Date.parse(value)) && /T/.test(value)) return 'dateTime'
  if (isIata(value)) return 'iata'
  if (/^[A-Z0-9]{2,3}\d{3,4}$/.test(value)) return 'flightNumber'
  if (/^[+-]?\d+(?:\.\d+)?$/.test(value)) return 'numeric'
  return 'other'
}

function isIata(value: string): boolean {
  return /^[A-Z]{3}$/.test(value)
}

function isDate(value: string): boolean {
  return DateSchema.safeParse(value).success
}

function duplicateCount(values: VariflightFlightPriceRaw['data']): number {
  const seen = new Set<string>()
  let duplicates = 0
  for (const value of values) {
    const key = JSON.stringify(canonicalize(value))
    if (seen.has(key)) duplicates += 1
    else seen.add(key)
  }
  return duplicates
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)])
  )
}
