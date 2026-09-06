import { z } from 'zod'

export const EvidenceSourceIdSchema = z.enum([
  'SRC_RAIL',
  'SRC_HOTEL',
  'SRC_MAP',
  'SRC_SEARCH',
  'SRC_XHS',
  'USER_PASTE',
  'USER_RESEARCH'
])
export type EvidenceSourceId = z.infer<typeof EvidenceSourceIdSchema>

export const ContentIdentitySchema = z.enum([
  'OFFICIAL',
  'TRANSACTION',
  'INDEPENDENT_UGC',
  'COMMERCIAL_OFFER',
  'SUSPECTED_PROMOTION',
  'UNKNOWN'
])
export type ContentIdentity = z.infer<typeof ContentIdentitySchema>

export const VerificationStatusSchema = z.enum([
  'VERIFIED',
  'CORROBORATED',
  'ESTIMATED',
  'UNVERIFIED',
  'CONFLICTED',
  'STALE',
  'VERIFIED_BY_USER'
])
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>

export const RouteNodeEvidenceScopeSchema = z
  .object({
    kind: z.literal('ROUTE_NODE'),
    routeId: z.string().min(1).max(120),
    nodeId: z.string().min(1).max(120)
  })
  .strict()
export const RouteGoalLegEvidenceScopeSchema = z
  .object({
    kind: z.literal('ROUTE_GOAL_LEG'),
    fromCity: z.string().trim().min(1).max(80),
    toCity: z.string().trim().min(1).max(80),
    travelDate: z.string().date()
  })
  .strict()
export const EvidenceScopeSchema = z.discriminatedUnion('kind', [
  RouteNodeEvidenceScopeSchema,
  RouteGoalLegEvidenceScopeSchema
])
export type EvidenceScope = z.infer<typeof EvidenceScopeSchema>
export type RouteGoalLegEvidenceScope = z.infer<typeof RouteGoalLegEvidenceScopeSchema>

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(JsonValueSchema)
  ])
)

export const EvidenceClaimSchema = z
  .object({
    claimId: z.string().min(1),
    sessionId: z.string().min(1),
    subject: z.string().trim().min(1).max(300),
    predicate: z.string().trim().min(1).max(120),
    value: JsonValueSchema,
    sourceId: EvidenceSourceIdSchema,
    sourceRef: z.string().trim().min(1).max(1000),
    contentIdentity: ContentIdentitySchema,
    verificationStatus: VerificationStatusSchema,
    observedAt: z.string().datetime(),
    validUntil: z.string().datetime(),
    scope: EvidenceScopeSchema.nullable().optional(),
    confidence: z.number().min(0).max(1).nullable().default(null),
    conflictsWith: z.array(z.string().min(1)).default([]),
    notes: z.string().trim().max(1000).nullable().default(null)
  })
  .superRefine((claim, context) => {
    if (Date.parse(claim.validUntil) < Date.parse(claim.observedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['validUntil'],
        message: 'validUntil must not precede observedAt'
      })
    }
    if (
      /([?&](api[-_]?key|key|token|access[-_]?token|secret|signature|credential|authorization)=)|bearer\s/i.test(
        claim.sourceRef
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceRef'],
        message: 'sourceRef must not contain credentials'
      })
    }
  })
export type EvidenceClaim = z.infer<typeof EvidenceClaimSchema>

export const EvidenceListRequestSchema = z.object({
  sessionId: z.string().min(1),
  limit: z.number().int().min(1).max(200).default(100)
})
export type EvidenceListRequest = z.infer<typeof EvidenceListRequestSchema>
