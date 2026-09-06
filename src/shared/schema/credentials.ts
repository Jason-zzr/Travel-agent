import { z } from 'zod'

export const CredentialIdSchema = z.enum([
  'AMAP',
  'ROLLINGGO',
  'OPENAI',
  'DEEPSEEK',
  'GEMINI',
  'SHUAI_API',
  'BRAVE_SEARCH',
  'SERPER_SEARCH',
  'XIAOHONGSHU_MCP_AUTH',
  'FLYAI'
])
export type CredentialId = z.infer<typeof CredentialIdSchema>

export const CredentialStatusSchema = z.enum(['CONFIGURED', 'UNCONFIGURED', 'REENTRY_REQUIRED'])
export type CredentialStatus = z.infer<typeof CredentialStatusSchema>

export const CredentialStatusEntrySchema = z.object({
  id: CredentialIdSchema,
  status: CredentialStatusSchema
})
export type CredentialStatusEntry = z.infer<typeof CredentialStatusEntrySchema>

export const CredentialFileSchema = z.object({
  version: z.literal(1),
  entries: z.record(CredentialIdSchema, z.string().min(1)).default({}),
  reentryRequired: z.array(CredentialIdSchema).default([])
})
export type CredentialFile = z.infer<typeof CredentialFileSchema>
