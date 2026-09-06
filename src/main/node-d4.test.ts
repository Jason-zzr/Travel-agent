import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from 'cordis'
import { AppError } from '../shared/errors'
import { RouteResearchPreviewRequestSchema } from '../shared/schema/d4'
import type { EvidenceClaim } from '../shared/schema/evidence'
import {
  ItineraryGoalSchema,
  type ItineraryGoal,
  type RouteCandidate,
  type RouteLegEvidenceValue
} from '../shared/schema/itinerary'
import { TravelBasicsSchema, type TravelBasics } from '../shared/schema/interview'
import {
  SessionEventSchema,
  type SessionEvent,
  type SessionEventDraft
} from '../shared/schema/session-event'
import type { TravelState } from '../shared/schema/travel-state'
import { deterministicClaimId } from './mcp/evidence'
import { CoordinatorService } from './plugins/coordinator'
import {
  initializeRouteNodeResearchStates,
  reduceTravelState,
  summarizeRouteNodeResearchStates
} from './plugins/travel-state'
import { buildMultiCityRouteCandidates } from './skills/s03-route-candidates'

const SESSION_ID = 'node-d4-session'
const ROUTE_ID = 'route-yunnan-10d'
const NOW = '2026-08-31T00:00:00.000Z'

const CANDIDATE = {
  routeId: ROUTE_ID,
  nodes: [
    {
      routeId: ROUTE_ID,
      nodeId: 'node-dali',
      city: '大理',
      region: '云南',
      sequence: 1,
      arrivalDate: '2026-09-08',
      departureDate: '2026-09-11',
      nights: 3,
      nodeKind: 'STAY',
      mandatoryPlaceIds: ['must-erhai'],
      reason: '洱海节点'
    },
    {
      routeId: ROUTE_ID,
      nodeId: 'node-kunming',
      city: '昆明',
      region: '云南',
      sequence: 2,
      arrivalDate: '2026-09-11',
      departureDate: '2026-09-11',
      nights: 0,
      nodeKind: 'TRANSIT',
      mandatoryPlaceIds: [],
      reason: '只作交通中转'
    },
    {
      routeId: ROUTE_ID,
      nodeId: 'node-lijiang',
      city: '丽江',
      region: '云南',
      sequence: 3,
      arrivalDate: '2026-09-11',
      departureDate: '2026-09-14',
      nights: 3,
      nodeKind: 'STAY',
      mandatoryPlaceIds: ['must-yulong'],
      reason: '玉龙雪山节点'
    },
    {
      routeId: ROUTE_ID,
      nodeId: 'node-banna',
      city: '西双版纳',
      region: '云南',
      sequence: 4,
      arrivalDate: '2026-09-14',
      departureDate: '2026-09-17',
      nights: 3,
      nodeKind: 'STAY',
      mandatoryPlaceIds: ['must-banna'],
      reason: '西双版纳节点'
    }
  ]
} as RouteCandidate

function stateFixture(): TravelState {
  return {
    sessionId: SESSION_ID,
    stage: 'STAGE_3',
    lastSeq: 8,
    selectedRouteId: ROUTE_ID,
    routeCandidates: [CANDIDATE],
    routeNodeResearchStates: initializeRouteNodeResearchStates(SESSION_ID, CANDIDATE),
    basics: {
      itineraryIntent: {
        kind: 'MULTI_CITY_ROUTE',
        regionGoal: '云南',
        mandatoryPlaces: [
          { placeId: 'must-erhai', displayName: '洱海', nodeCity: '大理' },
          { placeId: 'must-yulong', displayName: '玉龙雪山', nodeCity: '丽江' },
          { placeId: 'must-banna', displayName: '西双版纳', nodeCity: '西双版纳' }
        ]
      }
    }
  } as TravelState
}

function coordinatorFixture(state: TravelState): {
  coordinator: CoordinatorService
  getSourceCalls(): number
  getModelCalls(): number
} {
  let sourceCalls = 0
  let modelCalls = 0
  const route = {
    channel: 'SHUAI_API',
    baseUrl: 'https://provider.example',
    model: 'fixture-model',
    currency: 'CNY',
    inputMinorPerMillion: null,
    outputMinorPerMillion: null
  }
  const context = {
    provider: {
      configSummary: async () => ({
        configured: true,
        version: 2,
        provider: null,
        baseUrl: null,
        models: null,
        routes: { EXTRACTION: route, PLANNING: route, REVIEW: route, VISION: route }
      }),
      generateStructured: async () => {
        modelCalls += 1
        throw new Error('preview must not call a model')
      }
    },
    travelState: {
      get: (sessionId: string) => (sessionId === SESSION_ID ? state : undefined),
      record: async () => {
        throw new Error('preview must not write')
      }
    },
    tools: {
      listEvidence: () => [],
      cancelOperation: async () => true,
      runRepresentativeQuery: async () => {
        sourceCalls += 1
        throw new Error('preview must not call a source')
      }
    }
  } as unknown as Context
  return {
    coordinator: new CoordinatorService(context),
    getSourceCalls: () => sourceCalls,
    getModelCalls: () => modelCalls
  }
}

test('route node initialization requires stays, skips optional transit and keeps stable order', () => {
  const states = initializeRouteNodeResearchStates(SESSION_ID, CANDIDATE)
  assert.deepEqual(
    states.map((item) => [item.scope.city, item.required, item.status]),
    [
      ['大理', true, 'NOT_STARTED'],
      ['昆明', false, 'SKIPPED'],
      ['丽江', true, 'NOT_STARTED'],
      ['西双版纳', true, 'NOT_STARTED']
    ]
  )
  assert.match(states[1]!.skipReason!, /中转/)
  assert.deepEqual(
    summarizeRouteNodeResearchStates([...states].reverse()).map((item) => item.scope.nodeId),
    ['node-dali', 'node-kunming', 'node-lijiang', 'node-banna']
  )
})

test('node scope prevents otherwise colliding deterministic Claim IDs', () => {
  const base = {
    sourceId: 'USER_PASTE' as const,
    sourceRef: 'user-paste:fixture',
    subject: '开放时间',
    predicate: 'manualResearchSummary'
  }
  const dali = deterministicClaimId({
    ...base,
    scope: { kind: 'ROUTE_NODE', routeId: ROUTE_ID, nodeId: 'node-dali' }
  })
  const lijiang = deterministicClaimId({
    ...base,
    scope: { kind: 'ROUTE_NODE', routeId: ROUTE_ID, nodeId: 'node-lijiang' }
  })
  assert.notEqual(dali, lijiang)
  assert.equal(deterministicClaimId(base), deterministicClaimId({ ...base, scope: null }))
})

test('node preview is strict, zero-call and frozen to the selected route node', async () => {
  const state = stateFixture()
  const harness = coordinatorFixture(state)
  const preview = await harness.coordinator.previewRouteNodeResearch({
    sessionId: SESSION_ID,
    routeId: ROUTE_ID,
    nodeId: 'node-dali',
    mode: 'STANDARD'
  })
  assert.equal(preview.scope.city, '大理')
  assert.equal(preview.totalExternalCalls, 7)
  assert.equal(preview.totalModelCalls, 2)
  assert.equal(preview.retryCount, 0)
  assert.equal(harness.getSourceCalls(), 0)
  assert.equal(harness.getModelCalls(), 0)
  assert.equal(
    harness.coordinator.routeNodeResearchSnapshot({
      sessionId: SESSION_ID,
      routeId: ROUTE_ID,
      nodeId: 'node-dali'
    }).nextRequiredNodeId,
    'node-dali'
  )

  await assert.rejects(
    harness.coordinator.previewRouteNodeResearch({
      sessionId: SESSION_ID,
      routeId: ROUTE_ID,
      nodeId: 'node-kunming',
      mode: 'STANDARD'
    }),
    (error: unknown) => error instanceof AppError && error.code === 'GATE_BLOCKED'
  )
  assert.equal(
    RouteResearchPreviewRequestSchema.safeParse({
      sessionId: SESSION_ID,
      routeId: ROUTE_ID,
      nodeId: 'node-dali',
      mode: 'STANDARD',
      extra: true
    }).success,
    false
  )
})

test('manual research confirms only its node and the final required node advances atomically', async () => {
  const goal = fullGoal()
  const built = buildMultiCityRouteCandidates({
    sessionId: SESSION_ID,
    goal,
    claims: fullRouteEvidence(),
    now: NOW
  })
  const chosen = built.candidates.find((candidate) => candidate.isRecommended)!
  let state: TravelState | undefined
  let sequence = 0
  const claims: EvidenceClaim[] = []
  const events: SessionEvent[] = []
  const record = async (draft: SessionEventDraft): Promise<SessionEvent> => {
    sequence += 1
    const event = SessionEventSchema.parse({
      ...draft,
      eventId: `node-replay-${sequence}`,
      seq: sequence,
      timestamp: new Date(Date.parse(NOW) + sequence * 1_000).toISOString()
    })
    state = reduceTravelState(state, event)
    if (event.type === 'research/node-checklist-prepared') {
      claims.push(...event.payload.finalClaims)
    }
    events.push(event)
    return event
  }
  await record({
    sessionId: SESSION_ID,
    eventVersion: 2,
    type: 'session/created',
    payload: {
      title: '云南节点研究',
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
    payload: { basics: fullBasics(goal), interviewTurns: 1, destinationResearchRequired: false }
  })
  await record({
    sessionId: SESSION_ID,
    eventVersion: 2,
    type: 'stage/confirmed',
    payload: { fromStage: 'STAGE_1', toStage: 'STAGE_2', confirmed: true }
  })
  await record({
    sessionId: SESSION_ID,
    eventVersion: 2,
    type: 'itinerary/route-candidates-prepared',
    payload: {
      goal,
      candidates: built.candidates,
      sourceOutcomes: [],
      finalClaims: [],
      blockingReasons: built.blockingReasons
    }
  })
  await record({
    sessionId: SESSION_ID,
    eventVersion: 2,
    type: 'itinerary/route-selected',
    payload: {
      fromStage: 'STAGE_2',
      toStage: 'STAGE_3',
      confirmed: true,
      selectedRouteId: chosen.routeId,
      chosen,
      rejected: built.candidates
        .filter((candidate) => candidate.routeId !== chosen.routeId)
        .map((candidate) => ({
          routeId: candidate.routeId,
          profile: candidate.profile,
          reason: '用户选择了推荐路线'
        })),
      reason: '测试节点研究'
    }
  })

  const context = {
    travelState: {
      get: (sessionId: string) => (sessionId === SESSION_ID ? state : undefined),
      record
    },
    tools: {
      listEvidence: () => claims,
      cancelOperation: async () => true
    }
  } as unknown as Context
  const coordinator = new CoordinatorService(context)
  const requiredNodes = state!.routeNodeResearchStates.filter((item) => item.required)
  const placeByCity = new Map(
    goal.mandatoryPlaces.map((place) => [place.nodeCity, place.displayName])
  )
  const checkedAt = new Date().toISOString()

  for (const [index, node] of requiredNodes.entries()) {
    const identity = {
      sessionId: SESSION_ID,
      routeId: chosen.routeId,
      nodeId: node.scope.nodeId
    }
    await coordinator.prepareManualRouteNodeResearch({
      ...identity,
      items: [
        {
          itemId: crypto.randomUUID(),
          subject: placeByCity.get(node.scope.city)!,
          kind: 'ATTRACTION',
          aliases: [],
          disposition: 'MUST_GO',
          sourceLabel: '用户逐项核验',
          sourceUrl: null,
          sourceClaimId: null,
          contentIdentity: 'OFFICIAL',
          summary: `${node.scope.city} 必去地点的人工核验摘要`,
          fitness: { status: 'FIT', reasons: ['可按成员体力调整'] },
          hardAnchors: [
            {
              kind: 'OPENING_HOURS',
              status: 'KNOWN',
              value: '以当日官方公告为准',
              checkedAt,
              confirmed: true
            },
            {
              kind: 'CLOSURE_SCHEDULE',
              status: 'KNOWN',
              value: '无固定闭园日，以官方公告为准',
              checkedAt,
              confirmed: true
            },
            {
              kind: 'RESERVATION_REQUIREMENT',
              status: 'KNOWN',
              value: '需要提前预约',
              checkedAt,
              confirmed: true
            }
          ],
          confirmed: true
        }
      ]
    })
    const preparedStates = state!.routeNodeResearchStates
    assert.equal(
      preparedStates.filter((item) => item.researchEntities.length > 0).length,
      index + 1
    )

    const confirmed = await coordinator.confirmRouteNodeResearch(identity)
    assert.equal(confirmed.routeResearchComplete, index === requiredNodes.length - 1)
    assert.equal(state!.stage, index === requiredNodes.length - 1 ? 'STAGE_4' : 'STAGE_3')
  }

  const confirmations = events.filter((event) => event.type === 'research/node-confirmed')
  assert.equal(confirmations.length, requiredNodes.length)
  assert.deepEqual(
    confirmations.map((event) => event.payload.transition !== null),
    requiredNodes.map((_node, index) => index === requiredNodes.length - 1)
  )
})

function fullGoal(): ItineraryGoal {
  return ItineraryGoalSchema.parse({
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
}

function fullBasics(goal: ItineraryGoal): TravelBasics {
  return TravelBasicsSchema.parse({
    originCities: ['广州'],
    destinationCities: ['大理', '丽江', '西双版纳'],
    destinationIntent: null,
    travelers: goal.travelers,
    dates: { kind: 'FIXED', startDate: goal.startDate, endDate: goal.endDate },
    budget: goal.budget,
    intensity: goal.intensity,
    preferences: { hardConstraints: [], softPreferences: [], negotiableVariables: [] },
    staySegments: 3,
    itineraryIntent: {
      kind: 'MULTI_CITY_ROUTE',
      regionGoal: goal.regionGoal,
      mandatoryPlaces: goal.mandatoryPlaces
    }
  })
}

function fullRouteEvidence(): EvidenceClaim[] {
  const cities = ['广州', '大理', '丽江', '西双版纳']
  const claims: EvidenceClaim[] = []
  let index = 0
  for (let day = 0; day < 10; day += 1) {
    const travelDate = new Date(Date.UTC(2026, 8, 8 + day)).toISOString().slice(0, 10)
    for (const fromCity of cities) {
      for (const toCity of cities) {
        if (fromCity === toCity) continue
        index += 1
        const value: RouteLegEvidenceValue = {
          fromCity,
          toCity,
          travelDate,
          mode: fromCity === '西双版纳' || toCity === '西双版纳' ? 'MANUAL_FLIGHT' : 'RAIL',
          label: `${fromCity}→${toCity}`,
          durationMinutes: 240,
          costCents: null,
          transferCount: 0,
          overnightArrival: false
        }
        claims.push({
          claimId: `full-route-${index}`,
          sessionId: SESSION_ID,
          subject: `${travelDate} ${fromCity}→${toCity}`,
          predicate: 'routeLeg',
          value,
          sourceId: 'USER_RESEARCH',
          sourceRef: `route-fixture:${index}`,
          contentIdentity: 'OFFICIAL',
          verificationStatus: 'VERIFIED_BY_USER',
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
