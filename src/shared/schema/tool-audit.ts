import { z } from 'zod'
import { ExternalSourceIdSchema } from './source'

export const ToolCallAuditSchema = z.object({
  callId: z.string().min(1),
  sessionId: z.string().min(1),
  toolName: z.string().min(1),
  sourceId: ExternalSourceIdSchema,
  argsDigest: z.string().min(1),
  durationMs: z.number().int().nonnegative(),
  ok: z.boolean(),
  errorCode: z.string().min(1).nullable(),
  createdAt: z.string().datetime()
})
export type ToolCallAudit = z.infer<typeof ToolCallAuditSchema>

export const BlockedToolAuditSchema = z.object({
  id: z.number().int().positive(),
  sourceId: z.string().min(1),
  toolName: z.string().min(1),
  reason: z.enum(['NOT_IN_ALLOWLIST', 'WRITE_KEYWORD_HIT']),
  createdAt: z.string().datetime()
})
export type BlockedToolAudit = z.infer<typeof BlockedToolAuditSchema>

export const ToolAuditListRequestSchema = z.object({
  sessionId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).default(100)
})
export type ToolAuditListRequest = z.infer<typeof ToolAuditListRequestSchema>
