import { createHash, randomUUID } from 'node:crypto'
import type { Context, Plugin } from 'cordis'
import { ulid } from 'ulid'
import { AppError, serializeError } from '../../shared/errors'
import {
  ChatTurnOutcomeSchema,
  SessionSummarySchema,
  type ChatTurnOutcome,
  type EnvelopeChoiceRequest,
  type SessionSummary
} from '../../shared/schema/chat'
import { SplitPlanSchema, type SplitPlan } from '../../shared/schema/envelope'
import {
  ConflictResolveRequestSchema,
  D4ProgressEventSchema,
  D4SnapshotSchema,
  DestinationGenerateRequestSchema,
  FixedDestinationConfirmRequestSchema,
  ManualResearchChecklistRequestSchema,
  DestinationSelectRequestSchema,
  ResearchConfirmRequestSchema,
  ResearchDispositionRequestSchema,
  ResearchPrepareRequestSchema,
  NodeResearchPlanPreviewSchema,
  RouteNodeD4SnapshotSchema,
  RouteResearchConfirmRequestSchema,
  RouteResearchConflictRequestSchema,
  RouteResearchDispositionRequestSchema,
  RouteResearchExecuteRequestSchema,
  RouteResearchManualRequestSchema,
  RouteResearchPreviewRequestSchema,
  RouteResearchProgressEventSchema,
  RouteResearchSnapshotRequestSchema,
  RouteResearchUserPasteRequestSchema,
  XhsRankingExecuteRequestSchema,
  XhsRankingPreviewRequestSchema,
  XhsRankingPreviewSchema,
  UserPasteRequestSchema,
  type ConflictResolveRequest,
  type D4ProgressEvent,
  type D4Snapshot,
  type DestinationGenerateRequest,
  type FixedDestinationConfirmRequest,
  type ManualResearchChecklistRequest,
  type DestinationSelectRequest,
  type ResearchConfirmRequest,
  type ResearchDispositionRequest,
  type ResearchPrepareRequest,
  type NodeResearchPlanPreview,
  type RouteNodeD4Snapshot,
  type RouteNodeResearchScope,
  type RouteNodeResearchState,
  type RouteResearchConfirmRequest,
  type RouteResearchConflictRequest,
  type RouteResearchDispositionRequest,
  type RouteResearchExecuteRequest,
  type RouteResearchManualRequest,
  type RouteResearchPreviewRequest,
  type RouteResearchProgressEvent,
  type RouteResearchSnapshotRequest,
  type RouteResearchUserPasteRequest,
  type SourceResearchFailure,
  type SourceSubagentResult,
  type XhsRankingExecuteRequest,
  type XhsRankingPreview,
  type UserPasteRequest
} from '../../shared/schema/d4'
import {
  EvidenceClaimSchema,
  type EvidenceClaim,
  type EvidenceScope
} from '../../shared/schema/evidence'
import {
  D5ProgressEventSchema,
  D5SourcePlanExecuteRequestSchema,
  D5SourcePlanExecutionResultSchema,
  D5SourcePlanPreviewRequestSchema,
  D5SourcePlanPreviewSchema,
  D5SourceOutcomeSchema,
  D5SnapshotSchema,
  RailDiscoveryPreviewSchema,
  RailDiscoveryRequestSchema,
  RailDiscoveryResultSchema,
  RailSelectionRequestSchema,
  RailSelectionResultSchema,
  SkeletonConfirmRequestSchema,
  SkeletonPatchRequestSchema,
  SkeletonPrepareRequestSchema,
  StayPrepareRequestSchema,
  StayPasteRequestSchema,
  StaySelectRequestSchema,
  TransportPrepareRequestSchema,
  TransportSelectRequestSchema,
  type D5ProgressEvent,
  type D5SourcePlanExecuteRequest,
  type D5SourcePlanExecutionResult,
  type D5SourcePlanPreview,
  type D5SourcePlanPreviewRequest,
  type D5SourceOutcome,
  type D5Snapshot,
  type RailDiscoveryPreview,
  type RailDiscoveryRequest,
  type RailDiscoveryResult,
  type RailOption,
  type RailSelectionRequest,
  type RailSelectionResult,
  type SkeletonConfirmRequest,
  type SkeletonPatchRequest,
  type SkeletonPrepareRequest,
  type StayPrepareRequest,
  type StayPasteRequest,
  type StaySelectRequest,
  type TransportPrepareRequest,
  type TransportSourceParameters,
  type TransportSelectRequest
} from '../../shared/schema/d5'
import {
  D6ProgressEventSchema,
  D6SnapshotRequestSchema,
  D6SnapshotSchema,
  TimelinePrepareRequestSchema,
  TimelinePublishRequestSchema,
  type D6ProgressEvent,
  type D6Snapshot,
  type TimelineDraft,
  type TimelinePrepareRequest,
  type TimelinePublishRequest
} from '../../shared/schema/d6'
import {
  D7SnapshotRequestSchema,
  D7SnapshotSchema,
  GateCRunRequestSchema,
  ItineraryExportRequestSchema,
  TaskDeriveRequestSchema,
  TaskUpdateRequestSchema,
  TaskUpdatedPayloadWriteSchema,
  type D7Snapshot,
  type ItineraryExportRequest,
  type TaskUpdateRequest
} from '../../shared/schema/d7'
import {
  TravelBasicsSchema,
  type TravelBasics,
  type TravelBasicsPatch
} from '../../shared/schema/interview'
import {
  MultiCityRouteSnapshotSchema,
  MultiCityRouteSnapshotRequestSchema,
  ManualRouteLegEvidenceRequestSchema,
  RouteCancelRequestSchema,
  RouteCandidatesPreparedPayloadSchema,
  RouteLegEvidenceValueSchema,
  RouteManualEvidenceAppliedPayloadSchema,
  RoutePlanExecuteRequestSchema,
  RoutePlanPreviewRequestSchema,
  RoutePlanPreviewSchema,
  RouteProgressEventSchema,
  RouteSelectRequestSchema,
  RouteSelectedPayloadSchema,
  type MultiCityRouteSnapshot,
  type ManualRouteLegEvidenceRequest,
  type RoutePlanExecuteRequest,
  type RoutePlanPreview,
  type RouteProgressEvent,
  type RouteSelectRequest,
  type RouteSourceOutcome
} from '../../shared/schema/itinerary'
import type { TimedMapGroundTransferSourceRequest } from '../../shared/schema/mcp/map'
import type { SessionEvent, SessionEventDraft } from '../../shared/schema/session-event'
import type { SourceQueryOutcome } from '../../shared/schema/source'
import type { TravelState } from '../../shared/schema/travel-state'
import { normalizeEvidenceSubject, unresolvedHardAnchorConflicts } from '../evidence-rules'
import { prepareItineraryExport, type PreparedExport } from '../export/d7-export'
import { materializeManualRouteLegEvidence } from '../manual-route-evidence'
import { deterministicClaimId } from '../mcp/evidence'
import { materializeManualResearch } from '../manual-research'
import { buildXhsDestinationTasks, SourceSubagentRunner } from '../source-subagent'
import { XHS_RANKING_FILTERS, xhsRankingQueries } from '../mcp/sources/xiaohongshu-ranking'
import { InterviewSkill, buildConfirmationCard } from '../skills/s01-interview'
import { assessM0Envelope, buildEnvelopeComparison } from '../skills/s02-envelope'
import { DestinationEvaluationSkill } from '../skills/s03-destination-evaluation'
import { isResearchExtractionEligible, ResearchSkill } from '../skills/s04-research'
import { XhsRankingSkill } from '../skills/s04-xhs-ranking'
import { VerificationSkill } from '../skills/s05-verification'
import { buildTransportCandidates } from '../skills/s06-transport'
import { buildSkeleton, slotItemsWithinEightKm } from '../skills/s07-skeleton'
import { buildStayCandidates } from '../skills/s08-lodging'
import {
  buildMultiCityRouteCandidates,
  buildMultiCityRouteSourcePlan,
  deriveMultiCityItineraryGoal
} from '../skills/s03-route-candidates'
import { createTimelineDraft, publishTimelineDraft } from '../skills/s10-timeline'
import { derivePreparationTasks } from '../skills/s11-task-derivation'
import { buildGateC } from '../skills/d7-gate'
import { applyTaskUpdate } from '../skills/d7-task-update'
import { summarizeRouteNodeResearchStates } from './travel-state'

type D4ProgressListener = (event: D4ProgressEvent) => void
type D5ProgressListener = (event: D5ProgressEvent) => void
type D6ProgressListener = (event: D6ProgressEvent) => void
type RouteProgressListener = (event: RouteProgressEvent) => void
type RouteResearchProgressListener = (event: RouteResearchProgressEvent) => void

const D5_EPHEMERAL_TTL_MS = 10 * 60 * 1000
const D4_XHS_PLAN_TTL_MS = 10 * 60 * 1000
const ROUTE_PLAN_TTL_MS = 10 * 60 * 1000

interface PendingXhsRankingPlan {
  preview: XhsRankingPreview
  stateDigest: string
  routeDigest: string
  expiresAt: number
}

interface RailDiscoveryCacheEntry {
  sessionId: string
  stateDigest: string
  expiresAt: number
  result: RailDiscoveryResult
  selection: RailSelectionResult | null
}

interface SourcePlanLocation {
  locationId: string
  label: string
  address: string
  city: string
  kind: D5SourcePlanPreview['geocodes'][number]['kind']
  cached: boolean
}

interface PendingSourcePlan {
  sessionId: string
  discoveryId: string
  stateDigest: string
  expiresAt: number
  exactAddress: string
  originLabel: string
  locations: SourcePlanLocation[]
  locationIds: {
    exactOrigin: string
    outboundFromStation: string
    outboundToStation: string
    stayArea: string
    returnFromStation: string
    returnToStation: string
  }
  preview: D5SourcePlanPreview
}

interface PendingTimelineDraft {
  sessionId: string
  basisSeq: number
  expiresAt: number
  draft: TimelineDraft
}

interface PendingRoutePlan {
  preview: RoutePlanPreview
  stateDigest: string
  expiresAt: number
}

interface PendingNodeResearchPlan {
  preview: NodeResearchPlanPreview
  stateDigest: string
  providerDigest: string
  expiresAt: number
}

export class CoordinatorService {
  private readonly partialBasics = new Map<string, TravelBasicsPatch>()
  private readonly interviewTurns = new Map<string, number>()
  private readonly interview: InterviewSkill
  private readonly destinationEvaluation: DestinationEvaluationSkill
  private readonly research: ResearchSkill
  private readonly xhsRanking: XhsRankingSkill
  private readonly verification: VerificationSkill
  private readonly sourceSubagent: SourceSubagentRunner
  private readonly pendingXhsRankingPlans = new Map<string, PendingXhsRankingPlan>()
  private readonly consumedXhsRankingOperations = new Map<string, number>()
  private readonly railDiscoveries = new Map<string, RailDiscoveryCacheEntry>()
  private readonly pendingSourcePlans = new Map<string, PendingSourcePlan>()
  private readonly consumedD5Operations = new Map<string, number>()
  private readonly earlyHotelOutcomes = new Map<string, D5SourceOutcome>()
  private readonly pendingTimelineDrafts = new Map<string, PendingTimelineDraft>()
  private readonly consumedD6Operations = new Map<string, number>()
  private readonly cancelledD6Operations = new Set<string>()
  private readonly pendingRoutePlans = new Map<string, PendingRoutePlan>()
  private readonly consumedRouteOperations = new Map<string, number>()
  private readonly pendingNodeResearchPlans = new Map<string, PendingNodeResearchPlan>()
  private readonly consumedNodeResearchOperations = new Map<string, number>()

  constructor(private readonly ctx: Context) {
    this.interview = new InterviewSkill(ctx.provider)
    this.destinationEvaluation = new DestinationEvaluationSkill(ctx.provider)
    this.research = new ResearchSkill(ctx.provider)
    this.xhsRanking = new XhsRankingSkill(ctx.provider)
    this.verification = new VerificationSkill(ctx.provider)
    this.sourceSubagent = new SourceSubagentRunner(async (task, operationId) => {
      const outcome =
        task.sourceId === 'SRC_SEARCH'
          ? await this.ctx.tools.runRepresentativeQuery(
              {
                sourceId: 'SRC_SEARCH',
                sessionId: task.sessionId,
                input: { query: task.query }
              },
              operationId,
              undefined,
              task.scope
            )
          : task.sourceId === 'SRC_MAP'
            ? await this.ctx.tools.runRepresentativeQuery(
                {
                  sourceId: 'SRC_MAP',
                  sessionId: task.sessionId,
                  input: { address: task.query, city: task.destination }
                },
                operationId,
                undefined,
                task.scope
              )
            : await this.ctx.tools.runXhsResearch(
                {
                  sessionId: task.sessionId,
                  queryKind: task.queryKind,
                  query: task.query,
                  scope: task.scope
                },
                operationId
              )
      if (outcome.sourceId !== task.sourceId || outcome.toolName !== task.toolName) {
        throw new AppError('INTERNAL_SCHEMA_MISMATCH', 'Source Subagent 返回了越权工具结果。')
      }
      return outcome.claims.map((claim) => claim.claimId)
    })
  }

  record(draft: SessionEventDraft): Promise<SessionEvent> {
    return this.ctx.travelState.record(draft)
  }

  async createSession(title: string | null): Promise<SessionSummary> {
    const sessionId = ulid()
    await this.record({
      sessionId,
      eventVersion: 2,
      type: 'session/created',
      payload: {
        title,
        linkedSessionGroup: null,
        splitIndex: null,
        basics: null,
        handoffs: []
      }
    })
    return SessionSummarySchema.parse(
      this.ctx.session.list().find((item) => item.sessionId === sessionId)
    )
  }

  listSessions(): SessionSummary[] {
    return this.ctx.session.list()
  }

  getSession(sessionId: string): SessionSummary {
    const item = this.ctx.session.list().find((session) => session.sessionId === sessionId)
    if (!item) throw new AppError('INPUT_INVALID', '会话不存在。')
    return item
  }

  async submitChatTurn(sessionId: string, text: string): Promise<ChatTurnOutcome> {
    const state = this.ctx.travelState.get(sessionId)
    if (!state) throw new AppError('INPUT_INVALID', '会话不存在。')
    if (state.stage !== 'STAGE_1' && state.stage !== 'STAGE_2') {
      throw new AppError('GATE_BLOCKED', '当前阶段不接受基础访谈。')
    }
    const turnNumber = (this.interviewTurns.get(sessionId) ?? state.interviewTurns) + 1
    const current = this.partialBasics.get(sessionId) ?? state.basics
    try {
      const step = await this.interview.run(sessionId, text, current, turnNumber)
      this.interviewTurns.set(sessionId, turnNumber)
      this.partialBasics.set(sessionId, { ...(current ?? {}), ...step.result.patch })
      if (step.result.readiness === 'BLOCKED') {
        const error = new AppError('GATE_BLOCKED', step.result.blockingReason ?? '基础访谈已阻塞。')
        return ChatTurnOutcomeSchema.parse({
          kind: 'BLOCKED',
          assistantText: error.userHint,
          error: serializeError(error),
          dependency: null
        })
      }
      if (step.result.readiness === 'INCOMPLETE') {
        return ChatTurnOutcomeSchema.parse({
          kind: 'QUESTION',
          assistantText: step.result.nextQuestion,
          nextQuestion: step.result.nextQuestion,
          turnNumber
        })
      }
      const basics = step.basics!
      await this.recordBasics(sessionId, basics, turnNumber)
      this.partialBasics.delete(sessionId)
      return this.outcomeForBasics(basics, turnNumber)
    } catch (error) {
      if (error instanceof AppError && error.code === 'MODEL_OUTPUT_INVALID') {
        return ChatTurnOutcomeSchema.parse({
          kind: 'BLOCKED',
          assistantText: error.userHint,
          error: serializeError(error),
          dependency: null
        })
      }
      throw error
    }
  }

  async updateConfirmation(sessionId: string, basicsInput: TravelBasics): Promise<ChatTurnOutcome> {
    const state = this.requireState(sessionId)
    const basics = TravelBasicsSchema.parse(basicsInput)
    const turnNumber = Math.max(1, state.interviewTurns)
    await this.recordBasics(sessionId, basics, turnNumber)
    return this.outcomeForBasics(basics, turnNumber)
  }

  async confirmBasics(sessionId: string): Promise<SessionSummary | ChatTurnOutcome> {
    const state = this.requireState(sessionId)
    if (!state.basics) throw new AppError('GATE_BLOCKED', '没有可确认的基础信息。')
    const assessment = assessM0Envelope(state.basics, {
      allowFuzzyDestination: state.basics.destinationCities.length === 0
    })
    if (!assessment.withinEnvelope) return this.outOfEnvelope(assessment, state.interviewTurns)
    await this.record({
      sessionId,
      eventVersion: 2,
      type: 'envelope/decision',
      payload: { assessment, decision: 'CONTINUE', splitPlan: null }
    })
    await this.record({
      sessionId,
      eventVersion: 2,
      type: 'stage/confirmed',
      payload: { fromStage: 'STAGE_1', toStage: 'STAGE_2', confirmed: true }
    })
    return this.getSession(sessionId)
  }

  async chooseEnvelope(input: EnvelopeChoiceRequest): Promise<SessionSummary[]> {
    const state = this.requireState(input.sessionId)
    if (!state.basics) throw new AppError('GATE_BLOCKED', '没有可处理的基础信息。')
    const assessment = assessM0Envelope(state.basics)
    if (assessment.withinEnvelope) throw new AppError('INPUT_INVALID', '当前行程未超出能力边界。')
    if (input.decision === 'ADJUST') return this.applyShrink(input, state.basics)
    if (!assessment.canSplit) throw new AppError('GATE_BLOCKED', '当前超出维度不能通过拆会话处理。')
    const splitPlan = this.createSplitPlan(input.sessionId, state.basics, input.rationale)
    for (const child of splitPlan.children) {
      if (!assessM0Envelope(child.basics).withinEnvelope) {
        throw new AppError('GATE_BLOCKED', `子会话 ${child.splitIndex} 仍超出 M0 包络。`)
      }
    }
    const intent = await this.record({
      sessionId: input.sessionId,
      eventVersion: 2,
      type: 'envelope/decision',
      payload: { assessment, decision: 'SPLIT', splitPlan }
    })
    await this.ensureSplitEvents(input.sessionId, intent.seq, splitPlan)
    await this.ctx.travelState.rebuildGroupAtomically([
      input.sessionId,
      ...splitPlan.children.map((child) => child.sessionId)
    ])
    return this.ctx.session
      .list()
      .filter((session) => session.linkedSessionGroup === splitPlan.linkedSessionGroup)
  }

  async generateDestinationCandidates(
    input: DestinationGenerateRequest,
    onProgress?: D4ProgressListener
  ): Promise<D4Snapshot> {
    const request = DestinationGenerateRequestSchema.parse(input)
    const state = this.requireD4State(request.sessionId, 'STAGE_2')
    if (
      !state.basics ||
      state.basics.destinationCities.length > 0 ||
      !state.basics.destinationIntent
    ) {
      throw new AppError('GATE_BLOCKED', '当前会话不需要生成目的地候选。')
    }
    this.emitD4Progress(
      onProgress,
      request,
      'DESTINATION_STARTED',
      null,
      '正在生成有来源的目的地候选。'
    )
    const candidates = await this.destinationEvaluation.run(
      request.sessionId,
      state.basics,
      this.ctx.tools.listEvidence(request.sessionId, 200)
    )
    await this.record({
      sessionId: request.sessionId,
      eventVersion: 2,
      type: 'destination/candidates-generated',
      payload: { candidates }
    })
    this.emitD4Progress(onProgress, request, 'COMPLETED', null, '目的地候选已生成，等待用户选择。')
    return this.d4Snapshot(request.sessionId)
  }

  async confirmFixedDestination(input: FixedDestinationConfirmRequest): Promise<D4Snapshot> {
    const request = FixedDestinationConfirmRequestSchema.parse(input)
    const state = this.requireD4State(request.sessionId, 'STAGE_2')
    const destinations = state.basics?.destinationCities
    if (!destinations) throw new AppError('GATE_BLOCKED', '没有可确认的基础信息。')
    if (destinations.length !== 1) {
      throw new AppError('GATE_BLOCKED', '固定目的地确认需要且只能包含一个城市。')
    }
    const currentCity = normalizeDestinationCity(destinations[0]!)
    if (currentCity !== normalizeDestinationCity(request.city)) {
      throw new AppError('INPUT_INVALID', '目的地已经变化，请刷新后重新确认。')
    }
    await this.record({
      sessionId: request.sessionId,
      eventVersion: 2,
      type: 'stage/confirmed',
      payload: {
        fromStage: 'STAGE_2',
        toStage: 'STAGE_3',
        confirmed: true,
        confirmation: { kind: 'FIXED_DESTINATION', city: currentCity }
      }
    })
    return this.d4Snapshot(request.sessionId)
  }

  async selectDestination(input: DestinationSelectRequest): Promise<D4Snapshot> {
    const request = DestinationSelectRequestSchema.parse(input)
    const state = this.requireD4State(request.sessionId, 'STAGE_2')
    const candidate = state.destinationCandidates.find((item) => item.id === request.candidateId)
    if (!candidate) throw new AppError('INPUT_INVALID', '目的地候选不存在或已经失效。')
    this.assertClaimIdsBelongToSession(request.sessionId, candidate.claimIds)
    await this.record({
      sessionId: request.sessionId,
      eventVersion: 2,
      type: 'destination/selected',
      payload: { candidateId: candidate.id, city: candidate.city }
    })
    await this.record({
      sessionId: request.sessionId,
      eventVersion: 2,
      type: 'stage/confirmed',
      payload: { fromStage: 'STAGE_2', toStage: 'STAGE_3', confirmed: true }
    })
    return this.d4Snapshot(request.sessionId)
  }

  async prepareResearch(
    input: ResearchPrepareRequest,
    onProgress?: D4ProgressListener
  ): Promise<D4Snapshot> {
    const request = ResearchPrepareRequestSchema.parse(input)
    const state = this.requireD4State(request.sessionId, 'STAGE_3')
    const basics = state.basics
    const destination = basics?.destinationCities[0]
    if (!basics || !destination || basics.destinationCities.length !== 1) {
      throw new AppError('GATE_BLOCKED', '研究前必须确认一个目的地城市。')
    }
    this.emitD4Progress(onProgress, request, 'RESEARCH_STARTED', null, '正在按来源串行研究。')
    const memberConstraints = basics.travelers.map((group) => ({
      ageBand: group.ageBand,
      count: group.count,
      stamina: group.stamina,
      functionalLimits: group.functionalLimits
    }))
    const sourceResults = await this.sourceSubagent.runSerial(
      [
        {
          taskId: randomUUID(),
          sessionId: request.sessionId,
          sourceId: 'SRC_SEARCH',
          destination,
          query: `${destination} 景点 体验 餐饮 官方 开放时间 预约 老人 儿童 步行 台阶`,
          toolName: 'deepseek_web_search',
          memberConstraints
        },
        ...buildXhsDestinationTasks({
          sessionId: request.sessionId,
          destination,
          memberConstraints
        })
      ],
      request.operationId
    )
    const sourceFailures: SourceResearchFailure[] = sourceResults.flatMap((result) =>
      result.status === 'FAILED'
        ? [
            {
              sourceId: result.sourceId,
              status: 'FAILED' as const,
              queryKind: result.queryKind,
              errorCode: result.errorCode,
              capabilityImpact: result.capabilityImpact,
              manualAlternative: result.manualAlternative
            }
          ]
        : []
    )
    if (
      sourceResults.some(
        (result) => result.status === 'FAILED' && result.errorCode === 'SOURCE_CANCELLED'
      )
    ) {
      throw new AppError('SOURCE_CANCELLED', 'D4 研究任务已由用户取消。')
    }
    for (const result of sourceResults) {
      this.emitD4Progress(
        onProgress,
        request,
        'SOURCE_COMPLETED',
        result.sourceId,
        result.status === 'SUCCEEDED'
          ? `${result.sourceId} 已写入 ${result.claimIds.length} 条证据。`
          : `${result.sourceId} 失败：${result.capabilityImpact}`
      )
    }

    const eligibleSourceClaims = currentOperationResearchClaims(
      this.ctx.tools.listEvidence(request.sessionId, 200),
      sourceResults
    )
    if (eligibleSourceClaims.length === 0) {
      await this.record({
        sessionId: request.sessionId,
        eventVersion: 2,
        type: 'research/checklist-prepared',
        payload: { entities: [], sourceFailures }
      })
      this.emitD4Progress(
        onProgress,
        request,
        'COMPLETED',
        null,
        '没有可核验来源，已保留明确失败信息。'
      )
      return this.d4Snapshot(request.sessionId)
    }

    const extracted = await this.research.run(request.sessionId, destination, eligibleSourceClaims)
    await this.ctx.tools.addEvidenceClaims(extracted.claims)
    const verified = await this.verification.run({
      sessionId: request.sessionId,
      destinationCity: destination,
      claims: extracted.claims,
      travelers: basics.travelers,
      now: new Date(),
      kinds: extracted.kinds,
      aliases: extracted.aliases
    })
    await this.ctx.tools.addEvidenceClaims(verified.claims)
    this.assertResearchEntities(request.sessionId, destination, verified.entities)
    await this.record({
      sessionId: request.sessionId,
      eventVersion: 2,
      type: 'research/checklist-prepared',
      payload: { entities: verified.entities, sourceFailures }
    })
    this.emitD4Progress(
      onProgress,
      request,
      'COMPLETED',
      null,
      '研究清单已生成，等待逐项处置和确认。'
    )
    return this.d4Snapshot(request.sessionId)
  }

  async prepareManualResearch(input: ManualResearchChecklistRequest): Promise<D4Snapshot> {
    const request = ManualResearchChecklistRequestSchema.parse(input)
    const state = this.requireD4State(request.sessionId, 'STAGE_3')
    const destinationCity = state.basics?.destinationCities[0]
    if (!destinationCity || state.basics?.destinationCities.length !== 1) {
      throw new AppError('GATE_BLOCKED', '人工研究前必须确认一个目的地城市。')
    }
    const existingClaims = this.ctx.tools.listEvidence(request.sessionId, 200)
    const userPasteClaimIds = new Set(
      existingClaims
        .filter((claim) => claim.sourceId === 'USER_PASTE')
        .map((claim) => claim.claimId)
    )
    if (
      request.items.some(
        (item) => item.sourceClaimId !== null && !userPasteClaimIds.has(item.sourceClaimId)
      )
    ) {
      throw new AppError('INPUT_INVALID', '关联的原始线索不属于当前会话或不是 USER_PASTE。')
    }
    const materialized = materializeManualResearch(request, destinationCity)
    this.assertResearchEntities(
      request.sessionId,
      destinationCity,
      materialized.entities,
      materialized.claims
    )
    await this.record({
      sessionId: request.sessionId,
      eventVersion: 2,
      type: 'research/checklist-prepared',
      payload: {
        entities: materialized.entities,
        sourceFailures: [],
        finalClaims: materialized.claims,
        manualResearchSummary: materialized.summary
      }
    })
    return this.d4Snapshot(request.sessionId)
  }

  async previewXhsRanking(input: { sessionId: string }): Promise<XhsRankingPreview> {
    const request = XhsRankingPreviewRequestSchema.parse(input)
    this.cleanupXhsRankingPlans()
    const state = this.requireD4State(request.sessionId, 'STAGE_3')
    const destinationCity = state.basics?.destinationCities[0]
    if (!destinationCity || state.basics?.destinationCities.length !== 1) {
      throw new AppError('GATE_BLOCKED', '30 帖研究前必须确认一个目的地城市。')
    }
    const summary = await this.ctx.provider.configSummary()
    const extraction = summary.routes?.EXTRACTION
    const review = summary.routes?.REVIEW
    if (!extraction || !review) {
      throw new AppError('PROVIDER_UNCONFIGURED', '30 帖研究需要 EXTRACTION 与 REVIEW 路由。')
    }
    for (const [planId, pending] of this.pendingXhsRankingPlans) {
      if (pending.preview.sessionId === request.sessionId)
        this.pendingXhsRankingPlans.delete(planId)
    }
    const planId = randomUUID()
    const expiresAt = Date.now() + D4_XHS_PLAN_TTL_MS
    const payload = {
      sessionId: request.sessionId,
      planId,
      expiresAt: new Date(expiresAt).toISOString(),
      destinationCity,
      queries: xhsRankingQueries(destinationCity),
      filters: XHS_RANKING_FILTERS,
      recommendSampleSize: 15 as const,
      avoidSampleSize: 15 as const,
      searchCalls: 4 as const,
      detailCalls: 30 as const,
      detailCharacterLimit: 4000 as const,
      extractionCalls: 6 as const,
      reviewCalls: 1 as const,
      retryCount: 0 as const,
      loadAllComments: false as const,
      extractionRoute: { provider: extraction.channel, model: extraction.model },
      reviewRoute: { provider: review.channel, model: review.model }
    }
    const digest = digestD5Value(payload)
    const preview = XhsRankingPreviewSchema.parse({ ...payload, digest })
    this.pendingXhsRankingPlans.set(planId, {
      preview,
      stateDigest: this.d4XhsStateDigest(request.sessionId),
      routeDigest: digestD5Value({ extraction, review }),
      expiresAt
    })
    return preview
  }

  async executeXhsRanking(
    input: XhsRankingExecuteRequest,
    onProgress?: D4ProgressListener
  ): Promise<D4Snapshot> {
    const request = XhsRankingExecuteRequestSchema.parse(input)
    this.cleanupXhsRankingPlans()
    const pending = this.pendingXhsRankingPlans.get(request.planId)
    if (!pending || pending.preview.sessionId !== request.sessionId) {
      throw new AppError('INPUT_INVALID', '小红书研究预览不存在或已经过期。')
    }
    if (pending.preview.digest !== request.digest) {
      throw new AppError('INPUT_INVALID', '小红书研究摘要已变化，请重新预览并授权。')
    }
    if (pending.stateDigest !== this.d4XhsStateDigest(request.sessionId)) {
      this.pendingXhsRankingPlans.delete(request.planId)
      throw new AppError('GATE_BLOCKED', '会话状态已变化，小红书研究预览已失效。')
    }
    const providerSummary = await this.ctx.provider.configSummary()
    if (
      pending.routeDigest !==
      digestD5Value({
        extraction: providerSummary.routes?.EXTRACTION,
        review: providerSummary.routes?.REVIEW
      })
    ) {
      this.pendingXhsRankingPlans.delete(request.planId)
      throw new AppError('GATE_BLOCKED', '模型路由已变化，请重新预览并授权。')
    }
    this.consumeXhsRankingOperation(request.operationId)
    this.pendingXhsRankingPlans.delete(request.planId)
    const state = this.requireD4State(request.sessionId, 'STAGE_3')
    const basics = state.basics
    const destinationCity = basics?.destinationCities[0]
    if (!basics || !destinationCity || basics.destinationCities.length !== 1) {
      throw new AppError('GATE_BLOCKED', '30 帖研究前必须确认一个目的地城市。')
    }
    this.emitD4Progress(
      onProgress,
      request,
      'RESEARCH_STARTED',
      'SRC_XHS',
      '开始严格执行 4 次搜索、30 次详情与 7 次模型调用。'
    )
    const source = await this.ctx.tools.runXhsRankingResearch(
      { sessionId: request.sessionId, destinationCity },
      request.operationId,
      (completedSearches, completedDetails) => {
        this.emitD4Progress(
          onProgress,
          request,
          completedDetails > 0 ? 'XHS_DETAIL_COMPLETED' : 'XHS_SEARCH_COMPLETED',
          'SRC_XHS',
          completedDetails > 0
            ? `已串行读取 ${completedDetails}/30 条详情。`
            : `已完成 ${completedSearches}/4 次冻结查询。`
        )
      }
    )
    const ranked = await this.xhsRanking.run({
      sessionId: request.sessionId,
      destinationCity,
      sourceClaims: source.claims,
      travelers: basics.travelers,
      onBatchComplete: (completedBatches) =>
        this.emitD4Progress(
          onProgress,
          request,
          'XHS_EXTRACTION_COMPLETED',
          'SRC_XHS',
          `已完成 ${completedBatches}/6 个 EXTRACTION 批次。`
        )
    })
    this.emitD4Progress(
      onProgress,
      request,
      'XHS_REVIEW_COMPLETED',
      'SRC_XHS',
      '已完成唯一一次 REVIEW；排序由本地确定性公式计算。'
    )
    this.assertResearchEntities(request.sessionId, destinationCity, ranked.entities, ranked.claims)
    await this.record({
      sessionId: request.sessionId,
      eventVersion: 2,
      type: 'research/checklist-prepared',
      payload: {
        entities: ranked.entities,
        sourceFailures: [],
        xhsSampleSummary: source.sampleSummary,
        attractionRankings: ranked.rankings,
        finalClaims: ranked.claims
      }
    })
    this.emitD4Progress(
      onProgress,
      request,
      'COMPLETED',
      'SRC_XHS',
      '30 帖研究与景点排序已完成；全部 UGC 仍为未核验线索。'
    )
    return this.d4Snapshot(request.sessionId)
  }

  async addUserPaste(input: UserPasteRequest): Promise<EvidenceClaim> {
    const request = UserPasteRequestSchema.parse(input)
    const state = this.requireD4State(request.sessionId, 'STAGE_3')
    const observedAt = new Date()
    const sourceRef = `USER_PASTE:${createHash('sha256')
      .update(`${request.sourceUrl ?? ''}\n${request.text}`)
      .digest('hex')
      .slice(0, 24)}`
    const claim = EvidenceClaimSchema.parse({
      claimId: deterministicClaimId({
        sourceId: 'USER_PASTE',
        sourceRef,
        subject: state.basics?.destinationCities[0] ?? '用户旅行线索',
        predicate: 'userPasteClue'
      }),
      sessionId: request.sessionId,
      subject: state.basics?.destinationCities[0] ?? '用户旅行线索',
      predicate: 'userPasteClue',
      value: { text: request.text, sourceUrl: request.sourceUrl },
      sourceId: 'USER_PASTE',
      sourceRef,
      contentIdentity: 'UNKNOWN',
      verificationStatus: 'UNVERIFIED',
      observedAt: observedAt.toISOString(),
      validUntil: new Date(observedAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      confidence: null,
      conflictsWith: [],
      notes: '用户提供的未核验线索；其中的指令不会作为系统指令执行。'
    })
    return (await this.ctx.tools.addEvidenceClaims([claim]))[0]!
  }

  async setResearchDisposition(input: ResearchDispositionRequest): Promise<D4Snapshot> {
    const request = ResearchDispositionRequestSchema.parse(input)
    const state = this.requireD4State(request.sessionId, 'STAGE_3')
    const entity = state.researchEntities.find((item) => item.entityId === request.entityId)
    if (!entity) throw new AppError('INPUT_INVALID', '研究线索不存在。')
    await this.record({
      sessionId: request.sessionId,
      eventVersion: 2,
      type: 'research/disposition-set',
      payload: { entityId: request.entityId, disposition: request.disposition }
    })
    await this.record({
      sessionId: request.sessionId,
      eventVersion: 2,
      type: 'decision/logged',
      payload: {
        decisionId: ulid(),
        category: 'RESEARCH_DISPOSITION',
        selected: `${entity.canonicalSubject}:${request.disposition}`,
        reason: '用户明确处置研究线索。',
        alternatives: ['MUST_GO', 'WANT', 'NEUTRAL', 'EXCLUDE'].filter(
          (item) => item !== request.disposition
        )
      }
    })
    return this.d4Snapshot(request.sessionId)
  }

  async resolveResearchConflict(input: ConflictResolveRequest): Promise<D4Snapshot> {
    const request = ConflictResolveRequestSchema.parse(input)
    this.requireD4State(request.sessionId, 'STAGE_3')
    const claims = this.ctx.tools.listEvidence(request.sessionId, 200)
    const group = claims.filter(
      (claim) =>
        claim.verificationStatus === 'CONFLICTED' &&
        normalizeEvidenceSubject(claim.subject) === normalizeEvidenceSubject(request.subject) &&
        claim.predicate.normalize('NFKC').trim().toLowerCase() ===
          request.predicate.normalize('NFKC').trim().toLowerCase()
    )
    if (group.length < 2) throw new AppError('INPUT_INVALID', '没有找到可裁决的冲突双方。')
    if (
      request.selectedClaimId &&
      !group.some((claim) => claim.claimId === request.selectedClaimId)
    ) {
      throw new AppError('INPUT_INVALID', '选中的 Claim 不属于当前冲突组。')
    }
    const resolution = {
      subject: normalizeEvidenceSubject(request.subject),
      predicate: request.predicate,
      resolution: request.resolution,
      selectedClaimId: request.selectedClaimId,
      resolvedAt: new Date().toISOString()
    } as const
    await this.record({
      sessionId: request.sessionId,
      eventVersion: 2,
      type: 'research/conflict-resolved',
      payload: { resolution }
    })
    await this.record({
      sessionId: request.sessionId,
      eventVersion: 2,
      type: 'decision/logged',
      payload: {
        decisionId: ulid(),
        category: 'EVIDENCE_CONFLICT',
        selected: request.selectedClaimId ?? 'UNKNOWN',
        reason: `用户裁决 ${resolution.subject} / ${resolution.predicate} 的证据冲突。`,
        alternatives: group
          .map((claim) => claim.claimId)
          .filter((claimId) => claimId !== request.selectedClaimId)
      }
    })
    return this.d4Snapshot(request.sessionId)
  }

  async confirmResearch(input: ResearchConfirmRequest): Promise<D4Snapshot> {
    const request = ResearchConfirmRequestSchema.parse(input)
    const state = this.requireD4State(request.sessionId, 'STAGE_3')
    const claims = this.ctx.tools.listEvidence(request.sessionId, 200)
    const blockers: string[] = []
    if (state.researchEntities.length === 0) blockers.push('研究清单为空')
    if (
      state.researchEntities.length > 0 &&
      state.researchEntities.every((entity) => entity.disposition === 'EXCLUDE')
    ) {
      blockers.push('至少需要保留一个未排除的研究项')
    }
    for (const entity of state.researchEntities) {
      if (entity.disposition !== 'EXCLUDE' && entity.promotionOnlySupport) {
        blockers.push(`${entity.canonicalSubject} 仅有推广或商业报价支撑`)
      }
      if (entity.disposition === 'MUST_GO' && entity.identityStatus === 'AMBIGUOUS') {
        blockers.push(`${entity.canonicalSubject} 的实体身份仍未确认`)
      }
      if (entity.disposition === 'MUST_GO' && lacksUsableHardAnchor(entity.claimIds, claims)) {
        blockers.push(`${entity.canonicalSubject} 缺少可用的开放时间或预约证据`)
      }
    }
    for (const entity of unresolvedHardAnchorConflicts(
      state.researchEntities,
      claims,
      state.conflictResolutions
    )) {
      blockers.push(`${entity.canonicalSubject} 的开放时间或预约冲突尚未裁决`)
    }
    if (blockers.length > 0) {
      throw new AppError('GATE_BLOCKED', '研究清单未通过确认门。', {
        userHint: `请先处理：${[...new Set(blockers)].join('；')}。`
      })
    }
    await this.record({
      sessionId: request.sessionId,
      eventVersion: 2,
      type: 'research/confirmed',
      payload: { confirmedAt: new Date().toISOString() }
    })
    await this.record({
      sessionId: request.sessionId,
      eventVersion: 2,
      type: 'stage/confirmed',
      payload: { fromStage: 'STAGE_3', toStage: 'STAGE_4', confirmed: true }
    })
    return this.d4Snapshot(request.sessionId)
  }

  railDiscoveryPreview(sessionId: string): RailDiscoveryPreview {
    const state = this.requireD5State(sessionId, 'STAGE_4')
    if (!state.researchChecklistConfirmed) {
      throw new AppError('GATE_BLOCKED', '车次查询前必须确认研究清单。')
    }
    const basics = state.basics
    if (
      !basics ||
      basics.dates.kind !== 'FIXED' ||
      basics.originCities.length !== 1 ||
      basics.destinationCities.length !== 1
    ) {
      throw new AppError(
        'GATE_BLOCKED',
        '车次查询需要已确认的单一出发城市、目的城市和固定往返日期。'
      )
    }
    const payload = {
      sessionId,
      outbound: {
        direction: 'OUTBOUND' as const,
        date: basics.dates.startDate,
        fromStation: basics.originCities[0]!,
        toStation: basics.destinationCities[0]!
      },
      return: {
        direction: 'RETURN' as const,
        date: basics.dates.endDate,
        fromStation: basics.destinationCities[0]!,
        toStation: basics.originCities[0]!
      },
      estimatedExternalCalls: 2 as const
    }
    return RailDiscoveryPreviewSchema.parse({ ...payload, digest: digestD5Value(payload) })
  }

  async discoverRailOptions(
    input: RailDiscoveryRequest,
    onProgress?: D5ProgressListener
  ): Promise<RailDiscoveryResult> {
    const request = RailDiscoveryRequestSchema.parse(input)
    this.cleanupD5EphemeralState()
    const preview = this.railDiscoveryPreview(request.sessionId)
    if (preview.digest !== request.digest) {
      throw new AppError('INPUT_INVALID', '车次查询摘要已失效。', {
        userHint: '行程条件已经变化，请查看最新日期与站点后重新授权。'
      })
    }
    this.consumeD5Operation(request.operationId)
    this.emitD5Progress(
      onProgress,
      request,
      'RAIL_DISCOVERY_STARTED',
      '正在按已确认日期与站点查询往返车次。'
    )
    const { outboundOptions, returnOptions } = await this.ctx.tools.discoverRailRoundTripOptions(
      {
        outbound: { sessionId: request.sessionId, ...preview.outbound },
        return: { sessionId: request.sessionId, ...preview.return }
      },
      request.operationId
    )
    const discoveryId = randomUUID()
    const expiresAt = Date.now() + D5_EPHEMERAL_TTL_MS
    const result = RailDiscoveryResultSchema.parse({
      sessionId: request.sessionId,
      discoveryId,
      expiresAt: new Date(expiresAt).toISOString(),
      outboundOptions,
      returnOptions
    })
    this.railDiscoveries.set(discoveryId, {
      sessionId: request.sessionId,
      stateDigest: this.d5StateDigest(request.sessionId),
      expiresAt,
      result,
      selection: null
    })
    this.emitD5Progress(onProgress, request, 'COMPLETED', '往返车次候选已返回，等待用户选择。')
    return result
  }

  selectRailOptions(input: RailSelectionRequest): RailSelectionResult {
    const request = RailSelectionRequestSchema.parse(input)
    const discovery = this.requireRailDiscovery(request.sessionId, request.discoveryId)
    const outbound = discovery.result.outboundOptions.find(
      (option) => option.trainNo === request.outboundTrainNo
    )
    const returnOption = discovery.result.returnOptions.find(
      (option) => option.trainNo === request.returnTrainNo
    )
    if (!outbound || !returnOption) {
      throw new AppError('INPUT_INVALID', '所选车次不属于当前候选或已经失效。')
    }
    const selection = RailSelectionResultSchema.parse({
      sessionId: request.sessionId,
      discoveryId: request.discoveryId,
      expiresAt: discovery.result.expiresAt,
      outbound,
      return: returnOption
    })
    discovery.selection = selection
    return selection
  }

  previewD5SourcePlan(input: D5SourcePlanPreviewRequest): D5SourcePlanPreview {
    const request = D5SourcePlanPreviewRequestSchema.parse(input)
    const discovery = this.requireRailDiscovery(request.sessionId, request.discoveryId)
    if (!discovery.selection) throw new AppError('GATE_BLOCKED', '请先选择往返车次。')
    for (const [planId, plan] of this.pendingSourcePlans) {
      if (plan.sessionId === request.sessionId && plan.discoveryId === request.discoveryId) {
        plan.exactAddress = ''
        this.pendingSourcePlans.delete(planId)
      }
    }
    const plan = this.buildPendingSourcePlan(request, discovery)
    this.pendingSourcePlans.set(plan.preview.planId, plan)
    return plan.preview
  }

  async executeD5SourcePlan(
    input: D5SourcePlanExecuteRequest,
    onProgress?: D5ProgressListener
  ): Promise<D5SourcePlanExecutionResult> {
    const request = D5SourcePlanExecuteRequestSchema.parse(input)
    this.cleanupD5EphemeralState()
    const pending = this.pendingSourcePlans.get(request.planId)
    if (!pending || pending.sessionId !== request.sessionId) {
      throw new AppError('INPUT_INVALID', '来源执行预览不存在或已经过期。')
    }
    const discovery = this.requireRailDiscovery(request.sessionId, pending.discoveryId)
    if (!discovery.selection) throw new AppError('GATE_BLOCKED', '所选车次已经失效。')
    if (pending.stateDigest !== this.d5StateDigest(request.sessionId)) {
      throw new AppError('GATE_BLOCKED', '行程状态已变化，来源执行预览已失效。')
    }
    const rebuilt = this.buildPendingSourcePlan(
      {
        sessionId: pending.sessionId,
        discoveryId: pending.discoveryId,
        exactAddress: pending.exactAddress,
        originLabel: pending.originLabel
      },
      discovery,
      pending.preview.planId,
      pending.expiresAt
    )
    if (request.digest !== pending.preview.digest || rebuilt.preview.digest !== request.digest) {
      rebuilt.exactAddress = ''
      throw new AppError('INPUT_INVALID', '来源调用清单已经变化，请重新查看并授权。')
    }
    this.consumeD5Operation(request.operationId)
    this.pendingSourcePlans.delete(request.planId)
    this.emitD5Progress(
      onProgress,
      request,
      'SOURCE_PLAN_STARTED',
      '正在按授权清单装配车次、接驳与住宿来源。'
    )
    let externalCallCount = 0
    try {
      const selection = discovery.selection
      const candidateId = `auto-${createHash('sha256')
        .update(request.digest)
        .digest('hex')
        .slice(0, 20)}`
      const transportClaims: EvidenceClaim[] = []
      for (const option of [selection.outbound, selection.return]) {
        const outcome = await this.ctx.tools.materializeSelectedRailOption(
          {
            sessionId: request.sessionId,
            candidateId,
            option
          },
          false
        )
        transportClaims.push(
          ...this.acceptMaterializedClaims(request.sessionId, outcome, 'SRC_RAIL', 'get-tickets')
        )
      }

      const coordinates = new Map<string, { lng: number; lat: number }>()
      const coordinateClaims: EvidenceClaim[] = []
      for (const location of rebuilt.locations) {
        const outcome = await this.ctx.tools.materializeTransientMapGeocode(
          {
            sessionId: request.sessionId,
            address: location.address,
            city: location.city,
            label: location.label
          },
          request.operationId,
          !location.cached,
          false
        )
        if (!outcome.fromCache) externalCallCount += 1
        coordinateClaims.push(outcome.claim)
        coordinates.set(location.locationId, outcome.location)
      }

      const timedTransfers = this.buildTimedTransferRequests(
        request.sessionId,
        candidateId,
        rebuilt,
        selection,
        coordinates
      )
      for (const transfer of timedTransfers) {
        const outcome = await this.ctx.tools.materializeTimedMapGroundTransfer(
          transfer,
          request.operationId,
          false
        )
        externalCallCount += 1
        transportClaims.push(
          ...this.acceptMaterializedClaims(request.sessionId, outcome, 'SRC_MAP', 'maps_distance')
        )
      }
      await this.ctx.tools.addEvidenceClaims([...coordinateClaims, ...transportClaims])
      const candidates = buildTransportCandidates(transportClaims)
      await this.record({
        sessionId: request.sessionId,
        eventVersion: 2,
        type: 'transport/candidates-prepared',
        payload: { candidates }
      })

      let hotelOutcome: D5SourceOutcome
      try {
        const outcome = await this.ctx.tools.materializeHotelLodgingCandidates(
          { sessionId: request.sessionId, ...rebuilt.preview.hotelQuery },
          request.operationId
        )
        externalCallCount += 1
        const claims = this.acceptMaterializedClaims(
          request.sessionId,
          outcome,
          'SRC_HOTEL',
          'searchHotels'
        )
        hotelOutcome = D5SourceOutcomeSchema.parse({
          sourceId: 'SRC_HOTEL',
          status: claims.length > 0 ? 'SUCCEEDED' : 'EMPTY',
          candidateCount: claims.length,
          errorCode: null,
          capabilityImpact: claims.length > 0 ? null : '酒店源本次没有返回候选。',
          manualAlternative:
            claims.length > 0 ? null : '可粘贴带完整入住日期、房型、入住人数和退改规则的报价。'
        })
      } catch (error) {
        if (!(error instanceof AppError) || error.klass !== 'SOURCE') throw error
        externalCallCount += 1
        hotelOutcome = D5SourceOutcomeSchema.parse({
          sourceId: 'SRC_HOTEL',
          status: error.code === 'SOURCE_CANCELLED' ? 'CANCELLED' : 'FAILED',
          candidateCount: 0,
          errorCode: error.code,
          capabilityImpact: '酒店源本次未能提供可核验候选。',
          manualAlternative: '可粘贴带完整入住日期、房型、入住人数和退改规则的报价。'
        })
      }
      this.earlyHotelOutcomes.set(request.sessionId, hotelOutcome)
      this.emitD5Progress(
        onProgress,
        request,
        'COMPLETED',
        hotelOutcome.status === 'FAILED' || hotelOutcome.status === 'CANCELLED'
          ? '交通来源已装配；酒店失败已明确保留，可稍后手工补充。'
          : '交通与住宿来源已按授权清单装配完成。'
      )
      return D5SourcePlanExecutionResultSchema.parse({
        snapshot: this.d5Snapshot(request.sessionId),
        hotelOutcome,
        externalCallCount,
        railExternalCallCount: 0
      })
    } finally {
      pending.exactAddress = ''
      rebuilt.exactAddress = ''
    }
  }

  async prepareTransport(
    input: TransportPrepareRequest,
    onProgress?: D5ProgressListener
  ): Promise<D5Snapshot> {
    const request = TransportPrepareRequestSchema.parse(input)
    const state = this.requireD5State(request.sessionId, 'STAGE_4')
    if (!state.researchChecklistConfirmed) {
      throw new AppError('GATE_BLOCKED', '交通比较前必须确认研究清单。')
    }
    this.emitD5Progress(
      onProgress,
      request,
      'TRANSPORT_STARTED',
      '正在依据本地证据生成门到门交通候选。'
    )
    let claims: EvidenceClaim[]
    if (request.sourceParameters) {
      this.consumeD5Operation(request.operationId)
      claims = await this.materializeTransportEvidence(
        request.sessionId,
        request.operationId,
        request.sourceParameters
      )
    } else {
      claims = this.ctx.tools.listEvidence(request.sessionId, 200)
    }
    const candidates = buildTransportCandidates(claims)
    await this.record({
      sessionId: request.sessionId,
      eventVersion: 2,
      type: 'transport/candidates-prepared',
      payload: { candidates }
    })
    this.emitD5Progress(onProgress, request, 'COMPLETED', '交通候选已生成，等待选择。')
    return this.d5Snapshot(request.sessionId)
  }

  async selectTransport(input: TransportSelectRequest): Promise<D5Snapshot> {
    const request = TransportSelectRequestSchema.parse(input)
    this.requireD5State(request.sessionId, 'STAGE_4')
    await this.record({
      sessionId: request.sessionId,
      eventVersion: 2,
      type: 'transport/candidate-selected',
      payload: { candidateId: request.candidateId }
    })
    return this.d5Snapshot(request.sessionId)
  }

  async prepareSkeleton(
    input: SkeletonPrepareRequest,
    onProgress?: D5ProgressListener
  ): Promise<D5Snapshot> {
    const request = SkeletonPrepareRequestSchema.parse(input)
    const state = this.requireD5State(request.sessionId, 'STAGE_4')
    this.emitD5Progress(
      onProgress,
      request,
      'SKELETON_STARTED',
      '正在生成含抵达与离开锚点的日级骨架。'
    )
    const result = buildSkeleton(state, this.ctx.tools.listEvidence(request.sessionId, 200))
    await this.record({
      sessionId: request.sessionId,
      eventVersion: 2,
      type: 'skeleton/updated',
      payload: {
        days: result.days,
        changedDates: result.days.map((day) => day.date),
        boundaryAnchors: result.boundaryAnchors,
        staySegment: result.staySegment
      }
    })
    this.emitD5Progress(onProgress, request, 'COMPLETED', '日级骨架已生成，等待确认。')
    return this.d5Snapshot(request.sessionId)
  }

  async confirmSkeleton(input: SkeletonConfirmRequest): Promise<D5Snapshot> {
    const request = SkeletonConfirmRequestSchema.parse(input)
    const state = this.requireD5State(request.sessionId, 'STAGE_4')
    const blockers: string[] = []
    if (!state.selectedTransportCandidateId) blockers.push('尚未选择交通方案')
    if (state.boundaryAnchors.length !== 2) blockers.push('抵达/离开硬锚点不完整')
    if (!state.staySegment) blockers.push('住宿段尚未生成')
    if (state.daySkeletons.length === 0) blockers.push('日级骨架为空')
    if (new Set(state.daySkeletons.map((day) => day.date)).size !== state.daySkeletons.length) {
      blockers.push('日级骨架日期重复')
    }
    if (state.staySegment && state.daySkeletons.length !== state.staySegment.nights + 1) {
      blockers.push('骨架日期与住宿夜数不一致')
    }
    if (
      state.daySkeletons.some((day) =>
        [day.morning, day.afternoon, day.evening].some(
          (slot) => slot && !slotItemsWithinEightKm(slot.items)
        )
      )
    ) {
      blockers.push('至少一个半日内项目距离超过 8 km')
    }
    if (blockers.length > 0) {
      throw new AppError('GATE_BLOCKED', 'STAGE-4 骨架确认门未通过。', {
        userHint: `请先处理：${blockers.join('；')}。`
      })
    }
    await this.record({
      sessionId: request.sessionId,
      eventVersion: 2,
      type: 'stage/confirmed',
      payload: { fromStage: 'STAGE_4', toStage: 'STAGE_5', confirmed: true }
    })
    return this.d5Snapshot(request.sessionId)
  }

  async patchSkeleton(input: SkeletonPatchRequest): Promise<D5Snapshot> {
    const request = SkeletonPatchRequestSchema.parse(input)
    const state = this.requireState(request.sessionId)
    if (state.stage !== 'STAGE_4' && state.stage !== 'STAGE_5') {
      throw new AppError('GATE_BLOCKED', '行程骨架只能在 STAGE-4 或 STAGE-5 调整。')
    }
    if (!state.staySegment || state.boundaryAnchors.length !== 2) {
      throw new AppError('GATE_BLOCKED', '行程骨架尚未完整生成。')
    }
    const entity = state.researchEntities.find((item) => item.entityId === request.entityId)
    const coordinateClaim = this.ctx.tools
      .listEvidence(request.sessionId, 200)
      .find(
        (claim) => entity?.claimIds.includes(claim.claimId) && claim.predicate === 'coordinates'
      )
    const value = coordinateClaim?.value
    if (
      !entity ||
      !coordinateClaim ||
      value === null ||
      Array.isArray(value) ||
      typeof value !== 'object' ||
      typeof value.lng !== 'number' ||
      typeof value.lat !== 'number'
    ) {
      throw new AppError('GATE_BLOCKED', '目标项目缺少可用坐标证据。')
    }
    let foundDate = false
    const days = state.daySkeletons.map((day) => {
      if (day.date !== request.date) return day
      foundDate = true
      const item = {
        entityId: entity.entityId,
        title: entity.canonicalSubject,
        coordinates: { lng: value.lng as number, lat: value.lat as number },
        claimIds: [coordinateClaim.claimId]
      }
      const without = (slot: typeof day.morning): typeof day.morning =>
        slot
          ? { ...slot, items: slot.items.filter((entry) => entry.entityId !== entity.entityId) }
          : null
      const morning = without(day.morning)
      const afternoon = without(day.afternoon)
      const evening = without(day.evening)
      const key = request.period.toLowerCase() as 'morning' | 'afternoon' | 'evening'
      const slots = { morning, afternoon, evening }
      slots[key] = slots[key]
        ? { ...slots[key]!, items: [...slots[key]!.items, item].slice(0, 4) }
        : {
            kind: 'PROJECTS',
            area: state.basics?.destinationCities[0] ?? entity.destinationCity,
            items: [item],
            note: null
          }
      if (!slotItemsWithinEightKm(slots[key]!.items)) {
        throw new AppError('GATE_BLOCKED', '目标半日内项目两两距离超过 8 km。', {
          userHint: '请选择更邻近的项目或另一个半日，系统不会自动制造跨城折返。'
        })
      }
      return { ...day, ...slots }
    })
    if (!foundDate) throw new AppError('INPUT_INVALID', '目标日期不在当前骨架中。')
    await this.record({
      sessionId: request.sessionId,
      eventVersion: 2,
      type: 'skeleton/updated',
      payload: {
        days,
        changedDates: [request.date],
        boundaryAnchors: state.boundaryAnchors,
        staySegment: {
          ...state.staySegment,
          positionAssessment: {
            ...state.staySegment.positionAssessment,
            summary: `已按 ${request.date} ${request.period} 的局部调整重新评估。`
          }
        }
      }
    })
    return this.d5Snapshot(request.sessionId)
  }

  async prepareStay(
    input: StayPrepareRequest,
    onProgress?: D5ProgressListener
  ): Promise<D5Snapshot> {
    const request = StayPrepareRequestSchema.parse(input)
    const state = this.requireD5State(request.sessionId, 'STAGE_5')
    if (!state.staySegment) throw new AppError('GATE_BLOCKED', '住宿段尚未生成。')
    this.emitD5Progress(onProgress, request, 'STAY_STARTED', '正在汇总三个来源的整段住宿候选。')
    let claims = this.ctx.tools.listEvidence(request.sessionId, 200)
    let sourceOutcomeOverride = this.earlyHotelOutcomes.get(request.sessionId) ?? null
    if (request.sourceParameters) {
      this.consumeD5Operation(request.operationId)
      this.earlyHotelOutcomes.delete(request.sessionId)
      sourceOutcomeOverride = null
      try {
        const outcome = await this.ctx.tools.materializeHotelLodgingCandidates(
          { sessionId: request.sessionId, ...request.sourceParameters },
          request.operationId
        )
        const currentHotelClaims = this.acceptMaterializedClaims(
          request.sessionId,
          outcome,
          'SRC_HOTEL',
          'searchHotels'
        )
        const currentHotelClaimIds = new Set(currentHotelClaims.map((claim) => claim.claimId))
        claims = claims.filter(
          (claim) => claim.sourceId !== 'SRC_HOTEL' || currentHotelClaimIds.has(claim.claimId)
        )
      } catch (error) {
        if (!(error instanceof AppError) || error.klass !== 'SOURCE') throw error
        claims = claims.filter((claim) => claim.sourceId !== 'SRC_HOTEL')
        sourceOutcomeOverride = D5SourceOutcomeSchema.parse({
          sourceId: 'SRC_HOTEL',
          status: error.code === 'SOURCE_CANCELLED' ? 'CANCELLED' : 'FAILED',
          candidateCount: 0,
          errorCode: error.code,
          capabilityImpact: '酒店源本次未能提供可核验候选。',
          manualAlternative: '可粘贴带完整入住日期、房型、入住人数和退改规则的报价。'
        })
      }
    }
    const result = buildStayCandidates(
      state.staySegment,
      claims,
      sourceOutcomeOverride ? [sourceOutcomeOverride] : []
    )
    await this.record({
      sessionId: request.sessionId,
      eventVersion: 2,
      type: 'stay/candidates-prepared',
      payload: result
    })
    this.earlyHotelOutcomes.delete(request.sessionId)
    this.emitD5Progress(
      onProgress,
      request,
      'COMPLETED',
      sourceOutcomeOverride
        ? '酒店源失败已明确保留，可继续查看其他来源或手工补充。'
        : '住宿候选已生成，等待选择。'
    )
    return this.d5Snapshot(request.sessionId)
  }

  async selectStay(input: StaySelectRequest): Promise<D5Snapshot> {
    const request = StaySelectRequestSchema.parse(input)
    this.requireD5State(request.sessionId, 'STAGE_5')
    await this.record({
      sessionId: request.sessionId,
      eventVersion: 2,
      type: 'stay/selected',
      payload: { candidateId: request.candidateId }
    })
    return this.d5Snapshot(request.sessionId)
  }

  async addStayPaste(input: StayPasteRequest): Promise<EvidenceClaim> {
    const request = StayPasteRequestSchema.parse(input)
    const state = this.requireD5State(request.sessionId, 'STAGE_5')
    if (!state.staySegment) throw new AppError('GATE_BLOCKED', '住宿段尚未生成。')
    const observedAt = new Date()
    const sourceRef = `USER_PASTE:${createHash('sha256')
      .update(JSON.stringify(request))
      .digest('hex')
      .slice(0, 24)}`
    const claim = EvidenceClaimSchema.parse({
      claimId: deterministicClaimId({
        sourceId: 'USER_PASTE',
        sourceRef,
        subject: request.name,
        predicate: 'lodgingCandidate'
      }),
      sessionId: request.sessionId,
      subject: request.name,
      predicate: 'lodgingCandidate',
      value: {
        name: request.name,
        totalCostCents: request.totalCostCents,
        totalCostComplete: request.totalCostCents !== null,
        roomType: request.roomType,
        bedType: request.bedType,
        capacity: request.capacity,
        roomFitsParty: request.roomFitsParty,
        cancellationStatus: request.cancellationStatus,
        freeCancelUntil: request.freeCancelUntil,
        positionAdvantage: request.positionAdvantage
      },
      sourceId: 'USER_PASTE',
      sourceRef,
      contentIdentity: 'UNKNOWN',
      verificationStatus: 'UNVERIFIED',
      observedAt: observedAt.toISOString(),
      validUntil: new Date(observedAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      confidence: null,
      conflictsWith: [],
      notes: '用户手工粘贴的住宿候选，字段保持未核验。'
    })
    await this.ctx.tools.addEvidenceClaims([claim])
    return claim
  }

  d5Snapshot(sessionId: string): D5Snapshot {
    const state = this.requireState(sessionId)
    return D5SnapshotSchema.parse({
      sessionId: state.sessionId,
      stage: state.stage,
      partySize: state.basics?.travelers.reduce((sum, group) => sum + group.count, 0) ?? 0,
      transportCandidates: state.transportCandidates,
      selectedTransportCandidateId: state.selectedTransportCandidateId,
      boundaryAnchors: state.boundaryAnchors,
      daySkeletons: state.daySkeletons,
      staySegment: state.staySegment,
      stayCandidates: state.stayCandidates,
      selectedStayCandidateId: state.selectedStayCandidateId,
      staySourceOutcomes: state.staySourceOutcomes
    })
  }

  async prepareTimeline(
    input: TimelinePrepareRequest,
    onProgress?: D6ProgressListener
  ): Promise<D6Snapshot> {
    const request = TimelinePrepareRequestSchema.parse(input)
    this.cleanupD6EphemeralState()
    this.consumeD6Operation(request.operationId)
    const state = this.requireD5State(request.sessionId, 'STAGE_5')
    this.assertOptionalRouteIdentity(state, request.routeId, true)
    this.emitD6Progress(onProgress, request, 'ROUTE_STARTED', '正在根据已确认骨架细化路线。')
    try {
      await Promise.resolve()
      this.assertD6NotCancelled(request.operationId)
      this.emitD6Progress(
        onProgress,
        request,
        'RESTAURANT_STARTED',
        '正在核对本地餐厅与备用项证据。'
      )
      const draft = createTimelineDraft({
        state,
        claims: this.ctx.tools.listEvidence(request.sessionId, request.routeId ? 500 : 200),
        draftId: randomUUID(),
        now: new Date().toISOString()
      })
      this.assertD6NotCancelled(request.operationId)
      this.emitD6Progress(
        onProgress,
        request,
        'TIMELINE_STARTED',
        '正在编译分钟级时间轴与发布门禁。'
      )
      for (const [draftId, pending] of this.pendingTimelineDrafts) {
        if (pending.sessionId === request.sessionId) this.pendingTimelineDrafts.delete(draftId)
      }
      this.pendingTimelineDrafts.set(draft.draftId, {
        sessionId: request.sessionId,
        basisSeq: state.lastSeq,
        expiresAt: Date.now() + D5_EPHEMERAL_TTL_MS,
        draft
      })
      this.emitD6Progress(onProgress, request, 'COMPLETED', '时间轴草稿已生成，等待发布门禁确认。')
      return this.d6Snapshot({ sessionId: request.sessionId, routeId: request.routeId })
    } finally {
      this.cancelledD6Operations.delete(request.operationId)
    }
  }

  async publishTimeline(input: TimelinePublishRequest): Promise<D6Snapshot> {
    const request = TimelinePublishRequestSchema.parse(input)
    this.cleanupD6EphemeralState()
    const state = this.requireD5State(request.sessionId, 'STAGE_5')
    this.assertOptionalRouteIdentity(state, request.routeId, true)
    const pending = this.pendingTimelineDrafts.get(request.draftId)
    if (!pending || pending.sessionId !== request.sessionId) {
      throw new AppError('INPUT_INVALID', '时间轴草稿不存在或已经过期。')
    }
    if ((pending.draft.routeId ?? undefined) !== request.routeId) {
      throw new AppError('INPUT_INVALID', '时间轴草稿不属于当前请求路线。')
    }
    if (pending.basisSeq !== state.lastSeq) {
      this.pendingTimelineDrafts.delete(request.draftId)
      throw new AppError('GATE_BLOCKED', '行程事实已变化，时间轴草稿已经失效。', {
        userHint: '请重新准备时间轴，系统不会发布基于旧状态的草稿。'
      })
    }
    const payload = publishTimelineDraft({
      draft: pending.draft,
      currentVersion: state.timelineVersions.at(-1)?.version ?? 0,
      now: new Date().toISOString()
    })
    this.assertClaimIdsBelongToSession(
      request.sessionId,
      payload.timeline.items.flatMap((item) => [
        ...item.claimIds,
        ...(item.arrivalTransport?.claimIds ?? [])
      ])
    )
    await this.record({
      sessionId: request.sessionId,
      eventVersion: 2,
      type: 'timeline/published',
      payload
    })
    this.pendingTimelineDrafts.delete(request.draftId)
    return this.d6Snapshot({ sessionId: request.sessionId, routeId: request.routeId })
  }

  d6Snapshot(input: { sessionId: string; routeId?: string; version?: number }): D6Snapshot {
    const request = D6SnapshotRequestSchema.parse(input)
    this.cleanupD6EphemeralState()
    const state = this.requireState(request.sessionId)
    this.assertOptionalRouteIdentity(state, request.routeId, false)
    const current = state.timelineVersions.find((version) => version.isCurrent) ?? null
    const selected =
      request.version === undefined
        ? current
        : (state.timelineVersions.find((version) => version.version === request.version) ?? null)
    if (request.version !== undefined && !selected) {
      throw new AppError('INPUT_INVALID', '所选时间轴版本不存在。')
    }
    const pending = [...this.pendingTimelineDrafts.values()].find(
      (entry) => entry.sessionId === request.sessionId
    )
    const publishability =
      pending?.draft.gate ??
      (current
        ? {
            publishable: true,
            blockingItems: []
          }
        : {
            publishable: false,
            blockingItems: [
              {
                itemId: null,
                title: '时间轴',
                code: 'MISSING_PREREQUISITE' as const,
                message: '尚未准备时间轴草稿。'
              }
            ]
          })
    return D6SnapshotSchema.parse({
      sessionId: state.sessionId,
      routeId: state.selectedRouteId,
      stage: state.stage,
      currentVersion: current?.version ?? null,
      versions: state.timelineVersions
        .map((version) => ({
          version: version.version,
          createdAt: version.createdAt,
          summary: version.summary,
          isCurrent: version.isCurrent,
          routeId: version.routeId ?? null
        }))
        .sort((left, right) => right.version - left.version),
      selectedVersion: selected,
      draft: pending?.draft ?? null,
      publishability,
      sourceOutcomes: pending?.draft.sourceOutcomes ?? state.d6SourceOutcomes
    })
  }

  async cancelD6Operation(operationId: string): Promise<boolean> {
    this.cancelledD6Operations.add(operationId)
    await this.ctx.tools.cancelOperation(operationId)
    return true
  }

  async deriveTasks(input: { sessionId: string; routeId?: string }): Promise<D7Snapshot> {
    const request = TaskDeriveRequestSchema.parse(input)
    const state = this.requireD5State(request.sessionId, 'STAGE_5')
    this.assertOptionalRouteIdentity(state, request.routeId, true)
    const timeline = this.requireCurrentTimeline(state)
    const now = new Date().toISOString()
    const tasks = derivePreparationTasks({
      sessionId: request.sessionId,
      timeline,
      claims: this.ctx.tools.listEvidence(request.sessionId, 500),
      now
    })
    const payload = TaskUpdatedPayloadWriteSchema.parse({
      tasks,
      updatedTaskId: null,
      reason: 'DERIVED',
      replacementTimeline: null,
      decision: null
    })
    await this.record({
      sessionId: request.sessionId,
      eventVersion: 2,
      type: 'task/updated',
      payload
    })
    return this.d7Snapshot({ sessionId: request.sessionId, routeId: request.routeId })
  }

  async updateTask(input: TaskUpdateRequest): Promise<D7Snapshot> {
    const request = TaskUpdateRequestSchema.parse(input)
    const state = this.requireD5State(request.sessionId, 'STAGE_5')
    this.assertOptionalRouteIdentity(state, request.routeId, true)
    const payload = applyTaskUpdate({
      tasks: state.tasks,
      currentTimeline: this.requireCurrentTimeline(state),
      taskId: request.taskId,
      expectedUpdatedAt: request.expectedUpdatedAt,
      action: request.action,
      now: new Date().toISOString()
    })
    await this.record({
      sessionId: request.sessionId,
      eventVersion: 2,
      type: 'task/updated',
      payload
    })
    return this.d7Snapshot({ sessionId: request.sessionId, routeId: request.routeId })
  }

  async runGateC(input: { sessionId: string; routeId?: string }): Promise<D7Snapshot> {
    const request = GateCRunRequestSchema.parse(input)
    const state = this.requireD5State(request.sessionId, 'STAGE_5')
    this.assertOptionalRouteIdentity(state, request.routeId, true)
    const report = buildGateC({
      timeline: this.requireCurrentTimeline(state),
      tasks: state.tasks,
      claims: this.ctx.tools.listEvidence(request.sessionId, 500),
      now: new Date().toISOString()
    })
    await this.record({
      sessionId: request.sessionId,
      eventVersion: 2,
      type: 'gate/result',
      payload: { report }
    })
    return this.d7Snapshot({ sessionId: request.sessionId, routeId: request.routeId })
  }

  d7Snapshot(input: { sessionId: string; routeId?: string }): D7Snapshot {
    const request = D7SnapshotRequestSchema.parse(input)
    const state = this.requireState(request.sessionId)
    this.assertOptionalRouteIdentity(state, request.routeId, false)
    const current = state.timelineVersions.find((version) => version.isCurrent) ?? null
    return D7SnapshotSchema.parse({
      sessionId: state.sessionId,
      routeId: state.selectedRouteId,
      stage: state.stage,
      currentVersion: current?.version ?? null,
      tasks: state.tasks,
      latestGateC: state.latestGateC,
      audit: { externalCalls: 0, modelCalls: 0, irreversibleActions: 0 }
    })
  }

  prepareItineraryExport(input: ItineraryExportRequest): PreparedExport {
    const request = ItineraryExportRequestSchema.parse(input)
    const state = this.requireD5State(request.sessionId, 'STAGE_5')
    this.assertOptionalRouteIdentity(state, request.routeId, true)
    return prepareItineraryExport(
      {
        sessionId: request.sessionId,
        timeline: this.requireCurrentTimeline(state),
        tasks: state.tasks,
        gate: state.latestGateC
      },
      request.format
    )
  }

  previewMultiCityRoutes(input: { sessionId: string }): RoutePlanPreview {
    const request = RoutePlanPreviewRequestSchema.parse(input)
    this.cleanupRoutePlans()
    const state = this.requireState(request.sessionId)
    if (state.stage !== 'STAGE_2' || !state.basics) {
      throw new AppError('GATE_BLOCKED', '多城市路线只能在 STAGE-2 且基础信息完整时预览。')
    }
    const goal = deriveMultiCityItineraryGoal(state.basics)
    const sourcePlan = buildMultiCityRouteSourcePlan(goal)
    const planId = randomUUID()
    const expiresAt = Date.now() + ROUTE_PLAN_TTL_MS
    const stateDigest = this.routeStateDigest(request.sessionId)
    const expiresAtIso = new Date(expiresAt).toISOString()
    const digest = this.routePlanDigest(
      request.sessionId,
      goal,
      sourcePlan,
      stateDigest,
      expiresAtIso
    )
    const preview = RoutePlanPreviewSchema.parse({
      sessionId: request.sessionId,
      planId,
      expiresAt: expiresAtIso,
      digest,
      goal,
      topologySignatures: sourcePlan.topologySignatures,
      plannedCalls: sourcePlan.plannedCalls,
      totalExternalCalls: sourcePlan.plannedCalls.length,
      retryCount: 0
    })
    for (const [existingPlanId, pending] of this.pendingRoutePlans) {
      if (pending.preview.sessionId === request.sessionId) {
        this.pendingRoutePlans.delete(existingPlanId)
      }
    }
    this.pendingRoutePlans.set(planId, {
      preview,
      stateDigest,
      expiresAt
    })
    return preview
  }

  async executeMultiCityRoutes(
    input: RoutePlanExecuteRequest,
    onProgress?: RouteProgressListener
  ): Promise<MultiCityRouteSnapshot> {
    const request = RoutePlanExecuteRequestSchema.parse(input)
    this.cleanupRoutePlans()
    const pending = this.pendingRoutePlans.get(request.planId)
    if (!pending || pending.preview.sessionId !== request.sessionId) {
      throw new AppError('INPUT_INVALID', '路线来源计划不存在或已经过期。')
    }
    if (pending.preview.digest !== request.digest) {
      throw new AppError('INPUT_INVALID', '路线来源计划摘要不匹配。')
    }
    const state = this.requireState(request.sessionId)
    if (state.stage !== 'STAGE_2' || !state.basics) {
      throw new AppError('GATE_BLOCKED', '路线来源计划只能在 STAGE-2 执行。')
    }
    if (pending.stateDigest !== this.routeStateDigest(request.sessionId)) {
      this.pendingRoutePlans.delete(request.planId)
      throw new AppError('GATE_BLOCKED', '行程事实已经变化，请重新预览路线来源计划。')
    }
    const goal = deriveMultiCityItineraryGoal(state.basics)
    const rebuilt = buildMultiCityRouteSourcePlan(goal)
    if (
      request.digest !==
      this.routePlanDigest(
        request.sessionId,
        goal,
        rebuilt,
        pending.stateDigest,
        pending.preview.expiresAt
      )
    ) {
      this.pendingRoutePlans.delete(request.planId)
      throw new AppError('GATE_BLOCKED', '路线来源计划已失效，请重新预览。')
    }
    this.consumeRouteOperation(request.operationId)
    this.pendingRoutePlans.delete(request.planId)
    this.emitRouteProgress(
      onProgress,
      request,
      'STARTED',
      0,
      pending.preview.plannedCalls.length,
      '开始核验多城市交通腿。'
    )

    const finalClaims: EvidenceClaim[] = []
    const sourceOutcomes: RouteSourceOutcome[] = []
    const plannedCalls = pending.preview.plannedCalls
    const batchOutcomes = await this.ctx.tools.discoverRailOptionsBatch(
      plannedCalls.map((call) => ({
        sessionId: request.sessionId,
        direction:
          normalizeDestinationCity(call.toCity) === normalizeDestinationCity(goal.originCity)
            ? 'RETURN'
            : 'OUTBOUND',
        date: call.travelDate,
        fromStation: call.fromCity,
        toStation: call.toCity
      })),
      request.operationId,
      (completed, total) =>
        this.emitRouteProgress(
          onProgress,
          request,
          'SOURCE_COMPLETED',
          completed,
          total,
          `已处理 ${completed}/${total} 条交通来源调用。`
        )
    )
    for (const [index, call] of plannedCalls.entries()) {
      const batchOutcome = batchOutcomes[index]
      if (!batchOutcome) {
        throw new AppError('INTERNAL_INVARIANT_VIOLATED', '铁路批次结果与路线来源计划不一致。')
      }
      if (batchOutcome.ok) {
        const options = batchOutcome.options
        if (options.length === 0) {
          sourceOutcomes.push(this.emptyRouteSourceOutcome(call))
        } else {
          const option = [...options].sort(compareRailOptions)[0]!
          const claim = this.routeClaimFromRailOption(request.sessionId, call, option)
          finalClaims.push(claim)
          sourceOutcomes.push({
            callId: call.callId,
            sourceId: call.sourceId,
            toolName: call.toolName,
            status: 'SUCCEEDED',
            claimIds: [claim.claimId],
            errorCode: null,
            capabilityImpact: null,
            manualAlternative: null
          })
        }
      } else {
        const serialized = serializeError(batchOutcome.error)
        if (serialized.code === 'SOURCE_CANCELLED') throw batchOutcome.error
        if (serialized.klass !== 'SOURCE' && serialized.code !== 'GATE_BLOCKED') {
          throw batchOutcome.error
        }
        sourceOutcomes.push(
          serialized.code === 'GATE_BLOCKED'
            ? this.emptyRouteSourceOutcome(call)
            : {
                callId: call.callId,
                sourceId: call.sourceId,
                toolName: call.toolName,
                status: 'FAILED',
                claimIds: [],
                errorCode: serialized.code,
                capabilityImpact: `${call.fromCity}→${call.toCity} 无法完成自动核验。`,
                manualAlternative: '可补充航班或客运人工证据后重新生成路线。'
              }
        )
      }
    }

    const existingClaims = this.ctx.tools
      .listEvidence(request.sessionId, 200)
      .filter((claim) => claim.predicate === 'routeLeg')
    const result = buildMultiCityRouteCandidates({
      sessionId: request.sessionId,
      goal,
      claims: [...existingClaims, ...finalClaims],
      sourceOutcomes,
      now: new Date().toISOString()
    })
    const payload = RouteCandidatesPreparedPayloadSchema.parse({
      goal,
      candidates: result.candidates,
      sourceOutcomes,
      finalClaims,
      blockingReasons: result.blockingReasons
    })
    await this.record({
      sessionId: request.sessionId,
      eventVersion: 2,
      type: 'itinerary/route-candidates-prepared',
      payload
    })
    this.emitRouteProgress(
      onProgress,
      request,
      'COMPLETED',
      sourceOutcomes.length,
      pending.preview.plannedCalls.length,
      result.blockingReasons.length === 0
        ? '多城市路线候选已经生成。'
        : '候选已生成，但关键交通证据仍有缺口。'
    )
    return this.multiCityRouteSnapshot({ sessionId: request.sessionId })
  }

  async selectMultiCityRoute(input: RouteSelectRequest): Promise<MultiCityRouteSnapshot> {
    const request = RouteSelectRequestSchema.parse(input)
    const state = this.requireState(request.sessionId)
    if (state.stage !== 'STAGE_2') {
      throw new AppError('GATE_BLOCKED', '多城市路线只能在 STAGE-2 选择。')
    }
    const chosen = state.routeCandidates.find((candidate) => candidate.routeId === request.routeId)
    if (!chosen) throw new AppError('INPUT_INVALID', '所选路线不属于当前候选集。')
    if (
      !chosen.score.hardConstraintPass ||
      !chosen.score.criticalEvidenceComplete ||
      chosen.blockingReasons.length > 0
    ) {
      throw new AppError('GATE_BLOCKED', '该路线仍缺少关键交通证据，不能进入下一阶段。')
    }
    const rejected = state.routeCandidates
      .filter((candidate) => candidate.routeId !== chosen.routeId)
      .map((candidate) => ({
        routeId: candidate.routeId,
        profile: candidate.profile,
        reason: candidate.materialDifferences[0] ?? '未选择该候选。'
      }))
    const payload = RouteSelectedPayloadSchema.parse({
      fromStage: 'STAGE_2',
      toStage: 'STAGE_3',
      confirmed: true,
      selectedRouteId: chosen.routeId,
      chosen,
      rejected,
      reason: chosen.isRecommended
        ? '用户确认系统按可核验交通、在途时间、换乘、体力与预算完整性综合推荐的路线。'
        : '用户在查看候选差异后主动选择了非默认推荐路线。'
    })
    await this.record({
      sessionId: request.sessionId,
      eventVersion: 2,
      type: 'itinerary/route-selected',
      payload
    })
    return this.multiCityRouteSnapshot({ sessionId: request.sessionId })
  }

  async applyManualRouteLegEvidence(
    input: ManualRouteLegEvidenceRequest
  ): Promise<MultiCityRouteSnapshot> {
    const request = ManualRouteLegEvidenceRequestSchema.parse(input)
    const state = this.requireState(request.sessionId)
    if (state.stage !== 'STAGE_2' || !state.basics || !state.itineraryGoal) {
      throw new AppError('GATE_BLOCKED', '人工交通证据只能补充到 STAGE-2 的当前路线候选。')
    }
    const route = state.routeCandidates.find((candidate) => candidate.routeId === request.routeId)
    const leg = route?.legs.find((candidateLeg) => candidateLeg.legId === request.legId)
    if (!route || !leg) {
      throw new AppError('INPUT_INVALID', '目标路线交通腿不存在或已经失效。')
    }
    const materialized = materializeManualRouteLegEvidence(request, {
      fromCity: leg.fromCity,
      toCity: leg.toCity,
      travelDate: leg.travelDate
    })
    const existingClaims = await this.routeEvidenceClaimsFromEventLog(request.sessionId)
    if (existingClaims.some((claim) => claim.claimId === materialized.claim.claimId)) {
      return this.multiCityRouteSnapshot({ sessionId: request.sessionId })
    }
    if (leg.verificationStatus !== 'UNVERIFIED' || !leg.critical) {
      throw new AppError('GATE_BLOCKED', '当前交通腿不是可补充的关键未核验缺口。')
    }
    const result = buildMultiCityRouteCandidates({
      sessionId: request.sessionId,
      goal: state.itineraryGoal,
      claims: [...existingClaims, materialized.claim],
      sourceOutcomes: state.routeSourceOutcomes,
      now: materialized.claim.observedAt
    })
    const payload = RouteManualEvidenceAppliedPayloadSchema.parse({
      goal: state.itineraryGoal,
      scope: materialized.scope,
      claim: materialized.claim,
      candidates: result.candidates,
      blockingReasons: result.blockingReasons
    })
    await this.record({
      sessionId: request.sessionId,
      eventVersion: 2,
      type: 'itinerary/route-manual-evidence-applied',
      payload
    })
    return this.multiCityRouteSnapshot({ sessionId: request.sessionId })
  }

  multiCityRouteSnapshot(input: { sessionId: string }): MultiCityRouteSnapshot {
    const request = MultiCityRouteSnapshotRequestSchema.parse(input)
    const state = this.requireState(request.sessionId)
    return MultiCityRouteSnapshotSchema.parse({
      sessionId: state.sessionId,
      stage: state.stage,
      goal:
        state.itineraryGoal ??
        (state.basics?.itineraryIntent?.kind === 'MULTI_CITY_ROUTE'
          ? deriveMultiCityItineraryGoal(state.basics)
          : null),
      candidates: state.routeCandidates,
      selectedRouteId: state.selectedRouteId,
      sourceOutcomes: state.routeSourceOutcomes,
      blockingReasons: state.routeBlockingReasons
    })
  }

  cancelMultiCityRouteOperation(input: { operationId: string }): Promise<boolean> {
    const request = RouteCancelRequestSchema.parse(input)
    return this.ctx.tools.cancelOperation(request.operationId)
  }

  routeNodeResearchSnapshot(input: RouteResearchSnapshotRequest): RouteNodeD4Snapshot {
    const request = RouteResearchSnapshotRequestSchema.parse(input)
    const { state, nodeState } = this.resolveSelectedResearchNode(request, false)
    const summaries = summarizeRouteNodeResearchStates(state.routeNodeResearchStates)
    const nextRequired = summaries.find(
      (summary) => summary.required && summary.status !== 'CONFIRMED'
    )
    return RouteNodeD4SnapshotSchema.parse({
      sessionId: state.sessionId,
      stage: state.stage,
      selectedRouteId: request.routeId,
      nodeSummaries: summaries,
      currentScope: nodeState.scope,
      currentNode: nodeState,
      routeResearchComplete: summaries
        .filter((summary) => summary.required)
        .every((summary) => summary.status === 'CONFIRMED'),
      nextRequiredNodeId: nextRequired?.scope.nodeId ?? null
    })
  }

  async previewRouteNodeResearch(
    input: RouteResearchPreviewRequest
  ): Promise<NodeResearchPlanPreview> {
    const request = RouteResearchPreviewRequestSchema.parse(input)
    this.cleanupNodeResearchPlans()
    const { state, nodeState } = this.resolveSelectedResearchNode(request, true)
    if (!nodeState.required || nodeState.status === 'SKIPPED') {
      throw new AppError('GATE_BLOCKED', '该中转节点无需研究。')
    }
    if (nodeState.status === 'CONFIRMED') {
      throw new AppError('GATE_BLOCKED', '该节点研究已经确认。')
    }
    const providerSummary = await this.ctx.provider.configSummary()
    const extraction = providerSummary.routes?.EXTRACTION
    const review = providerSummary.routes?.REVIEW
    if (!extraction || !review) {
      throw new AppError('PROVIDER_UNCONFIGURED', '节点研究需要 EXTRACTION 与 REVIEW 路由。')
    }
    const mandatoryNames = this.nodeMandatoryPlaceNames(state, nodeState)
    const sourcePlan: NodeResearchPlanPreview['sourcePlan'] =
      request.mode === 'STANDARD'
        ? [
            {
              sequence: 1,
              sourceId: 'SRC_SEARCH',
              toolName: 'deepseek_web_search',
              query:
                `${nodeState.scope.city} ${mandatoryNames.join(' ')} 景点 体验 餐饮 官方 开放时间 预约 老人 儿童 步行 台阶`.trim(),
              queryKind: null,
              callCount: 1
            },
            {
              sequence: 2,
              sourceId: 'SRC_XHS',
              toolName: 'search_feeds+get_feed_detail',
              query: nodeState.scope.city,
              queryKind: 'POSITIVE_LOCATION',
              callCount: 3
            },
            {
              sequence: 3,
              sourceId: 'SRC_XHS',
              toolName: 'search_feeds+get_feed_detail',
              query: `避雷 ${nodeState.scope.city}`,
              queryKind: 'NEGATIVE_AVOIDANCE',
              callCount: 3
            }
          ]
        : [
            ...xhsRankingQueries(nodeState.scope.city).map((query, index) => ({
              sequence: index + 1,
              sourceId: 'SRC_XHS' as const,
              toolName: 'search_feeds',
              query,
              queryKind:
                index < 2 ? ('POSITIVE_LOCATION' as const) : ('NEGATIVE_AVOIDANCE' as const),
              callCount: 1
            })),
            {
              sequence: 5,
              sourceId: 'SRC_XHS',
              toolName: 'get_feed_detail',
              query: '冻结的 15 条推荐样本与 15 条避雷样本',
              queryKind: null,
              callCount: 30
            }
          ]
    const modelPlan: NodeResearchPlanPreview['modelPlan'] = [
      {
        sequence: 1,
        role: 'EXTRACTION',
        provider: extraction.channel,
        model: extraction.model,
        callCount: request.mode === 'STANDARD' ? 1 : 6,
        repairInvalid: request.mode === 'STANDARD'
      },
      {
        sequence: 2,
        role: 'REVIEW',
        provider: review.channel,
        model: review.model,
        callCount: 1,
        repairInvalid: request.mode === 'STANDARD'
      }
    ]
    const planId = randomUUID()
    const expiresAt = Date.now() + D4_XHS_PLAN_TTL_MS
    const stateDigest = this.nodeResearchStateDigest(state, nodeState)
    const providerDigest = digestD5Value({ extraction, review })
    const payload = {
      sessionId: state.sessionId,
      routeId: nodeState.scope.routeId,
      nodeId: nodeState.scope.nodeId,
      scope: nodeState.scope,
      mode: request.mode,
      planId,
      expiresAt: new Date(expiresAt).toISOString(),
      sourcePlan,
      modelPlan,
      totalExternalCalls: sourcePlan.reduce((sum, item) => sum + item.callCount, 0),
      totalModelCalls: modelPlan.reduce((sum, item) => sum + item.callCount, 0),
      timeoutMs: 60_000 as const,
      retryCount: 0 as const
    }
    const digest = digestD5Value({ planVersion: 1, ...payload, stateDigest, providerDigest })
    const preview = NodeResearchPlanPreviewSchema.parse({ ...payload, digest })
    for (const [existingPlanId, pending] of this.pendingNodeResearchPlans) {
      if (
        pending.preview.sessionId === request.sessionId &&
        pending.preview.routeId === request.routeId &&
        pending.preview.nodeId === request.nodeId
      ) {
        this.pendingNodeResearchPlans.delete(existingPlanId)
      }
    }
    this.pendingNodeResearchPlans.set(planId, {
      preview,
      stateDigest,
      providerDigest,
      expiresAt
    })
    return preview
  }

  async executeRouteNodeResearch(
    input: RouteResearchExecuteRequest,
    onProgress?: RouteResearchProgressListener
  ): Promise<RouteNodeD4Snapshot> {
    const request = RouteResearchExecuteRequestSchema.parse(input)
    this.cleanupNodeResearchPlans()
    const pending = this.pendingNodeResearchPlans.get(request.planId)
    if (
      !pending ||
      pending.preview.sessionId !== request.sessionId ||
      pending.preview.routeId !== request.routeId ||
      pending.preview.nodeId !== request.nodeId
    ) {
      throw new AppError('INPUT_INVALID', '节点研究预览不存在或已经过期。')
    }
    if (pending.preview.digest !== request.digest) {
      throw new AppError('INPUT_INVALID', '节点研究摘要已变化，请重新预览并授权。')
    }
    const { state, nodeState } = this.resolveSelectedResearchNode(request, true)
    if (pending.stateDigest !== this.nodeResearchStateDigest(state, nodeState)) {
      this.pendingNodeResearchPlans.delete(request.planId)
      throw new AppError('GATE_BLOCKED', '路线或节点状态已变化，请重新预览。')
    }
    const providerSummary = await this.ctx.provider.configSummary()
    if (
      pending.providerDigest !==
      digestD5Value({
        extraction: providerSummary.routes?.EXTRACTION,
        review: providerSummary.routes?.REVIEW
      })
    ) {
      this.pendingNodeResearchPlans.delete(request.planId)
      throw new AppError('GATE_BLOCKED', '模型路由已变化，请重新预览。')
    }
    this.consumeNodeResearchOperation(request.operationId)
    this.pendingNodeResearchPlans.delete(request.planId)
    return pending.preview.mode === 'STANDARD'
      ? this.executeStandardRouteNodeResearch(request, nodeState, onProgress)
      : this.executeStrictXhsRouteNodeResearch(request, nodeState, onProgress)
  }

  async prepareManualRouteNodeResearch(
    input: RouteResearchManualRequest
  ): Promise<RouteNodeD4Snapshot> {
    const request = RouteResearchManualRequestSchema.parse(input)
    ManualResearchChecklistRequestSchema.parse({
      sessionId: request.sessionId,
      items: request.items
    })
    const { nodeState } = this.resolveSelectedResearchNode(request, true)
    if (!nodeState.required) throw new AppError('GATE_BLOCKED', '该中转节点无需人工研究。')
    const evidenceScope = evidenceScopeForNode(nodeState.scope)
    const pasteIds = new Set(
      this.ctx.tools
        .listEvidence(request.sessionId, 500)
        .filter(
          (claim) =>
            claim.sourceId === 'USER_PASTE' && sameNodeEvidenceScope(claim.scope, evidenceScope)
        )
        .map((claim) => claim.claimId)
    )
    if (
      request.items.some((item) => item.sourceClaimId !== null && !pasteIds.has(item.sourceClaimId))
    ) {
      throw new AppError('INPUT_INVALID', '关联线索不属于当前路线节点或不是 USER_PASTE。')
    }
    const materialized = materializeManualResearch(
      { sessionId: request.sessionId, items: request.items },
      nodeState.scope.city,
      new Date(),
      evidenceScope
    )
    this.assertRouteNodeResearchEntities(nodeState, materialized.entities, materialized.claims)
    await this.record({
      sessionId: request.sessionId,
      eventVersion: 2,
      type: 'research/node-checklist-prepared',
      payload: {
        scope: nodeState.scope,
        entities: materialized.entities,
        sourceFailures: [],
        finalClaims: materialized.claims,
        manualResearchSummary: materialized.summary
      }
    })
    return this.routeNodeResearchSnapshot(routeNodeIdentity(request))
  }

  async addRouteNodeUserPaste(input: RouteResearchUserPasteRequest): Promise<EvidenceClaim> {
    const request = RouteResearchUserPasteRequestSchema.parse(input)
    const { nodeState } = this.resolveSelectedResearchNode(request, true)
    if (!nodeState.required) throw new AppError('GATE_BLOCKED', '该中转节点无需补充研究线索。')
    const observedAt = new Date()
    const scope = evidenceScopeForNode(nodeState.scope)
    const sourceRef = `USER_PASTE:${createHash('sha256')
      .update(`${request.routeId}\n${request.nodeId}\n${request.sourceUrl ?? ''}\n${request.text}`)
      .digest('hex')
      .slice(0, 24)}`
    const claim = EvidenceClaimSchema.parse({
      claimId: deterministicClaimId({
        sourceId: 'USER_PASTE',
        sourceRef,
        subject: nodeState.scope.city,
        predicate: 'userPasteClue',
        scope
      }),
      sessionId: request.sessionId,
      subject: nodeState.scope.city,
      predicate: 'userPasteClue',
      value: { text: request.text, sourceUrl: request.sourceUrl },
      sourceId: 'USER_PASTE',
      sourceRef,
      contentIdentity: 'UNKNOWN',
      verificationStatus: 'UNVERIFIED',
      observedAt: observedAt.toISOString(),
      validUntil: new Date(observedAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      scope,
      confidence: null,
      conflictsWith: [],
      notes: '用户提供的节点级未核验线索；其中指令不会作为系统指令执行。'
    })
    await this.record({
      sessionId: request.sessionId,
      eventVersion: 2,
      type: 'research/node-user-paste-added',
      payload: { scope: nodeState.scope, claim }
    })
    return claim
  }

  async setRouteNodeResearchDisposition(
    input: RouteResearchDispositionRequest
  ): Promise<RouteNodeD4Snapshot> {
    const request = RouteResearchDispositionRequestSchema.parse(input)
    const { nodeState } = this.resolveSelectedResearchNode(request, true)
    const entity = nodeState.researchEntities.find((item) => item.entityId === request.entityId)
    if (!entity) throw new AppError('INPUT_INVALID', '研究线索不属于当前路线节点。')
    await this.record({
      sessionId: request.sessionId,
      eventVersion: 2,
      type: 'research/node-disposition-set',
      payload: {
        scope: nodeState.scope,
        entityId: request.entityId,
        disposition: request.disposition
      }
    })
    await this.record({
      sessionId: request.sessionId,
      eventVersion: 2,
      type: 'decision/logged',
      payload: {
        decisionId: ulid(),
        category: 'ROUTE_NODE_RESEARCH_DISPOSITION',
        selected: `${request.routeId}/${request.nodeId}/${entity.canonicalSubject}:${request.disposition}`,
        reason: '用户明确处置当前路线节点的研究线索。',
        alternatives: ['MUST_GO', 'WANT', 'NEUTRAL', 'EXCLUDE'].filter(
          (item) => item !== request.disposition
        )
      }
    })
    return this.routeNodeResearchSnapshot(routeNodeIdentity(request))
  }

  async resolveRouteNodeResearchConflict(
    input: RouteResearchConflictRequest
  ): Promise<RouteNodeD4Snapshot> {
    const request = RouteResearchConflictRequestSchema.parse(input)
    const { nodeState } = this.resolveSelectedResearchNode(request, true)
    const scope = evidenceScopeForNode(nodeState.scope)
    const group = this.ctx.tools
      .listEvidence(request.sessionId, 500)
      .filter(
        (claim) =>
          sameNodeEvidenceScope(claim.scope, scope) &&
          claim.verificationStatus === 'CONFLICTED' &&
          normalizeEvidenceSubject(claim.subject) === normalizeEvidenceSubject(request.subject) &&
          claim.predicate.normalize('NFKC').trim().toLowerCase() ===
            request.predicate.normalize('NFKC').trim().toLowerCase()
      )
    if (group.length < 2) throw new AppError('INPUT_INVALID', '当前节点没有可裁决的冲突双方。')
    if (
      request.selectedClaimId !== null &&
      !group.some((claim) => claim.claimId === request.selectedClaimId)
    ) {
      throw new AppError('INPUT_INVALID', '选中的 Claim 不属于当前节点冲突组。')
    }
    const resolution = {
      subject: normalizeEvidenceSubject(request.subject),
      predicate: request.predicate,
      resolution: request.resolution,
      selectedClaimId: request.selectedClaimId,
      resolvedAt: new Date().toISOString(),
      scope
    } as const
    await this.record({
      sessionId: request.sessionId,
      eventVersion: 2,
      type: 'research/node-conflict-resolved',
      payload: { scope: nodeState.scope, resolution }
    })
    return this.routeNodeResearchSnapshot(routeNodeIdentity(request))
  }

  async confirmRouteNodeResearch(input: RouteResearchConfirmRequest): Promise<RouteNodeD4Snapshot> {
    const request = RouteResearchConfirmRequestSchema.parse(input)
    const { state, nodeState } = this.resolveSelectedResearchNode(request, true)
    if (!nodeState.required) throw new AppError('GATE_BLOCKED', '可跳过节点无需确认。')
    const scope = evidenceScopeForNode(nodeState.scope)
    const claims = this.ctx.tools
      .listEvidence(request.sessionId, 500)
      .filter((claim) => sameNodeEvidenceScope(claim.scope, scope))
    const blockers = this.routeNodeResearchBlockers(state, nodeState, claims)
    if (blockers.length > 0) {
      throw new AppError('GATE_BLOCKED', '当前节点研究清单未通过确认门。', {
        userHint: `请先处理：${blockers.join('；')}。`
      })
    }
    const confirmedAt = new Date().toISOString()
    const nextStates = state.routeNodeResearchStates.map((item) =>
      item.scope.routeId === request.routeId && item.scope.nodeId === request.nodeId
        ? {
            ...item,
            status: 'CONFIRMED' as const,
            researchChecklistConfirmed: true,
            blockingReasons: [],
            confirmedAt
          }
        : item
    )
    const routeResearchComplete = nextStates
      .filter((item) => item.required)
      .every((item) => item.status === 'CONFIRMED')
    await this.record({
      sessionId: request.sessionId,
      eventVersion: 2,
      type: 'research/node-confirmed',
      payload: {
        scope: nodeState.scope,
        confirmedAt,
        nodeSummaries: summarizeRouteNodeResearchStates(nextStates),
        routeResearchComplete,
        transition: routeResearchComplete
          ? { fromStage: 'STAGE_3', toStage: 'STAGE_4', confirmed: true }
          : null
      }
    })
    return this.routeNodeResearchSnapshot(routeNodeIdentity(request))
  }

  cancelRouteNodeResearchOperation(input: { operationId: string }): Promise<boolean> {
    return this.ctx.tools.cancelOperation(input.operationId)
  }

  d4Snapshot(sessionId: string): D4Snapshot {
    const state = this.requireState(sessionId)
    const excludedEntityIds = new Set(
      state.researchEntities
        .filter((entity) => entity.disposition === 'EXCLUDE')
        .map((entity) => entity.entityId)
    )
    const attractionRankings = state.attractionRankings
      .filter((ranking) => !excludedEntityIds.has(ranking.entityId))
      .map((ranking, index) => ({ ...ranking, rank: index + 1 }))
    return D4SnapshotSchema.parse({
      sessionId: state.sessionId,
      stage: state.stage,
      fixedDestinationCity:
        state.stage === 'STAGE_2' && state.basics?.destinationCities.length === 1
          ? normalizeDestinationCity(state.basics.destinationCities[0]!)
          : null,
      destinationCandidates: state.destinationCandidates,
      selectedDestinationCandidateId: state.selectedDestinationCandidateId,
      researchEntities: state.researchEntities,
      researchChecklistConfirmed: state.researchChecklistConfirmed,
      conflictResolutions: state.conflictResolutions,
      sourceResearchFailures: state.sourceResearchFailures,
      xhsSampleSummary: state.xhsSampleSummary,
      manualResearchSummary: state.manualResearchSummary,
      attractionRankings
    })
  }

  cancelD4Operation(operationId: string): Promise<boolean> {
    return this.ctx.tools.cancelOperation(operationId)
  }

  private routePlanDigest(
    sessionId: string,
    goal: RoutePlanPreview['goal'],
    sourcePlan: Pick<RoutePlanPreview, 'topologySignatures' | 'plannedCalls'>,
    stateDigest: string,
    expiresAt: string
  ): string {
    return digestD5Value({
      planVersion: 1,
      sessionId,
      stateDigest,
      expiresAt,
      goal,
      topologySignatures: sourcePlan.topologySignatures,
      plannedCalls: sourcePlan.plannedCalls,
      totalExternalCalls: sourcePlan.plannedCalls.length,
      retryCount: 0
    })
  }

  private async routeEvidenceClaimsFromEventLog(sessionId: string): Promise<EvidenceClaim[]> {
    const claims = new Map<string, EvidenceClaim>()
    for (const event of await this.ctx.eventLog.read(sessionId)) {
      const candidates =
        event.type === 'itinerary/route-candidates-prepared'
          ? event.payload.finalClaims
          : event.type === 'itinerary/route-manual-evidence-applied'
            ? [event.payload.claim]
            : event.type === 'evidence/added'
              ? [event.payload.claim]
              : []
      for (const claim of candidates) {
        if (claim.sessionId === sessionId && claim.predicate === 'routeLeg') {
          claims.set(claim.claimId, claim)
        }
      }
    }
    return [...claims.values()]
  }

  private routeStateDigest(sessionId: string): string {
    const state = this.requireState(sessionId)
    return digestD5Value({
      sessionId: state.sessionId,
      lastSeq: state.lastSeq,
      stage: state.stage,
      basics: state.basics
    })
  }

  private consumeRouteOperation(operationId: string): void {
    this.cleanupRoutePlans()
    if (this.consumedRouteOperations.has(operationId)) {
      throw new AppError('INPUT_INVALID', '该路线来源授权已经使用。')
    }
    this.consumedRouteOperations.set(operationId, Date.now() + ROUTE_PLAN_TTL_MS)
  }

  private cleanupRoutePlans(): void {
    const now = Date.now()
    for (const [planId, pending] of this.pendingRoutePlans) {
      if (pending.expiresAt <= now) this.pendingRoutePlans.delete(planId)
    }
    for (const [operationId, expiresAt] of this.consumedRouteOperations) {
      if (expiresAt <= now) this.consumedRouteOperations.delete(operationId)
    }
  }

  private emitRouteProgress(
    listener: RouteProgressListener | undefined,
    request: { operationId: string; sessionId: string },
    kind: RouteProgressEvent['kind'],
    completedCalls: number,
    totalCalls: number,
    message: string
  ): void {
    listener?.(
      RouteProgressEventSchema.parse({
        operationId: request.operationId,
        sessionId: request.sessionId,
        kind,
        completedCalls,
        totalCalls,
        message
      })
    )
  }

  private emptyRouteSourceOutcome(
    call: RoutePlanPreview['plannedCalls'][number]
  ): RouteSourceOutcome {
    return {
      callId: call.callId,
      sourceId: call.sourceId,
      toolName: call.toolName,
      status: 'EMPTY',
      claimIds: [],
      errorCode: null,
      capabilityImpact: `${call.fromCity}→${call.toCity} 未返回可核验铁路选项。`,
      manualAlternative: '可补充航班或客运人工证据后重新生成路线。'
    }
  }

  private routeClaimFromRailOption(
    sessionId: string,
    call: RoutePlanPreview['plannedCalls'][number],
    option: RailOption
  ): EvidenceClaim {
    const observedAt = new Date()
    const durationMinutes =
      option.endAt === null
        ? null
        : Math.max(0, Math.round((Date.parse(option.endAt) - Date.parse(option.startAt)) / 60_000))
    const value = RouteLegEvidenceValueSchema.parse({
      fromCity: call.fromCity,
      toCity: call.toCity,
      travelDate: call.travelDate,
      mode: 'RAIL',
      label: option.title,
      durationMinutes,
      costCents: null,
      transferCount: 0,
      overnightArrival:
        option.endAt !== null && option.startAt.slice(0, 10) !== option.endAt.slice(0, 10)
    })
    const sourceRef = `SRC_RAIL:get-tickets:${digestD5Value({
      callId: call.callId,
      trainNo: option.trainNo,
      serviceDate: option.serviceDate,
      fromStation: option.fromStation,
      toStation: option.toStation
    })}`
    const subject = `${call.travelDate} ${call.fromCity}→${call.toCity} ${option.trainNo}`
    return EvidenceClaimSchema.parse({
      claimId: deterministicClaimId({
        sourceId: 'SRC_RAIL',
        sourceRef,
        subject,
        predicate: 'routeLeg'
      }),
      sessionId,
      subject,
      predicate: 'routeLeg',
      value,
      sourceId: 'SRC_RAIL',
      sourceRef,
      contentIdentity: 'TRANSACTION',
      verificationStatus: durationMinutes === null ? 'UNVERIFIED' : 'VERIFIED',
      observedAt: observedAt.toISOString(),
      validUntil: new Date(observedAt.getTime() + 15 * 60 * 1000).toISOString(),
      confidence: null,
      conflictsWith: [],
      notes: '路线规划仅核验车次与时刻；价格缺失时保持未知。'
    })
  }

  private async executeStandardRouteNodeResearch(
    request: RouteResearchExecuteRequest,
    nodeState: RouteNodeResearchState,
    onProgress?: RouteResearchProgressListener
  ): Promise<RouteNodeD4Snapshot> {
    const state = this.requireState(request.sessionId)
    const basics = state.basics
    if (!basics) throw new AppError('GATE_BLOCKED', '节点研究缺少基础信息。')
    const scope = evidenceScopeForNode(nodeState.scope)
    this.emitRouteResearchProgress(
      onProgress,
      request,
      'RESEARCH_STARTED',
      null,
      `开始研究 ${nodeState.scope.city} 节点。`
    )
    const memberConstraints = basics.travelers.map((group) => ({
      ageBand: group.ageBand,
      count: group.count,
      stamina: group.stamina,
      functionalLimits: group.functionalLimits
    }))
    const sourceResults = await this.sourceSubagent.runSerial(
      [
        {
          taskId: randomUUID(),
          sessionId: request.sessionId,
          sourceId: 'SRC_SEARCH',
          destination: nodeState.scope.city,
          query:
            `${nodeState.scope.city} ${this.nodeMandatoryPlaceNames(state, nodeState).join(' ')} 景点 体验 餐饮 官方 开放时间 预约 老人 儿童 步行 台阶`.trim(),
          toolName: 'deepseek_web_search',
          memberConstraints,
          scope
        },
        ...buildXhsDestinationTasks({
          sessionId: request.sessionId,
          destination: nodeState.scope.city,
          memberConstraints,
          scope
        })
      ],
      request.operationId
    )
    const sourceFailures: SourceResearchFailure[] = sourceResults.flatMap((result) =>
      result.status === 'FAILED'
        ? [
            {
              sourceId: result.sourceId,
              status: 'FAILED' as const,
              queryKind: result.queryKind,
              errorCode: result.errorCode,
              capabilityImpact: result.capabilityImpact,
              manualAlternative: result.manualAlternative,
              scope
            }
          ]
        : []
    )
    if (
      sourceResults.some(
        (result) => result.status === 'FAILED' && result.errorCode === 'SOURCE_CANCELLED'
      )
    ) {
      throw new AppError('SOURCE_CANCELLED', '节点研究任务已由用户取消。')
    }
    for (const result of sourceResults) {
      this.emitRouteResearchProgress(
        onProgress,
        request,
        'SOURCE_COMPLETED',
        result.sourceId,
        result.status === 'SUCCEEDED'
          ? `${result.sourceId} 已写入 ${result.claimIds.length} 条当前节点证据。`
          : `${result.sourceId} 失败：${result.capabilityImpact}`
      )
    }
    const eligible = currentOperationResearchClaims(
      this.ctx.tools.listEvidence(request.sessionId, 500),
      sourceResults,
      scope
    )
    if (eligible.length === 0) {
      await this.record({
        sessionId: request.sessionId,
        eventVersion: 2,
        type: 'research/node-checklist-prepared',
        payload: {
          scope: nodeState.scope,
          entities: [],
          sourceFailures,
          finalClaims: []
        }
      })
      this.emitRouteResearchProgress(
        onProgress,
        request,
        'COMPLETED',
        null,
        '当前节点没有可核验来源，已保留明确失败信息。'
      )
      return this.routeNodeResearchSnapshot(routeNodeIdentity(request))
    }
    const extracted = await this.research.run(
      request.sessionId,
      nodeState.scope.city,
      eligible,
      scope
    )
    const verified = await this.verification.run({
      sessionId: request.sessionId,
      destinationCity: nodeState.scope.city,
      claims: extracted.claims,
      travelers: basics.travelers,
      now: new Date(),
      kinds: extracted.kinds,
      aliases: extracted.aliases,
      scope
    })
    this.assertRouteNodeResearchEntities(nodeState, verified.entities, verified.claims)
    await this.record({
      sessionId: request.sessionId,
      eventVersion: 2,
      type: 'research/node-checklist-prepared',
      payload: {
        scope: nodeState.scope,
        entities: verified.entities,
        sourceFailures,
        finalClaims: verified.claims
      }
    })
    this.emitRouteResearchProgress(
      onProgress,
      request,
      'COMPLETED',
      null,
      `${nodeState.scope.city} 研究清单已生成。`
    )
    return this.routeNodeResearchSnapshot(routeNodeIdentity(request))
  }

  private async executeStrictXhsRouteNodeResearch(
    request: RouteResearchExecuteRequest,
    nodeState: RouteNodeResearchState,
    onProgress?: RouteResearchProgressListener
  ): Promise<RouteNodeD4Snapshot> {
    const state = this.requireState(request.sessionId)
    if (!state.basics) throw new AppError('GATE_BLOCKED', '节点研究缺少基础信息。')
    const scope = evidenceScopeForNode(nodeState.scope)
    this.emitRouteResearchProgress(
      onProgress,
      request,
      'RESEARCH_STARTED',
      'SRC_XHS',
      `开始执行 ${nodeState.scope.city} 的严格 4+30 / 6+1 研究。`
    )
    const source = await this.ctx.tools.runXhsRankingResearch(
      {
        sessionId: request.sessionId,
        destinationCity: nodeState.scope.city,
        scope
      },
      request.operationId,
      (completedSearches, completedDetails) =>
        this.emitRouteResearchProgress(
          onProgress,
          request,
          completedDetails > 0 ? 'XHS_DETAIL_COMPLETED' : 'XHS_SEARCH_COMPLETED',
          'SRC_XHS',
          completedDetails > 0
            ? `已串行读取 ${completedDetails}/30 条当前节点详情。`
            : `已完成 ${completedSearches}/4 次当前节点冻结查询。`
        )
    )
    if (
      source.claims.some(
        (claim) =>
          !sameNodeEvidenceScope(claim.scope, scope) ||
          normalizeDestinationCity(nodeState.scope.city) !==
            normalizeDestinationCity(source.sampleSummary.destinationCity)
      )
    ) {
      throw new AppError('INTERNAL_SCHEMA_MISMATCH', '小红书来源结果跨越了当前节点。')
    }
    const ranked = await this.xhsRanking.run({
      sessionId: request.sessionId,
      destinationCity: nodeState.scope.city,
      sourceClaims: source.claims,
      travelers: state.basics.travelers,
      scope,
      onBatchComplete: (completedBatches) =>
        this.emitRouteResearchProgress(
          onProgress,
          request,
          'XHS_EXTRACTION_COMPLETED',
          'SRC_XHS',
          `已完成 ${completedBatches}/6 个当前节点 EXTRACTION 批次。`
        )
    })
    this.emitRouteResearchProgress(
      onProgress,
      request,
      'XHS_REVIEW_COMPLETED',
      'SRC_XHS',
      '已完成当前节点唯一一次 REVIEW。'
    )
    this.assertRouteNodeResearchEntities(nodeState, ranked.entities, ranked.claims)
    await this.record({
      sessionId: request.sessionId,
      eventVersion: 2,
      type: 'research/node-checklist-prepared',
      payload: {
        scope: nodeState.scope,
        entities: ranked.entities,
        sourceFailures: [],
        xhsSampleSummary: source.sampleSummary,
        attractionRankings: ranked.rankings,
        finalClaims: ranked.claims
      }
    })
    this.emitRouteResearchProgress(
      onProgress,
      request,
      'COMPLETED',
      'SRC_XHS',
      `${nodeState.scope.city} 的严格景点排序已完成；UGC 仍为未核验线索。`
    )
    return this.routeNodeResearchSnapshot(routeNodeIdentity(request))
  }

  private resolveSelectedResearchNode(
    input: { sessionId: string; routeId: string; nodeId: string },
    requireStage3: boolean
  ): { state: TravelState; nodeState: RouteNodeResearchState } {
    const state = this.requireState(input.sessionId)
    if (
      (requireStage3 && state.stage !== 'STAGE_3') ||
      (!requireStage3 && state.stage !== 'STAGE_3' && state.stage !== 'STAGE_4')
    ) {
      throw new AppError('GATE_BLOCKED', '路线节点研究只能在 STAGE-3 执行。')
    }
    if (!state.selectedRouteId || state.selectedRouteId !== input.routeId) {
      throw new AppError('INPUT_INVALID', '请求路线不是当前已选路线。')
    }
    const candidate = state.routeCandidates.find((item) => item.routeId === input.routeId)
    const routeNode = candidate?.nodes.find((node) => node.nodeId === input.nodeId)
    const nodeState = state.routeNodeResearchStates.find(
      (item) => item.scope.routeId === input.routeId && item.scope.nodeId === input.nodeId
    )
    if (!candidate || !routeNode || !nodeState) {
      throw new AppError('INPUT_INVALID', '请求节点不属于当前已选路线。')
    }
    if (
      routeNode.city !== nodeState.scope.city ||
      routeNode.nodeKind !== nodeState.scope.nodeKind ||
      JSON.stringify(routeNode.mandatoryPlaceIds) !==
        JSON.stringify(nodeState.scope.mandatoryPlaceIds) ||
      nodeState.scope.sessionId !== input.sessionId
    ) {
      throw new AppError('INTERNAL_INVARIANT_VIOLATED', '路线节点研究状态已经漂移。')
    }
    return { state, nodeState }
  }

  private nodeMandatoryPlaceNames(state: TravelState, nodeState: RouteNodeResearchState): string[] {
    const byId = new Map(
      (state.basics?.itineraryIntent?.kind === 'MULTI_CITY_ROUTE'
        ? state.basics.itineraryIntent.mandatoryPlaces
        : []
      ).map((place) => [place.placeId, place])
    )
    return nodeState.scope.mandatoryPlaceIds.map((placeId) => {
      const place = byId.get(placeId)
      if (
        !place ||
        normalizeDestinationCity(place.nodeCity) !== normalizeDestinationCity(nodeState.scope.city)
      ) {
        throw new AppError('INTERNAL_INVARIANT_VIOLATED', '必去地点与路线节点映射不一致。')
      }
      return place.displayName
    })
  }

  private assertRouteNodeResearchEntities(
    nodeState: RouteNodeResearchState,
    entities: RouteNodeResearchState['researchEntities'],
    pendingClaims: EvidenceClaim[] = []
  ): void {
    const scope = evidenceScopeForNode(nodeState.scope)
    const known = new Map(
      this.ctx.tools
        .listEvidence(nodeState.scope.sessionId, 500)
        .filter((claim) => sameNodeEvidenceScope(claim.scope, scope))
        .map((claim) => [claim.claimId, claim])
    )
    for (const claim of pendingClaims) {
      if (
        claim.sessionId !== nodeState.scope.sessionId ||
        !sameNodeEvidenceScope(claim.scope, scope)
      ) {
        throw new AppError('MODEL_OUTPUT_INVALID', '待追加研究 Claim 跨越了当前路线节点。')
      }
      known.set(claim.claimId, claim)
    }
    for (const entity of entities) {
      if (
        normalizeDestinationCity(entity.destinationCity) !==
          normalizeDestinationCity(nodeState.scope.city) ||
        !sameNodeEvidenceScope(entity.scope, scope) ||
        !entity.claimIds.every((claimId) => known.has(claimId))
      ) {
        throw new AppError('MODEL_OUTPUT_INVALID', '研究实体跨越了当前路线节点或引用未知 Claim。')
      }
    }
  }

  private routeNodeResearchBlockers(
    state: TravelState,
    nodeState: RouteNodeResearchState,
    claims: EvidenceClaim[]
  ): string[] {
    const blockers: string[] = []
    if (nodeState.researchEntities.length === 0) blockers.push('研究清单为空')
    if (
      nodeState.researchEntities.length > 0 &&
      nodeState.researchEntities.every((entity) => entity.disposition === 'EXCLUDE')
    ) {
      blockers.push('至少需要保留一个未排除的研究项')
    }
    for (const entity of nodeState.researchEntities) {
      if (entity.disposition !== 'EXCLUDE' && entity.promotionOnlySupport) {
        blockers.push(`${entity.canonicalSubject} 仅有推广或商业报价支撑`)
      }
      if (entity.disposition === 'MUST_GO' && entity.identityStatus === 'AMBIGUOUS') {
        blockers.push(`${entity.canonicalSubject} 的实体身份仍未确认`)
      }
      if (entity.disposition === 'MUST_GO') {
        for (const missing of missingRequiredHardAnchors(entity.claimIds, claims)) {
          blockers.push(`${entity.canonicalSubject} 缺少可用的${missing}`)
        }
      }
    }
    const mandatoryNames = this.nodeMandatoryPlaceNames(state, nodeState)
    for (const name of mandatoryNames) {
      const normalized = normalizeEvidenceSubject(name).toLocaleLowerCase('zh-CN')
      const entity = nodeState.researchEntities.find(
        (item) =>
          [item.canonicalSubject, ...item.aliases].some(
            (alias) => normalizeEvidenceSubject(alias).toLocaleLowerCase('zh-CN') === normalized
          ) && item.disposition === 'MUST_GO'
      )
      if (!entity) blockers.push(`必去地点 ${name} 尚未映射为当前节点 MUST_GO 实体`)
    }
    for (const entity of unresolvedHardAnchorConflicts(
      nodeState.researchEntities,
      claims,
      nodeState.conflictResolutions
    )) {
      blockers.push(`${entity.canonicalSubject} 的硬锚点冲突尚未裁决`)
    }
    return [...new Set(blockers)]
  }

  private nodeResearchStateDigest(state: TravelState, nodeState: RouteNodeResearchState): string {
    return digestD5Value({
      sessionId: state.sessionId,
      lastSeq: state.lastSeq,
      stage: state.stage,
      selectedRouteId: state.selectedRouteId,
      routeCandidate: state.routeCandidates.find(
        (candidate) => candidate.routeId === state.selectedRouteId
      ),
      nodeState
    })
  }

  private consumeNodeResearchOperation(operationId: string): void {
    this.cleanupNodeResearchPlans()
    if (this.consumedNodeResearchOperations.has(operationId)) {
      throw new AppError('INPUT_INVALID', '该节点研究授权已经使用。')
    }
    this.consumedNodeResearchOperations.set(operationId, Date.now() + D4_XHS_PLAN_TTL_MS)
  }

  private cleanupNodeResearchPlans(): void {
    const now = Date.now()
    for (const [planId, pending] of this.pendingNodeResearchPlans) {
      if (pending.expiresAt <= now) this.pendingNodeResearchPlans.delete(planId)
    }
    for (const [operationId, expiresAt] of this.consumedNodeResearchOperations) {
      if (expiresAt <= now) this.consumedNodeResearchOperations.delete(operationId)
    }
  }

  private emitRouteResearchProgress(
    listener: RouteResearchProgressListener | undefined,
    request: { operationId: string; sessionId: string; routeId: string; nodeId: string },
    kind: RouteResearchProgressEvent['kind'],
    sourceId: RouteResearchProgressEvent['sourceId'],
    message: string
  ): void {
    listener?.(
      RouteResearchProgressEventSchema.parse({
        operationId: request.operationId,
        sessionId: request.sessionId,
        routeId: request.routeId,
        nodeId: request.nodeId,
        kind,
        sourceId,
        message
      })
    )
  }

  private d4XhsStateDigest(sessionId: string): string {
    const state = this.requireD4State(sessionId, 'STAGE_3')
    return digestD5Value({
      sessionId: state.sessionId,
      lastSeq: state.lastSeq,
      stage: state.stage,
      destinationCities: state.basics?.destinationCities ?? []
    })
  }

  private consumeXhsRankingOperation(operationId: string): void {
    this.cleanupXhsRankingPlans()
    if (this.consumedXhsRankingOperations.has(operationId)) {
      throw new AppError('INPUT_INVALID', '该小红书研究授权已经使用。')
    }
    this.consumedXhsRankingOperations.set(operationId, Date.now() + D4_XHS_PLAN_TTL_MS)
  }

  private cleanupXhsRankingPlans(): void {
    const now = Date.now()
    for (const [planId, plan] of this.pendingXhsRankingPlans) {
      if (plan.expiresAt <= now) this.pendingXhsRankingPlans.delete(planId)
    }
    for (const [operationId, expiresAt] of this.consumedXhsRankingOperations) {
      if (expiresAt <= now) this.consumedXhsRankingOperations.delete(operationId)
    }
  }

  async reconcileSplits(): Promise<void> {
    for (const sessionId of await this.ctx.eventLog.listSessionIds()) {
      const events = await this.ctx.eventLog.read(sessionId)
      for (const event of events) {
        if (
          event.type !== 'envelope/decision' ||
          event.payload.decision !== 'SPLIT' ||
          !event.payload.splitPlan
        )
          continue
        const plan = event.payload.splitPlan
        await this.ensureSplitEvents(sessionId, event.seq, plan)
        await this.ctx.travelState.rebuildGroupAtomically([
          sessionId,
          ...plan.children.map((child) => child.sessionId)
        ])
      }
    }
  }

  private requireD4State(
    sessionId: string,
    stage: Extract<TravelState['stage'], 'STAGE_2' | 'STAGE_3'>
  ): TravelState {
    const state = this.requireState(sessionId)
    if (state.stage !== stage) {
      throw new AppError('GATE_BLOCKED', `当前操作只能在 ${stage} 执行。`)
    }
    return state
  }

  private requireD5State(
    sessionId: string,
    stage: Extract<TravelState['stage'], 'STAGE_4' | 'STAGE_5'>
  ): TravelState {
    const state = this.requireState(sessionId)
    if (state.stage !== stage) throw new AppError('GATE_BLOCKED', `当前操作只能在 ${stage} 执行。`)
    return state
  }

  private requireRailDiscovery(sessionId: string, discoveryId: string): RailDiscoveryCacheEntry {
    this.cleanupD5EphemeralState()
    this.requireD5State(sessionId, 'STAGE_4')
    const discovery = this.railDiscoveries.get(discoveryId)
    if (!discovery || discovery.sessionId !== sessionId) {
      throw new AppError('INPUT_INVALID', '车次候选不存在或已经过期。')
    }
    if (discovery.stateDigest !== this.d5StateDigest(sessionId)) {
      this.railDiscoveries.delete(discoveryId)
      throw new AppError('GATE_BLOCKED', '行程状态已变化，车次候选已经失效。')
    }
    return discovery
  }

  private buildPendingSourcePlan(
    request: D5SourcePlanPreviewRequest,
    discovery: RailDiscoveryCacheEntry,
    planId: string = randomUUID(),
    expiresAt = Date.now() + D5_EPHEMERAL_TTL_MS
  ): PendingSourcePlan {
    const selection = discovery.selection
    if (!selection) throw new AppError('GATE_BLOCKED', '请先选择往返车次。')
    const state = this.requireD5State(request.sessionId, 'STAGE_4')
    const basics = state.basics
    if (!basics || basics.dates.kind !== 'FIXED') {
      throw new AppError('GATE_BLOCKED', '来源装配需要已确认的固定往返日期。')
    }
    const originCity = basics.originCities[0]
    const destinationCity = basics.destinationCities[0]
    if (!originCity || !destinationCity) {
      throw new AppError('GATE_BLOCKED', '来源装配需要单一出发城市与目的城市。')
    }
    const locations: SourcePlanLocation[] = []
    const byLookup = new Map<string, string>()
    const addLocation = (
      preferredId: string,
      label: string,
      address: string,
      city: string,
      kind: SourcePlanLocation['kind']
    ): string => {
      const lookupDigest = digestD5Value({ address, city })
      const existing = byLookup.get(lookupDigest)
      if (existing) return existing
      byLookup.set(lookupDigest, preferredId)
      locations.push({
        locationId: preferredId,
        label,
        address,
        city,
        kind,
        cached: this.ctx.tools.hasTransientGeocode(address, city)
      })
      return preferredId
    }
    const exactOrigin = addLocation(
      'exact-origin',
      request.originLabel,
      request.exactAddress,
      originCity,
      'EXACT_ORIGIN'
    )
    const outboundFromStation = addLocation(
      'outbound-from-station',
      `出发车站（${selection.outbound.fromStation}）`,
      stationLookupAddress(selection.outbound.fromStation),
      originCity,
      'STATION'
    )
    const outboundToStation = addLocation(
      'outbound-to-station',
      `到达车站（${selection.outbound.toStation}）`,
      stationLookupAddress(selection.outbound.toStation),
      destinationCity,
      'STATION'
    )
    const stayPlace = state.staySegment?.areaHint ?? destinationCity
    const stayArea = addLocation(
      'stay-area',
      `住宿区域（${stayPlace}）`,
      `${stayPlace}中心区域`,
      destinationCity,
      'STAY_AREA'
    )
    const returnFromStation = addLocation(
      'return-from-station',
      `返程出发车站（${selection.return.fromStation}）`,
      stationLookupAddress(selection.return.fromStation),
      destinationCity,
      'STATION'
    )
    const returnToStation = addLocation(
      'return-to-station',
      `返程到达车站（${selection.return.toStation}）`,
      stationLookupAddress(selection.return.toStation),
      originCity,
      'STATION'
    )
    const stayNights =
      state.staySegment?.nights ?? dateDifferenceDays(basics.dates.startDate, basics.dates.endDate)
    const adultCount = basics.travelers
      .filter((group) => group.ageBand === 'ADULT' || group.ageBand === 'OLDER_ADULT')
      .reduce((sum, group) => sum + group.count, 0)
    if (stayNights < 1 || stayNights > 28) {
      throw new AppError('GATE_BLOCKED', '住宿查询夜数必须在 1 到 28 晚之间。')
    }
    if (adultCount < 1 || adultCount > 6) {
      throw new AppError('GATE_BLOCKED', '酒店源需要 1 到 6 名成人或老年成人。')
    }
    const transfers: D5SourcePlanPreview['transfers'] = [
      {
        direction: 'OUTBOUND',
        kind: 'FIRST_MILE',
        from: request.originLabel,
        to: `出发车站（${selection.outbound.fromStation}）`,
        travelMode: 'DRIVING',
        timingBasis: 'ARRIVE_BY_RAIL'
      },
      {
        direction: 'OUTBOUND',
        kind: 'LAST_MILE',
        from: `到达车站（${selection.outbound.toStation}）`,
        to: `住宿区域（${stayPlace}）`,
        travelMode: 'DRIVING',
        timingBasis: 'DEPART_AFTER_RAIL'
      },
      {
        direction: 'RETURN',
        kind: 'FIRST_MILE',
        from: `住宿区域（${stayPlace}）`,
        to: `返程出发车站（${selection.return.fromStation}）`,
        travelMode: 'DRIVING',
        timingBasis: 'ARRIVE_BY_RAIL'
      },
      {
        direction: 'RETURN',
        kind: 'LAST_MILE',
        from: `返程到达车站（${selection.return.toStation}）`,
        to: request.originLabel,
        travelMode: 'DRIVING',
        timingBasis: 'DEPART_AFTER_RAIL'
      }
    ]
    const hotelQuery: D5SourcePlanPreview['hotelQuery'] = {
      place: stayPlace,
      checkInDate: state.staySegment?.checkInDate ?? basics.dates.startDate,
      stayNights,
      adultCount,
      size: 5
    }
    let sequence = 0
    const plannedCalls: D5SourcePlanPreview['plannedCalls'] = [
      ...locations
        .filter((location) => !location.cached)
        .map((location) => ({
          sequence: (sequence += 1),
          sourceId: 'SRC_MAP' as const,
          capability: 'GEOCODE' as const,
          label: `地理编码：${location.label}`
        })),
      ...transfers.map((transfer) => ({
        sequence: (sequence += 1),
        sourceId: 'SRC_MAP' as const,
        capability: 'GROUND_TRANSFER' as const,
        label: `接驳距离：${transfer.from}→${transfer.to}`
      })),
      {
        sequence: (sequence += 1),
        sourceId: 'SRC_HOTEL' as const,
        capability: 'HOTEL_SEARCH' as const,
        label: `酒店查询：${hotelQuery.place} ${hotelQuery.checkInDate} 起 ${hotelQuery.stayNights} 晚`
      }
    ]
    const previewPayload = {
      sessionId: request.sessionId,
      planId,
      discoveryId: request.discoveryId,
      expiresAt: new Date(expiresAt).toISOString(),
      selectedTrains: { outbound: selection.outbound, return: selection.return },
      geocodes: locations.map(({ locationId, label, city, kind, cached }) => ({
        locationId,
        label,
        city,
        kind,
        cached
      })),
      transfers,
      hotelQuery,
      plannedCalls,
      totalExternalCalls: plannedCalls.length
    }
    const digest = digestD5Value({
      ...previewPayload,
      exactAddressDigest: digestD5Value({ exactAddress: request.exactAddress })
    })
    const preview = D5SourcePlanPreviewSchema.parse({ ...previewPayload, digest })
    return {
      sessionId: request.sessionId,
      discoveryId: request.discoveryId,
      stateDigest: this.d5StateDigest(request.sessionId),
      expiresAt,
      exactAddress: request.exactAddress,
      originLabel: request.originLabel,
      locations,
      locationIds: {
        exactOrigin,
        outboundFromStation,
        outboundToStation,
        stayArea,
        returnFromStation,
        returnToStation
      },
      preview
    }
  }

  private buildTimedTransferRequests(
    sessionId: string,
    candidateId: string,
    plan: PendingSourcePlan,
    selection: RailSelectionResult,
    coordinates: Map<string, { lng: number; lat: number }>
  ): TimedMapGroundTransferSourceRequest[] {
    const coordinate = (locationId: string): string => {
      const value = coordinates.get(locationId)
      if (!value) throw new AppError('INTERNAL_INVARIANT_VIOLATED', '地理编码结果不完整。')
      return `${value.lng},${value.lat}`
    }
    const [outboundFirst, outboundLast, returnFirst, returnLast] = plan.preview.transfers
    if (!outboundFirst || !outboundLast || !returnFirst || !returnLast) {
      throw new AppError('INTERNAL_SCHEMA_MISMATCH', '四段接驳预览不完整。')
    }
    return [
      {
        sessionId,
        candidateId,
        direction: 'OUTBOUND',
        kind: 'FIRST_MILE',
        from: outboundFirst.from,
        to: outboundFirst.to,
        origin: coordinate(plan.locationIds.exactOrigin),
        destination: coordinate(plan.locationIds.outboundFromStation),
        travelMode: outboundFirst.travelMode,
        timingBasis: outboundFirst.timingBasis,
        railAnchorAt: selection.outbound.startAt
      },
      {
        sessionId,
        candidateId,
        direction: 'OUTBOUND',
        kind: 'LAST_MILE',
        from: outboundLast.from,
        to: outboundLast.to,
        origin: coordinate(plan.locationIds.outboundToStation),
        destination: coordinate(plan.locationIds.stayArea),
        travelMode: outboundLast.travelMode,
        timingBasis: outboundLast.timingBasis,
        railAnchorAt: selection.outbound.endAt
      },
      {
        sessionId,
        candidateId,
        direction: 'RETURN',
        kind: 'FIRST_MILE',
        from: returnFirst.from,
        to: returnFirst.to,
        origin: coordinate(plan.locationIds.stayArea),
        destination: coordinate(plan.locationIds.returnFromStation),
        travelMode: returnFirst.travelMode,
        timingBasis: returnFirst.timingBasis,
        railAnchorAt: selection.return.startAt
      },
      {
        sessionId,
        candidateId,
        direction: 'RETURN',
        kind: 'LAST_MILE',
        from: returnLast.from,
        to: returnLast.to,
        origin: coordinate(plan.locationIds.returnToStation),
        destination: coordinate(plan.locationIds.exactOrigin),
        travelMode: returnLast.travelMode,
        timingBasis: returnLast.timingBasis,
        railAnchorAt: selection.return.endAt
      }
    ]
  }

  private d5StateDigest(sessionId: string): string {
    const state = this.requireState(sessionId)
    return digestD5Value({
      sessionId: state.sessionId,
      lastSeq: state.lastSeq,
      stage: state.stage,
      basics: state.basics,
      researchChecklistConfirmed: state.researchChecklistConfirmed
    })
  }

  private consumeD5Operation(operationId: string): void {
    this.cleanupD5EphemeralState()
    if (this.consumedD5Operations.has(operationId)) {
      throw new AppError('INPUT_INVALID', '该一次性授权已经使用。')
    }
    this.consumedD5Operations.set(operationId, Date.now() + D5_EPHEMERAL_TTL_MS)
  }

  private consumeD6Operation(operationId: string): void {
    this.cleanupD6EphemeralState()
    if (this.consumedD6Operations.has(operationId)) {
      throw new AppError('INPUT_INVALID', '该 D6 操作已经执行。')
    }
    this.consumedD6Operations.set(operationId, Date.now() + D5_EPHEMERAL_TTL_MS)
  }

  private cleanupD6EphemeralState(): void {
    const now = Date.now()
    for (const [operationId, expiresAt] of this.consumedD6Operations) {
      if (expiresAt <= now) this.consumedD6Operations.delete(operationId)
    }
    for (const [draftId, pending] of this.pendingTimelineDrafts) {
      if (pending.expiresAt <= now) this.pendingTimelineDrafts.delete(draftId)
    }
  }

  private assertD6NotCancelled(operationId: string): void {
    if (this.cancelledD6Operations.has(operationId)) {
      throw new AppError('SOURCE_CANCELLED', 'D6 时间轴准备已由用户取消。')
    }
  }

  private cleanupD5EphemeralState(): void {
    const now = Date.now()
    for (const [operationId, expiresAt] of this.consumedD5Operations) {
      if (expiresAt <= now) this.consumedD5Operations.delete(operationId)
    }
    for (const [discoveryId, entry] of this.railDiscoveries) {
      if (entry.expiresAt <= now) this.railDiscoveries.delete(discoveryId)
    }
    for (const [planId, plan] of this.pendingSourcePlans) {
      if (plan.expiresAt <= now || !this.railDiscoveries.has(plan.discoveryId)) {
        plan.exactAddress = ''
        this.pendingSourcePlans.delete(planId)
      }
    }
  }

  private async materializeTransportEvidence(
    sessionId: string,
    operationId: string,
    parameters: TransportSourceParameters
  ): Promise<EvidenceClaim[]> {
    const candidateId = `real-${createHash('sha256')
      .update(JSON.stringify(parameters))
      .digest('hex')
      .slice(0, 20)}`
    const claims: EvidenceClaim[] = []
    const outboundRail = await this.ctx.tools.materializeRailJourney(
      {
        sessionId,
        candidateId,
        direction: 'OUTBOUND',
        ...parameters.outbound.rail
      },
      operationId,
      false
    )
    claims.push(
      ...this.acceptMaterializedClaims(sessionId, outboundRail, 'SRC_RAIL', 'get-tickets')
    )
    const returnRail = await this.ctx.tools.materializeRailJourney(
      {
        sessionId,
        candidateId,
        direction: 'RETURN',
        ...parameters.return.rail
      },
      operationId,
      false
    )
    claims.push(...this.acceptMaterializedClaims(sessionId, returnRail, 'SRC_RAIL', 'get-tickets'))
    for (const [direction, directionParameters] of [
      ['OUTBOUND', parameters.outbound],
      ['RETURN', parameters.return]
    ] as const) {
      for (const [kind, transfer] of [
        ['FIRST_MILE', directionParameters.firstMile],
        ['LAST_MILE', directionParameters.lastMile]
      ] as const) {
        const outcome = await this.ctx.tools.materializeMapGroundTransfer(
          { sessionId, candidateId, direction, kind, ...transfer },
          operationId,
          false
        )
        claims.push(
          ...this.acceptMaterializedClaims(sessionId, outcome, 'SRC_MAP', 'maps_distance')
        )
      }
    }
    return this.ctx.tools.addEvidenceClaims(claims)
  }

  private acceptMaterializedClaims(
    sessionId: string,
    outcome: SourceQueryOutcome,
    sourceId: EvidenceClaim['sourceId'],
    toolName: string
  ): EvidenceClaim[] {
    if (
      outcome.sourceId !== sourceId ||
      outcome.toolName !== toolName ||
      outcome.claims.some((claim) => claim.sessionId !== sessionId || claim.sourceId !== sourceId)
    ) {
      throw new AppError('INTERNAL_SCHEMA_MISMATCH', '来源参数返回了越权或跨会话证据。')
    }
    return outcome.claims
  }

  private emitD5Progress(
    listener: D5ProgressListener | undefined,
    request: { operationId: string; sessionId: string },
    kind: D5ProgressEvent['kind'],
    message: string
  ): void {
    listener?.(D5ProgressEventSchema.parse({ ...request, kind, message }))
  }

  private emitD6Progress(
    listener: D6ProgressListener | undefined,
    request: { operationId: string; sessionId: string },
    kind: D6ProgressEvent['kind'],
    message: string
  ): void {
    listener?.(D6ProgressEventSchema.parse({ ...request, kind, message }))
  }

  private emitD4Progress(
    listener: D4ProgressListener | undefined,
    request: { operationId: string; sessionId: string },
    kind: D4ProgressEvent['kind'],
    sourceId: D4ProgressEvent['sourceId'],
    message: string
  ): void {
    listener?.(
      D4ProgressEventSchema.parse({
        operationId: request.operationId,
        sessionId: request.sessionId,
        kind,
        sourceId,
        message
      })
    )
  }

  private assertClaimIdsBelongToSession(sessionId: string, claimIds: string[]): void {
    const known = new Set(this.ctx.tools.listEvidence(sessionId, 200).map((claim) => claim.claimId))
    if (!claimIds.every((claimId) => known.has(claimId))) {
      throw new AppError('GATE_BLOCKED', '候选引用了当前会话中不存在的证据。')
    }
  }

  private assertResearchEntities(
    sessionId: string,
    destinationCity: string,
    entities: D4Snapshot['researchEntities'],
    pendingClaims: EvidenceClaim[] = []
  ): void {
    const known = new Set(this.ctx.tools.listEvidence(sessionId, 200).map((claim) => claim.claimId))
    for (const claim of pendingClaims) {
      if (claim.sessionId !== sessionId) {
        throw new AppError('MODEL_OUTPUT_INVALID', '待原子追加的研究 Claim 跨越了当前会话。')
      }
      known.add(claim.claimId)
    }
    for (const entity of entities) {
      if (entity.destinationCity !== destinationCity) {
        throw new AppError('MODEL_OUTPUT_INVALID', '研究实体跨越了已确认目的地。')
      }
      if (!entity.claimIds.every((claimId) => known.has(claimId))) {
        throw new AppError('MODEL_OUTPUT_INVALID', '研究实体引用了当前会话中不存在的证据。')
      }
    }
  }

  private requireState(sessionId: string): TravelState {
    const state = this.ctx.travelState.get(sessionId)
    if (!state) throw new AppError('INPUT_INVALID', '会话不存在。')
    return state
  }

  private requireCurrentTimeline(state: TravelState): TravelState['timelineVersions'][number] {
    const current = state.timelineVersions.find((version) => version.isCurrent)
    if (!current) throw new AppError('GATE_BLOCKED', '请先发布当前时间轴。')
    if ((current.routeId ?? null) !== state.selectedRouteId) {
      throw new AppError('GATE_BLOCKED', '当前时间轴不属于已选路线，请重新准备并发布。')
    }
    return current
  }

  private assertOptionalRouteIdentity(
    state: TravelState,
    routeId: string | undefined,
    requiredForMutation: boolean
  ): void {
    if (state.selectedRouteId === null) {
      if (routeId !== undefined) {
        throw new AppError('INPUT_INVALID', '单目的地会话不能携带多城市 routeId。')
      }
      return
    }
    if (routeId !== undefined && routeId !== state.selectedRouteId) {
      throw new AppError('INPUT_INVALID', '请求路线不是当前已选路线。')
    }
    if (requiredForMutation && routeId === undefined) {
      throw new AppError('INPUT_INVALID', '多城市路线操作必须携带当前 routeId。')
    }
  }

  private async recordBasics(
    sessionId: string,
    basics: TravelBasics,
    interviewTurns: number
  ): Promise<void> {
    await this.record({
      sessionId,
      eventVersion: 2,
      type: 'basics/updated',
      payload: {
        basics,
        interviewTurns,
        destinationResearchRequired:
          basics.destinationCities.length === 0 && basics.destinationIntent !== null
      }
    })
  }

  private outcomeForBasics(basics: TravelBasics, turnNumber: number): ChatTurnOutcome {
    const assessment = assessM0Envelope(basics, {
      allowFuzzyDestination: basics.destinationCities.length === 0
    })
    if (!assessment.withinEnvelope) return this.outOfEnvelope(assessment, turnNumber)
    return ChatTurnOutcomeSchema.parse({
      kind: 'CONFIRMATION',
      assistantText: '基础信息已完整，请检查确认卡后明确确认。',
      card: buildConfirmationCard(basics),
      assessment,
      turnNumber
    })
  }

  private outOfEnvelope(
    assessment: ReturnType<typeof assessM0Envelope>,
    turnNumber: number
  ): ChatTurnOutcome {
    const error = new AppError('INPUT_OUT_OF_ENVELOPE', '输入超出 M0 能力边界。', {
      klass: 'INPUT',
      userHint: assessment.violations.map((violation) => violation.message).join(' ')
    })
    return ChatTurnOutcomeSchema.parse({
      kind: 'OUT_OF_ENVELOPE',
      assistantText: error.userHint,
      error: serializeError(error),
      comparison: buildEnvelopeComparison(assessment),
      turnNumber: Math.max(1, Math.min(5, turnNumber))
    })
  }

  private createSplitPlan(
    parentSessionId: string,
    basics: TravelBasics,
    rationale: string
  ): SplitPlan {
    const digest = createHash('sha256')
      .update(JSON.stringify({ parentSessionId, basics, rationale }))
      .digest('hex')
      .slice(0, 20)
    const createdAt = new Date().toISOString()
    const segments =
      basics.destinationCities.length > 1
        ? basics.destinationCities.map((destination) => ({
            label: destination,
            basics: TravelBasicsSchema.parse({
              ...basics,
              destinationCities: [destination],
              staySegments: 1
            })
          }))
        : basics.originCities.length > 1
          ? basics.originCities.map((origin) => ({
              label: origin,
              basics: TravelBasicsSchema.parse({
                ...basics,
                originCities: [origin],
                staySegments: 1
              })
            }))
          : Array.from({ length: basics.staySegments }, (_, index) => ({
              label: `住宿段 ${index + 1}`,
              basics: TravelBasicsSchema.parse({ ...basics, staySegments: 1 })
            }))
    return SplitPlanSchema.parse({
      version: 1,
      transactionId: `split-${digest}`,
      linkedSessionGroup: `group-${digest}`,
      expectedCount: segments.length,
      decisionId: `decision-${digest}`,
      rationale,
      decisionEventId: `decision-event-${digest}`,
      decisionCreatedAt: createdAt,
      children: segments.map((segment, index) => ({
        sessionId: `${parentSessionId}-split-${index + 1}-${digest.slice(0, 8)}`,
        splitIndex: index + 1,
        sessionCreatedEventId: `session-event-${digest}-${index + 1}`,
        createdAt,
        title: segment.label,
        destinationCities: segment.basics.destinationCities,
        basics: segment.basics,
        handoff: '该段与相邻子会话之间的交通、行李和时间衔接需由用户手工确认。'
      }))
    })
  }

  private async ensureSplitEvents(
    parentSessionId: string,
    intentSeq: number,
    plan: SplitPlan
  ): Promise<void> {
    await this.ctx.eventLog.ensurePlanned({
      eventId: plan.decisionEventId,
      sessionId: parentSessionId,
      seq: intentSeq + 1,
      timestamp: plan.decisionCreatedAt,
      eventVersion: 2,
      type: 'decision/logged',
      payload: {
        decisionId: plan.decisionId,
        category: 'M0_ENVELOPE',
        selected: 'SPLIT',
        reason: plan.rationale,
        alternatives: ['SHRINK']
      }
    })
    for (const child of plan.children) {
      await this.ctx.eventLog.ensurePlanned({
        eventId: child.sessionCreatedEventId,
        sessionId: child.sessionId,
        seq: 1,
        timestamp: child.createdAt,
        eventVersion: 2,
        type: 'session/created',
        payload: {
          title: child.title,
          linkedSessionGroup: plan.linkedSessionGroup,
          splitIndex: child.splitIndex,
          basics: child.basics,
          handoffs: child.handoff ? [child.handoff] : []
        }
      })
    }
  }

  private async applyShrink(
    input: EnvelopeChoiceRequest,
    basics: TravelBasics
  ): Promise<SessionSummary[]> {
    if (input.retainedDestinationCities.length !== 1) {
      throw new AppError('INPUT_INVALID', '缩小范围时必须明确保留一个目的地。')
    }
    const adjusted = TravelBasicsSchema.parse({
      ...basics,
      destinationCities: input.retainedDestinationCities,
      staySegments: 1
    })
    const assessment = assessM0Envelope(adjusted)
    if (!assessment.withinEnvelope)
      throw new AppError('GATE_BLOCKED', '缩小后的行程仍超出 M0 包络。')
    const state = this.requireState(input.sessionId)
    await this.recordBasics(input.sessionId, adjusted, Math.max(1, state.interviewTurns))
    await this.record({
      sessionId: input.sessionId,
      eventVersion: 2,
      type: 'envelope/decision',
      payload: { assessment, decision: 'ADJUST', splitPlan: null }
    })
    await this.record({
      sessionId: input.sessionId,
      eventVersion: 2,
      type: 'decision/logged',
      payload: {
        decisionId: ulid(),
        category: 'M0_ENVELOPE',
        selected: 'SHRINK',
        reason: input.rationale,
        alternatives: ['SPLIT']
      }
    })
    await this.record({
      sessionId: input.sessionId,
      eventVersion: 2,
      type: 'stage/confirmed',
      payload: { fromStage: 'STAGE_1', toStage: 'STAGE_2', confirmed: true }
    })
    return [this.getSession(input.sessionId)]
  }
}

export function currentOperationResearchClaims(
  claims: EvidenceClaim[],
  sourceResults: SourceSubagentResult[],
  scope: EvidenceScope | null = null
): EvidenceClaim[] {
  const currentClaimIds = new Set(
    sourceResults.flatMap((result) =>
      result.status === 'SUCCEEDED' && sameNodeEvidenceScope(result.scope, scope)
        ? result.claimIds
        : []
    )
  )
  return claims.filter(
    (claim) =>
      currentClaimIds.has(claim.claimId) &&
      sameNodeEvidenceScope(claim.scope, scope) &&
      !claim.notes?.startsWith('由 clm_') &&
      isResearchExtractionEligible(claim)
  )
}

function routeNodeIdentity(input: {
  sessionId: string
  routeId: string
  nodeId: string
}): RouteResearchSnapshotRequest {
  return { sessionId: input.sessionId, routeId: input.routeId, nodeId: input.nodeId }
}

function evidenceScopeForNode(scope: RouteNodeResearchScope): EvidenceScope {
  return { kind: 'ROUTE_NODE', routeId: scope.routeId, nodeId: scope.nodeId }
}

function sameNodeEvidenceScope(
  left: EvidenceScope | null | undefined,
  right: EvidenceScope | null
): boolean {
  if (left == null || right === null) return left == null && right === null
  if (left.kind !== 'ROUTE_NODE' || right.kind !== 'ROUTE_NODE') return false
  return left.routeId === right.routeId && left.nodeId === right.nodeId
}

function missingRequiredHardAnchors(claimIds: string[], claims: EvidenceClaim[]): string[] {
  const related = new Set(claimIds)
  const usable = claims.filter(
    (claim) =>
      related.has(claim.claimId) &&
      claim.verificationStatus !== 'STALE' &&
      claim.verificationStatus !== 'UNVERIFIED' &&
      isKnownManualHardAnchor(claim)
  )
  const required = [
    { label: '开放时间', pattern: /开放|营业|opening|hours/i },
    { label: '闭园安排', pattern: /关闭|闭园|闭馆|closure|closed/i },
    { label: '预约要求', pattern: /预约|reservation/i }
  ]
  return required
    .filter(({ pattern }) => !usable.some((claim) => pattern.test(claim.predicate)))
    .map(({ label }) => label)
}

function lacksUsableHardAnchor(claimIds: string[], claims: EvidenceClaim[]): boolean {
  const related = new Set(claimIds)
  const hardAnchors = claims.filter(
    (claim) =>
      related.has(claim.claimId) &&
      /开放|营业|预约|关闭|闭园|闭馆|opening|hours|reservation|closed|closure/i.test(
        claim.predicate
      ) &&
      isKnownManualHardAnchor(claim)
  )
  return (
    hardAnchors.length === 0 ||
    hardAnchors.every(
      (claim) => claim.verificationStatus === 'STALE' || claim.verificationStatus === 'UNVERIFIED'
    )
  )
}

function isKnownManualHardAnchor(claim: EvidenceClaim): boolean {
  if (claim.sourceId !== 'USER_RESEARCH') return true
  if (claim.value === null || Array.isArray(claim.value) || typeof claim.value !== 'object') {
    return false
  }
  return claim.value.status === 'KNOWN'
}

declare module 'cordis' {
  interface Context {
    coordinator: CoordinatorService
  }
}

export const coordinatorPlugin: Plugin.Function<Context, undefined> = (ctx) => {
  ctx.set('coordinator', new CoordinatorService(ctx))
}
coordinatorPlugin.inject = ['eventLog', 'session', 'travelState', 'tools', 'provider']

function digestD5Value(value: unknown): string {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(canonicalD5Value(value)))
    .digest('hex')}`
}

function compareRailOptions(left: RailOption, right: RailOption): number {
  const leftDuration =
    left.endAt === null
      ? Number.MAX_SAFE_INTEGER
      : Date.parse(left.endAt) - Date.parse(left.startAt)
  const rightDuration =
    right.endAt === null
      ? Number.MAX_SAFE_INTEGER
      : Date.parse(right.endAt) - Date.parse(right.startAt)
  return (
    leftDuration - rightDuration ||
    left.startAt.localeCompare(right.startAt) ||
    left.trainNo.localeCompare(right.trainNo)
  )
}

function canonicalD5Value(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalD5Value)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalD5Value(item)])
    )
  }
  return value
}

function stationLookupAddress(station: string): string {
  const normalized = station.normalize('NFKC').trim()
  return normalized.endsWith('站') ? normalized : `${normalized}站`
}

function dateDifferenceDays(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`)
  const end = Date.parse(`${endDate}T00:00:00Z`)
  return Math.round((end - start) / (24 * 60 * 60 * 1000))
}

function normalizeDestinationCity(city: string): string {
  return city.normalize('NFKC').trim()
}
