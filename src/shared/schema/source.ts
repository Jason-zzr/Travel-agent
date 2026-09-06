import { z } from 'zod'
import { EvidenceClaimSchema } from './evidence'
import { SearchDisplayResultSchema, SearchStreamPayloadSchema } from './mcp/search'

export const ExternalSourceIdSchema = z.enum([
  'SRC_RAIL',
  'SRC_HOTEL',
  'SRC_MAP',
  'SRC_SEARCH',
  'SRC_XHS',
  'SRC_FLIGHT'
])
export type ExternalSourceId = z.infer<typeof ExternalSourceIdSchema>

export const SourceHealthStatusSchema = z.enum(['OK', 'DEGRADED', 'UNCONFIGURED'])
export type SourceHealthStatus = z.infer<typeof SourceHealthStatusSchema>

export const SourceHealthEntrySchema = z.object({
  sourceId: ExternalSourceIdSchema,
  status: SourceHealthStatusSchema,
  lastOkAt: z.string().datetime().nullable(),
  lastErrorCode: z.string().min(1).nullable(),
  failStreak: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
  capabilityImpact: z.string().min(1),
  manualAlternative: z.string().min(1)
})
export type SourceHealthEntry = z.infer<typeof SourceHealthEntrySchema>

export const SourceConfigSchema = z.object({
  version: z.literal(1),
  searchModel: z.string().trim().min(1).max(200).nullable().default(null)
})
export type SourceConfig = z.infer<typeof SourceConfigSchema>
export const SourceConfigSummarySchema = SourceConfigSchema
export type SourceConfigSummary = z.infer<typeof SourceConfigSummarySchema>

export const SourceProbeRequestSchema = z.object({ sourceId: ExternalSourceIdSchema })
export type SourceProbeRequest = z.infer<typeof SourceProbeRequestSchema>

export const ExternalSourceUrlSchema = z
  .string()
  .url()
  .max(1000)
  .superRefine((value, context) => {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      // `.url()` already reports the validation issue. Refinements must not
      // turn `safeParse()` into a throwing operation for non-URL source refs.
      return
    }
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

const RepresentativeBaseSchema = z.object({ sessionId: z.string().min(1) })
export const RepresentativeSourceQuerySchema = z.discriminatedUnion('sourceId', [
  RepresentativeBaseSchema.extend({
    sourceId: z.literal('SRC_RAIL'),
    input: z.object({}).strict()
  }),
  RepresentativeBaseSchema.extend({
    sourceId: z.literal('SRC_MAP'),
    input: z.object({
      address: z.string().trim().min(1).max(200),
      city: z.string().trim().min(1).max(80)
    })
  }),
  RepresentativeBaseSchema.extend({
    sourceId: z.literal('SRC_HOTEL'),
    input: z.object({
      place: z.string().trim().min(1).max(120),
      checkInDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      stayNights: z.number().int().min(1).max(28),
      adultCount: z.number().int().min(1).max(6)
    })
  }),
  RepresentativeBaseSchema.extend({
    sourceId: z.literal('SRC_SEARCH'),
    input: z.object({
      query: z.string().trim().min(1).max(4000)
    })
  })
])
export type RepresentativeSourceQuery = z.infer<typeof RepresentativeSourceQuerySchema>

export const SourceQueryOutcomeSchema = z.object({
  sourceId: ExternalSourceIdSchema,
  toolName: z.string().min(1),
  claims: z.array(EvidenceClaimSchema),
  fromCache: z.boolean().default(false),
  search: SearchDisplayResultSchema.optional()
})
export type SourceQueryOutcome = z.infer<typeof SourceQueryOutcomeSchema>

export const SourceStreamEventSchema = z
  .object({
    operationId: z.string().uuid(),
    sourceId: z.literal('SRC_SEARCH'),
    payload: SearchStreamPayloadSchema
  })
  .strict()
export type SourceStreamEvent = z.infer<typeof SourceStreamEventSchema>
