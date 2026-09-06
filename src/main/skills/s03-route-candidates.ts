import { createHash } from 'node:crypto'
import { AppError } from '../../shared/errors'
import type { EvidenceClaim } from '../../shared/schema/evidence'
import {
  ItineraryGoalSchema,
  RouteCandidateSchema,
  RouteLegEvidenceValueSchema,
  type ItineraryGoal,
  type RouteCandidate,
  type RouteLeg,
  type RouteLegEvidenceValue,
  type RouteNode,
  type RoutePlannedCall,
  type RouteProfile,
  type RouteSourceOutcome,
  type RouteStaySegment
} from '../../shared/schema/itinerary'
import type { TravelBasics } from '../../shared/schema/interview'

const PROFILE_ORDER = ['BALANCED', 'LOW_TRANSIT', 'RELAXED'] as const
const USABLE_STATUSES = new Set(['VERIFIED', 'CORROBORATED', 'VERIFIED_BY_USER'])

export interface BuildMultiCityRouteCandidatesInput {
  sessionId: string
  goal: ItineraryGoal
  claims: EvidenceClaim[]
  sourceOutcomes?: RouteSourceOutcome[]
  now: string
}

export interface MultiCityRouteCandidateResult {
  candidates: RouteCandidate[]
  blockingReasons: string[]
}

interface RouteEvidence {
  claim: EvidenceClaim
  value: RouteLegEvidenceValue
  usable: boolean
}

interface TopologyNode {
  city: string
  mandatoryPlaceIds: string[]
  kind: 'STAY' | 'TRANSIT'
}

export interface MultiCityRouteSourcePlan {
  topologySignatures: string[]
  plannedCalls: RoutePlannedCall[]
}

export function deriveMultiCityItineraryGoal(basics: TravelBasics): ItineraryGoal {
  if (
    basics.itineraryIntent?.kind !== 'MULTI_CITY_ROUTE' ||
    basics.dates.kind !== 'FIXED' ||
    !basics.originGatewayCity
  ) {
    throw new AppError('GATE_BLOCKED', '多城市路线需要固定日期、明确的出发枢纽城市与必去点。', {
      userHint: '请在基础信息确认卡中填写城市级出发枢纽；精确集合点不会代替城市。'
    })
  }
  const totalDays = daysBetween(basics.dates.startDate, basics.dates.endDate) + 1
  return ItineraryGoalSchema.parse({
    regionGoal: basics.itineraryIntent.regionGoal,
    originCity: basics.originGatewayCity,
    originPlaceLabel: basics.originPlaceLabel,
    startDate: basics.dates.startDate,
    endDate: basics.dates.endDate,
    totalDays,
    totalNights: totalDays - 1,
    travelers: basics.travelers,
    budget: basics.budget,
    intensity: basics.intensity,
    mandatoryPlaces: basics.itineraryIntent.mandatoryPlaces
  })
}

export function buildMultiCityRouteSourcePlan(goalInput: ItineraryGoal): MultiCityRouteSourcePlan {
  const goal = ItineraryGoalSchema.parse(goalInput)
  const mandatoryByCity = mandatoryPlacesByCity(goal)
  const cities = [...mandatoryByCity.keys()].sort(compareText)
  const baseOrders = permutations(cities).slice(0, 2)
  const calls = new Map<string, Omit<RoutePlannedCall, 'sequence'>>()
  const topologySignatures: string[] = []
  const addCall = (fromCity: string, toCity: string, travelDate: string): void => {
    if (calls.size >= 24) return
    const key = `${normalize(fromCity)}\n${normalize(toCity)}\n${travelDate}`
    if (calls.has(key)) return
    calls.set(key, {
      callId: stableId('route-call', `${goal.originCity}\n${key}`),
      sourceId: 'SRC_RAIL',
      toolName: 'get-tickets',
      fromCity,
      toCity,
      travelDate,
      timeoutMs: 15_000,
      retryCount: 0
    })
  }

  for (const order of baseOrders) {
    const topology = order.map((city) => ({
      city,
      mandatoryPlaceIds: mandatoryByCity.get(city) ?? [],
      kind: 'STAY' as const
    }))
    const nights = allocateNights(goal.totalNights, topology, 'BALANCED')
    const dates: string[] = []
    let cursor = goal.startDate
    for (const nightCount of nights) {
      dates.push(cursor)
      cursor = addDays(cursor, nightCount)
    }
    const endpoints = [goal.originCity, ...order, goal.originCity]
    topologySignatures.push(order.join('→'))
    for (let index = 0; index < endpoints.length - 1; index += 1) {
      addCall(endpoints[index]!, endpoints[index + 1]!, dates[index] ?? goal.endDate)
    }
    if (!mandatoryByCity.has('昆明')) {
      for (let index = 0; index < endpoints.length - 1 && calls.size < 24; index += 1) {
        const fromCity = endpoints[index]!
        const toCity = endpoints[index + 1]!
        const travelDate = dates[index] ?? goal.endDate
        addCall(fromCity, '昆明', travelDate)
        addCall('昆明', toCity, travelDate)
        topologySignatures.push([...order.slice(0, index), '昆明', ...order.slice(index)].join('→'))
      }
    }
  }
  return {
    topologySignatures: [...new Set(topologySignatures)].slice(0, 8),
    plannedCalls: [...calls.values()].map((call, index) => ({ ...call, sequence: index + 1 }))
  }
}

export function buildMultiCityRouteCandidates(
  raw: BuildMultiCityRouteCandidatesInput
): MultiCityRouteCandidateResult {
  const goal = ItineraryGoalSchema.parse(raw.goal)
  const nowMs = Date.parse(raw.now)
  if (!Number.isFinite(nowMs)) throw new AppError('INPUT_INVALID', '路线评分时间无效。')
  const mandatoryByCity = mandatoryPlacesByCity(goal)
  const cities = [...mandatoryByCity.keys()].sort(compareText)
  if (cities.length < 2 || cities.length > 6 || goal.totalNights < cities.length) {
    throw new AppError('GATE_BLOCKED', '多城市路线的节点数量或住宿夜数不可行。')
  }
  const evidence = routeEvidence(raw.sessionId, raw.claims, nowMs)
  const candidatesByProfile = new Map<RouteProfile, RouteCandidate[]>()

  for (const order of permutations(cities)) {
    for (const profile of PROFILE_ORDER) {
      const base = buildCandidate({
        sessionId: raw.sessionId,
        goal,
        profile,
        topology: order.map((city) => ({
          city,
          mandatoryPlaceIds: mandatoryByCity.get(city) ?? [],
          kind: 'STAY' as const
        })),
        evidence,
        kunmingReason: '现有可用交通证据未证明经昆明中转优于直连方案。'
      })
      addCandidate(candidatesByProfile, base)
      for (const variant of kunmingVariants(order, mandatoryByCity, goal, profile, evidence)) {
        addCandidate(
          candidatesByProfile,
          buildCandidate({
            sessionId: raw.sessionId,
            goal,
            profile,
            topology: variant.topology,
            evidence,
            kunmingReason: variant.reason
          })
        )
      }
    }
  }

  const selected: RouteCandidate[] = []
  const signatures = new Set<string>()
  for (const profile of PROFILE_ORDER) {
    const ranked = [...(candidatesByProfile.get(profile) ?? [])].sort(compareCandidates)
    const candidate = ranked.find((item) => !signatures.has(candidateSignature(item)))
    if (!candidate) continue
    signatures.add(candidateSignature(candidate))
    selected.push(candidate)
  }
  if (selected.length < PROFILE_ORDER.length) {
    throw new AppError('GATE_BLOCKED', '去重后不足三条具有实质差异的多城市路线。')
  }

  const compared = addRelativeMaterialDifferences(selected)
  const bestIndex = compared
    .map((candidate, index) => ({ candidate, index }))
    .filter(
      ({ candidate }) =>
        candidate.score.hardConstraintPass &&
        candidate.score.criticalEvidenceComplete &&
        candidate.blockingReasons.length === 0
    )
    .sort((left, right) => compareCandidates(left.candidate, right.candidate))[0]?.index
  const candidates = compared.map((candidate, index) =>
    RouteCandidateSchema.parse({ ...candidate, isRecommended: index === bestIndex })
  )
  const blockingReasons =
    bestIndex === undefined
      ? [
          '所有候选都缺少至少一条关键交通腿的可用证据。',
          '请补充航班或客运人工证据后重新生成；系统不会用常识补齐。'
        ]
      : []
  return { candidates, blockingReasons }
}

function buildCandidate(input: {
  sessionId: string
  goal: ItineraryGoal
  profile: RouteProfile
  topology: TopologyNode[]
  evidence: RouteEvidence[]
  kunmingReason: string
}): RouteCandidate {
  const stayCount = input.topology.filter((node) => node.kind === 'STAY').length
  if (input.goal.totalNights < stayCount) {
    throw new AppError('GATE_BLOCKED', '住宿夜数不足以覆盖全部必去城市。')
  }
  const nightAllocation = allocateNights(input.goal.totalNights, input.topology, input.profile)
  const topologySignature = input.topology
    .map((node, index) => `${node.city}:${node.kind}:${nightAllocation[index] ?? 0}`)
    .join('|')
  const routeId = stableId(
    'route',
    `${input.sessionId}\nroute-v1\n${input.profile}\n${input.goal.startDate}\n${topologySignature}`
  )
  const nodes: RouteNode[] = []
  const staySegments: RouteStaySegment[] = []
  let cursor = input.goal.startDate
  input.topology.forEach((topologyNode, index) => {
    const nights = nightAllocation[index] ?? 0
    const departureDate = addDays(cursor, nights)
    const nodeId = stableId('node', `${routeId}\n${index + 1}\n${normalize(topologyNode.city)}`)
    const node: RouteNode = {
      routeId,
      nodeId,
      city: topologyNode.city,
      region: input.goal.regionGoal,
      sequence: index + 1,
      arrivalDate: cursor,
      departureDate,
      nights,
      nodeKind: topologyNode.kind,
      mandatoryPlaceIds: topologyNode.mandatoryPlaceIds,
      reason:
        topologyNode.kind === 'TRANSIT'
          ? input.kunmingReason
          : `承载必去点：${topologyNode.mandatoryPlaceIds.join('、')}`
    }
    nodes.push(node)
    if (topologyNode.kind === 'STAY') {
      staySegments.push({
        routeId,
        nodeId,
        segmentId: stableId('segment', `${routeId}\n${nodeId}`),
        city: topologyNode.city,
        checkInDate: cursor,
        checkOutDate: departureDate,
        nights,
        nightDates: Array.from({ length: nights }, (_, offset) => addDays(cursor, offset)),
        positionAssessment: {
          status: 'UNKNOWN',
          summary: '路线选择仅冻结住宿段日期；位置与酒店候选将在 D5 核验。',
          claimIds: []
        }
      })
    }
    cursor = departureDate
  })
  if (cursor !== input.goal.endDate) {
    throw new AppError('INTERNAL_INVARIANT_VIOLATED', '路线节点日期未覆盖完整旅行窗口。')
  }

  const legs: RouteLeg[] = nodes.map((node, index) => {
    const previous = nodes[index - 1]
    return buildLeg({
      routeId,
      index,
      fromNode: previous,
      toNode: node,
      originCity: input.goal.originCity,
      evidence: input.evidence,
      profile: input.profile
    })
  })
  const lastNode = nodes.at(-1)!
  legs.push(
    buildLeg({
      routeId,
      index: nodes.length,
      fromNode: lastNode,
      toNode: undefined,
      originCity: input.goal.originCity,
      evidence: input.evidence,
      profile: input.profile
    })
  )
  const unverifiedLegCount = legs.filter((leg) => !isUsableStatus(leg.verificationStatus)).length
  const durations = legs.map((leg) => leg.durationMinutes)
  const costs = legs.map((leg) => leg.costCents)
  const blockingReasons = legs
    .filter(
      (leg) =>
        leg.critical && (!isUsableStatus(leg.verificationStatus) || leg.durationMinutes === null)
    )
    .map((leg) => `${leg.fromCity}→${leg.toCity} 缺少可用交通证据。`)
  const altitudeRisk = altitudeRiskFor(nodes)
  const transferCount = legs.reduce((sum, leg) => sum + leg.transferCount, 0)
  const overnightArrivalCount = legs.filter((leg) =>
    leg.riskFlags.includes('OVERNIGHT_ARRIVAL')
  ).length
  return RouteCandidateSchema.parse({
    routeId,
    profile: input.profile,
    nodes,
    legs,
    staySegments,
    score: {
      hardConstraintPass: true,
      criticalEvidenceComplete: blockingReasons.length === 0,
      unverifiedLegCount,
      transferCount,
      overnightArrivalCount,
      transitMinutes: durations.every((duration) => duration !== null)
        ? durations.reduce<number>((sum, duration) => sum + (duration ?? 0), 0)
        : null,
      backtrackingScore: nodes.some((node) => normalize(node.city) === '昆明') ? 5 : 0,
      staminaRisk: staminaRiskFor(input.profile, transferCount, overnightArrivalCount),
      altitudeRisk,
      knownCostCents: costs.every((cost) => cost !== null)
        ? costs.reduce<number>((sum, cost) => sum + (cost ?? 0), 0)
        : null,
      costComplete: costs.every((cost) => cost !== null)
    },
    isRecommended: false,
    materialDifferences: materialDifferences(input.profile, nodes, transferCount),
    kunmingDecision: {
      included: nodes.some((node) => normalize(node.city) === '昆明'),
      reason: input.kunmingReason
    },
    blockingReasons
  })
}

function buildLeg(input: {
  routeId: string
  index: number
  fromNode: RouteNode | undefined
  toNode: RouteNode | undefined
  originCity: string
  evidence: RouteEvidence[]
  profile: RouteProfile
}): RouteLeg {
  const fromCity = input.fromNode?.city ?? input.originCity
  const toCity = input.toNode?.city ?? input.originCity
  const travelDate = input.toNode?.arrivalDate ?? input.fromNode!.departureDate
  const matched = input.evidence
    .filter(
      ({ value }) =>
        normalize(value.fromCity) === normalize(fromCity) &&
        normalize(value.toCity) === normalize(toCity) &&
        value.travelDate === travelDate
    )
    .sort((left, right) => compareEvidence(left, right, input.profile))[0]
  const riskFlags = [] as RouteLeg['riskFlags']
  if (!matched?.usable) riskFlags.push('UNVERIFIED')
  if ((matched?.value.transferCount ?? 0) > 0) riskFlags.push('TRANSFER')
  if (matched?.value.overnightArrival) riskFlags.push('OVERNIGHT_ARRIVAL')
  return {
    routeId: input.routeId,
    legId: stableId('leg', `${input.routeId}\n${input.index + 1}\n${fromCity}\n${toCity}`),
    from: input.fromNode
      ? { kind: 'NODE', nodeId: input.fromNode.nodeId }
      : { kind: 'ORIGIN', city: input.originCity },
    to: input.toNode
      ? { kind: 'NODE', nodeId: input.toNode.nodeId }
      : { kind: 'ORIGIN', city: input.originCity },
    fromCity,
    toCity,
    travelDate,
    mode: matched?.value.mode ?? 'UNKNOWN',
    label: matched?.value.label ?? `${fromCity}→${toCity}（待补证）`,
    durationMinutes: matched?.value.durationMinutes ?? null,
    costCents: matched?.value.costCents ?? null,
    transferCount: matched?.value.transferCount ?? 0,
    verificationStatus: matched?.usable ? matched.claim.verificationStatus : 'UNVERIFIED',
    claimIds: matched ? [matched.claim.claimId] : [],
    riskFlags,
    critical: true
  }
}

function routeEvidence(sessionId: string, claims: EvidenceClaim[], nowMs: number): RouteEvidence[] {
  return claims.flatMap((claim) => {
    if (claim.sessionId !== sessionId || claim.predicate !== 'routeLeg') return []
    const parsed = RouteLegEvidenceValueSchema.safeParse(claim.value)
    if (!parsed.success) return []
    return [
      {
        claim,
        value: parsed.data,
        usable:
          USABLE_STATUSES.has(claim.verificationStatus) &&
          parsed.data.durationMinutes !== null &&
          Date.parse(claim.validUntil) >= nowMs &&
          claim.conflictsWith.length === 0
      }
    ]
  })
}

function kunmingVariants(
  order: string[],
  mandatoryByCity: Map<string, string[]>,
  goal: ItineraryGoal,
  profile: RouteProfile,
  evidence: RouteEvidence[]
): Array<{ topology: TopologyNode[]; reason: string }> {
  if (mandatoryByCity.has('昆明') || order.length >= 6) return []
  const baseTopology: TopologyNode[] = order.map((city) => ({
    city,
    mandatoryPlaceIds: mandatoryByCity.get(city) ?? [],
    kind: 'STAY'
  }))
  const nights = allocateNights(goal.totalNights, baseTopology, profile)
  const dates: string[] = []
  let cursor = goal.startDate
  for (const nightCount of nights) {
    dates.push(cursor)
    cursor = addDays(cursor, nightCount)
  }
  const endpoints = [goal.originCity, ...order, goal.originCity]
  const variants: Array<{ topology: TopologyNode[]; reason: string }> = []
  for (let position = 0; position < endpoints.length - 1; position += 1) {
    const fromCity = endpoints[position]!
    const toCity = endpoints[position + 1]!
    const travelDate = position < dates.length ? dates[position]! : goal.endDate
    const direct = bestUsableEvidence(evidence, fromCity, toCity, travelDate)
    const first = bestUsableEvidence(evidence, fromCity, '昆明', travelDate)
    const second = bestUsableEvidence(evidence, '昆明', toCity, travelDate)
    if (!first?.value.durationMinutes || !second?.value.durationMinutes) continue
    const viaMinutes = first.value.durationMinutes + second.value.durationMinutes
    const directMinutes = direct?.value.durationMinutes
    if (directMinutes !== null && directMinutes !== undefined && viaMinutes >= directMinutes)
      continue
    variants.push({
      topology: [
        ...baseTopology.slice(0, position),
        { city: '昆明', mandatoryPlaceIds: [], kind: 'TRANSIT' },
        ...baseTopology.slice(position)
      ],
      reason:
        directMinutes === null || directMinutes === undefined
          ? `已有证据覆盖 ${fromCity}→昆明→${toCity}，而直连关键腿仍缺失。`
          : `已有证据显示经昆明约 ${viaMinutes} 分钟，少于直连约 ${directMinutes} 分钟。`
    })
  }
  return variants
}

function bestUsableEvidence(
  evidence: RouteEvidence[],
  fromCity: string,
  toCity: string,
  travelDate: string
): RouteEvidence | undefined {
  return evidence
    .filter(
      (item) =>
        item.usable &&
        normalize(item.value.fromCity) === normalize(fromCity) &&
        normalize(item.value.toCity) === normalize(toCity) &&
        item.value.travelDate === travelDate
    )
    .sort((left, right) => compareEvidence(left, right, 'BALANCED'))[0]
}

function allocateNights(
  totalNights: number,
  topology: TopologyNode[],
  profile: RouteProfile
): number[] {
  const result: number[] = topology.map((node) => (node.kind === 'STAY' ? 1 : 0))
  const stayIndexes = result.flatMap((nights, index) => (nights === 1 ? [index] : []))
  let remaining = totalNights - stayIndexes.length
  const order =
    profile === 'BALANCED'
      ? stayIndexes
      : profile === 'LOW_TRANSIT'
        ? [...stayIndexes].reverse()
        : [...stayIndexes.slice(1), stayIndexes[0]!]
  let cursor = 0
  while (remaining > 0) {
    const index = order[cursor % order.length]!
    result[index] = (result[index] ?? 0) + 1
    remaining -= 1
    cursor += 1
  }
  return result
}

function compareCandidates(left: RouteCandidate, right: RouteCandidate): number {
  const leftKey = candidateRankKey(left)
  const rightKey = candidateRankKey(right)
  for (let index = 0; index < leftKey.length; index += 1) {
    const delta = (leftKey[index] ?? 0) - (rightKey[index] ?? 0)
    if (delta !== 0) return delta
  }
  return left.routeId.localeCompare(right.routeId, 'zh-CN')
}

function candidateRankKey(candidate: RouteCandidate): number[] {
  return [
    candidate.score.hardConstraintPass ? 0 : 1,
    candidate.score.criticalEvidenceComplete ? 0 : 1,
    candidate.score.unverifiedLegCount,
    candidate.score.overnightArrivalCount,
    candidate.score.transferCount,
    candidate.score.transitMinutes ?? Number.MAX_SAFE_INTEGER,
    candidate.score.backtrackingScore,
    riskRank(candidate.score.staminaRisk),
    riskRank(candidate.score.altitudeRisk),
    candidate.score.costComplete ? 0 : 1,
    candidate.score.knownCostCents ?? Number.MAX_SAFE_INTEGER
  ]
}

function compareEvidence(left: RouteEvidence, right: RouteEvidence, profile: RouteProfile): number {
  const leftKey = evidenceRankKey(left, profile)
  const rightKey = evidenceRankKey(right, profile)
  for (let index = 0; index < leftKey.length; index += 1) {
    const delta = (leftKey[index] ?? 0) - (rightKey[index] ?? 0)
    if (delta !== 0) return delta
  }
  return left.claim.claimId.localeCompare(right.claim.claimId)
}

function evidenceRankKey(evidence: RouteEvidence, profile: RouteProfile): number[] {
  const duration = evidence.value.durationMinutes ?? Number.MAX_SAFE_INTEGER
  const overnight = evidence.value.overnightArrival ? 1 : 0
  if (profile === 'RELAXED') {
    return [evidence.usable ? 0 : 1, overnight, evidence.value.transferCount, duration]
  }
  if (profile === 'LOW_TRANSIT') {
    return [evidence.usable ? 0 : 1, duration, evidence.value.transferCount, overnight]
  }
  return [evidence.usable ? 0 : 1, evidence.value.transferCount, overnight, duration]
}

function mandatoryPlacesByCity(goal: ItineraryGoal): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const place of goal.mandatoryPlaces) {
    const city = normalize(place.nodeCity)
    result.set(city, [...(result.get(city) ?? []), place.placeId].sort(compareText))
  }
  return result
}

function permutations<T>(values: T[]): T[][] {
  if (values.length <= 1) return [values]
  return values.flatMap((value, index) =>
    permutations([...values.slice(0, index), ...values.slice(index + 1)]).map((tail) => [
      value,
      ...tail
    ])
  )
}

function addCandidate(map: Map<RouteProfile, RouteCandidate[]>, candidate: RouteCandidate): void {
  const group = map.get(candidate.profile) ?? []
  const signature = candidateSignature(candidate)
  if (!group.some((item) => candidateSignature(item) === signature)) group.push(candidate)
  map.set(candidate.profile, group)
}

function candidateSignature(candidate: RouteCandidate): string {
  return `${candidate.nodes
    .map((node) => `${normalize(node.city)}:${node.nodeKind}:${node.nights}`)
    .join('|')}::${candidate.legs.map((leg) => leg.mode).join('>')}`
}

function materialDifferences(
  profile: RouteProfile,
  nodes: RouteNode[],
  transferCount: number
): string[] {
  const profileText =
    profile === 'BALANCED'
      ? '综合平衡：在途、换乘、体力和停留夜数共同排序。'
      : profile === 'LOW_TRANSIT'
        ? '低在途：优先较短交通时间，再比较换乘。'
        : '舒缓适配：优先减少夜间到达和换乘，并保留连续停留。'
  return [
    profileText,
    `城市顺序：${nodes.map((node) => node.city).join('→')}。`,
    `已知换乘次数：${transferCount}。`
  ]
}

function addRelativeMaterialDifferences(candidates: RouteCandidate[]): RouteCandidate[] {
  return candidates.map((candidate) => {
    const strengths = [profileStrength(candidate.profile)]
    const tradeoffs: string[] = []
    const unknowns: string[] = []
    const compareNumber = (label: string, value: number, values: number[], unit: string): void => {
      const minimum = Math.min(...values)
      const maximum = Math.max(...values)
      if (minimum === maximum) return
      if (value === minimum) strengths.push(`${label}最低（${value}${unit}）`)
      else tradeoffs.push(`${label}高于当前最低方案（${value}${unit}，最低 ${minimum}${unit}）`)
    }

    compareNumber(
      '未核验交通腿',
      candidate.score.unverifiedLegCount,
      candidates.map((item) => item.score.unverifiedLegCount),
      ' 条'
    )
    compareNumber(
      '折返分',
      candidate.score.backtrackingScore,
      candidates.map((item) => item.score.backtrackingScore),
      ''
    )

    if (candidates.every((item) => item.score.criticalEvidenceComplete)) {
      compareNumber(
        '换乘次数',
        candidate.score.transferCount,
        candidates.map((item) => item.score.transferCount),
        ' 次'
      )
      compareNumber(
        '夜间到达',
        candidate.score.overnightArrivalCount,
        candidates.map((item) => item.score.overnightArrivalCount),
        ' 次'
      )
      const transitValues = candidates.map((item) => item.score.transitMinutes)
      if (transitValues.every((value): value is number => value !== null)) {
        compareNumber('总在途', candidate.score.transitMinutes!, transitValues, ' 分钟')
      }
      compareRisk(
        '体力风险',
        candidate.score.staminaRisk,
        candidates.map((item) => item.score.staminaRisk),
        strengths,
        tradeoffs
      )
    }

    compareRisk(
      '海拔风险',
      candidate.score.altitudeRisk,
      candidates.map((item) => item.score.altitudeRisk),
      strengths,
      tradeoffs
    )

    if (candidates.every((item) => item.score.costComplete && item.score.knownCostCents !== null)) {
      const costValues = candidates.map((item) => item.score.knownCostCents!)
      const minimumCost = Math.min(...costValues)
      const maximumCost = Math.max(...costValues)
      if (minimumCost !== maximumCost) {
        const currentCost = candidate.score.knownCostCents!
        if (currentCost === minimumCost) {
          strengths.push(`总费用最低（¥${(currentCost / 100).toFixed(0)}）`)
        } else {
          tradeoffs.push(
            `总费用高于当前最低方案（¥${(currentCost / 100).toFixed(0)}，最低 ¥${(
              minimumCost / 100
            ).toFixed(0)}）`
          )
        }
      }
    }

    if (!candidate.score.hardConstraintPass) tradeoffs.push('硬约束未通过')
    if (!candidate.score.criticalEvidenceComplete) unknowns.push('关键交通证据不完整')
    if (candidate.score.unverifiedLegCount > 0) {
      unknowns.push(`${candidate.score.unverifiedLegCount} 条交通腿未核验`)
    }
    if (candidate.score.transitMinutes === null) unknowns.push('总在途时间 UNKNOWN')
    if (candidate.score.altitudeRisk === 'UNKNOWN') unknowns.push('海拔风险 UNKNOWN')
    if (!candidate.score.costComplete) unknowns.push('费用 UNKNOWN')

    return RouteCandidateSchema.parse({
      ...candidate,
      materialDifferences: [
        ...candidate.materialDifferences,
        `优势：${strengths.join('；')}。`,
        ...(tradeoffs.length > 0 ? [`代价：${tradeoffs.join('；')}。`] : []),
        ...(unknowns.length > 0 ? [`未知：${unknowns.join('；')}。`] : [])
      ]
    })
  })
}

function profileStrength(profile: RouteProfile): string {
  if (profile === 'LOW_TRANSIT') return '优先压低已核验在途时间与换乘'
  if (profile === 'RELAXED') return '优先减少夜间到达和换乘，并保留连续停留'
  return '综合考虑在途、换乘、体力和停留夜数'
}

function compareRisk(
  label: string,
  value: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN',
  values: Array<'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN'>,
  strengths: string[],
  tradeoffs: string[]
): void {
  if (values.includes('UNKNOWN')) return
  const ranks = values.map(riskRank)
  const minimum = Math.min(...ranks)
  const maximum = Math.max(...ranks)
  if (minimum === maximum) return
  if (riskRank(value) === minimum) strengths.push(`${label}最低（${value}）`)
  else tradeoffs.push(`${label}高于当前最低方案（${value}）`)
}

function altitudeRiskFor(nodes: RouteNode[]): 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN' {
  const lijiang = nodes.find((node) => normalize(node.city) === '丽江')
  if (!lijiang) return 'UNKNOWN'
  if (lijiang.nights < 2) return 'HIGH'
  if (lijiang.nights === 2) return 'MEDIUM'
  return 'LOW'
}

function staminaRiskFor(
  profile: RouteProfile,
  transferCount: number,
  overnightArrivalCount: number
): 'LOW' | 'MEDIUM' | 'HIGH' {
  const score = transferCount + overnightArrivalCount * 2 + (profile === 'RELAXED' ? -1 : 0)
  if (score <= 0) return 'LOW'
  if (score <= 3) return 'MEDIUM'
  return 'HIGH'
}

function riskRank(value: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN'): number {
  return value === 'LOW' ? 0 : value === 'MEDIUM' ? 1 : value === 'HIGH' ? 2 : 3
}

function isUsableStatus(status: RouteLeg['verificationStatus']): boolean {
  return USABLE_STATUSES.has(status)
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 24)}`
}

function normalize(value: string): string {
  return value.normalize('NFKC').trim()
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, 'zh-CN')
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10)
}

function daysBetween(start: string, end: string): number {
  return Math.floor(
    (Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / 86_400_000
  )
}
