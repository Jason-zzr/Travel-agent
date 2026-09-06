import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { Context } from 'cordis'
import { AppError } from '../shared/errors'
import {
  TimelineItemSchema,
  TimelinePrepareRequestSchema,
  type TimelineItem
} from '../shared/schema/d6'
import type { EvidenceClaim } from '../shared/schema/evidence'
import { TransportCandidateSchema, type TransportCandidate } from '../shared/schema/d5'
import { SessionEventDraftSchema, SessionEventSchema } from '../shared/schema/session-event'
import { TravelStateSchema, type TravelState } from '../shared/schema/travel-state'
import { applyMigrations } from './db/migrate'
import { createAppPaths, sessionSnapshotPath, type AppPaths } from './paths'
import { coordinatorPlugin } from './plugins/coordinator'
import { eventLogPlugin } from './plugins/event-log'
import { policyPlugin } from './plugins/policy'
import { providerPlugin } from './plugins/provider-runtime'
import { sessionPlugin } from './plugins/session'
import { toolsPlugin } from './plugins/tool-registry'
import { travelStatePlugin } from './plugins/travel-state'
import { ProviderConfigStore } from './provider-config-store'
import { SourceConfigStore } from './source-config-store'
import { routeBufferMinutes } from './skills/s09-route-refinement'
import {
  createTimelineDraft,
  publishTimelineDraft,
  timelineOrderConflicts
} from './skills/s10-timeline'

const SESSION_ID = 'd6-session'
const DRAFT_ID = '11111111-1111-4111-8111-111111111111'
const NOW = '2026-10-01T00:00:00.000Z'

test('D6 schemas reject invalid local time relationships, unsafe backup duration, and extra IPC fields', () => {
  const base = timelineItem({
    itemId: 'item-1',
    date: '2026-10-01',
    startTime: '10:00',
    endTime: '09:00',
    crossesMidnight: false
  })
  assert.equal(TimelineItemSchema.safeParse(base).success, false)
  assert.equal(
    TimelineItemSchema.safeParse({
      ...base,
      itemClass: 'BACKUP',
      startTime: '00:00',
      endTime: '00:30',
      crossesMidnight: false
    }).success,
    false
  )
  assert.equal(
    TimelinePrepareRequestSchema.safeParse({
      sessionId: SESSION_ID,
      operationId: '22222222-2222-4222-8222-222222222222',
      toolName: 'maps_distance'
    }).success,
    false
  )
})

test('SKILL-09 applies percentage buffers with the M0 minimums', () => {
  assert.equal(routeBufferMinutes(20, 'POI'), 10)
  assert.equal(routeBufferMinutes(100, 'POI'), 20)
  assert.equal(routeBufferMinutes(20, 'STATION'), 30)
  assert.equal(routeBufferMinutes(100, 'AIRPORT'), 50)
})

test('SKILL-09/10 compile a claim-backed two-day draft with daily backups and zero external calls', () => {
  const state = fixtureState()
  const claims = fixtureClaims()
  const draft = createTimelineDraft({ state, claims, draftId: DRAFT_ID, now: NOW })

  assert.equal(draft.gate.publishable, true)
  assert.equal(draft.items.filter((item) => item.itemClass === 'BACKUP').length, 2)
  assert.equal(draft.items.find((item) => item.title === '离开目的地')?.bufferMinutes, 30)
  assert.equal(
    draft.sourceOutcomes.reduce((sum, outcome) => sum + outcome.externalCallCount, 0),
    0
  )

  const payload = publishTimelineDraft({ draft, currentVersion: 0, now: NOW })
  assert.equal(payload.timeline.version, 1)
  assert.equal(payload.timeline.isCurrent, true)
  assert.equal(payload.verification.hardAnchorCount, 2)
  assert.equal(payload.verification.verifiedHardAnchorCount, 2)

  const event = SessionEventDraftSchema.parse({
    sessionId: SESSION_ID,
    eventVersion: 2,
    type: 'timeline/published',
    payload
  })
  assert.equal(event.type, 'timeline/published')
})

test('SKILL-10 blocks an unverified hard anchor and writes no publish payload', () => {
  const claims = fixtureClaims().map((claim) =>
    claim.claimId === 'rail-arrival'
      ? { ...claim, verificationStatus: 'UNVERIFIED' as const }
      : claim
  )
  const draft = createTimelineDraft({ state: fixtureState(), claims, draftId: DRAFT_ID, now: NOW })
  assert.equal(draft.gate.publishable, false)
  assert.ok(draft.gate.blockingItems.some((item) => item.code === 'UNVERIFIED_HARD_ANCHOR'))
  assert.throws(
    () => publishTimelineDraft({ draft, currentVersion: 0, now: NOW }),
    (error) => error instanceof AppError && error.code === 'GATE_BLOCKED'
  )
})

test('timeline conflict validation excludes BACKUP and normalizes cross-midnight end times', () => {
  const first = timelineItem({
    itemId: 'late',
    date: '2026-10-01',
    startTime: '23:30',
    endTime: '00:30',
    crossesMidnight: true
  })
  const backup = timelineItem({
    itemId: 'backup',
    date: '2026-10-01',
    startTime: '00:00',
    endTime: '00:00',
    itemClass: 'BACKUP',
    anchorClass: 'FLEXIBLE',
    claimIds: ['backup'],
    verificationSummary: { status: 'VERIFIED', claimCount: 1, allClaimsUsable: true }
  })
  const next = timelineItem({
    itemId: 'too-soon',
    date: '2026-10-02',
    startTime: '00:40',
    endTime: '01:10',
    crossesMidnight: false,
    arrivalTransport: {
      mode: 'WALKING',
      from: 'A',
      to: 'B',
      etaMinutes: 10,
      claimIds: ['route']
    },
    bufferMinutes: 10
  })
  const conflicts = timelineOrderConflicts([first, backup, next])
  assert.equal(conflicts.length, 1)
  assert.equal(conflicts[0]?.itemId, 'too-soon')
})

test('timeline/published write payload is strict while replay payload preserves additive fields', () => {
  const draft = createTimelineDraft({
    state: fixtureState(),
    claims: fixtureClaims(),
    draftId: DRAFT_ID,
    now: NOW
  })
  const payload = publishTimelineDraft({ draft, currentVersion: 0, now: NOW })
  assert.equal(
    SessionEventDraftSchema.safeParse({
      sessionId: SESSION_ID,
      eventVersion: 2,
      type: 'timeline/published',
      payload: { ...payload, futureField: true }
    }).success,
    false
  )
  const replay = SessionEventSchema.parse({
    eventId: 'event-1',
    sessionId: SESSION_ID,
    seq: 2,
    timestamp: NOW,
    eventVersion: 2,
    type: 'timeline/published',
    payload: { ...payload, futureField: true }
  })
  assert.equal(replay.type === 'timeline/published' && replay.payload.futureField, true)
})

test('Coordinator publishes two atomic versions and recovers SQLite from snapshot, JSONL and a corrupt snapshot fallback with zero external calls', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d6-'))
  let kernel = await createD6Kernel(root)
  try {
    await seedStage5(kernel.context)
    const eventCountBefore = (await kernel.context.eventLog.read(SESSION_ID)).length
    const cancelledOperationId = '55555555-5555-4555-8555-555555555555'
    const cancelledPrepare = kernel.context.coordinator.prepareTimeline({
      sessionId: SESSION_ID,
      operationId: cancelledOperationId
    })
    await kernel.context.coordinator.cancelD6Operation(cancelledOperationId)
    await assert.rejects(
      cancelledPrepare,
      (error) => error instanceof AppError && error.code === 'SOURCE_CANCELLED'
    )
    assert.equal((await kernel.context.eventLog.read(SESSION_ID)).length, eventCountBefore)

    const firstDraft = await kernel.context.coordinator.prepareTimeline({
      sessionId: SESSION_ID,
      operationId: '33333333-3333-4333-8333-333333333333'
    })
    assert.equal(firstDraft.draft?.gate.publishable, true)
    assert.equal((await kernel.context.eventLog.read(SESSION_ID)).length, eventCountBefore)
    const firstPublished = await kernel.context.coordinator.publishTimeline({
      sessionId: SESSION_ID,
      draftId: firstDraft.draft!.draftId
    })
    assert.equal(firstPublished.currentVersion, 1)

    const secondDraft = await kernel.context.coordinator.prepareTimeline({
      sessionId: SESSION_ID,
      operationId: '44444444-4444-4444-8444-444444444444'
    })
    const secondPublished = await kernel.context.coordinator.publishTimeline({
      sessionId: SESSION_ID,
      draftId: secondDraft.draft!.draftId
    })
    assert.equal(secondPublished.currentVersion, 2)
    assert.deepEqual(
      secondPublished.versions.map((version) => [version.version, version.isCurrent]),
      [
        [2, true],
        [1, false]
      ]
    )
    const oldVersion = kernel.context.coordinator.d6Snapshot({ sessionId: SESSION_ID, version: 1 })
    assert.equal(oldVersion.selectedVersion?.version, 1)
    assert.equal(oldVersion.currentVersion, 2)

    const timelineRows = kernel.database
      .prepare(
        'SELECT version, is_current FROM timeline_versions WHERE session_id = ? ORDER BY version'
      )
      .all(SESSION_ID) as Array<{ version: number; is_current: number }>
    assert.deepEqual(timelineRows, [
      { version: 1, is_current: 0 },
      { version: 2, is_current: 1 }
    ])
    const decisionCount = kernel.database
      .prepare('SELECT COUNT(*) AS count FROM decision_logs WHERE session_id = ?')
      .get(SESSION_ID) as { count: number }
    assert.equal(decisionCount.count, 2)
    const toolCallCount = kernel.database
      .prepare('SELECT COUNT(*) AS count FROM tool_calls')
      .get() as {
      count: number
    }
    assert.equal(toolCallCount.count, 0)
    assert.equal(
      (await kernel.context.eventLog.read(SESSION_ID)).filter(
        (event) => event.type === 'timeline/published'
      ).length,
      2
    )
    const snapshotPath = sessionSnapshotPath(kernel.paths, SESSION_ID)
    assert.equal(
      (await kernel.context.eventLog.readSnapshot(SESSION_ID))?.state.lastSeq,
      eventCountBefore + 2
    )

    await kernel.stop()
    await rm(kernel.paths.database, { force: true })
    kernel = await createD6Kernel(root)
    assert.equal(kernel.context.coordinator.d6Snapshot({ sessionId: SESSION_ID }).currentVersion, 2)
    assert.equal(
      (
        kernel.database
          .prepare('SELECT COUNT(*) AS count FROM timeline_items WHERE session_id = ?')
          .get(SESSION_ID) as { count: number }
      ).count,
      secondPublished.selectedVersion!.items.length * 2
    )

    await kernel.stop()
    await writeFile(snapshotPath, '{broken-snapshot', 'utf8')
    await rm(kernel.paths.database, { force: true })
    kernel = await createD6Kernel(root)
    const fallback = kernel.context.coordinator.d6Snapshot({ sessionId: SESSION_ID })
    assert.equal(fallback.currentVersion, 2)
    assert.equal(fallback.versions.length, 2)
  } finally {
    await kernel.stop()
    await rm(root, { recursive: true, force: true })
  }
})

function fixtureState(): TravelState {
  return TravelStateSchema.parse({
    sessionId: SESSION_ID,
    createdAt: NOW,
    stage: 'STAGE_5',
    lastSeq: 1,
    title: 'D6 test',
    basics: {
      originCities: ['上海'],
      destinationCities: ['成都'],
      destinationIntent: null,
      travelers: [
        {
          count: 2,
          ageBand: 'ADULT',
          relationship: '同行人',
          stamina: 'MEDIUM',
          careNeeds: [],
          functionalLimits: []
        }
      ],
      dates: { kind: 'FIXED', startDate: '2026-10-01', endDate: '2026-10-02' },
      budget: {
        currency: 'CNY',
        basis: 'TOTAL',
        targetMinor: 500_000,
        flexibleRangeMinor: null,
        hardCapMinor: null,
        inclusions: ['TRANSPORT', 'ACCOMMODATION', 'MEALS']
      },
      intensity: 'BALANCED',
      preferences: { hardConstraints: [], softPreferences: [], negotiableVariables: [] },
      staySegments: 1
    },
    selectedTransportCandidateId: 'transport-selected',
    boundaryAnchors: [
      {
        kind: 'ARRIVAL',
        date: '2026-10-01',
        time: '16:00',
        at: '2026-10-01T16:00:00+08:00',
        location: '成都东站',
        usableMinutes: 360,
        anchorClass: 'HARD_LOCKED',
        claimIds: ['rail-arrival']
      },
      {
        kind: 'DEPARTURE',
        date: '2026-10-02',
        time: '18:00',
        at: '2026-10-02T18:00:00+08:00',
        location: '成都东站',
        usableMinutes: 600,
        anchorClass: 'HARD_LOCKED',
        claimIds: ['rail-departure']
      }
    ],
    daySkeletons: [
      daySkeleton('2026-10-01', 'ARRIVAL_DAY', 'evening', 'poi-1', '宽窄巷子'),
      daySkeleton('2026-10-02', 'DEPARTURE_DAY', 'morning', 'poi-2', '武侯祠')
    ],
    staySegment: {
      segmentId: 'stay-segment',
      areaHint: '成都',
      checkInDate: '2026-10-01',
      checkOutDate: '2026-10-02',
      nights: 1,
      nightDates: ['2026-10-01'],
      positionAssessment: { status: 'VERIFIED', summary: '已核验', claimIds: ['stay-claim'] }
    },
    stayCandidates: [
      {
        candidateId: 'stay-selected',
        segmentId: 'stay-segment',
        sourceId: 'SRC_HOTEL',
        name: '测试酒店',
        claimId: 'stay-claim',
        contentIdentity: 'COMMERCIAL_OFFER',
        verificationStatus: 'VERIFIED',
        totalCostCents: 60_000,
        totalCostComplete: true,
        roomType: '双床房',
        bedType: '双床',
        capacity: 2,
        roomFitsParty: true,
        cancellation: { status: 'FREE_UNTIL', freeCancelUntil: '2026-09-30T08:00:00Z' },
        positionAdvantage: '路线中心',
        recommendationEligible: true
      }
    ],
    selectedStayCandidateId: 'stay-selected'
  })
}

function daySkeleton(
  date: string,
  dayType: 'ARRIVAL_DAY' | 'DEPARTURE_DAY',
  period: 'morning' | 'evening',
  entityId: string,
  title: string
): Record<string, unknown> {
  const slot = {
    kind: 'PROJECTS',
    area: '成都',
    items: [
      { entityId, title, coordinates: { lng: 104.06, lat: 30.67 }, claimIds: [`${entityId}-coord`] }
    ],
    note: null
  }
  return {
    date,
    dayType,
    intensity: 'MEDIUM',
    morning: period === 'morning' ? slot : null,
    afternoon: null,
    evening: period === 'evening' ? slot : null,
    mealAnchors: [],
    localTransport: {
      strategy: 'WALK_TRANSIT',
      budgetImpact: '待核验',
      staminaImpact: '同区移动'
    }
  }
}

function fixtureClaims(): EvidenceClaim[] {
  return [
    claim('rail-arrival', 'railJourney', {}),
    claim('rail-departure', 'railJourney', {}),
    claim('stay-claim', 'lodgingCandidate', {}),
    claim('poi-1-coord', 'coordinates', { lng: 104.06, lat: 30.67 }),
    claim('poi-2-coord', 'coordinates', { lng: 104.04, lat: 30.65 }),
    routeClaim('route-arrival-poi', '2026-10-01:arrival', '2026-10-01:poi:poi-1:evening', 20),
    routeClaim('route-stay-poi', 'stay', '2026-10-02:poi:poi-2:morning', 20),
    routeClaim('route-poi-departure', '2026-10-02:poi:poi-2:morning', '2026-10-02:departure', 20),
    claim('backup-1', 'backupCandidate', { date: '2026-10-01', name: '成都博物馆' }),
    claim('backup-2', 'backupCandidate', { date: '2026-10-02', name: '人民公园' })
  ]
}

function routeClaim(
  id: string,
  fromEntityId: string,
  toEntityId: string,
  etaMinutes: number
): EvidenceClaim {
  return claim(id, 'routeEta', { fromEntityId, toEntityId, etaMinutes, mode: 'DRIVING' }, 'SRC_MAP')
}

function claim(
  claimId: string,
  predicate: string,
  value: EvidenceClaim['value'],
  sourceId: EvidenceClaim['sourceId'] = 'SRC_SEARCH'
): EvidenceClaim {
  return {
    claimId,
    sessionId: SESSION_ID,
    subject: claimId,
    predicate,
    value,
    sourceId,
    sourceRef: `https://example.com/${claimId}`,
    contentIdentity: sourceId === 'SRC_MAP' ? 'OFFICIAL' : 'INDEPENDENT_UGC',
    verificationStatus: 'VERIFIED',
    observedAt: NOW,
    validUntil: '2026-12-01T00:00:00.000Z',
    confidence: 1,
    conflictsWith: [],
    notes: null
  }
}

function timelineItem(overrides: Partial<TimelineItem>): TimelineItem {
  return {
    itemId: 'base',
    date: '2026-10-01',
    startTime: '10:00',
    endTime: '11:00',
    crossesMidnight: false,
    title: '项目',
    itemClass: 'RECOMMENDED',
    anchorClass: 'PREFERRED',
    location: { name: '地点', kind: 'POI', address: null, coordinates: null },
    arrivalTransport: null,
    bufferMinutes: 0,
    costCents: null,
    claimIds: ['claim'],
    verificationSummary: { status: 'VERIFIED', claimCount: 1, allClaimsUsable: true },
    ...overrides
  }
}

async function seedStage5(context: Context): Promise<void> {
  const state = fixtureState()
  await context.coordinator.record({
    sessionId: SESSION_ID,
    eventVersion: 2,
    type: 'session/created',
    payload: {
      title: state.title,
      linkedSessionGroup: null,
      splitIndex: null,
      basics: state.basics,
      handoffs: []
    }
  })
  for (const [fromStage, toStage] of [
    ['STAGE_1', 'STAGE_2'],
    ['STAGE_2', 'STAGE_3']
  ] as const) {
    await context.coordinator.record({
      sessionId: SESSION_ID,
      eventVersion: 2,
      type: 'stage/confirmed',
      payload: { fromStage, toStage, confirmed: true }
    })
  }
  await context.tools.addEvidenceClaims(fixtureClaims())
  await context.coordinator.record({
    sessionId: SESSION_ID,
    eventVersion: 2,
    type: 'research/checklist-prepared',
    payload: {
      entities: [
        {
          entityId: 'poi-1',
          destinationCity: '成都',
          canonicalSubject: '宽窄巷子',
          aliases: [],
          kind: 'ATTRACTION',
          claimIds: ['poi-1-coord'],
          identityStatus: 'DETERMINISTIC',
          verificationStatus: 'VERIFIED',
          contentIdentities: ['INDEPENDENT_UGC'],
          validUntil: '2026-12-01T00:00:00.000Z',
          promotionOnlySupport: false,
          fitness: { status: 'FIT', reasons: [] },
          disposition: 'MUST_GO',
          blockingReasons: [],
          unresolvedConflictClaimIds: []
        }
      ],
      sourceFailures: []
    }
  })
  await context.coordinator.record({
    sessionId: SESSION_ID,
    eventVersion: 2,
    type: 'research/confirmed',
    payload: { confirmedAt: NOW }
  })
  await context.coordinator.record({
    sessionId: SESSION_ID,
    eventVersion: 2,
    type: 'stage/confirmed',
    payload: { fromStage: 'STAGE_3', toStage: 'STAGE_4', confirmed: true }
  })
  await context.coordinator.record({
    sessionId: SESSION_ID,
    eventVersion: 2,
    type: 'transport/candidates-prepared',
    payload: { candidates: [transportCandidate()] }
  })
  await context.coordinator.record({
    sessionId: SESSION_ID,
    eventVersion: 2,
    type: 'transport/candidate-selected',
    payload: { candidateId: 'transport-selected' }
  })
  await context.coordinator.record({
    sessionId: SESSION_ID,
    eventVersion: 2,
    type: 'skeleton/updated',
    payload: {
      days: state.daySkeletons,
      changedDates: state.daySkeletons.map((day) => day.date),
      boundaryAnchors: state.boundaryAnchors,
      staySegment: state.staySegment!
    }
  })
  await context.coordinator.record({
    sessionId: SESSION_ID,
    eventVersion: 2,
    type: 'stage/confirmed',
    payload: { fromStage: 'STAGE_4', toStage: 'STAGE_5', confirmed: true }
  })
  await context.coordinator.record({
    sessionId: SESSION_ID,
    eventVersion: 2,
    type: 'stay/candidates-prepared',
    payload: {
      candidates: state.stayCandidates,
      sourceOutcomes: [
        {
          sourceId: 'SRC_HOTEL',
          status: 'SUCCEEDED',
          candidateCount: 1,
          errorCode: null,
          capabilityImpact: null,
          manualAlternative: null
        }
      ]
    }
  })
  await context.coordinator.record({
    sessionId: SESSION_ID,
    eventVersion: 2,
    type: 'stay/selected',
    payload: { candidateId: 'stay-selected' }
  })
}

function transportCandidate(): TransportCandidate {
  const leg = (
    kind: 'FIRST_MILE' | 'WAIT' | 'INTERCITY' | 'LAST_MILE',
    label: string,
    startAt: string,
    endAt: string,
    durationMinutes: number,
    claimId: string
  ): Record<string, unknown> => ({
    kind,
    label,
    from: label,
    to: `${label}终点`,
    startAt,
    endAt,
    durationMinutes,
    costCents: null,
    sourceId: kind === 'INTERCITY' ? 'SRC_RAIL' : 'SRC_MAP',
    claimIds: [claimId],
    verificationStatus: 'VERIFIED'
  })
  const outboundLegs = [
    leg(
      'FIRST_MILE',
      '出发接驳',
      '2026-10-01T12:30:00+08:00',
      '2026-10-01T13:00:00+08:00',
      30,
      'route-arrival-poi'
    ),
    leg(
      'WAIT',
      '出发候车',
      '2026-10-01T13:00:00+08:00',
      '2026-10-01T13:30:00+08:00',
      30,
      'rail-arrival'
    ),
    leg(
      'INTERCITY',
      '去程铁路',
      '2026-10-01T13:30:00+08:00',
      '2026-10-01T15:30:00+08:00',
      120,
      'rail-arrival'
    ),
    leg(
      'LAST_MILE',
      '抵达接驳',
      '2026-10-01T15:30:00+08:00',
      '2026-10-01T16:00:00+08:00',
      30,
      'route-arrival-poi'
    )
  ]
  const returnLegs = [
    leg(
      'FIRST_MILE',
      '返程接驳',
      '2026-10-02T16:00:00+08:00',
      '2026-10-02T16:30:00+08:00',
      30,
      'route-poi-departure'
    ),
    leg(
      'WAIT',
      '返程候车',
      '2026-10-02T16:30:00+08:00',
      '2026-10-02T17:00:00+08:00',
      30,
      'rail-departure'
    ),
    leg(
      'INTERCITY',
      '返程铁路',
      '2026-10-02T17:00:00+08:00',
      '2026-10-02T19:00:00+08:00',
      120,
      'rail-departure'
    ),
    leg(
      'LAST_MILE',
      '到家接驳',
      '2026-10-02T19:00:00+08:00',
      '2026-10-02T19:30:00+08:00',
      30,
      'route-poi-departure'
    )
  ]
  return TransportCandidateSchema.parse({
    candidateId: 'transport-selected',
    title: '往返铁路方案',
    mode: 'RAIL',
    outbound: {
      direction: 'OUTBOUND',
      legs: outboundLegs,
      totalDurationMinutes: 210,
      totalCostCents: null
    },
    return: {
      direction: 'RETURN',
      legs: returnLegs,
      totalDurationMinutes: 210,
      totalCostCents: null
    },
    doorToDoorTotalMinutes: 420,
    totalCostCents: null,
    costComplete: false,
    arrivalUsableMinutes: 360,
    departureUsableMinutes: 600,
    comfort: 'GOOD',
    comfortReasons: ['换乘少'],
    isRecommended: true,
    materialDifferences: [],
    claimIds: ['rail-arrival', 'rail-departure']
  })
}

async function createD6Kernel(root: string): Promise<{
  context: Context
  database: Database.Database
  paths: AppPaths
  stop(): Promise<void>
}> {
  const paths = createAppPaths(root)
  const database = new Database(paths.database)
  const migrationNames = [
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
    await Promise.all(
      migrationNames.map(async (name, index) => ({
        version: index + 1,
        sql: await readFile(
          new URL(
            `./db/migrations/${String(index + 1).padStart(4, '0')}_${name}.sql`,
            import.meta.url
          ),
          'utf8'
        )
      }))
    )
  )
  const context = new Context()
  context.plugin(eventLogPlugin, { paths, warn: () => undefined })
  context.plugin(travelStatePlugin, { database, paths, warn: () => undefined })
  context.plugin(sessionPlugin)
  context.plugin(policyPlugin)
  context.plugin(toolsPlugin, {
    database,
    paths,
    sourceConfigStore: new SourceConfigStore(paths.sourceConfig),
    sleep: async () => undefined
  })
  context.plugin(providerPlugin, {
    database,
    configStore: new ProviderConfigStore(paths.providerConfig)
  })
  context.plugin(coordinatorPlugin)
  await context.start()
  await context.travelState.rebuildAll()

  let stopped = false
  return {
    context,
    database,
    paths,
    async stop() {
      if (stopped) return
      stopped = true
      await context.tools.close()
      await context.eventLog.close()
      database.close()
      await context.stop()
    }
  }
}
