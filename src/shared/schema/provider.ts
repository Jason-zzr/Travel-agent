import { z } from 'zod'

export const ProviderIdSchema = z.enum(['OPENAI', 'DEEPSEEK', 'GEMINI'])
export type ProviderId = z.infer<typeof ProviderIdSchema>

export const ProviderChannelSchema = z.enum(['DEEPSEEK_OFFICIAL', 'SHUAI_API'])
export type ProviderChannel = z.infer<typeof ProviderChannelSchema>

export const ProviderProfileSchema = z.union([ProviderChannelSchema, ProviderIdSchema])
export type ProviderProfile = z.infer<typeof ProviderProfileSchema>

export const ModelRoleSchema = z.enum(['EXTRACTION', 'PLANNING', 'REVIEW', 'VISION'])
export type ModelRole = z.infer<typeof ModelRoleSchema>

export const CurrencySchema = z.enum(['USD', 'CNY'])
export type Currency = z.infer<typeof CurrencySchema>

const HttpsUrlSchema = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === 'https:', 'baseUrl must use HTTPS')

const ProviderRootUrlSchema = HttpsUrlSchema.refine((value) => {
  const url = new URL(value)
  return url.pathname === '/' && url.search === '' && url.hash === ''
}, 'baseUrl must be an HTTPS origin without a path, query, or hash')

export const RoleModelConfigSchema = z.object({
  model: z.string().trim().min(1),
  currency: CurrencySchema,
  inputMinorPerMillion: z.number().int().nonnegative().nullable().default(null),
  outputMinorPerMillion: z.number().int().nonnegative().nullable().default(null)
})
export type RoleModelConfig = z.infer<typeof RoleModelConfigSchema>

export const LegacyProviderConfigSchema = z.object({
  version: z.literal(1),
  provider: ProviderIdSchema,
  baseUrl: HttpsUrlSchema,
  roles: z.object({
    EXTRACTION: RoleModelConfigSchema,
    PLANNING: RoleModelConfigSchema,
    REVIEW: RoleModelConfigSchema,
    VISION: RoleModelConfigSchema
  })
})
export type LegacyProviderConfig = z.infer<typeof LegacyProviderConfigSchema>

export const RoutedRoleModelConfigSchema = RoleModelConfigSchema.extend({
  channel: ProviderChannelSchema
})
export type RoutedRoleModelConfig = z.infer<typeof RoutedRoleModelConfigSchema>

export const ProviderChannelConfigSchema = z.object({ baseUrl: ProviderRootUrlSchema })
export type ProviderChannelConfig = z.infer<typeof ProviderChannelConfigSchema>

export const ProviderConfigSchema = z.object({
  version: z.literal(2),
  channels: z.object({
    DEEPSEEK_OFFICIAL: ProviderChannelConfigSchema,
    SHUAI_API: ProviderChannelConfigSchema
  }),
  roles: z.object({
    EXTRACTION: RoutedRoleModelConfigSchema,
    PLANNING: RoutedRoleModelConfigSchema,
    REVIEW: RoutedRoleModelConfigSchema,
    VISION: RoutedRoleModelConfigSchema
  })
})
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>

export const StoredProviderConfigSchema = z.discriminatedUnion('version', [
  ProviderConfigSchema,
  LegacyProviderConfigSchema
])
export type StoredProviderConfig = z.infer<typeof StoredProviderConfigSchema>

const ProviderConfigFileV2Schema = z.object({
  version: z.literal(2),
  active: ProviderConfigSchema.nullable()
})

const LegacyProviderConfigFileSchema = z.object({
  version: z.literal(1),
  active: LegacyProviderConfigSchema.nullable()
})

export const ProviderConfigFileSchema = z.discriminatedUnion('version', [
  ProviderConfigFileV2Schema,
  LegacyProviderConfigFileSchema
])
export type ProviderConfigFile = z.infer<typeof ProviderConfigFileSchema>

export const ResolvedModelRouteSchema = RoleModelConfigSchema.extend({
  channel: ProviderProfileSchema,
  baseUrl: HttpsUrlSchema
})
export type ResolvedModelRoute = z.infer<typeof ResolvedModelRouteSchema>

export function resolveModelRoute(
  config: StoredProviderConfig,
  role: ModelRole
): ResolvedModelRoute {
  if (config.version === 1) {
    return ResolvedModelRouteSchema.parse({
      ...config.roles[role],
      channel: config.provider,
      baseUrl: config.baseUrl
    })
  }
  const route = config.roles[role]
  return ResolvedModelRouteSchema.parse({
    ...route,
    baseUrl: config.channels[route.channel].baseUrl
  })
}

const ProviderModelsSummarySchema = z.object({
  EXTRACTION: z.string(),
  PLANNING: z.string(),
  REVIEW: z.string(),
  VISION: z.string()
})

const ProviderRoutesSummarySchema = z.object({
  EXTRACTION: ResolvedModelRouteSchema,
  PLANNING: ResolvedModelRouteSchema,
  REVIEW: ResolvedModelRouteSchema,
  VISION: ResolvedModelRouteSchema
})

export const ProviderConfigSummarySchema = z.object({
  configured: z.boolean(),
  version: z.union([z.literal(1), z.literal(2)]).nullable(),
  provider: ProviderIdSchema.nullable(),
  baseUrl: z.string().nullable(),
  models: ProviderModelsSummarySchema.nullable(),
  routes: ProviderRoutesSummarySchema.nullable()
})
export type ProviderConfigSummary = z.infer<typeof ProviderConfigSummarySchema>

export const ModelUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative()
})
export type ModelUsage = z.infer<typeof ModelUsageSchema>

export const ModelCostStatusSchema = z.enum(['ESTIMATED', 'UNKNOWN'])
export type ModelCostStatus = z.infer<typeof ModelCostStatusSchema>
