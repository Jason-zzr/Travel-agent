import { readdir } from 'node:fs/promises'
import type Database from 'better-sqlite3'
import type { Context, Plugin } from 'cordis'
import { AppError } from '../../shared/errors'
import {
  SessionEventSchema,
  type SessionEvent,
  type SessionEventDraft
} from '../../shared/schema/session-event'
import { TravelStateSchema, type TravelState } from '../../shared/schema/travel-state'
import type { DateIntent } from '../../shared/schema/interview'
import {
  RouteNodeResearchStateSchema,
  RouteNodeResearchSummarySchema,
  type RouteNodeResearchScope,
  type RouteNodeResearchState,
  type RouteNodeResearchSummary
} from '../../shared/schema/d4'
import { RouteLegEvidenceValueSchema, type RouteCandidate } from '../../shared/schema/itinerary'
import type { EvidenceClaim, EvidenceScope } from '../../shared/schema/evidence'
import {
  RouteD5LegStateSchema,
  RouteD5StayStateSchema,
  type RouteD5LegScope,
  type RouteD5LegState,
  type RouteD5RouteScope,
  type RouteD5StayScope,
  type RouteD5StayState,
  type RouteDaySkeleton
} from '../../shared/schema/route-d5'
import type { AppPaths } from '../paths'
import { initializeRouteD5LegStates, initializeRouteD5StayStates } from '../skills/route-d5'
import type { EventLogService } from './event-log'

export interface TravelStateConfig {
  database: Database.Database
  paths: AppPaths
  warn?: (message: string) => void
}

const STAGE_ORDER = ['STAGE_1', 'STAGE_2', 'STAGE_3', 'STAGE_4', 'STAGE_5', 'DONE'] as const

export function initializeRouteNodeResearchStates(
  sessionId: string,
  candidate: RouteCandidate
): RouteNodeResearchState[] {
  return candidate.nodes.map((node) => {
    const required = node.nodeKind === 'STAY' || node.mandatoryPlaceIds.length > 0
    return RouteNodeResearchStateSchema.parse({
      scope: {
        sessionId,
        routeId: candidate.routeId,
        nodeId: node.nodeId,
        city: node.city,
        nodeKind: node.nodeKind,
        mandatoryPlaceIds: node.mandatoryPlaceIds
      },
      sequence: node.sequence,
      required,
      status: required ? 'NOT_STARTED' : 'SKIPPED',
      skipReason: required ? null : '该节点仅用于中转，且未承载必去地点，无需执行景点研究。',
      researchEntities: [],
      researchChecklistConfirmed: false,
      conflictResolutions: [],
      sourceResearchFailures: [],
      xhsSampleSummary: null,
      manualResearchSummary: null,
      attractionRankings: [],
      blockingReasons: [],
      confirmedAt: null
    })
  })
}

export function summarizeRouteNodeResearchStates(
  states: readonly RouteNodeResearchState[]
): RouteNodeResearchSummary[] {
  return [...states]
    .sort((left, right) => left.sequence - right.sequence)
    .map((state) =>
      RouteNodeResearchSummarySchema.parse({
        scope: state.scope,
        sequence: state.sequence,
        required: state.required,
        status: state.status,
        blockerCount: state.blockingReasons.length,
        entityCount: state.researchEntities.length,
        confirmedAt: state.confirmedAt,
        skipReason: state.skipReason
      })
    )
}

function assertStageTransition(current: TravelState, event: SessionEvent): TravelState['stage'] {
  if (event.type !== 'stage/confirmed') return current.stage
  const payload = event.payload
  if ('stage' in payload) {
    const currentIndex = STAGE_ORDER.indexOf(current.stage)
    const nextIndex = STAGE_ORDER.indexOf(payload.stage)
    if (nextIndex <= currentIndex) {
      throw new AppError(
        'EVENT_INVALID',
        `旧版阶段事件不能从 ${current.stage} 回退到 ${payload.stage}。`
      )
    }
    return payload.stage
  }
  const currentIndex = STAGE_ORDER.indexOf(current.stage)
  if (
    payload.confirmed !== true ||
    payload.fromStage !== current.stage ||
    STAGE_ORDER[currentIndex + 1] !== payload.toStage
  ) {
    throw new AppError('EVENT_INVALID', `非法阶段迁移：${payload.fromStage} → ${payload.toStage}。`)
  }
  return payload.toStage
}

export function reduceTravelState(
  current: TravelState | undefined,
  event: SessionEvent
): TravelState {
  switch (event.type) {
    case 'session/created':
      if (current) {
        throw new AppError('EVENT_INVALID', `会话 ${event.sessionId} 被重复创建。`)
      }
      return TravelStateSchema.parse({
        sessionId: event.sessionId,
        createdAt: event.timestamp,
        stage: 'STAGE_1',
        lastSeq: event.seq,
        title: event.payload.title,
        linkedSessionGroup:
          'linkedSessionGroup' in event.payload ? event.payload.linkedSessionGroup : null,
        splitIndex: 'splitIndex' in event.payload ? event.payload.splitIndex : null,
        basics: 'basics' in event.payload ? event.payload.basics : null,
        handoffs: 'handoffs' in event.payload ? event.payload.handoffs : []
      })
    case 'basics/updated':
      if (!current) {
        throw new AppError('EVENT_INVALID', `会话 ${event.sessionId} 尚未创建。`)
      }
      return TravelStateSchema.parse({
        ...current,
        basics: event.payload.basics,
        interviewTurns: event.payload.interviewTurns,
        destinationResearchRequired: event.payload.destinationResearchRequired,
        itineraryGoal: null,
        routeCandidates: [],
        selectedRouteId: null,
        routeSourceOutcomes: [],
        routeStaySegments: [],
        routeBlockingReasons: [],
        routeNodeResearchStates: [],
        routeD5LegStates: [],
        routeD5StayStates: [],
        routeDaySkeletons: [],
        routeD5Confirmed: false,
        lastSeq: event.seq
      })
    case 'envelope/decision':
      if (!current) {
        throw new AppError('EVENT_INVALID', `会话 ${event.sessionId} 尚未创建。`)
      }
      if (event.payload.decision === 'CONTINUE' && !event.payload.assessment.withinEnvelope) {
        throw new AppError('EVENT_INVALID', '超出能力边界时不能直接继续。')
      }
      return TravelStateSchema.parse({
        ...current,
        envelope: event.payload.assessment,
        envelopeDecision: event.payload.decision,
        lastSeq: event.seq
      })
    case 'decision/logged':
      if (!current) {
        throw new AppError('EVENT_INVALID', `会话 ${event.sessionId} 尚未创建。`)
      }
      return TravelStateSchema.parse({ ...current, lastSeq: event.seq })
    case 'evidence/added':
      if (!current) {
        throw new AppError('EVENT_INVALID', `会话 ${event.sessionId} 尚未创建。`)
      }
      if (event.payload.claim.sessionId !== event.sessionId) {
        throw new AppError('EVENT_INVALID', '证据声明与事件会话不一致。')
      }
      if (event.payload.claim.scope) {
        const scope = event.payload.claim.scope
        if (scope.kind === 'ROUTE_NODE') {
          if (
            current.selectedRouteId !== scope.routeId ||
            !current.routeNodeResearchStates.some(
              (item) => item.scope.routeId === scope.routeId && item.scope.nodeId === scope.nodeId
            )
          ) {
            throw new AppError('EVENT_INVALID', '节点证据不属于当前已选路线节点。')
          }
        } else if (current.stage !== 'STAGE_2') {
          throw new AppError('EVENT_INVALID', '路线目标交通腿证据只能在 STAGE-2 追加。')
        }
      }
      return TravelStateSchema.parse({ ...current, lastSeq: event.seq })
    case 'destination/candidates-generated':
      if (!current) {
        throw new AppError('EVENT_INVALID', `会话 ${event.sessionId} 尚未创建。`)
      }
      if (current.stage !== 'STAGE_2') {
        throw new AppError('EVENT_INVALID', '目的地候选只能在 STAGE-2 生成。')
      }
      return TravelStateSchema.parse({
        ...current,
        destinationCandidates: event.payload.candidates,
        selectedDestinationCandidateId: null,
        researchEntities: [],
        researchChecklistConfirmed: false,
        conflictResolutions: [],
        sourceResearchFailures: [],
        xhsSampleSummary: null,
        manualResearchSummary: null,
        attractionRankings: [],
        transportCandidates: [],
        selectedTransportCandidateId: null,
        boundaryAnchors: [],
        daySkeletons: [],
        staySegment: null,
        stayCandidates: [],
        selectedStayCandidateId: null,
        staySourceOutcomes: [],
        lastSeq: event.seq
      })
    case 'destination/selected': {
      if (!current?.basics) {
        throw new AppError('EVENT_INVALID', '选择目的地前必须已有基础信息。')
      }
      if (current.stage !== 'STAGE_2') {
        throw new AppError('EVENT_INVALID', '目的地只能在 STAGE-2 选择。')
      }
      const candidate = current.destinationCandidates.find(
        (item) => item.id === event.payload.candidateId
      )
      if (!candidate || candidate.city !== event.payload.city) {
        throw new AppError('EVENT_INVALID', '目的地选择不属于当前候选集。')
      }
      return TravelStateSchema.parse({
        ...current,
        basics: { ...current.basics, destinationCities: [candidate.city] },
        selectedDestinationCandidateId: candidate.id,
        destinationResearchRequired: false,
        researchEntities: [],
        researchChecklistConfirmed: false,
        conflictResolutions: [],
        sourceResearchFailures: [],
        xhsSampleSummary: null,
        manualResearchSummary: null,
        attractionRankings: [],
        transportCandidates: [],
        selectedTransportCandidateId: null,
        boundaryAnchors: [],
        daySkeletons: [],
        staySegment: null,
        stayCandidates: [],
        selectedStayCandidateId: null,
        staySourceOutcomes: [],
        lastSeq: event.seq
      })
    }
    case 'itinerary/route-candidates-prepared':
      if (!current?.basics || current.stage !== 'STAGE_2') {
        throw new AppError('EVENT_INVALID', '多城市路线候选只能在 STAGE-2 生成。')
      }
      if (event.payload.finalClaims.some((claim) => claim.sessionId !== event.sessionId)) {
        throw new AppError('EVENT_INVALID', '路线候选的 final Claim 与事件会话不一致。')
      }
      return TravelStateSchema.parse({
        ...current,
        itineraryGoal: event.payload.goal,
        routeCandidates: event.payload.candidates,
        selectedRouteId: null,
        routeSourceOutcomes: event.payload.sourceOutcomes,
        routeStaySegments: [],
        routeBlockingReasons: event.payload.blockingReasons,
        routeNodeResearchStates: [],
        routeD5LegStates: [],
        routeD5StayStates: [],
        routeDaySkeletons: [],
        routeD5Confirmed: false,
        lastSeq: event.seq
      })
    case 'itinerary/route-manual-evidence-applied': {
      if (!current?.basics || current.stage !== 'STAGE_2' || !current.itineraryGoal) {
        throw new AppError('EVENT_INVALID', '人工路线交通证据只能在已有候选的 STAGE-2 追加。')
      }
      if (JSON.stringify(current.itineraryGoal) !== JSON.stringify(event.payload.goal)) {
        throw new AppError('EVENT_INVALID', '人工路线交通证据的目标已经失效。')
      }
      const route = current.routeCandidates.find((item) =>
        item.legs.some(
          (leg) =>
            leg.fromCity === event.payload.scope.fromCity &&
            leg.toCity === event.payload.scope.toCity &&
            leg.travelDate === event.payload.scope.travelDate &&
            leg.verificationStatus === 'UNVERIFIED'
        )
      )
      const value = RouteLegEvidenceValueSchema.parse(event.payload.claim.value)
      if (
        !route ||
        event.payload.claim.sessionId !== event.sessionId ||
        event.payload.claim.sourceId !== 'USER_RESEARCH' ||
        event.payload.claim.predicate !== 'routeLeg' ||
        event.payload.claim.verificationStatus !== 'VERIFIED_BY_USER' ||
        JSON.stringify(event.payload.claim.scope) !== JSON.stringify(event.payload.scope) ||
        value.fromCity !== event.payload.scope.fromCity ||
        value.toCity !== event.payload.scope.toCity ||
        value.travelDate !== event.payload.scope.travelDate ||
        !event.payload.candidates.some((candidate) =>
          candidate.legs.some((leg) => leg.claimIds.includes(event.payload.claim.claimId))
        )
      ) {
        throw new AppError('EVENT_INVALID', '人工路线交通 Claim 与当前缺口或重算候选不一致。')
      }
      return TravelStateSchema.parse({
        ...current,
        itineraryGoal: event.payload.goal,
        routeCandidates: event.payload.candidates,
        selectedRouteId: null,
        routeStaySegments: [],
        routeBlockingReasons: event.payload.blockingReasons,
        routeNodeResearchStates: [],
        routeD5LegStates: [],
        routeD5StayStates: [],
        routeDaySkeletons: [],
        routeD5Confirmed: false,
        lastSeq: event.seq
      })
    }
    case 'itinerary/route-selected': {
      if (!current || current.stage !== 'STAGE_2') {
        throw new AppError('EVENT_INVALID', '多城市路线只能在 STAGE-2 选择。')
      }
      const candidate = current.routeCandidates.find(
        (item) => item.routeId === event.payload.selectedRouteId
      )
      if (!candidate || JSON.stringify(candidate) !== JSON.stringify(event.payload.chosen)) {
        throw new AppError('EVENT_INVALID', '路线选择不属于当前候选集或已经失效。')
      }
      return TravelStateSchema.parse({
        ...current,
        stage: event.payload.toStage,
        selectedRouteId: candidate.routeId,
        routeStaySegments: candidate.staySegments,
        routeNodeResearchStates: initializeRouteNodeResearchStates(event.sessionId, candidate),
        routeD5LegStates: initializeRouteD5LegStates(event.sessionId, candidate),
        routeD5StayStates: initializeRouteD5StayStates(event.sessionId, candidate),
        routeDaySkeletons: [],
        routeD5Confirmed: false,
        lastSeq: event.seq
      })
    }
    case 'research/checklist-prepared':
      if (!current) {
        throw new AppError('EVENT_INVALID', `会话 ${event.sessionId} 尚未创建。`)
      }
      if (current.stage !== 'STAGE_3') {
        throw new AppError('EVENT_INVALID', '研究清单只能在 STAGE-3 生成。')
      }
      if ((event.payload.finalClaims ?? []).some((claim) => claim.sessionId !== event.sessionId)) {
        throw new AppError('EVENT_INVALID', '研究清单的 final Claim 与事件会话不一致。')
      }
      return TravelStateSchema.parse({
        ...current,
        researchEntities: event.payload.entities,
        sourceResearchFailures: event.payload.sourceFailures,
        xhsSampleSummary: event.payload.xhsSampleSummary ?? null,
        manualResearchSummary: event.payload.manualResearchSummary ?? null,
        attractionRankings: event.payload.attractionRankings ?? [],
        researchChecklistConfirmed: false,
        lastSeq: event.seq
      })
    case 'research/disposition-set': {
      if (!current) {
        throw new AppError('EVENT_INVALID', `会话 ${event.sessionId} 尚未创建。`)
      }
      if (current.stage !== 'STAGE_3') {
        throw new AppError('EVENT_INVALID', '研究线索只能在 STAGE-3 处置。')
      }
      const found = current.researchEntities.some(
        (entity) => entity.entityId === event.payload.entityId
      )
      if (!found) throw new AppError('EVENT_INVALID', '研究线索不存在。')
      return TravelStateSchema.parse({
        ...current,
        researchEntities: current.researchEntities.map((entity) =>
          entity.entityId === event.payload.entityId
            ? { ...entity, disposition: event.payload.disposition }
            : entity
        ),
        researchChecklistConfirmed: false,
        lastSeq: event.seq
      })
    }
    case 'research/conflict-resolved': {
      if (!current) {
        throw new AppError('EVENT_INVALID', `会话 ${event.sessionId} 尚未创建。`)
      }
      if (current.stage !== 'STAGE_3') {
        throw new AppError('EVENT_INVALID', '研究冲突只能在 STAGE-3 裁决。')
      }
      const resolution = event.payload.resolution
      const remaining = current.conflictResolutions.filter(
        (item) => item.subject !== resolution.subject || item.predicate !== resolution.predicate
      )
      return TravelStateSchema.parse({
        ...current,
        conflictResolutions: [...remaining, resolution],
        researchChecklistConfirmed: false,
        lastSeq: event.seq
      })
    }
    case 'research/confirmed':
      if (!current) {
        throw new AppError('EVENT_INVALID', `会话 ${event.sessionId} 尚未创建。`)
      }
      if (current.stage !== 'STAGE_3') {
        throw new AppError('EVENT_INVALID', '研究清单只能在 STAGE-3 确认。')
      }
      if (current.researchEntities.length === 0) {
        throw new AppError('EVENT_INVALID', '空研究清单不能确认。')
      }
      return TravelStateSchema.parse({
        ...current,
        researchChecklistConfirmed: true,
        lastSeq: event.seq
      })
    case 'research/node-user-paste-added': {
      if (!current || current.stage !== 'STAGE_3') {
        throw new AppError('EVENT_INVALID', '节点 USER_PASTE 只能在 STAGE-3 追加。')
      }
      requireRouteNodeResearchState(current, event.payload.scope)
      assertClaimMatchesNodeScope(event.payload.claim, event.payload.scope, event.sessionId)
      if (event.payload.claim.sourceId !== 'USER_PASTE') {
        throw new AppError('EVENT_INVALID', '节点粘贴事件只能保存 USER_PASTE Claim。')
      }
      return TravelStateSchema.parse({ ...current, lastSeq: event.seq })
    }
    case 'research/node-checklist-prepared': {
      if (!current || current.stage !== 'STAGE_3') {
        throw new AppError('EVENT_INVALID', '节点研究清单只能在 STAGE-3 生成。')
      }
      const nodeState = requireRouteNodeResearchState(current, event.payload.scope)
      if (!nodeState.required) {
        throw new AppError('EVENT_INVALID', '无需研究的中转节点不能生成清单。')
      }
      for (const claim of event.payload.finalClaims) {
        assertClaimMatchesNodeScope(claim, event.payload.scope, event.sessionId)
      }
      assertNodeDetailsMatchScope(event.payload, event.payload.scope)
      const status = event.payload.entities.length === 0 ? 'BLOCKED' : 'REVIEW_REQUIRED'
      const blockingReasons =
        status === 'BLOCKED'
          ? [
              ...(event.payload.sourceFailures.length > 0
                ? event.payload.sourceFailures.map((failure) => failure.capabilityImpact)
                : ['研究清单为空'])
            ]
          : []
      return TravelStateSchema.parse({
        ...current,
        routeNodeResearchStates: replaceRouteNodeResearchState(current, nodeState.scope, {
          ...nodeState,
          status,
          researchEntities: event.payload.entities,
          researchChecklistConfirmed: false,
          conflictResolutions: [],
          sourceResearchFailures: event.payload.sourceFailures,
          xhsSampleSummary: event.payload.xhsSampleSummary ?? null,
          manualResearchSummary: event.payload.manualResearchSummary ?? null,
          attractionRankings: event.payload.attractionRankings ?? [],
          blockingReasons,
          confirmedAt: null
        }),
        lastSeq: event.seq
      })
    }
    case 'research/node-disposition-set': {
      if (!current || current.stage !== 'STAGE_3') {
        throw new AppError('EVENT_INVALID', '节点研究线索只能在 STAGE-3 处置。')
      }
      const nodeState = requireRouteNodeResearchState(current, event.payload.scope)
      if (
        !nodeState.researchEntities.some((entity) => entity.entityId === event.payload.entityId)
      ) {
        throw new AppError('EVENT_INVALID', '节点研究线索不存在。')
      }
      return TravelStateSchema.parse({
        ...current,
        routeNodeResearchStates: replaceRouteNodeResearchState(current, nodeState.scope, {
          ...nodeState,
          status: 'REVIEW_REQUIRED',
          researchEntities: nodeState.researchEntities.map((entity) =>
            entity.entityId === event.payload.entityId
              ? { ...entity, disposition: event.payload.disposition }
              : entity
          ),
          researchChecklistConfirmed: false,
          blockingReasons: [],
          confirmedAt: null
        }),
        lastSeq: event.seq
      })
    }
    case 'research/node-conflict-resolved': {
      if (!current || current.stage !== 'STAGE_3') {
        throw new AppError('EVENT_INVALID', '节点研究冲突只能在 STAGE-3 裁决。')
      }
      const nodeState = requireRouteNodeResearchState(current, event.payload.scope)
      if (!sameEvidenceScope(event.payload.resolution.scope, event.payload.scope)) {
        throw new AppError('EVENT_INVALID', '节点冲突裁决 scope 不一致。')
      }
      const resolution = event.payload.resolution
      const remaining = nodeState.conflictResolutions.filter(
        (item) => item.subject !== resolution.subject || item.predicate !== resolution.predicate
      )
      return TravelStateSchema.parse({
        ...current,
        routeNodeResearchStates: replaceRouteNodeResearchState(current, nodeState.scope, {
          ...nodeState,
          status: 'REVIEW_REQUIRED',
          conflictResolutions: [...remaining, resolution],
          researchChecklistConfirmed: false,
          blockingReasons: [],
          confirmedAt: null
        }),
        lastSeq: event.seq
      })
    }
    case 'research/node-confirmed': {
      if (!current || current.stage !== 'STAGE_3') {
        throw new AppError('EVENT_INVALID', '节点研究清单只能在 STAGE-3 确认。')
      }
      const nodeState = requireRouteNodeResearchState(current, event.payload.scope)
      if (!nodeState.required || nodeState.researchEntities.length === 0) {
        throw new AppError('EVENT_INVALID', '空或可跳过节点不能确认。')
      }
      const nextStates = replaceRouteNodeResearchState(current, nodeState.scope, {
        ...nodeState,
        status: 'CONFIRMED',
        researchChecklistConfirmed: true,
        blockingReasons: [],
        confirmedAt: event.payload.confirmedAt
      })
      const complete = nextStates
        .filter((item) => item.required)
        .every((item) => item.status === 'CONFIRMED')
      if (
        complete !== event.payload.routeResearchComplete ||
        JSON.stringify(summarizeRouteNodeResearchStates(nextStates)) !==
          JSON.stringify(event.payload.nodeSummaries)
      ) {
        throw new AppError('EVENT_INVALID', '节点研究完成摘要与重放状态不一致。')
      }
      return TravelStateSchema.parse({
        ...current,
        stage: complete ? 'STAGE_4' : current.stage,
        routeNodeResearchStates: nextStates,
        lastSeq: event.seq
      })
    }
    case 'route-d5/leg-options-prepared': {
      if (!current || current.stage !== 'STAGE_4') {
        throw new AppError('EVENT_INVALID', '多段铁路候选只能在 STAGE-4 生成。')
      }
      const legState = requireRouteD5LegState(current, event.payload.scope)
      if (legState.routeLeg.mode !== 'RAIL') {
        throw new AppError('EVENT_INVALID', '非铁路路段不能接收铁路候选。')
      }
      const expectedDirection = legState.routeLeg.to.kind === 'ORIGIN' ? 'RETURN' : 'OUTBOUND'
      if (
        event.payload.options.some(
          (option) =>
            option.direction !== expectedDirection ||
            option.serviceDate !== legState.routeLeg.travelDate ||
            normalizeRouteLabel(option.fromStation) !==
              normalizeRouteLabel(legState.routeLeg.fromCity) ||
            normalizeRouteLabel(option.toStation) !== normalizeRouteLabel(legState.routeLeg.toCity)
        )
      ) {
        throw new AppError('EVENT_INVALID', '铁路候选与目标路段的方向、日期或城市不一致。')
      }
      return TravelStateSchema.parse({
        ...current,
        routeD5LegStates: replaceRouteD5LegState(current, legState.scope, {
          ...legState,
          status: 'OPTIONS_READY',
          railOptions: event.payload.options,
          selectedRailOption: null,
          selectionClaimIds: [],
          plan: null,
          sourceOutcome: 'SUCCEEDED',
          blockingReasons: []
        }),
        routeDaySkeletons: [],
        routeD5Confirmed: false,
        lastSeq: event.seq
      })
    }
    case 'route-d5/leg-selected': {
      if (!current || current.stage !== 'STAGE_4') {
        throw new AppError('EVENT_INVALID', '多段交通只能在 STAGE-4 选择。')
      }
      const legState = requireRouteD5LegState(current, event.payload.scope)
      if (event.payload.claims.some((claim) => claim.sessionId !== event.sessionId)) {
        throw new AppError('EVENT_INVALID', '路段选择 Claim 与事件会话不一致。')
      }
      if (event.payload.selectionKind === 'RAIL_OPTION') {
        if (
          legState.routeLeg.mode !== 'RAIL' ||
          !event.payload.option ||
          event.payload.plan !== null ||
          !legState.railOptions.some(
            (option) => JSON.stringify(option) === JSON.stringify(event.payload.option)
          ) ||
          !event.payload.claims.some((claim) => claim.predicate === 'railJourney')
        ) {
          throw new AppError('EVENT_INVALID', '铁路选择不属于当前路段候选集。')
        }
      } else if (
        (legState.routeLeg.mode !== 'MANUAL_FLIGHT' && legState.routeLeg.mode !== 'MANUAL_COACH') ||
        event.payload.option !== null ||
        event.payload.plan === null
      ) {
        throw new AppError('EVENT_INVALID', '人工交通选择与目标路段方式不一致。')
      }
      const claimIds = event.payload.claims.map((claim) => claim.claimId)
      if (
        event.payload.plan &&
        event.payload.plan.legs.some((leg) =>
          leg.claimIds.some((claimId) => !claimIds.includes(claimId))
        )
      ) {
        throw new AppError('EVENT_INVALID', '人工交通计划引用了选择事件之外的 Claim。')
      }
      return TravelStateSchema.parse({
        ...current,
        routeD5LegStates: replaceRouteD5LegState(current, legState.scope, {
          ...legState,
          status: event.payload.plan ? 'READY' : 'SELECTED',
          selectedRailOption: event.payload.option,
          selectionClaimIds: claimIds,
          plan: event.payload.plan,
          sourceOutcome: 'SUCCEEDED',
          blockingReasons: []
        }),
        routeDaySkeletons: [],
        routeD5Confirmed: false,
        lastSeq: event.seq
      })
    }
    case 'route-d5/leg-transfers-prepared': {
      if (!current || current.stage !== 'STAGE_4') {
        throw new AppError('EVENT_INVALID', '多段接驳只能在 STAGE-4 生成。')
      }
      const legState = requireRouteD5LegState(current, event.payload.scope)
      if (legState.routeLeg.mode !== 'RAIL' || !legState.selectedRailOption) {
        throw new AppError('EVENT_INVALID', '生成接驳前必须选择当前铁路路段的车次。')
      }
      if (event.payload.finalClaims.some((claim) => claim.sessionId !== event.sessionId)) {
        throw new AppError('EVENT_INVALID', '接驳 final Claim 与事件会话不一致。')
      }
      const permittedClaimIds = new Set([
        ...legState.selectionClaimIds,
        ...event.payload.finalClaims.map((claim) => claim.claimId)
      ])
      if (
        event.payload.plan.legs.some((leg) =>
          leg.claimIds.some((claimId) => !permittedClaimIds.has(claimId))
        )
      ) {
        throw new AppError('EVENT_INVALID', '接驳计划引用了本路段之外的 Claim。')
      }
      return TravelStateSchema.parse({
        ...current,
        routeD5LegStates: replaceRouteD5LegState(current, legState.scope, {
          ...legState,
          status: 'READY',
          plan: event.payload.plan,
          sourceOutcome: 'SUCCEEDED',
          blockingReasons: []
        }),
        routeDaySkeletons: [],
        routeD5Confirmed: false,
        lastSeq: event.seq
      })
    }
    case 'route-d5/skeleton-updated': {
      if (!current || current.stage !== 'STAGE_4') {
        throw new AppError('EVENT_INVALID', '多城市路线骨架只能在 STAGE-4 更新。')
      }
      requireRouteD5RouteScope(current, event.payload.scope)
      assertCompleteRouteD5Days(current, event.payload.days)
      const changedDates = new Set(event.payload.changedDates)
      if (changedDates.size !== event.payload.changedDates.length) {
        throw new AppError('EVENT_INVALID', '路线骨架 changedDates 不能重复。')
      }
      const affectedSegments = new Set(
        [...current.routeDaySkeletons, ...event.payload.days]
          .filter((day) => changedDates.has(day.date) && day.segmentId)
          .map((day) => day.segmentId!)
      )
      return TravelStateSchema.parse({
        ...current,
        routeDaySkeletons: event.payload.days,
        routeD5StayStates: current.routeD5StayStates.map((stayState) =>
          affectedSegments.has(stayState.scope.segmentId)
            ? RouteD5StayStateSchema.parse({
                ...stayState,
                status: 'NOT_STARTED',
                candidates: [],
                selectedCandidateId: null,
                sourceOutcomes: [],
                blockingReasons: []
              })
            : stayState
        ),
        routeD5Confirmed: false,
        lastSeq: event.seq
      })
    }
    case 'route-d5/stay-candidates-prepared': {
      if (!current || current.stage !== 'STAGE_4') {
        throw new AppError('EVENT_INVALID', '多段住宿候选只能在 STAGE-4 生成。')
      }
      const stayState = requireRouteD5StayState(current, event.payload.scope)
      if (
        event.payload.finalClaims.some((claim) => claim.sessionId !== event.sessionId) ||
        event.payload.candidates.some(
          (candidate) => candidate.segmentId !== stayState.scope.segmentId
        )
      ) {
        throw new AppError('EVENT_INVALID', '住宿候选或 final Claim 不属于当前住宿段。')
      }
      for (const outcome of event.payload.sourceOutcomes) {
        const count = event.payload.candidates.filter(
          (candidate) => candidate.sourceId === outcome.sourceId
        ).length
        if (outcome.candidateCount !== count) {
          throw new AppError('EVENT_INVALID', '住宿来源结果计数与候选不一致。')
        }
      }
      const status = event.payload.candidates.length > 0 ? 'CANDIDATES_READY' : 'BLOCKED'
      return TravelStateSchema.parse({
        ...current,
        routeD5StayStates: replaceRouteD5StayState(current, stayState.scope, {
          ...stayState,
          status,
          candidates: event.payload.candidates,
          selectedCandidateId: null,
          sourceOutcomes: event.payload.sourceOutcomes,
          blockingReasons:
            status === 'BLOCKED'
              ? event.payload.sourceOutcomes.flatMap((outcome) =>
                  outcome.capabilityImpact ? [outcome.capabilityImpact] : []
                )
              : []
        }),
        routeD5Confirmed: false,
        lastSeq: event.seq
      })
    }
    case 'route-d5/stay-selected': {
      if (!current || current.stage !== 'STAGE_4') {
        throw new AppError('EVENT_INVALID', '多段住宿只能在 STAGE-4 选择。')
      }
      const stayState = requireRouteD5StayState(current, event.payload.scope)
      if (
        !stayState.candidates.some(
          (candidate) => candidate.candidateId === event.payload.candidateId
        )
      ) {
        throw new AppError('EVENT_INVALID', '住宿选择不属于当前住宿段候选集。')
      }
      return TravelStateSchema.parse({
        ...current,
        routeD5StayStates: replaceRouteD5StayState(current, stayState.scope, {
          ...stayState,
          status: 'SELECTED',
          selectedCandidateId: event.payload.candidateId,
          blockingReasons: []
        }),
        routeD5Confirmed: false,
        lastSeq: event.seq
      })
    }
    case 'route-d5/confirmed': {
      if (!current || current.stage !== 'STAGE_4') {
        throw new AppError('EVENT_INVALID', '多城市 D5 只能从 STAGE-4 确认。')
      }
      requireRouteD5RouteScope(current, event.payload.scope)
      assertCompleteRouteD5Days(current, current.routeDaySkeletons)
      if (
        current.routeD5LegStates.length === 0 ||
        current.routeD5LegStates.some((item) => item.status !== 'READY') ||
        current.routeD5StayStates.length === 0 ||
        current.routeD5StayStates.some((item) => item.status !== 'SELECTED')
      ) {
        throw new AppError('GATE_BLOCKED', '所有路段、住宿段与日期骨架完成后才能进入 STAGE-5。')
      }
      return TravelStateSchema.parse({
        ...current,
        stage: 'STAGE_5',
        routeD5Confirmed: true,
        lastSeq: event.seq
      })
    }
    case 'transport/candidates-prepared':
      if (!current || current.stage !== 'STAGE_4') {
        throw new AppError('EVENT_INVALID', '交通候选只能在 STAGE-4 生成。')
      }
      return TravelStateSchema.parse({
        ...current,
        transportCandidates: event.payload.candidates,
        selectedTransportCandidateId: null,
        boundaryAnchors: [],
        daySkeletons: [],
        staySegment: null,
        stayCandidates: [],
        selectedStayCandidateId: null,
        staySourceOutcomes: [],
        lastSeq: event.seq
      })
    case 'transport/candidate-selected': {
      if (!current || current.stage !== 'STAGE_4') {
        throw new AppError('EVENT_INVALID', '交通候选只能在 STAGE-4 选择。')
      }
      if (
        !current.transportCandidates.some((item) => item.candidateId === event.payload.candidateId)
      ) {
        throw new AppError('EVENT_INVALID', '交通选择不属于当前候选集。')
      }
      return TravelStateSchema.parse({
        ...current,
        selectedTransportCandidateId: event.payload.candidateId,
        boundaryAnchors: [],
        daySkeletons: [],
        staySegment: null,
        stayCandidates: [],
        selectedStayCandidateId: null,
        staySourceOutcomes: [],
        lastSeq: event.seq
      })
    }
    case 'skeleton/updated':
      if (!current || (current.stage !== 'STAGE_4' && current.stage !== 'STAGE_5')) {
        throw new AppError('EVENT_INVALID', '行程骨架只能在 STAGE-4 或 STAGE-5 更新。')
      }
      if (!current.selectedTransportCandidateId) {
        throw new AppError('EVENT_INVALID', '生成行程骨架前必须选择交通方案。')
      }
      return TravelStateSchema.parse({
        ...current,
        boundaryAnchors: event.payload.boundaryAnchors,
        daySkeletons: event.payload.days,
        staySegment: event.payload.staySegment,
        stayCandidates: [],
        selectedStayCandidateId: null,
        staySourceOutcomes: [],
        lastSeq: event.seq
      })
    case 'stay/candidates-prepared':
      if (!current || current.stage !== 'STAGE_5' || !current.staySegment) {
        throw new AppError('EVENT_INVALID', '住宿候选只能在已确认骨架的 STAGE-5 生成。')
      }
      return TravelStateSchema.parse({
        ...current,
        stayCandidates: event.payload.candidates,
        selectedStayCandidateId: null,
        staySourceOutcomes: event.payload.sourceOutcomes,
        lastSeq: event.seq
      })
    case 'stay/selected':
      if (!current || current.stage !== 'STAGE_5') {
        throw new AppError('EVENT_INVALID', '住宿候选只能在 STAGE-5 选择。')
      }
      if (!current.stayCandidates.some((item) => item.candidateId === event.payload.candidateId)) {
        throw new AppError('EVENT_INVALID', '住宿选择不属于当前候选集。')
      }
      return TravelStateSchema.parse({
        ...current,
        selectedStayCandidateId: event.payload.candidateId,
        lastSeq: event.seq
      })
    case 'timeline/published': {
      if (!current || current.stage !== 'STAGE_5') {
        throw new AppError('EVENT_INVALID', '时间轴只能在 STAGE-5 发布。')
      }
      const expectedVersion = (current.timelineVersions.at(-1)?.version ?? 0) + 1
      if (event.payload.timeline.version !== expectedVersion || !event.payload.timeline.isCurrent) {
        throw new AppError('EVENT_INVALID', '时间轴版本必须连续递增并成为 current。')
      }
      return TravelStateSchema.parse({
        ...current,
        timelineVersions: [
          ...current.timelineVersions.map((version) => ({ ...version, isCurrent: false })),
          event.payload.timeline
        ],
        d6SourceOutcomes: event.payload.sourceOutcomes,
        lastSeq: event.seq
      })
    }
    case 'task/updated': {
      if (!current || current.stage !== 'STAGE_5') {
        throw new AppError('EVENT_INVALID', '行前任务只能在 STAGE-5 更新。')
      }
      const currentTimeline = current.timelineVersions.find((version) => version.isCurrent)
      if (!currentTimeline) {
        throw new AppError('EVENT_INVALID', '生成行前任务前必须存在 current 时间轴。')
      }
      if (event.payload.tasks.some((task) => task.sessionId !== event.sessionId)) {
        throw new AppError('EVENT_INVALID', '任务与事件会话不一致。')
      }
      const replacement = event.payload.replacementTimeline
      if (replacement) {
        if (replacement.version !== currentTimeline.version + 1 || !replacement.isCurrent) {
          throw new AppError('EVENT_INVALID', '任务回填后的时间轴版本必须连续递增。')
        }
        return TravelStateSchema.parse({
          ...current,
          timelineVersions: [
            ...current.timelineVersions.map((version) => ({ ...version, isCurrent: false })),
            replacement
          ],
          tasks: event.payload.tasks,
          latestGateC: null,
          lastSeq: event.seq
        })
      }
      if (
        event.payload.tasks.some((task) => task.sourceTimelineVersion !== currentTimeline.version)
      ) {
        throw new AppError('EVENT_INVALID', '任务必须关联 current 时间轴版本。')
      }
      return TravelStateSchema.parse({
        ...current,
        tasks: event.payload.tasks,
        latestGateC: null,
        lastSeq: event.seq
      })
    }
    case 'gate/result': {
      if (!current || current.stage !== 'STAGE_5') {
        throw new AppError('EVENT_INVALID', 'GATE_C 只能在 STAGE-5 执行。')
      }
      const currentVersion = current.timelineVersions.find((version) => version.isCurrent)?.version
      if (event.payload.report.timelineVersion !== currentVersion) {
        throw new AppError('EVENT_INVALID', 'GATE_C 结果不属于 current 时间轴。')
      }
      return TravelStateSchema.parse({
        ...current,
        latestGateC: event.payload.report,
        lastSeq: event.seq
      })
    }
    case 'stage/confirmed':
      if (!current) {
        throw new AppError('EVENT_INVALID', `会话 ${event.sessionId} 尚未创建。`)
      }
      return TravelStateSchema.parse({
        ...current,
        stage: assertStageTransition(current, event),
        lastSeq: event.seq
      })
  }
}

type NodeChecklistPayload = Extract<
  SessionEvent,
  { type: 'research/node-checklist-prepared' }
>['payload']

function requireRouteNodeResearchState(
  state: TravelState,
  scope: RouteNodeResearchScope
): RouteNodeResearchState {
  if (
    scope.sessionId !== state.sessionId ||
    state.selectedRouteId === null ||
    scope.routeId !== state.selectedRouteId
  ) {
    throw new AppError('EVENT_INVALID', '节点研究 scope 不属于已选路线。')
  }
  const candidate = state.routeCandidates.find((item) => item.routeId === state.selectedRouteId)
  const routeNode = candidate?.nodes.find((node) => node.nodeId === scope.nodeId)
  const nodeState = state.routeNodeResearchStates.find(
    (item) => item.scope.routeId === scope.routeId && item.scope.nodeId === scope.nodeId
  )
  if (
    !routeNode ||
    !nodeState ||
    routeNode.city !== scope.city ||
    routeNode.nodeKind !== scope.nodeKind ||
    JSON.stringify(routeNode.mandatoryPlaceIds) !== JSON.stringify(scope.mandatoryPlaceIds) ||
    JSON.stringify(nodeState.scope) !== JSON.stringify(scope)
  ) {
    throw new AppError('EVENT_INVALID', '节点研究 scope 与已选路线节点不一致。')
  }
  return nodeState
}

function replaceRouteNodeResearchState(
  state: TravelState,
  scope: RouteNodeResearchScope,
  replacement: RouteNodeResearchState
): RouteNodeResearchState[] {
  let replaced = false
  const next = state.routeNodeResearchStates.map((item) => {
    if (item.scope.routeId !== scope.routeId || item.scope.nodeId !== scope.nodeId) return item
    replaced = true
    return RouteNodeResearchStateSchema.parse(replacement)
  })
  if (!replaced) throw new AppError('EVENT_INVALID', '节点研究状态不存在。')
  return next
}

function assertClaimMatchesNodeScope(
  claim: EvidenceClaim,
  scope: RouteNodeResearchScope,
  sessionId: string
): void {
  if (claim.sessionId !== sessionId || !sameEvidenceScope(claim.scope, scope)) {
    throw new AppError('EVENT_INVALID', '节点 Claim 与事件 scope 不一致。')
  }
}

function assertNodeDetailsMatchScope(
  payload: NodeChecklistPayload,
  scope: RouteNodeResearchScope
): void {
  const nestedScopes = [
    ...payload.entities.map((item) => item.scope),
    ...payload.sourceFailures.map((item) => item.scope),
    ...(payload.attractionRankings ?? []).map((item) => item.scope),
    payload.xhsSampleSummary?.scope,
    payload.manualResearchSummary?.scope
  ].filter((nested): nested is EvidenceScope => nested !== null && nested !== undefined)
  if (
    payload.entities.some((entity) => entity.destinationCity !== scope.city) ||
    nestedScopes.some((nested) => !sameEvidenceScope(nested, scope))
  ) {
    throw new AppError('EVENT_INVALID', '节点研究详情与事件 scope 不一致。')
  }
}

function sameEvidenceScope(
  evidenceScope: EvidenceScope | null | undefined,
  routeScope: RouteNodeResearchScope
): boolean {
  return (
    evidenceScope?.kind === 'ROUTE_NODE' &&
    evidenceScope.routeId === routeScope.routeId &&
    evidenceScope.nodeId === routeScope.nodeId
  )
}

function requireRouteD5RouteScope(state: TravelState, scope: RouteD5RouteScope): RouteCandidate {
  if (scope.sessionId !== state.sessionId || scope.routeId !== state.selectedRouteId) {
    throw new AppError('EVENT_INVALID', 'route-D5 scope 不属于当前已选路线。')
  }
  const route = state.routeCandidates.find((item) => item.routeId === scope.routeId)
  if (!route) throw new AppError('EVENT_INVALID', 'route-D5 scope 的路线不存在。')
  return route
}

function requireRouteD5LegState(state: TravelState, scope: RouteD5LegScope): RouteD5LegState {
  const route = requireRouteD5RouteScope(state, { ...scope, kind: 'ROUTE' })
  const routeLeg = route.legs.find((leg) => leg.legId === scope.legId)
  const legState = state.routeD5LegStates.find(
    (item) => item.scope.routeId === scope.routeId && item.scope.legId === scope.legId
  )
  if (!routeLeg || !legState || JSON.stringify(routeLeg) !== JSON.stringify(legState.routeLeg)) {
    throw new AppError('EVENT_INVALID', 'route-D5 leg scope 与已选路线不一致。')
  }
  return legState
}

function replaceRouteD5LegState(
  state: TravelState,
  scope: RouteD5LegScope,
  replacement: RouteD5LegState
): RouteD5LegState[] {
  let replaced = false
  const next = state.routeD5LegStates.map((item) => {
    if (item.scope.routeId !== scope.routeId || item.scope.legId !== scope.legId) return item
    replaced = true
    return RouteD5LegStateSchema.parse(replacement)
  })
  if (!replaced) throw new AppError('EVENT_INVALID', 'route-D5 路段状态不存在。')
  return next
}

function requireRouteD5StayState(state: TravelState, scope: RouteD5StayScope): RouteD5StayState {
  const route = requireRouteD5RouteScope(state, { ...scope, kind: 'ROUTE' })
  const segment = route.staySegments.find(
    (item) => item.segmentId === scope.segmentId && item.nodeId === scope.nodeId
  )
  const stayState = state.routeD5StayStates.find(
    (item) =>
      item.scope.routeId === scope.routeId &&
      item.scope.nodeId === scope.nodeId &&
      item.scope.segmentId === scope.segmentId
  )
  if (!segment || !stayState || JSON.stringify(segment) !== JSON.stringify(stayState.segment)) {
    throw new AppError('EVENT_INVALID', 'route-D5 stay scope 与已选路线不一致。')
  }
  return stayState
}

function replaceRouteD5StayState(
  state: TravelState,
  scope: RouteD5StayScope,
  replacement: RouteD5StayState
): RouteD5StayState[] {
  let replaced = false
  const next = state.routeD5StayStates.map((item) => {
    if (
      item.scope.routeId !== scope.routeId ||
      item.scope.nodeId !== scope.nodeId ||
      item.scope.segmentId !== scope.segmentId
    ) {
      return item
    }
    replaced = true
    return RouteD5StayStateSchema.parse(replacement)
  })
  if (!replaced) throw new AppError('EVENT_INVALID', 'route-D5 住宿段状态不存在。')
  return next
}

function assertCompleteRouteD5Days(state: TravelState, days: RouteDaySkeleton[]): void {
  const route = requireRouteD5RouteScope(state, {
    kind: 'ROUTE',
    sessionId: state.sessionId,
    routeId: state.selectedRouteId ?? ''
  })
  const goal = state.itineraryGoal
  if (!goal) throw new AppError('EVENT_INVALID', 'route-D5 缺少路线总目标。')
  const expectedDates = routeDateRange(goal.startDate, goal.endDate)
  const actualDates = days.map((day) => day.date)
  if (
    new Set(actualDates).size !== actualDates.length ||
    JSON.stringify([...actualDates].sort()) !== JSON.stringify(expectedDates) ||
    days.some((day) => day.sessionId !== state.sessionId || day.routeId !== route.routeId)
  ) {
    throw new AppError('EVENT_INVALID', 'route-D5 日级骨架没有一日一条地覆盖完整行程。')
  }
  for (const day of days) {
    if (day.dayType === 'INTERCITY_TRANSFER_DAY') {
      if (
        day.routeLegIds.some(
          (legId) => !route.legs.some((leg) => leg.legId === legId && leg.travelDate === day.date)
        ) ||
        new Set(day.routeLegIds).size !== day.routeLegIds.length
      ) {
        throw new AppError('EVENT_INVALID', '跨城日引用了错误的 routeLegId。')
      }
    } else if (
      !route.staySegments.some(
        (segment) =>
          segment.segmentId === day.segmentId &&
          segment.nodeId === day.owningNodeId &&
          segment.nightDates.includes(day.date)
      )
    ) {
      throw new AppError('EVENT_INVALID', '住宿日引用了错误的 nodeId/segmentId。')
    }
  }
}

function routeDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = []
  for (let date = startDate; date <= endDate; date = addRouteDay(date)) dates.push(date)
  return dates
}

function addRouteDay(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + 1)
  return value.toISOString().slice(0, 10)
}

function normalizeRouteLabel(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase()
}

function evidenceClaimsForEvent(event: SessionEvent): EvidenceClaim[] {
  switch (event.type) {
    case 'evidence/added':
    case 'research/node-user-paste-added':
      return [event.payload.claim]
    case 'itinerary/route-manual-evidence-applied':
      return [event.payload.claim]
    case 'research/node-checklist-prepared':
    case 'itinerary/route-candidates-prepared':
    case 'route-d5/leg-transfers-prepared':
    case 'route-d5/stay-candidates-prepared':
      return event.payload.finalClaims
    case 'research/checklist-prepared':
      return event.payload.finalClaims ?? []
    case 'route-d5/leg-selected':
      return event.payload.claims
    default:
      return []
  }
}

export class TravelStateService {
  private readonly writeState: (event: SessionEvent, state: TravelState) => void

  constructor(
    private readonly ctx: Context,
    private readonly eventLog: EventLogService,
    private readonly config: TravelStateConfig
  ) {
    this.writeState = config.database.transaction((event: SessionEvent, state: TravelState) => {
      if (event.type === 'session/created') {
        config.database
          .prepare(
            `INSERT INTO sessions(
               session_id, created_at, stage, last_seq, title, linked_session_group, split_index
             ) VALUES (
               @sessionId, @createdAt, @stage, @lastSeq, @title, @linkedSessionGroup, @splitIndex
             )`
          )
          .run(state)
      } else {
        config.database
          .prepare('UPDATE sessions SET stage = ?, last_seq = ? WHERE session_id = ?')
          .run(state.stage, state.lastSeq, state.sessionId)
      }
      if (event.type === 'decision/logged') {
        config.database
          .prepare(
            `INSERT INTO decision_logs(
               decision_id, session_id, created_at, topic, chosen_json,
               rejected_json, rationale, claim_ids
             ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
             ON CONFLICT(decision_id) DO NOTHING`
          )
          .run(
            event.payload.decisionId,
            event.sessionId,
            event.timestamp,
            event.payload.category,
            JSON.stringify(event.payload.selected),
            JSON.stringify(event.payload.alternatives),
            event.payload.reason
          )
      }
      const evidenceClaims = evidenceClaimsForEvent(event)
      for (const claim of evidenceClaims) {
        config.database
          .prepare(
            `INSERT INTO evidence_claims(
               claim_id, session_id, subject, predicate, value_json, source_id,
               source_ref, content_identity, verification_status, observed_at,
               valid_until, confidence, conflicts_with, notes
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(claim_id) DO UPDATE SET
               subject=excluded.subject,
               predicate=excluded.predicate,
               value_json=excluded.value_json,
               source_id=excluded.source_id,
               source_ref=excluded.source_ref,
               content_identity=excluded.content_identity,
               verification_status=excluded.verification_status,
               observed_at=excluded.observed_at,
               valid_until=excluded.valid_until,
               confidence=excluded.confidence,
               conflicts_with=excluded.conflicts_with,
               notes=excluded.notes`
          )
          .run(
            claim.claimId,
            claim.sessionId,
            claim.subject,
            claim.predicate,
            JSON.stringify(claim.value),
            claim.sourceId,
            claim.sourceRef,
            claim.contentIdentity,
            claim.verificationStatus,
            claim.observedAt,
            claim.validUntil,
            claim.confidence,
            JSON.stringify(claim.conflictsWith),
            claim.notes
          )
        if (claim.scope?.kind === 'ROUTE_NODE') {
          config.database
            .prepare(
              `INSERT INTO evidence_claim_scopes(
                 claim_id, session_id, route_id, node_id, scope_kind
               ) VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(claim_id) DO UPDATE SET
                 session_id=excluded.session_id,
                 route_id=excluded.route_id,
                 node_id=excluded.node_id,
                 scope_kind=excluded.scope_kind`
            )
            .run(
              claim.claimId,
              claim.sessionId,
              claim.scope.routeId,
              claim.scope.nodeId,
              claim.scope.kind
            )
        }
      }
      if (
        event.type === 'itinerary/route-candidates-prepared' ||
        event.type === 'itinerary/route-manual-evidence-applied'
      ) {
        config.database
          .prepare('DELETE FROM itinerary_route_candidates WHERE session_id = ?')
          .run(event.sessionId)
        const insertCandidate = config.database.prepare(
          `INSERT INTO itinerary_route_candidates(
             route_id, session_id, profile, is_recommended, is_selected,
             hard_constraint_pass, critical_evidence_complete, score_json, detail_json
           ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`
        )
        const insertNode = config.database.prepare(
          `INSERT INTO itinerary_route_nodes(
             node_id, route_id, session_id, sequence, city, node_kind,
             arrival_date, departure_date, nights, mandatory_place_ids_json, detail_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        const insertLeg = config.database.prepare(
          `INSERT INTO itinerary_route_legs(
             leg_id, route_id, session_id, sequence, from_city, to_city, travel_date,
             mode, duration_minutes, cost_cents, verification_status, claim_ids_json, detail_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        const insertStay = config.database.prepare(
          `INSERT INTO itinerary_route_stay_segments(
             segment_id, route_id, node_id, session_id, city,
             check_in_date, check_out_date, nights, detail_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        for (const candidate of state.routeCandidates) {
          insertCandidate.run(
            candidate.routeId,
            state.sessionId,
            candidate.profile,
            Number(candidate.isRecommended),
            Number(candidate.score.hardConstraintPass),
            Number(candidate.score.criticalEvidenceComplete),
            JSON.stringify(candidate.score),
            JSON.stringify(candidate)
          )
          for (const node of candidate.nodes) {
            insertNode.run(
              node.nodeId,
              candidate.routeId,
              state.sessionId,
              node.sequence,
              node.city,
              node.nodeKind,
              node.arrivalDate,
              node.departureDate,
              node.nights,
              JSON.stringify(node.mandatoryPlaceIds),
              JSON.stringify(node)
            )
          }
          for (const [index, leg] of candidate.legs.entries()) {
            insertLeg.run(
              leg.legId,
              candidate.routeId,
              state.sessionId,
              index + 1,
              leg.fromCity,
              leg.toCity,
              leg.travelDate,
              leg.mode,
              leg.durationMinutes,
              leg.costCents,
              leg.verificationStatus,
              JSON.stringify(leg.claimIds),
              JSON.stringify(leg)
            )
          }
          for (const segment of candidate.staySegments) {
            insertStay.run(
              segment.segmentId,
              candidate.routeId,
              segment.nodeId,
              state.sessionId,
              segment.city,
              segment.checkInDate,
              segment.checkOutDate,
              segment.nights,
              JSON.stringify(segment)
            )
          }
        }
      }
      if (event.type === 'itinerary/route-selected') {
        config.database
          .prepare(
            'UPDATE itinerary_route_candidates SET is_selected = (route_id = ?) WHERE session_id = ?'
          )
          .run(event.payload.selectedRouteId, event.sessionId)
        config.database
          .prepare(
            `INSERT INTO itinerary_route_selections(
               session_id, selected_route_id, selected_at, reason
             ) VALUES (?, ?, ?, ?)
             ON CONFLICT(session_id) DO UPDATE SET
               selected_route_id=excluded.selected_route_id,
               selected_at=excluded.selected_at,
               reason=excluded.reason`
          )
          .run(
            event.sessionId,
            event.payload.selectedRouteId,
            event.timestamp,
            event.payload.reason
          )
        if (hasRouteNodeResearchProjectionTables(config.database)) {
          writeAllRouteNodeResearchProjections(config.database, state)
        }
        if (hasRouteD5ProjectionTables(config.database)) {
          writeAllRouteD5Projections(config.database, state)
        }
      }
      if (
        event.type === 'research/node-checklist-prepared' ||
        event.type === 'research/node-disposition-set' ||
        event.type === 'research/node-conflict-resolved' ||
        event.type === 'research/node-confirmed' ||
        event.type === 'research/node-user-paste-added'
      ) {
        if (hasRouteNodeResearchProjectionTables(config.database)) {
          writeRouteNodeResearchProjection(config.database, state, event.payload.scope)
        }
      }
      if (event.type.startsWith('route-d5/') && hasRouteD5ProjectionTables(config.database)) {
        writeAllRouteD5Projections(config.database, state)
        if (event.type === 'route-d5/confirmed') {
          config.database
            .prepare(
              `INSERT INTO route_d5_confirmations(session_id, route_id, confirmed_at)
               VALUES (?, ?, ?)
               ON CONFLICT(session_id) DO UPDATE SET
                 route_id=excluded.route_id, confirmed_at=excluded.confirmed_at`
            )
            .run(event.sessionId, event.payload.scope.routeId, event.payload.confirmedAt)
        }
      }
      if (event.type === 'transport/candidates-prepared') {
        config.database
          .prepare('DELETE FROM transport_candidates WHERE session_id = ?')
          .run(event.sessionId)
        const insert = config.database.prepare(
          `INSERT INTO transport_candidates(
             candidate_id, session_id, mode, is_recommended, is_selected,
             total_duration_minutes, total_cost_cents, cost_complete,
             arrival_usable_minutes, departure_usable_minutes, comfort,
             outbound_json, return_json, claim_ids_json, detail_json
           ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        for (const candidate of state.transportCandidates) {
          insert.run(
            candidate.candidateId,
            state.sessionId,
            candidate.mode,
            Number(candidate.isRecommended),
            candidate.doorToDoorTotalMinutes,
            candidate.totalCostCents,
            Number(candidate.costComplete),
            candidate.arrivalUsableMinutes,
            candidate.departureUsableMinutes,
            candidate.comfort,
            JSON.stringify(candidate.outbound),
            JSON.stringify(candidate.return),
            JSON.stringify(candidate.claimIds),
            JSON.stringify(candidate)
          )
        }
      }
      if (event.type === 'transport/candidate-selected') {
        config.database
          .prepare(
            'UPDATE transport_candidates SET is_selected = (candidate_id = ?) WHERE session_id = ?'
          )
          .run(event.payload.candidateId, event.sessionId)
      }
      if (event.type === 'skeleton/updated') {
        const upsertDay = config.database.prepare(
          `INSERT INTO day_skeletons(
             session_id, date, day_type, intensity, morning_json, afternoon_json,
             evening_json, meal_anchors_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(session_id, date) DO UPDATE SET
             day_type=excluded.day_type, intensity=excluded.intensity,
             morning_json=excluded.morning_json, afternoon_json=excluded.afternoon_json,
             evening_json=excluded.evening_json, meal_anchors_json=excluded.meal_anchors_json`
        )
        for (const day of state.daySkeletons.filter((item) =>
          event.payload.changedDates.includes(item.date)
        )) {
          upsertDay.run(
            state.sessionId,
            day.date,
            day.dayType,
            day.intensity,
            day.morning ? JSON.stringify(day.morning) : null,
            day.afternoon ? JSON.stringify(day.afternoon) : null,
            day.evening ? JSON.stringify(day.evening) : null,
            JSON.stringify({ mealAnchors: day.mealAnchors, localTransport: day.localTransport })
          )
        }
        const segment = state.staySegment!
        config.database
          .prepare(
            `INSERT INTO stay_segments(
               segment_id, session_id, area_hint, check_in_date, check_out_date, nights, selected_hotel_ref
             ) VALUES (?, ?, ?, ?, ?, ?, NULL)
             ON CONFLICT(segment_id) DO UPDATE SET area_hint=excluded.area_hint,
               check_in_date=excluded.check_in_date, check_out_date=excluded.check_out_date,
               nights=excluded.nights, selected_hotel_ref=NULL`
          )
          .run(
            segment.segmentId,
            state.sessionId,
            segment.areaHint,
            segment.checkInDate,
            segment.checkOutDate,
            segment.nights
          )
      }
      if (event.type === 'stay/candidates-prepared') {
        config.database
          .prepare('DELETE FROM stay_candidates WHERE session_id = ?')
          .run(event.sessionId)
        const insert = config.database.prepare(
          `INSERT INTO stay_candidates(
             candidate_id, session_id, segment_id, source_id, name, total_cost_cents,
             free_cancel_until, room_fits_party, detail_json, claim_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        for (const candidate of state.stayCandidates) {
          insert.run(
            candidate.candidateId,
            state.sessionId,
            candidate.segmentId,
            candidate.sourceId,
            candidate.name,
            candidate.totalCostCents,
            candidate.cancellation.freeCancelUntil,
            candidate.roomFitsParty === null ? null : Number(candidate.roomFitsParty),
            JSON.stringify(candidate),
            candidate.claimId
          )
        }
      }
      if (event.type === 'stay/selected') {
        config.database
          .prepare('UPDATE stay_segments SET selected_hotel_ref = ? WHERE session_id = ?')
          .run(event.payload.candidateId, event.sessionId)
      }
      if (event.type === 'timeline/published') {
        writeTimelineProjection(config.database, event.sessionId, event.payload.timeline)
      }
      if (event.type === 'task/updated') {
        config.database.prepare('DELETE FROM tasks WHERE session_id = ?').run(event.sessionId)
        const insertTask = config.database.prepare(
          `INSERT INTO tasks(
             task_id, session_id, kind, title, owner, due_at, recheck_at, priority,
             user_decision, reservation, readiness, payment, document, refund,
             reminder, handover_json, timeline_version, item_id, claim_ids,
             route_id, node_id, segment_id, route_leg_id, route_context_json, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        for (const task of event.payload.tasks) {
          insertTask.run(
            task.taskId,
            task.sessionId,
            task.kind,
            task.title,
            task.owner,
            task.dueAt,
            task.recheckAt,
            task.priority,
            task.userDecision,
            task.reservation,
            task.readiness,
            task.payment,
            task.document,
            task.refund,
            task.reminder,
            JSON.stringify(task.handover),
            task.sourceTimelineVersion,
            task.itemId,
            JSON.stringify(task.claimIds),
            task.routeContext?.routeId ?? null,
            task.routeContext?.nodeId ?? null,
            task.routeContext?.segmentId ?? null,
            task.routeContext?.routeLegId ?? null,
            task.routeContext ? JSON.stringify(task.routeContext) : null,
            task.updatedAt
          )
        }
        if (event.payload.replacementTimeline) {
          writeTimelineProjection(
            config.database,
            event.sessionId,
            event.payload.replacementTimeline
          )
        }
      }
      config.database
        .prepare(
          `INSERT INTO travel_states(session_id, seq, state_json, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(session_id) DO UPDATE SET
             seq=excluded.seq, state_json=excluded.state_json, updated_at=excluded.updated_at`
        )
        .run(state.sessionId, state.lastSeq, JSON.stringify(state), event.timestamp)
    })
  }

  async record(draft: SessionEventDraft): Promise<SessionEvent> {
    const current = this.get(draft.sessionId)
    const preview = SessionEventSchema.parse({
      ...draft,
      eventId: 'preflight',
      seq: (current?.lastSeq ?? 0) + 1,
      timestamp: new Date().toISOString()
    })
    reduceTravelState(current, preview)

    const event = await this.eventLog.append(draft)
    const state = reduceTravelState(current, event)
    try {
      this.writeState(event, state)
    } catch (error) {
      try {
        await this.rebuildSession(event.sessionId)
      } catch (rebuildError) {
        throw new AggregateError(
          [error, rebuildError],
          `会话 ${event.sessionId} 的读模型写入与即时重建均失败；JSONL 保持为权威事实源。`
        )
      }
      throw error
    }
    if (
      event.type === 'timeline/published' ||
      event.type === 'task/updated' ||
      event.type === 'gate/result' ||
      event.type === 'itinerary/route-selected' ||
      event.type === 'research/node-confirmed' ||
      event.type === 'route-d5/confirmed' ||
      event.seq % 200 === 0
    ) {
      try {
        await this.eventLog.writeSnapshot(state)
      } catch {
        this.config.warn?.(`会话 ${event.sessionId} 的派生快照写入失败；JSONL 仍为权威源。`)
      }
    }
    this.ctx.emit('event/appended', event)
    const claims = evidenceClaimsForEvent(event)
    if (claims.length > 0) {
      for (const claim of claims) {
        this.ctx.emit(
          'evidence/claim-added',
          event.sessionId,
          claim.claimId,
          claim.verificationStatus
        )
      }
      this.ctx.emit(
        'travel/state-updated',
        event.sessionId,
        event.type.startsWith('route-d5/')
          ? ['evidence', 'meta', 'routeD5']
          : event.type === 'evidence/added'
            ? ['evidence']
            : event.type === 'research/node-user-paste-added'
              ? ['evidence', 'meta', 'routeResearch']
              : event.type === 'research/node-checklist-prepared'
                ? ['evidence', 'meta', 'routeResearch']
                : event.type === 'research/checklist-prepared'
                  ? ['evidence', 'meta', 'd4']
                  : ['evidence', 'meta', 'route']
      )
    } else {
      this.ctx.emit(
        'travel/state-updated',
        event.sessionId,
        event.type.startsWith('destination/') || event.type.startsWith('research/')
          ? event.type.startsWith('research/node-')
            ? ['meta', 'routeResearch']
            : ['meta', 'd4']
          : event.type.startsWith('itinerary/route-')
            ? ['meta', 'route']
            : event.type.startsWith('route-d5/')
              ? ['meta', 'routeD5']
              : event.type.startsWith('transport/') ||
                  event.type.startsWith('skeleton/') ||
                  event.type.startsWith('stay/')
                ? ['meta', 'd5']
                : event.type.startsWith('timeline/')
                  ? ['meta', 'timeline']
                  : event.type === 'task/updated'
                    ? ['meta', 'tasks', ...(event.payload.replacementTimeline ? ['timeline'] : [])]
                    : event.type === 'gate/result'
                      ? ['meta', 'tasks']
                      : ['meta']
      )
    }
    return event
  }

  get(sessionId: string): TravelState | undefined {
    const row = this.config.database
      .prepare('SELECT state_json FROM travel_states WHERE session_id = ?')
      .get(sessionId) as { state_json: string } | undefined
    return row ? TravelStateSchema.parse(JSON.parse(row.state_json)) : undefined
  }

  list(): TravelState[] {
    const states = (
      this.config.database
        .prepare('SELECT state_json FROM travel_states ORDER BY updated_at, session_id')
        .all() as Array<{ state_json: string }>
    ).map((row) => TravelStateSchema.parse(JSON.parse(row.state_json)))
    const groups = new Map<string, TravelState[]>()
    for (const state of states) {
      if (!state.linkedSessionGroup) continue
      const group = groups.get(state.linkedSessionGroup) ?? []
      group.push(state)
      groups.set(state.linkedSessionGroup, group)
    }
    const visibleGroups = new Set(
      [...groups.entries()]
        .filter(([, group]) => {
          const indexes = group
            .map((state) => state.splitIndex)
            .filter((value): value is number => value !== null)
            .sort((a, b) => a - b)
          return indexes.length >= 2 && indexes.every((value, index) => value === index + 1)
        })
        .map(([groupId]) => groupId)
    )
    return states.filter(
      (state) => !state.linkedSessionGroup || visibleGroups.has(state.linkedSessionGroup)
    )
  }

  async rebuildSession(sessionId: string): Promise<TravelState | undefined> {
    const events = await this.eventLog.read(sessionId)
    let snapshot = await this.eventLog.readSnapshot(sessionId)
    if (snapshot) {
      const prefix = events.slice(0, snapshot.seq)
      let snapshotState: TravelState | undefined
      for (const event of snapshot.events) snapshotState = reduceTravelState(snapshotState, event)
      if (
        snapshot.seq > events.length ||
        JSON.stringify(prefix) !== JSON.stringify(snapshot.events) ||
        JSON.stringify(snapshotState) !== JSON.stringify(snapshot.state)
      ) {
        this.config.warn?.(`会话 ${sessionId} 的快照与 JSONL 不一致，已回退全量重放。`)
        snapshot = null
      }
    }
    let state: TravelState | undefined
    const rebuild = this.config.database.transaction(() => {
      this.config.database.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId)
      const prefix = snapshot?.events ?? []
      for (const event of prefix) {
        state = reduceTravelState(state, event)
        this.writeState(event, state)
      }
      if (snapshot) state = snapshot.state
      for (const event of events.slice(snapshot?.seq ?? 0)) {
        state = reduceTravelState(state, event)
        this.writeState(event, state)
      }
    })
    rebuild()
    if (state && state.lastSeq !== events.at(-1)?.seq) {
      throw new AppError('EVENT_SEQUENCE_GAP', `会话 ${sessionId} 重建后的最终序号不一致。`)
    }
    return state
  }

  async rebuildGroupAtomically(sessionIds: string[]): Promise<TravelState[]> {
    const uniqueIds = [...new Set(sessionIds)]
    const eventSets = await Promise.all(uniqueIds.map((sessionId) => this.eventLog.read(sessionId)))
    const states = eventSets.map((events, index) => {
      let state: TravelState | undefined
      for (const event of events) state = reduceTravelState(state, event)
      if (!state) {
        throw new AppError(
          'INTERNAL_INVARIANT_VIOLATED',
          `拆分会话 ${uniqueIds[index]} 没有创建事件。`
        )
      }
      return state
    })

    const rebuild = this.config.database.transaction(() => {
      for (const sessionId of uniqueIds) {
        this.config.database.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId)
      }
      for (const events of eventSets) {
        let state: TravelState | undefined
        for (const event of events) {
          state = reduceTravelState(state, event)
          this.writeState(event, state)
        }
      }
      for (const state of states) this.writeProvisionalHandoffs(state)
    })
    rebuild()
    return states
  }

  async rebuildAll(): Promise<void> {
    let entries
    try {
      entries = await readdir(this.config.paths.sessions, { withFileTypes: true })
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
      throw error
    }
    for (const entry of entries) {
      if (entry.isDirectory()) await this.rebuildSession(entry.name)
    }
  }

  private writeProvisionalHandoffs(state: TravelState): void {
    if (!state.basics || state.handoffs.length === 0) return
    const dates = skeletonBoundaryDates(state.basics.dates)
    const intensity =
      state.basics.intensity === 'RELAXED'
        ? 'LOW'
        : state.basics.intensity === 'INTENSIVE'
          ? 'HIGH'
          : 'MEDIUM'
    const note = state.handoffs.join('；')
    this.config.database
      .prepare(
        `INSERT INTO day_skeletons(
           session_id, date, day_type, intensity, morning_json, afternoon_json,
           evening_json, meal_anchors_json
         ) VALUES (?, ?, 'ARRIVAL_DAY', ?, ?, NULL, NULL, NULL)
         ON CONFLICT(session_id, date) DO UPDATE SET morning_json=excluded.morning_json`
      )
      .run(
        state.sessionId,
        dates.first,
        intensity,
        JSON.stringify({ provisional: true, kind: 'HANDOFF', position: 'START', note })
      )
    this.config.database
      .prepare(
        `INSERT INTO day_skeletons(
           session_id, date, day_type, intensity, morning_json, afternoon_json,
           evening_json, meal_anchors_json
         ) VALUES (?, ?, 'DEPARTURE_DAY', ?, NULL, NULL, ?, NULL)
         ON CONFLICT(session_id, date) DO UPDATE SET evening_json=excluded.evening_json`
      )
      .run(
        state.sessionId,
        dates.last,
        intensity,
        JSON.stringify({ provisional: true, kind: 'HANDOFF', position: 'END', note })
      )
  }
}

function writeAllRouteNodeResearchProjections(
  database: Database.Database,
  state: TravelState
): void {
  for (const nodeState of state.routeNodeResearchStates) {
    writeRouteNodeResearchProjection(database, state, nodeState.scope)
  }
}

function hasRouteNodeResearchProjectionTables(database: Database.Database): boolean {
  return Boolean(
    database
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='route_node_research_states'"
      )
      .get()
  )
}

function writeRouteNodeResearchProjection(
  database: Database.Database,
  state: TravelState,
  scope: RouteNodeResearchScope
): void {
  const nodeState = state.routeNodeResearchStates.find(
    (item) => item.scope.routeId === scope.routeId && item.scope.nodeId === scope.nodeId
  )
  if (!nodeState) throw new AppError('EVENT_INVALID', '缺少节点研究投影状态。')
  database
    .prepare(
      `INSERT INTO route_node_research_states(
         session_id, route_id, node_id, sequence, required, status,
         blocker_count, entity_count, confirmed_at, skip_reason, detail_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, route_id, node_id) DO UPDATE SET
         sequence=excluded.sequence,
         required=excluded.required,
         status=excluded.status,
         blocker_count=excluded.blocker_count,
         entity_count=excluded.entity_count,
         confirmed_at=excluded.confirmed_at,
         skip_reason=excluded.skip_reason,
         detail_json=excluded.detail_json`
    )
    .run(
      state.sessionId,
      scope.routeId,
      scope.nodeId,
      nodeState.sequence,
      Number(nodeState.required),
      nodeState.status,
      nodeState.blockingReasons.length,
      nodeState.researchEntities.length,
      nodeState.confirmedAt,
      nodeState.skipReason,
      JSON.stringify(nodeState)
    )
  database
    .prepare(
      `DELETE FROM route_node_research_entities
       WHERE session_id = ? AND route_id = ? AND node_id = ?`
    )
    .run(state.sessionId, scope.routeId, scope.nodeId)
  database
    .prepare(
      `DELETE FROM route_node_research_conflicts
       WHERE session_id = ? AND route_id = ? AND node_id = ?`
    )
    .run(state.sessionId, scope.routeId, scope.nodeId)
  database
    .prepare(
      `DELETE FROM route_node_research_outcomes
       WHERE session_id = ? AND route_id = ? AND node_id = ?`
    )
    .run(state.sessionId, scope.routeId, scope.nodeId)

  const insertEntity = database.prepare(
    `INSERT INTO route_node_research_entities(
       session_id, route_id, node_id, entity_id, destination_city, kind, disposition, detail_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const insertLink = database.prepare(
    `INSERT INTO route_node_research_claim_links(
       session_id, route_id, node_id, entity_id, claim_id
     ) VALUES (?, ?, ?, ?, ?)`
  )
  for (const entity of nodeState.researchEntities) {
    insertEntity.run(
      state.sessionId,
      scope.routeId,
      scope.nodeId,
      entity.entityId,
      entity.destinationCity,
      entity.kind,
      entity.disposition,
      JSON.stringify(entity)
    )
    for (const claimId of entity.claimIds) {
      insertLink.run(state.sessionId, scope.routeId, scope.nodeId, entity.entityId, claimId)
    }
  }
  const insertConflict = database.prepare(
    `INSERT INTO route_node_research_conflicts(
       session_id, route_id, node_id, subject, predicate, detail_json
     ) VALUES (?, ?, ?, ?, ?, ?)`
  )
  for (const conflict of nodeState.conflictResolutions) {
    insertConflict.run(
      state.sessionId,
      scope.routeId,
      scope.nodeId,
      conflict.subject,
      conflict.predicate,
      JSON.stringify(conflict)
    )
  }
  const insertOutcome = database.prepare(
    `INSERT INTO route_node_research_outcomes(
       session_id, route_id, node_id, outcome_key, source_id, detail_json
     ) VALUES (?, ?, ?, ?, ?, ?)`
  )
  for (const [index, outcome] of nodeState.sourceResearchFailures.entries()) {
    const outcomeKey = `${outcome.sourceId}:${outcome.queryKind ?? 'NONE'}:${index}`
    insertOutcome.run(
      state.sessionId,
      scope.routeId,
      scope.nodeId,
      outcomeKey,
      outcome.sourceId,
      JSON.stringify(outcome)
    )
  }
}

function hasRouteD5ProjectionTables(database: Database.Database): boolean {
  return Boolean(
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='route_d5_leg_states'")
      .get()
  )
}

function writeAllRouteD5Projections(database: Database.Database, state: TravelState): void {
  if (!state.selectedRouteId) return
  for (const legState of state.routeD5LegStates) {
    database
      .prepare(
        `INSERT INTO route_d5_leg_states(
           session_id, route_id, leg_id, sequence, status, source_outcome, detail_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, route_id, leg_id) DO UPDATE SET
           sequence=excluded.sequence,
           status=excluded.status,
           source_outcome=excluded.source_outcome,
           detail_json=excluded.detail_json`
      )
      .run(
        state.sessionId,
        legState.scope.routeId,
        legState.scope.legId,
        legState.sequence,
        legState.status,
        legState.sourceOutcome,
        JSON.stringify(legState)
      )
    database
      .prepare(
        'DELETE FROM route_d5_rail_options WHERE session_id = ? AND route_id = ? AND leg_id = ?'
      )
      .run(state.sessionId, legState.scope.routeId, legState.scope.legId)
    const insertOption = database.prepare(
      `INSERT INTO route_d5_rail_options(
         session_id, route_id, leg_id, service_date, train_no, direction, is_selected, detail_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const option of legState.railOptions) {
      insertOption.run(
        state.sessionId,
        legState.scope.routeId,
        legState.scope.legId,
        option.serviceDate,
        option.trainNo,
        option.direction,
        Number(legState.selectedRailOption?.trainNo === option.trainNo),
        JSON.stringify(option)
      )
    }
    database
      .prepare(
        'DELETE FROM route_d5_leg_anchors WHERE session_id = ? AND route_id = ? AND leg_id = ?'
      )
      .run(state.sessionId, legState.scope.routeId, legState.scope.legId)
    const insertAnchor = database.prepare(
      `INSERT INTO route_d5_leg_anchors(session_id, route_id, leg_id, kind, detail_json)
       VALUES (?, ?, ?, ?, ?)`
    )
    for (const anchor of legState.plan?.boundaryAnchors ?? []) {
      insertAnchor.run(
        state.sessionId,
        legState.scope.routeId,
        legState.scope.legId,
        anchor.kind,
        JSON.stringify(anchor)
      )
    }
  }

  for (const stayState of state.routeD5StayStates) {
    database
      .prepare(
        `INSERT INTO route_d5_stay_states(
           session_id, route_id, node_id, segment_id, sequence, status,
           selected_candidate_id, detail_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, route_id, node_id, segment_id) DO UPDATE SET
           sequence=excluded.sequence,
           status=excluded.status,
           selected_candidate_id=excluded.selected_candidate_id,
           detail_json=excluded.detail_json`
      )
      .run(
        state.sessionId,
        stayState.scope.routeId,
        stayState.scope.nodeId,
        stayState.scope.segmentId,
        stayState.sequence,
        stayState.status,
        stayState.selectedCandidateId,
        JSON.stringify(stayState)
      )
    database
      .prepare(
        `DELETE FROM route_d5_stay_candidates
         WHERE session_id = ? AND route_id = ? AND node_id = ? AND segment_id = ?`
      )
      .run(
        state.sessionId,
        stayState.scope.routeId,
        stayState.scope.nodeId,
        stayState.scope.segmentId
      )
    const insertCandidate = database.prepare(
      `INSERT INTO route_d5_stay_candidates(
         session_id, route_id, node_id, segment_id, candidate_id,
         source_id, claim_id, is_selected, detail_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const candidate of stayState.candidates) {
      insertCandidate.run(
        state.sessionId,
        stayState.scope.routeId,
        stayState.scope.nodeId,
        stayState.scope.segmentId,
        candidate.candidateId,
        candidate.sourceId,
        candidate.claimId,
        Number(candidate.candidateId === stayState.selectedCandidateId),
        JSON.stringify(candidate)
      )
    }
    database
      .prepare(
        `DELETE FROM route_d5_stay_outcomes
         WHERE session_id = ? AND route_id = ? AND node_id = ? AND segment_id = ?`
      )
      .run(
        state.sessionId,
        stayState.scope.routeId,
        stayState.scope.nodeId,
        stayState.scope.segmentId
      )
    const insertOutcome = database.prepare(
      `INSERT INTO route_d5_stay_outcomes(
         session_id, route_id, node_id, segment_id, source_id, detail_json
       ) VALUES (?, ?, ?, ?, ?, ?)`
    )
    for (const outcome of stayState.sourceOutcomes) {
      insertOutcome.run(
        state.sessionId,
        stayState.scope.routeId,
        stayState.scope.nodeId,
        stayState.scope.segmentId,
        outcome.sourceId,
        JSON.stringify(outcome)
      )
    }
  }

  database
    .prepare('DELETE FROM route_d5_day_skeletons WHERE session_id = ? AND route_id = ?')
    .run(state.sessionId, state.selectedRouteId)
  const insertDay = database.prepare(
    `INSERT INTO route_d5_day_skeletons(
       session_id, route_id, date, day_type, owning_node_id, segment_id, route_leg_id, detail_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const day of state.routeDaySkeletons) {
    insertDay.run(
      state.sessionId,
      day.routeId,
      day.date,
      day.dayType,
      day.owningNodeId,
      day.segmentId,
      day.routeLegId,
      JSON.stringify(day)
    )
  }
  if (!state.routeD5Confirmed) {
    database.prepare('DELETE FROM route_d5_confirmations WHERE session_id = ?').run(state.sessionId)
  }
}

function writeTimelineProjection(
  database: Database.Database,
  sessionId: string,
  timeline: TravelState['timelineVersions'][number]
): void {
  database
    .prepare('UPDATE timeline_versions SET is_current = 0 WHERE session_id = ?')
    .run(sessionId)
  database
    .prepare(
      `INSERT INTO timeline_versions(session_id, version, created_at, summary, is_current, route_id)
       VALUES (?, ?, ?, ?, 1, ?)`
    )
    .run(
      sessionId,
      timeline.version,
      timeline.createdAt,
      timeline.summary,
      timeline.routeId ?? null
    )
  const insertItem = database.prepare(
    `INSERT INTO timeline_items(
       item_id, session_id, version, date, start_time, end_time, title,
       item_class, anchor_class, location_json, transport_json,
       buffer_minutes, cost_cents, claim_ids, route_id, node_id, segment_id,
       route_leg_id, route_context_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const item of timeline.items) {
    insertItem.run(
      item.itemId,
      sessionId,
      timeline.version,
      item.date,
      item.startTime,
      item.endTime,
      item.title,
      item.itemClass,
      item.anchorClass,
      JSON.stringify(item.location),
      item.arrivalTransport ? JSON.stringify(item.arrivalTransport) : null,
      item.bufferMinutes,
      item.costCents,
      JSON.stringify(item.claimIds),
      item.routeContext?.routeId ?? null,
      item.routeContext?.nodeId ?? null,
      item.routeContext?.segmentId ?? null,
      item.routeContext?.routeLegId ?? null,
      item.routeContext ? JSON.stringify(item.routeContext) : null
    )
  }
  database
    .prepare(
      `INSERT INTO decision_logs(
         decision_id, session_id, created_at, topic, chosen_json,
         rejected_json, rationale, claim_ids
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      timeline.decision.decisionId,
      sessionId,
      timeline.createdAt,
      timeline.decision.category,
      JSON.stringify(timeline.decision.selected),
      JSON.stringify(timeline.decision.alternatives),
      timeline.decision.reason,
      JSON.stringify(timeline.decision.claimIds)
    )
}

function skeletonBoundaryDates(dates: DateIntent): {
  first: string
  last: string
} {
  if (dates.kind === 'FIXED') return { first: dates.startDate, last: dates.endDate }
  const first = `${dates.month}-01`
  const value = new Date(`${first}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + dates.durationDays - 1)
  return { first, last: value.toISOString().slice(0, 10) }
}

declare module 'cordis' {
  interface Context {
    travelState: TravelStateService
  }
  interface Events<C extends Context = Context> {
    'event/appended'(this: C, event: SessionEvent): void
    'travel/state-updated'(this: C, sessionId: string, changedPaths: string[]): void
    'evidence/claim-added'(
      this: C,
      sessionId: string,
      claimId: string,
      verificationStatus: string
    ): void
  }
}

export const travelStatePlugin: Plugin.Function<Context, TravelStateConfig> = (ctx, config) => {
  ctx.set('travelState', new TravelStateService(ctx, ctx.eventLog, config))
}

travelStatePlugin.inject = ['eventLog']
