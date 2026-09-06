import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { Context } from 'cordis'
import { AppError } from '../shared/errors'
import type { EvidenceClaim } from '../shared/schema/evidence'
import type { TravelBasics } from '../shared/schema/interview'
import {
  normalizeRailJourney,
  RailJourneyClaimValueSchema,
  RailTicketSchema
} from '../shared/schema/mcp/rail'
import {
  D5SourcePlanExecuteRequestSchema,
  D5SourcePlanPreviewRequestSchema,
  D5ProgressEventSchema,
  RailDiscoveryRequestSchema,
  StayPasteRequestSchema,
  StayPrepareRequestSchema,
  TransportPrepareRequestSchema,
  type RailOption,
  type TransportSourceParameters
} from '../shared/schema/d5'
import { applyMigrations } from './db/migrate'
import { createStdioSourceSession, type McpConnectDiagnostic } from './mcp/client'
import { createAppPaths, sessionEventLogPath } from './paths'
import { eventLogPlugin } from './plugins/event-log'
import { policyPlugin } from './plugins/policy'
import { providerPlugin } from './plugins/provider-runtime'
import { sessionPlugin } from './plugins/session'
import { toolsPlugin, type ToolRegistryConfig } from './plugins/tool-registry'
import { travelStatePlugin } from './plugins/travel-state'
import { coordinatorPlugin } from './plugins/coordinator'
import { slotItemsWithinEightKm } from './skills/s07-skeleton'
import { buildStayCandidates } from './skills/s08-lodging'
import { ProviderConfigStore } from './provider-config-store'
import { SourceConfigStore } from './source-config-store'

const STDIO_FIXTURE = fileURLToPath(
  new URL('../../test/fixtures/mcp/stdio-server.ts', import.meta.url)
)

const BASICS: TravelBasics = {
  originCities: ['上海'],
  destinationCities: ['成都'],
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
  dates: { kind: 'FIXED', startDate: '2026-10-01', endDate: '2026-10-04' },
  budget: {
    currency: 'CNY',
    basis: 'TOTAL',
    targetMinor: 100000,
    flexibleRangeMinor: null,
    hardCapMinor: null,
    inclusions: ['TRANSPORT', 'ACCOMMODATION']
  },
  intensity: 'BALANCED',
  preferences: { hardConstraints: [], softPreferences: [], negotiableVariables: [] },
  staySegments: 1
}

const SOURCE_PARAMETERS: TransportSourceParameters = {
  outbound: {
    rail: {
      trainNo: 'G1974',
      date: '2026-10-01',
      fromStation: '上海虹桥',
      toStation: '成都东'
    },
    firstMile: {
      from: '上海住所',
      to: '上海虹桥',
      origin: '121.4737,31.2304',
      destination: '121.3270,31.2005',
      travelMode: 'DRIVING',
      startAt: '2026-10-01T07:00:00+08:00'
    },
    lastMile: {
      from: '成都东',
      to: '成都住区',
      origin: '104.1400,30.6300',
      destination: '104.0679,30.6799',
      travelMode: 'DRIVING',
      startAt: '2026-10-01T16:00:00+08:00'
    }
  },
  return: {
    rail: {
      trainNo: 'G1973',
      date: '2026-10-04',
      fromStation: '成都东',
      toStation: '上海虹桥'
    },
    firstMile: {
      from: '成都住区',
      to: '成都东',
      origin: '104.0679,30.6799',
      destination: '104.1400,30.6300',
      travelMode: 'DRIVING',
      startAt: '2026-10-04T07:00:00+08:00'
    },
    lastMile: {
      from: '上海虹桥',
      to: '上海住所',
      origin: '121.3270,31.2005',
      destination: '121.4737,31.2304',
      travelMode: 'DRIVING',
      startAt: '2026-10-04T15:00:00+08:00'
    }
  }
}

function railOption(direction: 'OUTBOUND' | 'RETURN'): RailOption {
  const outbound = direction === 'OUTBOUND'
  return {
    direction,
    trainNo: outbound ? 'G1974' : 'G1973',
    serviceDate: outbound ? '2026-10-01' : '2026-10-04',
    fromStation: outbound ? '上海' : '成都',
    toStation: outbound ? '成都' : '上海',
    departureTime: outbound ? '11:00' : '09:00',
    arrivalTime: outbound ? '16:00' : '14:00',
    startAt: outbound ? '2026-10-01T11:00:00+08:00' : '2026-10-04T09:00:00+08:00',
    endAt: outbound ? '2026-10-01T16:00:00+08:00' : '2026-10-04T14:00:00+08:00',
    title: outbound ? '上海→成都 G1974' : '成都→上海 G1973'
  }
}

function claim(
  sessionId: string,
  input: Pick<EvidenceClaim, 'claimId' | 'subject' | 'predicate' | 'value' | 'sourceId'>
): EvidenceClaim {
  return {
    ...input,
    sessionId,
    sourceRef: `${input.sourceId}:${input.claimId}`,
    contentIdentity: input.sourceId === 'SRC_HOTEL' ? 'COMMERCIAL_OFFER' : 'OFFICIAL',
    verificationStatus: 'VERIFIED',
    observedAt: '2026-08-27T00:00:00.000Z',
    validUntil: '2026-10-05T00:00:00.000Z',
    confidence: 0.9,
    conflictsWith: [],
    notes: null
  }
}

function fixtures(sessionId: string): EvidenceClaim[] {
  const journey = (
    claimId: string,
    direction: 'OUTBOUND' | 'RETURN',
    from: string,
    to: string,
    startAt: string,
    endAt: string
  ): EvidenceClaim =>
    claim(sessionId, {
      claimId,
      subject: '上海成都铁路',
      predicate: 'railJourney',
      sourceId: 'SRC_RAIL',
      value: {
        candidateId: 'g1974',
        title: '高铁往返',
        direction,
        from,
        to,
        startAt,
        endAt,
        durationMinutes: 300,
        costCents: 55300,
        waitMinutes: 45
      }
    })
  const transfer = (
    claimId: string,
    direction: 'OUTBOUND' | 'RETURN',
    kind: 'FIRST_MILE' | 'LAST_MILE',
    from: string,
    to: string,
    startAt: string,
    endAt: string
  ): EvidenceClaim =>
    claim(sessionId, {
      claimId,
      subject: '车站接驳',
      predicate: 'groundTransfer',
      sourceId: 'SRC_MAP',
      value: {
        candidateId: 'g1974',
        direction,
        kind,
        from,
        to,
        startAt,
        endAt,
        durationMinutes: 40,
        costCents: 6000
      }
    })
  return [
    journey(
      'rail-out',
      'OUTBOUND',
      '上海虹桥',
      '成都东',
      '2026-10-01T11:00:00.000Z',
      '2026-10-01T16:00:00.000Z'
    ),
    journey(
      'rail-back',
      'RETURN',
      '成都东',
      '上海虹桥',
      '2026-10-04T09:00:00.000Z',
      '2026-10-04T14:00:00.000Z'
    ),
    transfer(
      'map-out-first',
      'OUTBOUND',
      'FIRST_MILE',
      '上海住所',
      '上海虹桥',
      '2026-10-01T09:30:00.000Z',
      '2026-10-01T10:10:00.000Z'
    ),
    transfer(
      'map-out-last',
      'OUTBOUND',
      'LAST_MILE',
      '成都东',
      '成都住区',
      '2026-10-01T16:00:00.000Z',
      '2026-10-01T16:40:00.000Z'
    ),
    transfer(
      'map-back-first',
      'RETURN',
      'FIRST_MILE',
      '成都住区',
      '成都东',
      '2026-10-04T07:30:00.000Z',
      '2026-10-04T08:10:00.000Z'
    ),
    transfer(
      'map-back-last',
      'RETURN',
      'LAST_MILE',
      '上海虹桥',
      '上海住所',
      '2026-10-04T14:00:00.000Z',
      '2026-10-04T14:40:00.000Z'
    ),
    claim(sessionId, {
      claimId: 'poi-coordinates',
      subject: '武侯祠',
      predicate: 'coordinates',
      sourceId: 'SRC_MAP',
      value: { lng: 104.047, lat: 30.645 }
    }),
    ...(['SRC_HOTEL', 'SRC_SEARCH', 'USER_PASTE'] as const).map((sourceId, index) =>
      claim(sessionId, {
        claimId: `stay-${index}`,
        subject: `住宿 ${index + 1}`,
        predicate: 'lodgingCandidate',
        sourceId,
        value: {
          name: `成都住宿 ${index + 1}`,
          totalCostCents: 120000 + index * 10000,
          totalCostComplete: true,
          roomType: '大床房',
          bedType: '大床',
          capacity: 2,
          roomFitsParty: index === 0 ? true : index === 1 ? false : null,
          cancellationStatus: 'FREE_UNTIL',
          freeCancelUntil: '2026-09-28T00:00:00.000Z',
          positionAdvantage: '靠近已确认项目区域'
        }
      })
    )
  ]
}

async function createKernel(
  root: string,
  toolOverrides: Partial<
    Pick<ToolRegistryConfig, 'readCredential' | 'createSession' | 'now' | 'sourceConfigStore'>
  > = {}
): Promise<{ context: Context; database: Database.Database }> {
  const paths = createAppPaths(root)
  const database = new Database(paths.database)
  applyMigrations(
    database,
    await Promise.all(
      [1, 2, 3, 4].map(async (version) => ({
        version,
        sql: await readFile(
          new URL(
            `./db/migrations/000${version}_${['init', 'model_call_cost', 'xiaohongshu_source', 'd5_transport_candidates'][version - 1]}.sql`,
            import.meta.url
          ),
          'utf8'
        )
      }))
    )
  )
  const context = new Context()
  context.plugin(eventLogPlugin, { paths })
  context.plugin(travelStatePlugin, { database, paths })
  context.plugin(sessionPlugin)
  context.plugin(policyPlugin)
  context.plugin(toolsPlugin, {
    database,
    paths,
    sourceConfigStore: new SourceConfigStore(paths.sourceConfig),
    sleep: async () => undefined,
    ...toolOverrides
  })
  context.plugin(providerPlugin, {
    database,
    configStore: new ProviderConfigStore(paths.providerConfig)
  })
  context.plugin(coordinatorPlugin)
  await context.start()
  return { context, database }
}

async function stopKernel(context: Context, database: Database.Database): Promise<void> {
  await context.tools.close()
  await context.eventLog.close()
  database.close()
  await context.stop()
}

async function seedStage4(
  context: Context,
  sessionId: string,
  evidence: EvidenceClaim[]
): Promise<void> {
  await context.coordinator.record({
    sessionId,
    eventVersion: 2,
    type: 'session/created',
    payload: {
      title: 'D5 fixture',
      linkedSessionGroup: null,
      splitIndex: null,
      basics: BASICS,
      handoffs: []
    }
  })
  await context.coordinator.record({
    sessionId,
    eventVersion: 2,
    type: 'stage/confirmed',
    payload: { fromStage: 'STAGE_1', toStage: 'STAGE_2', confirmed: true }
  })
  await context.coordinator.confirmFixedDestination({ sessionId, city: '成都' })
  await context.tools.addEvidenceClaims(evidence)
  await context.coordinator.record({
    sessionId,
    eventVersion: 2,
    type: 'research/checklist-prepared',
    payload: {
      entities: [
        {
          entityId: 'wuhou',
          destinationCity: '成都',
          canonicalSubject: '武侯祠',
          aliases: [],
          kind: 'ATTRACTION',
          claimIds: ['poi-coordinates'],
          identityStatus: 'DETERMINISTIC',
          verificationStatus: 'VERIFIED',
          contentIdentities: ['OFFICIAL'],
          validUntil: '2026-10-05T00:00:00.000Z',
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
    sessionId,
    eventVersion: 2,
    type: 'research/confirmed',
    payload: { confirmedAt: '2026-08-27T00:00:00.000Z' }
  })
  await context.coordinator.record({
    sessionId,
    eventVersion: 2,
    type: 'stage/confirmed',
    payload: { fromStage: 'STAGE_3', toStage: 'STAGE_4', confirmed: true }
  })
}

test('D5 builds transport, hard boundary anchors, one stay segment and three-source lodging then replays without model calls', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d5-'))
  const paths = createAppPaths(root)
  try {
    const first = await createKernel(root)
    const sessionId = 'd5-session'
    await seedStage4(first.context, sessionId, fixtures(sessionId))
    let snapshot = await first.context.coordinator.prepareTransport({
      sessionId,
      operationId: crypto.randomUUID()
    })
    snapshot = await first.context.coordinator.selectTransport({
      sessionId,
      candidateId: snapshot.transportCandidates[0]!.candidateId
    })
    snapshot = await first.context.coordinator.prepareSkeleton({
      sessionId,
      operationId: crypto.randomUUID()
    })
    assert.equal(snapshot.boundaryAnchors.length, 2)
    assert.equal(snapshot.boundaryAnchors[0]?.time, '16:40')
    assert.equal(snapshot.daySkeletons[0]?.morning, null)
    assert.equal(snapshot.daySkeletons[0]?.afternoon, null)
    assert.equal(snapshot.staySegment?.nights, 3)
    snapshot = await first.context.coordinator.confirmSkeleton({ sessionId })
    const pasted = await first.context.coordinator.addStayPaste({
      sessionId,
      name: '用户补充公寓',
      totalCostCents: 168800,
      roomType: null,
      bedType: null,
      capacity: null,
      roomFitsParty: null,
      cancellationStatus: 'UNKNOWN',
      freeCancelUntil: null,
      positionAdvantage: '用户粘贴，位置优势待核验'
    })
    assert.equal(pasted.sourceId, 'USER_PASTE')
    assert.equal(pasted.verificationStatus, 'UNVERIFIED')
    snapshot = await first.context.coordinator.prepareStay({
      sessionId,
      operationId: crypto.randomUUID()
    })
    const dayRowsBefore = first.database
      .prepare(
        'SELECT date, morning_json, afternoon_json, evening_json, meal_anchors_json FROM day_skeletons WHERE session_id = ? ORDER BY date'
      )
      .all(sessionId) as Array<Record<string, unknown>>
    snapshot = await first.context.coordinator.patchSkeleton({
      sessionId,
      date: '2026-10-02',
      period: 'AFTERNOON',
      entityId: 'wuhou'
    })
    assert.equal(snapshot.stayCandidates.length, 0)
    const dayRowsAfter = first.database
      .prepare(
        'SELECT date, morning_json, afternoon_json, evening_json, meal_anchors_json FROM day_skeletons WHERE session_id = ? ORDER BY date'
      )
      .all(sessionId) as Array<Record<string, unknown>>
    assert.deepEqual(
      dayRowsAfter.filter((row) => row.date !== '2026-10-02'),
      dayRowsBefore.filter((row) => row.date !== '2026-10-02')
    )
    assert.notDeepEqual(
      dayRowsAfter.find((row) => row.date === '2026-10-02'),
      dayRowsBefore.find((row) => row.date === '2026-10-02')
    )
    snapshot = await first.context.coordinator.prepareStay({
      sessionId,
      operationId: crypto.randomUUID()
    })
    snapshot = await first.context.coordinator.selectStay({
      sessionId,
      candidateId: snapshot.stayCandidates[0]!.candidateId
    })
    assert.equal(
      snapshot.staySourceOutcomes.every((item) => item.status === 'SUCCEEDED'),
      true
    )
    assert.equal(
      snapshot.staySourceOutcomes.find((item) => item.sourceId === 'USER_PASTE')?.candidateCount,
      2
    )
    assert.equal(
      snapshot.stayCandidates
        .filter((candidate) => candidate.roomFitsParty !== true)
        .every((candidate) => candidate.recommendationEligible === false),
      true
    )
    assert.equal(
      (
        first.database
          .prepare('SELECT count(*) AS n FROM model_calls WHERE session_id = ?')
          .get(sessionId) as { n: number }
      ).n,
      0
    )
    const before = first.context.travelState.get(sessionId)
    const journal = await readFile(sessionEventLogPath(paths, sessionId))
    await stopKernel(first.context, first.database)
    await rm(paths.database)
    const second = await createKernel(root)
    await second.context.travelState.rebuildAll()
    assert.deepEqual(second.context.travelState.get(sessionId), before)
    assert.deepEqual(await readFile(sessionEventLogPath(paths, sessionId)), journal)
    assert.equal(
      (
        second.database
          .prepare(
            'SELECT count(*) AS n FROM transport_candidates WHERE session_id = ? AND is_selected = 1'
          )
          .get(sessionId) as { n: number }
      ).n,
      1
    )
    await stopKernel(second.context, second.database)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('D5 materializes a complete typed source request in order, discloses source failure and never writes a partial transport event', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d5-source-flow-'))
  let kernel: Awaited<ReturnType<typeof createKernel>> | undefined
  try {
    kernel = await createKernel(root)
    const sessionId = 'd5-source-flow'
    const failedSessionId = 'd5-source-failure'
    const fixtureEvidence = (id: string): EvidenceClaim[] =>
      fixtures(id).filter(
        (item) => item.predicate === 'coordinates' || item.predicate === 'lodgingCandidate'
      )
    await seedStage4(kernel.context, sessionId, fixtureEvidence(sessionId))
    await seedStage4(kernel.context, failedSessionId, fixtureEvidence(failedSessionId))

    const order: string[] = []
    const assertNoTransportEvent = async (id: string): Promise<void> => {
      assert.equal(
        (await kernel!.context.eventLog.read(id)).some(
          (event) => event.type === 'transport/candidates-prepared'
        ),
        false
      )
    }
    kernel.context.tools.materializeRailJourney = async (input, _operationId, persist = true) => {
      order.push(`${input.sessionId}:RAIL:${input.direction}`)
      await assertNoTransportEvent(input.sessionId)
      const outbound = input.direction === 'OUTBOUND'
      const materialized = claim(input.sessionId, {
        claimId: `${input.sessionId}-rail-${input.direction.toLowerCase()}`,
        subject: `${input.fromStation}→${input.toStation}`,
        predicate: 'railJourney',
        sourceId: 'SRC_RAIL',
        value: {
          candidateId: input.candidateId,
          title: '实时铁路往返',
          direction: input.direction,
          from: input.fromStation,
          to: input.toStation,
          startAt: outbound ? '2026-10-01T11:00:00+08:00' : '2026-10-04T09:00:00+08:00',
          endAt: outbound ? '2026-10-01T16:00:00+08:00' : '2026-10-04T14:00:00+08:00',
          durationMinutes: 300,
          costCents: null,
          waitMinutes: null
        }
      })
      if (persist) await kernel!.context.tools.addEvidenceClaims([materialized])
      return {
        sourceId: 'SRC_RAIL',
        toolName: 'get-tickets',
        claims: [materialized],
        fromCache: false
      }
    }
    kernel.context.tools.materializeMapGroundTransfer = async (
      input,
      _operationId,
      persist = true
    ) => {
      order.push(`${input.sessionId}:MAP:${input.direction}:${input.kind}`)
      await assertNoTransportEvent(input.sessionId)
      if (input.sessionId === failedSessionId && input.direction === 'RETURN') {
        throw new AppError('SOURCE_UNREACHABLE', '地图接驳来源不可用。')
      }
      const materialized = claim(input.sessionId, {
        claimId: `${input.sessionId}-map-${input.direction.toLowerCase()}-${input.kind.toLowerCase()}`,
        subject: `${input.from}→${input.to}`,
        predicate: 'groundTransfer',
        sourceId: 'SRC_MAP',
        value: {
          candidateId: input.candidateId,
          direction: input.direction,
          kind: input.kind,
          from: input.from,
          to: input.to,
          startAt: input.startAt,
          endAt:
            input.direction === 'OUTBOUND' && input.kind === 'LAST_MILE'
              ? '2026-10-01T16:40:00+08:00'
              : input.startAt,
          durationMinutes: 40,
          costCents: null
        }
      })
      if (persist) await kernel!.context.tools.addEvidenceClaims([materialized])
      return {
        sourceId: 'SRC_MAP',
        toolName: 'maps_distance',
        claims: [materialized],
        fromCache: false
      }
    }

    const transportOperationId = crypto.randomUUID()
    let snapshot = await kernel.context.coordinator.prepareTransport({
      sessionId,
      operationId: transportOperationId,
      sourceParameters: SOURCE_PARAMETERS
    })
    assert.deepEqual(order, [
      `${sessionId}:RAIL:OUTBOUND`,
      `${sessionId}:RAIL:RETURN`,
      `${sessionId}:MAP:OUTBOUND:FIRST_MILE`,
      `${sessionId}:MAP:OUTBOUND:LAST_MILE`,
      `${sessionId}:MAP:RETURN:FIRST_MILE`,
      `${sessionId}:MAP:RETURN:LAST_MILE`
    ])
    assert.equal(snapshot.transportCandidates.length, 1)
    assert.equal(
      (await kernel.context.eventLog.read(sessionId)).filter(
        (event) => event.type === 'transport/candidates-prepared'
      ).length,
      1
    )
    const callsAfterSuccess = order.length
    await assert.rejects(
      () =>
        kernel!.context.coordinator.prepareTransport({
          sessionId,
          operationId: transportOperationId,
          sourceParameters: SOURCE_PARAMETERS
        }),
      (error) => error instanceof AppError && error.code === 'INPUT_INVALID'
    )
    assert.equal(order.length, callsAfterSuccess)

    await assert.rejects(
      () =>
        kernel!.context.coordinator.prepareTransport({
          sessionId: failedSessionId,
          operationId: crypto.randomUUID(),
          sourceParameters: SOURCE_PARAMETERS
        }),
      (error) =>
        error instanceof AppError &&
        error.code === 'SOURCE_UNREACHABLE' &&
        error.userHint === '地图接驳来源不可用。'
    )
    await assertNoTransportEvent(failedSessionId)
    assert.equal(
      kernel.context.tools
        .listEvidence(failedSessionId, 200)
        .some((item) => item.predicate === 'railJourney' || item.predicate === 'groundTransfer'),
      false
    )

    snapshot = await kernel.context.coordinator.selectTransport({
      sessionId,
      candidateId: snapshot.transportCandidates[0]!.candidateId
    })
    snapshot = await kernel.context.coordinator.prepareSkeleton({
      sessionId,
      operationId: crypto.randomUUID()
    })
    snapshot = await kernel.context.coordinator.confirmSkeleton({ sessionId })
    kernel.context.tools.materializeHotelLodgingCandidates = async () => {
      throw new AppError('SOURCE_UNREACHABLE', '酒店源不可用。')
    }
    snapshot = await kernel.context.coordinator.prepareStay({
      sessionId,
      operationId: crypto.randomUUID(),
      sourceParameters: {
        place: '成都',
        checkInDate: '2026-10-01',
        stayNights: 3,
        adultCount: 2,
        size: 5
      }
    })
    const hotelOutcome = snapshot.staySourceOutcomes.find(
      (outcome) => outcome.sourceId === 'SRC_HOTEL'
    )
    assert.equal(hotelOutcome?.status, 'FAILED')
    assert.equal(hotelOutcome?.errorCode, 'SOURCE_UNREACHABLE')
    assert.match(hotelOutcome?.capabilityImpact ?? '', /未能提供可核验候选/)
    assert.match(hotelOutcome?.manualAlternative ?? '', /可粘贴/)
    assert.equal(
      snapshot.stayCandidates.some((candidate) => candidate.sourceId === 'SRC_HOTEL'),
      false
    )
    const externalCalls = 0
    assert.equal(externalCalls, 0)
  } finally {
    if (kernel) await stopKernel(kernel.context, kernel.database)
    await rm(root, { recursive: true, force: true })
  }
})

test('D5 derives two-stage source parameters, binds one-shot authorization and never persists the exact address', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d5-auto-source-'))
  let kernel: Awaited<ReturnType<typeof createKernel>> | undefined
  try {
    kernel = await createKernel(root)
    const sessionId = 'd5-auto-source'
    const exactAddress = '上海市测试路 123 号仅本次使用'
    await seedStage4(
      kernel.context,
      sessionId,
      fixtures(sessionId).filter(
        (item) => item.predicate === 'coordinates' || item.predicate === 'lodgingCandidate'
      )
    )

    const preview = kernel.context.coordinator.railDiscoveryPreview(sessionId)
    assert.deepEqual(preview.outbound, {
      direction: 'OUTBOUND',
      date: '2026-10-01',
      fromStation: '上海',
      toStation: '成都'
    })
    assert.deepEqual(preview.return, {
      direction: 'RETURN',
      date: '2026-10-04',
      fromStation: '成都',
      toStation: '上海'
    })

    let railDiscoveryCalls = 0
    kernel.context.tools.discoverRailRoundTripOptions = async (input) => {
      railDiscoveryCalls += 2
      return {
        outboundOptions: [railOption(input.outbound.direction)],
        returnOptions: [railOption(input.return.direction)]
      }
    }
    await assert.rejects(
      () =>
        kernel!.context.coordinator.discoverRailOptions({
          sessionId,
          operationId: crypto.randomUUID(),
          digest: `sha256:${'0'.repeat(64)}`
        }),
      (error) => error instanceof AppError && error.code === 'INPUT_INVALID'
    )
    assert.equal(railDiscoveryCalls, 0)

    const discoveryOperationId = crypto.randomUUID()
    const discovery = await kernel.context.coordinator.discoverRailOptions({
      sessionId,
      operationId: discoveryOperationId,
      digest: preview.digest
    })
    assert.equal(railDiscoveryCalls, 2)
    assert.equal(
      kernel.context.tools
        .listEvidence(sessionId, 200)
        .filter((item) => item.predicate === 'railJourney').length,
      0
    )
    await assert.rejects(
      () =>
        kernel!.context.coordinator.discoverRailOptions({
          sessionId,
          operationId: discoveryOperationId,
          digest: preview.digest
        }),
      (error) => error instanceof AppError && error.code === 'INPUT_INVALID'
    )
    assert.equal(railDiscoveryCalls, 2)

    const selection = kernel.context.coordinator.selectRailOptions({
      sessionId,
      discoveryId: discovery.discoveryId,
      outboundTrainNo: 'G1974',
      returnTrainNo: 'G1973'
    })
    assert.equal(selection.outbound.trainNo, 'G1974')
    assert.equal(selection.return.trainNo, 'G1973')

    kernel.context.tools.hasTransientGeocode = () => false
    const plan = kernel.context.coordinator.previewD5SourcePlan({
      sessionId,
      discoveryId: discovery.discoveryId,
      exactAddress,
      originLabel: '出发地点'
    })
    assert.equal(JSON.stringify(plan).includes(exactAddress), false)
    assert.equal(plan.selectedTrains.outbound.trainNo, 'G1974')
    assert.deepEqual(plan.hotelQuery, {
      place: '成都',
      checkInDate: '2026-10-01',
      stayNights: 3,
      adultCount: 2,
      size: 5
    })
    assert.equal(plan.transfers.length, 4)
    assert.equal(plan.totalExternalCalls, 9)

    let railMaterializationCalls = 0
    const failedSessionId = 'd5-auto-source-failure'
    const geocodeAddresses: string[] = []
    const timedTransfers: Array<{
      direction: 'OUTBOUND' | 'RETURN'
      kind: 'FIRST_MILE' | 'LAST_MILE'
      from: string
      to: string
    }> = []
    let hotelInput: Record<string, unknown> | null = null
    kernel.context.tools.materializeSelectedRailOption = async (input) => {
      railMaterializationCalls += 1
      const outbound = input.option.direction === 'OUTBOUND'
      const materialized = claim(input.sessionId, {
        claimId: `auto-rail-${input.option.direction.toLowerCase()}`,
        subject: input.option.title,
        predicate: 'railJourney',
        sourceId: 'SRC_RAIL',
        value: {
          candidateId: input.candidateId,
          title: '自动装配铁路往返',
          label: `${input.option.trainNo} 铁路段`,
          trainNo: input.option.trainNo,
          serviceDate: input.option.serviceDate,
          direction: input.option.direction,
          from: input.option.fromStation,
          to: input.option.toStation,
          startAt: input.option.startAt,
          endAt: input.option.endAt,
          durationMinutes: 300,
          costCents: null,
          waitMinutes: null,
          departureTime: input.option.departureTime,
          arrivalTime: input.option.arrivalTime,
          seatClass: null,
          marker: outbound ? 'outbound' : 'return'
        }
      })
      return {
        sourceId: 'SRC_RAIL',
        toolName: 'get-tickets',
        claims: [materialized],
        fromCache: true
      }
    }
    kernel.context.tools.materializeTransientMapGeocode = async (input) => {
      geocodeAddresses.push(input.address)
      const materialized = claim(input.sessionId, {
        claimId: `auto-coordinate-${geocodeAddresses.length}`,
        subject: input.label,
        predicate: 'coordinates',
        sourceId: 'SRC_MAP',
        value: { city: input.city, lng: 104 + geocodeAddresses.length / 100, lat: 30.6 }
      })
      return {
        claim: materialized,
        location: { lng: 104 + geocodeAddresses.length / 100, lat: 30.6 },
        fromCache: false
      }
    }
    kernel.context.tools.materializeTimedMapGroundTransfer = async (input) => {
      if (
        input.sessionId === failedSessionId &&
        input.direction === 'RETURN' &&
        input.kind === 'FIRST_MILE'
      ) {
        throw new AppError('SOURCE_UNREACHABLE', '自动接驳夹具失败。')
      }
      timedTransfers.push({
        direction: input.direction,
        kind: input.kind,
        from: input.from,
        to: input.to
      })
      const materialized = claim(input.sessionId, {
        claimId: `auto-map-${input.direction.toLowerCase()}-${input.kind.toLowerCase()}`,
        subject: `${input.from}→${input.to}`,
        predicate: 'groundTransfer',
        sourceId: 'SRC_MAP',
        value: {
          candidateId: input.candidateId,
          direction: input.direction,
          kind: input.kind,
          label: `${input.from}→${input.to} 驾车接驳`,
          from: input.from,
          to: input.to,
          travelMode: input.travelMode,
          startAt: input.railAnchorAt,
          endAt: input.railAnchorAt,
          distanceMeters: 12000,
          durationSeconds: 2400,
          durationMinutes: 40,
          costCents: null
        }
      })
      return {
        sourceId: 'SRC_MAP',
        toolName: 'maps_distance',
        claims: [materialized],
        fromCache: false
      }
    }
    let hotelCalls = 0
    kernel.context.tools.materializeHotelLodgingCandidates = async (input) => {
      hotelCalls += 1
      hotelInput = { ...input }
      const materialized = claim(input.sessionId, {
        claimId: 'auto-hotel',
        subject: '自动酒店候选',
        predicate: 'lodgingCandidate',
        sourceId: 'SRC_HOTEL',
        value: {
          name: '自动酒店候选',
          hotelId: 'hotel-auto',
          address: null,
          starRating: null,
          totalCostCents: null,
          totalCostComplete: false,
          roomType: null,
          bedType: null,
          capacity: null,
          roomFitsParty: null,
          cancellationStatus: 'UNKNOWN',
          freeCancelUntil: null,
          positionAdvantage: null,
          observedLowestPrice: null
        }
      })
      await kernel!.context.tools.addEvidenceClaims([materialized])
      return {
        sourceId: 'SRC_HOTEL',
        toolName: 'searchHotels',
        claims: [materialized],
        fromCache: false
      }
    }

    const executeOperationId = crypto.randomUUID()
    const executed = await kernel.context.coordinator.executeD5SourcePlan({
      sessionId,
      operationId: executeOperationId,
      planId: plan.planId,
      digest: plan.digest
    })
    assert.equal(railDiscoveryCalls, 2)
    assert.equal(railMaterializationCalls, 2)
    assert.equal(geocodeAddresses.filter((address) => address === exactAddress).length, 1)
    assert.equal(timedTransfers.length, 4)
    assert.deepEqual(
      timedTransfers.map((item) => `${item.direction}:${item.kind}`),
      ['OUTBOUND:FIRST_MILE', 'OUTBOUND:LAST_MILE', 'RETURN:FIRST_MILE', 'RETURN:LAST_MILE']
    )
    assert.equal(
      timedTransfers.some((item) => JSON.stringify(item).includes(exactAddress)),
      false
    )
    assert.deepEqual(hotelInput, {
      sessionId,
      place: '成都',
      checkInDate: '2026-10-01',
      stayNights: 3,
      adultCount: 2,
      size: 5
    })
    assert.equal(executed.snapshot.transportCandidates.length, 1)
    assert.equal(executed.hotelOutcome.status, 'SUCCEEDED')
    assert.equal(executed.externalCallCount, 9)
    assert.equal(executed.railExternalCallCount, 0)

    const eventText = await readFile(sessionEventLogPath(createAppPaths(root), sessionId), 'utf8')
    assert.equal(eventText.includes(exactAddress), false)
    const evidenceRows = kernel.database
      .prepare('SELECT * FROM evidence_claims WHERE session_id = ?')
      .all(sessionId)
    assert.equal(JSON.stringify(evidenceRows).includes(exactAddress), false)

    const callsAfterExecution = {
      railDiscoveryCalls,
      railMaterializationCalls,
      geocodes: geocodeAddresses.length,
      transfers: timedTransfers.length
    }
    await assert.rejects(
      () =>
        kernel!.context.coordinator.executeD5SourcePlan({
          sessionId,
          operationId: executeOperationId,
          planId: plan.planId,
          digest: plan.digest
        }),
      (error) => error instanceof AppError && error.code === 'INPUT_INVALID'
    )
    assert.deepEqual(
      {
        railDiscoveryCalls,
        railMaterializationCalls,
        geocodes: geocodeAddresses.length,
        transfers: timedTransfers.length
      },
      callsAfterExecution
    )
    const discoveryCache = (
      kernel.context.coordinator as unknown as {
        railDiscoveries: Map<string, { expiresAt: number }>
      }
    ).railDiscoveries
    discoveryCache.get(discovery.discoveryId)!.expiresAt = 0
    assert.throws(
      () =>
        kernel!.context.coordinator.selectRailOptions({
          sessionId,
          discoveryId: discovery.discoveryId,
          outboundTrainNo: 'G1974',
          returnTrainNo: 'G1973'
        }),
      (error) => error instanceof AppError && error.code === 'INPUT_INVALID'
    )

    await seedStage4(
      kernel.context,
      failedSessionId,
      fixtures(failedSessionId).filter(
        (item) => item.predicate === 'coordinates' || item.predicate === 'lodgingCandidate'
      )
    )
    const failedRailPreview = kernel.context.coordinator.railDiscoveryPreview(failedSessionId)
    const failedDiscovery = await kernel.context.coordinator.discoverRailOptions({
      sessionId: failedSessionId,
      operationId: crypto.randomUUID(),
      digest: failedRailPreview.digest
    })
    kernel.context.coordinator.selectRailOptions({
      sessionId: failedSessionId,
      discoveryId: failedDiscovery.discoveryId,
      outboundTrainNo: 'G1974',
      returnTrainNo: 'G1973'
    })
    const failedPlan = kernel.context.coordinator.previewD5SourcePlan({
      sessionId: failedSessionId,
      discoveryId: failedDiscovery.discoveryId,
      exactAddress: '上海市失败测试路 999 号',
      originLabel: '出发地点'
    })
    await assert.rejects(
      () =>
        kernel!.context.coordinator.executeD5SourcePlan({
          sessionId: failedSessionId,
          operationId: crypto.randomUUID(),
          planId: failedPlan.planId,
          digest: failedPlan.digest
        }),
      (error) => error instanceof AppError && error.code === 'SOURCE_UNREACHABLE'
    )
    assert.equal(
      (await kernel.context.eventLog.read(failedSessionId)).some(
        (event) => event.type === 'transport/candidates-prepared'
      ),
      false
    )
    assert.equal(
      kernel.context.tools
        .listEvidence(failedSessionId, 200)
        .some(
          (item) =>
            item.predicate === 'railJourney' ||
            item.predicate === 'groundTransfer' ||
            item.claimId.startsWith('auto-coordinate-')
        ),
      false
    )
    assert.equal(hotelCalls, 1)
  } finally {
    if (kernel) await stopKernel(kernel.context, kernel.database)
    await rm(root, { recursive: true, force: true })
  }
})

test('D5 rail discovery reuses one cold-start session while keeping each tool call at 15 seconds', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d5-rail-round-trip-'))
  let kernel: Awaited<ReturnType<typeof createKernel>> | undefined
  const connectTimeouts: number[] = []
  const listTimeouts: number[] = []
  const calls: Array<{ name: string; args: Record<string, unknown>; timeoutMs: number }> = []
  let sessionCount = 0
  let closeCount = 0
  try {
    const createSession: NonNullable<ToolRegistryConfig['createSession']> = ({ sourceId }) => {
      assert.equal(sourceId, 'SRC_RAIL')
      sessionCount += 1
      return {
        async connect(timeoutMs): Promise<void> {
          connectTimeouts.push(timeoutMs)
          const requiredColdStartMs = 30_000
          if (timeoutMs < requiredColdStartMs) {
            throw new AppError('MCP_TIMEOUT', 'fixture cold start needs more than 15 seconds')
          }
        },
        async listTools(
          timeoutMs
        ): Promise<Array<{ name: string; description: string; inputSchema: unknown }>> {
          listTimeouts.push(timeoutMs)
          return [
            {
              name: 'get-tickets',
              description: 'read-only fixture lookup',
              inputSchema: { type: 'object' }
            }
          ]
        },
        async callTool(name, args, timeoutMs): Promise<unknown> {
          calls.push({ name, args, timeoutMs })
          const outbound = args.fromStation === '上海'
          const tickets = outbound
            ? [
                {
                  train_no: '5l000G19740A',
                  start_train_code: 'G1974',
                  start_time: '11:00',
                  arrive_time: '16:00'
                },
                ...Array.from({ length: 21 }, (_, index) => ({
                  train_no: `internal-${index}`,
                  start_train_code: `G${2000 + index}`,
                  start_time: '12:00',
                  arrive_time: '17:00'
                }))
              ]
            : [
                {
                  train_no: '5l000G19730A',
                  start_train_code: 'G1973',
                  start_time: '09:00',
                  arrive_time: '14:00'
                }
              ]
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(tickets)
              }
            ]
          }
        },
        async close(): Promise<void> {
          closeCount += 1
        }
      }
    }
    kernel = await createKernel(root, { createSession })
    const sessionId = 'd5-rail-round-trip'
    await seedStage4(
      kernel.context,
      sessionId,
      fixtures(sessionId).filter((item) => item.claimId === 'poi-coordinates')
    )
    const preview = kernel.context.coordinator.railDiscoveryPreview(sessionId)

    const result = await kernel.context.coordinator.discoverRailOptions({
      sessionId,
      operationId: crypto.randomUUID(),
      digest: preview.digest
    })

    assert.equal(sessionCount, 1)
    assert.deepEqual(connectTimeouts, [60_000])
    assert.deepEqual(listTimeouts, [15_000])
    assert.deepEqual(
      calls.map((call) => [call.name, call.timeoutMs]),
      [
        ['get-tickets', 15_000],
        ['get-tickets', 15_000]
      ]
    )
    assert.deepEqual(
      calls.map((call) => ({
        date: call.args.date,
        fromStation: call.args.fromStation,
        toStation: call.args.toStation,
        format: call.args.format
      })),
      [
        { date: '2026-10-01', fromStation: '上海', toStation: '成都', format: 'json' },
        { date: '2026-10-04', fromStation: '成都', toStation: '上海', format: 'json' }
      ]
    )
    assert.equal(closeCount, 1)
    assert.equal(result.outboundOptions[0]?.trainNo, 'G1974')
    assert.equal(result.outboundOptions.length, 20)
    assert.equal(result.returnOptions[0]?.trainNo, 'G1973')
    assert.equal(
      kernel.context.tools
        .listToolCalls(sessionId, 100)
        .filter((call) => call.sourceId === 'SRC_RAIL').length,
      2
    )
    assert.equal(
      kernel.context.tools
        .listEvidence(sessionId, 200)
        .filter((item) => item.predicate === 'railJourney').length,
      0
    )
  } finally {
    if (kernel) await stopKernel(kernel.context, kernel.database)
    await rm(root, { recursive: true, force: true })
  }
})

test('multi-city Rail batch reuses one cold-start session for all 19 serial planned calls', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-multi-city-rail-batch-'))
  let kernel: Awaited<ReturnType<typeof createKernel>> | undefined
  const connectTimeouts: number[] = []
  const listTimeouts: number[] = []
  const calls: Array<{ name: string; args: Record<string, unknown>; timeoutMs: number }> = []
  const progress: Array<[number, number]> = []
  let sessionCount = 0
  let closeCount = 0
  try {
    const createSession: NonNullable<ToolRegistryConfig['createSession']> = ({ sourceId }) => {
      assert.equal(sourceId, 'SRC_RAIL')
      sessionCount += 1
      return {
        async connect(timeoutMs): Promise<void> {
          connectTimeouts.push(timeoutMs)
          if (timeoutMs < 30_000) throw new AppError('MCP_TIMEOUT', 'fixture cold start')
        },
        async listTools(
          timeoutMs
        ): Promise<Array<{ name: string; description: string; inputSchema: unknown }>> {
          listTimeouts.push(timeoutMs)
          return [
            {
              name: 'get-tickets',
              description: 'read-only fixture lookup',
              inputSchema: { type: 'object' }
            }
          ]
        },
        async callTool(name, args, timeoutMs): Promise<unknown> {
          calls.push({ name, args, timeoutMs })
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify([
                  {
                    train_no: `internal-${calls.length}`,
                    start_train_code: `G${2000 + calls.length}`,
                    start_time: '08:00',
                    arrive_time: '10:00'
                  }
                ])
              }
            ]
          }
        },
        async close(): Promise<void> {
          closeCount += 1
        }
      }
    }
    kernel = await createKernel(root, { createSession })
    const sessionId = 'multi-city-rail-batch'
    const requests = Array.from({ length: 19 }, (_, index) => ({
      sessionId,
      direction: index === 18 ? ('RETURN' as const) : ('OUTBOUND' as const),
      date: `2026-09-${(index + 1).toString().padStart(2, '0')}`,
      fromStation: `城市${index}`,
      toStation: `城市${index + 1}`
    }))

    const outcomes = await kernel.context.tools.discoverRailOptionsBatch(
      requests,
      crypto.randomUUID(),
      (completed, total) => progress.push([completed, total])
    )

    assert.equal(sessionCount, 1)
    assert.deepEqual(connectTimeouts, [60_000])
    assert.deepEqual(listTimeouts, [15_000])
    assert.equal(calls.length, 19)
    assert.equal(
      calls.every((call) => call.name === 'get-tickets' && call.timeoutMs === 15_000),
      true
    )
    assert.deepEqual(
      calls.map((call) => [call.args.fromStation, call.args.toStation]),
      requests.map((request) => [request.fromStation, request.toStation])
    )
    assert.equal(outcomes.length, requests.length)
    assert.equal(
      outcomes.every((outcome) => outcome.ok),
      true
    )
    assert.deepEqual(
      progress,
      Array.from({ length: 19 }, (_, index) => [index + 1, 19])
    )
    assert.equal(closeCount, 1)
    assert.equal(
      kernel.context.tools
        .listToolCalls(sessionId, 100)
        .filter((call) => call.sourceId === 'SRC_RAIL').length,
      19
    )
  } finally {
    if (kernel) await stopKernel(kernel.context, kernel.database)
    await rm(root, { recursive: true, force: true })
  }
})

test('multi-city Rail batch stops external calls after schema drift and settles the remainder locally', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-multi-city-rail-drift-'))
  let kernel: Awaited<ReturnType<typeof createKernel>> | undefined
  let callCount = 0
  let closeCount = 0
  try {
    const createSession: NonNullable<ToolRegistryConfig['createSession']> = ({ sourceId }) => {
      assert.equal(sourceId, 'SRC_RAIL')
      return {
        async connect(timeoutMs): Promise<void> {
          assert.equal(timeoutMs, 60_000)
        },
        async listTools(
          timeoutMs
        ): Promise<Array<{ name: string; description: string; inputSchema: unknown }>> {
          assert.equal(timeoutMs, 15_000)
          return [
            {
              name: 'get-tickets',
              description: 'read-only fixture lookup',
              inputSchema: { type: 'object' }
            }
          ]
        },
        async callTool(): Promise<unknown> {
          callCount += 1
          return { content: [{ type: 'text' }] }
        },
        async close(): Promise<void> {
          closeCount += 1
        }
      }
    }
    kernel = await createKernel(root, { createSession })
    const sessionId = 'multi-city-rail-drift'
    const requests = [
      {
        sessionId,
        direction: 'OUTBOUND' as const,
        date: '2026-09-08',
        fromStation: '广州',
        toStation: '大理'
      },
      {
        sessionId,
        direction: 'RETURN' as const,
        date: '2026-09-17',
        fromStation: '大理',
        toStation: '广州'
      }
    ]

    const outcomes = await kernel.context.tools.discoverRailOptionsBatch(
      requests,
      crypto.randomUUID()
    )

    assert.equal(callCount, 1)
    assert.equal(closeCount, 1)
    assert.equal(outcomes[0]?.ok, false)
    assert.equal(outcomes[1]?.ok, false)
    if (outcomes[0]?.ok === false) {
      assert.equal(outcomes[0].error instanceof AppError && outcomes[0].error.code, 'SOURCE_DRIFT')
    }
    if (outcomes[1]?.ok === false) {
      assert.equal(
        outcomes[1].error instanceof AppError && outcomes[1].error.code,
        'SOURCE_ADAPTER_DEGRADED'
      )
    }
    const audits = kernel.context.tools
      .listToolCalls(sessionId, 100)
      .filter((call) => call.sourceId === 'SRC_RAIL')
    assert.equal(audits.length, 1)
    assert.equal(audits[0]?.ok, false)
    assert.equal(audits[0]?.errorCode, 'SOURCE_DRIFT')
  } finally {
    if (kernel) await stopKernel(kernel.context, kernel.database)
    await rm(root, { recursive: true, force: true })
  }
})

test('multi-city Rail batch turns setup failure into bounded outcomes without tool audits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-multi-city-rail-setup-failure-'))
  let kernel: Awaited<ReturnType<typeof createKernel>> | undefined
  const progress: Array<[number, number]> = []
  let callCount = 0
  let closeCount = 0
  try {
    const createSession: NonNullable<ToolRegistryConfig['createSession']> = ({ sourceId }) => {
      assert.equal(sourceId, 'SRC_RAIL')
      return {
        async connect(timeoutMs): Promise<void> {
          assert.equal(timeoutMs, 60_000)
          throw new AppError('MCP_TIMEOUT', 'fixture initialize timeout')
        },
        async listTools(): Promise<[]> {
          return []
        },
        async callTool(): Promise<unknown> {
          callCount += 1
          return {}
        },
        async close(): Promise<void> {
          closeCount += 1
        }
      }
    }
    kernel = await createKernel(root, { createSession })
    const sessionId = 'multi-city-rail-setup-failure'
    const requests = [
      {
        sessionId,
        direction: 'OUTBOUND' as const,
        date: '2026-09-08',
        fromStation: '广州',
        toStation: '大理'
      },
      {
        sessionId,
        direction: 'RETURN' as const,
        date: '2026-09-17',
        fromStation: '大理',
        toStation: '广州'
      }
    ]

    const outcomes = await kernel.context.tools.discoverRailOptionsBatch(
      requests,
      crypto.randomUUID(),
      (completed, total) => progress.push([completed, total])
    )

    assert.equal(outcomes.length, 2)
    assert.equal(outcomes[0]?.ok, false)
    assert.equal(outcomes[1]?.ok, false)
    if (outcomes[0]?.ok === false) {
      assert.equal(outcomes[0].error instanceof AppError && outcomes[0].error.code, 'MCP_TIMEOUT')
    }
    if (outcomes[1]?.ok === false) {
      assert.equal(
        outcomes[1].error instanceof AppError && outcomes[1].error.code,
        'SOURCE_ADAPTER_DEGRADED'
      )
    }
    assert.equal(callCount, 0)
    assert.equal(closeCount, 1)
    assert.equal(kernel.context.tools.listToolCalls(sessionId, 100).length, 0)
    assert.deepEqual(progress, [
      [1, 2],
      [2, 2]
    ])
  } finally {
    if (kernel) await stopKernel(kernel.context, kernel.database)
    await rm(root, { recursive: true, force: true })
  }
})

test('D5 rail round-trip uses one local stdio session for exactly two audited calls', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d5-rail-local-stdio-'))
  const pidPath = join(root, 'rail-child.pid')
  const tracePath = join(root, 'rail-methods.log')
  const diagnostics: McpConnectDiagnostic[] = []
  let kernel: Awaited<ReturnType<typeof createKernel>> | undefined
  let sessionCount = 0
  try {
    kernel = await createKernel(root, {
      createSession: ({ sourceId }) => {
        assert.equal(sourceId, 'SRC_RAIL')
        sessionCount += 1
        return createStdioSourceSession({
          command: process.execPath,
          args: ['--import', 'tsx', STDIO_FIXTURE, 'rail-round-trip', pidPath, tracePath],
          onDiagnostic: (diagnostic) => diagnostics.push(diagnostic)
        })
      }
    })
    const sessionId = 'd5-rail-local-stdio'
    await seedStage4(
      kernel.context,
      sessionId,
      fixtures(sessionId).filter((item) => item.claimId === 'poi-coordinates')
    )
    const preview = kernel.context.coordinator.railDiscoveryPreview(sessionId)

    const result = await kernel.context.coordinator.discoverRailOptions({
      sessionId,
      operationId: crypto.randomUUID(),
      digest: preview.digest
    })

    assert.equal(sessionCount, 1)
    assert.deepEqual(diagnostics, [])
    assert.equal(result.outboundOptions[0]?.trainNo, 'G1974')
    assert.equal(result.returnOptions[0]?.trainNo, 'G1973')
    assert.equal(
      kernel.context.tools
        .listToolCalls(sessionId, 100)
        .filter((call) => call.sourceId === 'SRC_RAIL').length,
      2
    )
    const methods = (await readFile(tracePath, 'utf8')).trim().split(/\r?\n/)
    assert.equal(methods.filter((method) => method === 'initialize').length, 1)
    assert.equal(methods.filter((method) => method === 'tools/list').length, 1)
    assert.equal(methods.filter((method) => method === 'tools/call').length, 2)
    assert.deepEqual(
      methods.filter((method) => method === 'tools/list' || method === 'tools/call'),
      ['tools/list', 'tools/call', 'tools/call']
    )
  } finally {
    if (kernel) await stopKernel(kernel.context, kernel.database)
    if (sessionCount > 0) {
      const pid = Number(await readFile(pidPath, 'utf8'))
      assertProcessStopped(pid)
    }
    await rm(root, { recursive: true, force: true })
  }
})

test('D5 rail round-trip maps a pre-session source configuration failure without starting Rail', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d5-rail-source-config-failure-'))
  let kernel: Awaited<ReturnType<typeof createKernel>> | undefined
  let sessionCount = 0
  class ToggleSourceConfigStore extends SourceConfigStore {
    fail = false

    override get(): ReturnType<SourceConfigStore['get']> {
      return this.fail ? Promise.reject(new Error('private source config failure')) : super.get()
    }
  }
  const sourceConfigStore = new ToggleSourceConfigStore(createAppPaths(root).sourceConfig)
  try {
    kernel = await createKernel(root, {
      sourceConfigStore,
      createSession: () => {
        sessionCount += 1
        throw new Error('Rail session must not start')
      }
    })
    sourceConfigStore.fail = true
    const sessionId = 'd5-rail-source-config-failure'

    await assert.rejects(
      () =>
        kernel!.context.tools.discoverRailRoundTripOptions(
          {
            outbound: {
              sessionId,
              direction: 'OUTBOUND',
              date: '2026-10-01',
              fromStation: '上海',
              toStation: '成都'
            },
            return: {
              sessionId,
              direction: 'RETURN',
              date: '2026-10-04',
              fromStation: '成都',
              toStation: '上海'
            }
          },
          crypto.randomUUID()
        ),
      (error) => error instanceof AppError && error.code === 'INTERNAL_SERVICE_NOT_READY'
    )
    assert.equal(sessionCount, 0)
    assert.equal(kernel.context.tools.listToolCalls(sessionId, 100).length, 0)
  } finally {
    if (kernel) await stopKernel(kernel.context, kernel.database)
    await rm(root, { recursive: true, force: true })
  }
})

test('D5 rail round-trip maps a session construction failure before connect', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d5-rail-session-failure-'))
  let kernel: Awaited<ReturnType<typeof createKernel>> | undefined
  let sessionCount = 0
  try {
    kernel = await createKernel(root, {
      createSession: () => {
        sessionCount += 1
        throw new Error('private session construction failure')
      }
    })
    const sessionId = 'd5-rail-session-failure'

    await assert.rejects(
      () =>
        kernel!.context.tools.discoverRailRoundTripOptions(
          {
            outbound: {
              sessionId,
              direction: 'OUTBOUND',
              date: '2026-10-01',
              fromStation: '上海',
              toStation: '成都'
            },
            return: {
              sessionId,
              direction: 'RETURN',
              date: '2026-10-04',
              fromStation: '成都',
              toStation: '上海'
            }
          },
          crypto.randomUUID()
        ),
      (error) => error instanceof AppError && error.code === 'SOURCE_UNREACHABLE'
    )
    assert.equal(sessionCount, 1)
    assert.equal(kernel.context.tools.listToolCalls(sessionId, 100).length, 0)
  } finally {
    if (kernel) await stopKernel(kernel.context, kernel.database)
    await rm(root, { recursive: true, force: true })
  }
})

test('D5 rail round-trip maps a plain connect failure and closes without an audit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d5-rail-plain-connect-failure-'))
  let kernel: Awaited<ReturnType<typeof createKernel>> | undefined
  let callCount = 0
  let closeCount = 0
  try {
    kernel = await createKernel(root, {
      createSession: () => ({
        connect(): Promise<void> {
          return Promise.reject(new Error('private connect failure'))
        },
        listTools(): Promise<[]> {
          return Promise.resolve([])
        },
        callTool(): Promise<unknown> {
          callCount += 1
          return Promise.resolve({ content: [] })
        },
        close(): Promise<void> {
          closeCount += 1
          return Promise.resolve()
        }
      })
    })
    const sessionId = 'd5-rail-plain-connect-failure'

    await assert.rejects(
      () =>
        kernel!.context.tools.discoverRailRoundTripOptions(
          {
            outbound: {
              sessionId,
              direction: 'OUTBOUND',
              date: '2026-10-01',
              fromStation: '上海',
              toStation: '成都'
            },
            return: {
              sessionId,
              direction: 'RETURN',
              date: '2026-10-04',
              fromStation: '成都',
              toStation: '上海'
            }
          },
          crypto.randomUUID()
        ),
      (error) => error instanceof AppError && error.code === 'MCP_PROTOCOL_ERROR'
    )
    assert.equal(callCount, 0)
    assert.equal(closeCount, 1)
    assert.equal(kernel.context.tools.listToolCalls(sessionId, 100).length, 0)
  } finally {
    if (kernel) await stopKernel(kernel.context, kernel.database)
    await rm(root, { recursive: true, force: true })
  }
})

test('D5 rail round-trip maps plain discovery and registration failures by phase', async (t) => {
  for (const failureStage of ['listTools', 'register'] as const) {
    await t.test(failureStage, async () => {
      const root = await mkdtemp(
        join(tmpdir(), `travel-harness-d5-rail-plain-${failureStage}-failure-`)
      )
      let kernel: Awaited<ReturnType<typeof createKernel>> | undefined
      let callCount = 0
      let closeCount = 0
      try {
        kernel = await createKernel(root, {
          createSession: () => ({
            connect(): Promise<void> {
              return Promise.resolve()
            },
            listTools(): Promise<
              Array<{ name: string; description: string; inputSchema: unknown }>
            > {
              if (failureStage === 'listTools') {
                return Promise.reject(new Error('private discovery failure'))
              }
              return Promise.resolve([
                {
                  name: 'get-tickets',
                  description: 'read-only fixture lookup',
                  inputSchema: { type: 'object' }
                }
              ])
            },
            callTool(): Promise<unknown> {
              callCount += 1
              return Promise.resolve({ content: [] })
            },
            close(): Promise<void> {
              closeCount += 1
              return Promise.resolve()
            }
          })
        })
        if (failureStage === 'register') {
          kernel.context.policy.checkTool = () => {
            throw new Error('private registration failure')
          }
        }
        const sessionId = `d5-rail-plain-${failureStage}-failure`

        await assert.rejects(
          () =>
            kernel!.context.tools.discoverRailRoundTripOptions(
              {
                outbound: {
                  sessionId,
                  direction: 'OUTBOUND',
                  date: '2026-10-01',
                  fromStation: '上海',
                  toStation: '成都'
                },
                return: {
                  sessionId,
                  direction: 'RETURN',
                  date: '2026-10-04',
                  fromStation: '成都',
                  toStation: '上海'
                }
              },
              crypto.randomUUID()
            ),
          (error) =>
            error instanceof AppError &&
            error.code ===
              (failureStage === 'listTools' ? 'MCP_PROTOCOL_ERROR' : 'INTERNAL_SERVICE_NOT_READY')
        )
        assert.equal(callCount, 0)
        assert.equal(closeCount, 1)
        assert.equal(kernel.context.tools.listToolCalls(sessionId, 100).length, 0)
      } finally {
        if (kernel) await stopKernel(kernel.context, kernel.database)
        await rm(root, { recursive: true, force: true })
      }
    })
  }
})

test('D5 rail round-trip discovery stops after an outbound failure without retrying and still closes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d5-rail-outbound-failure-'))
  let kernel: Awaited<ReturnType<typeof createKernel>> | undefined
  let sessionCount = 0
  let callCount = 0
  let closeCount = 0
  try {
    const createSession: NonNullable<ToolRegistryConfig['createSession']> = ({ sourceId }) => {
      assert.equal(sourceId, 'SRC_RAIL')
      sessionCount += 1
      return {
        async connect(timeoutMs): Promise<void> {
          assert.equal(timeoutMs, 60_000)
        },
        async listTools(
          timeoutMs
        ): Promise<Array<{ name: string; description: string; inputSchema: unknown }>> {
          assert.equal(timeoutMs, 15_000)
          return [
            {
              name: 'get-tickets',
              description: 'read-only fixture lookup',
              inputSchema: { type: 'object' }
            }
          ]
        },
        async callTool(_name, _args, timeoutMs): Promise<unknown> {
          callCount += 1
          assert.equal(timeoutMs, 15_000)
          throw new AppError('MCP_TIMEOUT', 'fixture outbound timeout')
        },
        async close(): Promise<void> {
          closeCount += 1
        }
      }
    }
    kernel = await createKernel(root, { createSession })
    const sessionId = 'd5-rail-outbound-failure'

    await assert.rejects(
      () =>
        kernel!.context.tools.discoverRailRoundTripOptions(
          {
            outbound: {
              sessionId,
              direction: 'OUTBOUND',
              date: '2026-10-01',
              fromStation: '上海',
              toStation: '成都'
            },
            return: {
              sessionId,
              direction: 'RETURN',
              date: '2026-10-04',
              fromStation: '成都',
              toStation: '上海'
            }
          },
          crypto.randomUUID()
        ),
      (error) => error instanceof AppError && error.code === 'MCP_TIMEOUT'
    )
    assert.equal(sessionCount, 1)
    assert.equal(callCount, 1)
    assert.equal(closeCount, 1)
    const audits = kernel.context.tools
      .listToolCalls(sessionId, 100)
      .filter((call) => call.sourceId === 'SRC_RAIL')
    assert.equal(audits.length, 1)
    assert.equal(audits[0]?.ok, false)
    assert.equal(audits[0]?.errorCode, 'MCP_TIMEOUT')
  } finally {
    if (kernel) await stopKernel(kernel.context, kernel.database)
    await rm(root, { recursive: true, force: true })
  }
})

test('D5 rail round-trip keeps a plain outbound failure aligned with its audit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d5-rail-plain-call-failure-'))
  let kernel: Awaited<ReturnType<typeof createKernel>> | undefined
  let callCount = 0
  let closeCount = 0
  try {
    kernel = await createKernel(root, {
      createSession: () => ({
        connect(): Promise<void> {
          return Promise.resolve()
        },
        listTools(): Promise<Array<{ name: string; description: string; inputSchema: unknown }>> {
          return Promise.resolve([
            {
              name: 'get-tickets',
              description: 'read-only fixture lookup',
              inputSchema: { type: 'object' }
            }
          ])
        },
        callTool(): Promise<unknown> {
          callCount += 1
          return Promise.reject(new Error('private outbound transport failure'))
        },
        close(): Promise<void> {
          closeCount += 1
          return Promise.reject(new Error('private close failure after outbound failure'))
        }
      })
    })
    const sessionId = 'd5-rail-plain-call-failure'

    await assert.rejects(
      () =>
        kernel!.context.tools.discoverRailRoundTripOptions(
          {
            outbound: {
              sessionId,
              direction: 'OUTBOUND',
              date: '2026-10-01',
              fromStation: '上海',
              toStation: '成都'
            },
            return: {
              sessionId,
              direction: 'RETURN',
              date: '2026-10-04',
              fromStation: '成都',
              toStation: '上海'
            }
          },
          crypto.randomUUID()
        ),
      (error) => error instanceof AppError && error.code === 'SOURCE_UNREACHABLE'
    )
    assert.equal(callCount, 1)
    assert.equal(closeCount, 1)
    const audits = kernel.context.tools
      .listToolCalls(sessionId, 100)
      .filter((call) => call.sourceId === 'SRC_RAIL')
    assert.equal(audits.length, 1)
    assert.equal(audits[0]?.ok, false)
    assert.equal(audits[0]?.errorCode, 'SOURCE_UNREACHABLE')
  } finally {
    if (kernel) await stopKernel(kernel.context, kernel.database)
    await rm(root, { recursive: true, force: true })
  }
})

test('D5 rail round-trip maps a plain close failure after both calls are audited', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d5-rail-plain-close-failure-'))
  let kernel: Awaited<ReturnType<typeof createKernel>> | undefined
  let callCount = 0
  let closeCount = 0
  try {
    kernel = await createKernel(root, {
      createSession: () => ({
        connect(): Promise<void> {
          return Promise.resolve()
        },
        listTools(): Promise<Array<{ name: string; description: string; inputSchema: unknown }>> {
          return Promise.resolve([
            {
              name: 'get-tickets',
              description: 'read-only fixture lookup',
              inputSchema: { type: 'object' }
            }
          ])
        },
        callTool(_name, args): Promise<unknown> {
          callCount += 1
          const outbound = args.fromStation === '上海'
          return Promise.resolve({
            content: [
              {
                type: 'text',
                text: JSON.stringify([
                  {
                    train_no: outbound ? '5l000G19740A' : '5l000G19730A',
                    start_train_code: outbound ? 'G1974' : 'G1973',
                    start_time: outbound ? '11:00' : '09:00',
                    arrive_time: outbound ? '16:00' : '14:00'
                  }
                ])
              }
            ]
          })
        },
        close(): Promise<void> {
          closeCount += 1
          return Promise.reject(new Error('private close failure'))
        }
      })
    })
    const sessionId = 'd5-rail-plain-close-failure'

    await assert.rejects(
      () =>
        kernel!.context.tools.discoverRailRoundTripOptions(
          {
            outbound: {
              sessionId,
              direction: 'OUTBOUND',
              date: '2026-10-01',
              fromStation: '上海',
              toStation: '成都'
            },
            return: {
              sessionId,
              direction: 'RETURN',
              date: '2026-10-04',
              fromStation: '成都',
              toStation: '上海'
            }
          },
          crypto.randomUUID()
        ),
      (error) => error instanceof AppError && error.code === 'MCP_PROTOCOL_ERROR'
    )
    assert.equal(callCount, 2)
    assert.equal(closeCount, 1)
    assert.equal(
      kernel.context.tools
        .listToolCalls(sessionId, 100)
        .filter((call) => call.sourceId === 'SRC_RAIL').length,
      2
    )
  } finally {
    if (kernel) await stopKernel(kernel.context, kernel.database)
    await rm(root, { recursive: true, force: true })
  }
})

test('D5 rail round-trip connect and discovery failures create no tool-call audit', async (t) => {
  for (const failureStage of ['connect', 'listTools'] as const) {
    await t.test(failureStage, async () => {
      const root = await mkdtemp(join(tmpdir(), `travel-harness-d5-rail-${failureStage}-failure-`))
      let kernel: Awaited<ReturnType<typeof createKernel>> | undefined
      let sessionCount = 0
      let callCount = 0
      let closeCount = 0
      try {
        const createSession: NonNullable<ToolRegistryConfig['createSession']> = ({ sourceId }) => {
          assert.equal(sourceId, 'SRC_RAIL')
          sessionCount += 1
          return {
            async connect(timeoutMs): Promise<void> {
              assert.equal(timeoutMs, 60_000)
              if (failureStage === 'connect') {
                throw new AppError('MCP_TIMEOUT', 'fixture connect timeout')
              }
            },
            async listTools(
              timeoutMs
            ): Promise<Array<{ name: string; description: string; inputSchema: unknown }>> {
              assert.equal(timeoutMs, 15_000)
              throw new AppError('MCP_TIMEOUT', 'fixture discovery timeout')
            },
            async callTool(): Promise<unknown> {
              callCount += 1
              return { content: [] }
            },
            async close(): Promise<void> {
              closeCount += 1
            }
          }
        }
        kernel = await createKernel(root, { createSession })
        const sessionId = `d5-rail-${failureStage}-failure`
        await assert.rejects(
          () =>
            kernel!.context.tools.discoverRailRoundTripOptions(
              {
                outbound: {
                  sessionId,
                  direction: 'OUTBOUND',
                  date: '2026-10-01',
                  fromStation: '上海',
                  toStation: '成都'
                },
                return: {
                  sessionId,
                  direction: 'RETURN',
                  date: '2026-10-04',
                  fromStation: '成都',
                  toStation: '上海'
                }
              },
              crypto.randomUUID()
            ),
          (error) => error instanceof AppError && error.code === 'MCP_TIMEOUT'
        )
        assert.equal(sessionCount, 1)
        assert.equal(callCount, 0)
        assert.equal(closeCount, 1)
        assert.equal(kernel.context.tools.listToolCalls(sessionId, 100).length, 0)
      } finally {
        if (kernel) await stopKernel(kernel.context, kernel.database)
        await rm(root, { recursive: true, force: true })
      }
    })
  }
})

test('D5 rail round-trip cancellation closes the active session and skips the return call', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d5-rail-cancel-'))
  let kernel: Awaited<ReturnType<typeof createKernel>> | undefined
  let callCount = 0
  let closeCount = 0
  let rejectActiveCall: ((reason?: unknown) => void) | undefined
  let markCallStarted: (() => void) | undefined
  const callStarted = new Promise<void>((resolve) => {
    markCallStarted = resolve
  })
  try {
    const createSession: NonNullable<ToolRegistryConfig['createSession']> = ({ sourceId }) => {
      assert.equal(sourceId, 'SRC_RAIL')
      let closed = false
      return {
        async connect(timeoutMs): Promise<void> {
          assert.equal(timeoutMs, 60_000)
        },
        async listTools(
          timeoutMs
        ): Promise<Array<{ name: string; description: string; inputSchema: unknown }>> {
          assert.equal(timeoutMs, 15_000)
          return [
            {
              name: 'get-tickets',
              description: 'read-only fixture lookup',
              inputSchema: { type: 'object' }
            }
          ]
        },
        callTool(_name, _args, timeoutMs): Promise<unknown> {
          callCount += 1
          assert.equal(timeoutMs, 15_000)
          markCallStarted?.()
          return new Promise((_, reject) => {
            rejectActiveCall = reject
          })
        },
        async close(): Promise<void> {
          if (closed) return
          closed = true
          closeCount += 1
          rejectActiveCall?.(new Error('fixture session closed'))
        }
      }
    }
    kernel = await createKernel(root, { createSession })
    const sessionId = 'd5-rail-cancel'
    const operationId = crypto.randomUUID()
    const discovery = kernel.context.tools.discoverRailRoundTripOptions(
      {
        outbound: {
          sessionId,
          direction: 'OUTBOUND',
          date: '2026-10-01',
          fromStation: '上海',
          toStation: '成都'
        },
        return: {
          sessionId,
          direction: 'RETURN',
          date: '2026-10-04',
          fromStation: '成都',
          toStation: '上海'
        }
      },
      operationId
    )

    await callStarted
    assert.equal(await kernel.context.tools.cancelOperation(operationId), true)
    await assert.rejects(
      discovery,
      (error) => error instanceof AppError && error.code === 'SOURCE_CANCELLED'
    )
    assert.equal(callCount, 1)
    assert.equal(closeCount, 1)
    const audits = kernel.context.tools
      .listToolCalls(sessionId, 100)
      .filter((call) => call.sourceId === 'SRC_RAIL')
    assert.equal(audits.length, 1)
    assert.equal(audits[0]?.ok, false)
    assert.equal(audits[0]?.errorCode, 'SOURCE_CANCELLED')
  } finally {
    if (kernel) await stopKernel(kernel.context, kernel.database)
    await rm(root, { recursive: true, force: true })
  }
})

test('D5 rail round-trip keeps the allowlist and result-schema gates on the shared session', async (t) => {
  for (const scenario of [
    {
      name: 'allowlist',
      toolName: 'createOrder',
      expectedCode: 'NOT_IN_ALLOWLIST',
      expectedCalls: 0,
      expectedAudits: 0
    },
    {
      name: 'schema-drift',
      toolName: 'get-tickets',
      expectedCode: 'SOURCE_DRIFT',
      expectedCalls: 1,
      expectedAudits: 1
    }
  ] as const) {
    await t.test(scenario.name, async () => {
      const root = await mkdtemp(join(tmpdir(), `travel-harness-d5-rail-${scenario.name}-`))
      let kernel: Awaited<ReturnType<typeof createKernel>> | undefined
      let callCount = 0
      let closeCount = 0
      try {
        const createSession: NonNullable<ToolRegistryConfig['createSession']> = ({ sourceId }) => {
          assert.equal(sourceId, 'SRC_RAIL')
          return {
            async connect(timeoutMs): Promise<void> {
              assert.equal(timeoutMs, 60_000)
            },
            async listTools(
              timeoutMs
            ): Promise<Array<{ name: string; description: string; inputSchema: unknown }>> {
              assert.equal(timeoutMs, 15_000)
              return [
                {
                  name: scenario.toolName,
                  description: 'fixture tool',
                  inputSchema: { type: 'object' }
                }
              ]
            },
            async callTool(): Promise<unknown> {
              callCount += 1
              return { content: [{ type: 'text' }] }
            },
            async close(): Promise<void> {
              closeCount += 1
            }
          }
        }
        kernel = await createKernel(root, { createSession })
        const sessionId = `d5-rail-${scenario.name}`
        await assert.rejects(
          () =>
            kernel!.context.tools.discoverRailRoundTripOptions(
              {
                outbound: {
                  sessionId,
                  direction: 'OUTBOUND',
                  date: '2026-10-01',
                  fromStation: '上海',
                  toStation: '成都'
                },
                return: {
                  sessionId,
                  direction: 'RETURN',
                  date: '2026-10-04',
                  fromStation: '成都',
                  toStation: '上海'
                }
              },
              crypto.randomUUID()
            ),
          (error) => error instanceof AppError && error.code === scenario.expectedCode
        )
        assert.equal(callCount, scenario.expectedCalls)
        assert.equal(closeCount, 1)
        assert.equal(
          kernel.context.tools
            .listToolCalls(sessionId, 100)
            .filter((call) => call.sourceId === 'SRC_RAIL').length,
          scenario.expectedAudits
        )
        if (scenario.name === 'allowlist') {
          assert.equal(
            kernel.context.tools
              .listBlockedTools(100)
              .some((blocked) => blocked.toolName === 'createOrder'),
            true
          )
        }
      } finally {
        if (kernel) await stopKernel(kernel.context, kernel.database)
        await rm(root, { recursive: true, force: true })
      }
    })
  }
})

test('Rail normalization prefers the visible service code and keeps legacy fixtures compatible', () => {
  const request = {
    sessionId: 'rail-visible-code',
    candidateId: 'candidate-1',
    direction: 'OUTBOUND' as const,
    trainNo: 'G1974',
    date: '2026-10-01',
    fromStation: '上海虹桥',
    toStation: '成都东'
  }
  const live = normalizeRailJourney(
    RailTicketSchema.parse({
      train_no: '5l000G19740A',
      start_train_code: 'G1974',
      start_time: '11:00',
      arrive_time: '16:00'
    }),
    request
  )
  assert.equal(live.trainNo, 'G1974')
  assert.equal(live.title, '上海虹桥→成都东 G1974')
  assert.equal(live.label, 'G1974 铁路段')
  assert.equal(JSON.stringify(live).includes('5l000G19740A'), false)

  const legacy = normalizeRailJourney(
    RailTicketSchema.parse({
      train_no: 'G1974',
      start_time: '11:00',
      arrive_time: '16:00'
    }),
    request
  )
  assert.equal(legacy.trainNo, 'G1974')
  assert.throws(() =>
    RailTicketSchema.parse({
      train_no: '5l000G19740A',
      start_train_code: '   ',
      start_time: '11:00',
      arrive_time: '16:00'
    })
  )
})

test('ToolRegistry uses visible rail codes, reuses transient geocodes and keeps address plaintext out of audit and evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d5-materializers-'))
  let kernel: Awaited<ReturnType<typeof createKernel>> | undefined
  const calls: Array<{
    sourceId: string
    toolName: string
    args: Record<string, unknown>
  }> = []
  try {
    const createSession: NonNullable<ToolRegistryConfig['createSession']> = ({ sourceId }) => ({
      connect(): Promise<void> {
        return Promise.resolve()
      },
      async listTools(): Promise<
        Array<{ name: string; description: string; inputSchema: unknown }>
      > {
        const names =
          sourceId === 'SRC_RAIL'
            ? ['get-tickets']
            : sourceId === 'SRC_MAP'
              ? ['maps_geo', 'maps_distance']
              : []
        return names.map((name) => ({
          name,
          description: 'read-only fixture lookup',
          inputSchema: { type: 'object' }
        }))
      },
      async callTool(name, args): Promise<unknown> {
        calls.push({ sourceId, toolName: name, args })
        const payload =
          name === 'get-tickets'
            ? [
                {
                  train_no: '5l000G19740A',
                  start_train_code: 'G1974',
                  start_time: '11:00',
                  arrive_time: '16:00'
                },
                {
                  train_no: '5l000G19750A',
                  start_train_code: 'G1975',
                  start_time: '12:00',
                  arrive_time: '17:00'
                },
                {
                  train_no: '5l000G19740B',
                  start_train_code: 'G1974',
                  start_time: '11:00',
                  arrive_time: '16:00'
                }
              ]
            : name === 'maps_geo'
              ? { results: [{ location: '121.4737,31.2304' }] }
              : {
                  results: [{ origin_id: '1', dest_id: '2', distance: '12000', duration: '2400' }]
                }
        return { content: [{ type: 'text', text: JSON.stringify(payload) }] }
      },
      close(): Promise<void> {
        return Promise.resolve()
      }
    })
    kernel = await createKernel(root, {
      createSession,
      readCredential: async (id) => (id === 'AMAP' ? 'fixture-amap-key' : undefined),
      now: () => new Date('2026-08-29T00:00:00.000Z')
    })
    const sessionId = 'd5-materializers'
    await kernel.context.coordinator.record({
      sessionId,
      eventVersion: 2,
      type: 'session/created',
      payload: {
        title: 'D5 materializer fixture',
        linkedSessionGroup: null,
        splitIndex: null,
        basics: BASICS,
        handoffs: []
      }
    })

    const options = await kernel.context.tools.discoverRailOptions(
      {
        sessionId,
        direction: 'OUTBOUND',
        date: '2026-10-01',
        fromStation: '上海',
        toStation: '成都'
      },
      crypto.randomUUID()
    )
    assert.equal(options.length, 2)
    assert.deepEqual(
      options.map((option) => option.trainNo),
      ['G1974', 'G1975']
    )
    assert.equal(options[0]!.title.includes('5l000G19740A'), false)
    assert.equal(calls.filter((call) => call.toolName === 'get-tickets').length, 1)
    assert.equal(kernel.context.tools.listEvidence(sessionId, 200).length, 0)

    const directMaterialization = await kernel.context.tools.materializeRailJourney(
      {
        sessionId,
        candidateId: 'direct-materializer',
        direction: 'OUTBOUND',
        trainNo: 'G1974',
        date: '2026-10-01',
        fromStation: '上海',
        toStation: '成都'
      },
      crypto.randomUUID(),
      false
    )
    const directClaim = directMaterialization.claims[0]!
    const directValue = RailJourneyClaimValueSchema.parse(directClaim.value)
    assert.equal(directValue.trainNo, 'G1974')
    assert.equal(directClaim.subject.includes('5l000G19740A'), false)
    assert.equal(calls.filter((call) => call.toolName === 'get-tickets').length, 2)
    assert.equal(kernel.context.tools.listEvidence(sessionId, 200).length, 0)

    await kernel.context.tools.materializeSelectedRailOption({
      sessionId,
      candidateId: 'auto-materializer',
      option: options[0]!
    })
    assert.equal(calls.filter((call) => call.toolName === 'get-tickets').length, 2)
    const persistedRailClaims = kernel.context.tools
      .listEvidence(sessionId, 200)
      .filter((item) => item.predicate === 'railJourney')
    assert.equal(persistedRailClaims.length, 1)
    const persistedRailValue = RailJourneyClaimValueSchema.parse(persistedRailClaims[0]!.value)
    assert.equal(persistedRailValue.trainNo, 'G1974')
    assert.equal(persistedRailClaims[0]!.subject.includes('5l000G19740A'), false)

    const exactAddress = '上海市隐私测试路 456 号'
    const firstGeocode = await kernel.context.tools.materializeTransientMapGeocode(
      {
        sessionId,
        address: exactAddress,
        city: '上海',
        label: '出发地点'
      },
      crypto.randomUUID()
    )
    const cachedGeocode = await kernel.context.tools.materializeTransientMapGeocode(
      {
        sessionId,
        address: exactAddress,
        city: '上海',
        label: '出发地点'
      },
      crypto.randomUUID(),
      false
    )
    assert.equal(firstGeocode.fromCache, false)
    assert.equal(cachedGeocode.fromCache, true)
    assert.equal(calls.filter((call) => call.toolName === 'maps_geo').length, 1)

    const transfer = await kernel.context.tools.materializeTimedMapGroundTransfer(
      {
        sessionId,
        candidateId: 'auto-materializer',
        direction: 'OUTBOUND',
        kind: 'FIRST_MILE',
        from: '出发地点',
        to: '出发车站（上海）',
        origin: '121.4737,31.2304',
        destination: '121.3270,31.2005',
        travelMode: 'DRIVING',
        timingBasis: 'ARRIVE_BY_RAIL',
        railAnchorAt: '2026-10-01T11:00:00+08:00'
      },
      crypto.randomUUID()
    )
    const transferValue = transfer.claims[0]!.value as Record<string, unknown>
    assert.equal(transferValue.endAt, '2026-10-01T10:15:00.000+08:00')
    assert.equal(transferValue.startAt, '2026-10-01T09:35:00.000+08:00')
    assert.equal(calls.filter((call) => call.toolName === 'maps_distance').length, 1)

    const evidenceRows = kernel.database
      .prepare('SELECT * FROM evidence_claims WHERE session_id = ?')
      .all(sessionId)
    const auditRows = kernel.context.tools.listToolCalls(sessionId, 100)
    assert.equal(JSON.stringify(evidenceRows).includes(exactAddress), false)
    assert.equal(JSON.stringify(auditRows).includes(exactAddress), false)
    assert.equal(
      auditRows.every((row) => row.argsDigest.includes('values=')),
      true
    )
  } finally {
    if (kernel) await stopKernel(kernel.context, kernel.database)
    await rm(root, { recursive: true, force: true })
  }
})

test('D5 deterministic validators enforce 8 km clusters, sparse source disclosure and strict IPC payloads', () => {
  assert.equal(
    slotItemsWithinEightKm([
      { coordinates: { lng: 104.047, lat: 30.645 } },
      { coordinates: { lng: 104.06, lat: 30.65 } }
    ]),
    true
  )
  assert.equal(
    slotItemsWithinEightKm([
      { coordinates: { lng: 104.047, lat: 30.645 } },
      { coordinates: { lng: 104.2, lat: 30.75 } }
    ]),
    false
  )
  const segment = {
    segmentId: 'segment-sparse',
    areaHint: '成都',
    checkInDate: '2026-10-01',
    checkOutDate: '2026-10-04',
    nights: 3,
    nightDates: ['2026-10-01', '2026-10-02', '2026-10-03'],
    positionAssessment: { status: 'ESTIMATED' as const, summary: '本地夹具', claimIds: [] }
  }
  const sparse = buildStayCandidates(
    segment,
    fixtures('sparse-session').filter(
      (item) => item.predicate === 'lodgingCandidate' && item.sourceId !== 'SRC_HOTEL'
    )
  )
  assert.equal(sparse.sourceOutcomes.find((item) => item.sourceId === 'SRC_HOTEL')?.status, 'EMPTY')
  assert.equal(
    sparse.candidates.every((candidate) => candidate.claimId.length > 0),
    true
  )
  assert.equal(
    D5ProgressEventSchema.safeParse({
      operationId: crypto.randomUUID(),
      sessionId: 'd5',
      kind: 'COMPLETED',
      message: 'done',
      raw: 'forbidden'
    }).success,
    false
  )
  assert.equal(
    StayPasteRequestSchema.safeParse({
      sessionId: 'd5',
      name: '住宿',
      totalCostCents: 100,
      roomType: null,
      bedType: null,
      capacity: null,
      roomFitsParty: null,
      cancellationStatus: 'FREE_UNTIL',
      freeCancelUntil: null,
      positionAdvantage: '待核验'
    }).success,
    false
  )
  assert.equal(
    TransportPrepareRequestSchema.safeParse({
      sessionId: 'd5',
      operationId: crypto.randomUUID()
    }).success,
    true
  )
  assert.equal(
    TransportPrepareRequestSchema.safeParse({
      sessionId: 'd5',
      operationId: crypto.randomUUID(),
      sourceParameters: {
        ...SOURCE_PARAMETERS,
        sourceId: 'SRC_RAIL'
      }
    }).success,
    false
  )
  assert.equal(
    TransportPrepareRequestSchema.safeParse({
      sessionId: 'd5',
      operationId: crypto.randomUUID(),
      sourceParameters: {
        outbound: SOURCE_PARAMETERS.outbound,
        return: {
          rail: SOURCE_PARAMETERS.return.rail,
          firstMile: SOURCE_PARAMETERS.return.firstMile
        }
      }
    }).success,
    false
  )
  assert.equal(
    StayPrepareRequestSchema.safeParse({
      sessionId: 'd5',
      operationId: crypto.randomUUID(),
      sourceParameters: {
        place: '成都',
        checkInDate: '2026-10-01',
        stayNights: 3,
        adultCount: 2,
        size: 5,
        toolName: 'searchHotels'
      }
    }).success,
    false
  )
  assert.equal(
    RailDiscoveryRequestSchema.safeParse({
      sessionId: 'd5',
      operationId: crypto.randomUUID(),
      digest: `sha256:${'a'.repeat(64)}`,
      fromStation: 'renderer-forbidden'
    }).success,
    false
  )
  assert.equal(
    D5SourcePlanPreviewRequestSchema.safeParse({
      sessionId: 'd5',
      discoveryId: crypto.randomUUID(),
      exactAddress: '上海市测试路 123 号',
      originLabel: '出发地点'
    }).success,
    true
  )
  assert.equal(
    D5SourcePlanExecuteRequestSchema.safeParse({
      sessionId: 'd5',
      operationId: crypto.randomUUID(),
      planId: crypto.randomUUID(),
      digest: `sha256:${'b'.repeat(64)}`,
      exactAddress: 'renderer-forbidden',
      toolName: 'maps_geo'
    }).success,
    false
  )
})

function assertProcessStopped(pid: number): void {
  assert.throws(
    () => process.kill(pid, 0),
    (error) => error instanceof Error && 'code' in error && error.code === 'ESRCH'
  )
}
