import { z } from 'zod'

export const JsonStructureTypeSchema = z.enum([
  'array',
  'boolean',
  'null',
  'number',
  'object',
  'string'
])

export const JsonStructureEntrySchema = z
  .object({
    path: z.string().min(1),
    type: JsonStructureTypeSchema,
    arrayLength: z.number().int().nonnegative().optional()
  })
  .strict()

export const JsonStructureSummarySchema = z
  .object({
    payloadKind: z.enum(['JSON', 'NON_JSON_TEXT']),
    entries: z.array(JsonStructureEntrySchema).max(256),
    truncated: z.boolean()
  })
  .strict()

export type JsonStructureType = z.infer<typeof JsonStructureTypeSchema>
export type JsonStructureEntry = z.infer<typeof JsonStructureEntrySchema>
export type JsonStructureSummary = z.infer<typeof JsonStructureSummarySchema>
