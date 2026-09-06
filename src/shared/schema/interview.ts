import { z } from 'zod'

export const AgeBandSchema = z.enum(['CHILD', 'ADULT', 'OLDER_ADULT'])
export const StaminaSchema = z.enum(['LOW', 'MEDIUM', 'HIGH'])
export const TravelIntensitySchema = z.enum(['RELAXED', 'BALANCED', 'INTENSIVE'])

export const TravelerGroupSchema = z.object({
  count: z.number().int().min(1).max(20),
  ageBand: AgeBandSchema,
  relationship: z.string().trim().min(1).max(40),
  stamina: StaminaSchema,
  careNeeds: z.array(z.string().trim().min(1).max(80)).max(10).default([]),
  functionalLimits: z.array(z.string().trim().min(1).max(80)).max(10).default([])
})
export type TravelerGroup = z.infer<typeof TravelerGroupSchema>

export const FixedDateIntentSchema = z.object({
  kind: z.literal('FIXED'),
  startDate: z.string().date(),
  endDate: z.string().date()
})

export const FlexibleDateIntentSchema = z.object({
  kind: z.literal('FLEXIBLE'),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  durationDays: z.number().int().min(1).max(31)
})

export const DateIntentSchema = z
  .discriminatedUnion('kind', [FixedDateIntentSchema, FlexibleDateIntentSchema])
  .superRefine((value, context) => {
    if (value.kind === 'FIXED' && value.endDate < value.startDate) {
      context.addIssue({
        code: 'custom',
        message: 'endDate must not precede startDate',
        path: ['endDate']
      })
    }
  })
export type DateIntent = z.infer<typeof DateIntentSchema>

export const BudgetIntentSchema = z.object({
  currency: z.enum(['CNY', 'USD']),
  basis: z.enum(['TOTAL', 'PER_PERSON']),
  targetMinor: z.number().int().positive(),
  flexibleRangeMinor: z
    .object({ min: z.number().int().nonnegative(), max: z.number().int().positive() })
    .refine((value) => value.max >= value.min, { path: ['max'], message: 'max must be >= min' })
    .nullable()
    .default(null),
  hardCapMinor: z.number().int().positive().nullable().default(null),
  inclusions: z.array(z.enum(['TRANSPORT', 'ACCOMMODATION', 'MEALS', 'SHOPPING'])).default([])
})
export type BudgetIntent = z.infer<typeof BudgetIntentSchema>

export const DestinationIntentSchema = z.object({
  climate: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
  themes: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  avoid: z.array(z.string().trim().min(1).max(80)).max(12).default([])
})
export type DestinationIntent = z.infer<typeof DestinationIntentSchema>

export const TravelPreferencesSchema = z.object({
  hardConstraints: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  softPreferences: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  negotiableVariables: z.array(z.string().trim().min(1).max(100)).max(20).default([])
})
export type TravelPreferences = z.infer<typeof TravelPreferencesSchema>

export const MandatoryPlaceIntentSchema = z
  .object({
    placeId: z.string().trim().min(1).max(120),
    displayName: z.string().trim().min(1).max(120),
    nodeCity: z.string().trim().min(1).max(80)
  })
  .strict()
export type MandatoryPlaceIntent = z.infer<typeof MandatoryPlaceIntentSchema>

export const MultiCityItineraryIntentSchema = z
  .object({
    kind: z.literal('MULTI_CITY_ROUTE'),
    regionGoal: z.string().trim().min(1).max(120),
    mandatoryPlaces: z.array(MandatoryPlaceIntentSchema).min(2).max(12)
  })
  .strict()
  .superRefine((value, context) => {
    const placeIds = new Set(value.mandatoryPlaces.map((place) => place.placeId))
    if (placeIds.size !== value.mandatoryPlaces.length) {
      context.addIssue({
        code: 'custom',
        path: ['mandatoryPlaces'],
        message: 'mandatory place IDs must be unique'
      })
    }
    const nodeCities = new Set(value.mandatoryPlaces.map((place) => normalizeCity(place.nodeCity)))
    if (nodeCities.size < 2 || nodeCities.size > 6) {
      context.addIssue({
        code: 'custom',
        path: ['mandatoryPlaces'],
        message: 'multi-city route requires two to six distinct node cities'
      })
    }
  })
export type MultiCityItineraryIntent = z.infer<typeof MultiCityItineraryIntentSchema>

const TravelBasicsObjectSchema = z.object({
  originCities: z.array(z.string().trim().min(1).max(80)).min(1).max(6),
  originGatewayCity: z.string().trim().min(1).max(80).nullable().optional(),
  originPlaceLabel: z.string().trim().min(1).max(160).nullable().optional(),
  destinationCities: z.array(z.string().trim().min(1).max(80)).max(6),
  destinationIntent: DestinationIntentSchema.nullable().default(null),
  travelers: z.array(TravelerGroupSchema).min(1).max(10),
  dates: DateIntentSchema,
  budget: BudgetIntentSchema,
  intensity: TravelIntensitySchema,
  preferences: TravelPreferencesSchema,
  staySegments: z.number().int().min(1).max(8),
  itineraryIntent: MultiCityItineraryIntentSchema.nullable().optional()
})

export const TravelBasicsSchema = TravelBasicsObjectSchema.superRefine((value, context) => {
  if (
    value.destinationCities.length === 0 &&
    value.destinationIntent === null &&
    value.itineraryIntent == null
  ) {
    context.addIssue({
      code: 'custom',
      message: 'destination city or destination intent is required',
      path: ['destinationCities']
    })
  }
  if (value.itineraryIntent == null) return
  const destinationCities = new Set(value.destinationCities.map(normalizeCity))
  const mandatoryCities = new Set(
    value.itineraryIntent.mandatoryPlaces.map((place) => normalizeCity(place.nodeCity))
  )
  if (
    destinationCities.size !== value.destinationCities.length ||
    destinationCities.size !== mandatoryCities.size ||
    [...mandatoryCities].some((city) => !destinationCities.has(city))
  ) {
    context.addIssue({
      code: 'custom',
      message: 'multi-city destinations must exactly match mandatory node cities',
      path: ['destinationCities']
    })
  }
})
export type TravelBasics = z.infer<typeof TravelBasicsSchema>

export const TravelBasicsPatchSchema = TravelBasicsObjectSchema.partial()
export type TravelBasicsPatch = z.infer<typeof TravelBasicsPatchSchema>

export const InterviewReadinessSchema = z.enum(['INCOMPLETE', 'READY', 'BLOCKED'])
export type InterviewReadiness = z.infer<typeof InterviewReadinessSchema>

export const InterviewTurnResultSchema = z
  .object({
    patch: TravelBasicsPatchSchema,
    readiness: InterviewReadinessSchema,
    nextQuestion: z.string().trim().min(1).max(300).nullable(),
    blockingReason: z.string().trim().min(1).max(300).nullable().default(null)
  })
  .superRefine((value, context) => {
    if (value.readiness === 'INCOMPLETE' && value.nextQuestion === null) {
      context.addIssue({ code: 'custom', message: 'incomplete result requires nextQuestion' })
    }
    if (value.readiness !== 'INCOMPLETE' && value.nextQuestion !== null) {
      context.addIssue({
        code: 'custom',
        message: 'ready or blocked result cannot ask nextQuestion'
      })
    }
  })
export type InterviewTurnResult = z.infer<typeof InterviewTurnResultSchema>

function normalizeCity(value: string): string {
  return value.normalize('NFKC').trim()
}

export const PeakCalendarStatusSchema = z.enum(['NORMAL', 'PEAK', 'UNKNOWN'])
export const ConfirmationCardSchema = z.object({
  basics: TravelBasicsSchema,
  peakCalendarStatus: PeakCalendarStatusSchema,
  peakCalendarVersion: z.string().min(1),
  requiresPeakConfirmation: z.boolean()
})
export type ConfirmationCard = z.infer<typeof ConfirmationCardSchema>
