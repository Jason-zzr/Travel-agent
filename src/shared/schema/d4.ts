import { z } from 'zod'
import {
  ContentIdentitySchema,
  EvidenceScopeSchema,
  JsonValueSchema,
  VerificationStatusSchema
} from './evidence'
import { ExternalSourceIdSchema } from './source'
import { XhsQueryKindSchema } from './mcp/xiaohongshu'

const D4OperationIdSchema = z.string().uuid()
const D4SourceIdSchema = z.enum(['SRC_SEARCH', 'SRC_MAP', 'SRC_XHS'])

export const RouteNodeResearchScopeSchema = z
  .object({
    sessionId: z.string().min(1),
    routeId: z.string().min(1).max(120),
    nodeId: z.string().min(1).max(120),
    city: z.string().trim().min(1).max(80),
    nodeKind: z.enum(['STAY', 'TRANSIT']),
    mandatoryPlaceIds: z.array(z.string().min(1).max(120)).max(12).default([])
  })
  .strict()
export type RouteNodeResearchScope = z.infer<typeof RouteNodeResearchScopeSchema>

export const RouteNodeResearchStatusSchema = z.enum([
  'NOT_STARTED',
  'REVIEW_REQUIRED',
  'BLOCKED',
  'CONFIRMED',
  'SKIPPED'
])
export type RouteNodeResearchStatus = z.infer<typeof RouteNodeResearchStatusSchema>

export const RouteNodeResearchModeSchema = z.enum(['STANDARD', 'XHS_STRICT'])
export type RouteNodeResearchMode = z.infer<typeof RouteNodeResearchModeSchema>

const RouteNodeIdentityRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    routeId: z.string().min(1).max(120),
    nodeId: z.string().min(1).max(120)
  })
  .strict()
export const SafeHttpsUrlSchema = z
  .string()
  .url()
  .max(1000)
  .superRefine((value, context) => {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) {
      context.addIssue({ code: 'custom', message: 'source URL must be credential-free HTTPS' })
    }
    for (const key of url.searchParams.keys()) {
      if (/api[-_]?key|key|token|secret|signature|credential|authorization/i.test(key)) {
        context.addIssue({ code: 'custom', message: 'source URL must not contain credentials' })
        break
      }
    }
  })

export const LeadDispositionSchema = z.enum(['MUST_GO', 'WANT', 'NEUTRAL', 'EXCLUDE'])
export type LeadDisposition = z.infer<typeof LeadDispositionSchema>

export const FitnessStatusSchema = z.enum(['FIT', 'RISK', 'UNKNOWN', 'EXCLUDED'])
export type FitnessStatus = z.infer<typeof FitnessStatusSchema>

export const FitnessAssessmentSchema = z.object({
  status: FitnessStatusSchema,
  reasons: z.array(z.string().trim().min(1).max(300)).max(12).default([])
})
export type FitnessAssessment = z.infer<typeof FitnessAssessmentSchema>

export const DestinationCandidateSchema = z.object({
  id: z.string().min(1),
  city: z.string().trim().min(1).max(80),
  fitReasons: z.array(z.string().trim().min(1).max(300)).min(1).max(8),
  tradeoffs: z.array(z.string().trim().min(1).max(300)).min(1).max(8),
  risks: z.array(z.string().trim().min(1).max(300)).max(8).default([]),
  claimIds: z.array(z.string().min(1)).min(1).max(20)
})
export type DestinationCandidate = z.infer<typeof DestinationCandidateSchema>

export const ResearchEntityKindSchema = z.enum(['ATTRACTION', 'EXPERIENCE', 'FOOD'])
export type ResearchEntityKind = z.infer<typeof ResearchEntityKindSchema>

export const ResearchIdentityStatusSchema = z.enum(['DETERMINISTIC', 'PROPOSED', 'AMBIGUOUS'])
export type ResearchIdentityStatus = z.infer<typeof ResearchIdentityStatusSchema>

export const ResearchEntitySchema = z.object({
  entityId: z.string().min(1),
  destinationCity: z.string().trim().min(1).max(80),
  canonicalSubject: z.string().trim().min(1).max(300),
  aliases: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
  kind: ResearchEntityKindSchema,
  claimIds: z.array(z.string().min(1)).min(1).max(100),
  identityStatus: ResearchIdentityStatusSchema,
  verificationStatus: VerificationStatusSchema,
  contentIdentities: z.array(ContentIdentitySchema).min(1),
  validUntil: z.string().datetime().nullable(),
  promotionOnlySupport: z.boolean().default(false),
  fitness: FitnessAssessmentSchema,
  disposition: LeadDispositionSchema.default('NEUTRAL'),
  blockingReasons: z.array(z.string().trim().min(1).max(400)).max(20).default([]),
  unresolvedConflictClaimIds: z.array(z.string().min(1)).max(40).default([]),
  scope: EvidenceScopeSchema.nullable().optional()
})
export type ResearchEntity = z.infer<typeof ResearchEntitySchema>

export const ManualResearchHardAnchorKindSchema = z.enum([
  'OPENING_HOURS',
  'CLOSURE_SCHEDULE',
  'RESERVATION_REQUIREMENT'
])
export type ManualResearchHardAnchorKind = z.infer<typeof ManualResearchHardAnchorKindSchema>

export const ManualResearchHardAnchorStatusSchema = z.enum(['KNOWN', 'UNKNOWN', 'NOT_APPLICABLE'])
export type ManualResearchHardAnchorStatus = z.infer<typeof ManualResearchHardAnchorStatusSchema>

export const ManualResearchHardAnchorSchema = z
  .object({
    kind: ManualResearchHardAnchorKindSchema,
    status: ManualResearchHardAnchorStatusSchema,
    value: z.string().trim().min(1).max(1000).nullable(),
    checkedAt: z.string().datetime(),
    confirmed: z.literal(true)
  })
  .strict()
  .superRefine((anchor, context) => {
    if (anchor.status === 'KNOWN' && anchor.value === null) {
      context.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'known hard anchor requires a value'
      })
    }
    if (anchor.status !== 'KNOWN' && anchor.value !== null) {
      context.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'unknown hard anchor cannot carry a value'
      })
    }
  })
export type ManualResearchHardAnchor = z.infer<typeof ManualResearchHardAnchorSchema>

export const ManualResearchContentIdentitySchema = z.enum([
  'OFFICIAL',
  'INDEPENDENT_UGC',
  'COMMERCIAL_OFFER',
  'SUSPECTED_PROMOTION',
  'UNKNOWN'
])
export type ManualResearchContentIdentity = z.infer<typeof ManualResearchContentIdentitySchema>

export const ManualResearchItemSchema = z
  .object({
    itemId: z.string().uuid(),
    subject: z.string().trim().min(1).max(300),
    kind: ResearchEntityKindSchema,
    aliases: z.array(z.string().trim().min(1).max(300)).max(12).default([]),
    disposition: LeadDispositionSchema,
    sourceLabel: z.string().trim().min(1).max(200),
    sourceUrl: SafeHttpsUrlSchema.nullable().default(null),
    sourceClaimId: z.string().min(1).nullable().default(null),
    contentIdentity: ManualResearchContentIdentitySchema,
    summary: z.string().trim().min(1).max(4000),
    fitness: FitnessAssessmentSchema,
    hardAnchors: z.array(ManualResearchHardAnchorSchema).max(3).default([]),
    confirmed: z.literal(true)
  })
  .strict()
  .superRefine((item, context) => {
    const uniqueKinds = new Set(item.hardAnchors.map((anchor) => anchor.kind))
    if (uniqueKinds.size !== item.hardAnchors.length) {
      context.addIssue({
        code: 'custom',
        path: ['hardAnchors'],
        message: 'hard anchor kinds must be unique'
      })
    }
    if (
      item.disposition === 'MUST_GO' &&
      (item.hardAnchors.length !== 3 || uniqueKinds.size !== 3)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['hardAnchors'],
        message: 'MUST_GO requires all three independently confirmed hard anchors'
      })
    }
  })
export type ManualResearchItem = z.infer<typeof ManualResearchItemSchema>

export const ManualResearchChecklistRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    items: z.array(ManualResearchItemSchema).min(1).max(30)
  })
  .strict()
  .superRefine((request, context) => {
    if (!request.items.some((item) => item.disposition !== 'EXCLUDE')) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'manual checklist requires at least one non-excluded item'
      })
    }
    const itemIds = new Set<string>()
    const identities = new Set<string>()
    for (const [index, item] of request.items.entries()) {
      if (itemIds.has(item.itemId)) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'itemId'],
          message: 'manual item id must be unique'
        })
      }
      itemIds.add(item.itemId)
      const identity = `${item.kind}\n${item.subject.normalize('NFKC').trim().toLowerCase()}`
      if (identities.has(identity)) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'subject'],
          message: 'manual item subject and kind must be unique'
        })
      }
      identities.add(identity)
    }
  })
export type ManualResearchChecklistRequest = z.infer<typeof ManualResearchChecklistRequestSchema>

export const ManualResearchSummarySchema = z
  .object({
    mode: z.literal('USER_CONFIRMED'),
    itemCount: z.number().int().min(1).max(30),
    linkedPasteCount: z.number().int().min(0).max(30),
    confirmedAt: z.string().datetime(),
    scope: EvidenceScopeSchema.nullable().optional()
  })
  .strict()
export type ManualResearchSummary = z.infer<typeof ManualResearchSummarySchema>

export const ConflictResolutionSchema = z
  .object({
    subject: z.string().trim().min(1).max(300),
    predicate: z.string().trim().min(1).max(120),
    resolution: z.enum(['CLAIM_SELECTED', 'UNKNOWN']),
    selectedClaimId: z.string().min(1).nullable(),
    resolvedAt: z.string().datetime(),
    scope: EvidenceScopeSchema.nullable().optional()
  })
  .superRefine((value, context) => {
    if (value.resolution === 'CLAIM_SELECTED' && value.selectedClaimId === null) {
      context.addIssue({
        code: 'custom',
        path: ['selectedClaimId'],
        message: 'selected claim required'
      })
    }
    if (value.resolution === 'UNKNOWN' && value.selectedClaimId !== null) {
      context.addIssue({
        code: 'custom',
        path: ['selectedClaimId'],
        message: 'unknown cannot select claim'
      })
    }
  })
export type ConflictResolution = z.infer<typeof ConflictResolutionSchema>

export const SourceResearchFailureSchema = z.object({
  sourceId: ExternalSourceIdSchema,
  status: z.literal('FAILED'),
  queryKind: XhsQueryKindSchema.optional(),
  errorCode: z.string().min(1),
  capabilityImpact: z.string().min(1),
  manualAlternative: z.string().min(1),
  scope: EvidenceScopeSchema.nullable().optional()
})
export type SourceResearchFailure = z.infer<typeof SourceResearchFailureSchema>

const MinimalMemberConstraintSchema = z.object({
  ageBand: z.enum(['CHILD', 'ADULT', 'OLDER_ADULT']),
  count: z.number().int().positive(),
  stamina: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  functionalLimits: z.array(z.string().trim().min(1).max(80)).max(10).default([])
})

export const SourceSubagentTaskSchema = z.discriminatedUnion('sourceId', [
  z
    .object({
      taskId: z.string().uuid(),
      sessionId: z.string().min(1),
      sourceId: z.literal('SRC_SEARCH'),
      destination: z.string().trim().min(1).max(80),
      query: z.string().trim().min(1).max(4000),
      toolName: z.literal('deepseek_web_search'),
      memberConstraints: z.array(MinimalMemberConstraintSchema).max(10).default([]),
      scope: EvidenceScopeSchema.nullable().optional()
    })
    .strict(),
  z
    .object({
      taskId: z.string().uuid(),
      sessionId: z.string().min(1),
      sourceId: z.literal('SRC_MAP'),
      destination: z.string().trim().min(1).max(80),
      query: z.string().trim().min(1).max(200),
      toolName: z.literal('maps_geo'),
      memberConstraints: z.array(MinimalMemberConstraintSchema).max(10).default([]),
      scope: EvidenceScopeSchema.nullable().optional()
    })
    .strict(),
  z
    .object({
      taskId: z.string().uuid(),
      sessionId: z.string().min(1),
      sourceId: z.literal('SRC_XHS'),
      destination: z.string().trim().min(1).max(80),
      query: z.string().trim().min(1).max(4000),
      queryKind: XhsQueryKindSchema,
      toolName: z.literal('search_feeds'),
      memberConstraints: z.array(MinimalMemberConstraintSchema).max(10).default([]),
      scope: EvidenceScopeSchema.nullable().optional()
    })
    .strict()
])
export type SourceSubagentTask = z.infer<typeof SourceSubagentTaskSchema>

export const SourceSubagentResultSchema = z.discriminatedUnion('status', [
  z.object({
    taskId: z.string().uuid(),
    sourceId: D4SourceIdSchema,
    status: z.literal('SUCCEEDED'),
    queryKind: XhsQueryKindSchema.optional(),
    claimIds: z.array(z.string().min(1)).min(1),
    scope: EvidenceScopeSchema.nullable().optional()
  }),
  z.object({
    taskId: z.string().uuid(),
    sourceId: D4SourceIdSchema,
    status: z.literal('FAILED'),
    queryKind: XhsQueryKindSchema.optional(),
    claimIds: z.array(z.never()).max(0).default([]),
    errorCode: z.string().min(1),
    capabilityImpact: z.string().min(1),
    manualAlternative: z.string().min(1),
    scope: EvidenceScopeSchema.nullable().optional()
  })
])
export type SourceSubagentResult = z.infer<typeof SourceSubagentResultSchema>

export const ResearchFactDraftSchema = z.object({
  sourceClaimId: z.string().min(1),
  destinationCity: z.string().trim().min(1).max(80),
  subject: z.string().trim().min(1).max(300),
  predicate: z.string().trim().min(1).max(120),
  value: JsonValueSchema,
  kind: ResearchEntityKindSchema,
  aliases: z.array(z.string().trim().min(1).max(300)).max(12).default([])
})
export type ResearchFactDraft = z.infer<typeof ResearchFactDraftSchema>

export const ResearchExtractionSchema = z.object({
  facts: z.array(ResearchFactDraftSchema).max(80)
})
export type ResearchExtraction = z.infer<typeof ResearchExtractionSchema>

export const XhsRankingSampleGroupSchema = z.enum(['RECOMMEND', 'AVOID'])
export type XhsRankingSampleGroup = z.infer<typeof XhsRankingSampleGroupSchema>

export const XhsAttractionStanceSchema = z.enum(['RECOMMEND', 'AVOID', 'MIXED', 'NEUTRAL'])
export type XhsAttractionStance = z.infer<typeof XhsAttractionStanceSchema>

export const XhsAttractionSignalSchema = z
  .object({
    destinationCity: z.string().trim().min(1).max(80),
    subject: z.string().trim().min(1).max(300),
    aliases: z.array(z.string().trim().min(1).max(300)).max(12).default([]),
    kind: ResearchEntityKindSchema,
    stance: XhsAttractionStanceSchema,
    recommendationReasons: z.array(z.string().trim().min(1).max(300)).max(6).default([]),
    avoidanceReasons: z.array(z.string().trim().min(1).max(300)).max(6).default([]),
    familyFit: z.enum(['FIT', 'UNKNOWN', 'RISK']),
    familyFitReasons: z.array(z.string().trim().min(1).max(300)).max(6).default([]),
    identityStatus: z.enum(['DETERMINISTIC', 'AMBIGUOUS']),
    promotionOnlySupport: z.boolean()
  })
  .strict()
export type XhsAttractionSignal = z.infer<typeof XhsAttractionSignalSchema>

export const XhsPostExtractionSchema = z
  .object({
    sourceClaimId: z.string().min(1),
    signals: z.array(XhsAttractionSignalSchema).max(3)
  })
  .strict()
export const XhsExtractionBatchSchema = z
  .object({ posts: z.array(XhsPostExtractionSchema).length(5) })
  .strict()
export type XhsExtractionBatch = z.infer<typeof XhsExtractionBatchSchema>

export const XhsSampleSummarySchema = z
  .object({
    destinationCity: z.string().trim().min(1).max(80),
    recommendPostCount: z.literal(15),
    avoidPostCount: z.literal(15),
    searchCalls: z.literal(4),
    detailCalls: z.literal(30),
    detailCharacterLimit: z.literal(4000),
    extractionCalls: z.literal(6),
    reviewCalls: z.literal(1),
    retryCount: z.literal(0),
    loadAllComments: z.literal(false),
    scope: EvidenceScopeSchema.nullable().optional()
  })
  .strict()
export type XhsSampleSummary = z.infer<typeof XhsSampleSummarySchema>

export const AttractionRankingEvidenceSchema = z
  .object({
    claimId: z.string().min(1),
    sourceRef: SafeHttpsUrlSchema,
    reason: z.string().trim().min(1).max(300)
  })
  .strict()

export const AttractionRankingSchema = z
  .object({
    rank: z.number().int().positive(),
    entityId: z.string().min(1),
    subject: z.string().trim().min(1).max(300),
    score: z.number().int(),
    recommendPostCount: z.number().int().nonnegative(),
    avoidPostCount: z.number().int().nonnegative(),
    familyFit: z.enum(['FIT', 'UNKNOWN', 'RISK']),
    familyFitAdjustment: z.union([z.literal(2), z.literal(0), z.literal(-3)]),
    familyFitReasons: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
    recommendationEvidence: z.array(AttractionRankingEvidenceSchema).max(30).default([]),
    avoidanceEvidence: z.array(AttractionRankingEvidenceSchema).max(30).default([]),
    claimIds: z.array(z.string().min(1)).min(1).max(60),
    verificationStatus: z.literal('UNVERIFIED'),
    scope: EvidenceScopeSchema.nullable().optional()
  })
  .strict()
export type AttractionRanking = z.infer<typeof AttractionRankingSchema>

const XhsRankingFiltersSchema = z
  .object({
    sort_by: z.literal('综合'),
    note_type: z.literal('图文'),
    publish_time: z.literal('半年内'),
    search_scope: z.literal('不限'),
    location: z.literal('不限')
  })
  .strict()

const XhsRankingRouteSchema = z
  .object({ provider: z.string().min(1), model: z.string().min(1) })
  .strict()

export const XhsRankingPreviewSchema = z
  .object({
    sessionId: z.string().min(1),
    planId: z.string().uuid(),
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    expiresAt: z.string().datetime(),
    destinationCity: z.string().trim().min(1).max(80),
    queries: z.array(z.string().trim().min(1).max(4000)).length(4),
    filters: XhsRankingFiltersSchema,
    recommendSampleSize: z.literal(15),
    avoidSampleSize: z.literal(15),
    searchCalls: z.literal(4),
    detailCalls: z.literal(30),
    detailCharacterLimit: z.literal(4000),
    extractionCalls: z.literal(6),
    reviewCalls: z.literal(1),
    retryCount: z.literal(0),
    loadAllComments: z.literal(false),
    extractionRoute: XhsRankingRouteSchema,
    reviewRoute: XhsRankingRouteSchema
  })
  .strict()
export type XhsRankingPreview = z.infer<typeof XhsRankingPreviewSchema>

export const XhsRankingPreviewRequestSchema = z.object({ sessionId: z.string().min(1) }).strict()
export const XhsRankingExecuteRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    planId: z.string().uuid(),
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    operationId: D4OperationIdSchema
  })
  .strict()
export type XhsRankingExecuteRequest = z.infer<typeof XhsRankingExecuteRequestSchema>

export const RouteNodeResearchStateSchema = z
  .object({
    scope: RouteNodeResearchScopeSchema,
    sequence: z.number().int().positive().max(8),
    required: z.boolean(),
    status: RouteNodeResearchStatusSchema,
    skipReason: z.string().trim().min(1).max(500).nullable().default(null),
    researchEntities: z.array(ResearchEntitySchema).default([]),
    researchChecklistConfirmed: z.boolean().default(false),
    conflictResolutions: z.array(ConflictResolutionSchema).default([]),
    sourceResearchFailures: z.array(SourceResearchFailureSchema).default([]),
    xhsSampleSummary: XhsSampleSummarySchema.nullable().default(null),
    manualResearchSummary: ManualResearchSummarySchema.nullable().default(null),
    attractionRankings: z.array(AttractionRankingSchema).default([]),
    blockingReasons: z.array(z.string().trim().min(1).max(500)).max(40).default([]),
    confirmedAt: z.string().datetime().nullable().default(null)
  })
  .strict()
  .superRefine((state, context) => {
    if (state.status === 'SKIPPED' && (state.required || state.skipReason === null)) {
      context.addIssue({
        code: 'custom',
        message: 'only optional nodes may be skipped with reason'
      })
    }
    if (state.status !== 'SKIPPED' && state.skipReason !== null) {
      context.addIssue({ code: 'custom', message: 'skip reason is only valid for skipped nodes' })
    }
    if ((state.status === 'CONFIRMED') !== (state.confirmedAt !== null)) {
      context.addIssue({ code: 'custom', message: 'confirmed status requires confirmedAt' })
    }
    const expectedScope = {
      kind: 'ROUTE_NODE',
      routeId: state.scope.routeId,
      nodeId: state.scope.nodeId
    }
    const nestedScopes = [
      ...state.researchEntities.map((item) => item.scope),
      ...state.conflictResolutions.map((item) => item.scope),
      ...state.sourceResearchFailures.map((item) => item.scope),
      ...state.attractionRankings.map((item) => item.scope),
      state.xhsSampleSummary?.scope,
      state.manualResearchSummary?.scope
    ].filter((scope): scope is NonNullable<typeof scope> => scope !== null && scope !== undefined)
    if (
      nestedScopes.length !==
        state.researchEntities.length +
          state.conflictResolutions.length +
          state.sourceResearchFailures.length +
          state.attractionRankings.length +
          Number(state.xhsSampleSummary !== null) +
          Number(state.manualResearchSummary !== null) ||
      nestedScopes.some(
        (scope) =>
          scope.kind !== expectedScope.kind ||
          (scope.kind === 'ROUTE_NODE' &&
            (scope.routeId !== expectedScope.routeId || scope.nodeId !== expectedScope.nodeId))
      )
    ) {
      context.addIssue({ code: 'custom', message: 'node research details require exact scope' })
    }
  })
export type RouteNodeResearchState = z.infer<typeof RouteNodeResearchStateSchema>

export const RouteNodeResearchSummarySchema = z
  .object({
    scope: RouteNodeResearchScopeSchema,
    sequence: z.number().int().positive().max(8),
    required: z.boolean(),
    status: RouteNodeResearchStatusSchema,
    blockerCount: z.number().int().nonnegative().max(40),
    entityCount: z.number().int().nonnegative().max(200),
    confirmedAt: z.string().datetime().nullable(),
    skipReason: z.string().trim().min(1).max(500).nullable()
  })
  .strict()
export type RouteNodeResearchSummary = z.infer<typeof RouteNodeResearchSummarySchema>

const NodeResearchSourcePlanItemSchema = z
  .object({
    sequence: z.number().int().positive().max(40),
    sourceId: D4SourceIdSchema,
    toolName: z.string().trim().min(1).max(120),
    query: z.string().trim().min(1).max(4000),
    queryKind: XhsQueryKindSchema.nullable().default(null),
    callCount: z.number().int().positive().max(30)
  })
  .strict()

const NodeResearchModelPlanItemSchema = z
  .object({
    sequence: z.number().int().positive().max(8),
    role: z.enum(['EXTRACTION', 'REVIEW']),
    provider: z.string().trim().min(1).max(120),
    model: z.string().trim().min(1).max(240),
    callCount: z.number().int().positive().max(6),
    repairInvalid: z.boolean()
  })
  .strict()

export const NodeResearchPlanPreviewSchema = z
  .object({
    sessionId: z.string().min(1),
    routeId: z.string().min(1).max(120),
    nodeId: z.string().min(1).max(120),
    scope: RouteNodeResearchScopeSchema,
    mode: RouteNodeResearchModeSchema,
    planId: z.string().uuid(),
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    expiresAt: z.string().datetime(),
    sourcePlan: z.array(NodeResearchSourcePlanItemSchema).max(8),
    modelPlan: z.array(NodeResearchModelPlanItemSchema).max(8),
    totalExternalCalls: z.number().int().nonnegative().max(34),
    totalModelCalls: z.number().int().nonnegative().max(7),
    timeoutMs: z.literal(60_000),
    retryCount: z.literal(0)
  })
  .strict()
  .superRefine((preview, context) => {
    if (
      preview.scope.sessionId !== preview.sessionId ||
      preview.scope.routeId !== preview.routeId ||
      preview.scope.nodeId !== preview.nodeId
    ) {
      context.addIssue({ code: 'custom', message: 'preview identities must match scope' })
    }
    if (
      preview.sourcePlan.reduce((sum, item) => sum + item.callCount, 0) !==
        preview.totalExternalCalls ||
      preview.modelPlan.reduce((sum, item) => sum + item.callCount, 0) !== preview.totalModelCalls
    ) {
      context.addIssue({ code: 'custom', message: 'preview call totals must match frozen plan' })
    }
  })
export type NodeResearchPlanPreview = z.infer<typeof NodeResearchPlanPreviewSchema>

export const RouteNodeD4SnapshotSchema = z
  .object({
    sessionId: z.string().min(1),
    stage: z.enum(['STAGE_1', 'STAGE_2', 'STAGE_3', 'STAGE_4', 'STAGE_5', 'DONE']),
    selectedRouteId: z.string().min(1).max(120),
    nodeSummaries: z.array(RouteNodeResearchSummarySchema).min(1).max(8),
    currentScope: RouteNodeResearchScopeSchema,
    currentNode: RouteNodeResearchStateSchema,
    routeResearchComplete: z.boolean(),
    nextRequiredNodeId: z.string().min(1).max(120).nullable()
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (
      snapshot.currentScope.sessionId !== snapshot.sessionId ||
      snapshot.currentScope.routeId !== snapshot.selectedRouteId ||
      snapshot.currentNode.scope.routeId !== snapshot.selectedRouteId ||
      snapshot.currentNode.scope.nodeId !== snapshot.currentScope.nodeId
    ) {
      context.addIssue({ code: 'custom', message: 'snapshot identities must match current node' })
    }
  })
export type RouteNodeD4Snapshot = z.infer<typeof RouteNodeD4SnapshotSchema>

export const RouteResearchSnapshotRequestSchema = RouteNodeIdentityRequestSchema
export const RouteResearchPreviewRequestSchema = RouteNodeIdentityRequestSchema.extend({
  mode: RouteNodeResearchModeSchema
}).strict()
export const RouteResearchExecuteRequestSchema = RouteNodeIdentityRequestSchema.extend({
  planId: z.string().uuid(),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  operationId: D4OperationIdSchema
}).strict()
export const RouteResearchManualRequestSchema = RouteNodeIdentityRequestSchema.extend({
  items: z.array(ManualResearchItemSchema).min(1).max(30)
}).strict()
export const RouteResearchUserPasteRequestSchema = RouteNodeIdentityRequestSchema.extend({
  text: z.string().trim().min(1).max(20_000),
  sourceUrl: SafeHttpsUrlSchema.nullable().default(null)
}).strict()
export const RouteResearchDispositionRequestSchema = RouteNodeIdentityRequestSchema.extend({
  entityId: z.string().min(1),
  disposition: LeadDispositionSchema
}).strict()
export const RouteResearchConflictRequestSchema = RouteNodeIdentityRequestSchema.extend({
  subject: z.string().trim().min(1).max(300),
  predicate: z.string().trim().min(1).max(120),
  resolution: z.enum(['CLAIM_SELECTED', 'UNKNOWN']),
  selectedClaimId: z.string().min(1).nullable()
})
  .strict()
  .superRefine((value, context) => {
    if ((value.resolution === 'CLAIM_SELECTED') !== (value.selectedClaimId !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['selectedClaimId'],
        message: 'resolution mismatch'
      })
    }
  })
export const RouteResearchConfirmRequestSchema = RouteNodeIdentityRequestSchema
export const RouteResearchCancelRequestSchema = z
  .object({ operationId: D4OperationIdSchema })
  .strict()

export type RouteResearchSnapshotRequest = z.infer<typeof RouteResearchSnapshotRequestSchema>
export type RouteResearchPreviewRequest = z.infer<typeof RouteResearchPreviewRequestSchema>
export type RouteResearchExecuteRequest = z.infer<typeof RouteResearchExecuteRequestSchema>
export type RouteResearchManualRequest = z.infer<typeof RouteResearchManualRequestSchema>
export type RouteResearchUserPasteRequest = z.infer<typeof RouteResearchUserPasteRequestSchema>
export type RouteResearchDispositionRequest = z.infer<typeof RouteResearchDispositionRequestSchema>
export type RouteResearchConflictRequest = z.infer<typeof RouteResearchConflictRequestSchema>
export type RouteResearchConfirmRequest = z.infer<typeof RouteResearchConfirmRequestSchema>

export const RouteResearchProgressEventSchema = z
  .object({
    operationId: D4OperationIdSchema,
    sessionId: z.string().min(1),
    routeId: z.string().min(1).max(120),
    nodeId: z.string().min(1).max(120),
    kind: z.enum([
      'RESEARCH_STARTED',
      'SOURCE_COMPLETED',
      'XHS_SEARCH_COMPLETED',
      'XHS_DETAIL_COMPLETED',
      'XHS_EXTRACTION_COMPLETED',
      'XHS_REVIEW_COMPLETED',
      'COMPLETED'
    ]),
    sourceId: D4SourceIdSchema.nullable().default(null),
    message: z.string().trim().min(1).max(300)
  })
  .strict()
export type RouteResearchProgressEvent = z.infer<typeof RouteResearchProgressEventSchema>

export const D4SnapshotSchema = z.object({
  sessionId: z.string().min(1),
  stage: z.enum(['STAGE_1', 'STAGE_2', 'STAGE_3', 'STAGE_4', 'STAGE_5', 'DONE']),
  fixedDestinationCity: z.string().trim().min(1).max(80).nullable().optional(),
  destinationCandidates: z.array(DestinationCandidateSchema),
  selectedDestinationCandidateId: z.string().min(1).nullable(),
  researchEntities: z.array(ResearchEntitySchema),
  researchChecklistConfirmed: z.boolean(),
  conflictResolutions: z.array(ConflictResolutionSchema),
  sourceResearchFailures: z.array(SourceResearchFailureSchema),
  xhsSampleSummary: XhsSampleSummarySchema.nullable().optional(),
  manualResearchSummary: ManualResearchSummarySchema.nullable().optional(),
  attractionRankings: z.array(AttractionRankingSchema).optional()
})
export type D4Snapshot = z.infer<typeof D4SnapshotSchema>

export const DestinationGenerateRequestSchema = z
  .object({ sessionId: z.string().min(1), operationId: D4OperationIdSchema })
  .strict()
export const FixedDestinationConfirmRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    city: z.string().trim().min(1).max(80)
  })
  .strict()
export const DestinationSelectRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    candidateId: z.string().min(1)
  })
  .strict()
export const ResearchPrepareRequestSchema = z
  .object({ sessionId: z.string().min(1), operationId: D4OperationIdSchema })
  .strict()
export const UserPasteRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    text: z.string().trim().min(1).max(20_000),
    sourceUrl: SafeHttpsUrlSchema.nullable().default(null)
  })
  .strict()
export const ResearchDispositionRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    entityId: z.string().min(1),
    disposition: LeadDispositionSchema
  })
  .strict()
export const ConflictResolveRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    subject: z.string().trim().min(1).max(300),
    predicate: z.string().trim().min(1).max(120),
    resolution: z.enum(['CLAIM_SELECTED', 'UNKNOWN']),
    selectedClaimId: z.string().min(1).nullable()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.resolution === 'CLAIM_SELECTED' && value.selectedClaimId === null) {
      context.addIssue({
        code: 'custom',
        path: ['selectedClaimId'],
        message: 'selected claim required'
      })
    }
    if (value.resolution === 'UNKNOWN' && value.selectedClaimId !== null) {
      context.addIssue({
        code: 'custom',
        path: ['selectedClaimId'],
        message: 'unknown cannot select claim'
      })
    }
  })
export const ResearchConfirmRequestSchema = z.object({ sessionId: z.string().min(1) }).strict()
export const D4SnapshotRequestSchema = z.object({ sessionId: z.string().min(1) }).strict()

export type DestinationGenerateRequest = z.infer<typeof DestinationGenerateRequestSchema>
export type FixedDestinationConfirmRequest = z.infer<typeof FixedDestinationConfirmRequestSchema>
export type DestinationSelectRequest = z.infer<typeof DestinationSelectRequestSchema>
export type ResearchPrepareRequest = z.infer<typeof ResearchPrepareRequestSchema>
export type UserPasteRequest = z.infer<typeof UserPasteRequestSchema>
export type ResearchDispositionRequest = z.infer<typeof ResearchDispositionRequestSchema>
export type ConflictResolveRequest = z.infer<typeof ConflictResolveRequestSchema>
export type ResearchConfirmRequest = z.infer<typeof ResearchConfirmRequestSchema>

export const D4ProgressEventSchema = z
  .object({
    operationId: D4OperationIdSchema,
    sessionId: z.string().min(1),
    kind: z.enum([
      'DESTINATION_STARTED',
      'RESEARCH_STARTED',
      'SOURCE_COMPLETED',
      'XHS_SEARCH_COMPLETED',
      'XHS_DETAIL_COMPLETED',
      'XHS_EXTRACTION_COMPLETED',
      'XHS_REVIEW_COMPLETED',
      'COMPLETED'
    ]),
    sourceId: D4SourceIdSchema.nullable().default(null),
    message: z.string().trim().min(1).max(300)
  })
  .strict()
export type D4ProgressEvent = z.infer<typeof D4ProgressEventSchema>
