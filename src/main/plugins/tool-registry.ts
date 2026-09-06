import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import type Database from 'better-sqlite3'
import type { Context, Plugin } from 'cordis'
import { ulid } from 'ulid'
import { ZodError } from 'zod'
import { AppError } from '../../shared/errors'
import { RailOptionSchema, type RailOption } from '../../shared/schema/d5'
import {
  EvidenceClaimSchema,
  type ContentIdentity,
  type EvidenceClaim,
  type EvidenceScope
} from '../../shared/schema/evidence'
import { firstMcpText, McpTextToolResultSchema } from '../../shared/schema/mcp/common'
import {
  VARIFLIGHT_FLIGHT_PRICE_TOOL_NAME,
  VariflightFlightPriceArgsSchema,
  VariflightFlightPriceDescriptorInputSchema,
  VariflightFlightPriceRawSchema,
  VariflightFlightPriceToolResultSchema,
  type VariflightFlightPriceArgs
} from '../../shared/schema/mcp/flight'
import type { FlyaiCliStructureResult } from '../../shared/schema/mcp/flyai-flight'
import {
  HotelLodgingSourceRequestSchema,
  normalizeHotelLodgingCandidate,
  type HotelLodgingSourceRequest
} from '../../shared/schema/mcp/hotel'
import {
  MapGroundTransferClaimValueSchema,
  MapGroundTransferSourceRequestSchema,
  normalizeMapGeocode,
  normalizeMapGroundTransfer,
  TimedMapGroundTransferSourceRequestSchema,
  TransientMapGeocodeRequestSchema,
  type MapGroundTransferSourceRequest,
  type TimedMapGroundTransferSourceRequest,
  type TransientMapGeocodeRequest
} from '../../shared/schema/mcp/map'
import {
  normalizeRailJourney,
  RailJourneySourceRequestSchema,
  RailTicketDiscoverySourceRequestSchema,
  RailTicketsSchema,
  visibleRailTrainCode,
  type RailJourneySourceRequest,
  type RailTicketDiscoverySourceRequest,
  type RailToolResult
} from '../../shared/schema/mcp/rail'
import {
  DeepSeekSearchProgressMessageSchema,
  DeepSeekSearchResultSchema,
  SearchNormalizedSchema,
  SearchStreamPayloadSchema,
  type DeepSeekSearchResult,
  type SearchStreamPayload
} from '../../shared/schema/mcp/search'
import { XhsSampleSummarySchema, type XhsSampleSummary } from '../../shared/schema/d4'
import {
  XhsConnectionStatusSchema,
  XhsLoginQrDisplaySchema,
  normalizeXhsLoginQrResult,
  type XhsConnectionStatus,
  type XhsLoginQrDisplay,
  type XhsRankingBatchResult,
  type XhsQueryKind
} from '../../shared/schema/mcp/xiaohongshu'
import {
  RepresentativeSourceQuerySchema,
  SourceConfigSchema,
  type ExternalSourceId,
  type RepresentativeSourceQuery,
  type SourceConfig,
  type SourceHealthEntry,
  type SourceQueryOutcome
} from '../../shared/schema/source'
import type { ToolCallAudit, BlockedToolAudit } from '../../shared/schema/tool-audit'
import type { CredentialId } from '../../shared/schema/credentials'
import { SourceRepository } from '../db/source-repository'
import {
  createHttpSourceSession,
  createStdioSourceSession,
  type McpToolDescriptor,
  type SourceSession,
  type StdioSourceSessionInput
} from '../mcp/client'
import {
  classifyAmapBusinessError,
  type AmapBusinessErrorCategory
} from '../mcp/amap-error-classifier'
import { deterministicClaimId, EvidenceService } from '../mcp/evidence'
import { summarizeJsonText, type JsonStructureSummary } from '../mcp/json-structure-summary'
import { PoiCacheStore, type AmapQuotaBucket } from '../mcp/poi-cache'
import {
  HotelSearchNormalizedSchema,
  MapGeocodeNormalizedSchema,
  RailCurrentDateSchema,
  SOURCE_DEFINITIONS
} from '../mcp/source-catalog'
import { SourceHealthService } from '../mcp/source-health'
import { fingerprintXhsToolResult } from '../mcp/xhs-structural-fingerprint'
import { XhsSidecarRuntime } from '../mcp/xhs-sidecar'
import { runXhsResearch as executeXhsResearch } from '../mcp/sources/xiaohongshu'
import { runXhsRankingBatch as executeXhsRankingBatch } from '../mcp/sources/xiaohongshu-ranking'
import { createVariflightSourceSession } from '../mcp/sources/variflight'
import type { AppPaths, FlyaiRuntimePaths } from '../paths'
import { SourceConfigStore } from '../source-config-store'
import { applyPromotionOverride } from '../evidence-rules'
import type { PolicyService } from './policy'
import {
  classifyVariflightSemantics,
  type VariflightSemanticSummary
} from '../probes/variflight-semantics-classifier'
import {
  assertFlyaiBundleMatchesAuthorization,
  consumeAuthorizedFlyaiFlightProbe,
  type AuthorizedFlyaiFlightProbe
} from '../probes/flyai-flight-gate'
import {
  createElectronFlyaiProcessExecutor,
  inspectFlyaiBundle,
  runFlyaiFlightCliStructureProbe,
  type FlyaiProcessExecutor
} from '../probes/flyai-cli-runner'

export const RAIL_TOOL_ALLOWLIST = SOURCE_DEFINITIONS.SRC_RAIL.allowlist

export type CredentialReader = (id: CredentialId) => Promise<string | undefined>
export type SourceSessionFactory = (input: {
  sourceId: ExternalSourceId
  credential: string | undefined
  credentials: Partial<Record<CredentialId, string>>
  sourceConfig: SourceConfig
}) => SourceSession

export interface ToolRegistryConfig {
  database: Database.Database
  paths: AppPaths
  sourceConfigStore: SourceConfigStore
  readCredential?: CredentialReader
  createSession?: SourceSessionFactory
  now?: () => Date
  sleep?: (milliseconds: number) => Promise<void>
  log?: (code: string, message: string, context: Record<string, unknown>) => void
  amapQuotas?: Partial<Record<AmapQuotaBucket, number>>
  createFlyaiProcessExecutor?: () => Promise<FlyaiProcessExecutor>
  xhsSidecarRuntime?: XhsSidecarRuntime
}

export interface LiveAcceptanceOutcome {
  ok: boolean
  source: ExternalSourceId
  tool: string
  stage: 'credential' | 'connect' | 'discover' | 'call' | 'validate' | 'close'
  discovered: boolean
  resultSchema: 'VALID' | 'INVALID' | 'NOT_RUN'
  callAttempts: 0 | 1
  errorCode: string | null
  validationCategory?: 'MISSING_ANSWER' | 'MISSING_CITATIONS' | 'RESULT_SCHEMA_DRIFT'
  rawResponseRetained: false
  coverage?: HotelAcceptanceCoverage
}

export interface HotelAcceptanceCoverage {
  resultCount: number
  pricedResultCount: number
  lowestPriceRanges: Array<{
    currency: string
    count: number
    min: number
    max: number
  }>
}

export interface StructureDiagnosticOutcome {
  ok: boolean
  source: ExternalSourceId
  tool: string
  stage: 'credential' | 'connect' | 'discover' | 'call' | 'summarize' | 'close'
  discovered: boolean
  callAttempts: 0 | 1
  resultSchema: 'VALID' | 'INVALID' | 'NOT_RUN'
  summary: JsonStructureSummary | null
  errorCategory: AmapBusinessErrorCategory | null
  errorCode: string | null
  rawResponseRetained: false
  contractStatus?: 'UNPROVEN'
}

export interface VariflightSemanticDiagnosticOutcome {
  ok: boolean
  source: 'SRC_FLIGHT'
  tool: typeof VARIFLIGHT_FLIGHT_PRICE_TOOL_NAME
  stage: 'credential' | 'connect' | 'discover' | 'call' | 'classify' | 'close'
  discovered: boolean
  callAttempts: 0 | 1
  resultSchema: 'VALID' | 'INVALID' | 'NOT_RUN'
  summary: VariflightSemanticSummary | null
  errorCode: string | null
  rawResponseRetained: false
  valueRetention: false
  contractStatus: 'UNPROVEN'
}

export interface TransientGeocodeOutcome {
  claim: EvidenceClaim
  location: { lng: number; lat: number }
  fromCache: boolean
}

export interface RailRoundTripDiscoveryRequest {
  outbound: RailTicketDiscoverySourceRequest
  return: RailTicketDiscoverySourceRequest
}

export interface RailRoundTripDiscoveryResult {
  outboundOptions: RailOption[]
  returnOptions: RailOption[]
}

export type RailBatchDiscoveryOutcome =
  | {
      ok: true
      request: RailTicketDiscoverySourceRequest
      options: RailOption[]
    }
  | {
      ok: false
      request: RailTicketDiscoverySourceRequest
      error: unknown
    }

const RAIL_COLD_START_TIMEOUT_MS = 60_000
const RAIL_TOOL_TIMEOUT_MS = 15_000
const VARIFLIGHT_RESULT_PROBE_ALLOWLIST = new Set([VARIFLIGHT_FLIGHT_PRICE_TOOL_NAME])
type RailRoundTripPhase = 'connect' | 'discover' | 'register' | 'call'

export function railMcpLaunchInput(): Pick<StdioSourceSessionInput, 'command' | 'args'> {
  return {
    command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
    args: ['--offline', '-y', '12306-mcp@0.3.10']
  }
}

const AMAP_QUOTAS: Record<AmapQuotaBucket, number> = {
  AMAP_SEARCH: 5000,
  AMAP_LBS: 150000,
  AMAP_WEATHER: 5000
}

export class ToolRegistryService {
  private readonly registeredTools = new Map<ExternalSourceId, Map<string, McpToolDescriptor>>()
  private readonly repository: SourceRepository
  private readonly evidence: EvidenceService
  private readonly health: SourceHealthService
  private readonly poiCache: PoiCacheStore
  private readonly xhsSidecarRuntime: XhsSidecarRuntime
  private readonly usesBundledXhsRuntime: boolean
  private readonly now: () => Date
  private readonly sleep: (milliseconds: number) => Promise<void>
  private readonly amapQuotas: Record<AmapQuotaBucket, number>
  private credentialReader: CredentialReader
  private serialTail: Promise<void> = Promise.resolve()
  private readonly activeSessions = new Map<string, SourceSession>()
  private readonly activeFlyaiOperations = new Map<string, AbortController>()
  private readonly cancelledOperations = new Set<string>()
  private readonly transientGeocodes = new Map<
    string,
    { expiresAt: number; lng: number; lat: number }
  >()
  private lastAmapStart = 0
  private closed = false

  constructor(
    private readonly ctx: Context,
    private readonly config: ToolRegistryConfig
  ) {
    this.now = config.now ?? (() => new Date())
    this.sleep = config.sleep ?? ((milliseconds) => ctx.sleep(milliseconds))
    this.amapQuotas = { ...AMAP_QUOTAS, ...config.amapQuotas }
    this.credentialReader = config.readCredential ?? (async () => undefined)
    this.repository = new SourceRepository(config.database)
    this.evidence = new EvidenceService(ctx, this.repository)
    this.health = new SourceHealthService(this.repository, this.evidence, this.now, config.log)
    this.poiCache = new PoiCacheStore(config.paths.poiCacheDatabase)
    this.usesBundledXhsRuntime = config.createSession === undefined
    this.xhsSidecarRuntime =
      config.xhsSidecarRuntime ??
      new XhsSidecarRuntime({
        paths: config.paths,
        sleep: this.sleep
      })
  }

  setCredentialReader(reader: CredentialReader): void {
    this.credentialReader = reader
  }

  sourceConfig(): Promise<SourceConfig> {
    return this.config.sourceConfigStore.get()
  }

  saveSourceConfig(input: SourceConfig): Promise<SourceConfig> {
    return this.config.sourceConfigStore.save(SourceConfigSchema.parse(input))
  }

  clearSourceConfig(): Promise<SourceConfig> {
    return this.config.sourceConfigStore.clear()
  }

  async listSourceHealth(): Promise<SourceHealthEntry[]> {
    await this.syncConfigurationStatus()
    return this.health.list()
  }

  async probe(
    sourceId: ExternalSourceId,
    timeoutMs = 15_000,
    operationId?: string
  ): Promise<SourceHealthEntry> {
    try {
      await this.prepareSource(sourceId)
      this.health.assertAvailable(sourceId)
      this.assertNotCancelled(operationId)
      try {
        await this.discoverSourceTools(sourceId, timeoutMs, operationId)
        return this.health.markSuccess(sourceId)
      } catch (error) {
        await this.handleInvocationFailure(sourceId, this.cancelledError(operationId, error))
        throw this.cancelledError(operationId, error)
      }
    } finally {
      if (operationId) this.cancelledOperations.delete(operationId)
    }
  }

  async discoverSourceTools(
    sourceId: ExternalSourceId,
    timeoutMs = 120_000,
    operationId?: string,
    maxAttemptsOverride?: 1 | 2
  ): Promise<McpToolDescriptor[]> {
    const source = SOURCE_DEFINITIONS[sourceId]
    const prepared = await this.prepareSource(sourceId)
    const maxAttempts =
      maxAttemptsOverride ?? (sourceId === 'SRC_SEARCH' || sourceId === 'SRC_XHS' ? 1 : 2)
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const session = this.createSession(
        sourceId,
        prepared.credential,
        prepared.credentials,
        prepared.sourceConfig
      )
      this.trackSession(operationId, session)
      try {
        this.assertNotCancelled(operationId)
        await session.connect(timeoutMs)
        const discovered = await session.listTools(timeoutMs)
        const registered = gateDiscoveredTools({
          policy: this.ctx.policy,
          sourceId,
          discovered,
          allowlist: source.allowlist,
          contracts: source.tools,
          recordBlocked: (blockedSourceId, toolName, reason) =>
            this.repository.recordBlocked(
              blockedSourceId,
              toolName,
              reason,
              this.now().toISOString()
            )
        })
        this.registeredTools.set(sourceId, registered)
        this.health.markSuccess(sourceId)
        return [...registered.values()]
      } catch (error) {
        const finalError = this.cancelledError(operationId, error)
        if (!isRetryableExternalError(finalError) || attempt === maxAttempts - 1) throw finalError
      } finally {
        this.untrackSession(operationId, session)
        await session.close()
      }
    }
    throw new AppError('INTERNAL_INVARIANT_VIOLATED', '数据源发现未返回结果。')
  }

  async discoverSourceDescriptorsOnce(
    sourceId: ExternalSourceId,
    timeoutMs = 15_000,
    operationId?: string
  ): Promise<McpToolDescriptor[]> {
    const prepared = await this.prepareSource(sourceId, false)
    const session = this.createSession(
      sourceId,
      prepared.credential,
      prepared.credentials,
      prepared.sourceConfig
    )
    this.trackSession(operationId, session)
    try {
      this.assertNotCancelled(operationId)
      await session.connect(timeoutMs)
      this.assertNotCancelled(operationId)
      return boundedDiscoveryDescriptors(await session.listTools(timeoutMs))
    } finally {
      this.untrackSession(operationId, session)
      await session.close()
      if (operationId) this.cancelledOperations.delete(operationId)
    }
  }

  discoverRailTools(timeoutMs = 120_000): Promise<McpToolDescriptor[]> {
    return this.discoverSourceTools('SRC_RAIL', timeoutMs)
  }

  async invokeRail(
    sessionId: string,
    toolName: string,
    args: Record<string, unknown>,
    timeoutMs = 120_000
  ): Promise<RailToolResult> {
    return (await this.invokeTool(
      'SRC_RAIL',
      sessionId,
      toolName,
      args,
      timeoutMs
    )) as RailToolResult
  }

  async materializeRailJourney(
    input: RailJourneySourceRequest,
    operationId?: string,
    persist = true
  ): Promise<SourceQueryOutcome> {
    const request = RailJourneySourceRequestSchema.parse(input)
    const args = {
      date: request.date,
      fromStation: request.fromStation,
      toStation: request.toStation,
      format: 'json'
    }
    const result = await this.invokeTool(
      'SRC_RAIL',
      request.sessionId,
      'get-tickets',
      args,
      15_000,
      operationId,
      undefined,
      true
    )
    const tickets = RailTicketsSchema.parse(JSON.parse(firstMcpText(result as RailToolResult)))
    const ticket = tickets.find((item) => visibleRailTrainCode(item) === request.trainNo)
    if (!ticket) {
      throw new AppError('INPUT_INVALID', '指定车次不在本次铁路结果中。', {
        userHint: '请刷新车次列表并重新选择，不会自动改用其他车次。'
      })
    }
    const value = normalizeRailJourney(ticket, request)
    const drafts = [
      this.makeClaim({
        sessionId: request.sessionId,
        sourceId: 'SRC_RAIL',
        toolName: 'get-tickets',
        args,
        subject: `${request.date} ${request.fromStation}→${request.toStation} ${value.trainNo}`,
        predicate: 'railJourney',
        value,
        identity: 'TRANSACTION',
        validForMs: 15 * 60 * 1000,
        notes: '只核验车次与出发/到达钟点；价格、席别与跨日抵达信息缺失时保持未知。'
      })
    ]
    const claims = persist ? await this.persistClaims(drafts) : drafts
    return { sourceId: 'SRC_RAIL', toolName: 'get-tickets', claims, fromCache: false }
  }

  async discoverRailOptions(
    input: RailTicketDiscoverySourceRequest,
    operationId?: string
  ): Promise<RailOption[]> {
    const request = RailTicketDiscoverySourceRequestSchema.parse(input)
    const args = railDiscoveryArgs(request)
    const result = await this.invokeTool(
      'SRC_RAIL',
      request.sessionId,
      'get-tickets',
      args,
      RAIL_TOOL_TIMEOUT_MS,
      operationId,
      undefined,
      true
    )
    return normalizeRailDiscoveryOptions(request, result as RailToolResult)
  }

  async discoverRailOptionsBatch(
    input: RailTicketDiscoverySourceRequest[],
    operationId?: string,
    onSettled?: (completed: number, total: number) => void
  ): Promise<RailBatchDiscoveryOutcome[]> {
    if (input.length < 1 || input.length > 24) {
      throw new AppError('INPUT_INVALID', '多城市铁路查询批次必须包含 1 到 24 个计划项。')
    }
    const requests = input.map((request) => RailTicketDiscoverySourceRequestSchema.parse(request))
    const sessionId = requests[0]!.sessionId
    if (requests.some((request) => request.sessionId !== sessionId)) {
      throw new AppError('INPUT_INVALID', '多城市铁路查询批次必须属于同一会话。')
    }

    const outcomes: RailBatchDiscoveryOutcome[] = []
    const settle = (outcome: RailBatchDiscoveryOutcome): void => {
      outcomes.push(outcome)
      onSettled?.(outcomes.length, requests.length)
    }

    try {
      return await this.withRailSession(operationId, async (session) => {
        for (const request of requests) {
          try {
            this.health.assertAvailable('SRC_RAIL')
            this.assertNotCancelled(operationId)
            const result = (await this.invokeToolOnSessionOnce(
              'SRC_RAIL',
              request.sessionId,
              'get-tickets',
              railDiscoveryArgs(request),
              session,
              RAIL_TOOL_TIMEOUT_MS,
              operationId
            )) as RailToolResult
            settle({
              ok: true,
              request,
              options: normalizeRailDiscoveryOptions(request, result)
            })
          } catch (error) {
            const finalError = normalizeRailRoundTripError(
              this.cancelledError(operationId, error),
              'call'
            )
            if (finalError.code === 'SOURCE_CANCELLED') throw finalError
            settle({ ok: false, request, error: finalError })
          }
        }
        return outcomes
      })
    } catch (error) {
      const finalError = normalizeRailRoundTripError(
        this.cancelledError(operationId, error),
        'connect'
      )
      if (finalError.code === 'SOURCE_CANCELLED' || outcomes.length > 0) throw finalError
      for (const [index, request] of requests.entries()) {
        settle({
          ok: false,
          request,
          error:
            index === 0
              ? finalError
              : new AppError('SOURCE_ADAPTER_DEGRADED', 'Rail 数据源已降级。', {
                  userHint: '铁路自动核验暂不可用，请稍后重试或补充人工交通证据。'
                })
        })
      }
      return outcomes
    }
  }

  async discoverRailRoundTripOptions(
    input: RailRoundTripDiscoveryRequest,
    operationId?: string
  ): Promise<RailRoundTripDiscoveryResult> {
    const outbound = RailTicketDiscoverySourceRequestSchema.parse(input.outbound)
    const returnRequest = RailTicketDiscoverySourceRequestSchema.parse(input.return)
    if (
      outbound.sessionId !== returnRequest.sessionId ||
      outbound.direction !== 'OUTBOUND' ||
      returnRequest.direction !== 'RETURN'
    ) {
      throw new AppError('INPUT_INVALID', '往返铁路查询必须属于同一会话并按去程、返程顺序提交。')
    }

    return this.withRailSession(operationId, async (session) => {
      const outboundResult = (await this.invokeToolOnSessionOnce(
        'SRC_RAIL',
        outbound.sessionId,
        'get-tickets',
        railDiscoveryArgs(outbound),
        session,
        RAIL_TOOL_TIMEOUT_MS,
        operationId
      )) as RailToolResult
      const outboundOptions = normalizeRailDiscoveryOptions(outbound, outboundResult)

      const returnResult = (await this.invokeToolOnSessionOnce(
        'SRC_RAIL',
        returnRequest.sessionId,
        'get-tickets',
        railDiscoveryArgs(returnRequest),
        session,
        RAIL_TOOL_TIMEOUT_MS,
        operationId
      )) as RailToolResult
      const returnOptions = normalizeRailDiscoveryOptions(returnRequest, returnResult)
      return { outboundOptions, returnOptions }
    })
  }

  private async withRailSession<T>(
    operationId: string | undefined,
    operation: (session: SourceSession) => Promise<T>
  ): Promise<T> {
    try {
      return await this.runRailSession(operationId, operation)
    } finally {
      if (operationId) this.cancelledOperations.delete(operationId)
    }
  }

  private async runRailSession<T>(
    operationId: string | undefined,
    operation: (session: SourceSession) => Promise<T>
  ): Promise<T> {
    const sourceId = 'SRC_RAIL' as const
    const source = SOURCE_DEFINITIONS[sourceId]
    const prepared = await this.prepareSource(sourceId)
    try {
      this.health.assertAvailable(sourceId)
      this.assertNotCancelled(operationId)
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError('INTERNAL_SERVICE_NOT_READY', 'Rail 数据源状态准备失败。', {
        cause: error,
        userHint: 'Rail 数据源状态暂时不可读取，请稍后重试。'
      })
    }

    return this.schedule(sourceId, async () => {
      let session: SourceSession
      try {
        session = this.createSession(
          sourceId,
          prepared.credential,
          prepared.credentials,
          prepared.sourceConfig
        )
      } catch (error) {
        if (error instanceof AppError) throw error
        const finalError = new AppError('SOURCE_UNREACHABLE', 'Rail MCP 会话无法创建。', {
          cause: error,
          userHint: '本地 Rail MCP 运行时暂时不可用，请检查安装后重试。'
        })
        await this.handleInvocationFailureSafely(sourceId, finalError)
        throw finalError
      }
      let phase: RailRoundTripPhase = 'connect'
      let operationError: AppError | undefined
      let completed = false
      let result!: T
      this.trackSession(operationId, session)
      try {
        this.assertNotCancelled(operationId)
        await session.connect(RAIL_COLD_START_TIMEOUT_MS)
        phase = 'discover'
        const discovered = await session.listTools(RAIL_TOOL_TIMEOUT_MS)
        phase = 'register'
        const registered = gateDiscoveredTools({
          policy: this.ctx.policy,
          sourceId,
          discovered,
          allowlist: source.allowlist,
          contracts: source.tools,
          recordBlocked: (blockedSourceId, toolName, reason) =>
            this.repository.recordBlocked(
              blockedSourceId,
              toolName,
              reason,
              this.now().toISOString()
            )
        })
        this.registeredTools.set(sourceId, registered)
        if (!registered.has('get-tickets')) {
          throw new AppError('NOT_IN_ALLOWLIST', 'SRC_RAIL 工具 get-tickets 未通过只读注册检查。')
        }
        this.health.markSuccess(sourceId)
        phase = 'call'
        result = await operation(session)
        completed = true
      } catch (error) {
        const finalError = normalizeRailRoundTripError(
          this.cancelledError(operationId, error),
          phase
        )
        operationError = finalError
        if (phase === 'connect' || phase === 'discover') {
          await this.handleInvocationFailureSafely(sourceId, finalError)
        }
      } finally {
        this.untrackSession(operationId, session)
        try {
          await session.close()
        } catch (error) {
          if (!operationError) {
            const finalError = normalizeRailSessionCloseError(error)
            await this.handleInvocationFailureSafely(sourceId, finalError)
            operationError = finalError
          }
        }
      }
      if (operationError) throw operationError
      if (!completed) {
        throw new AppError('INTERNAL_INVARIANT_VIOLATED', 'Rail 查询会话未返回结果。')
      }
      return result
    })
  }

  private async invokeToolOnSessionOnce(
    sourceId: ExternalSourceId,
    sessionId: string,
    toolName: string,
    args: Record<string, unknown>,
    session: SourceSession,
    timeoutMs: number,
    operationId?: string
  ): Promise<unknown> {
    const source = SOURCE_DEFINITIONS[sourceId]
    const registered = this.registeredTools.get(sourceId)
    if (!registered?.has(toolName)) {
      throw new AppError('NOT_IN_ALLOWLIST', `${sourceId} 工具 ${toolName} 未通过只读注册检查。`)
    }
    const contract = source.tools[toolName]
    if (!contract) {
      throw new AppError('MCP_SCHEMA_INVALID', `${sourceId} 工具 ${toolName} 没有本地契约。`)
    }
    const validatedArgs = contract.args.parse(args) as Record<string, unknown>
    this.assertNotCancelled(operationId)
    this.admitQuota(sourceId, toolName)
    const startedAt = performance.now()
    const audit = {
      callId: ulid(),
      sessionId,
      toolName,
      sourceId,
      argsDigest: digestArgs(toolName, validatedArgs),
      durationMs: 0,
      ok: false,
      errorCode: null as string | null,
      createdAt: this.now().toISOString()
    }
    let raw: unknown
    try {
      raw = await session.callTool(toolName, validatedArgs, timeoutMs)
      const resultSchema = contract.resultForArgs?.(validatedArgs) ?? contract.result
      const parsed = resultSchema.parse(raw) as { isError?: boolean }
      if (parsed.isError) {
        throw new AppError('MCP_TOOL_ERROR', `${sourceId} 工具 ${toolName} 返回失败。`)
      }
      audit.ok = true
      this.health.markSuccess(sourceId)
      return parsed
    } catch (error) {
      const cancelledError = this.cancelledError(operationId, error)
      if (
        cancelledError instanceof ZodError ||
        (cancelledError instanceof AppError && cancelledError.code === 'SOURCE_DRIFT')
      ) {
        const missingPaths =
          cancelledError instanceof ZodError
            ? zodMissingPaths(cancelledError)
            : ['content.0.text.sources']
        audit.errorCode = 'SOURCE_DRIFT'
        const keys =
          sourceId === 'SRC_XHS' && (toolName === 'search_feeds' || toolName === 'get_feed_detail')
            ? fingerprintXhsToolResult(raw)
            : undefined
        await this.health.markDrift(sourceId, missingPaths, keys)
        throw new AppError('SOURCE_DRIFT', `${sourceId} 工具 ${toolName} 返回结构已漂移。`, {
          cause: error,
          userHint: `${source.capabilityImpact}；${source.manualAlternative}`
        })
      }
      const finalError =
        cancelledError instanceof AppError
          ? cancelledError
          : new AppError('SOURCE_UNREACHABLE', `${sourceId} 工具 ${toolName} 调用失败。`, {
              cause: cancelledError,
              userHint: `${source.capabilityImpact}；${source.manualAlternative}`
            })
      audit.errorCode = finalError.code
      await this.handleInvocationFailure(sourceId, finalError)
      throw finalError
    } finally {
      audit.durationMs = Math.max(0, Math.round(performance.now() - startedAt))
      this.repository.recordToolCall(audit)
    }
  }

  async materializeSelectedRailOption(
    input: {
      sessionId: string
      candidateId: string
      option: RailOption
    },
    persist = true
  ): Promise<SourceQueryOutcome> {
    const option = RailOptionSchema.parse(input.option)
    const request = RailJourneySourceRequestSchema.parse({
      sessionId: input.sessionId,
      candidateId: input.candidateId,
      direction: option.direction,
      trainNo: option.trainNo,
      date: option.serviceDate,
      fromStation: option.fromStation,
      toStation: option.toStation
    })
    const value = normalizeRailJourney(
      {
        train_no: option.trainNo,
        start_time: option.departureTime,
        arrive_time: option.arrivalTime
      },
      request
    )
    const args = {
      date: request.date,
      fromStation: request.fromStation,
      toStation: request.toStation,
      trainNo: request.trainNo
    }
    const drafts = [
      this.makeClaim({
        sessionId: request.sessionId,
        sourceId: 'SRC_RAIL',
        toolName: 'get-tickets',
        args,
        subject: `${request.date} ${request.fromStation}→${request.toStation} ${request.trainNo}`,
        predicate: 'railJourney',
        value,
        identity: 'TRANSACTION',
        validForMs: 15 * 60 * 1000,
        notes: '由用户从本次已授权 12306 候选中选择；物化时未再次查询。'
      })
    ]
    const claims = persist ? await this.persistClaims(drafts) : drafts
    return { sourceId: 'SRC_RAIL', toolName: 'get-tickets', claims, fromCache: true }
  }

  async materializeHotelLodgingCandidates(
    input: HotelLodgingSourceRequest,
    operationId?: string,
    persist = true
  ): Promise<SourceQueryOutcome> {
    const request = HotelLodgingSourceRequestSchema.parse(input)
    const args = {
      originQuery: `${request.place} 酒店查询`,
      place: request.place,
      placeType: '城市',
      size: request.size,
      checkInParam: {
        adultCount: request.adultCount,
        checkInDate: request.checkInDate,
        stayNights: request.stayNights
      }
    }
    const result = await this.invokeTool(
      'SRC_HOTEL',
      request.sessionId,
      'searchHotels',
      args,
      15_000,
      operationId,
      undefined,
      true
    )
    const normalized = HotelSearchNormalizedSchema.parse(
      JSON.parse(firstMcpText(result as RailToolResult))
    )
    const claims = normalized.hotelInformationList.map((hotel) => {
      const value = normalizeHotelLodgingCandidate(hotel)
      return this.makeClaim({
        sessionId: request.sessionId,
        sourceId: 'SRC_HOTEL',
        toolName: 'searchHotels',
        args,
        subject: hotel.name,
        predicate: 'lodgingCandidate',
        value,
        identity: 'COMMERCIAL_OFFER',
        verificationStatus: 'UNVERIFIED',
        validForMs: 15 * 60 * 1000,
        notes: '来源仅提供基础酒店信息和最低价；全住期总价、房型、入住人数与取消政策保持未知。'
      })
    })
    return {
      sourceId: 'SRC_HOTEL',
      toolName: 'searchHotels',
      claims: persist ? await this.persistClaims(claims) : claims,
      fromCache: false
    }
  }

  async materializeMapGroundTransfer(
    input: MapGroundTransferSourceRequest,
    operationId?: string,
    persist = true
  ): Promise<SourceQueryOutcome> {
    const request = MapGroundTransferSourceRequestSchema.parse(input)
    const args = {
      origins: request.origin,
      destination: request.destination,
      type: request.travelMode === 'DRIVING' ? '1' : '3'
    }
    const result = await this.invokeTool(
      'SRC_MAP',
      request.sessionId,
      'maps_distance',
      args,
      15_000,
      operationId,
      undefined,
      true
    )
    const value = normalizeMapGroundTransfer(
      JSON.parse(firstMcpText(result as RailToolResult)),
      request
    )
    const drafts = [
      this.makeClaim({
        sessionId: request.sessionId,
        sourceId: 'SRC_MAP',
        toolName: 'maps_distance',
        args,
        subject: `${request.from}→${request.to}`,
        predicate: 'groundTransfer',
        value,
        identity: 'OFFICIAL',
        validForMs: 15 * 60 * 1000,
        notes: '高德距离测量结果：distance 为米，duration 为秒；费用未知，不做估算。'
      })
    ]
    const claims = persist ? await this.persistClaims(drafts) : drafts
    return { sourceId: 'SRC_MAP', toolName: 'maps_distance', claims, fromCache: false }
  }

  hasTransientGeocode(address: string, city: string): boolean {
    return this.getTransientGeocode(address, city) !== null
  }

  async materializeTransientMapGeocode(
    input: TransientMapGeocodeRequest,
    operationId?: string,
    allowExternal = true,
    persist = true
  ): Promise<TransientGeocodeOutcome> {
    const request = TransientMapGeocodeRequestSchema.parse(input)
    const cached = this.getTransientGeocode(request.address, request.city)
    let location: { lng: number; lat: number }
    if (cached) {
      location = { lng: cached.lng, lat: cached.lat }
    } else {
      if (!allowExternal) {
        throw new AppError('GATE_BLOCKED', '地理编码缓存已变化。', {
          userHint: '来源调用清单已经变化，请重新查看并授权。'
        })
      }
      const result = await this.invokeTool(
        'SRC_MAP',
        request.sessionId,
        'maps_geo',
        { address: request.address, city: request.city },
        15_000,
        operationId,
        undefined,
        true
      )
      const normalized = normalizeMapGeocode(
        JSON.parse(firstMcpText(result as RailToolResult)),
        request
      )
      location = { lng: normalized.lng, lat: normalized.lat }
      this.transientGeocodes.set(transientGeocodeKey(request.address, request.city), {
        expiresAt: this.now().getTime() + 15 * 60 * 1000,
        ...location
      })
    }
    const args = { address: request.address, city: request.city }
    const draft = this.makeClaim({
      sessionId: request.sessionId,
      sourceId: 'SRC_MAP',
      toolName: 'maps_geo',
      args,
      subject: request.label,
      predicate: 'coordinates',
      value: { city: request.city, lng: location.lng, lat: location.lat },
      identity: 'OFFICIAL',
      validForMs: 15 * 60 * 1000,
      notes: '地理编码仅保留用户标签与坐标；查询地址明文未写入证据。'
    })
    const claim = persist ? (await this.persistClaims([draft]))[0]! : draft
    return { claim, location, fromCache: Boolean(cached) }
  }

  async materializeTimedMapGroundTransfer(
    input: TimedMapGroundTransferSourceRequest,
    operationId?: string,
    persist = true
  ): Promise<SourceQueryOutcome> {
    const request = TimedMapGroundTransferSourceRequestSchema.parse(input)
    const args = {
      origins: request.origin,
      destination: request.destination,
      type: request.travelMode === 'DRIVING' ? '1' : '3'
    }
    const result = await this.invokeTool(
      'SRC_MAP',
      request.sessionId,
      'maps_distance',
      args,
      15_000,
      operationId,
      undefined,
      true
    )
    const measured = normalizeMapGroundTransfer(
      JSON.parse(firstMcpText(result as RailToolResult)),
      { ...request, startAt: null }
    )
    const timing = timedTransferWindow(
      request.timingBasis,
      request.railAnchorAt,
      measured.durationSeconds
    )
    const value = MapGroundTransferClaimValueSchema.parse({
      ...measured,
      startAt: timing.startAt,
      endAt: timing.endAt
    })
    const drafts = [
      this.makeClaim({
        sessionId: request.sessionId,
        sourceId: 'SRC_MAP',
        toolName: 'maps_distance',
        args,
        subject: `${request.from}→${request.to}`,
        predicate: 'groundTransfer',
        value,
        identity: 'OFFICIAL',
        validForMs: 15 * 60 * 1000,
        notes: '高德距离测量结果：distance 为米，duration 为秒；接驳时间由所选车次与实测时长计算。'
      })
    ]
    const claims = persist ? await this.persistClaims(drafts) : drafts
    return { sourceId: 'SRC_MAP', toolName: 'maps_distance', claims, fromCache: false }
  }

  async runRepresentativeQuery(
    input: RepresentativeSourceQuery,
    operationId?: string,
    onProgress?: (payload: SearchStreamPayload) => void,
    scope: EvidenceScope | null = null
  ): Promise<SourceQueryOutcome> {
    const request = RepresentativeSourceQuerySchema.parse(input)
    try {
      this.assertNotCancelled(operationId)
      switch (request.sourceId) {
        case 'SRC_RAIL':
          return this.runRailRepresentative(request.sessionId, operationId)
        case 'SRC_MAP':
          return this.runMapRepresentative(request.sessionId, request.input, operationId, scope)
        case 'SRC_HOTEL':
          return this.runHotelRepresentative(request.sessionId, request.input, operationId)
        case 'SRC_SEARCH':
          return this.runSearchRepresentative(
            request.sessionId,
            request.input,
            operationId,
            onProgress,
            scope
          )
      }
      throw new AppError('INTERNAL_INVARIANT_VIOLATED', '未知的代表性数据源查询。')
    } finally {
      if (operationId) this.cancelledOperations.delete(operationId)
    }
  }

  async runXhsResearch(
    input: {
      sessionId: string
      queryKind: XhsQueryKind
      query: string
      scope?: EvidenceScope | null
    },
    operationId?: string
  ): Promise<SourceQueryOutcome> {
    try {
      this.assertNotCancelled(operationId)
      return await this.runXhsRepresentative(input, operationId)
    } finally {
      if (operationId) this.cancelledOperations.delete(operationId)
    }
  }

  async runXhsRankingResearch(
    input: { sessionId: string; destinationCity: string; scope?: EvidenceScope | null },
    operationId?: string,
    onProgress?: (completedSearches: number, completedDetails: number) => void
  ): Promise<{ claims: EvidenceClaim[]; sampleSummary: XhsSampleSummary }> {
    const sourceId = 'SRC_XHS' as const
    const source = SOURCE_DEFINITIONS[sourceId]
    const prepared = await this.prepareSource(sourceId)
    this.health.assertAvailable(sourceId)
    this.assertNotCancelled(operationId)
    try {
      return await this.schedule(sourceId, async () => {
        const session = this.createSession(
          sourceId,
          prepared.credential,
          prepared.credentials,
          prepared.sourceConfig
        )
        this.trackSession(operationId, session)
        try {
          await session.connect(60_000)
          const discovered = await session.listTools(60_000)
          const registered = gateDiscoveredTools({
            policy: this.ctx.policy,
            sourceId,
            discovered,
            allowlist: source.allowlist,
            contracts: source.tools,
            recordBlocked: (blockedSourceId, toolName, reason) =>
              this.repository.recordBlocked(
                blockedSourceId,
                toolName,
                reason,
                this.now().toISOString()
              )
          })
          this.registeredTools.set(sourceId, registered)
          if (!registered.has('search_feeds') || !registered.has('get_feed_detail')) {
            throw new AppError('NOT_IN_ALLOWLIST', '小红书 30 帖研究所需只读工具未通过注册。')
          }
          const batch = await executeXhsRankingBatch({
            destinationCity: input.destinationCity,
            invoke: (toolName, args) =>
              this.invokeToolOnSessionOnce(
                sourceId,
                input.sessionId,
                toolName,
                args,
                session,
                60_000,
                operationId
              ),
            onProgress
          })
          const claims = await this.persistClaims(
            this.xhsRankingSourceClaims(input.sessionId, batch, input.scope ?? null)
          )
          return {
            claims,
            sampleSummary: XhsSampleSummarySchema.parse({
              destinationCity: input.destinationCity,
              recommendPostCount: 15,
              avoidPostCount: 15,
              searchCalls: 4,
              detailCalls: 30,
              detailCharacterLimit: 4000,
              extractionCalls: 6,
              reviewCalls: 1,
              retryCount: 0,
              loadAllComments: false,
              scope: input.scope ?? null
            })
          }
        } finally {
          this.untrackSession(operationId, session)
          await session.close()
        }
      })
    } finally {
      if (operationId) this.cancelledOperations.delete(operationId)
    }
  }

  async xhsConnectionStatus(
    timeoutMs = 15_000,
    operationId?: string
  ): Promise<XhsConnectionStatus> {
    if (this.usesBundledXhsRuntime && this.xhsSidecarRuntime.snapshot().state === 'STOPPED') {
      return XhsConnectionStatusSchema.parse({
        connected: false,
        loggedIn: false,
        authTokenConfigured: true
      })
    }
    try {
      const result = await this.invokeTool(
        'SRC_XHS',
        'settings:xiaohongshu',
        'check_login_status',
        {},
        timeoutMs,
        operationId
      )
      const text = firstMcpText(McpTextToolResultSchema.parse(result))
      const loggedIn = /^✅ 已登录/m.test(text)
      if (!loggedIn && !/^❌ 未登录/m.test(text)) {
        await this.health.markDrift('SRC_XHS', ['content.0.text'])
        throw new AppError('SOURCE_DRIFT', '小红书登录状态返回结构已变化。', {
          userHint: '本地伴随服务可连接，但无法确认登录状态。'
        })
      }
      return XhsConnectionStatusSchema.parse({
        connected: true,
        loggedIn,
        authTokenConfigured: true
      })
    } finally {
      if (operationId) this.cancelledOperations.delete(operationId)
    }
  }

  async xhsLoginQr(timeoutMs = 60_000, operationId?: string): Promise<XhsLoginQrDisplay> {
    try {
      const normalized = normalizeXhsLoginQrResult(
        await this.invokeTool(
          'SRC_XHS',
          'settings:xiaohongshu-login',
          'get_login_qrcode',
          {},
          timeoutMs,
          operationId,
          undefined,
          true
        )
      )
      if (normalized.status === 'ALREADY_LOGGED_IN') {
        return XhsLoginQrDisplaySchema.parse(normalized)
      }
      return XhsLoginQrDisplaySchema.parse({
        status: 'QR_REQUIRED',
        imageDataUrl: `data:image/png;base64,${normalized.imageBase64}`,
        hint: normalized.hint,
        expiresAt: new Date(this.now().getTime() + 5 * 60_000).toISOString()
      })
    } catch (error) {
      if (error instanceof AppError && error.code === 'SOURCE_DRIFT') {
        throw new AppError('SOURCE_DRIFT', '小红书登录二维码返回结构已变化。', {
          cause: error,
          userHint: '本机伴随服务可连接，但登录二维码格式无法安全显示。'
        })
      }
      throw error
    } finally {
      if (operationId) this.cancelledOperations.delete(operationId)
    }
  }

  async runLiveAcceptanceOnce(input: {
    sourceId: ExternalSourceId
    toolName: string
    args: Record<string, unknown>
    timeoutMs: number
  }): Promise<LiveAcceptanceOutcome> {
    const source = SOURCE_DEFINITIONS[input.sourceId]
    const contract = source.tools[input.toolName]
    let stage: LiveAcceptanceOutcome['stage'] = 'credential'
    let discovered = false
    let callAttempts: 0 | 1 = 0
    let outcome: LiveAcceptanceOutcome
    let session: SourceSession | undefined

    try {
      if (!contract || !source.allowlist.has(input.toolName)) {
        throw new AppError('NOT_IN_ALLOWLIST', 'Live acceptance tool is not allowlisted.')
      }
      if (contract.structureOnly) {
        throw new AppError(
          'MCP_SCHEMA_INVALID',
          'Live acceptance requires a locally proven exact result schema.'
        )
      }
      const args = contract.args.parse(input.args) as Record<string, unknown>
      const prepared = await this.prepareSource(input.sourceId, false)
      session = this.createSession(
        input.sourceId,
        prepared.credential,
        prepared.credentials,
        prepared.sourceConfig
      )

      stage = 'connect'
      await session.connect(input.timeoutMs)
      stage = 'discover'
      const descriptor = (await session.listTools(input.timeoutMs)).find(
        (tool) => tool.name === input.toolName
      )
      if (!descriptor) {
        throw new AppError('MCP_PROTOCOL_ERROR', 'Live acceptance tool was not discovered.')
      }
      const policyVerdict = this.ctx.policy.checkTool(
        descriptor.name,
        descriptor.description,
        source.allowlist
      )
      if (policyVerdict !== true) {
        const errorCode =
          policyVerdict === 'NOT_IN_ALLOWLIST' ? 'NOT_IN_ALLOWLIST' : 'WRITE_KEYWORD_HIT'
        throw new AppError(errorCode, 'Live acceptance tool failed the read-only policy gate.')
      }
      discovered = true

      stage = 'call'
      callAttempts = 1
      const raw = await session.callTool(input.toolName, args, input.timeoutMs)
      stage = 'validate'
      const resultSchema = contract.resultForArgs?.(args) ?? contract.result
      const parsed = resultSchema.parse(raw) as { isError?: boolean }
      if (parsed.isError) {
        throw new AppError('MCP_TOOL_ERROR', 'Live acceptance tool returned an error result.')
      }
      if (input.sourceId === 'SRC_SEARCH') assertDeepSeekSearchSucceeded(parsed)
      const coverage =
        input.sourceId === 'SRC_HOTEL' && input.toolName === 'searchHotels'
          ? summarizeHotelCoverage(parsed)
          : undefined
      outcome = {
        ok: true,
        source: input.sourceId,
        tool: input.toolName,
        stage,
        discovered,
        resultSchema: 'VALID',
        callAttempts,
        errorCode: null,
        rawResponseRetained: false,
        ...(coverage ? { coverage } : {})
      }
    } catch (error) {
      const validationCategory = liveAcceptanceValidationCategory(error, input.sourceId, stage)
      outcome = {
        ok: false,
        source: input.sourceId,
        tool: input.toolName,
        stage,
        discovered,
        resultSchema: stage === 'validate' ? 'INVALID' : 'NOT_RUN',
        callAttempts,
        errorCode:
          error instanceof AppError
            ? error.code
            : error instanceof ZodError && stage === 'validate'
              ? 'SOURCE_DRIFT'
              : 'INTERNAL_ERROR',
        rawResponseRetained: false,
        ...(validationCategory ? { validationCategory } : {})
      }
    }

    if (session) {
      try {
        await session.close()
      } catch {
        if (outcome.ok) {
          outcome = {
            ...outcome,
            ok: false,
            stage: 'close',
            errorCode: 'MCP_PROTOCOL_ERROR'
          }
        }
      }
    }
    return outcome
  }

  async runStructureDiagnosticOnce(input: {
    sourceId: ExternalSourceId
    toolName: string
    args: Record<string, unknown>
    timeoutMs: number
  }): Promise<StructureDiagnosticOutcome> {
    const source = SOURCE_DEFINITIONS[input.sourceId]
    const contract = source.tools[input.toolName]
    let stage: StructureDiagnosticOutcome['stage'] = 'credential'
    let discovered = false
    let callAttempts: 0 | 1 = 0
    let outcome: StructureDiagnosticOutcome
    let session: SourceSession | undefined

    try {
      if (!contract || !source.allowlist.has(input.toolName)) {
        throw new AppError('NOT_IN_ALLOWLIST', 'Structure diagnostic tool is not allowlisted.')
      }
      const args = contract.args.parse(input.args) as Record<string, unknown>
      const prepared = await this.prepareSource(input.sourceId, false)
      session = this.createSession(
        input.sourceId,
        prepared.credential,
        prepared.credentials,
        prepared.sourceConfig
      )

      stage = 'connect'
      await session.connect(input.timeoutMs)
      stage = 'discover'
      const descriptor = (await session.listTools(input.timeoutMs)).find(
        (tool) => tool.name === input.toolName
      )
      if (!descriptor) {
        throw new AppError('MCP_PROTOCOL_ERROR', 'Structure diagnostic tool was not discovered.')
      }
      const policyVerdict = this.ctx.policy.checkTool(
        descriptor.name,
        descriptor.description,
        source.allowlist
      )
      if (policyVerdict !== true) {
        const errorCode =
          policyVerdict === 'NOT_IN_ALLOWLIST' ? 'NOT_IN_ALLOWLIST' : 'WRITE_KEYWORD_HIT'
        throw new AppError(errorCode, 'Structure diagnostic tool failed the read-only policy gate.')
      }
      discovered = true

      stage = 'call'
      callAttempts = 1
      const raw = await session.callTool(input.toolName, args, input.timeoutMs)
      stage = 'summarize'
      const parsed = McpTextToolResultSchema.parse(raw)
      const text = firstMcpText(parsed)
      const summary = summarizeJsonText(text)
      let resultSchema: StructureDiagnosticOutcome['resultSchema'] = 'NOT_RUN'
      if (!parsed.isError && !contract.structureOnly) {
        try {
          const schema = contract.resultForArgs?.(args) ?? contract.result
          const validated = schema.parse(raw)
          if (input.sourceId === 'SRC_SEARCH') assertDeepSeekSearchSucceeded(validated)
          resultSchema = 'VALID'
        } catch (error) {
          if (!(error instanceof ZodError)) throw error
          resultSchema = 'INVALID'
        }
      }
      const errorCategory =
        input.sourceId === 'SRC_MAP' && parsed.isError && summary.payloadKind === 'NON_JSON_TEXT'
          ? classifyAmapBusinessError(text)
          : null
      outcome = {
        ok:
          !parsed.isError &&
          (contract.structureOnly ? summary.payloadKind === 'JSON' : resultSchema === 'VALID'),
        source: input.sourceId,
        tool: input.toolName,
        stage,
        discovered,
        callAttempts,
        resultSchema,
        summary,
        errorCategory,
        errorCode: parsed.isError
          ? 'MCP_TOOL_ERROR'
          : contract.structureOnly && summary.payloadKind !== 'JSON'
            ? 'SOURCE_DRIFT'
            : resultSchema === 'INVALID'
              ? 'SOURCE_DRIFT'
              : null,
        rawResponseRetained: false,
        ...(contract.structureOnly ? { contractStatus: 'UNPROVEN' as const } : {})
      }
    } catch (error) {
      outcome = {
        ok: false,
        source: input.sourceId,
        tool: input.toolName,
        stage,
        discovered,
        callAttempts,
        resultSchema: 'NOT_RUN',
        summary: null,
        errorCategory: null,
        errorCode:
          error instanceof AppError
            ? error.code
            : error instanceof ZodError && stage === 'summarize'
              ? 'SOURCE_DRIFT'
              : 'INTERNAL_ERROR',
        rawResponseRetained: false
      }
    }

    if (session) {
      try {
        await session.close()
      } catch {
        if (outcome.ok) {
          outcome = {
            ...outcome,
            ok: false,
            stage: 'close',
            errorCode: 'MCP_PROTOCOL_ERROR'
          }
        }
      }
    }
    return outcome
  }

  async runVariflightResultShapeProbeOnce(input: {
    args: VariflightFlightPriceArgs
    timeoutMs: 15_000
    operationId: string
  }): Promise<StructureDiagnosticOutcome> {
    const sourceId = 'SRC_FLIGHT' as const
    const toolName = VARIFLIGHT_FLIGHT_PRICE_TOOL_NAME
    let stage: StructureDiagnosticOutcome['stage'] = 'credential'
    let discovered = false
    let callAttempts: 0 | 1 = 0
    let outcome: StructureDiagnosticOutcome
    let session: SourceSession | undefined

    try {
      const args = VariflightFlightPriceArgsSchema.parse(input.args)
      const prepared = await this.prepareSource(sourceId, false)
      session = this.createSession(
        sourceId,
        prepared.credential,
        prepared.credentials,
        prepared.sourceConfig
      )
      this.trackSession(input.operationId, session)

      this.assertNotCancelled(input.operationId)
      stage = 'connect'
      await session.connect(input.timeoutMs)
      this.assertNotCancelled(input.operationId)
      stage = 'discover'
      const descriptor = boundedDiscoveryDescriptors(await session.listTools(input.timeoutMs)).find(
        (tool) => tool.name === toolName
      )
      if (!descriptor) {
        throw new AppError('MCP_PROTOCOL_ERROR', 'VariFlight result probe tool was not discovered.')
      }
      try {
        VariflightFlightPriceDescriptorInputSchema.parse(descriptor.inputSchema)
      } catch (error) {
        throw new AppError('SOURCE_DRIFT', 'VariFlight result probe input schema has drifted.', {
          cause: error
        })
      }
      const policyVerdict = this.ctx.policy.checkTool(
        descriptor.name,
        descriptor.description,
        VARIFLIGHT_RESULT_PROBE_ALLOWLIST
      )
      if (policyVerdict !== true) {
        const errorCode =
          policyVerdict === 'NOT_IN_ALLOWLIST' ? 'NOT_IN_ALLOWLIST' : 'WRITE_KEYWORD_HIT'
        throw new AppError(errorCode, 'VariFlight result probe failed the read-only policy gate.')
      }
      discovered = true

      this.assertNotCancelled(input.operationId)
      stage = 'call'
      callAttempts = 1
      const raw = await session.callTool(toolName, args, input.timeoutMs)
      stage = 'summarize'
      const parsed = McpTextToolResultSchema.parse(raw)
      const summary = summarizeJsonText(firstMcpText(parsed))
      outcome = {
        ok: !parsed.isError && summary.payloadKind === 'JSON',
        source: sourceId,
        tool: toolName,
        stage,
        discovered,
        callAttempts,
        resultSchema: 'NOT_RUN',
        summary,
        errorCategory: null,
        errorCode: parsed.isError
          ? 'MCP_TOOL_ERROR'
          : summary.payloadKind !== 'JSON'
            ? 'SOURCE_DRIFT'
            : null,
        rawResponseRetained: false,
        contractStatus: 'UNPROVEN'
      }
    } catch (error) {
      outcome = {
        ok: false,
        source: sourceId,
        tool: toolName,
        stage,
        discovered,
        callAttempts,
        resultSchema: 'NOT_RUN',
        summary: null,
        errorCategory: null,
        errorCode:
          error instanceof AppError
            ? error.code
            : error instanceof ZodError && stage === 'summarize'
              ? 'SOURCE_DRIFT'
              : 'INTERNAL_ERROR',
        rawResponseRetained: false,
        contractStatus: 'UNPROVEN'
      }
    }

    if (session) {
      this.untrackSession(input.operationId, session)
      try {
        await session.close()
      } catch {
        if (outcome.ok) {
          outcome = {
            ...outcome,
            ok: false,
            stage: 'close',
            errorCode: 'MCP_PROTOCOL_ERROR'
          }
        }
      }
    }
    this.cancelledOperations.delete(input.operationId)
    return outcome
  }

  async runVariflightSemanticProbeOnce(input: {
    args: VariflightFlightPriceArgs
    timeoutMs: 15_000
    operationId: string
  }): Promise<VariflightSemanticDiagnosticOutcome> {
    const sourceId = 'SRC_FLIGHT' as const
    const toolName = VARIFLIGHT_FLIGHT_PRICE_TOOL_NAME
    let stage: VariflightSemanticDiagnosticOutcome['stage'] = 'credential'
    let discovered = false
    let callAttempts: 0 | 1 = 0
    let outcome: VariflightSemanticDiagnosticOutcome
    let session: SourceSession | undefined

    try {
      const args = VariflightFlightPriceArgsSchema.parse(input.args)
      const prepared = await this.prepareSource(sourceId, false)
      session = this.createSession(
        sourceId,
        prepared.credential,
        prepared.credentials,
        prepared.sourceConfig
      )
      this.trackSession(input.operationId, session)

      this.assertNotCancelled(input.operationId)
      stage = 'connect'
      await session.connect(input.timeoutMs)
      this.assertNotCancelled(input.operationId)
      stage = 'discover'
      const descriptor = boundedDiscoveryDescriptors(await session.listTools(input.timeoutMs)).find(
        (tool) => tool.name === toolName
      )
      if (!descriptor) {
        throw new AppError(
          'MCP_PROTOCOL_ERROR',
          'VariFlight semantic probe tool was not discovered.'
        )
      }
      try {
        VariflightFlightPriceDescriptorInputSchema.parse(descriptor.inputSchema)
      } catch (error) {
        throw new AppError('SOURCE_DRIFT', 'VariFlight semantic probe input schema has drifted.', {
          cause: error
        })
      }
      const policyVerdict = this.ctx.policy.checkTool(
        descriptor.name,
        descriptor.description,
        VARIFLIGHT_RESULT_PROBE_ALLOWLIST
      )
      if (policyVerdict !== true) {
        const errorCode =
          policyVerdict === 'NOT_IN_ALLOWLIST' ? 'NOT_IN_ALLOWLIST' : 'WRITE_KEYWORD_HIT'
        throw new AppError(errorCode, 'VariFlight semantic probe failed the read-only policy gate.')
      }
      discovered = true

      this.assertNotCancelled(input.operationId)
      stage = 'call'
      callAttempts = 1
      const raw = await session.callTool(toolName, args, input.timeoutMs)
      stage = 'classify'
      const envelope = VariflightFlightPriceToolResultSchema.parse(raw)
      if (envelope.isError) {
        throw new AppError('MCP_TOOL_ERROR', 'VariFlight semantic probe returned an error result.')
      }
      const payload = VariflightFlightPriceRawSchema.parse(
        JSON.parse(firstMcpText(envelope)) as unknown
      )
      const summary = classifyVariflightSemantics(payload, args)
      outcome = {
        ok: true,
        source: sourceId,
        tool: toolName,
        stage,
        discovered,
        callAttempts,
        resultSchema: 'VALID',
        summary,
        errorCode: null,
        rawResponseRetained: false,
        valueRetention: false,
        contractStatus: 'UNPROVEN'
      }
    } catch (error) {
      const finalError = this.cancelledError(input.operationId, error)
      const isToolError = finalError instanceof AppError && finalError.code === 'MCP_TOOL_ERROR'
      outcome = {
        ok: false,
        source: sourceId,
        tool: toolName,
        stage,
        discovered,
        callAttempts,
        resultSchema: stage === 'classify' && !isToolError ? 'INVALID' : 'NOT_RUN',
        summary: null,
        errorCode:
          finalError instanceof AppError
            ? finalError.code
            : (finalError instanceof ZodError || finalError instanceof SyntaxError) &&
                stage === 'classify'
              ? 'SOURCE_DRIFT'
              : 'INTERNAL_ERROR',
        rawResponseRetained: false,
        valueRetention: false,
        contractStatus: 'UNPROVEN'
      }
    }

    if (session) {
      this.untrackSession(input.operationId, session)
      try {
        await session.close()
      } catch {
        if (outcome.ok) {
          outcome = {
            ...outcome,
            ok: false,
            stage: 'close',
            resultSchema: 'NOT_RUN',
            summary: null,
            errorCode: 'MCP_PROTOCOL_ERROR'
          }
        }
      }
    }
    this.cancelledOperations.delete(input.operationId)
    return outcome
  }

  async runFlyaiFlightStructureProbeOnce(input: {
    authorization: AuthorizedFlyaiFlightProbe
    runtimePaths: FlyaiRuntimePaths
    onProcessAttempt?: () => void
  }): Promise<FlyaiCliStructureResult> {
    consumeAuthorizedFlyaiFlightProbe(input.authorization, this.now())
    const operationId = input.authorization.plan.operationId
    const abortController = new AbortController()
    this.activeFlyaiOperations.set(operationId, abortController)
    try {
      this.assertNotCancelled(operationId)
      const binding = await inspectFlyaiBundle(input.runtimePaths)
      assertFlyaiBundleMatchesAuthorization(input.authorization, binding)
      this.assertNotCancelled(operationId)
      const credential = await this.credentialReader('FLYAI')
      if (!credential) {
        throw new AppError('SOURCE_UNCONFIGURED', 'FlyAI credential is not configured.')
      }
      this.assertNotCancelled(operationId)
      const executor = await (
        this.config.createFlyaiProcessExecutor ?? createElectronFlyaiProcessExecutor
      )()
      this.assertNotCancelled(operationId)
      return await runFlyaiFlightCliStructureProbe(
        {
          binding,
          credential,
          deviceIdentityPath: this.config.paths.flyaiDeviceIdentity,
          input: input.authorization.plan.args,
          operationId,
          signal: abortController.signal
        },
        { executor, onProcessAttempt: input.onProcessAttempt }
      )
    } finally {
      this.activeFlyaiOperations.delete(operationId)
      this.cancelledOperations.delete(operationId)
    }
  }

  async cancelOperation(operationId: string): Promise<boolean> {
    this.cancelledOperations.add(operationId)
    const flyaiOperation = this.activeFlyaiOperations.get(operationId)
    flyaiOperation?.abort()
    const session = this.activeSessions.get(operationId)
    if (session) await session.close()
    await this.xhsSidecarRuntime.stopIfIdle()
    if (!flyaiOperation && !session) this.cancelledOperations.delete(operationId)
    return Boolean(flyaiOperation || session)
  }

  listEvidence(sessionId: string, limit = 100): EvidenceClaim[] {
    return this.evidence.list(sessionId, limit)
  }

  addEvidenceClaims(claims: EvidenceClaim[]): Promise<EvidenceClaim[]> {
    return this.evidence.addMany(claims.map((claim) => EvidenceClaimSchema.parse(claim)))
  }

  listToolCalls(sessionId: string | undefined, limit = 100): ToolCallAudit[] {
    return this.repository.listToolCalls(sessionId, limit)
  }

  listBlockedTools(limit = 100): BlockedToolAudit[] {
    return this.repository.listBlockedTools(limit)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    const activeSessions = [...new Set(this.activeSessions.values())]
    for (const operation of this.activeFlyaiOperations.values()) operation.abort()
    await Promise.allSettled(activeSessions.map((session) => session.close()))
    await this.xhsSidecarRuntime.close()
    this.activeSessions.clear()
    this.activeFlyaiOperations.clear()
    await this.serialTail
    this.transientGeocodes.clear()
    this.poiCache.close()
  }

  private async invokeTool(
    sourceId: ExternalSourceId,
    sessionId: string,
    toolName: string,
    args: Record<string, unknown>,
    timeoutMs: number,
    operationId?: string,
    onProgress?: (payload: SearchStreamPayload) => void,
    oneShot = false
  ): Promise<unknown> {
    const source = SOURCE_DEFINITIONS[sourceId]
    const prepared = await this.prepareSource(sourceId)
    this.health.assertAvailable(sourceId)
    this.assertNotCancelled(operationId)
    let registered = this.registeredTools.get(sourceId)
    if (!registered?.has(toolName)) {
      try {
        await this.discoverSourceTools(sourceId, timeoutMs, operationId, oneShot ? 1 : undefined)
      } catch (error) {
        const finalError = this.cancelledError(operationId, error)
        await this.handleInvocationFailure(sourceId, finalError)
        throw finalError
      }
      registered = this.registeredTools.get(sourceId)
    }
    if (!registered?.has(toolName)) {
      throw new AppError('NOT_IN_ALLOWLIST', `${sourceId} 工具 ${toolName} 未通过只读注册检查。`)
    }
    const contract = source.tools[toolName]
    if (!contract) {
      throw new AppError('MCP_SCHEMA_INVALID', `${sourceId} 工具 ${toolName} 没有本地契约。`)
    }
    const validatedArgs = contract.args.parse(args) as Record<string, unknown>

    return this.schedule(sourceId, async () => {
      let lastError: unknown
      const maxAttempts = oneShot || sourceId === 'SRC_SEARCH' || sourceId === 'SRC_XHS' ? 1 : 2
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        this.assertNotCancelled(operationId)
        this.admitQuota(sourceId, toolName)
        const startedAt = performance.now()
        const audit = {
          callId: ulid(),
          sessionId,
          toolName,
          sourceId,
          argsDigest: digestArgs(toolName, validatedArgs),
          durationMs: 0,
          ok: false,
          errorCode: null as string | null,
          createdAt: this.now().toISOString()
        }
        const session = this.createSession(
          sourceId,
          prepared.credential,
          prepared.credentials,
          prepared.sourceConfig
        )
        this.trackSession(operationId, session)
        try {
          await session.connect(timeoutMs)
          const raw = await session.callTool(
            toolName,
            validatedArgs,
            timeoutMs,
            onProgress
              ? (progress) => {
                  const payload = normalizeSearchProgressMessage(progress.message)
                  if (payload) onProgress(payload)
                }
              : undefined
          )
          const resultSchema = contract.resultForArgs?.(validatedArgs) ?? contract.result
          const parsed = resultSchema.parse(raw) as { isError?: boolean }
          if (parsed.isError) {
            throw new AppError('MCP_TOOL_ERROR', `${sourceId} 工具 ${toolName} 返回失败。`)
          }
          if (sourceId === 'SRC_SEARCH') assertDeepSeekSearchSucceeded(parsed)
          audit.ok = true
          this.health.markSuccess(sourceId)
          return parsed
        } catch (error) {
          const finalError = this.cancelledError(operationId, error)
          lastError = finalError
          audit.errorCode = finalError instanceof AppError ? finalError.code : 'SOURCE_DRIFT'
          if (
            finalError instanceof ZodError ||
            (finalError instanceof AppError && finalError.code === 'SOURCE_DRIFT')
          ) {
            const missingPaths =
              finalError instanceof ZodError
                ? zodMissingPaths(finalError)
                : ['content.0.text.sources']
            await this.health.markDrift(sourceId, missingPaths)
            throw new AppError('SOURCE_DRIFT', `${sourceId} 工具 ${toolName} 返回结构已漂移。`, {
              cause: error,
              userHint: `${source.capabilityImpact}；${source.manualAlternative}`
            })
          }
          if (!isRetryableExternalError(finalError) || attempt === maxAttempts - 1) {
            await this.handleInvocationFailure(sourceId, finalError)
            throw finalError
          }
        } finally {
          this.untrackSession(operationId, session)
          await session.close()
          audit.durationMs = Math.max(0, Math.round(performance.now() - startedAt))
          this.repository.recordToolCall(audit)
        }
      }
      throw lastError
    })
  }

  private async runRailRepresentative(
    sessionId: string,
    operationId?: string
  ): Promise<SourceQueryOutcome> {
    const result = (await this.invokeTool(
      'SRC_RAIL',
      sessionId,
      'get-current-date',
      {},
      15_000,
      operationId
    )) as RailToolResult
    const value = RailCurrentDateSchema.parse(firstMcpText(result))
    const claims = await this.persistClaims([
      this.makeClaim({
        sessionId,
        sourceId: 'SRC_RAIL',
        toolName: 'get-current-date',
        args: {},
        subject: '12306',
        predicate: 'currentDate',
        value,
        identity: 'TRANSACTION',
        validForMs: 24 * 60 * 60 * 1000
      })
    ])
    return { sourceId: 'SRC_RAIL', toolName: 'get-current-date', claims, fromCache: false }
  }

  private async runMapRepresentative(
    sessionId: string,
    input: { address: string; city: string },
    operationId?: string,
    scope: EvidenceScope | null = null
  ): Promise<SourceQueryOutcome> {
    const cached = this.poiCache.getPoi(input.address, input.city, this.now())
    if (cached) {
      const normalized = MapGeocodeNormalizedSchema.parse({
        name: cached.name,
        city: cached.city,
        address: input.address,
        lng: cached.lng,
        lat: cached.lat
      })
      const claims = await this.persistClaims(this.mapClaims(sessionId, input, normalized, scope))
      return { sourceId: 'SRC_MAP', toolName: 'maps_geo', claims, fromCache: true }
    }
    const result = await this.invokeTool(
      'SRC_MAP',
      sessionId,
      'maps_geo',
      input,
      15_000,
      operationId
    )
    const normalized = normalizeMapGeocode(
      JSON.parse(firstMcpText(result as RailToolResult)),
      input
    )
    this.poiCache.putPoi({
      name: input.address,
      city: input.city,
      lng: normalized.lng,
      lat: normalized.lat,
      detail: normalized,
      fetchedAt: this.now().toISOString()
    })
    const claims = await this.persistClaims(this.mapClaims(sessionId, input, normalized, scope))
    return { sourceId: 'SRC_MAP', toolName: 'maps_geo', claims, fromCache: false }
  }

  private async runHotelRepresentative(
    sessionId: string,
    input: { place: string; checkInDate: string; stayNights: number; adultCount: number },
    operationId?: string
  ): Promise<SourceQueryOutcome> {
    const args = {
      originQuery: `${input.place} 酒店查询`,
      place: input.place,
      placeType: '城市',
      size: 5,
      checkInParam: {
        adultCount: input.adultCount,
        checkInDate: input.checkInDate,
        stayNights: input.stayNights
      }
    }
    const result = await this.invokeTool(
      'SRC_HOTEL',
      sessionId,
      'searchHotels',
      args,
      15_000,
      operationId
    )
    const normalized = HotelSearchNormalizedSchema.parse(
      JSON.parse(firstMcpText(result as RailToolResult))
    )
    const claims = normalized.hotelInformationList.map((hotel) =>
      this.makeClaim({
        sessionId,
        sourceId: 'SRC_HOTEL',
        toolName: 'searchHotels',
        args,
        subject: hotel.name,
        predicate: 'hotelOffer',
        value: {
          hotelId: hotel.hotelId,
          address: hotel.address ?? null,
          starRating: hotel.starRating ?? null,
          price: hotel.price ?? null
        },
        identity: 'COMMERCIAL_OFFER',
        validForMs: 15 * 60 * 1000
      })
    )
    return {
      sourceId: 'SRC_HOTEL',
      toolName: 'searchHotels',
      claims: await this.persistClaims(claims),
      fromCache: false
    }
  }

  private async runSearchRepresentative(
    sessionId: string,
    input: { query: string },
    operationId?: string,
    onProgress?: (payload: SearchStreamPayload) => void,
    scope: EvidenceScope | null = null
  ): Promise<SourceQueryOutcome> {
    const result = await this.invokeTool(
      'SRC_SEARCH',
      sessionId,
      'deepseek_web_search',
      input,
      60_000,
      operationId,
      onProgress
    )
    const normalized = normalizeSearchResult(result)
    const claims = normalized.sources.map((source) => {
      const sourceUrl = sanitizeExternalUrl(source.url)
      return this.makeClaim({
        sessionId,
        sourceId: 'SRC_SEARCH',
        toolName: 'deepseek_web_search',
        args: input,
        subject: input.query,
        predicate: 'webSearchResult',
        value: {
          summary: normalized.answer,
          url: sourceUrl,
          title: source.title,
          snippet: source.snippet
        },
        identity: classifySearchIdentity(sourceUrl),
        validForMs: 24 * 60 * 60 * 1000,
        explicitSourceRef: sourceUrl,
        scope
      })
    })
    return {
      sourceId: 'SRC_SEARCH',
      toolName: 'deepseek_web_search',
      claims: await this.persistClaims(claims),
      fromCache: false,
      search: normalized
    }
  }

  private async runXhsRepresentative(
    input: {
      sessionId: string
      queryKind: XhsQueryKind
      query: string
      scope?: EvidenceScope | null
    },
    operationId?: string
  ): Promise<SourceQueryOutcome> {
    const normalized = await executeXhsResearch({
      queryKind: input.queryKind,
      query: input.query,
      invoke: (toolName, args) =>
        this.invokeTool('SRC_XHS', input.sessionId, toolName, args, 60_000, operationId)
    })
    const predicate =
      input.queryKind === 'POSITIVE_LOCATION'
        ? 'xiaohongshuPositiveResult'
        : 'xiaohongshuAvoidanceResult'
    const claims = normalized.notes.map((note) =>
      applyPromotionOverride(
        this.makeClaim({
          sessionId: input.sessionId,
          sourceId: 'SRC_XHS',
          toolName: 'search_feeds',
          args: { query: input.query, queryKind: input.queryKind },
          subject: note.title,
          predicate,
          value: {
            query: input.query,
            queryKind: input.queryKind,
            title: note.title,
            author: note.author,
            noteType: note.noteType,
            text: note.text,
            enriched: note.enriched,
            audit: normalized.audit
          },
          identity: 'INDEPENDENT_UGC',
          verificationStatus: 'UNVERIFIED',
          validForMs: 7 * 24 * 60 * 60 * 1000,
          explicitSourceRef: note.sourceUrl,
          notes:
            input.queryKind === 'POSITIVE_LOCATION'
              ? '小红书正向检索结果；外部文本仅作为不可信 UGC 数据处理。'
              : '小红书避雷检索结果；风险信号不代表已证实，也不会自动排除目的地。',
          scope: input.scope ?? null
        })
      )
    )
    return {
      sourceId: 'SRC_XHS',
      toolName: 'search_feeds',
      claims: await this.persistClaims(claims),
      fromCache: false
    }
  }

  private xhsRankingSourceClaims(
    sessionId: string,
    batch: XhsRankingBatchResult,
    scope: EvidenceScope | null = null
  ): EvidenceClaim[] {
    return batch.notes.map((note) =>
      applyPromotionOverride(
        this.makeClaim({
          sessionId,
          sourceId: 'SRC_XHS',
          toolName: 'get_feed_detail',
          args: {
            query: note.query,
            sampleGroup: note.sampleGroup,
            loadAllComments: false
          },
          subject: note.title,
          predicate: 'xiaohongshuRankingSource',
          value: {
            query: note.query,
            sampleGroup: note.sampleGroup,
            title: note.title,
            author: note.author,
            noteType: note.noteType,
            text: note.text,
            enriched: true
          },
          identity: 'INDEPENDENT_UGC',
          verificationStatus: 'UNVERIFIED',
          validForMs: 7 * 24 * 60 * 60 * 1000,
          explicitSourceRef: note.sourceUrl,
          notes:
            note.sampleGroup === 'RECOMMEND'
              ? '小红书推荐样本详情；外部文本仅作为不可信 UGC 数据处理。'
              : '小红书避雷样本详情；风险线索未核验且不会自动排除景点。',
          scope
        })
      )
    )
  }

  private mapClaims(
    sessionId: string,
    input: { address: string; city: string },
    normalized: { name: string; city: string; address: string; lng: number; lat: number },
    scope: EvidenceScope | null = null
  ): EvidenceClaim[] {
    return [
      this.makeClaim({
        sessionId,
        sourceId: 'SRC_MAP',
        toolName: 'maps_geo',
        args: input,
        subject: normalized.name,
        predicate: 'coordinates',
        value: {
          city: normalized.city,
          address: normalized.address,
          lng: normalized.lng,
          lat: normalized.lat
        },
        identity: 'OFFICIAL',
        validForMs: 10 * 365 * 24 * 60 * 60 * 1000,
        scope
      })
    ]
  }

  private makeClaim(input: {
    sessionId: string
    sourceId: Extract<ExternalSourceId, EvidenceClaim['sourceId']>
    toolName: string
    args: Record<string, unknown>
    subject: string
    predicate: string
    value: EvidenceClaim['value']
    identity: ContentIdentity
    verificationStatus?: EvidenceClaim['verificationStatus']
    validForMs: number
    explicitSourceRef?: string
    notes?: string | null
    scope?: EvidenceScope | null
  }): EvidenceClaim {
    const observedAt = this.now().toISOString()
    const sourceRef =
      input.explicitSourceRef ??
      `${input.sourceId}:${input.toolName}:${digestArgs(input.toolName, input.args)}`
    return EvidenceClaimSchema.parse({
      claimId: deterministicClaimId({
        sourceId: input.sourceId,
        sourceRef,
        subject: input.subject,
        predicate: input.predicate,
        scope: input.scope ?? null
      }),
      sessionId: input.sessionId,
      subject: input.subject,
      predicate: input.predicate,
      value: input.value,
      sourceId: input.sourceId,
      sourceRef,
      contentIdentity: input.identity,
      verificationStatus: input.verificationStatus ?? 'VERIFIED',
      observedAt,
      validUntil: new Date(this.now().getTime() + input.validForMs).toISOString(),
      confidence: null,
      conflictsWith: [],
      notes: input.notes ?? null,
      scope: input.scope ?? null
    })
  }

  private persistClaims(claims: EvidenceClaim[]): Promise<EvidenceClaim[]> {
    return this.evidence.addMany(claims)
  }

  private async prepareSource(
    sourceId: ExternalSourceId,
    updateHealth = true
  ): Promise<{
    credential: string | undefined
    credentials: Partial<Record<CredentialId, string>>
    sourceConfig: SourceConfig
  }> {
    const definition = SOURCE_DEFINITIONS[sourceId]
    const requiredCredentialIds = [
      ...(definition.credentialId ? [definition.credentialId] : []),
      ...(definition.additionalCredentialIds ?? [])
    ]
    const credentialIds = [...requiredCredentialIds, ...(definition.optionalCredentialIds ?? [])]
    const credentials: Partial<Record<CredentialId, string>> = {}
    try {
      const sourceConfig = await this.config.sourceConfigStore.get()
      for (const id of credentialIds) {
        const value = await this.credentialReader(id)
        if (value) credentials[id] = value
      }
      const credential = definition.credentialId ? credentials[definition.credentialId] : undefined
      const configured = requiredCredentialIds.every((id) => Boolean(credentials[id]))
      const productionConfigured = configured && !definition.discoveryOnly
      if (updateHealth) this.health.setConfigured(sourceId, productionConfigured)
      if (!configured || (updateHealth && definition.discoveryOnly)) {
        throw new AppError('SOURCE_UNCONFIGURED', `${sourceId} 尚未配置。`, {
          userHint:
            sourceId === 'SRC_SEARCH'
              ? '请先在设置中录入 DeepSeek 官方与 Serper Search API Key。'
              : `请先在设置中配置 ${sourceId} 凭据。`
        })
      }
      return { credential, credentials, sourceConfig }
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError('INTERNAL_SERVICE_NOT_READY', '数据源配置准备失败。', {
        cause: error,
        userHint: '数据源配置暂时不可读取，请稍后重试。'
      })
    }
  }

  private async syncConfigurationStatus(): Promise<void> {
    await this.config.sourceConfigStore.get()
    for (const definition of Object.values(SOURCE_DEFINITIONS)) {
      const requiredCredentialIds = [
        ...(definition.credentialId ? [definition.credentialId] : []),
        ...(definition.additionalCredentialIds ?? [])
      ]
      const configured =
        (await Promise.all(requiredCredentialIds.map((id) => this.credentialReader(id)))).every(
          Boolean
        ) && !definition.discoveryOnly
      this.health.setConfigured(definition.sourceId, configured)
    }
  }

  private createSession(
    sourceId: ExternalSourceId,
    credential: string | undefined,
    credentials: Partial<Record<CredentialId, string>>,
    sourceConfig: SourceConfig
  ): SourceSession {
    if (this.config.createSession) {
      return this.config.createSession({ sourceId, credential, credentials, sourceConfig })
    }
    if (sourceId === 'SRC_RAIL') {
      return createStdioSourceSession({
        ...railMcpLaunchInput(),
        onDiagnostic: (diagnostic) =>
          this.config.log?.('MCP_CONNECT_DIAGNOSTIC', 'Rail MCP 连接在工具发现前失败。', {
            sourceId,
            errorCode: diagnostic
          })
      })
    }
    if (sourceId === 'SRC_XHS') {
      return this.xhsSidecarRuntime.createSession()
    }
    if (sourceId === 'SRC_FLIGHT') return createVariflightSourceSession()
    if (!credential) throw new AppError('SOURCE_UNCONFIGURED', `${sourceId} 缺少凭据。`)
    if (sourceId === 'SRC_MAP') {
      const url = new URL('https://mcp.amap.com/mcp')
      url.searchParams.set('key', credential)
      return createHttpSourceSession({ url })
    }
    if (sourceId === 'SRC_HOTEL') {
      return createHttpSourceSession({
        url: new URL('https://mcp.rollinggo.cn/mcp'),
        headers: { authorization: `Bearer ${credential}` }
      })
    }
    if (!existsSync(this.config.paths.deepSeekSearchMcpExecutable)) {
      throw new AppError('SOURCE_UNCONFIGURED', 'Serper + DeepSeek 搜索 MCP 运行时未安装。', {
        userHint: '请先在 mcp-servers/deepseek-web-search 中执行 uv sync，再重新探测。'
      })
    }
    const serperSearchKey = credentials.SERPER_SEARCH
    if (!serperSearchKey) {
      throw new AppError('SOURCE_UNCONFIGURED', 'Serper Search API Key 尚未配置。', {
        userHint: '请先在设置中录入 Serper Search API Key。'
      })
    }
    return createStdioSourceSession({
      command: this.config.paths.deepSeekSearchMcpExecutable,
      args: [],
      env: deepSeekSearchEnvironment(credential, serperSearchKey)
    })
  }

  private admitQuota(sourceId: ExternalSourceId, toolName: string): void {
    if (sourceId !== 'SRC_MAP') return
    const bucket = amapBucket(toolName)
    const limit = this.amapQuotas[bucket]
    this.poiCache.assertQuotaAvailable(bucket, limit, this.now())
    const used = this.poiCache.incrementQuota(bucket, this.now())
    if (used === Math.floor(limit * 0.8)) {
      this.config.log?.('SOURCE_RATE_LIMITED', `${bucket} 已达到 80% 本地告警线。`, {
        sourceId,
        count: used
      })
    }
  }

  private async schedule<T>(sourceId: ExternalSourceId, operation: () => Promise<T>): Promise<T> {
    const previous = this.serialTail
    let release: () => void = () => undefined
    this.serialTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      if (sourceId === 'SRC_MAP') {
        const wait = Math.max(0, 500 - (this.now().getTime() - this.lastAmapStart))
        if (wait > 0) await this.sleep(wait)
        this.lastAmapStart = this.now().getTime()
      }
      return await operation()
    } finally {
      release()
    }
  }

  private async handleInvocationFailure(sourceId: ExternalSourceId, error: unknown): Promise<void> {
    if (error instanceof AppError && ['SOURCE_DRIFT', 'SOURCE_CANCELLED'].includes(error.code))
      return
    const code = error instanceof AppError ? error.code : 'SOURCE_UNREACHABLE'
    await this.health.markNetworkFailure(sourceId, code)
  }

  private async handleInvocationFailureSafely(
    sourceId: ExternalSourceId,
    error: unknown
  ): Promise<void> {
    try {
      await this.handleInvocationFailure(sourceId, error)
    } catch {
      // A secondary health-write failure must not replace the safe primary error.
    }
  }

  private trackSession(operationId: string | undefined, session: SourceSession): void {
    if (operationId) this.activeSessions.set(operationId, session)
  }

  private untrackSession(operationId: string | undefined, session: SourceSession): void {
    if (operationId && this.activeSessions.get(operationId) === session) {
      this.activeSessions.delete(operationId)
    }
  }

  private assertNotCancelled(operationId: string | undefined): void {
    if (operationId && this.cancelledOperations.has(operationId)) {
      throw new AppError('SOURCE_CANCELLED', '数据源查询已取消。')
    }
  }

  private cancelledError(operationId: string | undefined, error: unknown): unknown {
    return operationId && this.cancelledOperations.has(operationId)
      ? new AppError('SOURCE_CANCELLED', '数据源查询已取消。', { cause: error })
      : error
  }

  private getTransientGeocode(
    address: string,
    city: string
  ): { expiresAt: number; lng: number; lat: number } | null {
    const now = this.now().getTime()
    const key = transientGeocodeKey(address, city)
    const cached = this.transientGeocodes.get(key)
    if (!cached) return null
    if (cached.expiresAt <= now) {
      this.transientGeocodes.delete(key)
      return null
    }
    return cached
  }
}

function railDiscoveryArgs(request: RailTicketDiscoverySourceRequest): Record<string, unknown> {
  return {
    date: request.date,
    fromStation: request.fromStation,
    toStation: request.toStation,
    format: 'json'
  }
}

function normalizeRailDiscoveryOptions(
  request: RailTicketDiscoverySourceRequest,
  result: RailToolResult
): RailOption[] {
  const tickets = RailTicketsSchema.parse(JSON.parse(firstMcpText(result)))
  const seen = new Set<string>()
  const options = tickets.flatMap((ticket) => {
    const trainNo = visibleRailTrainCode(ticket)
    if (seen.has(trainNo)) return []
    seen.add(trainNo)
    const normalized = normalizeRailJourney(ticket, {
      ...request,
      candidateId: 'discovery',
      trainNo
    })
    return [
      RailOptionSchema.parse({
        direction: request.direction,
        trainNo: normalized.trainNo,
        serviceDate: normalized.serviceDate,
        fromStation: normalized.from,
        toStation: normalized.to,
        departureTime: normalized.departureTime,
        arrivalTime: normalized.arrivalTime,
        startAt: normalized.startAt,
        endAt: normalized.endAt,
        title: normalized.title
      })
    ]
  })
  if (options.length === 0) {
    throw new AppError('GATE_BLOCKED', `${request.direction} 未返回可选择车次。`, {
      userHint: '12306 本次没有返回可校验车次，请检查日期与站点后重新授权查询。'
    })
  }
  return options.slice(0, 20)
}

export function gateDiscoveredTools(input: {
  policy: PolicyService
  sourceId: string
  discovered: McpToolDescriptor[]
  allowlist: ReadonlySet<string>
  contracts: Readonly<Record<string, unknown>>
  recordBlocked: (sourceId: string, toolName: string, reason: string) => void
}): Map<string, McpToolDescriptor> {
  const registered = new Map<string, McpToolDescriptor>()
  for (const tool of input.discovered) {
    const verdict = input.policy.checkTool(tool.name, tool.description, input.allowlist)
    if (verdict === true && input.contracts[tool.name]) {
      registered.set(tool.name, tool)
    } else {
      input.recordBlocked(
        input.sourceId,
        tool.name,
        verdict === true ? 'NOT_IN_ALLOWLIST' : verdict
      )
    }
  }
  return registered
}

function digestArgs(toolName: string, args: Record<string, unknown>): string {
  const entries = Object.entries(args)
    .filter(([key]) => !/key|token|authorization|secret/i.test(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${shortHash(JSON.stringify(value))}`)
  return `v1|tool=${toolName}|keys=${entries.map((entry) => entry.split(':')[0]).join(',')}|values=${entries.join(',')}`
}

function transientGeocodeKey(address: string, city: string): string {
  return createHash('sha256')
    .update(`${city.normalize('NFKC')}\n${address.normalize('NFKC')}`)
    .digest('hex')
}

function timedTransferWindow(
  timingBasis: TimedMapGroundTransferSourceRequest['timingBasis'],
  railAnchorAt: string | null,
  durationSeconds: number
): { startAt: string | null; endAt: string | null } {
  if (!railAnchorAt) return { startAt: null, endAt: null }
  if (timingBasis === 'ARRIVE_BY_RAIL') {
    const endAt = shiftIsoPreservingOffset(railAnchorAt, -45 * 60)
    return {
      startAt: shiftIsoPreservingOffset(endAt, -durationSeconds),
      endAt
    }
  }
  return {
    startAt: railAnchorAt,
    endAt: shiftIsoPreservingOffset(railAnchorAt, durationSeconds)
  }
}

function shiftIsoPreservingOffset(value: string, seconds: number): string {
  const offset = /(Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1]
  const timestamp = new Date(value).getTime()
  if (!offset || Number.isNaN(timestamp)) return value
  if (offset === 'Z') return new Date(timestamp + seconds * 1000).toISOString()
  const sign = offset.startsWith('-') ? -1 : 1
  const [hours, minutes] = offset.slice(1).split(':').map(Number)
  const offsetMinutes = sign * ((hours ?? 0) * 60 + (minutes ?? 0))
  return `${new Date(timestamp + seconds * 1000 + offsetMinutes * 60_000)
    .toISOString()
    .slice(0, -1)}${offset}`
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 10)
}

function zodMissingPaths(error: ZodError): string[] {
  return error.issues.map((issue) => issue.path.join('.') || '<root>')
}

function isRetryableExternalError(error: unknown): boolean {
  return (
    error instanceof AppError &&
    ['MCP_TIMEOUT', 'MCP_PROTOCOL_ERROR', 'SOURCE_UNREACHABLE'].includes(error.code)
  )
}

function normalizeRailRoundTripError(error: unknown, phase: RailRoundTripPhase): AppError {
  if (error instanceof AppError) return error
  if (phase === 'call' && (error instanceof ZodError || error instanceof SyntaxError)) {
    return new AppError('SOURCE_DRIFT', 'Rail MCP 工具返回结构已漂移。', {
      cause: error,
      userHint: '12306 返回结构无法验证，请稍后刷新或手工提供车次。'
    })
  }
  if (phase === 'register') {
    return new AppError('INTERNAL_SERVICE_NOT_READY', 'Rail MCP 工具注册失败。', {
      cause: error,
      userHint: 'Rail MCP 工具暂时无法完成安全注册，请稍后重试。'
    })
  }
  if (phase === 'call') {
    return new AppError('SOURCE_UNREACHABLE', 'Rail MCP 工具调用失败。', {
      cause: error,
      userHint: '12306 查询暂时不可用，请稍后重试或手工提供车次。'
    })
  }
  return new AppError('MCP_PROTOCOL_ERROR', `Rail MCP ${phase} 失败。`, {
    cause: error,
    userHint:
      phase === 'connect'
        ? '本地 Rail MCP 无法建立连接，请检查固定版本运行时。'
        : '本地 Rail MCP 无法发现只读工具，请检查固定版本运行时。'
  })
}

function normalizeRailSessionCloseError(error: unknown): AppError {
  if (error instanceof AppError) return error
  return new AppError('MCP_PROTOCOL_ERROR', 'Rail MCP 会话关闭失败。', {
    cause: error,
    userHint: '本地 Rail MCP 会话未能正常结束，请稍后重试。'
  })
}

function amapBucket(toolName: string): AmapQuotaBucket {
  if (['maps_text_search', 'maps_around_search', 'maps_search_detail'].includes(toolName)) {
    return 'AMAP_SEARCH'
  }
  if (toolName === 'maps_weather') return 'AMAP_WEATHER'
  return 'AMAP_LBS'
}

function summarizeHotelCoverage(input: unknown): HotelAcceptanceCoverage {
  const result = McpTextToolResultSchema.parse(input)
  const hotels = HotelSearchNormalizedSchema.parse(
    JSON.parse(firstMcpText(result))
  ).hotelInformationList
  const ranges = new Map<string, { currency: string; count: number; min: number; max: number }>()
  let pricedResultCount = 0

  for (const hotel of hotels) {
    const price = hotel.price
    if (!price?.hasPrice || typeof price.lowestPrice !== 'number') continue
    pricedResultCount += 1
    const currency = safeCurrencyCode(price.currency)
    const current = ranges.get(currency)
    if (current) {
      current.count += 1
      current.min = Math.min(current.min, price.lowestPrice)
      current.max = Math.max(current.max, price.lowestPrice)
    } else {
      ranges.set(currency, {
        currency,
        count: 1,
        min: price.lowestPrice,
        max: price.lowestPrice
      })
    }
  }

  return {
    resultCount: hotels.length,
    pricedResultCount,
    lowestPriceRanges: [...ranges.values()].sort((left, right) =>
      left.currency.localeCompare(right.currency)
    )
  }
}

function safeCurrencyCode(value: string | null | undefined): string {
  const normalized = value?.trim().toUpperCase() ?? ''
  return /^[A-Z]{3}$/.test(normalized) ? normalized : 'UNKNOWN'
}

function normalizeSearchResult(input: unknown): ReturnType<typeof SearchNormalizedSchema.parse> {
  const response = assertDeepSeekSearchSucceeded(input)
  return SearchNormalizedSchema.parse({
    answer: response.answer,
    model: response.model,
    searchProvider: response.search_provider,
    sources: response.sources,
    usage: normalizeSearchUsage(response.usage),
    audit: normalizeSearchAudit(response.audit)
  })
}

function normalizeSearchProgressMessage(message: unknown): SearchStreamPayload | null {
  if (typeof message !== 'string') return null
  let raw: unknown
  try {
    raw = JSON.parse(message)
  } catch {
    return null
  }
  const parsed = DeepSeekSearchProgressMessageSchema.safeParse(raw)
  if (!parsed.success) return null
  switch (parsed.data.kind) {
    case 'SEARCH_STARTED':
      return { kind: 'SEARCH_STARTED' }
    case 'SEARCH_RESULTS':
      return { kind: 'SEARCH_RESULTS', sources: parsed.data.sources }
    case 'ANSWER_DELTA':
      return { kind: 'ANSWER_DELTA', delta: parsed.data.delta }
    case 'USAGE':
      return SearchStreamPayloadSchema.parse({
        kind: 'USAGE',
        usage: normalizeSearchUsage(parsed.data.usage),
        audit: normalizeSearchAudit(parsed.data.audit)
      })
  }
}

function normalizeSearchUsage(input: {
  input_tokens: number
  output_tokens: number
  cached_input_tokens: number
  reasoning_tokens: number
  total_tokens: number
}): Record<string, number> {
  return {
    inputTokens: input.input_tokens,
    outputTokens: input.output_tokens,
    cachedInputTokens: input.cached_input_tokens,
    reasoningTokens: input.reasoning_tokens,
    totalTokens: input.total_tokens
  }
}

function normalizeSearchAudit(input: {
  search_api_calls: 1
  search_result_count: number
  grounding_characters: number
  native_web_search_calls: 0
  native_open_page_calls: 0
  open_page_tokens: 0
}): Record<string, number> {
  return {
    searchApiCalls: input.search_api_calls,
    searchResultCount: input.search_result_count,
    groundingCharacters: input.grounding_characters,
    nativeWebSearchCalls: input.native_web_search_calls,
    nativeOpenPageCalls: input.native_open_page_calls,
    openPageTokens: input.open_page_tokens
  }
}

function parseDeepSeekSearchResult(input: unknown): DeepSeekSearchResult {
  const envelope = McpTextToolResultSchema.parse(input)
  return DeepSeekSearchResultSchema.parse(JSON.parse(firstMcpText(envelope)))
}

function assertDeepSeekSearchSucceeded(
  input: unknown
): Extract<DeepSeekSearchResult, { ok: true }> {
  const result = parseDeepSeekSearchResult(input)
  if (result.ok) return result
  const userHint = deepSeekSearchUserHint(result.error_code)
  switch (result.error_code) {
    case 'CONFIGURATION':
      throw new AppError('SOURCE_UNCONFIGURED', 'Serper + DeepSeek 搜索配置无效。', { userHint })
    case 'INVALID_INPUT':
      throw new AppError('INPUT_INVALID', '网页搜索输入无效。', { userHint })
    case 'TIMEOUT':
      throw new AppError('MCP_TIMEOUT', '网页搜索与生成请求超时。', { userHint })
    case 'MISSING_ANSWER':
      throw new DeepSeekSearchValidationError(
        'MISSING_ANSWER',
        'DeepSeek 流式生成缺少答案。',
        userHint
      )
    case 'MISSING_CITATIONS':
      throw new DeepSeekSearchValidationError(
        'MISSING_CITATIONS',
        'Serper Search 缺少 HTTPS 搜索结果。',
        userHint
      )
    case 'INVALID_RESPONSE':
      throw new DeepSeekSearchValidationError(
        'RESULT_SCHEMA_DRIFT',
        'Serper + DeepSeek 搜索响应无法归类。',
        userHint
      )
    default:
      throw new AppError('SOURCE_UNREACHABLE', '网页搜索与生成请求失败。', { userHint })
  }
}

function deepSeekSearchUserHint(
  errorCode: Exclude<DeepSeekSearchResult['error_code'], null>
): string {
  switch (errorCode) {
    case 'CONFIGURATION':
      return 'Serper Search 或 DeepSeek 官方 API 配置无效，请检查本机配置。'
    case 'INVALID_INPUT':
      return '搜索问题不能为空且不能超过 4000 个字符。'
    case 'UNAUTHORIZED':
      return 'Serper Search 或 DeepSeek 官方 API 鉴权失败，请重新录入对应 API Key。'
    case 'RATE_LIMITED':
      return '搜索或生成服务当前限流，请稍后再试。'
    case 'TIMEOUT':
      return '搜索或生成服务请求超时。'
    case 'UPSTREAM_UNAVAILABLE':
      return '搜索或生成服务当前不可用。'
    case 'MISSING_ANSWER':
      return '搜索结果缺少可用答案，请手工提供官方页面。'
    case 'MISSING_CITATIONS':
      return 'Serper Search 未返回可核验的 HTTPS 结果，请手工提供官方页面。'
    case 'INVALID_RESPONSE':
      return '搜索结果结构无法验证，请手工提供官方页面。'
    case 'UNKNOWN_PROVIDER_ERROR':
      return '搜索或生成服务请求失败。'
  }
}

class DeepSeekSearchValidationError extends AppError {
  constructor(
    readonly validationCategory: NonNullable<LiveAcceptanceOutcome['validationCategory']>,
    message: string,
    userHint: string
  ) {
    super('SOURCE_DRIFT', message, { userHint })
  }
}

function liveAcceptanceValidationCategory(
  error: unknown,
  sourceId: ExternalSourceId,
  stage: LiveAcceptanceOutcome['stage']
): LiveAcceptanceOutcome['validationCategory'] {
  if (error instanceof DeepSeekSearchValidationError) return error.validationCategory
  if (sourceId === 'SRC_SEARCH' && stage === 'validate' && error instanceof ZodError) {
    return 'RESULT_SCHEMA_DRIFT'
  }
  return undefined
}

function boundedDiscoveryDescriptors(descriptors: McpToolDescriptor[]): McpToolDescriptor[] {
  if (descriptors.length > 64) {
    throw new AppError('MCP_PROTOCOL_ERROR', 'MCP 工具发现结果超过安全上限。')
  }
  return descriptors.map((descriptor) => {
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(descriptor.name)) {
      throw new AppError('MCP_PROTOCOL_ERROR', 'MCP 工具名称不符合安全格式。')
    }
    if (descriptor.description.length > 4_000) {
      throw new AppError('MCP_PROTOCOL_ERROR', 'MCP 工具描述超过安全上限。')
    }
    let schema: string | undefined
    try {
      schema = JSON.stringify(descriptor.inputSchema)
    } catch {
      throw new AppError('MCP_PROTOCOL_ERROR', 'MCP 工具输入 Schema 无法安全序列化。')
    }
    if (!schema || schema.length > 65_536) {
      throw new AppError('MCP_PROTOCOL_ERROR', 'MCP 工具输入 Schema 超过安全上限。')
    }
    return descriptor
  })
}

function deepSeekSearchEnvironment(
  apiKey: string,
  serperSearchApiKey: string
): Record<string, string> {
  const environment: Record<string, string> = {
    DEEPSEEK_API_KEY: apiKey,
    DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
    DEEPSEEK_MODEL: 'deepseek-v4-flash',
    SERPER_API_KEY: serperSearchApiKey,
    SERPER_BASE_URL: 'https://google.serper.dev',
    PYTHONIOENCODING: 'utf-8'
  }
  for (const name of [
    'PATH',
    'Path',
    'SYSTEMROOT',
    'SystemRoot',
    'WINDIR',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'HOME',
    'LANG',
    'LC_ALL'
  ]) {
    const value = process.env[name]
    if (value) environment[name] = value
  }
  return environment
}

function classifySearchIdentity(url: string): ContentIdentity {
  const hostname = new URL(url).hostname.toLowerCase()
  if (hostname.endsWith('.gov.cn') || hostname.endsWith('.gov')) return 'OFFICIAL'
  return 'UNKNOWN'
}

function sanitizeExternalUrl(value: string): string {
  const url = new URL(value)
  for (const key of [...url.searchParams.keys()]) {
    if (/api[-_]?key|key|token|secret|signature|credential|authorization/i.test(key)) {
      url.searchParams.delete(key)
    }
  }
  url.hash = ''
  return url.toString()
}

declare module 'cordis' {
  interface Context {
    tools: ToolRegistryService
  }
}

export const toolsPlugin: Plugin.Function<Context, ToolRegistryConfig> = (ctx, config) => {
  void ctx.eventLog
  void ctx.travelState
  const service = new ToolRegistryService(ctx, config)
  ctx.set('tools', service)
  ctx.on('dispose', () => service.close())
}
toolsPlugin.inject = ['policy', 'eventLog', 'travelState']
