import { z } from 'zod'
import { ContentIdentitySchema, VerificationStatusSchema } from './evidence'
import { HotelLodgingSourceRequestSchema } from './mcp/hotel'
import { MapGroundTransferSourceRequestSchema } from './mcp/map'
import { RailJourneySourceRequestSchema } from './mcp/rail'
import { ExternalSourceIdSchema } from './source'

export const D5DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const LocalTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const D5OperationIdSchema = z.string().uuid()
const D5EphemeralIdSchema = z.string().uuid()
const D5DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/)

export const TransportModeSchema = z.enum(['RAIL', 'MANUAL_FLIGHT'])
export type TransportMode = z.infer<typeof TransportModeSchema>

export const TransportLegKindSchema = z.enum(['FIRST_MILE', 'WAIT', 'INTERCITY', 'LAST_MILE'])
export type TransportLegKind = z.infer<typeof TransportLegKindSchema>

export const TransportLegSchema = z.object({
  kind: TransportLegKindSchema,
  label: z.string().trim().min(1).max(120),
  from: z.string().trim().min(1).max(200),
  to: z.string().trim().min(1).max(200),
  startAt: z.string().datetime({ offset: true }).nullable(),
  endAt: z.string().datetime({ offset: true }).nullable(),
  durationMinutes: z.number().int().nonnegative(),
  costCents: z.number().int().nonnegative().nullable(),
  sourceId: ExternalSourceIdSchema.nullable(),
  claimIds: z.array(z.string().min(1)).max(20).default([]),
  verificationStatus: VerificationStatusSchema
})
export type TransportLeg = z.infer<typeof TransportLegSchema>

const TransportLegTupleSchema = z.tuple([
  TransportLegSchema,
  TransportLegSchema,
  TransportLegSchema,
  TransportLegSchema
])

export const TransportDirectionSchema = z
  .object({
    direction: z.enum(['OUTBOUND', 'RETURN']),
    legs: TransportLegTupleSchema,
    totalDurationMinutes: z.number().int().nonnegative(),
    totalCostCents: z.number().int().nonnegative().nullable()
  })
  .superRefine((value, context) => {
    const expectedKinds = ['FIRST_MILE', 'WAIT', 'INTERCITY', 'LAST_MILE'] as const
    value.legs.forEach((leg, index) => {
      if (leg.kind !== expectedKinds[index]) {
        context.addIssue({
          code: 'custom',
          path: ['legs', index, 'kind'],
          message: `expected ${expectedKinds[index]}`
        })
      }
    })
    const total = value.legs.reduce((sum, leg) => sum + leg.durationMinutes, 0)
    if (total !== value.totalDurationMinutes) {
      context.addIssue({
        code: 'custom',
        path: ['totalDurationMinutes'],
        message: 'direction total must equal the sum of all legs'
      })
    }
  })
export type TransportDirection = z.infer<typeof TransportDirectionSchema>

export const TransportComfortSchema = z.enum(['GOOD', 'FAIR', 'RISK', 'UNKNOWN'])

export const TransportCandidateSchema = z
  .object({
    candidateId: z.string().min(1),
    title: z.string().trim().min(1).max(200),
    mode: TransportModeSchema,
    outbound: TransportDirectionSchema,
    return: TransportDirectionSchema,
    doorToDoorTotalMinutes: z.number().int().nonnegative(),
    totalCostCents: z.number().int().nonnegative().nullable(),
    costComplete: z.boolean(),
    arrivalUsableMinutes: z.number().int().nonnegative(),
    departureUsableMinutes: z.number().int().nonnegative(),
    comfort: TransportComfortSchema,
    comfortReasons: z.array(z.string().trim().min(1).max(300)).max(8).default([]),
    isRecommended: z.boolean(),
    materialDifferences: z.array(z.string().trim().min(1).max(300)).max(6).default([]),
    claimIds: z.array(z.string().min(1)).min(1).max(80)
  })
  .superRefine((value, context) => {
    if (value.outbound.direction !== 'OUTBOUND' || value.return.direction !== 'RETURN') {
      context.addIssue({ code: 'custom', message: 'transport directions are reversed' })
    }
    const total = value.outbound.totalDurationMinutes + value.return.totalDurationMinutes
    if (total !== value.doorToDoorTotalMinutes) {
      context.addIssue({
        code: 'custom',
        path: ['doorToDoorTotalMinutes'],
        message: 'round-trip total must equal outbound plus return totals'
      })
    }
    if (!value.costComplete && value.totalCostCents !== null) {
      context.addIssue({
        code: 'custom',
        path: ['totalCostCents'],
        message: 'incomplete costs must remain unknown'
      })
    }
  })
export type TransportCandidate = z.infer<typeof TransportCandidateSchema>

export const BoundaryAnchorSchema = z.object({
  kind: z.enum(['ARRIVAL', 'DEPARTURE']),
  date: D5DateSchema,
  time: LocalTimeSchema,
  at: z.string().datetime({ offset: true }),
  location: z.string().trim().min(1).max(200),
  usableMinutes: z.number().int().nonnegative(),
  anchorClass: z.literal('HARD_LOCKED'),
  claimIds: z.array(z.string().min(1)).min(1).max(20)
})
export type BoundaryAnchor = z.infer<typeof BoundaryAnchorSchema>

export const SkeletonCoordinateSchema = z.object({
  lng: z.number().finite().min(-180).max(180),
  lat: z.number().finite().min(-90).max(90)
})

export const SkeletonItemSchema = z.object({
  entityId: z.string().min(1),
  title: z.string().trim().min(1).max(300),
  coordinates: SkeletonCoordinateSchema,
  claimIds: z.array(z.string().min(1)).min(1).max(40)
})
export type SkeletonItem = z.infer<typeof SkeletonItemSchema>

export const SkeletonSlotSchema = z.object({
  kind: z.enum(['PROJECTS', 'TRANSFER', 'CHECK_IN', 'CHECK_OUT', 'EMPTY']),
  area: z.string().trim().min(1).max(200),
  items: z.array(SkeletonItemSchema).max(4).default([]),
  note: z.string().trim().min(1).max(400).nullable().default(null)
})
export type SkeletonSlot = z.infer<typeof SkeletonSlotSchema>

export const MealAnchorSchema = z.object({
  period: z.enum(['LUNCH', 'DINNER']),
  area: z.string().trim().min(1).max(200),
  routeReason: z.string().trim().min(1).max(300)
})

export const LocalTransportTendencySchema = z.object({
  strategy: z.enum(['WALK_TRANSIT', 'TAXI']),
  budgetImpact: z.string().trim().min(1).max(300),
  staminaImpact: z.string().trim().min(1).max(300)
})

export const DaySkeletonSchema = z.object({
  date: D5DateSchema,
  dayType: z.enum(['ARRIVAL_DAY', 'NORMAL_DAY', 'DEPARTURE_DAY']),
  intensity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  morning: SkeletonSlotSchema.nullable(),
  afternoon: SkeletonSlotSchema.nullable(),
  evening: SkeletonSlotSchema.nullable(),
  mealAnchors: z.array(MealAnchorSchema).max(2).default([]),
  localTransport: LocalTransportTendencySchema
})
export type DaySkeleton = z.infer<typeof DaySkeletonSchema>

export const StaySegmentSchema = z
  .object({
    segmentId: z.string().min(1),
    areaHint: z.string().trim().min(1).max(200),
    checkInDate: D5DateSchema,
    checkOutDate: D5DateSchema,
    nights: z.number().int().positive(),
    nightDates: z.array(D5DateSchema).min(1).max(28),
    positionAssessment: z.object({
      status: z.enum(['VERIFIED', 'ESTIMATED', 'UNKNOWN']),
      summary: z.string().trim().min(1).max(500),
      claimIds: z.array(z.string().min(1)).max(80).default([])
    })
  })
  .superRefine((value, context) => {
    if (value.nightDates.length !== value.nights) {
      context.addIssue({
        code: 'custom',
        path: ['nightDates'],
        message: 'nightDates must match nights'
      })
    }
  })
export type StaySegment = z.infer<typeof StaySegmentSchema>

export const CancellationPolicySchema = z.object({
  status: z.enum(['FREE_UNTIL', 'NON_REFUNDABLE', 'UNKNOWN']),
  freeCancelUntil: z.string().datetime().nullable()
})

export const StayCandidateSchema = z
  .object({
    candidateId: z.string().min(1),
    segmentId: z.string().min(1),
    sourceId: z.enum(['SRC_HOTEL', 'SRC_SEARCH', 'USER_PASTE']),
    name: z.string().trim().min(1).max(300),
    claimId: z.string().min(1),
    contentIdentity: ContentIdentitySchema,
    verificationStatus: VerificationStatusSchema,
    totalCostCents: z.number().int().nonnegative().nullable(),
    totalCostComplete: z.boolean(),
    roomType: z.string().trim().min(1).max(200).nullable(),
    bedType: z.string().trim().min(1).max(200).nullable(),
    capacity: z.number().int().positive().nullable(),
    roomFitsParty: z.boolean().nullable(),
    cancellation: CancellationPolicySchema,
    positionAdvantage: z.string().trim().min(1).max(400),
    recommendationEligible: z.boolean()
  })
  .superRefine((value, context) => {
    if (!value.totalCostComplete && value.totalCostCents !== null) {
      context.addIssue({
        code: 'custom',
        path: ['totalCostCents'],
        message: 'incomplete full-stay cost must remain unknown'
      })
    }
    if (value.cancellation.status === 'FREE_UNTIL' && !value.cancellation.freeCancelUntil) {
      context.addIssue({
        code: 'custom',
        path: ['cancellation', 'freeCancelUntil'],
        message: 'free cancellation requires a deadline'
      })
    }
    if (value.cancellation.status !== 'FREE_UNTIL' && value.cancellation.freeCancelUntil) {
      context.addIssue({
        code: 'custom',
        path: ['cancellation', 'freeCancelUntil'],
        message: 'only free cancellation has a deadline'
      })
    }
    if (value.roomFitsParty !== true && value.recommendationEligible) {
      context.addIssue({
        code: 'custom',
        path: ['recommendationEligible'],
        message: 'unknown or insufficient occupancy cannot be recommended'
      })
    }
  })
export type StayCandidate = z.infer<typeof StayCandidateSchema>

export const D5SourceOutcomeSchema = z.object({
  sourceId: z.enum(['SRC_HOTEL', 'SRC_SEARCH', 'USER_PASTE']),
  status: z.enum(['SUCCEEDED', 'EMPTY', 'FAILED', 'CANCELLED']),
  candidateCount: z.number().int().nonnegative(),
  errorCode: z.string().min(1).nullable(),
  capabilityImpact: z.string().min(1).nullable(),
  manualAlternative: z.string().min(1).nullable()
})
export type D5SourceOutcome = z.infer<typeof D5SourceOutcomeSchema>

export const D5SnapshotSchema = z.object({
  sessionId: z.string().min(1),
  stage: z.enum(['STAGE_1', 'STAGE_2', 'STAGE_3', 'STAGE_4', 'STAGE_5', 'DONE']),
  partySize: z.number().int().nonnegative(),
  transportCandidates: z.array(TransportCandidateSchema).max(3),
  selectedTransportCandidateId: z.string().min(1).nullable(),
  boundaryAnchors: z.array(BoundaryAnchorSchema).max(2),
  daySkeletons: z.array(DaySkeletonSchema).max(31),
  staySegment: StaySegmentSchema.nullable(),
  stayCandidates: z.array(StayCandidateSchema).max(20),
  selectedStayCandidateId: z.string().min(1).nullable(),
  staySourceOutcomes: z.array(D5SourceOutcomeSchema).max(3)
})
export type D5Snapshot = z.infer<typeof D5SnapshotSchema>

export const D5SnapshotRequestSchema = z.object({ sessionId: z.string().min(1) }).strict()

export const RailDiscoveryLegSchema = z
  .object({
    direction: z.enum(['OUTBOUND', 'RETURN']),
    date: D5DateSchema,
    fromStation: z.string().trim().min(1).max(120),
    toStation: z.string().trim().min(1).max(120)
  })
  .strict()

export const RailDiscoveryPreviewSchema = z
  .object({
    sessionId: z.string().min(1),
    outbound: RailDiscoveryLegSchema,
    return: RailDiscoveryLegSchema,
    estimatedExternalCalls: z.literal(2),
    digest: D5DigestSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (value.outbound.direction !== 'OUTBOUND' || value.return.direction !== 'RETURN') {
      context.addIssue({ code: 'custom', message: 'rail discovery directions are reversed' })
    }
  })

export const RailDiscoveryRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    operationId: D5OperationIdSchema,
    digest: D5DigestSchema
  })
  .strict()

export const RailOptionSchema = z
  .object({
    direction: z.enum(['OUTBOUND', 'RETURN']),
    trainNo: z.string().trim().min(1).max(40),
    serviceDate: D5DateSchema,
    fromStation: z.string().trim().min(1).max(120),
    toStation: z.string().trim().min(1).max(120),
    departureTime: LocalTimeSchema,
    arrivalTime: LocalTimeSchema,
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }).nullable(),
    title: z.string().trim().min(1).max(240)
  })
  .strict()

export const RailDiscoveryResultSchema = z
  .object({
    sessionId: z.string().min(1),
    discoveryId: D5EphemeralIdSchema,
    expiresAt: z.string().datetime(),
    outboundOptions: z.array(RailOptionSchema).min(1).max(20),
    returnOptions: z.array(RailOptionSchema).min(1).max(20)
  })
  .strict()

export const RailSelectionRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    discoveryId: D5EphemeralIdSchema,
    outboundTrainNo: z.string().trim().min(1).max(40),
    returnTrainNo: z.string().trim().min(1).max(40)
  })
  .strict()

export const RailSelectionResultSchema = z
  .object({
    sessionId: z.string().min(1),
    discoveryId: D5EphemeralIdSchema,
    expiresAt: z.string().datetime(),
    outbound: RailOptionSchema,
    return: RailOptionSchema
  })
  .strict()

export const D5SourcePlanPreviewRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    discoveryId: D5EphemeralIdSchema,
    exactAddress: z.string().trim().min(3).max(300),
    originLabel: z.string().trim().min(1).max(80).default('出发地点')
  })
  .strict()

export const D5GeocodePreviewSchema = z
  .object({
    locationId: z.string().min(1).max(80),
    label: z.string().trim().min(1).max(200),
    city: z.string().trim().min(1).max(80),
    kind: z.enum(['EXACT_ORIGIN', 'STATION', 'STAY_AREA']),
    cached: z.boolean()
  })
  .strict()

export const D5GroundTransferPreviewSchema = z
  .object({
    direction: z.enum(['OUTBOUND', 'RETURN']),
    kind: z.enum(['FIRST_MILE', 'LAST_MILE']),
    from: z.string().trim().min(1).max(200),
    to: z.string().trim().min(1).max(200),
    travelMode: z.enum(['DRIVING', 'WALKING']),
    timingBasis: z.enum(['ARRIVE_BY_RAIL', 'DEPART_AFTER_RAIL'])
  })
  .strict()

export const D5HotelQueryPreviewSchema = z
  .object({
    place: z.string().trim().min(1).max(120),
    checkInDate: D5DateSchema,
    stayNights: z.number().int().min(1).max(28),
    adultCount: z.number().int().min(1).max(6),
    size: z.literal(5)
  })
  .strict()

export const D5PlannedSourceCallSchema = z
  .object({
    sequence: z.number().int().positive(),
    sourceId: z.enum(['SRC_MAP', 'SRC_HOTEL']),
    capability: z.enum(['GEOCODE', 'GROUND_TRANSFER', 'HOTEL_SEARCH']),
    label: z.string().trim().min(1).max(240)
  })
  .strict()

export const D5SourcePlanPreviewSchema = z
  .object({
    sessionId: z.string().min(1),
    planId: D5EphemeralIdSchema,
    discoveryId: D5EphemeralIdSchema,
    expiresAt: z.string().datetime(),
    digest: D5DigestSchema,
    selectedTrains: z.object({ outbound: RailOptionSchema, return: RailOptionSchema }).strict(),
    geocodes: z.array(D5GeocodePreviewSchema).min(1).max(8),
    transfers: z.array(D5GroundTransferPreviewSchema).length(4),
    hotelQuery: D5HotelQueryPreviewSchema,
    plannedCalls: z.array(D5PlannedSourceCallSchema).min(5).max(13),
    totalExternalCalls: z.number().int().min(5).max(13)
  })
  .strict()

export const D5SourcePlanExecuteRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    operationId: D5OperationIdSchema,
    planId: D5EphemeralIdSchema,
    digest: D5DigestSchema
  })
  .strict()

export const D5SourcePlanExecutionResultSchema = z
  .object({
    snapshot: D5SnapshotSchema,
    hotelOutcome: D5SourceOutcomeSchema,
    externalCallCount: z.number().int().nonnegative(),
    railExternalCallCount: z.literal(0)
  })
  .strict()

export const TransportRailSelectionParametersSchema = RailJourneySourceRequestSchema.omit({
  sessionId: true,
  candidateId: true,
  direction: true
}).strict()
export const TransportGroundTransferParametersSchema = MapGroundTransferSourceRequestSchema.omit({
  sessionId: true,
  candidateId: true,
  direction: true,
  kind: true
}).strict()
const TransportDirectionSourceParametersSchema = z
  .object({
    rail: TransportRailSelectionParametersSchema,
    firstMile: TransportGroundTransferParametersSchema,
    lastMile: TransportGroundTransferParametersSchema
  })
  .strict()
export const TransportSourceParametersSchema = z
  .object({
    outbound: TransportDirectionSourceParametersSchema,
    return: TransportDirectionSourceParametersSchema
  })
  .strict()
export const HotelSourceParametersSchema = HotelLodgingSourceRequestSchema.omit({
  sessionId: true
}).strict()

export const TransportPrepareRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    operationId: D5OperationIdSchema,
    sourceParameters: TransportSourceParametersSchema.optional()
  })
  .strict()
export const TransportSelectRequestSchema = z
  .object({ sessionId: z.string().min(1), candidateId: z.string().min(1) })
  .strict()
export const SkeletonPrepareRequestSchema = z
  .object({ sessionId: z.string().min(1), operationId: D5OperationIdSchema })
  .strict()
export const SkeletonPatchRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    date: D5DateSchema,
    period: z.enum(['MORNING', 'AFTERNOON', 'EVENING']),
    entityId: z.string().min(1)
  })
  .strict()
export const SkeletonConfirmRequestSchema = z.object({ sessionId: z.string().min(1) }).strict()
export const StayPrepareRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    operationId: D5OperationIdSchema,
    sourceParameters: HotelSourceParametersSchema.optional()
  })
  .strict()
export const StaySelectRequestSchema = z
  .object({ sessionId: z.string().min(1), candidateId: z.string().min(1) })
  .strict()
export const StayPasteRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    name: z.string().trim().min(1).max(300),
    totalCostCents: z.number().int().nonnegative().nullable(),
    roomType: z.string().trim().min(1).max(200).nullable().default(null),
    bedType: z.string().trim().min(1).max(200).nullable().default(null),
    capacity: z.number().int().positive().nullable().default(null),
    roomFitsParty: z.boolean().nullable().default(null),
    cancellationStatus: z.enum(['FREE_UNTIL', 'NON_REFUNDABLE', 'UNKNOWN']).default('UNKNOWN'),
    freeCancelUntil: z.string().datetime().nullable().default(null),
    positionAdvantage: z.string().trim().min(1).max(400).default('用户粘贴，位置优势待核验')
  })
  .strict()
  .superRefine((value, context) => {
    if (value.cancellationStatus === 'FREE_UNTIL' && !value.freeCancelUntil) {
      context.addIssue({
        code: 'custom',
        path: ['freeCancelUntil'],
        message: '免费取消必须提供截止时间'
      })
    }
    if (value.cancellationStatus !== 'FREE_UNTIL' && value.freeCancelUntil) {
      context.addIssue({
        code: 'custom',
        path: ['freeCancelUntil'],
        message: '只有免费取消需要截止时间'
      })
    }
  })

export type TransportPrepareRequest = z.infer<typeof TransportPrepareRequestSchema>
export type TransportSourceParameters = z.infer<typeof TransportSourceParametersSchema>
export type TransportSelectRequest = z.infer<typeof TransportSelectRequestSchema>
export type RailDiscoveryLeg = z.infer<typeof RailDiscoveryLegSchema>
export type RailDiscoveryPreview = z.infer<typeof RailDiscoveryPreviewSchema>
export type RailDiscoveryRequest = z.infer<typeof RailDiscoveryRequestSchema>
export type RailOption = z.infer<typeof RailOptionSchema>
export type RailDiscoveryResult = z.infer<typeof RailDiscoveryResultSchema>
export type RailSelectionRequest = z.infer<typeof RailSelectionRequestSchema>
export type RailSelectionResult = z.infer<typeof RailSelectionResultSchema>
export type D5SourcePlanPreviewRequest = z.infer<typeof D5SourcePlanPreviewRequestSchema>
export type D5SourcePlanPreview = z.infer<typeof D5SourcePlanPreviewSchema>
export type D5SourcePlanExecuteRequest = z.infer<typeof D5SourcePlanExecuteRequestSchema>
export type D5SourcePlanExecutionResult = z.infer<typeof D5SourcePlanExecutionResultSchema>
export type SkeletonPrepareRequest = z.infer<typeof SkeletonPrepareRequestSchema>
export type SkeletonPatchRequest = z.infer<typeof SkeletonPatchRequestSchema>
export type SkeletonConfirmRequest = z.infer<typeof SkeletonConfirmRequestSchema>
export type StayPrepareRequest = z.infer<typeof StayPrepareRequestSchema>
export type HotelSourceParameters = z.infer<typeof HotelSourceParametersSchema>
export type StaySelectRequest = z.infer<typeof StaySelectRequestSchema>
export type StayPasteRequest = z.infer<typeof StayPasteRequestSchema>

export const D5ProgressEventSchema = z
  .object({
    operationId: D5OperationIdSchema,
    sessionId: z.string().min(1),
    kind: z.enum([
      'RAIL_DISCOVERY_STARTED',
      'SOURCE_PLAN_STARTED',
      'TRANSPORT_STARTED',
      'SKELETON_STARTED',
      'STAY_STARTED',
      'COMPLETED'
    ]),
    message: z.string().trim().min(1).max(300)
  })
  .strict()
export type D5ProgressEvent = z.infer<typeof D5ProgressEventSchema>
