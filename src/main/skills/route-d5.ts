import { AppError } from '../../shared/errors'
import {
  BoundaryAnchorSchema,
  type BoundaryAnchor,
  type TransportLeg
} from '../../shared/schema/d5'
import type { EvidenceClaim, JsonValue } from '../../shared/schema/evidence'
import type { RouteCandidate, RouteLeg } from '../../shared/schema/itinerary'
import {
  MultiSegmentD5SnapshotSchema,
  RouteD5LegPlanSchema,
  RouteD5LegStateSchema,
  RouteD5StayStateSchema,
  RouteDaySkeletonSchema,
  type MultiSegmentD5Snapshot,
  type RouteD5LegPlan,
  type RouteD5LegState,
  type RouteD5StayState,
  type RouteDaySkeleton
} from '../../shared/schema/route-d5'
import type { TravelState } from '../../shared/schema/travel-state'
import { clusterItemsWithinEightKm, slotItemsWithinEightKm } from './s07-skeleton'

type JsonRecord = Record<string, JsonValue>

export function initializeRouteD5LegStates(
  sessionId: string,
  candidate: RouteCandidate
): RouteD5LegState[] {
  return candidate.legs.map((routeLeg, index) =>
    RouteD5LegStateSchema.parse({
      scope: { kind: 'LEG', sessionId, routeId: candidate.routeId, legId: routeLeg.legId },
      sequence: index + 1,
      routeLeg,
      status: 'NOT_STARTED',
      railOptions: [],
      selectedRailOption: null,
      selectionClaimIds: [],
      plan: null,
      sourceOutcome: 'NOT_RUN',
      blockingReasons: initialLegBlockers(routeLeg)
    })
  )
}

export function initializeRouteD5StayStates(
  sessionId: string,
  candidate: RouteCandidate
): RouteD5StayState[] {
  return candidate.staySegments.map((segment, index) =>
    RouteD5StayStateSchema.parse({
      scope: {
        kind: 'STAY',
        sessionId,
        routeId: candidate.routeId,
        nodeId: segment.nodeId,
        segmentId: segment.segmentId
      },
      sequence: index + 1,
      segment,
      status: 'NOT_STARTED',
      candidates: [],
      selectedCandidateId: null,
      sourceOutcomes: [],
      blockingReasons: []
    })
  )
}

export function buildRouteD5Snapshot(state: TravelState): MultiSegmentD5Snapshot {
  const selectedRoute = selectedRouteCandidate(state)
  const legStates =
    state.routeD5LegStates.length > 0
      ? state.routeD5LegStates
      : initializeRouteD5LegStates(state.sessionId, selectedRoute)
  const stayStates =
    state.routeD5StayStates.length > 0
      ? state.routeD5StayStates
      : initializeRouteD5StayStates(state.sessionId, selectedRoute)
  const nextLeg = legStates.find((item) => item.status !== 'READY')
  const nextStay = stayStates.find((item) => item.status !== 'SELECTED')
  const blockingReasons = routeD5BlockingReasons(state, selectedRoute, legStates, stayStates)
  return MultiSegmentD5SnapshotSchema.parse({
    sessionId: state.sessionId,
    stage: state.stage,
    selectedRouteId: selectedRoute.routeId,
    selectedRoute,
    legStates,
    stayStates,
    days: state.routeDaySkeletons,
    nextRequiredWorkItem: nextLeg
      ? { kind: 'LEG', legId: nextLeg.scope.legId }
      : nextStay
        ? { kind: 'STAY', nodeId: nextStay.scope.nodeId, segmentId: nextStay.scope.segmentId }
        : null,
    blockingReasons,
    confirmed: state.routeD5Confirmed
  })
}

export function buildRailLegPlan(
  legState: RouteD5LegState,
  claims: EvidenceClaim[]
): RouteD5LegPlan {
  const selectionClaims = claims.filter((claim) =>
    legState.selectionClaimIds.includes(claim.claimId)
  )
  const railClaim = selectionClaims.find((claim) => claim.predicate === 'railJourney')
  if (!railClaim) throw new AppError('GATE_BLOCKED', '所选铁路候选尚未物化为本路段证据。')
  const transferClaims = claims.filter((claim) => {
    const value = asRecord(claim.value)
    return (
      claim.predicate === 'groundTransfer' &&
      text(value?.candidateId) === legCandidateId(legState.routeLeg)
    )
  })
  const firstClaim = transferClaims.find(
    (claim) => text(asRecord(claim.value)?.kind) === 'FIRST_MILE'
  )
  const lastClaim = transferClaims.find(
    (claim) => text(asRecord(claim.value)?.kind) === 'LAST_MILE'
  )
  if (!firstClaim || !lastClaim) {
    throw new AppError('GATE_BLOCKED', '本路段尚缺首段或末段接驳证据。')
  }
  const railValue = requireRecord(railClaim.value, '铁路证据值无效。')
  const first = transportLeg(
    'FIRST_MILE',
    firstClaim,
    requireRecord(firstClaim.value, '首段接驳证据值无效。')
  )
  const wait = transportLeg('WAIT', railClaim, {
    ...railValue,
    label: `${legState.routeLeg.fromCity} 候车缓冲`,
    from: first.to,
    to: text(railValue.from) ?? legState.routeLeg.fromCity,
    durationMinutes: number(railValue.waitMinutes) ?? 45,
    costCents: 0
  })
  const intercity = transportLeg('INTERCITY', railClaim, railValue)
  const last = transportLeg(
    'LAST_MILE',
    lastClaim,
    requireRecord(lastClaim.value, '末段接驳证据值无效。')
  )
  return parseLegPlan([first, wait, intercity, last])
}

export function buildManualLegPlan(routeLeg: RouteLeg, claim: EvidenceClaim): RouteD5LegPlan {
  assertManualLegClaim(routeLeg, claim)
  const value = requireRecord(claim.value, '人工交通证据值无效。')
  const startAt = text(value.startAt)
  const endAt = text(value.endAt)
  if (!startAt || !endAt) {
    throw new AppError('GATE_BLOCKED', '人工交通证据必须包含带时区的 startAt 与 endAt。')
  }
  const sourceId =
    claim.sourceId === 'SRC_RAIL' || claim.sourceId === 'SRC_MAP' ? claim.sourceId : null
  const empty = (
    kind: TransportLeg['kind'],
    label: string,
    from: string,
    to: string
  ): TransportLeg => ({
    kind,
    label,
    from,
    to,
    startAt: kind === 'FIRST_MILE' ? startAt : kind === 'LAST_MILE' ? endAt : null,
    endAt: kind === 'FIRST_MILE' ? startAt : kind === 'LAST_MILE' ? endAt : null,
    durationMinutes: 0,
    costCents: null,
    sourceId,
    claimIds: [claim.claimId],
    verificationStatus: claim.verificationStatus
  })
  const intercity: TransportLeg = {
    kind: 'INTERCITY',
    label: text(value.label) ?? routeLeg.label,
    from: routeLeg.fromCity,
    to: routeLeg.toCity,
    startAt,
    endAt,
    durationMinutes: number(value.durationMinutes) ?? minutesBetween(startAt, endAt),
    costCents: number(value.costCents),
    sourceId,
    claimIds: [claim.claimId],
    verificationStatus: claim.verificationStatus
  }
  return parseLegPlan([
    empty('FIRST_MILE', '首段接驳包含在人工证据中', routeLeg.fromCity, routeLeg.fromCity),
    empty('WAIT', '候机/候车缓冲包含在人工证据中', routeLeg.fromCity, routeLeg.fromCity),
    intercity,
    empty('LAST_MILE', '末段接驳包含在人工证据中', routeLeg.toCity, routeLeg.toCity)
  ])
}

export function assertManualLegClaim(routeLeg: RouteLeg, claim: EvidenceClaim): void {
  const value = requireRecord(claim.value, '人工交通证据值无效。')
  const allowedPredicate = [
    'routeLeg',
    'transportJourney',
    'flightJourney',
    'coachJourney'
  ].includes(claim.predicate)
  const allowedSource =
    claim.sourceId === 'USER_PASTE' ||
    claim.sourceId === 'USER_RESEARCH' ||
    claim.verificationStatus === 'VERIFIED' ||
    claim.verificationStatus === 'CORROBORATED' ||
    claim.verificationStatus === 'VERIFIED_BY_USER'
  if (
    !allowedPredicate ||
    !allowedSource ||
    normalize(text(value.fromCity)) !== normalize(routeLeg.fromCity) ||
    normalize(text(value.toCity)) !== normalize(routeLeg.toCity) ||
    text(value.travelDate) !== routeLeg.travelDate ||
    text(value.mode) !== routeLeg.mode
  ) {
    throw new AppError(
      'INPUT_INVALID',
      '人工交通证据与目标 routeId/legId 的端点、日期或方式不一致。'
    )
  }
}

export function buildRouteDaySkeletons(
  state: TravelState,
  claims: EvidenceClaim[] = []
): RouteDaySkeleton[] {
  const route = selectedRouteCandidate(state)
  const goal = state.itineraryGoal
  if (!goal) throw new AppError('GATE_BLOCKED', '缺少已冻结的多城市总目标。')
  if (state.routeD5LegStates.some((item) => item.status !== 'READY')) {
    throw new AppError('GATE_BLOCKED', '所有跨城路段完成后才能生成整条路线的日级骨架。')
  }
  const dates = dateRange(goal.startDate, goal.endDate)
  const assignments = attractionAssignments(state, route, dates, claims)
  return dates.map((date) => {
    const routeLegs = route.legs.filter((leg) => leg.travelDate === date)
    if (routeLegs.length > 0) {
      const firstRouteLeg = routeLegs[0]!
      const lastRouteLeg = routeLegs.at(-1)!
      const firstPlan = state.routeD5LegStates.find(
        (item) => item.scope.legId === firstRouteLeg.legId
      )?.plan
      const lastPlan = state.routeD5LegStates.find(
        (item) => item.scope.legId === lastRouteLeg.legId
      )?.plan
      const anchors = [
        firstPlan?.boundaryAnchors.find((anchor) => anchor.kind === 'DEPARTURE'),
        lastPlan?.boundaryAnchors.find((anchor) => anchor.kind === 'ARRIVAL')
      ].filter((anchor): anchor is BoundaryAnchor => Boolean(anchor))
      return RouteDaySkeletonSchema.parse({
        sessionId: state.sessionId,
        routeId: route.routeId,
        date,
        dayType: 'INTERCITY_TRANSFER_DAY',
        owningNodeId: lastRouteLeg.to.kind === 'NODE' ? lastRouteLeg.to.nodeId : null,
        segmentId: null,
        routeLegId: firstRouteLeg.legId,
        routeLegIds: routeLegs.map((routeLeg) => routeLeg.legId),
        fromNodeId: firstRouteLeg.from.kind === 'NODE' ? firstRouteLeg.from.nodeId : null,
        toNodeId: lastRouteLeg.to.kind === 'NODE' ? lastRouteLeg.to.nodeId : null,
        intensity: intensity(state),
        attractionEntityIds: [],
        boundaryAnchors: anchors,
        notes: [
          `${firstRouteLeg.fromCity} → ${lastRouteLeg.toCity}，含 ${routeLegs.length} 个路段，当天不混排跨城景点。`
        ]
      })
    }
    const segment = route.staySegments.find((item) => item.nightDates.includes(date))
    if (!segment) {
      throw new AppError('GATE_BLOCKED', `${date} 既不属于跨城路段，也没有唯一住宿段归属。`)
    }
    const node = route.nodes.find((item) => item.nodeId === segment.nodeId)
    if (!node) throw new AppError('INTERNAL_INVARIANT_VIOLATED', '住宿段缺少路线节点。')
    return RouteDaySkeletonSchema.parse({
      sessionId: state.sessionId,
      routeId: route.routeId,
      date,
      dayType: date === segment.checkInDate ? 'ARRIVAL_DAY' : 'NORMAL_DAY',
      owningNodeId: node.nodeId,
      segmentId: segment.segmentId,
      routeLegId: null,
      routeLegIds: [],
      fromNodeId: null,
      toNodeId: null,
      intensity: intensity(state),
      attractionEntityIds: assignments.get(date) ?? [],
      boundaryAnchors: [],
      notes: [`${node.city} 节点内安排；住宿段 ${segment.checkInDate}–${segment.checkOutDate}。`]
    })
  })
}

export function patchRouteDaySkeleton(
  state: TravelState,
  date: string,
  attractionEntityIds: string[],
  claims: EvidenceClaim[] = []
): RouteDaySkeleton[] {
  const day = state.routeDaySkeletons.find((item) => item.date === date)
  if (!day) throw new AppError('INPUT_INVALID', '目标日期不属于当前路线骨架。')
  if (day.dayType === 'INTERCITY_TRANSFER_DAY') {
    throw new AppError('INPUT_INVALID', '跨城转移日不能加入景点。')
  }
  const nodeState = state.routeNodeResearchStates.find(
    (item) => item.scope.nodeId === day.owningNodeId && item.scope.routeId === day.routeId
  )
  const allowed = new Set(
    (nodeState?.researchEntities ?? [])
      .filter((entity) => entity.disposition !== 'EXCLUDE' && entity.fitness.status !== 'EXCLUDED')
      .map((entity) => entity.entityId)
  )
  if (
    new Set(attractionEntityIds).size !== attractionEntityIds.length ||
    attractionEntityIds.some((id) => !allowed.has(id))
  ) {
    throw new AppError('INPUT_INVALID', '骨架 patch 含有重复或跨节点景点。')
  }
  const located = attractionEntityIds.map((entityId) => {
    const entity = nodeState?.researchEntities.find((item) => item.entityId === entityId)
    const coordinates = entity ? entityCoordinates(entity.claimIds, claims) : null
    if (!coordinates) {
      throw new AppError('GATE_BLOCKED', `景点 ${entityId} 缺少 coordinates 证据。`)
    }
    return { entityId, coordinates }
  })
  if (!slotItemsWithinEightKm(located)) {
    throw new AppError('GATE_BLOCKED', '目标日景点两两距离超过 8 km，请拆到不同日期。')
  }
  return state.routeDaySkeletons.map((item) =>
    item.date === date ? RouteDaySkeletonSchema.parse({ ...item, attractionEntityIds }) : item
  )
}

export function legCandidateId(routeLeg: RouteLeg): string {
  return `route-d5:${routeLeg.routeId}:${routeLeg.legId}`
}

export function selectedRouteCandidate(state: TravelState): RouteCandidate {
  if (!state.selectedRouteId) throw new AppError('GATE_BLOCKED', '尚未选择多城市路线。')
  const route = state.routeCandidates.find((item) => item.routeId === state.selectedRouteId)
  if (!route) throw new AppError('GATE_BLOCKED', '已选路线已经失效。')
  return route
}

function routeD5BlockingReasons(
  state: TravelState,
  route: RouteCandidate,
  legStates: RouteD5LegState[],
  stayStates: RouteD5StayState[]
): string[] {
  const reasons = [
    ...legStates.flatMap((item) =>
      item.status === 'READY' ? [] : [`路段 ${item.routeLeg.label} 尚未完成：${item.status}`]
    ),
    ...stayStates.flatMap((item) =>
      item.status === 'SELECTED' ? [] : [`住宿段 ${item.segment.city} 尚未选择：${item.status}`]
    )
  ]
  const expectedDays = state.itineraryGoal?.totalDays ?? 0
  if (state.routeDaySkeletons.length !== expectedDays)
    reasons.push('路线日级骨架尚未覆盖完整日期。')
  if (state.routeDaySkeletons.some((day) => day.routeId !== route.routeId)) {
    reasons.push('路线日级骨架与当前已选路线不一致。')
  }
  return reasons
}

function initialLegBlockers(routeLeg: RouteLeg): string[] {
  if (routeLeg.mode === 'RAIL') return []
  if (routeLeg.mode === 'MANUAL_FLIGHT' || routeLeg.mode === 'MANUAL_COACH') {
    return ['该交通方式没有自动来源；请关联与本路段端点、日期和方式完全一致的已有/用户证据。']
  }
  return ['当前 D5 不支持自动执行该交通方式。']
}

function transportLeg(
  kind: TransportLeg['kind'],
  claim: EvidenceClaim,
  value: JsonRecord
): TransportLeg {
  const startAt = text(value.startAt)
  const endAt = text(value.endAt)
  const durationSeconds = number(value.durationSeconds)
  return {
    kind,
    label: text(value.label) ?? kind,
    from: text(value.from) ?? '未知起点',
    to: text(value.to) ?? '未知终点',
    startAt,
    endAt:
      endAt ?? (startAt && durationSeconds !== null ? addSeconds(startAt, durationSeconds) : null),
    durationMinutes: number(value.durationMinutes) ?? 0,
    costCents: number(value.costCents),
    sourceId: claim.sourceId === 'SRC_RAIL' || claim.sourceId === 'SRC_MAP' ? claim.sourceId : null,
    claimIds: [claim.claimId],
    verificationStatus: claim.verificationStatus
  }
}

function parseLegPlan(
  legs: [TransportLeg, TransportLeg, TransportLeg, TransportLeg]
): RouteD5LegPlan {
  const startAt = legs[0].startAt ?? legs[2].startAt
  const endAt = legs[3].endAt ?? legs[2].endAt
  if (!startAt || !endAt) throw new AppError('GATE_BLOCKED', '路段计划缺少带时区的出发或抵达时间。')
  const costs = legs.map((item) => item.costCents)
  const costComplete = costs.every((item) => item !== null)
  return RouteD5LegPlanSchema.parse({
    legs,
    boundaryAnchors: [
      anchor(
        'DEPARTURE',
        startAt,
        legs[0].from,
        usableBefore(startAt),
        legs.flatMap((item) => item.claimIds)
      ),
      anchor(
        'ARRIVAL',
        endAt,
        legs[3].to,
        usableAfter(endAt),
        legs.flatMap((item) => item.claimIds)
      )
    ],
    totalDurationMinutes: legs.reduce((sum, item) => sum + item.durationMinutes, 0),
    totalCostCents: costComplete ? costs.reduce<number>((sum, item) => sum + (item ?? 0), 0) : null,
    costComplete
  })
}

function anchor(
  kind: BoundaryAnchor['kind'],
  at: string,
  location: string,
  usableMinutes: number,
  claimIds: string[]
): BoundaryAnchor {
  return BoundaryAnchorSchema.parse({
    kind,
    date: at.slice(0, 10),
    time: at.slice(11, 16),
    at,
    location,
    usableMinutes,
    anchorClass: 'HARD_LOCKED',
    claimIds: [...new Set(claimIds)]
  })
}

function attractionAssignments(
  state: TravelState,
  route: RouteCandidate,
  dates: string[],
  claims: EvidenceClaim[]
): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const nodeState of state.routeNodeResearchStates) {
    if (nodeState.scope.routeId !== route.routeId || nodeState.status !== 'CONFIRMED') continue
    const segment = route.staySegments.find((item) => item.nodeId === nodeState.scope.nodeId)
    if (!segment) continue
    const available = dates.filter(
      (date) =>
        segment.nightDates.includes(date) && !route.legs.some((leg) => leg.travelDate === date)
    )
    if (available.length === 0) continue
    const located = nodeState.researchEntities.flatMap((entity) => {
      if (entity.disposition === 'EXCLUDE' || entity.fitness.status === 'EXCLUDED') return []
      const coordinates = entityCoordinates(entity.claimIds, claims)
      return coordinates ? [{ entityId: entity.entityId, coordinates }] : []
    })
    const clusters = clusterItemsWithinEightKm(located)
    if (clusters.length > available.length) {
      throw new AppError('GATE_BLOCKED', `${nodeState.scope.city} 的 8 km 景点分组超过可用日期。`, {
        userHint: `请减少 ${nodeState.scope.city} 项目或调整路线停留天数。`
      })
    }
    clusters.forEach((cluster, index) => {
      result.set(
        available[index]!,
        cluster.slice(0, 8).map((item) => item.entityId)
      )
    })
  }
  return result
}

function entityCoordinates(
  claimIds: string[],
  claims: EvidenceClaim[]
): { lng: number; lat: number } | null {
  const claim = claims.find(
    (item) => claimIds.includes(item.claimId) && item.predicate === 'coordinates'
  )
  const value = claim ? asRecord(claim.value) : null
  const lng = value?.lng
  const lat = value?.lat
  return typeof lng === 'number' &&
    Number.isFinite(lng) &&
    typeof lat === 'number' &&
    Number.isFinite(lat)
    ? { lng, lat }
    : null
}

function dateRange(start: string, end: string): string[] {
  const result: string[] = []
  for (let date = start; date <= end; date = addDays(date, 1)) result.push(date)
  return result
}

function intensity(state: TravelState): 'LOW' | 'MEDIUM' | 'HIGH' {
  return state.basics?.intensity === 'RELAXED'
    ? 'LOW'
    : state.basics?.intensity === 'INTENSIVE'
      ? 'HIGH'
      : 'MEDIUM'
}

function asRecord(value: JsonValue): JsonRecord | null {
  return value !== null && !Array.isArray(value) && typeof value === 'object' ? value : null
}

function requireRecord(value: JsonValue, message: string): JsonRecord {
  const result = asRecord(value)
  if (!result) throw new AppError('INPUT_INVALID', message)
  return result
}

function text(value: JsonValue | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function number(value: JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function normalize(value: string | null): string {
  return value?.normalize('NFKC').trim().toLowerCase() ?? ''
}

function addSeconds(value: string, seconds: number): string {
  return new Date(new Date(value).getTime() + seconds * 1000).toISOString()
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function minutesBetween(startAt: string, endAt: string): number {
  return Math.max(0, Math.round((Date.parse(endAt) - Date.parse(startAt)) / 60_000))
}

function localMinutes(value: string): number {
  const match = /T(\d{2}):(\d{2})/.exec(value)
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0
}

function usableBefore(at: string): number {
  return Math.max(0, localMinutes(at) - 8 * 60)
}

function usableAfter(at: string): number {
  return Math.max(0, 22 * 60 - localMinutes(at))
}
