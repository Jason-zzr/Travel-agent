import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { Context } from 'cordis'
import { AppError } from '../shared/errors'
import type { EvidenceClaim } from '../shared/schema/evidence'
import {
  ItineraryGoalSchema,
  RouteCandidatesPreparedPayloadSchema,
  type ItineraryGoal,
  type ManualRouteLegEvidenceRequest,
  type RouteLeg,
  type RouteLegEvidenceValue
} from '../shared/schema/itinerary'
import { TravelBasicsSchema, type TravelBasics } from '../shared/schema/interview'
import {
  SessionEventSchema,
  type SessionEvent,
  type SessionEventDraft
} from '../shared/schema/session-event'
import type { TravelState } from '../shared/schema/travel-state'
import { CoordinatorService } from './plugins/coordinator'
import { applyMigrations } from './db/migrate'
import { SourceRepository } from './db/source-repository'
import { createAppPaths } from './paths'
import { eventLogPlugin } from './plugins/event-log'
import { reduceTravelState, travelStatePlugin } from './plugins/travel-state'
import { assessM0Envelope } from './skills/s02-envelope'
import {
  buildMultiCityRouteCandidates,
  buildMultiCityRouteSourcePlan,
  deriveMultiCityItineraryGoal
} from './skills/s03-route-candidates'

const SESSION_ID = 'route-session'
const NOW = '2026-08-30T12:00:00.000Z'
const CITIES = ['广州', '大理', '丽江', '西双版纳'] as const

const GOAL: ItineraryGoal = ItineraryGoalSchema.parse({
  regionGoal: '云南',
  originCity: '广州',
  startDate: '2026-09-08',
  endDate: '2026-09-17',
  totalDays: 10,
  totalNights: 9,
  travelers: [
    {
      count: 2,
      ageBand: 'ADULT',
      relationship: '家人',
      stamina: 'MEDIUM',
      careNeeds: [],
      functionalLimits: []
    },
    {
      count: 1,
      ageBand: 'CHILD',
      relationship: '孩子',
      stamina: 'MEDIUM',
      careNeeds: [],
      functionalLimits: []
    }
  ],
  budget: {
    currency: 'CNY',
    basis: 'TOTAL',
    targetMinor: 30_000_00,
    flexibleRangeMinor: null,
    hardCapMinor: null,
    inclusions: ['TRANSPORT', 'ACCOMMODATION']
  },
  intensity: 'RELAXED',
  mandatoryPlaces: [
    { placeId: 'must-erhai', displayName: '洱海', nodeCity: '大理' },
    { placeId: 'must-yulong', displayName: '玉龙雪山', nodeCity: '丽江' },
    { placeId: 'must-banna', displayName: '西双版纳', nodeCity: '西双版纳' }
  ]
})

function routeBasics(withIntent: boolean): TravelBasics {
  return TravelBasicsSchema.parse({
    originCities: ['广州'],
    originGatewayCity: '广州',
    originPlaceLabel: '广州市区',
    destinationCities: ['丽江', '西双版纳', '大理'],
    destinationIntent: null,
    travelers: GOAL.travelers,
    dates: { kind: 'FIXED', startDate: GOAL.startDate, endDate: GOAL.endDate },
    budget: GOAL.budget,
    intensity: GOAL.intensity,
    preferences: { hardConstraints: [], softPreferences: [], negotiableVariables: [] },
    staySegments: 3,
    itineraryIntent: withIntent
      ? {
          kind: 'MULTI_CITY_ROUTE',
          regionGoal: '云南',
          mandatoryPlaces: GOAL.mandatoryPlaces
        }
      : undefined
  })
}

function evidenceFor(cities: readonly string[], includeKunming = false): EvidenceClaim[] {
  const allCities = includeKunming ? [...cities, '昆明'] : [...cities]
  const dates = Array.from({ length: 10 }, (_, index) =>
    new Date(Date.UTC(2026, 8, 8 + index)).toISOString().slice(0, 10)
  )
  const claims: EvidenceClaim[] = []
  let index = 0
  for (const date of dates) {
    for (const fromCity of allCities) {
      for (const toCity of allCities) {
        if (fromCity === toCity) continue
        index += 1
        const involvesKunming = fromCity === '昆明' || toCity === '昆明'
        const involvesBanna = fromCity === '西双版纳' || toCity === '西双版纳'
        const durationMinutes = involvesKunming
          ? 60
          : 240 + Math.abs(fromCity.length - toCity.length)
        const value: RouteLegEvidenceValue = {
          fromCity,
          toCity,
          travelDate: date,
          mode: involvesBanna ? 'MANUAL_FLIGHT' : 'RAIL',
          label: `${fromCity}→${toCity}`,
          durationMinutes,
          costCents: null,
          transferCount: 0,
          overnightArrival: false
        }
        claims.push({
          claimId: `route-claim-${index}`,
          sessionId: SESSION_ID,
          subject: `${date} ${fromCity}→${toCity}`,
          predicate: 'routeLeg',
          value,
          sourceId: involvesBanna ? 'USER_RESEARCH' : 'SRC_RAIL',
          sourceRef: `route-fixture:${index}`,
          contentIdentity: involvesBanna ? 'OFFICIAL' : 'TRANSACTION',
          verificationStatus: involvesBanna ? 'VERIFIED_BY_USER' : 'VERIFIED',
          observedAt: NOW,
          validUntil: '2026-09-18T00:00:00.000Z',
          confidence: null,
          conflictsWith: [],
          notes: null
        })
      }
    }
  }
  return claims
}

async function createCoordinatorHarness(
  discover: (input: {
    direction: 'OUTBOUND' | 'RETURN'
    date: string
    fromStation: string
    toStation: string
  }) => Promise<
    Array<{
      direction: 'OUTBOUND' | 'RETURN'
      trainNo: string
      serviceDate: string
      fromStation: string
      toStation: string
      departureTime: string
      arrivalTime: string
      startAt: string
      endAt: string | null
      title: string
    }>
  >
): Promise<{
  coordinator: CoordinatorService
  events: SessionEvent[]
  getSourceCalls(): number
  state(): TravelState
}> {
  let state: TravelState | undefined
  const events: SessionEvent[] = []
  let sequence = 0
  let sourceCalls = 0
  const record = async (draft: SessionEventDraft): Promise<SessionEvent> => {
    sequence += 1
    const event = SessionEventSchema.parse({
      ...draft,
      eventId: `harness-route-event-${sequence}`,
      seq: sequence,
      timestamp: new Date(Date.parse(NOW) + sequence * 1_000).toISOString()
    })
    state = reduceTravelState(state, event)
    events.push(event)
    return event
  }
  await record({
    sessionId: SESSION_ID,
    eventVersion: 2,
    type: 'session/created',
    payload: {
      title: '云南十日路线',
      linkedSessionGroup: null,
      splitIndex: null,
      basics: null,
      handoffs: []
    }
  })
  await record({
    sessionId: SESSION_ID,
    eventVersion: 2,
    type: 'basics/updated',
    payload: { basics: routeBasics(true), interviewTurns: 1, destinationResearchRequired: false }
  })
  await record({
    sessionId: SESSION_ID,
    eventVersion: 2,
    type: 'stage/confirmed',
    payload: { fromStage: 'STAGE_1', toStage: 'STAGE_2', confirmed: true }
  })
  const context = {
    provider: {},
    travelState: {
      get: (sessionId: string) => (sessionId === SESSION_ID ? state : undefined),
      record
    },
    eventLog: {
      read: async (sessionId: string) => (sessionId === SESSION_ID ? events : [])
    },
    tools: {
      listEvidence: () => [],
      cancelOperation: async () => true,
      discoverRailOptionsBatch: async (
        inputs: Array<{
          direction: 'OUTBOUND' | 'RETURN'
          date: string
          fromStation: string
          toStation: string
        }>,
        _operationId: string,
        onSettled?: (completed: number, total: number) => void
      ) => {
        const outcomes: Array<Record<string, unknown>> = []
        for (const input of inputs) {
          sourceCalls += 1
          try {
            outcomes.push({ ok: true, request: input, options: await discover(input) })
          } catch (error) {
            if (error instanceof AppError && error.code === 'SOURCE_CANCELLED') throw error
            outcomes.push({ ok: false, request: input, error })
          }
          onSettled?.(outcomes.length, inputs.length)
        }
        return outcomes
      }
    }
  } as unknown as Context
  return {
    coordinator: new CoordinatorService(context),
    events,
    getSourceCalls: () => sourceCalls,
    state: () => state!
  }
}

test('strict multi-city intent keeps the 10-day route in one envelope', () => {
  const accepted = assessM0Envelope(routeBasics(true))
  assert.equal(accepted.withinEnvelope, true)
  assert.equal(accepted.canSplit, false)

  const legacy = assessM0Envelope(routeBasics(false))
  assert.equal(legacy.withinEnvelope, false)
  assert.equal(legacy.canSplit, true)
  assert.deepEqual(
    legacy.violations.map((violation) => violation.dimension),
    ['DESTINATION_COUNT', 'DURATION', 'STAY_SEGMENTS']
  )
})

test('multi-city goal uses the canonical gateway and never substitutes a precise place label', () => {
  const basics = routeBasics(true)
  const goal = deriveMultiCityItineraryGoal(basics)
  assert.equal(goal.originCity, '广州')
  assert.equal(goal.originPlaceLabel, '广州市区')

  const legacyFields = { ...basics }
  delete legacyFields.originGatewayCity
  delete legacyFields.originPlaceLabel
  const legacy = TravelBasicsSchema.parse(legacyFields)
  assert.equal(legacy.originGatewayCity, undefined)
  assert.equal(legacy.originPlaceLabel, undefined)

  assert.throws(
    () =>
      deriveMultiCityItineraryGoal({
        ...basics,
        originCities: ['广州白云国际机场 T2'],
        originGatewayCity: null,
        originPlaceLabel: '广州白云国际机场 T2'
      }),
    (error: unknown) => error instanceof AppError && error.code === 'GATE_BLOCKED'
  )
})

test('route engine returns three deterministic profiles and one recommendation', () => {
  const input = {
    sessionId: SESSION_ID,
    goal: GOAL,
    claims: evidenceFor(CITIES),
    now: NOW
  }
  const first = buildMultiCityRouteCandidates(input)
  const second = buildMultiCityRouteCandidates(input)

  assert.deepEqual(second, first)
  assert.equal(first.candidates.length, 3)
  assert.deepEqual(first.candidates.map((candidate) => candidate.profile).sort(), [
    'BALANCED',
    'LOW_TRANSIT',
    'RELAXED'
  ])
  assert.equal(first.candidates.filter((candidate) => candidate.isRecommended).length, 1)
  assert.deepEqual(first.blockingReasons, [])
  for (const candidate of first.candidates) {
    assert.equal(
      candidate.nodes.reduce((sum, node) => sum + node.nights, 0),
      9
    )
    assert.equal(candidate.legs.length, candidate.nodes.length + 1)
    assert.equal(candidate.score.costComplete, false)
    assert.equal(candidate.score.knownCostCents, null)
    assert.equal(
      candidate.materialDifferences.some((difference) => difference.startsWith('优势：')),
      true
    )
    assert.equal(
      candidate.materialDifferences.some(
        (difference) => difference.startsWith('未知：') && difference.includes('费用 UNKNOWN')
      ),
      true
    )
    assert.equal(
      candidate.materialDifferences.some(
        (difference) => difference.includes('总费用最低') || difference.includes('总费用高于')
      ),
      false
    )
    assert.ok(candidate.materialDifferences.length <= 12)
    assert.deepEqual(
      new Set(candidate.nodes.flatMap((node) => node.mandatoryPlaceIds)),
      new Set(['must-erhai', 'must-yulong', 'must-banna'])
    )
  }
})

test('route engine fails closed when it cannot produce three materially different profiles', () => {
  const shortGoal = ItineraryGoalSchema.parse({
    ...GOAL,
    endDate: '2026-09-10',
    totalDays: 3,
    totalNights: 2,
    mandatoryPlaces: GOAL.mandatoryPlaces.slice(0, 2)
  })
  assert.throws(
    () =>
      buildMultiCityRouteCandidates({
        sessionId: SESSION_ID,
        goal: shortGoal,
        claims: [],
        now: NOW
      }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'GATE_BLOCKED' &&
      error.message.includes('不足三条')
  )
})

test('complete route costs compare in yuan and never expose the internal cents unit', () => {
  const pricedClaims = evidenceFor(CITIES).map((claim, index) => ({
    ...claim,
    value: {
      ...(claim.value as RouteLegEvidenceValue),
      costCents: (index + 1) * 100
    }
  }))
  const result = buildMultiCityRouteCandidates({
    sessionId: SESSION_ID,
    goal: GOAL,
    claims: pricedClaims,
    now: NOW
  })
  assert.equal(
    result.candidates.every((candidate) => candidate.score.costComplete),
    true
  )
  assert.equal(
    result.candidates.some((candidate) =>
      candidate.materialDifferences.some((difference) => difference.includes('总费用'))
    ),
    true
  )
  assert.equal(
    result.candidates.some((candidate) =>
      candidate.materialDifferences.some((difference) => /总费用.*\d+ 分/.test(difference))
    ),
    false
  )
})

test('unknown critical legs remain visible and block every recommendation', () => {
  const claims = evidenceFor(CITIES).filter((claim) => {
    const value = claim.value as { fromCity?: string; toCity?: string }
    return value.fromCity !== '西双版纳' && value.toCity !== '西双版纳'
  })
  const result = buildMultiCityRouteCandidates({
    sessionId: SESSION_ID,
    goal: GOAL,
    claims,
    now: NOW
  })

  assert.equal(
    result.candidates.every((candidate) => !candidate.isRecommended),
    true
  )
  assert.equal(
    result.candidates.every((candidate) => candidate.blockingReasons.length > 0),
    true
  )
  assert.equal(result.blockingReasons.length, 2)
  assert.equal(result.candidates.length, 3)
  for (const candidate of result.candidates) {
    assert.equal(
      candidate.materialDifferences.some(
        (difference) =>
          difference.startsWith('未知：') &&
          difference.includes('关键交通证据不完整') &&
          difference.includes('交通腿未核验')
      ),
      true
    )
  }
})

test('Kunming appears only when verified via evidence improves a direct leg', () => {
  const withoutEvidence = buildMultiCityRouteCandidates({
    sessionId: SESSION_ID,
    goal: GOAL,
    claims: evidenceFor(CITIES),
    now: NOW
  })
  assert.equal(
    withoutEvidence.candidates.some((candidate) => candidate.kunmingDecision.included),
    false
  )

  const withEvidence = buildMultiCityRouteCandidates({
    sessionId: SESSION_ID,
    goal: GOAL,
    claims: evidenceFor(CITIES, true),
    now: NOW
  })
  assert.equal(
    withEvidence.candidates.some((candidate) => candidate.kunmingDecision.included),
    true
  )
})

test('coordinator preview is zero-call, execution is one-shot, and selection advances atomically', async () => {
  let state: TravelState | undefined
  const events: SessionEvent[] = []
  let sequence = 0
  const record = async (draft: SessionEventDraft): Promise<SessionEvent> => {
    sequence += 1
    const event = SessionEventSchema.parse({
      ...draft,
      eventId: `route-event-${sequence}`,
      seq: sequence,
      timestamp: new Date(Date.parse(NOW) + sequence * 1_000).toISOString()
    })
    state = reduceTravelState(state, event)
    events.push(event)
    return event
  }
  await record({
    sessionId: SESSION_ID,
    eventVersion: 2,
    type: 'session/created',
    payload: {
      title: '云南十日路线',
      linkedSessionGroup: null,
      splitIndex: null,
      basics: null,
      handoffs: []
    }
  })
  await record({
    sessionId: SESSION_ID,
    eventVersion: 2,
    type: 'basics/updated',
    payload: { basics: routeBasics(true), interviewTurns: 1, destinationResearchRequired: false }
  })
  await record({
    sessionId: SESSION_ID,
    eventVersion: 2,
    type: 'stage/confirmed',
    payload: { fromStage: 'STAGE_1', toStage: 'STAGE_2', confirmed: true }
  })

  let sourceCalls = 0
  const context = {
    provider: {},
    travelState: {
      get: (sessionId: string) => (sessionId === SESSION_ID ? state : undefined),
      record
    },
    tools: {
      listEvidence: () => [],
      cancelOperation: async () => true,
      discoverRailOptionsBatch: async (
        inputs: Array<{
          direction: 'OUTBOUND' | 'RETURN'
          date: string
          fromStation: string
          toStation: string
        }>,
        _operationId: string,
        onSettled?: (completed: number, total: number) => void
      ) => {
        const outcomes = inputs.map((input, index) => {
          sourceCalls += 1
          const options = [
            {
              direction: input.direction,
              trainNo: `G${sourceCalls.toString().padStart(4, '0')}`,
              serviceDate: input.date,
              fromStation: input.fromStation,
              toStation: input.toStation,
              departureTime: '08:00',
              arrivalTime: '10:00',
              startAt: `${input.date}T08:00:00+08:00`,
              endAt: `${input.date}T10:00:00+08:00`,
              title: `${input.fromStation}→${input.toStation}`
            }
          ]
          onSettled?.(index + 1, inputs.length)
          return { ok: true as const, request: input, options }
        })
        return outcomes
      }
    }
  } as unknown as Context
  const coordinator = new CoordinatorService(context)
  const preview = coordinator.previewMultiCityRoutes({ sessionId: SESSION_ID })
  assert.equal(sourceCalls, 0)
  assert.ok(preview.topologySignatures.length >= 2)
  assert.equal(preview.totalExternalCalls, 19)

  await assert.rejects(
    coordinator.executeMultiCityRoutes({
      sessionId: SESSION_ID,
      planId: preview.planId,
      digest: `sha256:${'0'.repeat(64)}`,
      operationId: '00000000-0000-4000-8000-000000000001'
    }),
    /摘要不匹配/
  )
  assert.equal(sourceCalls, 0)

  const operationId = '00000000-0000-4000-8000-000000000002'
  const snapshot = await coordinator.executeMultiCityRoutes({
    sessionId: SESSION_ID,
    planId: preview.planId,
    digest: preview.digest,
    operationId
  })
  assert.equal(sourceCalls, preview.totalExternalCalls)
  assert.equal(snapshot.candidates.length, 3)
  assert.equal(snapshot.candidates.filter((candidate) => candidate.isRecommended).length, 1)
  assert.equal(
    events.filter((event) => event.type === 'itinerary/route-candidates-prepared').length,
    1
  )

  const secondPreview = coordinator.previewMultiCityRoutes({ sessionId: SESSION_ID })
  await assert.rejects(
    coordinator.executeMultiCityRoutes({
      sessionId: SESSION_ID,
      planId: secondPreview.planId,
      digest: secondPreview.digest,
      operationId
    }),
    /已经使用/
  )
  assert.equal(sourceCalls, preview.totalExternalCalls)

  const recommended = snapshot.candidates.find((candidate) => candidate.isRecommended)!
  await assert.rejects(
    coordinator.selectMultiCityRoute({ sessionId: SESSION_ID, routeId: 'stale-route' }),
    /不属于当前候选集/
  )
  assert.equal(events.filter((event) => event.type === 'itinerary/route-selected').length, 0)
  const selected = await coordinator.selectMultiCityRoute({
    sessionId: SESSION_ID,
    routeId: recommended.routeId
  })
  assert.equal(selected.stage, 'STAGE_3')
  assert.equal(selected.selectedRouteId, recommended.routeId)
  assert.equal(events.filter((event) => event.type === 'itinerary/route-selected').length, 1)
  assert.equal(events.filter((event) => event.type === 'stage/confirmed').length, 1)
  await assert.rejects(
    coordinator.selectMultiCityRoute({ sessionId: SESSION_ID, routeId: recommended.routeId }),
    /STAGE-2/
  )
  assert.equal(events.filter((event) => event.type === 'itinerary/route-selected').length, 1)
})

test('partial route source failure persists successful claims and blocked candidates in one event', async () => {
  const harness = await createCoordinatorHarness(async (input) => {
    if (input.fromStation === '西双版纳' || input.toStation === '西双版纳') {
      throw new AppError('SOURCE_UNREACHABLE', 'fixture source unavailable')
    }
    return [
      {
        direction: input.direction,
        trainNo: 'G1000',
        serviceDate: input.date,
        fromStation: input.fromStation,
        toStation: input.toStation,
        departureTime: '08:00',
        arrivalTime: '10:00',
        startAt: `${input.date}T08:00:00+08:00`,
        endAt: `${input.date}T10:00:00+08:00`,
        title: `${input.fromStation}→${input.toStation}`
      }
    ]
  })
  const preview = harness.coordinator.previewMultiCityRoutes({ sessionId: SESSION_ID })
  const snapshot = await harness.coordinator.executeMultiCityRoutes({
    sessionId: SESSION_ID,
    planId: preview.planId,
    digest: preview.digest,
    operationId: '00000000-0000-4000-8000-000000000003'
  })

  assert.equal(harness.getSourceCalls(), preview.totalExternalCalls)
  assert.equal(
    snapshot.candidates.every((candidate) => !candidate.isRecommended),
    true
  )
  assert.equal(snapshot.blockingReasons.length > 0, true)
  const prepared = harness.events.find(
    (event) => event.type === 'itinerary/route-candidates-prepared'
  )
  assert.ok(prepared && prepared.type === 'itinerary/route-candidates-prepared')
  assert.equal(prepared.payload.finalClaims.length > 0, true)
  assert.equal(
    prepared.payload.sourceOutcomes.some((outcome) => outcome.status === 'FAILED'),
    true
  )
  assert.equal(
    harness.events.filter((event) => event.type === 'itinerary/route-candidates-prepared').length,
    1
  )
})

test('manual route-leg evidence recomputes locally, replays atomically, and duplicates are zero-write', async () => {
  const harness = await createCoordinatorHarness(async (input) => {
    if (input.fromStation === '西双版纳' || input.toStation === '西双版纳') {
      throw new AppError('SOURCE_UNREACHABLE', 'fixture source unavailable')
    }
    return [
      {
        direction: input.direction,
        trainNo: 'G2000',
        serviceDate: input.date,
        fromStation: input.fromStation,
        toStation: input.toStation,
        departureTime: '08:00',
        arrivalTime: '10:00',
        startAt: `${input.date}T08:00:00+08:00`,
        endAt: `${input.date}T10:00:00+08:00`,
        title: `${input.fromStation}→${input.toStation}`
      }
    ]
  })
  const preview = harness.coordinator.previewMultiCityRoutes({ sessionId: SESSION_ID })
  const blocked = await harness.coordinator.executeMultiCityRoutes({
    sessionId: SESSION_ID,
    planId: preview.planId,
    digest: preview.digest,
    operationId: '00000000-0000-4000-8000-000000000005'
  })
  const route = blocked.candidates[0]!
  const leg = route.legs.find(
    (candidate) => candidate.critical && candidate.verificationStatus === 'UNVERIFIED'
  )!
  const request = manualEvidenceRequest(route.routeId, leg, 1)
  const stateBefore = harness.state()
  const sourceCallsBefore = harness.getSourceCalls()
  const eventCountBefore = harness.events.length
  await assert.rejects(
    harness.coordinator.applyManualRouteLegEvidence({
      ...request,
      routeId: 'stale-route-id'
    }),
    (error: unknown) => error instanceof AppError && error.code === 'INPUT_INVALID'
  )
  await assert.rejects(
    harness.coordinator.applyManualRouteLegEvidence({
      ...request,
      startAt: '2026-09-01T08:20:00+08:00',
      endAt: '2026-09-01T10:35:00+08:00'
    }),
    (error: unknown) => error instanceof AppError && error.code === 'INPUT_INVALID'
  )
  assert.equal(harness.events.length, eventCountBefore)
  assert.equal(harness.getSourceCalls(), sourceCallsBefore)
  const applied = await harness.coordinator.applyManualRouteLegEvidence(request)

  assert.equal(harness.getSourceCalls(), sourceCallsBefore)
  const manualEvents = harness.events.filter(
    (event) => event.type === 'itinerary/route-manual-evidence-applied'
  )
  assert.equal(manualEvents.length, 1)
  const manualEvent = manualEvents[0]!
  assert.equal(manualEvent.type, 'itinerary/route-manual-evidence-applied')
  assert.deepEqual(manualEvent.payload.scope, {
    kind: 'ROUTE_GOAL_LEG',
    fromCity: leg.fromCity,
    toCity: leg.toCity,
    travelDate: leg.travelDate
  })
  assert.equal(manualEvent.payload.claim.sourceId, 'USER_RESEARCH')
  assert.equal(manualEvent.payload.claim.verificationStatus, 'VERIFIED_BY_USER')
  assert.deepEqual(applied.sourceOutcomes, blocked.sourceOutcomes)
  assert.equal(
    applied.candidates
      .find((candidate) => candidate.routeId === route.routeId)
      ?.legs.find((candidate) => candidate.legId === leg.legId)?.verificationStatus,
    'VERIFIED_BY_USER'
  )

  const replayed = reduceTravelState(stateBefore, manualEvent)
  assert.deepEqual(replayed.routeCandidates, harness.state().routeCandidates)
  assert.deepEqual(replayed.routeBlockingReasons, harness.state().routeBlockingReasons)
  assert.deepEqual(replayed.routeSourceOutcomes, harness.state().routeSourceOutcomes)

  const eventCount = harness.events.length
  const duplicate = await harness.coordinator.applyManualRouteLegEvidence(request)
  assert.equal(harness.events.length, eventCount)
  assert.deepEqual(duplicate, applied)
  assert.equal(harness.getSourceCalls(), sourceCallsBefore)

  let completed = duplicate
  for (let index = 2; index <= 8; index += 1) {
    const currentRoute = completed.candidates.find(
      (candidate) => candidate.routeId === route.routeId
    )!
    const missing = currentRoute.legs.find(
      (candidate) => candidate.critical && candidate.verificationStatus === 'UNVERIFIED'
    )
    if (!missing) break
    completed = await harness.coordinator.applyManualRouteLegEvidence(
      manualEvidenceRequest(route.routeId, missing, index)
    )
  }
  const completedRoute = completed.candidates.find(
    (candidate) => candidate.routeId === route.routeId
  )!
  assert.equal(completedRoute.score.criticalEvidenceComplete, true)
  assert.deepEqual(completedRoute.blockingReasons, [])
  assert.equal(completed.candidates.filter((candidate) => candidate.isRecommended).length, 1)
  assert.equal(harness.getSourceCalls(), sourceCallsBefore)
})

test('route cancellation aborts without a prepared event', async () => {
  const harness = await createCoordinatorHarness(async () => {
    throw new AppError('SOURCE_CANCELLED', 'fixture cancelled')
  })
  const preview = harness.coordinator.previewMultiCityRoutes({ sessionId: SESSION_ID })
  await assert.rejects(
    harness.coordinator.executeMultiCityRoutes({
      sessionId: SESSION_ID,
      planId: preview.planId,
      digest: preview.digest,
      operationId: '00000000-0000-4000-8000-000000000004'
    }),
    /cancelled/
  )
  assert.equal(harness.getSourceCalls(), 1)
  assert.equal(
    harness.events.filter((event) => event.type === 'itinerary/route-candidates-prepared').length,
    0
  )
})

test('migration 0007 projections rebuild from authoritative route events', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-route-replay-'))
  const paths = createAppPaths(root)
  const database = new Database(paths.database)
  const migrations = [
    '0001_init',
    '0002_model_call_cost',
    '0003_xiaohongshu_source',
    '0004_d5_transport_candidates',
    '0005_d7_task_links',
    '0006_user_research_source',
    '0007_multi_city_routes'
  ]
  applyMigrations(
    database,
    await Promise.all(
      migrations.map(async (name, index) => ({
        version: index + 1,
        sql: await readFile(new URL(`./db/migrations/${name}.sql`, import.meta.url), 'utf8')
      }))
    )
  )
  const context = new Context()
  context.plugin(eventLogPlugin, { paths })
  context.plugin(travelStatePlugin, { database, paths })
  await context.start()

  try {
    await context.travelState.record({
      sessionId: SESSION_ID,
      eventVersion: 2,
      type: 'session/created',
      payload: {
        title: '云南十日路线',
        linkedSessionGroup: null,
        splitIndex: null,
        basics: null,
        handoffs: []
      }
    })
    await context.travelState.record({
      sessionId: SESSION_ID,
      eventVersion: 2,
      type: 'basics/updated',
      payload: { basics: routeBasics(true), interviewTurns: 1, destinationResearchRequired: false }
    })
    await context.travelState.record({
      sessionId: SESSION_ID,
      eventVersion: 2,
      type: 'stage/confirmed',
      payload: { fromStage: 'STAGE_1', toStage: 'STAGE_2', confirmed: true }
    })
    const sourcePlan = buildMultiCityRouteSourcePlan(GOAL)
    const claims = sourcePlan.plannedCalls.map<EvidenceClaim>((call, index) => ({
      claimId: `projected-route-claim-${index + 1}`,
      sessionId: SESSION_ID,
      subject: `${call.travelDate} ${call.fromCity}→${call.toCity}`,
      predicate: 'routeLeg',
      value: {
        fromCity: call.fromCity,
        toCity: call.toCity,
        travelDate: call.travelDate,
        mode: 'RAIL',
        label: `${call.fromCity}→${call.toCity}`,
        durationMinutes: 120,
        costCents: null,
        transferCount: 0,
        overnightArrival: false
      },
      sourceId: 'SRC_RAIL',
      sourceRef: `route-projection:${call.callId}`,
      contentIdentity: 'TRANSACTION',
      verificationStatus: 'VERIFIED',
      observedAt: NOW,
      validUntil: '2026-09-18T00:00:00.000Z',
      confidence: null,
      conflictsWith: [],
      notes: null
    }))
    const result = buildMultiCityRouteCandidates({
      sessionId: SESSION_ID,
      goal: GOAL,
      claims,
      now: NOW
    })
    const payload = RouteCandidatesPreparedPayloadSchema.parse({
      goal: GOAL,
      candidates: result.candidates,
      sourceOutcomes: [],
      finalClaims: claims,
      blockingReasons: result.blockingReasons
    })
    await context.travelState.record({
      sessionId: SESSION_ID,
      eventVersion: 2,
      type: 'itinerary/route-candidates-prepared',
      payload
    })
    const chosen = result.candidates.find((candidate) => candidate.isRecommended)!
    await context.travelState.record({
      sessionId: SESSION_ID,
      eventVersion: 2,
      type: 'itinerary/route-selected',
      payload: {
        fromStage: 'STAGE_2',
        toStage: 'STAGE_3',
        confirmed: true,
        selectedRouteId: chosen.routeId,
        chosen,
        rejected: result.candidates
          .filter((candidate) => candidate.routeId !== chosen.routeId)
          .map((candidate) => ({
            routeId: candidate.routeId,
            profile: candidate.profile,
            reason: candidate.materialDifferences[0]!
          })),
        reason: '回放投影测试选择推荐路线。'
      }
    })

    const countsBefore = routeProjectionCounts(database)
    assert.equal(countsBefore.candidates, 3)
    assert.equal(countsBefore.selected, 1)
    assert.equal(countsBefore.selections, 1)
    assert.equal(countsBefore.claims, claims.length)
    assert.ok(countsBefore.nodes > 0 && countsBefore.legs > 0 && countsBefore.stays > 0)

    await context.travelState.rebuildSession(SESSION_ID)
    assert.deepEqual(routeProjectionCounts(database), countsBefore)
    const rebuilt = context.travelState.get(SESSION_ID)!
    assert.equal(rebuilt.stage, 'STAGE_3')
    assert.equal(rebuilt.selectedRouteId, chosen.routeId)
    assert.deepEqual(rebuilt.routeStaySegments, chosen.staySegments)
    const events = await context.eventLog.read(SESSION_ID)
    assert.equal(events.filter((event) => event.type === 'itinerary/route-selected').length, 1)
  } finally {
    await context.eventLog.close()
    database.close()
    await context.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('manual route JSONL rebuilds the same claim, candidates, blockers, and selection into fresh SQLite', async () => {
  const harness = await createCoordinatorHarness(async (input) => {
    if (input.fromStation === '西双版纳' || input.toStation === '西双版纳') {
      throw new AppError('SOURCE_UNREACHABLE', 'fixture source unavailable')
    }
    return [
      {
        direction: input.direction,
        trainNo: 'G3000',
        serviceDate: input.date,
        fromStation: input.fromStation,
        toStation: input.toStation,
        departureTime: '08:00',
        arrivalTime: '10:00',
        startAt: `${input.date}T08:00:00+08:00`,
        endAt: `${input.date}T10:00:00+08:00`,
        title: `${input.fromStation}→${input.toStation}`
      }
    ]
  })
  const preview = harness.coordinator.previewMultiCityRoutes({ sessionId: SESSION_ID })
  let snapshot = await harness.coordinator.executeMultiCityRoutes({
    sessionId: SESSION_ID,
    planId: preview.planId,
    digest: preview.digest,
    operationId: '00000000-0000-4000-8000-000000000006'
  })
  const routeId = snapshot.candidates[0]!.routeId
  for (let sequence = 1; sequence <= 8; sequence += 1) {
    const route = snapshot.candidates.find((candidate) => candidate.routeId === routeId)!
    const missing = route.legs.find(
      (candidate) => candidate.critical && candidate.verificationStatus === 'UNVERIFIED'
    )
    if (!missing) break
    snapshot = await harness.coordinator.applyManualRouteLegEvidence(
      manualEvidenceRequest(routeId, missing, sequence + 10)
    )
  }
  assert.equal(
    snapshot.candidates.find((candidate) => candidate.routeId === routeId)?.score
      .criticalEvidenceComplete,
    true
  )
  const selected = await harness.coordinator.selectMultiCityRoute({
    sessionId: SESSION_ID,
    routeId
  })
  assert.equal(selected.stage, 'STAGE_3')
  const expectedState = harness.state()

  const root = await mkdtemp(join(tmpdir(), 'travel-route-manual-replay-'))
  const paths = createAppPaths(root)
  const migrationNames = [
    '0001_init',
    '0002_model_call_cost',
    '0003_xiaohongshu_source',
    '0004_d5_transport_candidates',
    '0005_d7_task_links',
    '0006_user_research_source',
    '0007_multi_city_routes',
    '0008_node_scoped_d4',
    '0009_multi_segment_d5',
    '0010_unified_route_timeline'
  ]
  const migrations = await Promise.all(
    migrationNames.map(async (name, index) => ({
      version: index + 1,
      sql: await readFile(new URL(`./db/migrations/${name}.sql`, import.meta.url), 'utf8')
    }))
  )
  let database = new Database(paths.database)
  applyMigrations(database, migrations)
  let context = new Context()
  context.plugin(eventLogPlugin, { paths })
  context.plugin(travelStatePlugin, { database, paths })
  await context.start()

  try {
    for (const event of harness.events) await context.eventLog.ensurePlanned(event)
    const projected = await context.travelState.rebuildSession(SESSION_ID)
    assert.deepEqual(projected, expectedState)
    const expectedCounts = routeProjectionCounts(database)
    const expectedManualClaims = new SourceRepository(database)
      .listEvidence(SESSION_ID, 200)
      .filter((claim) => claim.sourceId === 'USER_RESEARCH' && claim.predicate === 'routeLeg')
    assert.ok(expectedManualClaims.length > 0)
    assert.ok(expectedManualClaims.every((claim) => claim.scope?.kind === 'ROUTE_GOAL_LEG'))

    await context.eventLog.close()
    database.close()
    await context.stop()
    await rm(paths.database, { force: true })
    await rm(`${paths.database}-wal`, { force: true })
    await rm(`${paths.database}-shm`, { force: true })

    database = new Database(paths.database)
    applyMigrations(database, migrations)
    context = new Context()
    context.plugin(eventLogPlugin, { paths })
    context.plugin(travelStatePlugin, { database, paths })
    await context.start()
    const rebuilt = await context.travelState.rebuildSession(SESSION_ID)
    assert.deepEqual(rebuilt, expectedState)
    assert.deepEqual(routeProjectionCounts(database), expectedCounts)
    assert.deepEqual(
      new SourceRepository(database)
        .listEvidence(SESSION_ID, 200)
        .filter((claim) => claim.sourceId === 'USER_RESEARCH' && claim.predicate === 'routeLeg'),
      expectedManualClaims
    )
    assert.equal(
      migrationNames.some((name) => name.startsWith('0011_')),
      false
    )
  } finally {
    await context.eventLog.close()
    database.close()
    await context.stop()
    await rm(root, { recursive: true, force: true })
  }
})

interface RouteProjectionCounts {
  candidates: number
  selected: number
  nodes: number
  legs: number
  stays: number
  selections: number
  claims: number
}

function routeProjectionCounts(database: Database.Database): RouteProjectionCounts {
  const count = (table: string, predicate = ''): number =>
    (
      database.prepare(`SELECT COUNT(*) AS count FROM ${table} ${predicate}`).get() as {
        count: number
      }
    ).count
  return {
    candidates: count('itinerary_route_candidates'),
    selected: count('itinerary_route_candidates', 'WHERE is_selected = 1'),
    nodes: count('itinerary_route_nodes'),
    legs: count('itinerary_route_legs'),
    stays: count('itinerary_route_stay_segments'),
    selections: count('itinerary_route_selections'),
    claims: count('evidence_claims', "WHERE predicate = 'routeLeg'")
  }
}

function manualEvidenceRequest(
  routeId: string,
  leg: RouteLeg,
  sequence: number
): ManualRouteLegEvidenceRequest {
  return {
    sessionId: SESSION_ID,
    routeId,
    legId: leg.legId,
    mode: 'MANUAL_FLIGHT',
    startAt: `${leg.travelDate}T08:20:00+08:00`,
    endAt: `${leg.travelDate}T10:35:00+08:00`,
    label: `用户核对航班 MU${2000 + sequence}`,
    costCents: 86000 + sequence,
    sourceLabel: '航司官网行程页',
    sourceUrl: `https://example.com/flight/MU${2000 + sequence}`,
    summary: '已核对出发日、起降城市和当地时间。',
    confirmed: true
  }
}
