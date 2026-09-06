import { z } from 'zod'
import type { ModelUsage, ProviderProfile } from '../shared/schema/provider'

export interface ModelGatewayFetchInit {
  method: 'POST'
  headers: Record<string, string>
  body: string
  signal: AbortSignal
}

export interface ModelGatewayRequest {
  url: string
  init: ModelGatewayFetchInit
}

interface BuildChatRequestInput {
  profile: ProviderProfile
  baseUrl: string
  apiKey: string
  model: string
  system: string
  user: string
  signal: AbortSignal
}

export const ProviderFailureCategorySchema = z.enum([
  'UNAUTHORIZED',
  'POLICY_DENIED',
  'CONFIGURATION',
  'TIMEOUT',
  'INPUT_REJECTED',
  'RATE_LIMITED',
  'QUOTA_EXHAUSTED',
  'UPSTREAM_UNAVAILABLE',
  'INVALID_RESPONSE'
])
export type ProviderFailureCategory = z.infer<typeof ProviderFailureCategorySchema>

const ProviderChatResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().min(1) }) })).min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional()
    })
    .optional()
})

const ProviderErrorCodeSchema = z.object({
  code: z.string().optional(),
  error: z.object({ code: z.string().optional() }).optional()
})

// Narrow profile registry adapted from Portkey Gateway v1.15.1's provider
// API/request-transform pattern. It deliberately excludes Portkey's server,
// dynamic registry, retries, form-data paths, telemetry, and permissive `any` types.
const PROFILE_CHAT_PATH: Record<ProviderProfile, string> = {
  DEEPSEEK_OFFICIAL: '/v1/chat/completions',
  SHUAI_API: '/v1/chat/completions',
  OPENAI: '/chat/completions',
  DEEPSEEK: '/chat/completions',
  GEMINI: '/chat/completions'
}

export function buildChatRequest(input: BuildChatRequestInput): ModelGatewayRequest {
  return {
    url: `${input.baseUrl.replace(/\/+$/, '')}${PROFILE_CHAT_PATH[input.profile]}`,
    init: {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: input.model,
        stream: false,
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.user }
        ],
        response_format: { type: 'json_object' }
      }),
      signal: input.signal
    }
  }
}

export function normalizeChatResponse(payload: unknown): { text: string; usage: ModelUsage } {
  const parsed = ProviderChatResponseSchema.parse(payload)
  return {
    text: parsed.choices[0]!.message.content,
    usage: {
      inputTokens: parsed.usage?.prompt_tokens ?? 0,
      outputTokens: parsed.usage?.completion_tokens ?? 0
    }
  }
}

export function classifyProviderFailure(status: number, payload: unknown): ProviderFailureCategory {
  if (status === 401) return 'UNAUTHORIZED'
  if (status === 403) return 'POLICY_DENIED'
  if (status === 404) return 'CONFIGURATION'
  if (status === 408) return 'TIMEOUT'
  if (status === 413) return 'INPUT_REJECTED'
  if (status === 429) {
    const parsed = ProviderErrorCodeSchema.safeParse(payload)
    const code = parsed.success ? (parsed.data.error?.code ?? parsed.data.code) : undefined
    return code === 'insufficient_quota' ? 'QUOTA_EXHAUSTED' : 'RATE_LIMITED'
  }
  if (status === 500 || status === 502 || status === 503) return 'UPSTREAM_UNAVAILABLE'
  return 'INVALID_RESPONSE'
}
