import { createHash, randomUUID } from 'node:crypto'
import type { Context } from 'cordis'
import { AppError } from '../shared/errors'
import { D5SourceOutcomeSchema, type D5SourceOutcome, type StaySegment } from '../shared/schema/d5'
import { EvidenceClaimSchema, type EvidenceClaim } from '../shared/schema/evidence'
import type { RouteCandidate, RouteStaySegment } from '../shared/schema/itinerary'
import {
  RouteD5ExecuteRequestSchema,
  RouteD5LegSelectRequestSchema,
  RouteD5ManualLegRequestSchema,
  RouteD5PlanPreviewSchema,
  RouteD5PreviewRequestSchema,
  RouteD5SkeletonPatchRequestSchema,
  RouteD5SkeletonPrepareRequestSchema,
  RouteD5StayPasteRequestSchema,
  RouteD5StaySelectRequestSchema,
  type MultiSegmentD5Snapshot,
  type RouteD5ExecuteRequest,
  type RouteD5LegScope,
  type RouteD5LegState,
  type RouteD5LegSelectRequest,
  type RouteD5ManualLegRequest,
  type RouteD5PlanPreview,
  type RouteD5PreviewRequest,
  type RouteD5ProgressEvent,
  type RouteD5Scope,
  type RouteD5SkeletonPatchRequest,
  type RouteD5SkeletonPrepareRequest,
  type RouteD5StayPasteRequest,
  type RouteD5StayScope,
  type RouteD5StayState,
  type RouteD5StaySelectRequest
} from '../shared/schema/route-d5'
import type { TravelState } from '../shared/schema/travel-state'
import { deterministicClaimId } from './mcp/evidence'
import {
  assertManualLegClaim,
  buildManualLegPlan,
  buildRailLegPlan,
  buildRouteD5Snapshot,
  buildRouteDaySkeletons,
  legCandidateId,
  patchRouteDaySkeleton,
  selectedRouteCandidate
} from './skills/route-d5'
import { buildStayCandidates } from './skills/s08-lodging'

interface PendingRouteD5Plan {
  preview: RouteD5PlanPreview
  stateSeq: number
  fromAddress: string | null
  toAddress: string | null
  geocodes: Array<{
    key: 'FROM_PLACE' | 'FROM_STATION' | 'TO_STATION' | 'TO_PLACE' | 'STAY_CITY'
    address: string
    city: string
    label: string
    external: boolean
  }>
}

type ProgressListener = (progress: RouteD5ProgressEvent) => void

export class RouteD5Service {
  private readonly pendingPlans = new Map<string, PendingRouteD5Plan>()
  private readonly planExpiryDisposers = new Map<string, () => void>()
  private readonly usedOperationIds = new Set<string>()

  constructor(
    private readonly ctx: Context,
    private readonly now: () => Date = () => new Date()
  ) {}

  snapshot(sessionId: string): MultiSegmentD5Snapshot {
    return buildRouteD5Snapshot(this.requireState(sessionId))
  }

  preview(input: RouteD5PreviewRequest): RouteD5PlanPreview {
    const request = RouteD5PreviewRequestSchema.parse(input)
    const state = this.requireStage4(request.scope.sessionId)
    const pending = this.buildPendingPlan(state, request)
    this.discardExpiredAndReplacedPlans(pending.preview)
    this.storePendingPlan(pending)
    return pending.preview
  }

  async execute(
    input: RouteD5ExecuteRequest,
    onProgress?: ProgressListener
  ): Promise<MultiSegmentD5Snapshot> {
    const request = RouteD5ExecuteRequestSchema.parse(input)
    const pending = this.consumePlan(request)
    this.claimOperation(request.operationId)
    let completedCalls = 0
    const emit = (phase: RouteD5ProgressEvent['phase']): void => {
      onProgress?.({
        operationId: request.operationId,
        scope: request.scope,
        completedCalls,
        totalCalls: pending.preview.totalExternalCalls,
        phase
      })
    }
    emit('STARTED')
    try {
      const result =
        request.action === 'DISCOVER_RAIL'
          ? await this.executeRailDiscovery(request, pending, () => {
              completedCalls += 1
              emit('SOURCE')
            })
          : request.action === 'PREPARE_TRANSFERS'
            ? await this.executeTransfers(request, pending, () => {
                completedCalls += 1
                emit('SOURCE')
              })
            : await this.executeStay(request, pending, () => {
                completedCalls += 1
                emit('SOURCE')
              })
      emit('PERSISTING')
      completedCalls = pending.preview.totalExternalCalls
      emit('COMPLETED')
      return result
    } catch (error) {
      emit(error instanceof AppError && error.code === 'SOURCE_CANCELLED' ? 'CANCELLED' : 'FAILED')
      throw error
    }
  }

  async selectRail(input: RouteD5LegSelectRequest): Promise<MultiSegmentD5Snapshot> {
    const request = RouteD5LegSelectRequestSchema.parse(input)
    const state = this.requireStage4(request.scope.sessionId)
    const legState = this.requireLegState(state, request.scope)
    if (legState.routeLeg.mode !== 'RAIL') {
      throw new AppError('INPUT_INVALID', '目标路段不是铁路。')
    }
    const option = legState.railOptions.find((item) => item.trainNo === request.trainNo)
    if (!option) throw new AppError('INPUT_INVALID', '所选车次不属于当前路段候选集。')
    const outcome = await this.ctx.tools.materializeSelectedRailOption(
      { sessionId: state.sessionId, candidateId: legCandidateId(legState.routeLeg), option },
      false
    )
    await this.ctx.travelState.record({
      sessionId: state.sessionId,
      eventVersion: 2,
      type: 'route-d5/leg-selected',
      payload: {
        scope: request.scope,
        selectionKind: 'RAIL_OPTION',
        option,
        claims: outcome.claims,
        plan: null
      }
    })
    return this.snapshot(state.sessionId)
  }

  async attachManualLeg(input: RouteD5ManualLegRequest): Promise<MultiSegmentD5Snapshot> {
    const request = RouteD5ManualLegRequestSchema.parse(input)
    const state = this.requireStage4(request.scope.sessionId)
    const legState = this.requireLegState(state, request.scope)
    if (legState.routeLeg.mode !== 'MANUAL_FLIGHT' && legState.routeLeg.mode !== 'MANUAL_COACH') {
      throw new AppError('INPUT_INVALID', '只有人工航班/大巴路段可以关联人工证据。')
    }
    const evidence = this.ctx.tools.listEvidence(state.sessionId, 200)
    const claims = request.claimIds.map((claimId) => {
      const claim = evidence.find((item) => item.claimId === claimId)
      if (!claim) throw new AppError('INPUT_INVALID', `Claim ${claimId} 不属于当前会话。`)
      assertManualLegClaim(legState.routeLeg, claim)
      return claim
    })
    const plan = buildManualLegPlan(legState.routeLeg, claims[0]!)
    await this.ctx.travelState.record({
      sessionId: state.sessionId,
      eventVersion: 2,
      type: 'route-d5/leg-selected',
      payload: {
        scope: request.scope,
        selectionKind: 'MANUAL_EVIDENCE',
        option: null,
        claims,
        plan
      }
    })
    return this.snapshot(state.sessionId)
  }

  async prepareSkeleton(input: RouteD5SkeletonPrepareRequest): Promise<MultiSegmentD5Snapshot> {
    const request = RouteD5SkeletonPrepareRequestSchema.parse(input)
    const state = this.requireStage4(request.scope.sessionId)
    this.requireRouteScope(state, request.scope)
    const days = buildRouteDaySkeletons(state, this.ctx.tools.listEvidence(state.sessionId, 500))
    await this.ctx.travelState.record({
      sessionId: state.sessionId,
      eventVersion: 2,
      type: 'route-d5/skeleton-updated',
      payload: { scope: request.scope, days, changedDates: days.map((day) => day.date) }
    })
    return this.snapshot(state.sessionId)
  }

  async patchSkeleton(input: RouteD5SkeletonPatchRequest): Promise<MultiSegmentD5Snapshot> {
    const request = RouteD5SkeletonPatchRequestSchema.parse(input)
    const state = this.requireStage4(request.scope.sessionId)
    this.requireRouteScope(state, request.scope)
    const days = patchRouteDaySkeleton(
      state,
      request.date,
      request.attractionEntityIds,
      this.ctx.tools.listEvidence(state.sessionId, 500)
    )
    await this.ctx.travelState.record({
      sessionId: state.sessionId,
      eventVersion: 2,
      type: 'route-d5/skeleton-updated',
      payload: { scope: request.scope, days, changedDates: [request.date] }
    })
    return this.snapshot(state.sessionId)
  }

  async addStayPaste(input: RouteD5StayPasteRequest): Promise<MultiSegmentD5Snapshot> {
    const request = RouteD5StayPasteRequestSchema.parse(input)
    const state = this.requireStage4(request.scope.sessionId)
    const stayState = this.requireStayState(state, request.scope)
    const observedAt = this.now()
    const sourceRef = `USER_PASTE:${createHash('sha256')
      .update(JSON.stringify({ ...request, scope: request.scope }))
      .digest('hex')
      .slice(0, 24)}`
    const claim = EvidenceClaimSchema.parse({
      claimId: deterministicClaimId({
        sourceId: 'USER_PASTE',
        sourceRef,
        subject: request.name,
        predicate: 'lodgingCandidate'
      }),
      sessionId: state.sessionId,
      subject: request.name,
      predicate: 'lodgingCandidate',
      value: {
        segmentId: stayState.scope.segmentId,
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
      notes: '用户为当前 routeId/nodeId/segmentId 手工补充的住宿候选，字段保持未核验。'
    })
    const existingIds = new Set(stayState.candidates.map((candidate) => candidate.claimId))
    const claims = [
      ...this.ctx.tools
        .listEvidence(state.sessionId, 200)
        .filter((item) => existingIds.has(item.claimId)),
      claim
    ]
    const built = buildStayCandidates(asLegacyStaySegment(stayState.segment), claims)
    await this.ctx.travelState.record({
      sessionId: state.sessionId,
      eventVersion: 2,
      type: 'route-d5/stay-candidates-prepared',
      payload: {
        scope: request.scope,
        candidates: built.candidates,
        sourceOutcomes: built.sourceOutcomes,
        finalClaims: [claim]
      }
    })
    return this.snapshot(state.sessionId)
  }

  async selectStay(input: RouteD5StaySelectRequest): Promise<MultiSegmentD5Snapshot> {
    const request = RouteD5StaySelectRequestSchema.parse(input)
    const state = this.requireStage4(request.scope.sessionId)
    this.requireStayState(state, request.scope)
    await this.ctx.travelState.record({
      sessionId: state.sessionId,
      eventVersion: 2,
      type: 'route-d5/stay-selected',
      payload: { scope: request.scope, candidateId: request.candidateId }
    })
    return this.snapshot(state.sessionId)
  }

  async confirm(scope: RouteD5Scope): Promise<MultiSegmentD5Snapshot> {
    if (scope.kind !== 'ROUTE')
      throw new AppError('INPUT_INVALID', '最终确认必须使用 ROUTE scope。')
    const state = this.requireStage4(scope.sessionId)
    this.requireRouteScope(state, scope)
    const snapshot = buildRouteD5Snapshot(state)
    if (snapshot.blockingReasons.length > 0) {
      throw new AppError('GATE_BLOCKED', '多城市 D5 Gate 尚未通过。', {
        userHint: snapshot.blockingReasons[0]
      })
    }
    await this.ctx.travelState.record({
      sessionId: state.sessionId,
      eventVersion: 2,
      type: 'route-d5/confirmed',
      payload: {
        scope,
        confirmedAt: this.now().toISOString(),
        fromStage: 'STAGE_4',
        toStage: 'STAGE_5',
        confirmed: true
      }
    })
    return this.snapshot(state.sessionId)
  }

  async cancel(operationId: string): Promise<boolean> {
    this.usedOperationIds.add(operationId)
    return this.ctx.tools.cancelOperation(operationId)
  }

  private buildPendingPlan(state: TravelState, request: RouteD5PreviewRequest): PendingRouteD5Plan {
    const route = this.requireScope(state, request.scope)
    const geocodes: PendingRouteD5Plan['geocodes'] = []
    const calls: RouteD5PlanPreview['plannedCalls'] = []
    const addCall = (
      sourceId: 'SRC_RAIL' | 'SRC_MAP' | 'SRC_HOTEL',
      capability: RouteD5PlanPreview['plannedCalls'][number]['capability'],
      label: string
    ): void => {
      calls.push({ sequence: calls.length + 1, sourceId, capability, label })
    }

    if (request.action === 'DISCOVER_RAIL') {
      if (request.scope.kind !== 'LEG')
        throw new AppError('INPUT_INVALID', '铁路查询需要 LEG scope。')
      const legState = this.requireLegState(state, request.scope)
      if (legState.routeLeg.mode !== 'RAIL') {
        throw new AppError('GATE_BLOCKED', '人工航班/大巴不允许自动查询。')
      }
      addCall('SRC_RAIL', 'RAIL_DISCOVERY', `查询 ${legState.routeLeg.label} 的一次铁路候选`)
    } else if (request.action === 'PREPARE_TRANSFERS') {
      if (request.scope.kind !== 'LEG')
        throw new AppError('INPUT_INVALID', '接驳计划需要 LEG scope。')
      const legState = this.requireLegState(state, request.scope)
      const option = legState.selectedRailOption
      if (legState.routeLeg.mode !== 'RAIL' || !option) {
        throw new AppError('GATE_BLOCKED', '接驳计划需要先选择该铁路路段的车次。')
      }
      if (legState.routeLeg.from.kind === 'ORIGIN' && !request.fromAddress) {
        throw new AppError('INPUT_INVALID', '广州出发端需要本次计划专用的精确地址。')
      }
      if (legState.routeLeg.to.kind === 'ORIGIN' && !request.toAddress) {
        throw new AppError('INPUT_INVALID', '返回广州端需要本次计划专用的精确地址。')
      }
      const locations: PendingRouteD5Plan['geocodes'] = [
        {
          key: 'FROM_PLACE',
          address: request.fromAddress ?? legState.routeLeg.fromCity,
          city: legState.routeLeg.fromCity,
          label: `${legState.routeLeg.fromCity} 路段起点`,
          external: false
        },
        {
          key: 'FROM_STATION',
          address: stationAddress(option.fromStation),
          city: legState.routeLeg.fromCity,
          label: `${option.fromStation} 出发站`,
          external: false
        },
        {
          key: 'TO_STATION',
          address: stationAddress(option.toStation),
          city: legState.routeLeg.toCity,
          label: `${option.toStation} 到达站`,
          external: false
        },
        {
          key: 'TO_PLACE',
          address: request.toAddress ?? legState.routeLeg.toCity,
          city: legState.routeLeg.toCity,
          label: `${legState.routeLeg.toCity} 路段终点`,
          external: false
        }
      ]
      for (const location of locations) {
        location.external = !this.ctx.tools.hasTransientGeocode(location.address, location.city)
        geocodes.push(location)
        if (location.external) addCall('SRC_MAP', 'GEOCODE', `${location.label} 地理编码`)
      }
      addCall('SRC_MAP', 'GROUND_TRANSFER', '测量本路段首段接驳')
      addCall('SRC_MAP', 'GROUND_TRANSFER', '测量本路段末段接驳')
    } else {
      if (request.scope.kind !== 'STAY')
        throw new AppError('INPUT_INVALID', '住宿查询需要 STAY scope。')
      const stayState = this.requireStayState(state, request.scope)
      hotelAdultCount(state)
      const location = {
        key: 'STAY_CITY' as const,
        address: stayState.segment.city,
        city: stayState.segment.city,
        label: `${stayState.segment.city} 住宿区域`,
        external: !this.ctx.tools.hasTransientGeocode(
          stayState.segment.city,
          stayState.segment.city
        )
      }
      geocodes.push(location)
      if (location.external) addCall('SRC_MAP', 'GEOCODE', `${location.label} 地理编码`)
      addCall('SRC_HOTEL', 'HOTEL_SEARCH', `查询 ${stayState.segment.nights} 晚整段住宿候选`)
    }

    const expiresAt = new Date(this.now().getTime() + 10 * 60 * 1000).toISOString()
    const digest = `sha256:${createHash('sha256')
      .update(
        JSON.stringify({
          stateSeq: state.lastSeq,
          routeId: route.routeId,
          scope: request.scope,
          action: request.action,
          calls,
          fromAddress: request.fromAddress,
          toAddress: request.toAddress
        })
      )
      .digest('hex')}`
    return {
      preview: RouteD5PlanPreviewSchema.parse({
        scope: request.scope,
        action: request.action,
        planId: randomUUID(),
        digest,
        expiresAt,
        plannedCalls: calls,
        totalExternalCalls: calls.length,
        retryCount: 0,
        timeoutSeconds: 60
      }),
      stateSeq: state.lastSeq,
      fromAddress: request.fromAddress,
      toAddress: request.toAddress,
      geocodes
    }
  }

  private consumePlan(request: RouteD5ExecuteRequest): PendingRouteD5Plan {
    const pending = this.pendingPlans.get(request.planId)
    this.deletePendingPlan(request.planId)
    if (
      !pending ||
      pending.preview.digest !== request.digest ||
      pending.preview.action !== request.action ||
      JSON.stringify(pending.preview.scope) !== JSON.stringify(request.scope)
    ) {
      throw new AppError('INPUT_INVALID', 'route-D5 计划不存在、身份不匹配或已被消费。')
    }
    if (Date.parse(pending.preview.expiresAt) <= this.now().getTime()) {
      throw new AppError('INPUT_INVALID', 'route-D5 计划已过期，请重新预览。')
    }
    const state = this.requireStage4(request.scope.sessionId)
    this.requireScope(state, request.scope)
    if (state.lastSeq !== pending.stateSeq) {
      throw new AppError('INPUT_INVALID', '路线状态已变化，请重新预览本路段/住宿段计划。')
    }
    return pending
  }

  private discardExpiredAndReplacedPlans(preview: RouteD5PlanPreview): void {
    const now = this.now().getTime()
    const scope = JSON.stringify(preview.scope)
    for (const [planId, pending] of this.pendingPlans) {
      const expired = Date.parse(pending.preview.expiresAt) <= now
      const replaced =
        pending.preview.action === preview.action && JSON.stringify(pending.preview.scope) === scope
      if (expired || replaced) this.deletePendingPlan(planId)
    }
  }

  private storePendingPlan(pending: PendingRouteD5Plan): void {
    const { planId, expiresAt } = pending.preview
    this.pendingPlans.set(planId, pending)
    if (typeof this.ctx.setTimeout !== 'function') return
    const delay = Math.max(0, Date.parse(expiresAt) - this.now().getTime())
    const dispose = this.ctx.setTimeout(() => {
      this.pendingPlans.delete(planId)
      this.planExpiryDisposers.delete(planId)
    }, delay)
    this.planExpiryDisposers.set(planId, dispose)
  }

  private deletePendingPlan(planId: string): void {
    this.pendingPlans.delete(planId)
    this.planExpiryDisposers.get(planId)?.()
    this.planExpiryDisposers.delete(planId)
  }

  private claimOperation(operationId: string): void {
    if (this.usedOperationIds.has(operationId)) {
      throw new AppError('INPUT_INVALID', 'operationId 已经使用，不能跨 scope 或重复执行。')
    }
    this.usedOperationIds.add(operationId)
  }

  private async executeRailDiscovery(
    request: RouteD5ExecuteRequest,
    _pending: PendingRouteD5Plan,
    onCall: () => void
  ): Promise<MultiSegmentD5Snapshot> {
    if (request.scope.kind !== 'LEG')
      throw new AppError('INPUT_INVALID', '铁路执行需要 LEG scope。')
    const state = this.requireStage4(request.scope.sessionId)
    const legState = this.requireLegState(state, request.scope)
    const options = await this.ctx.tools.discoverRailOptions(
      {
        sessionId: state.sessionId,
        direction: legState.routeLeg.to.kind === 'ORIGIN' ? 'RETURN' : 'OUTBOUND',
        date: legState.routeLeg.travelDate,
        fromStation: legState.routeLeg.fromCity,
        toStation: legState.routeLeg.toCity
      },
      request.operationId
    )
    onCall()
    await this.ctx.travelState.record({
      sessionId: state.sessionId,
      eventVersion: 2,
      type: 'route-d5/leg-options-prepared',
      payload: { scope: request.scope, options }
    })
    return this.snapshot(state.sessionId)
  }

  private async executeTransfers(
    request: RouteD5ExecuteRequest,
    pending: PendingRouteD5Plan,
    onCall: () => void
  ): Promise<MultiSegmentD5Snapshot> {
    if (request.scope.kind !== 'LEG')
      throw new AppError('INPUT_INVALID', '接驳执行需要 LEG scope。')
    const state = this.requireStage4(request.scope.sessionId)
    const legState = this.requireLegState(state, request.scope)
    const option = legState.selectedRailOption
    if (!option) throw new AppError('GATE_BLOCKED', '当前路段尚未选择铁路候选。')
    const claims: EvidenceClaim[] = []
    const locations = new Map<PendingRouteD5Plan['geocodes'][number]['key'], string>()
    for (const location of pending.geocodes) {
      const outcome = await this.ctx.tools.materializeTransientMapGeocode(
        {
          sessionId: state.sessionId,
          address: location.address,
          city: location.city,
          label: location.label
        },
        request.operationId,
        location.external,
        false
      )
      claims.push(outcome.claim)
      locations.set(location.key, `${outcome.location.lng},${outcome.location.lat}`)
      if (location.external) onCall()
    }
    const direction = option.direction
    const candidateId = legCandidateId(legState.routeLeg)
    const first = await this.ctx.tools.materializeTimedMapGroundTransfer(
      {
        sessionId: state.sessionId,
        candidateId,
        direction,
        kind: 'FIRST_MILE',
        from: `${legState.routeLeg.fromCity} 路段起点`,
        to: option.fromStation,
        origin: requiredLocation(locations, 'FROM_PLACE'),
        destination: requiredLocation(locations, 'FROM_STATION'),
        travelMode: 'DRIVING',
        timingBasis: 'ARRIVE_BY_RAIL',
        railAnchorAt: option.startAt
      },
      request.operationId,
      false
    )
    claims.push(...first.claims)
    onCall()
    const last = await this.ctx.tools.materializeTimedMapGroundTransfer(
      {
        sessionId: state.sessionId,
        candidateId,
        direction,
        kind: 'LAST_MILE',
        from: option.toStation,
        to: `${legState.routeLeg.toCity} 路段终点`,
        origin: requiredLocation(locations, 'TO_STATION'),
        destination: requiredLocation(locations, 'TO_PLACE'),
        travelMode: 'DRIVING',
        timingBasis: 'DEPART_AFTER_RAIL',
        railAnchorAt: option.endAt
      },
      request.operationId,
      false
    )
    claims.push(...last.claims)
    onCall()
    const existing = this.ctx.tools.listEvidence(state.sessionId, 200)
    const plan = buildRailLegPlan(
      legState,
      [...existing, ...claims].filter(
        (claim, index, all) => all.findIndex((item) => item.claimId === claim.claimId) === index
      )
    )
    await this.ctx.travelState.record({
      sessionId: state.sessionId,
      eventVersion: 2,
      type: 'route-d5/leg-transfers-prepared',
      payload: { scope: request.scope, plan, finalClaims: claims }
    })
    return this.snapshot(state.sessionId)
  }

  private async executeStay(
    request: RouteD5ExecuteRequest,
    pending: PendingRouteD5Plan,
    onCall: () => void
  ): Promise<MultiSegmentD5Snapshot> {
    if (request.scope.kind !== 'STAY')
      throw new AppError('INPUT_INVALID', '住宿执行需要 STAY scope。')
    const state = this.requireStage4(request.scope.sessionId)
    const stayState = this.requireStayState(state, request.scope)
    const claims: EvidenceClaim[] = []
    for (const location of pending.geocodes) {
      const outcome = await this.ctx.tools.materializeTransientMapGeocode(
        {
          sessionId: state.sessionId,
          address: location.address,
          city: location.city,
          label: location.label
        },
        request.operationId,
        location.external,
        false
      )
      claims.push(outcome.claim)
      if (location.external) onCall()
    }
    try {
      const hotel = await this.ctx.tools.materializeHotelLodgingCandidates(
        {
          sessionId: state.sessionId,
          place: stayState.segment.city,
          checkInDate: stayState.segment.checkInDate,
          stayNights: stayState.segment.nights,
          adultCount: hotelAdultCount(state),
          size: 5
        },
        request.operationId,
        false
      )
      onCall()
      claims.push(...hotel.claims)
      if (hotel.claims.length === 0) {
        await this.ctx.travelState.record({
          sessionId: state.sessionId,
          eventVersion: 2,
          type: 'route-d5/stay-candidates-prepared',
          payload: {
            scope: request.scope,
            candidates: [],
            sourceOutcomes: emptyStayOutcomes(),
            finalClaims: claims
          }
        })
        return this.snapshot(state.sessionId)
      }
      const built = buildStayCandidates(asLegacyStaySegment(stayState.segment), hotel.claims, [
        D5SourceOutcomeSchema.parse({
          sourceId: 'SRC_HOTEL',
          status: hotel.claims.length > 0 ? 'SUCCEEDED' : 'EMPTY',
          candidateCount: hotel.claims.length,
          errorCode: null,
          capabilityImpact: hotel.claims.length > 0 ? null : '酒店来源本轮没有返回候选。',
          manualAlternative: hotel.claims.length > 0 ? null : '可为本住宿段手工补充完整报价。'
        })
      ])
      await this.ctx.travelState.record({
        sessionId: state.sessionId,
        eventVersion: 2,
        type: 'route-d5/stay-candidates-prepared',
        payload: {
          scope: request.scope,
          candidates: built.candidates,
          sourceOutcomes: built.sourceOutcomes,
          finalClaims: claims
        }
      })
    } catch (error) {
      if (error instanceof AppError && error.code === 'SOURCE_CANCELLED') throw error
      const outcomes = failedStayOutcomes(error)
      await this.ctx.travelState.record({
        sessionId: state.sessionId,
        eventVersion: 2,
        type: 'route-d5/stay-candidates-prepared',
        payload: {
          scope: request.scope,
          candidates: [],
          sourceOutcomes: outcomes,
          finalClaims: []
        }
      })
    }
    return this.snapshot(state.sessionId)
  }

  private requireState(sessionId: string): TravelState {
    const state = this.ctx.travelState.get(sessionId)
    if (!state) throw new AppError('INPUT_INVALID', '旅行会话不存在。')
    return state
  }

  private requireStage4(sessionId: string): TravelState {
    const state = this.requireState(sessionId)
    if (state.stage !== 'STAGE_4') {
      throw new AppError('GATE_BLOCKED', '多城市多段 D5 只能在 STAGE-4 执行。')
    }
    selectedRouteCandidate(state)
    return state
  }

  private requireScope(state: TravelState, scope: RouteD5Scope): RouteCandidate {
    const route = this.requireRouteScope(state, {
      kind: 'ROUTE',
      sessionId: scope.sessionId,
      routeId: scope.routeId
    })
    if (scope.kind === 'LEG') this.requireLegState(state, scope)
    if (scope.kind === 'STAY') this.requireStayState(state, scope)
    return route
  }

  private requireRouteScope(
    state: TravelState,
    scope: { kind: 'ROUTE'; sessionId: string; routeId: string }
  ): RouteCandidate {
    const route = selectedRouteCandidate(state)
    if (
      scope.sessionId !== state.sessionId ||
      scope.routeId !== state.selectedRouteId ||
      route.routeId !== scope.routeId
    ) {
      throw new AppError('INPUT_INVALID', 'route-D5 scope 不属于当前已选路线。')
    }
    return route
  }

  private requireLegState(state: TravelState, scope: RouteD5LegScope): RouteD5LegState {
    this.requireRouteScope(state, {
      kind: 'ROUTE',
      sessionId: scope.sessionId,
      routeId: scope.routeId
    })
    const result = state.routeD5LegStates.find((item) => item.scope.legId === scope.legId)
    if (!result) throw new AppError('INPUT_INVALID', 'route-D5 legId 不存在或已失效。')
    return result
  }

  private requireStayState(state: TravelState, scope: RouteD5StayScope): RouteD5StayState {
    this.requireRouteScope(state, {
      kind: 'ROUTE',
      sessionId: scope.sessionId,
      routeId: scope.routeId
    })
    const result = state.routeD5StayStates.find(
      (item) => item.scope.nodeId === scope.nodeId && item.scope.segmentId === scope.segmentId
    )
    if (!result) throw new AppError('INPUT_INVALID', 'route-D5 nodeId/segmentId 不存在或已失效。')
    return result
  }
}

function asLegacyStaySegment(segment: RouteStaySegment): StaySegment {
  return {
    segmentId: segment.segmentId,
    areaHint: segment.city,
    checkInDate: segment.checkInDate,
    checkOutDate: segment.checkOutDate,
    nights: segment.nights,
    nightDates: segment.nightDates,
    positionAssessment: segment.positionAssessment
  }
}

function hotelAdultCount(state: TravelState): number {
  const count =
    state.basics?.travelers
      .filter((group) => group.ageBand === 'ADULT' || group.ageBand === 'OLDER_ADULT')
      .reduce((sum, group) => sum + group.count, 0) ?? 0
  if (count < 1 || count > 6) {
    throw new AppError('GATE_BLOCKED', '酒店源需要 1 到 6 名成人或老年成人。')
  }
  return count
}

function failedStayOutcomes(error: unknown): D5SourceOutcome[] {
  const code = error instanceof AppError ? error.code : 'INTERNAL_ERROR'
  return [
    D5SourceOutcomeSchema.parse({
      sourceId: 'SRC_HOTEL',
      status: 'FAILED',
      candidateCount: 0,
      errorCode: code,
      capabilityImpact: '当前住宿段无法获得酒店来源候选。',
      manualAlternative: '可为当前住宿段手工补充完整入住日期、人数、房型和退改报价。'
    }),
    D5SourceOutcomeSchema.parse({
      sourceId: 'SRC_SEARCH',
      status: 'EMPTY',
      candidateCount: 0,
      errorCode: null,
      capabilityImpact: '本计划未授权搜索来源。',
      manualAlternative: '可在单独授权后补充，或使用人工报价。'
    }),
    D5SourceOutcomeSchema.parse({
      sourceId: 'USER_PASTE',
      status: 'EMPTY',
      candidateCount: 0,
      errorCode: null,
      capabilityImpact: '当前住宿段尚无人工报价。',
      manualAlternative: '可手工补充报价。'
    })
  ]
}

function emptyStayOutcomes(): D5SourceOutcome[] {
  return [
    D5SourceOutcomeSchema.parse({
      sourceId: 'SRC_HOTEL',
      status: 'EMPTY',
      candidateCount: 0,
      errorCode: null,
      capabilityImpact: '酒店来源本轮没有返回当前住宿段候选。',
      manualAlternative: '可为当前住宿段手工补充完整报价。'
    }),
    D5SourceOutcomeSchema.parse({
      sourceId: 'SRC_SEARCH',
      status: 'EMPTY',
      candidateCount: 0,
      errorCode: null,
      capabilityImpact: '本计划未授权搜索来源。',
      manualAlternative: '可在单独授权后补充，或使用人工报价。'
    }),
    D5SourceOutcomeSchema.parse({
      sourceId: 'USER_PASTE',
      status: 'EMPTY',
      candidateCount: 0,
      errorCode: null,
      capabilityImpact: '当前住宿段尚无人工报价。',
      manualAlternative: '可手工补充报价。'
    })
  ]
}

function requiredLocation(
  locations: Map<string, string>,
  key: 'FROM_PLACE' | 'FROM_STATION' | 'TO_STATION' | 'TO_PLACE'
): string {
  const value = locations.get(key)
  if (!value) throw new AppError('INTERNAL_INVARIANT_VIOLATED', `缺少 ${key} 坐标。`)
  return value
}

function stationAddress(value: string): string {
  return value.endsWith('站') ? value : `${value}站`
}
