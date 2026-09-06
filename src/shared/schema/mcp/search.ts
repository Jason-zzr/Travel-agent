import { z } from 'zod'

export const HttpsSearchUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => {
      const url = new URL(value)
      return url.protocol === 'https:' && !url.username && !url.password
    },
    { message: 'Only HTTPS search sources without userinfo are accepted.' }
  )

export const SearchSourceSchema = z
  .object({
    url: HttpsSearchUrlSchema,
    title: z.string().trim().min(1),
    snippet: z.string()
  })
  .strict()
export type SearchSource = z.infer<typeof SearchSourceSchema>

const DeepSeekTokenUsageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    cached_input_tokens: z.number().int().nonnegative(),
    reasoning_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative()
  })
  .strict()

const DeepSeekSearchAuditSchema = z
  .object({
    search_api_calls: z.literal(1),
    search_result_count: z.number().int().positive(),
    grounding_characters: z.number().int().nonnegative(),
    native_web_search_calls: z.literal(0),
    native_open_page_calls: z.literal(0),
    open_page_tokens: z.literal(0)
  })
  .strict()

const DeepSeekSearchErrorCodeSchema = z.enum([
  'CONFIGURATION',
  'INVALID_INPUT',
  'UNAUTHORIZED',
  'RATE_LIMITED',
  'TIMEOUT',
  'UPSTREAM_UNAVAILABLE',
  'MISSING_ANSWER',
  'MISSING_CITATIONS',
  'INVALID_RESPONSE',
  'UNKNOWN_PROVIDER_ERROR'
])

export const DeepSeekSearchSuccessSchema = z
  .object({
    ok: z.literal(true),
    answer: z.string().trim().min(1),
    model: z.literal('deepseek-v4-flash'),
    search_provider: z.literal('serper-search'),
    sources: z.array(SearchSourceSchema).min(1),
    usage: DeepSeekTokenUsageSchema,
    audit: DeepSeekSearchAuditSchema,
    error_code: z.null(),
    message: z.null()
  })
  .strict()

export const DeepSeekSearchFailureSchema = z
  .object({
    ok: z.literal(false),
    answer: z.null(),
    model: z.string().min(1),
    search_provider: z.literal('serper-search'),
    sources: z.array(SearchSourceSchema).max(0),
    usage: z.null(),
    audit: z.null(),
    error_code: DeepSeekSearchErrorCodeSchema,
    message: z.string().min(1)
  })
  .strict()

export const DeepSeekSearchResultSchema = z.discriminatedUnion('ok', [
  DeepSeekSearchSuccessSchema,
  DeepSeekSearchFailureSchema
])
export type DeepSeekSearchResult = z.infer<typeof DeepSeekSearchResultSchema>

export const SearchUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative()
  })
  .strict()
export type SearchUsage = z.infer<typeof SearchUsageSchema>

export const SearchAuditSchema = z
  .object({
    searchApiCalls: z.literal(1),
    searchResultCount: z.number().int().positive(),
    groundingCharacters: z.number().int().nonnegative(),
    nativeWebSearchCalls: z.literal(0),
    nativeOpenPageCalls: z.literal(0),
    openPageTokens: z.literal(0)
  })
  .strict()
export type SearchAudit = z.infer<typeof SearchAuditSchema>

export const SearchDisplayResultSchema = z
  .object({
    answer: z.string().trim().min(1),
    model: z.literal('deepseek-v4-flash'),
    searchProvider: z.literal('serper-search'),
    sources: z.array(SearchSourceSchema).min(1),
    usage: SearchUsageSchema,
    audit: SearchAuditSchema
  })
  .strict()
export type SearchDisplayResult = z.infer<typeof SearchDisplayResultSchema>

export const DeepSeekSearchProgressMessageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('SEARCH_STARTED') }).strict(),
  z
    .object({
      kind: z.literal('SEARCH_RESULTS'),
      sources: z.array(SearchSourceSchema).min(1)
    })
    .strict(),
  z.object({ kind: z.literal('ANSWER_DELTA'), delta: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal('USAGE'),
      usage: DeepSeekTokenUsageSchema,
      audit: DeepSeekSearchAuditSchema
    })
    .strict()
])
export type DeepSeekSearchProgressMessage = z.infer<typeof DeepSeekSearchProgressMessageSchema>

export const SearchStreamPayloadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('SEARCH_STARTED') }).strict(),
  z
    .object({
      kind: z.literal('SEARCH_RESULTS'),
      sources: z.array(SearchSourceSchema).min(1)
    })
    .strict(),
  z.object({ kind: z.literal('ANSWER_DELTA'), delta: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal('USAGE'),
      usage: SearchUsageSchema,
      audit: SearchAuditSchema
    })
    .strict()
])
export type SearchStreamPayload = z.infer<typeof SearchStreamPayloadSchema>

export const SearchNormalizedSchema = SearchDisplayResultSchema
export type SearchNormalized = z.infer<typeof SearchNormalizedSchema>
