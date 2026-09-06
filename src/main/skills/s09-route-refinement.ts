import { AppError } from '../../shared/errors'
import type {
  TimelineArrivalTransport,
  TimelineBlockingItem,
  TimelineItem,
  TimelineLocation,
  TimelineRouteContext,
  TimelineVerificationSummary
} from '../../shared/schema/d6'
import type { DaySkeleton, SkeletonItem } from '../../shared/schema/d5'
import type { ResearchEntity } from '../../shared/schema/d4'
import type { EvidenceClaim, JsonValue, VerificationStatus } from '../../shared/schema/evidence'
import type { RouteD5LegState, RouteDaySkeleton } from '../../shared/schema/route-d5'
import type { TravelState } from '../../shared/schema/travel-state'

type JsonRecord = Record<string, JsonValue>

export interface RefinedTimelineItem extends Omit<TimelineItem, 'itemId'> {
  itemKey: string
}

export interface RouteRefinementResult {
  items: RefinedTimelineItem[]
  blockingItems: TimelineBlockingItem[]
}

interface PlannedItem {
  itemKey: string
  desiredMinute: number
  durationMinutes: number
  fixed: boolean
  title: string
  itemClass: TimelineItem['itemClass']
  anchorClass: TimelineItem['anchorClass']
  location: TimelineLocation
  claimIds: string[]
  costCents: number | null
  routeContext?: TimelineRouteContext | null
}

interface RouteEvidence {
  claim: EvidenceClaim
  mode: TimelineArrivalTransport['mode']
  etaMinutes: number
}

const USABLE_VERIFICATION = new Set<VerificationStatus>([
  'VERIFIED',
  'CORROBORATED',
  'VERIFIED_BY_USER'
])

export function refineDailyRoutes(
  state: TravelState,
  claims: EvidenceClaim[]
): RouteRefinementResult {
  if (state.selectedRouteId !== null) return refineMultiCityDailyRoutes(state, claims)
  assertD6Prerequisites(state)
  const sessionClaims = claims.filter((claim) => claim.sessionId === state.sessionId)
  const claimMap = new Map(sessionClaims.map((claim) => [claim.claimId, claim]))
  const stay = state.stayCandidates.find(
    (candidate) => candidate.candidateId === state.selectedStayCandidateId
  )!
  const stayLocation: TimelineLocation = {
    name: stay.name,
    kind: 'STAY',
    address: null,
    coordinates: null
  }
  const blockingItems: TimelineBlockingItem[] = []
  const items = state.daySkeletons.flatMap((day) =>
    refineDay(day, state, sessionClaims, claimMap, stayLocation, blockingItems)
  )
  return { items, blockingItems }
}

function refineMultiCityDailyRoutes(
  state: TravelState,
  claims: EvidenceClaim[]
): RouteRefinementResult {
  const routeId = assertMultiCityD6Prerequisites(state)
  const sessionClaims = claims.filter((claim) => claim.sessionId === state.sessionId)
  const claimMap = new Map(sessionClaims.map((claim) => [claim.claimId, claim]))
  const blockingItems: TimelineBlockingItem[] = []
  const items = [...state.routeDaySkeletons]
    .sort((left, right) => left.date.localeCompare(right.date))
    .flatMap((day) =>
      day.dayType === 'INTERCITY_TRANSFER_DAY'
        ? refineTransferDay(day, state, claimMap, blockingItems)
        : refineRouteStayDay(day, state, sessionClaims, claimMap, blockingItems)
    )
  if (items.length === 0) {
    throw new AppError('GATE_BLOCKED', '多城市路线没有可编译的时间轴项目。', {
      userHint: `路线 ${routeId} 的日级骨架为空。`
    })
  }
  return { items, blockingItems }
}

function assertMultiCityD6Prerequisites(state: TravelState): string {
  const routeId = state.selectedRouteId
  const missing: string[] = []
  if (!routeId) missing.push('未选择多城市路线')
  if (state.stage !== 'STAGE_5') missing.push('会话未处于 STAGE-5')
  if (!state.routeD5Confirmed) missing.push('Route-D5 尚未确认')
  if (!state.routeCandidates.some((route) => route.routeId === routeId))
    missing.push('已选路线不存在')
  if (state.routeDaySkeletons.length !== state.itineraryGoal?.totalDays)
    missing.push('路线日级骨架未覆盖完整行程')
  if (state.routeDaySkeletons.some((day) => day.routeId !== routeId))
    missing.push('路线日级骨架作用域不一致')
  if (
    state.routeD5LegStates.some(
      (leg) => leg.scope.routeId !== routeId || leg.status !== 'READY' || !leg.plan
    )
  )
    missing.push('跨城路段尚未全部就绪')
  if (
    state.routeD5StayStates.some(
      (stay) =>
        stay.scope.routeId !== routeId ||
        stay.status !== 'SELECTED' ||
        !stay.selectedCandidateId ||
        !stay.candidates.some((candidate) => candidate.candidateId === stay.selectedCandidateId)
    )
  )
    missing.push('住宿段尚未全部确认')
  if (missing.length > 0 || !routeId) {
    throw new AppError('GATE_BLOCKED', '多城市 D6 前置条件未满足。', {
      userHint: missing.join('；')
    })
  }
  return routeId
}

function refineRouteStayDay(
  day: RouteDaySkeleton,
  state: TravelState,
  claims: EvidenceClaim[],
  claimMap: Map<string, EvidenceClaim>,
  blockingItems: TimelineBlockingItem[]
): RefinedTimelineItem[] {
  const routeContext = routeContextForDay(day, 'STAY_ACTIVITY')
  const stayState = state.routeD5StayStates.find(
    (stay) => stay.scope.nodeId === day.owningNodeId && stay.scope.segmentId === day.segmentId
  )
  const stay = stayState?.candidates.find(
    (candidate) => candidate.candidateId === stayState.selectedCandidateId
  )
  if (!stay) {
    blockingItems.push({
      itemId: null,
      title: `${day.date} 住宿段`,
      code: 'MISSING_PREREQUISITE',
      message: `${day.date} 缺少当前节点已确认的住宿。`,
      routeContext
    })
    return routeBackupItems(day, claims, claimMap, blockingItems)
  }
  const nodeResearch = state.routeNodeResearchStates.find(
    (node) => node.scope.routeId === day.routeId && node.scope.nodeId === day.owningNodeId
  )
  const entities = new Map(
    (nodeResearch?.researchEntities ?? []).map((entity) => [entity.entityId, entity])
  )
  const planned = day.attractionEntityIds.flatMap((entityId, index) => {
    const entity = entities.get(entityId)
    if (!entity) {
      blockingItems.push({
        itemId: null,
        title: entityId,
        code: 'MISSING_PREREQUISITE',
        message: `${day.date} 的景点不属于当前路线节点研究结果。`,
        routeContext
      })
      return []
    }
    const location = routeEntityLocation(entity, claims)
    if (!location.coordinates) {
      blockingItems.push({
        itemId: null,
        title: entity.canonicalSubject,
        code: 'MISSING_CLAIM',
        message: `“${entity.canonicalSubject}”缺少坐标证据。`,
        routeContext
      })
    }
    return [
      {
        itemKey: `${day.routeId}:${day.date}:poi:${entity.entityId}`,
        desiredMinute: 9 * 60 + index * 150,
        durationMinutes: 90,
        fixed: false,
        title: entity.canonicalSubject,
        itemClass: 'RECOMMENDED' as const,
        anchorClass: entity.disposition === 'MUST_GO' ? ('MUST' as const) : ('PREFERRED' as const),
        location,
        claimIds: entity.claimIds,
        costCents: null,
        routeContext
      }
    ]
  })
  const result: RefinedTimelineItem[] = []
  let previous:
    { itemKey: string; endMinute: number; location: TimelineLocation; title: string } | undefined
  let origin: TimelineLocation = {
    name: stay.name,
    kind: 'STAY',
    address: null,
    coordinates: null
  }
  for (const item of planned) {
    const route = findRouteEvidence(
      claims,
      previous?.itemKey ?? `stay:${day.segmentId}`,
      item.itemKey,
      origin,
      item.location
    )
    if (!route) {
      blockingItems.push({
        itemId: null,
        title: item.title,
        code: 'MISSING_CLAIM',
        message: `缺少从“${origin.name}”到“${item.location.name}”的 ETA 证据。`,
        routeContext
      })
    }
    const arrivalTransport = route
      ? {
          mode: route.mode,
          from: origin.name,
          to: item.location.name,
          etaMinutes: route.etaMinutes,
          claimIds: [route.claim.claimId]
        }
      : null
    const bufferMinutes = route ? routeBufferMinutes(route.etaMinutes, item.location.kind) : 0
    const earliest = previous
      ? previous.endMinute + (arrivalTransport?.etaMinutes ?? 0) + bufferMinutes
      : item.desiredMinute
    const startMinute = Math.max(item.desiredMinute, earliest)
    const endMinute = startMinute + item.durationMinutes
    result.push({
      itemKey: item.itemKey,
      date: day.date,
      startTime: toClock(startMinute),
      endTime: toClock(endMinute),
      crossesMidnight: false,
      title: item.title,
      itemClass: item.itemClass,
      anchorClass: item.anchorClass,
      location: item.location,
      arrivalTransport,
      bufferMinutes,
      costCents: item.costCents,
      claimIds: item.claimIds,
      verificationSummary: verificationSummary(item.claimIds, claimMap),
      routeContext
    })
    previous = { itemKey: item.itemKey, endMinute, location: item.location, title: item.title }
    origin = item.location
  }
  return [...result, ...routeBackupItems(day, claims, claimMap, blockingItems)]
}

function refineTransferDay(
  day: RouteDaySkeleton,
  state: TravelState,
  claimMap: Map<string, EvidenceClaim>,
  blockingItems: TimelineBlockingItem[]
): RefinedTimelineItem[] {
  const legStates = day.routeLegIds.map((legId) =>
    state.routeD5LegStates.find((candidate) => candidate.scope.legId === legId)
  )
  if (legStates.some((leg): leg is undefined => !leg?.plan)) {
    blockingItems.push({
      itemId: null,
      title: `${day.date} 跨城交通`,
      code: 'MISSING_PREREQUISITE',
      message: `${day.date} 的跨城路段计划不完整。`,
      routeContext: routeContextForDay(day, 'INTERCITY_LEG')
    })
    return routeBackupItems(day, [...claimMap.values()], claimMap, blockingItems)
  }
  const readyLegs = legStates.filter((leg): leg is RouteD5LegState => Boolean(leg?.plan))
  const items: RefinedTimelineItem[] = []
  const first = readyLegs[0]
  const last = readyLegs.at(-1)
  const checkoutStay = day.fromNodeId ? selectedRouteStay(state, day.fromNodeId) : null
  const checkinStay = day.toNodeId ? selectedRouteStay(state, day.toNodeId) : null
  const firstDeparture = first?.plan?.boundaryAnchors.find((anchor) => anchor.kind === 'DEPARTURE')
  if (checkoutStay && firstDeparture) {
    const endMinute = parseClock(firstDeparture.time) - 30
    if (endMinute < 0) {
      blockingItems.push({
        itemId: null,
        title: `${checkoutStay.name} 退房`,
        code: 'TIME_CONFLICT',
        message: '首段交通出发过早，无法保留 30 分钟离店缓冲。',
        routeContext: routeContextForDay(day, 'STAY_CHECKOUT', day.fromNodeId)
      })
    } else {
      items.push(routeStayBoundaryItem(day, checkoutStay, 'STAY_CHECKOUT', endMinute, claimMap))
    }
  }
  readyLegs.forEach((legState) => {
    const plan = legState.plan!
    const departure = plan.boundaryAnchors.find((anchor) => anchor.kind === 'DEPARTURE')!
    const arrival = plan.boundaryAnchors.find((anchor) => anchor.kind === 'ARRIVAL')!
    const claimIds = [...new Set(plan.legs.flatMap((leg) => leg.claimIds))]
    const startMinute = parseClock(departure.time)
    const endMinute = parseClock(arrival.time)
    const crossesMidnight = arrival.date > departure.date || endMinute < startMinute
    items.push({
      itemKey: `${day.routeId}:${day.date}:leg:${legState.scope.legId}`,
      date: day.date,
      startTime: departure.time,
      endTime: arrival.time,
      crossesMidnight,
      title: `${legState.routeLeg.label}（门到门，含接驳）`,
      itemClass: 'FIXED',
      anchorClass: 'HARD_LOCKED',
      location: locationFromLabel(arrival.location),
      arrivalTransport: null,
      bufferMinutes: 30,
      costCents: plan.totalCostCents,
      claimIds,
      verificationSummary: verificationSummary(claimIds, claimMap),
      routeContext: routeContextForLeg(day, legState)
    })
  })
  const finalArrival = last?.plan?.boundaryAnchors.find((anchor) => anchor.kind === 'ARRIVAL')
  if (checkinStay && finalArrival) {
    items.push(
      routeStayBoundaryItem(
        day,
        checkinStay,
        'STAY_CHECKIN',
        parseClock(finalArrival.time),
        claimMap
      )
    )
  }
  return [...items, ...routeBackupItems(day, [...claimMap.values()], claimMap, blockingItems)]
}

function routeStayBoundaryItem(
  day: RouteDaySkeleton,
  stay: { name: string; claimId: string; totalCostCents: number | null; segmentId: string },
  role: 'STAY_CHECKOUT' | 'STAY_CHECKIN',
  minute: number,
  claimMap: Map<string, EvidenceClaim>
): RefinedTimelineItem {
  const nodeId = role === 'STAY_CHECKOUT' ? day.fromNodeId! : day.toNodeId!
  const segmentId = stay.segmentId
  return {
    itemKey: `${day.routeId}:${day.date}:${role.toLowerCase()}:${segmentId}`,
    date: day.date,
    startTime: toClock(minute),
    endTime: toClock(minute),
    crossesMidnight: false,
    title: `${stay.name}${role === 'STAY_CHECKOUT' ? '退房' : '入住确认'}`,
    itemClass: 'FIXED',
    anchorClass: 'CONFIRMED_EXTERNAL',
    location: { name: stay.name, kind: 'STAY', address: null, coordinates: null },
    arrivalTransport: null,
    bufferMinutes: 0,
    costCents: role === 'STAY_CHECKIN' ? stay.totalCostCents : null,
    claimIds: [stay.claimId],
    verificationSummary: verificationSummary([stay.claimId], claimMap),
    routeContext: routeContextForDay(day, role, nodeId, segmentId)
  }
}

function selectedRouteStay(
  state: TravelState,
  nodeId: string
): { name: string; claimId: string; totalCostCents: number | null; segmentId: string } | null {
  const stayState = state.routeD5StayStates.find((stay) => stay.scope.nodeId === nodeId)
  const candidate = stayState?.candidates.find(
    (item) => item.candidateId === stayState.selectedCandidateId
  )
  return candidate && stayState ? { ...candidate, segmentId: stayState.scope.segmentId } : null
}

function routeContextForLeg(
  day: RouteDaySkeleton,
  legState: RouteD5LegState
): TimelineRouteContext {
  return {
    routeId: day.routeId,
    dayType: day.dayType,
    role: 'INTERCITY_LEG',
    nodeId: legState.routeLeg.to.kind === 'NODE' ? legState.routeLeg.to.nodeId : null,
    segmentId: null,
    routeLegId: legState.scope.legId,
    fromNodeId: legState.routeLeg.from.kind === 'NODE' ? legState.routeLeg.from.nodeId : null,
    toNodeId: legState.routeLeg.to.kind === 'NODE' ? legState.routeLeg.to.nodeId : null
  }
}

function routeContextForDay(
  day: RouteDaySkeleton,
  role: TimelineRouteContext['role'],
  nodeId: string | null = day.owningNodeId,
  segmentId: string | null = day.segmentId
): TimelineRouteContext {
  return {
    routeId: day.routeId,
    dayType: day.dayType,
    role,
    nodeId,
    segmentId,
    routeLegId: day.routeLegId,
    fromNodeId: day.fromNodeId,
    toNodeId: day.toNodeId
  }
}

function routeEntityLocation(entity: ResearchEntity, claims: EvidenceClaim[]): TimelineLocation {
  const claim = claims.find(
    (candidate) =>
      entity.claimIds.includes(candidate.claimId) && candidate.predicate === 'coordinates'
  )
  const value = claim ? record(claim.value) : null
  return {
    name: entity.canonicalSubject,
    kind: entity.kind === 'FOOD' ? 'RESTAURANT' : 'POI',
    address: null,
    coordinates: value ? coordinates(value) : null
  }
}

function routeBackupItems(
  day: RouteDaySkeleton,
  claims: EvidenceClaim[],
  claimMap: Map<string, EvidenceClaim>,
  blockingItems: TimelineBlockingItem[]
): RefinedTimelineItem[] {
  const scopedClaims = claims.filter(
    (claim) =>
      !claim.scope ||
      (claim.scope.kind === 'ROUTE_NODE' &&
        claim.scope.routeId === day.routeId &&
        (day.owningNodeId === null || claim.scope.nodeId === day.owningNodeId))
  )
  const routeContext = routeContextForDay(day, 'BACKUP')
  const before = blockingItems.length
  const backups = backupItemsForDay(day.date, scopedClaims, claimMap, blockingItems)
  for (let index = before; index < blockingItems.length; index += 1) {
    blockingItems[index] = { ...blockingItems[index]!, routeContext }
  }
  return backups.map((item) => ({ ...item, routeContext }))
}

function assertD6Prerequisites(state: TravelState): void {
  const missing: string[] = []
  if (state.stage !== 'STAGE_5') missing.push('会话未处于 STAGE-5')
  if (!state.selectedTransportCandidateId) missing.push('未选择往返交通')
  if (!state.selectedStayCandidateId) missing.push('未选择住宿')
  if (!state.staySegment) missing.push('缺少住宿段')
  if (state.boundaryAnchors.length !== 2) missing.push('缺少抵达或离开硬锚点')
  if (state.daySkeletons.length === 0) missing.push('缺少已确认日骨架')
  if (missing.length > 0) {
    throw new AppError('GATE_BLOCKED', 'D6 前置条件未满足。', {
      userHint: missing.join('；')
    })
  }
  if (!state.stayCandidates.some((item) => item.candidateId === state.selectedStayCandidateId)) {
    throw new AppError('GATE_BLOCKED', '已选住宿候选不存在。')
  }
}

function refineDay(
  day: DaySkeleton,
  state: TravelState,
  claims: EvidenceClaim[],
  claimMap: Map<string, EvidenceClaim>,
  stayLocation: TimelineLocation,
  blockingItems: TimelineBlockingItem[]
): RefinedTimelineItem[] {
  const plan = plannedItemsForDay(day, state, claims, blockingItems)
  const backups = backupItemsForDay(day.date, claims, claimMap, blockingItems)
  const result: RefinedTimelineItem[] = []
  let previous:
    { itemKey: string; endMinute: number; location: TimelineLocation; title: string } | undefined
  let origin = stayLocation

  for (const planned of plan.sort((a, b) => a.desiredMinute - b.desiredMinute)) {
    const isArrivalAnchor = planned.itemKey.endsWith(':arrival')
    const route = isArrivalAnchor
      ? null
      : findRouteEvidence(
          claims,
          previous?.itemKey ?? 'stay',
          planned.itemKey,
          origin,
          planned.location
        )
    if (!isArrivalAnchor && !route) {
      blockingItems.push({
        itemId: null,
        title: planned.title,
        code: 'MISSING_CLAIM',
        message: `缺少从“${origin.name}”到“${planned.location.name}”的 ETA 证据。`
      })
    }
    const arrivalTransport = route
      ? {
          mode: route.mode,
          from: origin.name,
          to: planned.location.name,
          etaMinutes: route.etaMinutes,
          claimIds: [route.claim.claimId]
        }
      : null
    const bufferMinutes = route ? routeBufferMinutes(route.etaMinutes, planned.location.kind) : 0
    const earliest = previous
      ? previous.endMinute + (arrivalTransport?.etaMinutes ?? 0) + bufferMinutes
      : planned.desiredMinute
    const startMinute = planned.fixed
      ? planned.desiredMinute
      : Math.max(planned.desiredMinute, earliest)
    if (planned.fixed && previous && startMinute < earliest) {
      blockingItems.push({
        itemId: null,
        title: planned.title,
        code: 'TIME_CONFLICT',
        message: `“${previous.title}”结束后无法在硬锚点前完成交通与缓冲。`
      })
    }
    const endMinute = startMinute + planned.durationMinutes
    if (endMinute > 1_560) {
      blockingItems.push({
        itemId: null,
        title: planned.title,
        code: 'TIME_CONFLICT',
        message: '项目结束时间超出次日 02:00 的 M0 可执行边界。'
      })
    }
    const verification = verificationSummary(planned.claimIds, claimMap)
    result.push({
      itemKey: planned.itemKey,
      date: day.date,
      startTime: toClock(startMinute),
      endTime: toClock(endMinute),
      crossesMidnight: endMinute >= 1_440 && toClock(endMinute) < toClock(startMinute),
      title: planned.title,
      itemClass: planned.itemClass,
      anchorClass: planned.anchorClass,
      location: planned.location,
      arrivalTransport,
      bufferMinutes,
      costCents: planned.costCents,
      claimIds: planned.claimIds,
      verificationSummary: verification
    })
    previous = {
      itemKey: planned.itemKey,
      endMinute,
      location: planned.location,
      title: planned.title
    }
    origin = planned.location
  }
  return [...result, ...backups]
}

function plannedItemsForDay(
  day: DaySkeleton,
  state: TravelState,
  claims: EvidenceClaim[],
  blockingItems: TimelineBlockingItem[]
): PlannedItem[] {
  const plan: PlannedItem[] = []
  const arrival = state.boundaryAnchors.find(
    (anchor) => anchor.kind === 'ARRIVAL' && anchor.date === day.date
  )
  const departure = state.boundaryAnchors.find(
    (anchor) => anchor.kind === 'DEPARTURE' && anchor.date === day.date
  )
  if (arrival) {
    plan.push({
      itemKey: `${day.date}:arrival`,
      desiredMinute: parseClock(arrival.time),
      durationMinutes: 0,
      fixed: true,
      title: '抵达目的地',
      itemClass: 'FIXED',
      anchorClass: 'HARD_LOCKED',
      location: locationFromLabel(arrival.location),
      claimIds: arrival.claimIds,
      costCents: null
    })
  }
  addSlot(plan, day, 'morning', 9 * 60)
  addRestaurant(plan, day, 'LUNCH', 12 * 60, claims, blockingItems)
  addSlot(plan, day, 'afternoon', 14 * 60)
  addRestaurant(plan, day, 'DINNER', 18 * 60, claims, blockingItems)
  addSlot(plan, day, 'evening', 19 * 60)
  if (departure) {
    plan.push({
      itemKey: `${day.date}:departure`,
      desiredMinute: parseClock(departure.time),
      durationMinutes: 0,
      fixed: true,
      title: '离开目的地',
      itemClass: 'FIXED',
      anchorClass: 'HARD_LOCKED',
      location: locationFromLabel(departure.location),
      claimIds: departure.claimIds,
      costCents: null
    })
  }
  return plan
}

function addSlot(
  plan: PlannedItem[],
  day: DaySkeleton,
  period: 'morning' | 'afternoon' | 'evening',
  baseMinute: number
): void {
  const slot = day[period]
  if (!slot || slot.kind !== 'PROJECTS') return
  slot.items.forEach((item, index) => {
    plan.push(plannedSkeletonItem(day.date, period, item, baseMinute + index * 120))
  })
}

function plannedSkeletonItem(
  date: string,
  period: string,
  item: SkeletonItem,
  desiredMinute: number
): PlannedItem {
  return {
    itemKey: `${date}:poi:${item.entityId}:${period}`,
    desiredMinute,
    durationMinutes: 90,
    fixed: false,
    title: item.title,
    itemClass: 'RECOMMENDED',
    anchorClass: 'PREFERRED',
    location: {
      name: item.title,
      kind: 'POI',
      address: null,
      coordinates: item.coordinates
    },
    claimIds: item.claimIds,
    costCents: null
  }
}

function addRestaurant(
  plan: PlannedItem[],
  day: DaySkeleton,
  period: 'LUNCH' | 'DINNER',
  desiredMinute: number,
  claims: EvidenceClaim[],
  blockingItems: TimelineBlockingItem[]
): void {
  if (!day.mealAnchors.some((anchor) => anchor.period === period)) return
  const claim = claims.find((candidate) => {
    if (candidate.predicate !== 'restaurantCandidate') return false
    const value = record(candidate.value)
    return value?.date === day.date && value.period === period
  })
  const value = claim ? record(claim.value) : null
  const name = text(value?.name)
  if (!claim || !value || !name) {
    blockingItems.push({
      itemId: null,
      title: period === 'LUNCH' ? '午餐餐厅' : '晚餐餐厅',
      code: 'MISSING_CLAIM',
      message: `${day.date} 缺少已核验的${period === 'LUNCH' ? '午餐' : '晚餐'}候选。`
    })
    return
  }
  plan.push({
    itemKey: `${day.date}:restaurant:${period}`,
    desiredMinute,
    durationMinutes: 60,
    fixed: false,
    title: name,
    itemClass: 'RECOMMENDED',
    anchorClass: 'PREFERRED',
    location: {
      name,
      kind: 'RESTAURANT',
      address: text(value.address),
      coordinates: coordinates(value)
    },
    claimIds: [claim.claimId],
    costCents: nonnegativeInteger(value.costCents)
  })
}

function backupItemsForDay(
  date: string,
  claims: EvidenceClaim[],
  claimMap: Map<string, EvidenceClaim>,
  blockingItems: TimelineBlockingItem[]
): RefinedTimelineItem[] {
  const claim = claims.find((candidate) => {
    if (candidate.predicate !== 'backupCandidate') return false
    return record(candidate.value)?.date === date
  })
  const value = claim ? record(claim.value) : null
  const name = text(value?.name)
  if (!claim || !value || !name) {
    blockingItems.push({
      itemId: null,
      title: `${date} 备用项`,
      code: 'MISSING_BACKUP',
      message: `${date} 缺少带来源的 BACKUP。`
    })
    return []
  }
  return [
    {
      itemKey: `${date}:backup:${claim.claimId}`,
      date,
      startTime: '00:00',
      endTime: '00:00',
      crossesMidnight: false,
      title: name,
      itemClass: 'BACKUP',
      anchorClass: 'FLEXIBLE',
      location: {
        name,
        kind: 'POI',
        address: text(value.address),
        coordinates: coordinates(value)
      },
      arrivalTransport: null,
      bufferMinutes: 0,
      costCents: nonnegativeInteger(value.costCents),
      claimIds: [claim.claimId],
      verificationSummary: verificationSummary([claim.claimId], claimMap)
    }
  ]
}

function findRouteEvidence(
  claims: EvidenceClaim[],
  fromKey: string,
  toKey: string,
  from: TimelineLocation,
  to: TimelineLocation
): RouteEvidence | null {
  for (const claim of claims) {
    if (claim.sourceId !== 'SRC_MAP' || !['routeEta', 'groundTransfer'].includes(claim.predicate))
      continue
    const value = record(claim.value)
    if (!value) continue
    const keyMatch = value.fromEntityId === fromKey && value.toEntityId === toKey
    const labelMatch =
      normalize(text(value.from)) === normalize(from.name) &&
      normalize(text(value.to)) === normalize(to.name)
    if (!keyMatch && !labelMatch) continue
    const etaMinutes =
      nonnegativeInteger(value.etaMinutes) ??
      nonnegativeInteger(value.durationMinutes) ??
      secondsToMinutes(value.durationSeconds)
    if (etaMinutes === null) continue
    return { claim, mode: transportMode(value.travelMode ?? value.mode), etaMinutes }
  }
  return null
}

export function routeBufferMinutes(
  etaMinutes: number,
  destinationKind: TimelineLocation['kind']
): number {
  const stationLike = destinationKind === 'STATION' || destinationKind === 'AIRPORT'
  return Math.max(stationLike ? 30 : 10, Math.ceil(etaMinutes * (stationLike ? 0.5 : 0.2)))
}

export function verificationSummary(
  claimIds: string[],
  claimMap: Map<string, EvidenceClaim>
): TimelineVerificationSummary {
  const statuses = claimIds.map((claimId) => claimMap.get(claimId)?.verificationStatus)
  const allUsable =
    claimIds.length > 0 && statuses.every((status) => status && USABLE_VERIFICATION.has(status))
  const status = aggregateVerification(statuses)
  return { status, claimCount: claimIds.length, allClaimsUsable: allUsable }
}

function aggregateVerification(
  statuses: Array<VerificationStatus | undefined>
): VerificationStatus {
  if (statuses.length === 0 || statuses.some((status) => status === undefined)) return 'UNVERIFIED'
  if (statuses.includes('CONFLICTED')) return 'CONFLICTED'
  if (statuses.includes('STALE')) return 'STALE'
  if (statuses.includes('UNVERIFIED')) return 'UNVERIFIED'
  if (statuses.includes('ESTIMATED')) return 'ESTIMATED'
  if (statuses.includes('CORROBORATED')) return 'CORROBORATED'
  if (statuses.includes('VERIFIED_BY_USER')) return 'VERIFIED_BY_USER'
  return 'VERIFIED'
}

function locationFromLabel(label: string): TimelineLocation {
  const kind = /机场/.test(label) ? 'AIRPORT' : /站/.test(label) ? 'STATION' : 'OTHER'
  return { name: label, kind, address: null, coordinates: null }
}

function parseClock(value: string): number {
  const [hours, minutes] = value.split(':').map(Number)
  return (hours ?? 0) * 60 + (minutes ?? 0)
}

function toClock(value: number): string {
  const normalized = ((value % 1_440) + 1_440) % 1_440
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`
}

function record(value: JsonValue): JsonRecord | null {
  return value !== null && !Array.isArray(value) && typeof value === 'object' ? value : null
}

function text(value: JsonValue | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function nonnegativeInteger(value: JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

function secondsToMinutes(value: JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.ceil(value / 60)
    : null
}

function coordinates(value: JsonRecord): TimelineLocation['coordinates'] {
  const lng = value.lng
  const lat = value.lat
  return typeof lng === 'number' && typeof lat === 'number' ? { lng, lat } : null
}

function normalize(value: string | null): string {
  return value?.normalize('NFKC').trim().toLowerCase() ?? ''
}

function transportMode(value: JsonValue | undefined): TimelineArrivalTransport['mode'] {
  if (value === 'WALKING' || value === 'TRANSIT' || value === 'RAIL' || value === 'MANUAL')
    return value
  return 'DRIVING'
}
