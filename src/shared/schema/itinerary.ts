import { z } from 'zod'
import {
  BudgetIntentSchema,
  MandatoryPlaceIntentSchema,
  TravelerGroupSchema,
  TravelIntensitySchema
} from './interview'
import {
  EvidenceClaimSchema,
  RouteGoalLegEvidenceScopeSchema,
  VerificationStatusSchema
} from './evidence'
import { ExternalSourceUrlSchema } from './source'

export const ItineraryDateSchema = z.string().date()
export const RouteDigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/)
export const RouteOperationIdSchema = z.string().uuid()
export const RouteProfileSchema = z.enum(['BALANCED', 'LOW_TRANSIT', 'RELAXED'])
export type RouteProfile = z.infer<typeof RouteProfileSchema>
export const RouteModeSchema = z.enum([
  'RAIL',
  'MANUAL_FLIGHT',
  'MANUAL_COACH',
  'LOCAL_TRANSFER',
  'UNKNOWN'
])
export type RouteMode = z.infer<typeof RouteModeSchema>
export const RouteRiskLevelSchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN'])
export const RouteRiskFlagSchema = z.enum([
  'UNVERIFIED',
  'TRANSFER',
  'OVERNIGHT_ARRIVAL',
  'BACKTRACKING',
  'ALTITUDE',
  'STAMINA'
])

export const ItineraryGoalSchema = z
  .object({
    regionGoal: z.string().trim().min(1).max(120),
    originCity: z.string().trim().min(1).max(80),
    originPlaceLabel: z.string().trim().min(1).max(160).nullable().default(null),
    startDate: ItineraryDateSchema,
    endDate: ItineraryDateSchema,
    totalDays: z.number().int().min(3).max(31),
    totalNights: z.number().int().min(2).max(30),
    travelers: z.array(TravelerGroupSchema).min(1).max(10),
    budget: BudgetIntentSchema,
    intensity: TravelIntensitySchema,
    mandatoryPlaces: z.array(MandatoryPlaceIntentSchema).min(2).max(12)
  })
  .strict()
  .superRefine((goal, context) => {
    const days = daysBetween(goal.startDate, goal.endDate) + 1
    if (days !== goal.totalDays || goal.totalNights !== goal.totalDays - 1) {
      context.addIssue({
        code: 'custom',
        message: 'itinerary date window must match total days and nights'
      })
    }
    const placeIds = new Set(goal.mandatoryPlaces.map((place) => place.placeId))
    if (placeIds.size !== goal.mandatoryPlaces.length) {
      context.addIssue({ code: 'custom', message: 'mandatory place IDs must be unique' })
    }
  })
export type ItineraryGoal = z.infer<typeof ItineraryGoalSchema>

const OriginEndpointSchema = z
  .object({ kind: z.literal('ORIGIN'), city: z.string().trim().min(1).max(80) })
  .strict()
const NodeEndpointSchema = z
  .object({ kind: z.literal('NODE'), nodeId: z.string().min(1).max(120) })
  .strict()
export const RouteEndpointRefSchema = z.discriminatedUnion('kind', [
  OriginEndpointSchema,
  NodeEndpointSchema
])
export type RouteEndpointRef = z.infer<typeof RouteEndpointRefSchema>

export const RouteNodeSchema = z
  .object({
    routeId: z.string().min(1).max(120),
    nodeId: z.string().min(1).max(120),
    city: z.string().trim().min(1).max(80),
    region: z.string().trim().min(1).max(120),
    sequence: z.number().int().positive().max(8),
    arrivalDate: ItineraryDateSchema,
    departureDate: ItineraryDateSchema,
    nights: z.number().int().nonnegative().max(28),
    nodeKind: z.enum(['STAY', 'TRANSIT']),
    mandatoryPlaceIds: z.array(z.string().min(1).max(120)).max(12).default([]),
    reason: z.string().trim().min(1).max(500)
  })
  .strict()
  .superRefine((node, context) => {
    if (daysBetween(node.arrivalDate, node.departureDate) !== node.nights) {
      context.addIssue({
        code: 'custom',
        message: 'node nights must match arrival/departure dates'
      })
    }
    if (
      (node.nodeKind === 'STAY' && node.nights === 0) ||
      (node.nodeKind === 'TRANSIT' && node.nights !== 0)
    ) {
      context.addIssue({ code: 'custom', message: 'node kind and nights are inconsistent' })
    }
  })
export type RouteNode = z.infer<typeof RouteNodeSchema>

export const RouteLegEvidenceValueSchema = z
  .object({
    fromCity: z.string().trim().min(1).max(80),
    toCity: z.string().trim().min(1).max(80),
    travelDate: ItineraryDateSchema,
    mode: RouteModeSchema,
    label: z.string().trim().min(1).max(240),
    startAt: z.string().datetime({ offset: true }).optional(),
    endAt: z.string().datetime({ offset: true }).optional(),
    durationMinutes: z.number().int().nonnegative().nullable(),
    costCents: z.number().int().nonnegative().nullable(),
    transferCount: z.number().int().nonnegative().max(8),
    overnightArrival: z.boolean(),
    sourceLabel: z.string().trim().min(1).max(160).optional(),
    sourceUrl: ExternalSourceUrlSchema.optional(),
    summary: z.string().trim().min(1).max(500).optional()
  })
  .strict()
export type RouteLegEvidenceValue = z.infer<typeof RouteLegEvidenceValueSchema>

export const RouteLegSchema = z
  .object({
    routeId: z.string().min(1).max(120),
    legId: z.string().min(1).max(120),
    from: RouteEndpointRefSchema,
    to: RouteEndpointRefSchema,
    fromCity: z.string().trim().min(1).max(80),
    toCity: z.string().trim().min(1).max(80),
    travelDate: ItineraryDateSchema,
    mode: RouteModeSchema,
    label: z.string().trim().min(1).max(240),
    durationMinutes: z.number().int().nonnegative().nullable(),
    costCents: z.number().int().nonnegative().nullable(),
    transferCount: z.number().int().nonnegative().max(8),
    verificationStatus: VerificationStatusSchema,
    claimIds: z.array(z.string().min(1)).max(20).default([]),
    riskFlags: z.array(RouteRiskFlagSchema).max(8).default([]),
    critical: z.boolean().default(true)
  })
  .strict()
  .superRefine((leg, context) => {
    if (leg.fromCity.normalize('NFKC').trim() === leg.toCity.normalize('NFKC').trim()) {
      context.addIssue({ code: 'custom', message: 'route leg endpoints must differ' })
    }
    if (isUsableVerification(leg.verificationStatus) && leg.claimIds.length === 0) {
      context.addIssue({ code: 'custom', message: 'verified route leg requires claim IDs' })
    }
  })
export type RouteLeg = z.infer<typeof RouteLegSchema>

export const RouteStaySegmentSchema = z
  .object({
    routeId: z.string().min(1).max(120),
    nodeId: z.string().min(1).max(120),
    segmentId: z.string().min(1).max(120),
    city: z.string().trim().min(1).max(80),
    checkInDate: ItineraryDateSchema,
    checkOutDate: ItineraryDateSchema,
    nights: z.number().int().positive().max(28),
    nightDates: z.array(ItineraryDateSchema).min(1).max(28),
    positionAssessment: z
      .object({
        status: z.enum(['VERIFIED', 'ESTIMATED', 'UNKNOWN']),
        summary: z.string().trim().min(1).max(500),
        claimIds: z.array(z.string().min(1)).max(80).default([])
      })
      .strict()
  })
  .strict()
  .superRefine((segment, context) => {
    if (
      segment.nightDates.length !== segment.nights ||
      daysBetween(segment.checkInDate, segment.checkOutDate) !== segment.nights
    ) {
      context.addIssue({ code: 'custom', message: 'stay segment nights are inconsistent' })
    }
    const expected = Array.from({ length: segment.nights }, (_, index) =>
      addDays(segment.checkInDate, index)
    )
    if (expected.some((date, index) => date !== segment.nightDates[index])) {
      context.addIssue({ code: 'custom', message: 'stay segment night dates must be contiguous' })
    }
  })
export type RouteStaySegment = z.infer<typeof RouteStaySegmentSchema>

export const RouteScoreBreakdownSchema = z
  .object({
    hardConstraintPass: z.boolean(),
    criticalEvidenceComplete: z.boolean(),
    unverifiedLegCount: z.number().int().nonnegative(),
    transferCount: z.number().int().nonnegative(),
    overnightArrivalCount: z.number().int().nonnegative(),
    transitMinutes: z.number().int().nonnegative().nullable(),
    backtrackingScore: z.number().int().min(0).max(100),
    staminaRisk: RouteRiskLevelSchema,
    altitudeRisk: RouteRiskLevelSchema,
    knownCostCents: z.number().int().nonnegative().nullable(),
    costComplete: z.boolean()
  })
  .strict()
  .superRefine((score, context) => {
    if (!score.costComplete && score.knownCostCents !== null) {
      context.addIssue({ code: 'custom', message: 'incomplete route cost must remain unknown' })
    }
  })
export type RouteScoreBreakdown = z.infer<typeof RouteScoreBreakdownSchema>

const RouteCandidateBaseSchema = z
  .object({
    routeId: z.string().min(1).max(120),
    profile: RouteProfileSchema,
    nodes: z.array(RouteNodeSchema).min(2).max(6),
    legs: z.array(RouteLegSchema).min(3).max(7),
    staySegments: z.array(RouteStaySegmentSchema).min(2).max(6),
    score: RouteScoreBreakdownSchema,
    isRecommended: z.boolean(),
    materialDifferences: z.array(z.string().trim().min(1).max(500)).min(1).max(12),
    kunmingDecision: z
      .object({ included: z.boolean(), reason: z.string().trim().min(1).max(500) })
      .strict(),
    blockingReasons: z.array(z.string().trim().min(1).max(500)).max(20).default([])
  })
  .strict()
type RouteCandidateBase = z.infer<typeof RouteCandidateBaseSchema>

export const RouteCandidateSchema = RouteCandidateBaseSchema.superRefine(validateRouteCandidate)
export type RouteCandidate = z.infer<typeof RouteCandidateSchema>

export const RouteSourceOutcomeSchema = z
  .object({
    callId: z.string().min(1).max(120),
    sourceId: z.enum(['SRC_RAIL', 'SRC_MAP']),
    toolName: z.string().min(1).max(120),
    status: z.enum(['SUCCEEDED', 'EMPTY', 'FAILED', 'CANCELLED', 'SKIPPED']),
    claimIds: z.array(z.string().min(1)).max(20).default([]),
    errorCode: z.string().min(1).max(120).nullable(),
    capabilityImpact: z.string().trim().min(1).max(500).nullable(),
    manualAlternative: z.string().trim().min(1).max(500).nullable()
  })
  .strict()
export type RouteSourceOutcome = z.infer<typeof RouteSourceOutcomeSchema>

export const RoutePlannedCallSchema = z
  .object({
    callId: z.string().min(1).max(120),
    sequence: z.number().int().positive().max(24),
    sourceId: z.enum(['SRC_RAIL', 'SRC_MAP']),
    toolName: z.string().min(1).max(120),
    fromCity: z.string().trim().min(1).max(80),
    toCity: z.string().trim().min(1).max(80),
    travelDate: ItineraryDateSchema,
    timeoutMs: z.number().int().positive().max(120_000),
    retryCount: z.literal(0)
  })
  .strict()
export type RoutePlannedCall = z.infer<typeof RoutePlannedCallSchema>

export const RoutePlanPreviewSchema = z
  .object({
    sessionId: z.string().min(1),
    planId: z.string().uuid(),
    expiresAt: z.string().datetime(),
    digest: RouteDigestSchema,
    goal: ItineraryGoalSchema,
    topologySignatures: z.array(z.string().min(1).max(500)).min(2).max(8),
    plannedCalls: z.array(RoutePlannedCallSchema).max(24),
    totalExternalCalls: z.number().int().nonnegative().max(24),
    retryCount: z.literal(0)
  })
  .strict()
  .superRefine((preview, context) => {
    if (preview.totalExternalCalls !== preview.plannedCalls.length) {
      context.addIssue({ code: 'custom', message: 'route call count must match planned calls' })
    }
    if (preview.plannedCalls.some((call, index) => call.sequence !== index + 1)) {
      context.addIssue({ code: 'custom', message: 'route planned calls must be contiguous' })
    }
  })
export type RoutePlanPreview = z.infer<typeof RoutePlanPreviewSchema>

export const RoutePlanPreviewRequestSchema = z.object({ sessionId: z.string().min(1) }).strict()
export const RoutePlanExecuteRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    planId: z.string().uuid(),
    digest: RouteDigestSchema,
    operationId: RouteOperationIdSchema
  })
  .strict()
export type RoutePlanExecuteRequest = z.infer<typeof RoutePlanExecuteRequestSchema>
export const RouteSelectRequestSchema = z
  .object({ sessionId: z.string().min(1), routeId: z.string().min(1).max(120) })
  .strict()
export type RouteSelectRequest = z.infer<typeof RouteSelectRequestSchema>
export const ManualRouteLegEvidenceRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    routeId: z.string().min(1).max(120),
    legId: z.string().min(1).max(120),
    mode: z.enum(['MANUAL_FLIGHT', 'MANUAL_COACH']),
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
    label: z.string().trim().min(1).max(240),
    costCents: z.number().int().nonnegative().nullable().default(null),
    sourceLabel: z.string().trim().min(1).max(160),
    sourceUrl: ExternalSourceUrlSchema,
    summary: z.string().trim().min(1).max(500),
    confirmed: z.literal(true)
  })
  .strict()
  .superRefine((request, context) => {
    if (Date.parse(request.endAt) <= Date.parse(request.startAt)) {
      context.addIssue({
        code: 'custom',
        path: ['endAt'],
        message: 'manual route leg endAt must be after startAt'
      })
    }
  })
export type ManualRouteLegEvidenceRequest = z.infer<typeof ManualRouteLegEvidenceRequestSchema>
export const MultiCityRouteSnapshotRequestSchema = z
  .object({ sessionId: z.string().min(1) })
  .strict()
export const RouteCancelRequestSchema = z.object({ operationId: RouteOperationIdSchema }).strict()

export const MultiCityRouteSnapshotSchema = z
  .object({
    sessionId: z.string().min(1),
    stage: z.enum(['STAGE_1', 'STAGE_2', 'STAGE_3', 'STAGE_4', 'STAGE_5', 'DONE']),
    goal: ItineraryGoalSchema.nullable(),
    candidates: z.array(RouteCandidateSchema).max(3),
    selectedRouteId: z.string().min(1).max(120).nullable(),
    sourceOutcomes: z.array(RouteSourceOutcomeSchema).max(24),
    blockingReasons: z.array(z.string().trim().min(1).max(500)).max(20)
  })
  .strict()
export type MultiCityRouteSnapshot = z.infer<typeof MultiCityRouteSnapshotSchema>

export const RouteProgressEventSchema = z
  .object({
    operationId: RouteOperationIdSchema,
    sessionId: z.string().min(1),
    kind: z.enum(['STARTED', 'SOURCE_COMPLETED', 'COMPLETED']),
    completedCalls: z.number().int().nonnegative().max(24),
    totalCalls: z.number().int().nonnegative().max(24),
    message: z.string().trim().min(1).max(300)
  })
  .strict()
export type RouteProgressEvent = z.infer<typeof RouteProgressEventSchema>

export const RouteRejectedSummarySchema = z
  .object({
    routeId: z.string().min(1).max(120),
    profile: RouteProfileSchema,
    reason: z.string().trim().min(1).max(500)
  })
  .strict()

export const RouteCandidatesPreparedPayloadSchema = z
  .object({
    goal: ItineraryGoalSchema,
    candidates: z.array(RouteCandidateSchema).min(2).max(3),
    sourceOutcomes: z.array(RouteSourceOutcomeSchema).max(24),
    finalClaims: z.array(EvidenceClaimSchema).max(24).default([]),
    blockingReasons: z.array(z.string().trim().min(1).max(500)).max(20).default([])
  })
  .strict()
  .superRefine((payload, context) => {
    validateRouteCandidateSet(payload.goal, payload.candidates, payload.blockingReasons, context)
  })

export const RouteManualEvidenceAppliedPayloadSchema = z
  .object({
    goal: ItineraryGoalSchema,
    scope: RouteGoalLegEvidenceScopeSchema,
    claim: EvidenceClaimSchema,
    candidates: z.array(RouteCandidateSchema).min(2).max(3),
    blockingReasons: z.array(z.string().trim().min(1).max(500)).max(20).default([])
  })
  .strict()
  .superRefine((payload, context) => {
    validateRouteCandidateSet(payload.goal, payload.candidates, payload.blockingReasons, context)
    if (
      payload.claim.sourceId !== 'USER_RESEARCH' ||
      payload.claim.predicate !== 'routeLeg' ||
      payload.claim.verificationStatus !== 'VERIFIED_BY_USER' ||
      JSON.stringify(payload.claim.scope) !== JSON.stringify(payload.scope)
    ) {
      context.addIssue({ code: 'custom', message: 'manual route evidence claim contract mismatch' })
    }
  })

export const RouteSelectedPayloadSchema = z
  .object({
    fromStage: z.literal('STAGE_2'),
    toStage: z.literal('STAGE_3'),
    confirmed: z.literal(true),
    selectedRouteId: z.string().min(1).max(120),
    chosen: RouteCandidateSchema,
    rejected: z.array(RouteRejectedSummarySchema).min(1).max(2),
    reason: z.string().trim().min(1).max(500)
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.selectedRouteId !== payload.chosen.routeId) {
      context.addIssue({ code: 'custom', message: 'selected route must match chosen candidate' })
    }
    const rejected = new Set(payload.rejected.map((candidate) => candidate.routeId))
    if (rejected.size !== payload.rejected.length || rejected.has(payload.selectedRouteId)) {
      context.addIssue({ code: 'custom', message: 'rejected routes must be unique and not chosen' })
    }
  })

function validateRouteCandidate(candidate: RouteCandidateBase, context: z.RefinementCtx): void {
  const nodes = candidate.nodes
  const nodeIds = new Set(nodes.map((node) => node.nodeId))
  if (
    nodeIds.size !== nodes.length ||
    nodes.some((node, index) => node.sequence !== index + 1 || node.routeId !== candidate.routeId)
  ) {
    context.addIssue({ code: 'custom', message: 'route nodes must be unique and contiguous' })
  }
  if (candidate.legs.length !== nodes.length + 1) {
    context.addIssue({
      code: 'custom',
      message: 'route must connect origin through every node and back'
    })
  } else {
    candidate.legs.forEach((leg, index) => {
      const expectedFrom = index === 0 ? null : nodes[index - 1]?.nodeId
      const expectedTo = index === nodes.length ? null : nodes[index]?.nodeId
      const fromOk =
        expectedFrom === null
          ? leg.from.kind === 'ORIGIN'
          : leg.from.kind === 'NODE' && leg.from.nodeId === expectedFrom
      const toOk =
        expectedTo === null
          ? leg.to.kind === 'ORIGIN'
          : leg.to.kind === 'NODE' && leg.to.nodeId === expectedTo
      if (!fromOk || !toOk || leg.routeId !== candidate.routeId) {
        context.addIssue({ code: 'custom', message: 'route legs are not connected to node order' })
      }
    })
  }
  const stayNodeIds = new Set(
    nodes.filter((node) => node.nodeKind === 'STAY').map((node) => node.nodeId)
  )
  const segmentNodeIds = new Set(candidate.staySegments.map((segment) => segment.nodeId))
  if (
    segmentNodeIds.size !== candidate.staySegments.length ||
    segmentNodeIds.size !== stayNodeIds.size ||
    [...stayNodeIds].some((nodeId) => !segmentNodeIds.has(nodeId)) ||
    candidate.staySegments.some((segment) => segment.routeId !== candidate.routeId)
  ) {
    context.addIssue({ code: 'custom', message: 'stay segments must match stay nodes' })
  }
  if (
    candidate.isRecommended &&
    (!candidate.score.hardConstraintPass ||
      !candidate.score.criticalEvidenceComplete ||
      candidate.blockingReasons.length > 0)
  ) {
    context.addIssue({ code: 'custom', message: 'blocked route candidate cannot be recommended' })
  }
}

function validateRouteCandidateSet(
  goal: ItineraryGoal,
  candidates: RouteCandidate[],
  blockingReasons: string[],
  context: z.RefinementCtx
): void {
  const mandatory = new Set(goal.mandatoryPlaces.map((place) => place.placeId))
  const routeIds = new Set<string>()
  let recommended = 0
  for (const candidate of candidates) {
    if (routeIds.has(candidate.routeId)) {
      context.addIssue({ code: 'custom', message: 'route candidate IDs must be unique' })
    }
    routeIds.add(candidate.routeId)
    const covered = new Set(candidate.nodes.flatMap((node) => node.mandatoryPlaceIds))
    if ([...mandatory].some((placeId) => !covered.has(placeId))) {
      context.addIssue({ code: 'custom', message: 'route candidate misses a mandatory place' })
    }
    if (candidate.isRecommended) recommended += 1
  }
  if (recommended > 1 || (recommended === 0 && blockingReasons.length === 0)) {
    context.addIssue({ code: 'custom', message: 'route recommendation and gate state disagree' })
  }
}

function isUsableVerification(status: z.infer<typeof VerificationStatusSchema>): boolean {
  return status === 'VERIFIED' || status === 'CORROBORATED' || status === 'VERIFIED_BY_USER'
}

function daysBetween(start: string, end: string): number {
  const startMs = Date.parse(`${start}T00:00:00.000Z`)
  const endMs = Date.parse(`${end}T00:00:00.000Z`)
  return Math.floor((endMs - startMs) / 86_400_000)
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10)
}
