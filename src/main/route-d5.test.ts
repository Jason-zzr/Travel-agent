import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Context } from 'cordis'
import Database from 'better-sqlite3'
import { AppError } from '../shared/errors'
import { RailOptionSchema, type RailOption, type TransportLeg } from '../shared/schema/d5'
import { EvidenceClaimSchema, type EvidenceClaim } from '../shared/schema/evidence'
import { RouteCandidateSchema, type RouteCandidate } from '../shared/schema/itinerary'
import { RouteD5LegPlanSchema, type RouteD5LegPlan } from '../shared/schema/route-d5'
import { SessionEventSchema, type SessionEventDraft } from '../shared/schema/session-event'
import { TravelStateSchema, type TravelState } from '../shared/schema/travel-state'
import { applyMigrations } from './db/migrate'
import { initializeRouteNodeResearchStates, reduceTravelState } from './plugins/travel-state'
import { RouteD5Service } from './route-d5-service'
import { prepareItineraryExport } from './export/d7-export'
import { buildGateC } from './skills/d7-gate'
import { createTimelineDraft, publishTimelineDraft } from './skills/s10-timeline'
import { derivePreparationTasks } from './skills/s11-task-derivation'
import {
  buildRouteD5Snapshot,
  buildRouteDaySkeletons,
  initializeRouteD5LegStates,
  initializeRouteD5StayStates,
  patchRouteDaySkeleton
} from './skills/route-d5'
import { slotItemsWithinEightKm } from './skills/s07-skeleton'

const SESSION_ID = 'route-d5-session'
const ROUTE_ID = 'route-yunnan-d5'

test('multi-segment D5 derives ordered leg/stay queues and one day per itinerary date', () => {
  const state = readyState()
  const days = buildRouteDaySkeletons(state)
  assert.equal(days.length, 10)
  assert.equal(new Set(days.map((day) => day.date)).size, 10)
  assert.deepEqual(
    days.filter((day) => day.dayType === 'INTERCITY_TRANSFER_DAY').map((day) => day.routeLegId),
    ['leg-gz-dali', 'leg-dali-lijiang', 'leg-lijiang-banna', 'leg-banna-gz']
  )
  assert.ok(
    days
      .filter((day) => day.dayType !== 'INTERCITY_TRANSFER_DAY')
      .every((day) => day.owningNodeId !== null && day.segmentId !== null)
  )

  const snapshot = buildRouteD5Snapshot({ ...state, routeDaySkeletons: days })
  assert.equal(snapshot.legStates.length, 4)
  assert.equal(snapshot.stayStates.length, 3)
  assert.equal(snapshot.nextRequiredWorkItem?.kind, 'STAY')
})

test('route-D5 clusters confirmed attractions within 8 km per node and rejects a cross-cluster patch', () => {
  const state = readyState()
  const claims = [
    coordinateClaim('coord-near-a', 'near-a', 100.17, 25.7),
    coordinateClaim('coord-near-b', 'near-b', 100.18, 25.71),
    coordinateClaim('coord-far', 'far', 100.35, 25.85)
  ]
  const routeNodeResearchStates = initializeRouteNodeResearchStates(
    SESSION_ID,
    state.routeCandidates[0]!
  ).map((item) =>
    item.scope.nodeId === 'node-dali'
      ? {
          ...item,
          status: 'CONFIRMED' as const,
          researchChecklistConfirmed: true,
          confirmedAt: '2026-08-31T01:00:00.000Z',
          researchEntities: claims.map((claim) => ({
            entityId: claim.subject,
            destinationCity: '大理',
            canonicalSubject: claim.subject,
            aliases: [],
            kind: 'ATTRACTION' as const,
            claimIds: [claim.claimId],
            identityStatus: 'DETERMINISTIC' as const,
            verificationStatus: 'VERIFIED' as const,
            contentIdentities: ['OFFICIAL' as const],
            validUntil: claim.validUntil,
            promotionOnlySupport: false,
            fitness: { status: 'FIT' as const, reasons: [] },
            disposition: 'MUST_GO' as const,
            blockingReasons: [],
            unresolvedConflictClaimIds: [],
            scope: { kind: 'ROUTE_NODE' as const, routeId: ROUTE_ID, nodeId: 'node-dali' }
          }))
        }
      : item
  )
  const researched = TravelStateSchema.parse({ ...state, routeNodeResearchStates })
  const days = buildRouteDaySkeletons(researched, claims)
  const daliDays = days.filter(
    (day) => day.owningNodeId === 'node-dali' && day.dayType !== 'INTERCITY_TRANSFER_DAY'
  )
  assert.equal(daliDays.length, 2)
  assert.deepEqual(
    daliDays.map((day) => day.attractionEntityIds),
    [['near-a', 'near-b'], ['far']]
  )
  const coordinates = new Map([
    ['near-a', { lng: 100.17, lat: 25.7 }],
    ['near-b', { lng: 100.18, lat: 25.71 }],
    ['far', { lng: 100.35, lat: 25.85 }]
  ])
  assert.ok(
    daliDays.every((day) =>
      slotItemsWithinEightKm(
        day.attractionEntityIds.map((entityId) => ({ coordinates: coordinates.get(entityId)! }))
      )
    )
  )

  const withDays = TravelStateSchema.parse({ ...researched, routeDaySkeletons: days })
  assert.throws(
    () => patchRouteDaySkeleton(withDays, daliDays[0]!.date, ['near-a', 'far'], claims),
    (error: unknown) => error instanceof AppError && error.code === 'GATE_BLOCKED'
  )
})

test('route-D5 reducer rejects cross-leg options and keeps legacy D5 fields untouched', () => {
  const state = baseState()
  const scope = state.routeD5LegStates[0]!.scope
  const event = SessionEventSchema.parse({
    eventId: 'evt-route-d5-options',
    sessionId: SESSION_ID,
    seq: state.lastSeq + 1,
    timestamp: '2026-08-31T02:00:00.000Z',
    eventVersion: 2,
    type: 'route-d5/leg-options-prepared',
    payload: {
      scope,
      options: [railOption('广州', '大理')]
    }
  })
  const next = reduceTravelState(state, event)
  assert.equal(next.routeD5LegStates[0]!.status, 'OPTIONS_READY')
  assert.deepEqual(next.transportCandidates, state.transportCandidates)
  assert.deepEqual(next.daySkeletons, state.daySkeletons)

  const staleScope = { ...scope, legId: 'leg-dali-lijiang' }
  const stale = SessionEventSchema.parse({
    ...event,
    eventId: 'evt-route-d5-stale',
    seq: state.lastSeq + 2,
    payload: { scope: staleScope, options: [railOption('广州', '大理')] }
  })
  assert.throws(() => reduceTravelState(state, stale), AppError)
})

test('route-D5 one-shot plans bind action, state and leg identity without real source calls', async () => {
  let state = baseState()
  let externalCalls = 0
  const expiryCallbacks: Array<() => void> = []
  const records: SessionEventDraft[] = []
  const context = {
    setTimeout: (callback: () => void) => {
      expiryCallbacks.push(callback)
      return () => undefined
    },
    travelState: {
      get: () => state,
      record: async (draft: SessionEventDraft) => {
        records.push(draft)
        const event = SessionEventSchema.parse({
          ...draft,
          eventId: `evt-${records.length}`,
          seq: state.lastSeq + 1,
          timestamp: `2026-08-31T02:00:0${records.length}.000Z`
        })
        state = reduceTravelState(state, event)
        return event
      }
    },
    tools: {
      hasTransientGeocode: () => false,
      discoverRailOptions: async () => {
        externalCalls += 1
        return [railOption('广州', '大理')]
      }
    }
  } as unknown as Context
  const service = new RouteD5Service(context, () => new Date('2026-08-31T02:00:00.000Z'))
  const scope = state.routeD5LegStates[0]!.scope
  const preview = service.preview({
    scope,
    action: 'DISCOVER_RAIL',
    fromAddress: null,
    toAddress: null
  })
  assert.equal(preview.totalExternalCalls, 1)
  assert.equal(preview.plannedCalls[0]?.capability, 'RAIL_DISCOVERY')

  const otherScope = state.routeD5LegStates[1]!.scope
  await assert.rejects(
    service.execute({
      scope: otherScope,
      action: 'DISCOVER_RAIL',
      operationId: '11111111-1111-4111-8111-111111111111',
      planId: preview.planId,
      digest: preview.digest
    }),
    AppError
  )
  assert.equal(externalCalls, 0)

  const replacedPreview = service.preview({
    scope,
    action: 'DISCOVER_RAIL',
    fromAddress: null,
    toAddress: null
  })
  const validPreview = service.preview({
    scope,
    action: 'DISCOVER_RAIL',
    fromAddress: null,
    toAddress: null
  })
  await assert.rejects(
    service.execute({
      scope,
      action: 'DISCOVER_RAIL',
      operationId: '33333333-3333-4333-8333-333333333333',
      planId: replacedPreview.planId,
      digest: replacedPreview.digest
    }),
    AppError
  )
  assert.equal(externalCalls, 0)
  const result = await service.execute({
    scope,
    action: 'DISCOVER_RAIL',
    operationId: '44444444-4444-4444-8444-444444444444',
    planId: validPreview.planId,
    digest: validPreview.digest
  })
  assert.equal(externalCalls, 1)
  assert.equal(result.legStates[0]!.status, 'OPTIONS_READY')
  assert.equal(records[0]?.type, 'route-d5/leg-options-prepared')

  const expiringPreview = service.preview({
    scope,
    action: 'DISCOVER_RAIL',
    fromAddress: null,
    toAddress: null
  })
  expiryCallbacks.at(-1)!()
  await assert.rejects(
    service.execute({
      scope,
      action: 'DISCOVER_RAIL',
      operationId: '55555555-5555-4555-8555-555555555555',
      planId: expiringPreview.planId,
      digest: expiringPreview.digest
    }),
    AppError
  )
  assert.equal(externalCalls, 1)
})

test('migration 0009 installs route-D5 projections without changing earlier table names', () => {
  const root = mkdtempSync(join(tmpdir(), 'travel-route-d5-'))
  try {
    const database = new Database(join(root, 'travel.db'))
    database.pragma('foreign_keys = ON')
    const migrations = Array.from({ length: 9 }, (_, index) => {
      const version = index + 1
      const prefix = String(version).padStart(4, '0')
      const fileName = [
        'init',
        'model_call_cost',
        'xiaohongshu_source',
        'd5_transport_candidates',
        'd7_task_links',
        'user_research_source',
        'multi_city_routes',
        'node_scoped_d4',
        'multi_segment_d5'
      ][index]!
      return {
        version,
        sql: readFileSync(
          join(process.cwd(), 'src', 'main', 'db', 'migrations', `${prefix}_${fileName}.sql`),
          'utf8'
        )
      }
    })
    applyMigrations(database, migrations)
    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'route_d5_%'")
      .all() as Array<{ name: string }>
    const names = new Set(tables.map((row) => row.name))
    assert.ok(names.has('route_d5_leg_states'))
    assert.ok(names.has('route_d5_stay_states'))
    assert.ok(names.has('route_d5_day_skeletons'))
    assert.ok(names.has('route_d5_confirmations'))
    assert.ok(
      database
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='transport_candidates'")
        .get()
    )
    database.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('unified D6/D7 compiles one scoped Yunnan route and exports the whole itinerary locally', () => {
  const { state, claims } = unifiedD6D7State()
  const draft = createTimelineDraft({
    state,
    claims,
    draftId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    now: '2026-08-31T02:00:00.000Z'
  })
  assert.equal(draft.routeId, ROUTE_ID)
  assert.equal(draft.changedDates.length, 10)
  assert.equal(draft.gate.publishable, true)
  assert.deepEqual(
    draft.items
      .filter((item) => item.routeContext?.role === 'INTERCITY_LEG')
      .map((item) => item.routeContext?.routeLegId),
    ['leg-gz-dali', 'leg-dali-lijiang', 'leg-lijiang-banna', 'leg-banna-gz']
  )
  assert.equal(draft.items.filter((item) => item.routeContext?.role === 'BACKUP').length, 10)

  const published = publishTimelineDraft({
    draft,
    currentVersion: 0,
    now: '2026-08-31T02:05:00.000Z'
  })
  assert.equal(published.timeline.routeId, ROUTE_ID)
  const tasks = derivePreparationTasks({
    sessionId: SESSION_ID,
    timeline: published.timeline,
    claims,
    now: '2026-08-31T02:10:00.000Z'
  })
  assert.equal(tasks.filter((task) => task.routeContext?.role === 'INTERCITY_LEG').length, 4)
  assert.equal(tasks.filter((task) => task.routeContext?.role === 'STAY_CHECKIN').length, 3)
  assert.equal(tasks.filter((task) => task.routeContext && task.title.includes('必去')).length, 3)
  assert.equal(new Set(tasks.map((task) => task.taskId)).size, tasks.length)

  const gate = buildGateC({
    timeline: published.timeline,
    tasks,
    claims,
    now: '2026-08-31T02:15:00.000Z'
  })
  assert.equal(gate.routeId, ROUTE_ID)
  assert.equal(gate.ready, false)
  assert.ok(gate.blockers.every((blocker) => blocker.routeContext !== undefined))
  assert.ok(!gate.blockers.some((blocker) => blocker.code === 'ROUTE_COVERAGE_INCOMPLETE'))

  const markdown = prepareItineraryExport(
    { sessionId: SESSION_ID, timeline: published.timeline, tasks, gate },
    'MARKDOWN'
  )
  assert.equal(markdown.kind, 'MARKDOWN')
  assert.match(markdown.content, /## 整程路线/)
  assert.match(markdown.content, /leg-gz-dali/)
  assert.match(markdown.content, /## 出发前任务/)
  assert.doesNotMatch(markdown.content, /精确地址/)
})

test('migration 0010 adds nullable unified route scope without replacing legacy tables', () => {
  const root = mkdtempSync(join(tmpdir(), 'travel-unified-d6-d7-'))
  try {
    const database = new Database(join(root, 'travel.db'))
    const names = [
      'init',
      'model_call_cost',
      'xiaohongshu_source',
      'd5_transport_candidates',
      'd7_task_links',
      'user_research_source',
      'multi_city_routes',
      'node_scoped_d4',
      'multi_segment_d5',
      'unified_route_timeline'
    ]
    applyMigrations(
      database,
      names.map((name, index) => ({
        version: index + 1,
        sql: readFileSync(
          join(
            process.cwd(),
            'src',
            'main',
            'db',
            'migrations',
            `${String(index + 1).padStart(4, '0')}_${name}.sql`
          ),
          'utf8'
        )
      }))
    )
    const columns = (table: string): Set<string> =>
      new Set(
        (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
          (row) => row.name
        )
      )
    assert.ok(columns('timeline_versions').has('route_id'))
    for (const column of [
      'route_id',
      'node_id',
      'segment_id',
      'route_leg_id',
      'route_context_json'
    ]) {
      assert.ok(columns('timeline_items').has(column))
      assert.ok(columns('tasks').has(column))
    }
    for (const indexName of [
      'idx_timeline_versions_route',
      'idx_timeline_items_route_scope',
      'idx_tasks_route_scope'
    ]) {
      assert.ok(
        database.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?").get(indexName)
      )
    }
    database.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

function unifiedD6D7State(): { state: TravelState; claims: EvidenceClaim[] } {
  const base = readyState()
  const attractions = [
    {
      nodeId: 'node-dali',
      city: '大理',
      entityId: 'must-erhai',
      name: '洱海',
      lng: 100.18,
      lat: 25.7
    },
    {
      nodeId: 'node-lijiang',
      city: '丽江',
      entityId: 'must-yulong',
      name: '玉龙雪山',
      lng: 100.25,
      lat: 27.1
    },
    {
      nodeId: 'node-banna',
      city: '西双版纳',
      entityId: 'must-banna',
      name: '西双版纳热带雨林',
      lng: 100.8,
      lat: 22.0
    }
  ]
  const claims: EvidenceClaim[] = []
  for (const [index, leg] of base.routeD5LegStates.entries()) {
    claims.push(
      routeClaim({
        claimId: `claim-leg-${index}`,
        subject: leg.routeLeg.label,
        predicate: 'routeLegConfirmed',
        value: { routeId: ROUTE_ID, legId: leg.scope.legId },
        sourceId: 'USER_PASTE'
      })
    )
  }
  const routeD5StayStates = base.routeD5StayStates.map((stay, index) => {
    const claimId = `claim-stay-${index}`
    const candidateId = `candidate-stay-${index}`
    const name = `${stay.segment.city}核验住宿`
    claims.push(
      routeClaim({
        claimId,
        subject: name,
        predicate: 'staySelection',
        value: { routeId: ROUTE_ID, segmentId: stay.scope.segmentId },
        sourceId: 'USER_PASTE',
        nodeId: stay.scope.nodeId
      })
    )
    return {
      ...stay,
      status: 'SELECTED' as const,
      candidates: [
        {
          candidateId,
          segmentId: stay.scope.segmentId,
          sourceId: 'USER_PASTE' as const,
          name,
          claimId,
          contentIdentity: 'OFFICIAL' as const,
          verificationStatus: 'VERIFIED_BY_USER' as const,
          totalCostCents: 120_000,
          totalCostComplete: true,
          roomType: '双人房',
          bedType: '大床',
          capacity: 2,
          roomFitsParty: true,
          cancellation: { status: 'UNKNOWN' as const, freeCancelUntil: null },
          positionAdvantage: '位于当前路线节点内',
          recommendationEligible: true
        }
      ],
      selectedCandidateId: candidateId,
      blockingReasons: []
    }
  })
  const initialResearch = initializeRouteNodeResearchStates(SESSION_ID, base.routeCandidates[0]!)
  const routeNodeResearchStates = initialResearch.map((node) => {
    const attraction = attractions.find((item) => item.nodeId === node.scope.nodeId)!
    const claimId = `claim-coordinate-${attraction.entityId}`
    claims.push(
      routeClaim({
        claimId,
        subject: attraction.entityId,
        predicate: 'coordinates',
        value: { lng: attraction.lng, lat: attraction.lat },
        sourceId: 'SRC_MAP',
        nodeId: attraction.nodeId
      }),
      routeClaim({
        claimId: `claim-route-${attraction.entityId}`,
        subject: `${node.scope.city}住宿到${attraction.name}`,
        predicate: 'routeEta',
        value: {
          from: `${node.scope.city}核验住宿`,
          to: attraction.name,
          etaMinutes: 20,
          travelMode: 'DRIVING'
        },
        sourceId: 'SRC_MAP',
        nodeId: attraction.nodeId
      })
    )
    return {
      ...node,
      status: 'CONFIRMED' as const,
      researchChecklistConfirmed: true,
      confirmedAt: '2026-08-31T01:00:00.000Z',
      researchEntities: [
        {
          entityId: attraction.entityId,
          destinationCity: attraction.city,
          canonicalSubject: attraction.name,
          aliases: [],
          kind: 'ATTRACTION' as const,
          claimIds: [claimId],
          identityStatus: 'DETERMINISTIC' as const,
          verificationStatus: 'VERIFIED' as const,
          contentIdentities: ['OFFICIAL' as const],
          validUntil: '2026-09-30T00:00:00.000Z',
          promotionOnlySupport: false,
          fitness: { status: 'FIT' as const, reasons: [] },
          disposition: 'MUST_GO' as const,
          blockingReasons: [],
          unresolvedConflictClaimIds: [],
          scope: { kind: 'ROUTE_NODE' as const, routeId: ROUTE_ID, nodeId: attraction.nodeId }
        }
      ]
    }
  })
  const prepared = TravelStateSchema.parse({
    ...base,
    stage: 'STAGE_5',
    routeD5StayStates,
    routeNodeResearchStates,
    routeD5Confirmed: true
  })
  const routeDaySkeletons = buildRouteDaySkeletons(prepared, claims)
  for (const day of routeDaySkeletons) {
    claims.push(
      routeClaim({
        claimId: `claim-backup-${day.date}`,
        subject: `${day.date} 雨天备用`,
        predicate: 'backupCandidate',
        value: { date: day.date, name: `${day.date} 室内备用` },
        sourceId: 'USER_PASTE'
      })
    )
  }
  return {
    state: TravelStateSchema.parse({ ...prepared, routeDaySkeletons }),
    claims
  }
}

function routeClaim(input: {
  claimId: string
  subject: string
  predicate: string
  value: EvidenceClaim['value']
  sourceId: EvidenceClaim['sourceId']
  nodeId?: string
}): EvidenceClaim {
  return EvidenceClaimSchema.parse({
    claimId: input.claimId,
    sessionId: SESSION_ID,
    subject: input.subject,
    predicate: input.predicate,
    value: input.value,
    sourceId: input.sourceId,
    sourceRef: `https://example.com/evidence/${input.claimId}`,
    contentIdentity: 'OFFICIAL',
    verificationStatus: 'VERIFIED',
    observedAt: '2026-08-31T00:00:00.000Z',
    validUntil: '2026-09-30T00:00:00.000Z',
    scope: input.nodeId ? { kind: 'ROUTE_NODE', routeId: ROUTE_ID, nodeId: input.nodeId } : null,
    confidence: 1,
    conflictsWith: [],
    notes: null
  })
}

function baseState(): TravelState {
  const route = yunnanRoute()
  return TravelStateSchema.parse({
    sessionId: SESSION_ID,
    createdAt: '2026-08-31T00:00:00.000Z',
    stage: 'STAGE_4',
    lastSeq: 20,
    title: '广州到云南 10 天',
    basics: {
      originCities: ['广州'],
      destinationCities: ['大理', '丽江', '西双版纳'],
      destinationIntent: null,
      travelers: [
        {
          count: 2,
          ageBand: 'ADULT',
          relationship: '伴侣',
          stamina: 'MEDIUM',
          careNeeds: [],
          functionalLimits: []
        }
      ],
      dates: { kind: 'FIXED', startDate: '2026-09-08', endDate: '2026-09-17' },
      budget: {
        currency: 'CNY',
        basis: 'TOTAL',
        targetMinor: 1_200_000,
        flexibleRangeMinor: { min: 800_000, max: 1_500_000 },
        hardCapMinor: 1_500_000,
        inclusions: ['TRANSPORT', 'ACCOMMODATION']
      },
      intensity: 'BALANCED',
      preferences: {
        hardConstraints: ['玉龙雪山、洱海、西双版纳必须串联'],
        softPreferences: ['自然'],
        negotiableVariables: ['昆明是否停留由交通决定']
      },
      staySegments: 3,
      itineraryIntent: {
        kind: 'MULTI_CITY_ROUTE',
        regionGoal: '云南',
        mandatoryPlaces: [
          { placeId: 'must-erhai', displayName: '洱海', nodeCity: '大理' },
          { placeId: 'must-yulong', displayName: '玉龙雪山', nodeCity: '丽江' },
          { placeId: 'must-banna', displayName: '西双版纳', nodeCity: '西双版纳' }
        ]
      }
    },
    itineraryGoal: {
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
          relationship: '伴侣',
          stamina: 'MEDIUM',
          careNeeds: [],
          functionalLimits: []
        }
      ],
      budget: {
        currency: 'CNY',
        basis: 'TOTAL',
        targetMinor: 1_200_000,
        flexibleRangeMinor: { min: 800_000, max: 1_500_000 },
        hardCapMinor: 1_500_000,
        inclusions: ['TRANSPORT', 'ACCOMMODATION']
      },
      intensity: 'BALANCED',
      mandatoryPlaces: [
        { placeId: 'must-erhai', displayName: '洱海', nodeCity: '大理' },
        { placeId: 'must-yulong', displayName: '玉龙雪山', nodeCity: '丽江' },
        { placeId: 'must-banna', displayName: '西双版纳', nodeCity: '西双版纳' }
      ]
    },
    routeCandidates: [route],
    selectedRouteId: route.routeId,
    routeStaySegments: route.staySegments,
    routeD5LegStates: initializeRouteD5LegStates(SESSION_ID, route),
    routeD5StayStates: initializeRouteD5StayStates(SESSION_ID, route)
  })
}

function readyState(): TravelState {
  const state = baseState()
  return TravelStateSchema.parse({
    ...state,
    routeD5LegStates: state.routeD5LegStates.map((item, index) => ({
      ...item,
      status: 'READY',
      selectionClaimIds: [`claim-leg-${index}`],
      plan: dummyPlan(item.routeLeg.travelDate, `claim-leg-${index}`),
      sourceOutcome: 'SUCCEEDED',
      blockingReasons: []
    }))
  })
}

function dummyPlan(date: string, claimId: string): RouteD5LegPlan {
  const startAt = `${date}T08:00:00+08:00`
  const endAt = `${date}T12:00:00+08:00`
  const leg = (kind: 'FIRST_MILE' | 'WAIT' | 'INTERCITY' | 'LAST_MILE'): TransportLeg => ({
    kind,
    label: kind,
    from: '起点',
    to: '终点',
    startAt,
    endAt,
    durationMinutes: 60,
    costCents: null,
    sourceId: null,
    claimIds: [claimId],
    verificationStatus: 'VERIFIED_BY_USER' as const
  })
  return RouteD5LegPlanSchema.parse({
    legs: [leg('FIRST_MILE'), leg('WAIT'), leg('INTERCITY'), leg('LAST_MILE')],
    boundaryAnchors: [
      {
        kind: 'DEPARTURE',
        date,
        time: '08:00',
        at: startAt,
        location: '起点',
        usableMinutes: 0,
        anchorClass: 'HARD_LOCKED',
        claimIds: [claimId]
      },
      {
        kind: 'ARRIVAL',
        date,
        time: '12:00',
        at: endAt,
        location: '终点',
        usableMinutes: 600,
        anchorClass: 'HARD_LOCKED',
        claimIds: [claimId]
      }
    ],
    totalDurationMinutes: 240,
    totalCostCents: null,
    costComplete: false
  })
}

function yunnanRoute(): RouteCandidate {
  const node = (
    nodeId: string,
    city: string,
    sequence: number,
    arrivalDate: string,
    departureDate: string,
    mandatoryPlaceIds: string[]
  ): RouteCandidate['nodes'][number] => ({
    routeId: ROUTE_ID,
    nodeId,
    city,
    region: '云南',
    sequence,
    arrivalDate,
    departureDate,
    nights: 3,
    nodeKind: 'STAY' as const,
    mandatoryPlaceIds,
    reason: `串联 ${city}`
  })
  const nodes = [
    node('node-dali', '大理', 1, '2026-09-08', '2026-09-11', ['must-erhai']),
    node('node-lijiang', '丽江', 2, '2026-09-11', '2026-09-14', ['must-yulong']),
    node('node-banna', '西双版纳', 3, '2026-09-14', '2026-09-17', ['must-banna'])
  ]
  const leg = (
    legId: string,
    from: { kind: 'ORIGIN'; city: string } | { kind: 'NODE'; nodeId: string },
    to: { kind: 'ORIGIN'; city: string } | { kind: 'NODE'; nodeId: string },
    fromCity: string,
    toCity: string,
    travelDate: string,
    mode: 'RAIL' | 'MANUAL_FLIGHT'
  ): RouteCandidate['legs'][number] => ({
    routeId: ROUTE_ID,
    legId,
    from,
    to,
    fromCity,
    toCity,
    travelDate,
    mode,
    label: `${fromCity}→${toCity}`,
    durationMinutes: null,
    costCents: null,
    transferCount: 0,
    verificationStatus: 'UNVERIFIED' as const,
    claimIds: [],
    riskFlags: ['UNVERIFIED' as const],
    critical: true
  })
  const stay = (
    nodeId: string,
    segmentId: string,
    city: string,
    start: string,
    end: string
  ): RouteCandidate['staySegments'][number] => ({
    routeId: ROUTE_ID,
    nodeId,
    segmentId,
    city,
    checkInDate: start,
    checkOutDate: end,
    nights: 3,
    nightDates: [start, addDay(start), addDay(addDay(start))],
    positionAssessment: { status: 'UNKNOWN' as const, summary: '待 D5 核验', claimIds: [] }
  })
  return RouteCandidateSchema.parse({
    routeId: ROUTE_ID,
    profile: 'BALANCED',
    nodes,
    legs: [
      leg(
        'leg-gz-dali',
        { kind: 'ORIGIN', city: '广州' },
        { kind: 'NODE', nodeId: 'node-dali' },
        '广州',
        '大理',
        '2026-09-08',
        'RAIL'
      ),
      leg(
        'leg-dali-lijiang',
        { kind: 'NODE', nodeId: 'node-dali' },
        { kind: 'NODE', nodeId: 'node-lijiang' },
        '大理',
        '丽江',
        '2026-09-11',
        'RAIL'
      ),
      leg(
        'leg-lijiang-banna',
        { kind: 'NODE', nodeId: 'node-lijiang' },
        { kind: 'NODE', nodeId: 'node-banna' },
        '丽江',
        '西双版纳',
        '2026-09-14',
        'MANUAL_FLIGHT'
      ),
      leg(
        'leg-banna-gz',
        { kind: 'NODE', nodeId: 'node-banna' },
        { kind: 'ORIGIN', city: '广州' },
        '西双版纳',
        '广州',
        '2026-09-17',
        'MANUAL_FLIGHT'
      )
    ],
    staySegments: [
      stay('node-dali', 'stay-dali', '大理', '2026-09-08', '2026-09-11'),
      stay('node-lijiang', 'stay-lijiang', '丽江', '2026-09-11', '2026-09-14'),
      stay('node-banna', 'stay-banna', '西双版纳', '2026-09-14', '2026-09-17')
    ],
    score: {
      hardConstraintPass: true,
      criticalEvidenceComplete: false,
      unverifiedLegCount: 4,
      transferCount: 0,
      overnightArrivalCount: 0,
      transitMinutes: null,
      backtrackingScore: 5,
      staminaRisk: 'MEDIUM',
      altitudeRisk: 'MEDIUM',
      knownCostCents: null,
      costComplete: false
    },
    isRecommended: false,
    materialDifferences: ['大理、丽江、西双版纳连续串联'],
    kunmingDecision: { included: false, reason: '当前铁路与航班连接不要求昆明停留。' },
    blockingReasons: ['具体路段与住宿待 D5 核验']
  })
}

function railOption(fromStation: string, toStation: string): RailOption {
  return RailOptionSchema.parse({
    direction: 'OUTBOUND' as const,
    trainNo: 'D1234',
    serviceDate: '2026-09-08',
    fromStation,
    toStation,
    departureTime: '08:00',
    arrivalTime: '14:00',
    startAt: '2026-09-08T08:00:00+08:00',
    endAt: '2026-09-08T14:00:00+08:00',
    title: `${fromStation}→${toStation} D1234`
  })
}

function coordinateClaim(
  claimId: string,
  subject: string,
  lng: number,
  lat: number
): EvidenceClaim {
  return EvidenceClaimSchema.parse({
    claimId,
    sessionId: SESSION_ID,
    subject,
    predicate: 'coordinates',
    value: { lng, lat },
    sourceId: 'SRC_MAP',
    sourceRef: `map:${claimId}`,
    contentIdentity: 'OFFICIAL',
    verificationStatus: 'VERIFIED',
    observedAt: '2026-08-31T00:00:00.000Z',
    validUntil: '2026-09-30T00:00:00.000Z',
    scope: { kind: 'ROUTE_NODE', routeId: ROUTE_ID, nodeId: 'node-dali' },
    confidence: 1,
    conflictsWith: [],
    notes: null
  })
}

function addDay(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + 1)
  return value.toISOString().slice(0, 10)
}
