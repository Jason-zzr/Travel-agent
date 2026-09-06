import { z } from 'zod'
import {
  BoundaryAnchorSchema,
  D5SourceOutcomeSchema,
  RailOptionSchema,
  StayCandidateSchema,
  TransportLegSchema
} from './d5'
import { EvidenceClaimSchema } from './evidence'
import { RouteCandidateSchema, RouteLegSchema, RouteStaySegmentSchema } from './itinerary'
import { TravelStageSchema } from './stage'

const IdentitySchema = z
  .object({ sessionId: z.string().min(1), routeId: z.string().min(1).max(120) })
  .strict()

export const RouteD5RouteScopeSchema = IdentitySchema.extend({ kind: z.literal('ROUTE') }).strict()
export const RouteD5LegScopeSchema = IdentitySchema.extend({
  kind: z.literal('LEG'),
  legId: z.string().min(1).max(120)
}).strict()
export const RouteD5StayScopeSchema = IdentitySchema.extend({
  kind: z.literal('STAY'),
  nodeId: z.string().min(1).max(120),
  segmentId: z.string().min(1).max(120)
}).strict()
export const RouteD5ScopeSchema = z.discriminatedUnion('kind', [
  RouteD5RouteScopeSchema,
  RouteD5LegScopeSchema,
  RouteD5StayScopeSchema
])
export type RouteD5Scope = z.infer<typeof RouteD5ScopeSchema>
export type RouteD5RouteScope = z.infer<typeof RouteD5RouteScopeSchema>
export type RouteD5LegScope = z.infer<typeof RouteD5LegScopeSchema>
export type RouteD5StayScope = z.infer<typeof RouteD5StayScopeSchema>

export const RouteD5LegStatusSchema = z.enum([
  'NOT_STARTED',
  'OPTIONS_READY',
  'SELECTED',
  'READY',
  'BLOCKED'
])
export const RouteD5StayStatusSchema = z.enum([
  'NOT_STARTED',
  'CANDIDATES_READY',
  'SELECTED',
  'BLOCKED'
])

export const RouteD5LegPlanSchema = z
  .object({
    legs: z.array(TransportLegSchema).length(4),
    boundaryAnchors: z.array(BoundaryAnchorSchema).length(2),
    totalDurationMinutes: z.number().int().nonnegative(),
    totalCostCents: z.number().int().nonnegative().nullable(),
    costComplete: z.boolean()
  })
  .strict()
export type RouteD5LegPlan = z.infer<typeof RouteD5LegPlanSchema>

export const RouteD5LegStateSchema = z
  .object({
    scope: RouteD5LegScopeSchema,
    sequence: z.number().int().positive().max(9),
    routeLeg: RouteLegSchema,
    status: RouteD5LegStatusSchema,
    railOptions: z.array(RailOptionSchema).max(20).default([]),
    selectedRailOption: RailOptionSchema.nullable().default(null),
    selectionClaimIds: z.array(z.string().min(1)).max(20).default([]),
    plan: RouteD5LegPlanSchema.nullable().default(null),
    sourceOutcome: z.enum(['NOT_RUN', 'SUCCEEDED', 'FAILED', 'CANCELLED']).default('NOT_RUN'),
    blockingReasons: z.array(z.string().trim().min(1).max(500)).max(20).default([])
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.routeLeg.routeId !== value.scope.routeId ||
      value.routeLeg.legId !== value.scope.legId
    ) {
      context.addIssue({ code: 'custom', message: 'route D5 leg scope mismatch' })
    }
    if (value.status === 'READY' && value.plan === null) {
      context.addIssue({ code: 'custom', message: 'ready route D5 leg requires a plan' })
    }
  })
export type RouteD5LegState = z.infer<typeof RouteD5LegStateSchema>

export const RouteD5StayStateSchema = z
  .object({
    scope: RouteD5StayScopeSchema,
    sequence: z.number().int().positive().max(8),
    segment: RouteStaySegmentSchema,
    status: RouteD5StayStatusSchema,
    candidates: z.array(StayCandidateSchema).max(20).default([]),
    selectedCandidateId: z.string().min(1).nullable().default(null),
    sourceOutcomes: z.array(D5SourceOutcomeSchema).max(3).default([]),
    blockingReasons: z.array(z.string().trim().min(1).max(500)).max(20).default([])
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.segment.routeId !== value.scope.routeId ||
      value.segment.nodeId !== value.scope.nodeId ||
      value.segment.segmentId !== value.scope.segmentId
    ) {
      context.addIssue({ code: 'custom', message: 'route D5 stay scope mismatch' })
    }
    if (
      value.selectedCandidateId !== null &&
      !value.candidates.some((candidate) => candidate.candidateId === value.selectedCandidateId)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'selected stay candidate is outside its segment'
      })
    }
  })
export type RouteD5StayState = z.infer<typeof RouteD5StayStateSchema>

export const RouteDaySkeletonSchema = z
  .object({
    sessionId: z.string().min(1),
    routeId: z.string().min(1).max(120),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dayType: z.enum(['ARRIVAL_DAY', 'NORMAL_DAY', 'DEPARTURE_DAY', 'INTERCITY_TRANSFER_DAY']),
    owningNodeId: z.string().min(1).max(120).nullable(),
    segmentId: z.string().min(1).max(120).nullable(),
    routeLegId: z.string().min(1).max(120).nullable(),
    routeLegIds: z.array(z.string().min(1).max(120)).max(9).default([]),
    fromNodeId: z.string().min(1).max(120).nullable(),
    toNodeId: z.string().min(1).max(120).nullable(),
    intensity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    attractionEntityIds: z.array(z.string().min(1)).max(8).default([]),
    boundaryAnchors: z.array(BoundaryAnchorSchema).max(2).default([]),
    notes: z.array(z.string().trim().min(1).max(300)).max(8).default([])
  })
  .strict()
  .superRefine((value, context) => {
    const transfer = value.dayType === 'INTERCITY_TRANSFER_DAY'
    if (
      transfer !== (value.routeLegId !== null) ||
      (transfer && (value.routeLegIds.length === 0 || value.routeLegIds[0] !== value.routeLegId)) ||
      (!transfer && value.routeLegIds.length > 0)
    ) {
      context.addIssue({ code: 'custom', message: 'transfer day requires ordered routeLegIds' })
    }
    if (!transfer && (value.owningNodeId === null || value.segmentId === null)) {
      context.addIssue({ code: 'custom', message: 'stay day requires owning node and segment' })
    }
  })
export type RouteDaySkeleton = z.infer<typeof RouteDaySkeletonSchema>

export const RouteD5WorkItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('LEG'), legId: z.string().min(1) }).strict(),
  z
    .object({ kind: z.literal('STAY'), nodeId: z.string().min(1), segmentId: z.string().min(1) })
    .strict()
])

export const MultiSegmentD5SnapshotSchema = z
  .object({
    sessionId: z.string().min(1),
    stage: TravelStageSchema,
    selectedRouteId: z.string().min(1).max(120),
    selectedRoute: RouteCandidateSchema,
    legStates: z.array(RouteD5LegStateSchema).min(1).max(9),
    stayStates: z.array(RouteD5StayStateSchema).min(1).max(8),
    days: z.array(RouteDaySkeletonSchema).max(31),
    nextRequiredWorkItem: RouteD5WorkItemSchema.nullable(),
    blockingReasons: z.array(z.string().trim().min(1).max(500)).max(100),
    confirmed: z.boolean()
  })
  .strict()
export type MultiSegmentD5Snapshot = z.infer<typeof MultiSegmentD5SnapshotSchema>

export const RouteD5PlanActionSchema = z.enum(['DISCOVER_RAIL', 'PREPARE_TRANSFERS', 'FETCH_STAY'])
export type RouteD5PlanAction = z.infer<typeof RouteD5PlanActionSchema>

export const RouteD5PlannedCallSchema = z
  .object({
    sequence: z.number().int().positive(),
    sourceId: z.enum(['SRC_RAIL', 'SRC_MAP', 'SRC_HOTEL']),
    capability: z.enum(['RAIL_DISCOVERY', 'GEOCODE', 'GROUND_TRANSFER', 'HOTEL_SEARCH']),
    label: z.string().trim().min(1).max(240)
  })
  .strict()

export const RouteD5PlanPreviewSchema = z
  .object({
    scope: RouteD5ScopeSchema,
    action: RouteD5PlanActionSchema,
    planId: z.string().uuid(),
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    expiresAt: z.string().datetime(),
    plannedCalls: z.array(RouteD5PlannedCallSchema).max(8),
    totalExternalCalls: z.number().int().nonnegative().max(8),
    retryCount: z.literal(0),
    timeoutSeconds: z.number().int().positive().max(60)
  })
  .strict()
export type RouteD5PlanPreview = z.infer<typeof RouteD5PlanPreviewSchema>

export const RouteD5SnapshotRequestSchema = z.object({ sessionId: z.string().min(1) }).strict()
export const RouteD5PreviewRequestSchema = z
  .object({
    scope: RouteD5ScopeSchema,
    action: RouteD5PlanActionSchema,
    fromAddress: z.string().trim().min(3).max(300).nullable().default(null),
    toAddress: z.string().trim().min(3).max(300).nullable().default(null)
  })
  .strict()
export const RouteD5ExecuteRequestSchema = z
  .object({
    scope: RouteD5ScopeSchema,
    action: RouteD5PlanActionSchema,
    operationId: z.string().uuid(),
    planId: z.string().uuid(),
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/)
  })
  .strict()
export const RouteD5LegSelectRequestSchema = z
  .object({ scope: RouteD5LegScopeSchema, trainNo: z.string().trim().min(1).max(40) })
  .strict()
export const RouteD5ManualLegRequestSchema = z
  .object({ scope: RouteD5LegScopeSchema, claimIds: z.array(z.string().min(1)).min(1).max(20) })
  .strict()
export const RouteD5SkeletonPrepareRequestSchema = z
  .object({ scope: RouteD5RouteScopeSchema })
  .strict()
export const RouteD5SkeletonPatchRequestSchema = z
  .object({
    scope: RouteD5RouteScopeSchema,
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    attractionEntityIds: z.array(z.string().min(1)).max(8)
  })
  .strict()
export const RouteD5StaySelectRequestSchema = z
  .object({ scope: RouteD5StayScopeSchema, candidateId: z.string().min(1) })
  .strict()
export const RouteD5StayPasteRequestSchema = z
  .object({
    scope: RouteD5StayScopeSchema,
    name: z.string().trim().min(1).max(300),
    totalCostCents: z.number().int().nonnegative().nullable(),
    roomType: z.string().trim().min(1).max(200).nullable(),
    bedType: z.string().trim().min(1).max(200).nullable(),
    capacity: z.number().int().positive().nullable(),
    roomFitsParty: z.boolean().nullable(),
    cancellationStatus: z.enum(['FREE_UNTIL', 'NON_REFUNDABLE', 'UNKNOWN']),
    freeCancelUntil: z.string().datetime().nullable(),
    positionAdvantage: z.string().trim().min(1).max(400)
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.cancellationStatus === 'FREE_UNTIL') !== (value.freeCancelUntil !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'free cancellation requires exactly one deadline'
      })
    }
  })
export const RouteD5ConfirmRequestSchema = z.object({ scope: RouteD5RouteScopeSchema }).strict()
export const RouteD5CancelRequestSchema = z.object({ operationId: z.string().uuid() }).strict()

export const RouteD5ProgressEventSchema = z
  .object({
    operationId: z.string().uuid(),
    scope: RouteD5ScopeSchema,
    completedCalls: z.number().int().nonnegative(),
    totalCalls: z.number().int().nonnegative(),
    phase: z.enum(['STARTED', 'SOURCE', 'PERSISTING', 'COMPLETED', 'FAILED', 'CANCELLED'])
  })
  .strict()

export const RouteD5LegOptionsPreparedPayloadSchema = z
  .object({ scope: RouteD5LegScopeSchema, options: z.array(RailOptionSchema).min(1).max(20) })
  .strict()
export const RouteD5LegSelectedPayloadSchema = z
  .object({
    scope: RouteD5LegScopeSchema,
    selectionKind: z.enum(['RAIL_OPTION', 'MANUAL_EVIDENCE']),
    option: RailOptionSchema.nullable(),
    claims: z.array(EvidenceClaimSchema).min(1).max(20),
    plan: RouteD5LegPlanSchema.nullable().default(null)
  })
  .strict()
export const RouteD5LegTransfersPreparedPayloadSchema = z
  .object({
    scope: RouteD5LegScopeSchema,
    plan: RouteD5LegPlanSchema,
    finalClaims: z.array(EvidenceClaimSchema).max(8)
  })
  .strict()
export const RouteD5SkeletonUpdatedPayloadSchema = z
  .object({
    scope: RouteD5RouteScopeSchema,
    days: z.array(RouteDaySkeletonSchema).min(1).max(31),
    changedDates: z
      .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
      .min(1)
      .max(31)
  })
  .strict()
export const RouteD5StayCandidatesPreparedPayloadSchema = z
  .object({
    scope: RouteD5StayScopeSchema,
    candidates: z.array(StayCandidateSchema).max(20),
    sourceOutcomes: z.array(D5SourceOutcomeSchema).max(3),
    finalClaims: z.array(EvidenceClaimSchema).max(20)
  })
  .strict()
export const RouteD5StaySelectedPayloadSchema = z
  .object({ scope: RouteD5StayScopeSchema, candidateId: z.string().min(1) })
  .strict()
export const RouteD5ConfirmedPayloadSchema = z
  .object({
    scope: RouteD5RouteScopeSchema,
    confirmedAt: z.string().datetime(),
    fromStage: z.literal('STAGE_4'),
    toStage: z.literal('STAGE_5'),
    confirmed: z.literal(true)
  })
  .strict()

export type RouteD5PreviewRequest = z.infer<typeof RouteD5PreviewRequestSchema>
export type RouteD5ExecuteRequest = z.infer<typeof RouteD5ExecuteRequestSchema>
export type RouteD5LegSelectRequest = z.infer<typeof RouteD5LegSelectRequestSchema>
export type RouteD5ManualLegRequest = z.infer<typeof RouteD5ManualLegRequestSchema>
export type RouteD5SkeletonPrepareRequest = z.infer<typeof RouteD5SkeletonPrepareRequestSchema>
export type RouteD5SkeletonPatchRequest = z.infer<typeof RouteD5SkeletonPatchRequestSchema>
export type RouteD5StaySelectRequest = z.infer<typeof RouteD5StaySelectRequestSchema>
export type RouteD5StayPasteRequest = z.infer<typeof RouteD5StayPasteRequestSchema>
export type RouteD5ConfirmRequest = z.infer<typeof RouteD5ConfirmRequestSchema>
export type RouteD5ProgressEvent = z.infer<typeof RouteD5ProgressEventSchema>
