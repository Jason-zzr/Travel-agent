import { z } from 'zod'
import { VerificationStatusSchema } from './evidence'
import { TravelStageSchema } from './stage'

export const D6DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const D6LocalTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
export const D6OperationIdSchema = z.string().uuid()

export const TimelineItemClassSchema = z.enum([
  'FIXED',
  'RECOMMENDED',
  'FLEXIBLE',
  'OPTIONAL',
  'BACKUP'
])
export const TimelineAnchorClassSchema = z.enum([
  'HARD_LOCKED',
  'CONFIRMED_EXTERNAL',
  'MUST',
  'PREFERRED',
  'FLEXIBLE'
])
export const TimelineLocationKindSchema = z.enum([
  'POI',
  'RESTAURANT',
  'STAY',
  'STATION',
  'AIRPORT',
  'OTHER'
])

export const TimelineRouteRoleSchema = z.enum([
  'STAY_ACTIVITY',
  'STAY_CHECKOUT',
  'LOCAL_TRANSFER',
  'INTERCITY_LEG',
  'STAY_CHECKIN',
  'BACKUP'
])

export const TimelineRouteContextSchema = z
  .object({
    routeId: z.string().min(1).max(120),
    dayType: z.enum(['ARRIVAL_DAY', 'NORMAL_DAY', 'DEPARTURE_DAY', 'INTERCITY_TRANSFER_DAY']),
    role: TimelineRouteRoleSchema,
    nodeId: z.string().min(1).max(120).nullable(),
    segmentId: z.string().min(1).max(120).nullable(),
    routeLegId: z.string().min(1).max(120).nullable(),
    fromNodeId: z.string().min(1).max(120).nullable(),
    toNodeId: z.string().min(1).max(120).nullable()
  })
  .strict()
  .superRefine((value, context) => {
    const stayRole = ['STAY_ACTIVITY', 'STAY_CHECKOUT', 'STAY_CHECKIN'].includes(value.role)
    if (stayRole && (value.nodeId === null || value.segmentId === null)) {
      context.addIssue({ code: 'custom', message: 'stay route role requires node and segment' })
    }
    if (
      value.role === 'INTERCITY_LEG' &&
      (value.routeLegId === null || value.fromNodeId === value.toNodeId)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'intercity route role requires a route leg with distinct endpoints'
      })
    }
    if (value.role === 'BACKUP' && value.nodeId === null && value.routeLegId === null) {
      context.addIssue({ code: 'custom', message: 'route backup requires node or leg scope' })
    }
    if (
      value.dayType !== 'INTERCITY_TRANSFER_DAY' &&
      ['STAY_CHECKOUT', 'LOCAL_TRANSFER', 'INTERCITY_LEG', 'STAY_CHECKIN'].includes(value.role)
    ) {
      context.addIssue({ code: 'custom', message: 'transfer route role requires transfer day' })
    }
  })
export type TimelineRouteContext = z.infer<typeof TimelineRouteContextSchema>

export const TimelineCoordinateSchema = z
  .object({
    lng: z.number().finite().min(-180).max(180),
    lat: z.number().finite().min(-90).max(90)
  })
  .strict()

export const TimelineLocationSchema = z
  .object({
    name: z.string().trim().min(1).max(300),
    kind: TimelineLocationKindSchema,
    address: z.string().trim().min(1).max(500).nullable().default(null),
    coordinates: TimelineCoordinateSchema.nullable().default(null)
  })
  .strict()
export type TimelineLocation = z.infer<typeof TimelineLocationSchema>

export const TimelineArrivalTransportSchema = z
  .object({
    mode: z.enum(['WALKING', 'TRANSIT', 'DRIVING', 'RAIL', 'MANUAL']),
    from: z.string().trim().min(1).max(300),
    to: z.string().trim().min(1).max(300),
    etaMinutes: z.number().int().nonnegative(),
    claimIds: z.array(z.string().min(1)).min(1).max(20)
  })
  .strict()
export type TimelineArrivalTransport = z.infer<typeof TimelineArrivalTransportSchema>

export const TimelineVerificationSummarySchema = z
  .object({
    status: VerificationStatusSchema,
    claimCount: z.number().int().nonnegative(),
    allClaimsUsable: z.boolean()
  })
  .strict()
export type TimelineVerificationSummary = z.infer<typeof TimelineVerificationSummarySchema>

function localMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number)
  return (hours ?? 0) * 60 + (minutes ?? 0)
}

export const TimelineItemSchema = z
  .object({
    itemId: z.string().min(1),
    date: D6DateSchema,
    startTime: D6LocalTimeSchema,
    endTime: D6LocalTimeSchema,
    crossesMidnight: z.boolean().default(false),
    title: z.string().trim().min(1).max(300),
    itemClass: TimelineItemClassSchema,
    anchorClass: TimelineAnchorClassSchema,
    location: TimelineLocationSchema,
    arrivalTransport: TimelineArrivalTransportSchema.nullable().default(null),
    bufferMinutes: z.number().int().nonnegative(),
    costCents: z.number().int().nonnegative().nullable().default(null),
    claimIds: z.array(z.string().min(1)).max(40).default([]),
    verificationSummary: TimelineVerificationSummarySchema,
    routeContext: TimelineRouteContextSchema.nullable().optional()
  })
  .strict()
  .superRefine((value, context) => {
    const start = localMinutes(value.startTime)
    const end = localMinutes(value.endTime)
    if (value.crossesMidnight && end >= start) {
      context.addIssue({
        code: 'custom',
        path: ['crossesMidnight'],
        message: 'cross-midnight items must end on an earlier local clock time'
      })
    }
    if (!value.crossesMidnight && end < start) {
      context.addIssue({
        code: 'custom',
        path: ['endTime'],
        message: 'end time before start requires crossesMidnight'
      })
    }
    if (value.verificationSummary.claimCount !== value.claimIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['verificationSummary', 'claimCount'],
        message: 'claimCount must equal claimIds length'
      })
    }
    if (value.anchorClass === 'HARD_LOCKED' && value.claimIds.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['claimIds'],
        message: 'hard-locked items require evidence claims'
      })
    }
    if (value.itemClass === 'BACKUP') {
      if (
        value.arrivalTransport !== null ||
        value.bufferMinutes !== 0 ||
        value.startTime !== value.endTime
      ) {
        context.addIssue({
          code: 'custom',
          message: 'backup items must not consume timeline duration or arrival transport'
        })
      }
      return
    }
    if (value.arrivalTransport !== null) {
      const minimum = ['STATION', 'AIRPORT'].includes(value.location.kind) ? 30 : 10
      if (value.bufferMinutes < minimum) {
        context.addIssue({
          code: 'custom',
          path: ['bufferMinutes'],
          message: `arrival buffer must be at least ${minimum} minutes`
        })
      }
    }
  })
export type TimelineItem = z.infer<typeof TimelineItemSchema>

export const TimelineDecisionSchema = z
  .object({
    decisionId: z.string().min(1),
    category: z.string().trim().min(1).max(80),
    selected: z.string().trim().min(1).max(200),
    reason: z.string().trim().min(1).max(500),
    alternatives: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
    claimIds: z.array(z.string().min(1)).max(80).default([])
  })
  .strict()
export type TimelineDecision = z.infer<typeof TimelineDecisionSchema>

export const TimelineVersionSchema = z
  .object({
    version: z.number().int().positive(),
    createdAt: z.string().datetime(),
    summary: z.string().trim().min(1).max(500),
    isCurrent: z.boolean(),
    routeId: z.string().min(1).max(120).nullable().optional(),
    items: z.array(TimelineItemSchema).min(1).max(200),
    decision: TimelineDecisionSchema
  })
  .strict()
export type TimelineVersion = z.infer<typeof TimelineVersionSchema>

export const TimelineVersionMetadataSchema = TimelineVersionSchema.omit({
  items: true,
  decision: true
})
export type TimelineVersionMetadata = z.infer<typeof TimelineVersionMetadataSchema>

export const TimelineBlockingItemSchema = z
  .object({
    itemId: z.string().min(1).nullable(),
    title: z.string().trim().min(1).max(300),
    code: z.enum([
      'MISSING_PREREQUISITE',
      'MISSING_CLAIM',
      'UNVERIFIED_HARD_ANCHOR',
      'TIME_CONFLICT',
      'BUFFER_TOO_SMALL',
      'MISSING_BACKUP'
    ]),
    message: z.string().trim().min(1).max(500),
    routeContext: TimelineRouteContextSchema.nullable().optional()
  })
  .strict()
export type TimelineBlockingItem = z.infer<typeof TimelineBlockingItemSchema>

export const TimelineGateReportSchema = z
  .object({
    publishable: z.boolean(),
    blockingItems: z.array(TimelineBlockingItemSchema).max(100)
  })
  .strict()
  .superRefine((value, context) => {
    if (value.publishable === value.blockingItems.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['publishable'],
        message: 'publishable must match the absence of blocking items'
      })
    }
  })
export type TimelineGateReport = z.infer<typeof TimelineGateReportSchema>

export const D6SourceOutcomeSchema = z
  .object({
    sourceId: z.enum(['SRC_MAP', 'SRC_SEARCH', 'USER_PASTE']),
    capability: z.enum(['ROUTE_ETA', 'RESTAURANT']),
    status: z.enum(['SUCCEEDED', 'EMPTY', 'FAILED', 'CANCELLED', 'NOT_REQUIRED']),
    claimCount: z.number().int().nonnegative(),
    externalCallCount: z.number().int().nonnegative(),
    errorCode: z.string().min(1).nullable(),
    capabilityImpact: z.string().min(1).nullable(),
    manualAlternative: z.string().min(1).nullable()
  })
  .strict()
export type D6SourceOutcome = z.infer<typeof D6SourceOutcomeSchema>

export const TimelineDraftSchema = z
  .object({
    draftId: z.string().uuid(),
    sessionId: z.string().min(1),
    routeId: z.string().min(1).max(120).nullable().optional(),
    createdAt: z.string().datetime(),
    summary: z.string().trim().min(1).max(500),
    items: z.array(TimelineItemSchema).min(1).max(200),
    gate: TimelineGateReportSchema,
    sourceOutcomes: z.array(D6SourceOutcomeSchema).max(12),
    changedDates: z.array(D6DateSchema).min(1).max(31)
  })
  .strict()
export type TimelineDraft = z.infer<typeof TimelineDraftSchema>

export const TimelineVerificationRollupSchema = z
  .object({
    hardAnchorCount: z.number().int().nonnegative(),
    verifiedHardAnchorCount: z.number().int().nonnegative(),
    orphanFactCount: z.number().int().nonnegative()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.verifiedHardAnchorCount > value.hardAnchorCount) {
      context.addIssue({ code: 'custom', message: 'verified hard anchors exceed total' })
    }
  })

const TimelinePublishedPayloadBaseSchema = z.object({
  timeline: TimelineVersionSchema,
  sourceOutcomes: z.array(D6SourceOutcomeSchema).max(12),
  verification: TimelineVerificationRollupSchema,
  changedDates: z.array(D6DateSchema).min(1).max(31)
})

export const TimelinePublishedPayloadWriteSchema = TimelinePublishedPayloadBaseSchema.strict()
export const TimelinePublishedPayloadSchema = TimelinePublishedPayloadBaseSchema.passthrough()
export type TimelinePublishedPayload = z.infer<typeof TimelinePublishedPayloadWriteSchema>

export const D6SnapshotSchema = z
  .object({
    sessionId: z.string().min(1),
    routeId: z.string().min(1).max(120).nullable().optional(),
    stage: TravelStageSchema,
    currentVersion: z.number().int().positive().nullable(),
    versions: z.array(TimelineVersionMetadataSchema),
    selectedVersion: TimelineVersionSchema.nullable(),
    draft: TimelineDraftSchema.nullable(),
    publishability: TimelineGateReportSchema,
    sourceOutcomes: z.array(D6SourceOutcomeSchema).max(12)
  })
  .strict()
export type D6Snapshot = z.infer<typeof D6SnapshotSchema>

export const TimelinePrepareRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    routeId: z.string().min(1).max(120).optional(),
    operationId: D6OperationIdSchema
  })
  .strict()
export const TimelinePublishRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    routeId: z.string().min(1).max(120).optional(),
    draftId: z.string().uuid()
  })
  .strict()
export const D6SnapshotRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    routeId: z.string().min(1).max(120).optional(),
    version: z.number().int().positive().optional()
  })
  .strict()
export const D6CancelRequestSchema = z.object({ operationId: D6OperationIdSchema }).strict()

export type TimelinePrepareRequest = z.infer<typeof TimelinePrepareRequestSchema>
export type TimelinePublishRequest = z.infer<typeof TimelinePublishRequestSchema>
export type D6SnapshotRequest = z.infer<typeof D6SnapshotRequestSchema>
export type D6CancelRequest = z.infer<typeof D6CancelRequestSchema>

export const D6ProgressEventSchema = z
  .object({
    operationId: D6OperationIdSchema,
    sessionId: z.string().min(1),
    routeId: z.string().min(1).max(120).nullable().optional(),
    kind: z.enum(['ROUTE_STARTED', 'RESTAURANT_STARTED', 'TIMELINE_STARTED', 'COMPLETED']),
    message: z.string().trim().min(1).max(300)
  })
  .strict()
export type D6ProgressEvent = z.infer<typeof D6ProgressEventSchema>
