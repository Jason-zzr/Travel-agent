import { ulid } from 'ulid'
import { z } from 'zod'
import type Database from 'better-sqlite3'
import type { Context, Plugin } from 'cordis'
import { AppError } from '../../shared/errors'
import type { CredentialId } from '../../shared/schema/credentials'
import {
  ModelRoleSchema,
  resolveModelRoute,
  type ModelRole,
  type ModelUsage,
  type ProviderConfig,
  type ProviderConfigSummary,
  type ProviderProfile,
  type ResolvedModelRoute
} from '../../shared/schema/provider'
import {
  buildChatRequest,
  classifyProviderFailure,
  normalizeChatResponse,
  type ModelGatewayFetchInit,
  type ProviderFailureCategory
} from '../model-gateway'
import type { ProviderConfigStore } from '../provider-config-store'

export interface ProviderFetchResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

export type ProviderFetch = (
  input: string,
  init: ModelGatewayFetchInit
) => Promise<ProviderFetchResponse>

export interface StructuredInvocation<T> {
  sessionId: string
  role: ModelRole
  system: string
  user: string
  schema: z.ZodType<T>
  repairInvalid?: boolean
}

export interface ProviderRuntimeConfig {
  database: Database.Database
  configStore: ProviderConfigStore
  readCredential?: (credentialId: CredentialId) => Promise<string | undefined>
  fetch?: ProviderFetch
  timeoutMs?: number
}

interface RawInvocation {
  text: string
  usage: ModelUsage
}

const DATABASE_ROLE: Record<ModelRole, 'EXTRACTION' | 'PLANNING' | 'REVIEW' | 'VISION'> = {
  EXTRACTION: 'EXTRACTION',
  PLANNING: 'PLANNING',
  REVIEW: 'REVIEW',
  VISION: 'VISION'
}

export class ProviderRuntime {
  private readCredential: (credentialId: CredentialId) => Promise<string | undefined>
  private readonly fetchPort: ProviderFetch
  private readonly timeoutMs: number

  constructor(private readonly config: ProviderRuntimeConfig) {
    this.readCredential = config.readCredential ?? (async () => undefined)
    this.fetchPort = config.fetch ?? ((input, init) => fetch(input, init))
    this.timeoutMs = config.timeoutMs ?? 60_000
  }

  setCredentialReader(reader: (credentialId: CredentialId) => Promise<string | undefined>): void {
    this.readCredential = reader
  }

  configSummary(): Promise<ProviderConfigSummary> {
    return this.config.configStore.summary()
  }

  saveConfig(input: ProviderConfig): Promise<ProviderConfigSummary> {
    return this.config.configStore.save(input)
  }

  clearConfig(): Promise<ProviderConfigSummary> {
    return this.config.configStore.clear()
  }

  async invokeStructured<T>(input: StructuredInvocation<T>): Promise<T> {
    ModelRoleSchema.parse(input.role)
    const first = await this.invokeRaw(input.sessionId, input.role, input.system, input.user)
    const firstParsed = this.parseStructured(first.text, input.schema)
    if (firstParsed.success) return firstParsed.data

    if (input.repairInvalid === false) {
      throw new AppError('MODEL_OUTPUT_INVALID', '模型返回了不符合契约的结构化结果。', {
        cause: firstParsed.error,
        userHint: '模型输出无法验证；本次严格执行不会自动修复，请重新预览并授权。'
      })
    }

    const repaired = await this.invokeRaw(
      input.sessionId,
      input.role,
      'Return one valid JSON object only. Repair the supplied JSON to match the required contract.',
      first.text
    )
    const repairedParsed = this.parseStructured(repaired.text, input.schema)
    if (!repairedParsed.success) {
      throw new AppError('MODEL_OUTPUT_INVALID', '模型连续两次返回不符合契约的结构化结果。', {
        cause: repairedParsed.error,
        userHint: '模型输出无法验证，请重试或更换已配置模型。'
      })
    }
    return repairedParsed.data
  }

  usageTotals(sessionId: string): Array<{
    provider: string
    currency: string | null
    tokensIn: number
    tokensOut: number
    costMinor: number | null
  }> {
    return this.config.database
      .prepare(
        `SELECT provider, cost_currency AS currency,
                SUM(tokens_in) AS tokensIn, SUM(tokens_out) AS tokensOut,
                CASE WHEN SUM(CASE WHEN cost_status = 'UNKNOWN' THEN 1 ELSE 0 END) > 0
                  THEN NULL ELSE SUM(cost_cents) END AS costMinor
         FROM model_calls WHERE session_id = ?
         GROUP BY provider, cost_currency ORDER BY provider, cost_currency`
      )
      .all(sessionId) as Array<{
      provider: string
      currency: string | null
      tokensIn: number
      tokensOut: number
      costMinor: number | null
    }>
  }

  private parseStructured<T>(
    text: string,
    schema: z.ZodType<T>
  ): z.SafeParseReturnType<unknown, T> {
    try {
      return schema.safeParse(JSON.parse(text))
    } catch {
      return {
        success: false,
        error: new z.ZodError([{ code: 'custom', path: [], message: 'Invalid JSON' }])
      }
    }
  }

  private async invokeRaw(
    sessionId: string,
    role: ModelRole,
    system: string,
    user: string
  ): Promise<RawInvocation> {
    const providerConfig = await this.config.configStore.get()
    if (!providerConfig) {
      throw new AppError('PROVIDER_UNCONFIGURED', '尚未配置模型角色路由。', {
        userHint: '请先在设置中配置四个模型角色的渠道与模型。'
      })
    }
    const route = resolveModelRoute(providerConfig, role)
    const credentialId = credentialIdFor(route.channel)
    const apiKey = await this.readCredential(credentialId)
    if (!apiKey) {
      throw new AppError('MODEL_UNAUTHORIZED', '模型渠道没有可用凭据。', {
        userHint: `请先录入 ${credentialId} API Key。`
      })
    }
    return this.performAttempt(sessionId, role, route, apiKey, system, user)
  }

  private async performAttempt(
    sessionId: string,
    role: ModelRole,
    route: ResolvedModelRoute,
    apiKey: string,
    system: string,
    user: string
  ): Promise<RawInvocation> {
    const startedAt = Date.now()
    let usage: ModelUsage = { inputTokens: 0, outputTokens: 0 }
    let ok = false
    try {
      const signal = AbortSignal.timeout(this.timeoutMs)
      let response: ProviderFetchResponse
      try {
        const request = buildChatRequest({
          profile: route.channel,
          baseUrl: route.baseUrl,
          apiKey,
          model: route.model,
          system,
          user,
          signal
        })
        response = await this.fetchPort(request.url, request.init)
      } catch (error) {
        throw new AppError('MODEL_TIMEOUT', 'Provider 请求超时或网络不可达。', {
          cause: error,
          userHint: '模型服务暂时不可达，请检查网络后重试。'
        })
      }

      if (!response.ok) {
        let payload: unknown
        try {
          payload = await response.json()
        } catch {
          payload = undefined
        }
        throw providerFailureError(
          classifyProviderFailure(response.status, payload),
          response.status
        )
      }
      try {
        const normalized = normalizeChatResponse(await response.json())
        usage = normalized.usage
        ok = true
        return normalized
      } catch (error) {
        throw new AppError('MODEL_OUTPUT_INVALID', 'Provider 返回值不符合冻结结果契约。', {
          cause: error,
          userHint: '模型服务返回了无法验证的结果，请检查渠道配置。'
        })
      }
    } finally {
      this.auditAttempt(sessionId, role, route, usage, Date.now() - startedAt, ok)
    }
  }

  private auditAttempt(
    sessionId: string,
    role: ModelRole,
    route: ResolvedModelRoute,
    usage: ModelUsage,
    latencyMs: number,
    ok: boolean
  ): void {
    const priced = route.inputMinorPerMillion !== null && route.outputMinorPerMillion !== null
    const costMinor = priced
      ? Math.round(
          (usage.inputTokens * route.inputMinorPerMillion! +
            usage.outputTokens * route.outputMinorPerMillion!) /
            1_000_000
        )
      : 0
    this.config.database
      .prepare(
        `INSERT INTO model_calls(
           call_id, session_id, role, provider, model, tokens_in, tokens_out,
           cost_cents, latency_ms, ok, created_at, cost_status, cost_currency,
           input_rate_minor_per_million, output_rate_minor_per_million
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        ulid(),
        sessionId,
        DATABASE_ROLE[role],
        route.channel,
        route.model,
        usage.inputTokens,
        usage.outputTokens,
        costMinor,
        Math.max(0, latencyMs),
        ok ? 1 : 0,
        new Date().toISOString(),
        priced ? 'ESTIMATED' : 'UNKNOWN',
        priced ? route.currency : null,
        route.inputMinorPerMillion,
        route.outputMinorPerMillion
      )
  }
}

function credentialIdFor(profile: ProviderProfile): CredentialId {
  switch (profile) {
    case 'DEEPSEEK_OFFICIAL':
      return 'DEEPSEEK'
    case 'SHUAI_API':
      return 'SHUAI_API'
    case 'OPENAI':
    case 'DEEPSEEK':
    case 'GEMINI':
      return profile
  }
}

function providerFailureError(category: ProviderFailureCategory, status: number): AppError {
  const code =
    category === 'UNAUTHORIZED' || category === 'POLICY_DENIED'
      ? 'MODEL_UNAUTHORIZED'
      : category === 'TIMEOUT'
        ? 'MODEL_TIMEOUT'
        : 'MODEL_OUTPUT_INVALID'
  const userHints: Record<ProviderFailureCategory, string> = {
    UNAUTHORIZED: '模型渠道拒绝了凭据，请重新录入 API Key。',
    POLICY_DENIED: '模型渠道拒绝了当前模型、分组或访问策略，请检查供应商控制台。',
    CONFIGURATION: '模型或渠道地址不可用，请检查模型名与供应商配置。',
    TIMEOUT: '模型服务请求超时，请稍后重试。',
    INPUT_REJECTED: '模型上下文超过渠道限制，请缩短本步骤输入。',
    RATE_LIMITED: '模型渠道当前限流，请稍后由你重新发起。',
    QUOTA_EXHAUSTED: '模型渠道额度不足，请检查余额或令牌配额。',
    UPSTREAM_UNAVAILABLE: '模型渠道或其上游暂时不可用，请稍后重试。',
    INVALID_RESPONSE: '模型渠道返回了无法识别的错误，请检查配置。'
  }
  return new AppError(code, `Provider failure ${category} (HTTP ${status}).`, {
    userHint: userHints[category]
  })
}

declare module 'cordis' {
  interface Context {
    provider: ProviderRuntime
  }
}

export const providerPlugin: Plugin.Function<Context, ProviderRuntimeConfig> = (ctx, config) => {
  ctx.set('provider', new ProviderRuntime(config))
}
