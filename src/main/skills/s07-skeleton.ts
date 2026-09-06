import { AppError } from '../../shared/errors'
import {
  BoundaryAnchorSchema,
  DaySkeletonSchema,
  StaySegmentSchema,
  type BoundaryAnchor,
  type DaySkeleton,
  type StaySegment,
  type TransportCandidate
} from '../../shared/schema/d5'
import type { EvidenceClaim } from '../../shared/schema/evidence'
import type { TravelState } from '../../shared/schema/travel-state'

export interface SkeletonResult {
  days: DaySkeleton[]
  boundaryAnchors: BoundaryAnchor[]
  staySegment: StaySegment
}

export function buildSkeleton(state: TravelState, claims: EvidenceClaim[]): SkeletonResult {
  if (!state.basics || !state.selectedTransportCandidateId)
    throw new AppError('GATE_BLOCKED', '交通方案尚未选择。')
  const transport = state.transportCandidates.find(
    (item) => item.candidateId === state.selectedTransportCandidateId
  )
  if (!transport) throw new AppError('GATE_BLOCKED', '已选交通方案不存在。')
  const dates = tripDates(state.basics.dates)
  if (dates.length < 2) throw new AppError('GATE_BLOCKED', '住宿骨架至少需要两天行程。')
  const anchors = transportAnchors(transport)
  const eligible = state.researchEntities.filter(
    (entity) => entity.disposition !== 'EXCLUDE' && entity.fitness.status !== 'EXCLUDED'
  )
  const items = eligible.flatMap((entity) => {
    const claim = claims.find(
      (item) => entity.claimIds.includes(item.claimId) && item.predicate === 'coordinates'
    )
    const value = claim?.value
    if (!claim || value === null || Array.isArray(value) || typeof value !== 'object') return []
    const lng = value.lng
    const lat = value.lat
    if (typeof lng !== 'number' || typeof lat !== 'number') return []
    return [
      {
        entityId: entity.entityId,
        title: entity.canonicalSubject,
        coordinates: { lng, lat },
        claimIds: [claim.claimId]
      }
    ]
  })
  if (items.length === 0)
    throw new AppError('GATE_BLOCKED', '没有带坐标的已确认研究项目。', {
      userHint: '请为至少一个研究项目补充 coordinates 证据。'
    })
  const clusters = clusterItemsWithinEightKm(items)
  const availableSlots: Array<{
    date: string
    period: 'morning' | 'afternoon' | 'evening'
  }> = []
  dates.forEach((date, index) => {
    if (index === 0) {
      if (transport.arrivalUsableMinutes >= 120) availableSlots.push({ date, period: 'evening' })
    } else if (index === dates.length - 1) {
      if (transport.departureUsableMinutes >= 120) availableSlots.push({ date, period: 'morning' })
    } else availableSlots.push({ date, period: 'morning' }, { date, period: 'afternoon' })
  })
  if (clusters.length > availableSlots.length) {
    throw new AppError('GATE_BLOCKED', '已确认项目的地理分组超过当前行程可用半日数。', {
      userHint: '请减少项目或延长行程，系统不会把相距超过 8 km 的项目强塞进同一半日。'
    })
  }
  const allocations = new Map(
    clusters.map((cluster, index) => [
      `${availableSlots[index]!.date}:${availableSlots[index]!.period}`,
      cluster
    ])
  )
  const days = dates.map((date, index) => {
    const slot = (period: 'morning' | 'afternoon' | 'evening'): DaySkeleton['morning'] => {
      const assigned = allocations.get(`${date}:${period}`) ?? []
      return assigned.length > 0
        ? {
            kind: 'PROJECTS' as const,
            area: state.basics!.destinationCities[0]!,
            items: assigned,
            note: null
          }
        : null
    }
    return DaySkeletonSchema.parse({
      date,
      dayType:
        index === 0 ? 'ARRIVAL_DAY' : index === dates.length - 1 ? 'DEPARTURE_DAY' : 'NORMAL_DAY',
      intensity:
        state.basics!.intensity === 'RELAXED'
          ? 'LOW'
          : state.basics!.intensity === 'INTENSIVE'
            ? 'HIGH'
            : 'MEDIUM',
      morning: index === 0 ? null : slot('morning'),
      afternoon: index === 0 || index === dates.length - 1 ? null : slot('afternoon'),
      evening: index === dates.length - 1 ? null : slot('evening'),
      mealAnchors: [
        {
          period: 'LUNCH',
          area: state.basics!.destinationCities[0],
          routeReason: '与上午或下午活动区域保持一致'
        },
        {
          period: 'DINNER',
          area: state.basics!.destinationCities[0],
          routeReason: '与当日活动区域保持一致'
        }
      ],
      localTransport: {
        strategy: 'WALK_TRANSIT',
        budgetImpact: '以公共交通为基准，费用待核验',
        staminaImpact: '同区域聚合以减少折返'
      }
    })
  })
  const staySegment = StaySegmentSchema.parse({
    segmentId: `stay-${state.sessionId}`,
    areaHint: state.basics.destinationCities[0],
    checkInDate: dates[0],
    checkOutDate: dates.at(-1),
    nights: dates.length - 1,
    nightDates: dates.slice(0, -1),
    positionAssessment: {
      status: 'ESTIMATED',
      summary: '基于已确认项目所在城市生成，具体商圈需住宿候选验证。',
      claimIds: items.flatMap((item) => item.claimIds)
    }
  })
  return { days, boundaryAnchors: anchors, staySegment }
}

export function clusterItemsWithinEightKm<T extends { coordinates: { lng: number; lat: number } }>(
  items: T[]
): T[][] {
  const clusters: T[][] = []
  for (const item of items) {
    const cluster = clusters.find(
      (candidate) =>
        candidate.length < 4 &&
        candidate.every((existing) => distanceKm(existing.coordinates, item.coordinates) <= 8)
    )
    if (cluster) cluster.push(item)
    else clusters.push([item])
  }
  return clusters
}

export function slotItemsWithinEightKm(
  items: Array<{ coordinates: { lng: number; lat: number } }>
): boolean {
  return items.every((item, index) =>
    items.slice(index + 1).every((other) => distanceKm(item.coordinates, other.coordinates) <= 8)
  )
}

function distanceKm(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  const radians = (degrees: number): number => (degrees * Math.PI) / 180
  const latitudeDelta = radians(b.lat - a.lat)
  const longitudeDelta = radians(b.lng - a.lng)
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(longitudeDelta / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}

function transportAnchors(candidate: TransportCandidate): BoundaryAnchor[] {
  const arrivalLeg = candidate.outbound.legs[3]
  const departureLeg = candidate.return.legs[0]
  if (!arrivalLeg.endAt || !departureLeg.startAt)
    throw new AppError('GATE_BLOCKED', '交通方案缺少抵达或离开时间。')
  return [
    BoundaryAnchorSchema.parse({
      kind: 'ARRIVAL',
      date: arrivalLeg.endAt.slice(0, 10),
      time: arrivalLeg.endAt.slice(11, 16),
      at: arrivalLeg.endAt,
      location: arrivalLeg.to,
      usableMinutes: candidate.arrivalUsableMinutes,
      anchorClass: 'HARD_LOCKED',
      claimIds: arrivalLeg.claimIds
    }),
    BoundaryAnchorSchema.parse({
      kind: 'DEPARTURE',
      date: departureLeg.startAt.slice(0, 10),
      time: departureLeg.startAt.slice(11, 16),
      at: departureLeg.startAt,
      location: departureLeg.from,
      usableMinutes: candidate.departureUsableMinutes,
      anchorClass: 'HARD_LOCKED',
      claimIds: departureLeg.claimIds
    })
  ]
}

function tripDates(intent: NonNullable<TravelState['basics']>['dates']): string[] {
  const start = intent.kind === 'FIXED' ? intent.startDate : `${intent.month}-01`
  const end = intent.kind === 'FIXED' ? intent.endDate : addDays(start, intent.durationDays - 1)
  const dates: string[] = []
  for (let date = start; date <= end; date = addDays(date, 1)) dates.push(date)
  return dates
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}
