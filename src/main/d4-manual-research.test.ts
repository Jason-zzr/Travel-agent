import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import type { Context } from 'cordis'
import { AppError } from '../shared/errors'
import {
  ManualResearchChecklistRequestSchema,
  type ManualResearchChecklistRequest
} from '../shared/schema/d4'
import type { EvidenceClaim } from '../shared/schema/evidence'
import {
  SessionEventSchema,
  type SessionEvent,
  type SessionEventDraft
} from '../shared/schema/session-event'
import { TravelStateSchema, type TravelState } from '../shared/schema/travel-state'
import { applyMigrations } from './db/migrate'
import { materializeManualResearch } from './manual-research'
import { CoordinatorService } from './plugins/coordinator'
import { reduceTravelState } from './plugins/travel-state'

const DAY_MS = 24 * 60 * 60 * 1000

test('manual research schema rejects unsafe, unconfirmed, duplicate, and all-excluded input', () => {
  const checkedAt = new Date().toISOString()
  const valid = manualRequest('manual-session', checkedAt)
  assert.equal(ManualResearchChecklistRequestSchema.parse(valid).items.length, 1)

  assert.equal(
    ManualResearchChecklistRequestSchema.safeParse({
      ...valid,
      items: [{ ...valid.items[0]!, sourceUrl: 'http://example.com/item' }]
    }).success,
    false
  )
  assert.equal(
    ManualResearchChecklistRequestSchema.safeParse({
      ...valid,
      items: [{ ...valid.items[0]!, sourceUrl: 'https://user:pass@example.com/item' }]
    }).success,
    false
  )
  assert.equal(
    ManualResearchChecklistRequestSchema.safeParse({
      ...valid,
      items: [{ ...valid.items[0]!, sourceUrl: 'https://example.com/item?token=secret' }]
    }).success,
    false
  )
  assert.equal(
    ManualResearchChecklistRequestSchema.safeParse({
      ...valid,
      items: [{ ...valid.items[0]!, confirmed: false }]
    }).success,
    false
  )
  assert.equal(
    ManualResearchChecklistRequestSchema.safeParse({
      ...valid,
      items: [{ ...valid.items[0]!, sourceLabel: '' }]
    }).success,
    false
  )
  assert.equal(
    ManualResearchChecklistRequestSchema.safeParse({
      ...valid,
      items: [{ ...valid.items[0]!, disposition: 'EXCLUDE' }]
    }).success,
    false
  )
  assert.equal(
    ManualResearchChecklistRequestSchema.safeParse({
      ...valid,
      items: [valid.items[0]!, { ...valid.items[0]!, itemId: crypto.randomUUID() }]
    }).success,
    false
  )
  assert.equal(
    ManualResearchChecklistRequestSchema.safeParse({
      ...valid,
      unexpected: true
    }).success,
    false
  )
})

test('manual materialization creates deterministic redacted USER_RESEARCH claims and stale anchors', () => {
  const confirmedAt = new Date('2026-08-30T04:00:00.000Z')
  const request = manualRequest(
    'manual-session',
    new Date(confirmedAt.getTime() - 2 * DAY_MS).toISOString(),
    'paste-claim'
  )
  const first = materializeManualResearch(request, '成都', confirmedAt)
  const second = materializeManualResearch(request, '成都', confirmedAt)

  assert.deepEqual(first, second)
  assert.equal(first.entities.length, 1)
  assert.equal(first.claims.length, 5)
  assert.equal(first.entities[0]?.verificationStatus, 'VERIFIED_BY_USER')
  assert.equal(first.summary.itemCount, 1)
  assert.equal(first.summary.linkedPasteCount, 1)
  assert.ok(first.claims.every((claim) => claim.sourceId === 'USER_RESEARCH'))
  assert.ok(first.claims.every((claim) => claim.sourceRef.startsWith('USER_RESEARCH:')))
  assert.ok(first.claims.every((claim) => !claim.sourceRef.includes('官方公众号')))
  assert.ok(first.claims.every((claim) => !claim.sourceRef.includes('https://example.com')))
  assert.ok(first.claims.every((claim) => !claim.sourceRef.includes('适合家庭参观')))
  assert.equal(
    first.claims.filter((claim) => /opening|closure|reservation/i.test(claim.predicate)).length,
    3
  )
  assert.ok(
    first.claims
      .filter((claim) => /opening|closure|reservation/i.test(claim.predicate))
      .every((claim) => claim.verificationStatus === 'STALE')
  )
})

test('coordinator writes one atomic manual checklist event and keeps USER_PASTE isolated', async () => {
  const checkedAt = new Date().toISOString()
  const paste = userPasteClaim('manual-session', 'paste-claim')
  const harness = coordinatorHarness([paste])
  const snapshot = await harness.coordinator.prepareManualResearch(
    manualRequest('manual-session', checkedAt, paste.claimId)
  )

  assert.equal(harness.events.length, 1)
  assert.equal(harness.events[0]?.type, 'research/checklist-prepared')
  assert.equal(snapshot.manualResearchSummary?.itemCount, 1)
  assert.equal(snapshot.researchEntities[0]?.verificationStatus, 'VERIFIED_BY_USER')
  assert.equal(paste.verificationStatus, 'UNVERIFIED')
  assert.equal(paste.sourceId, 'USER_PASTE')
  assert.equal(harness.counts.externalCalls, 0)
  assert.equal(harness.counts.modelCalls, 0)
  assert.equal(harness.counts.irreversibleActions, 0)
  assert.equal(harness.claims.filter((claim) => claim.sourceId === 'USER_RESEARCH').length, 5)

  const replayed = reduceTravelState(harness.baseState, harness.events[0]!)
  assert.deepEqual(replayed.researchEntities, harness.state().researchEntities)
  assert.deepEqual(replayed.manualResearchSummary, harness.state().manualResearchSummary)

  await harness.coordinator.prepareManualResearch(manualRequest('manual-session', checkedAt))
  assert.equal(
    harness.events.filter((event) => event.type === 'research/checklist-prepared').length,
    2
  )
  assert.equal(harness.claims.filter((claim) => claim.sourceId === 'USER_RESEARCH').length, 10)
  await harness.coordinator.confirmResearch({ sessionId: 'manual-session' })
  assert.equal(harness.state().stage, 'STAGE_4')
  const eventCount = harness.events.length
  const claimCount = harness.claims.length
  await assert.rejects(
    harness.coordinator.prepareManualResearch(manualRequest('manual-session', checkedAt)),
    (error: unknown) => error instanceof AppError && error.code === 'GATE_BLOCKED'
  )
  assert.equal(harness.events.length, eventCount)
  assert.equal(harness.claims.length, claimCount)
})

test('manual checklist invalid linkage is zero-write and known hard anchor alone unlocks confirm gate', async () => {
  const checkedAt = new Date().toISOString()
  const harness = coordinatorHarness([])
  await assert.rejects(
    harness.coordinator.prepareManualResearch(
      manualRequest('manual-session', checkedAt, 'missing-paste-claim')
    ),
    (error: unknown) => error instanceof AppError && error.code === 'INPUT_INVALID'
  )
  assert.equal(harness.events.length, 0)
  assert.equal(harness.claims.length, 0)

  const request = manualRequest('manual-session', checkedAt)
  request.items[0]!.hardAnchors[1]!.status = 'UNKNOWN'
  request.items[0]!.hardAnchors[1]!.value = null
  request.items[0]!.hardAnchors[2]!.status = 'NOT_APPLICABLE'
  request.items[0]!.hardAnchors[2]!.value = null
  await harness.coordinator.prepareManualResearch(request)
  const confirmed = await harness.coordinator.confirmResearch({ sessionId: 'manual-session' })
  assert.equal(confirmed.stage, 'STAGE_4')
})

test('manual checklist with no known hard anchor remains blocked in STAGE-3', async () => {
  const checkedAt = new Date().toISOString()
  const harness = coordinatorHarness([])
  const request = manualRequest('manual-session', checkedAt)
  for (const anchor of request.items[0]!.hardAnchors) {
    anchor.status = 'UNKNOWN'
    anchor.value = null
  }
  await harness.coordinator.prepareManualResearch(request)
  await assert.rejects(
    harness.coordinator.confirmResearch({ sessionId: 'manual-session' }),
    (error: unknown) => error instanceof AppError && error.code === 'GATE_BLOCKED'
  )
  assert.equal(harness.state().stage, 'STAGE_3')
})

test('migration 6 preserves old evidence and admits only the new USER_RESEARCH source', async () => {
  const database = new Database(':memory:')
  try {
    database.pragma('foreign_keys = ON')
    const migrationDirectory = join(process.cwd(), 'src', 'main', 'db', 'migrations')
    const migrations = await Promise.all(
      [
        '0001_init.sql',
        '0002_model_call_cost.sql',
        '0003_xiaohongshu_source.sql',
        '0004_d5_transport_candidates.sql',
        '0005_d7_task_links.sql',
        '0006_user_research_source.sql'
      ].map(async (file, index) => ({
        version: index + 1,
        sql: await readFile(join(migrationDirectory, file), 'utf8')
      }))
    )
    assert.deepEqual(applyMigrations(database, migrations.slice(0, 5)).applied, [1, 2, 3, 4, 5])
    database
      .prepare(
        "INSERT INTO sessions(session_id, created_at, stage, last_seq, title) VALUES (?, ?, 'STAGE_3', 0, NULL)"
      )
      .run('migration-session', new Date().toISOString())
    insertEvidence(database, 'old-claim', 'USER_PASTE')

    assert.deepEqual(applyMigrations(database, [migrations[5]!]).applied, [6])
    insertEvidence(database, 'manual-claim', 'USER_RESEARCH')
    assert.deepEqual(
      database.prepare('SELECT claim_id, source_id FROM evidence_claims ORDER BY claim_id').all(),
      [
        { claim_id: 'manual-claim', source_id: 'USER_RESEARCH' },
        { claim_id: 'old-claim', source_id: 'USER_PASTE' }
      ]
    )
    assert.throws(() => insertEvidence(database, 'bad-claim', 'NOT_A_SOURCE'))
    assert.deepEqual(applyMigrations(database, [migrations[5]!]).applied, [])
    const indexNames = new Set(
      (database.pragma("index_list('evidence_claims')") as Array<{ name: string }>).map(
        (row) => row.name
      )
    )
    assert.ok(indexNames.has('idx_claims_session'))
    assert.ok(indexNames.has('idx_claims_subject'))
    assert.ok(indexNames.has('idx_claims_expiry'))
  } finally {
    database.close()
  }
})

function manualRequest(
  sessionId: string,
  checkedAt: string,
  sourceClaimId: string | null = null
): ManualResearchChecklistRequest {
  return ManualResearchChecklistRequestSchema.parse({
    sessionId,
    items: [
      {
        itemId: crypto.randomUUID(),
        subject: '武侯祠',
        kind: 'ATTRACTION',
        aliases: ['成都武侯祠博物馆'],
        disposition: 'MUST_GO',
        sourceLabel: '官方公众号',
        sourceUrl: 'https://example.com/official-notice',
        sourceClaimId,
        contentIdentity: 'OFFICIAL',
        summary: '适合家庭参观，现场有休息点。',
        fitness: { status: 'FIT', reasons: ['有休息点'] },
        hardAnchors: [
          {
            kind: 'OPENING_HOURS',
            status: 'KNOWN',
            value: '09:00-18:00',
            checkedAt,
            confirmed: true
          },
          {
            kind: 'CLOSURE_SCHEDULE',
            status: 'KNOWN',
            value: '周一不闭馆',
            checkedAt,
            confirmed: true
          },
          {
            kind: 'RESERVATION_REQUIREMENT',
            status: 'KNOWN',
            value: '需实名预约',
            checkedAt,
            confirmed: true
          }
        ],
        confirmed: true
      }
    ]
  })
}

function coordinatorHarness(initialClaims: EvidenceClaim[]): {
  coordinator: CoordinatorService
  events: SessionEvent[]
  claims: EvidenceClaim[]
  baseState: TravelState
  state(): TravelState
  counts: { externalCalls: number; modelCalls: number; irreversibleActions: number }
} {
  const baseState = TravelStateSchema.parse({
    sessionId: 'manual-session',
    createdAt: '2026-08-30T00:00:00.000Z',
    stage: 'STAGE_3',
    lastSeq: 3,
    title: '人工研究测试',
    basics: {
      originCities: ['上海'],
      destinationCities: ['成都'],
      destinationIntent: null,
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
      dates: { kind: 'FIXED', startDate: '2026-10-01', endDate: '2026-10-04' },
      budget: {
        currency: 'CNY',
        basis: 'TOTAL',
        targetMinor: 500000,
        flexibleRangeMinor: null,
        hardCapMinor: null,
        inclusions: ['TRANSPORT', 'ACCOMMODATION']
      },
      intensity: 'RELAXED',
      preferences: { hardConstraints: [], softPreferences: [], negotiableVariables: [] },
      staySegments: 1
    }
  })
  let state = baseState
  const events: SessionEvent[] = []
  const claims = [...initialClaims]
  const counts = { externalCalls: 0, modelCalls: 0, irreversibleActions: 0 }
  const context = {
    provider: new Proxy(
      {},
      {
        get() {
          counts.modelCalls += 1
          throw new Error('manual path attempted to use provider')
        }
      }
    ),
    tools: {
      listEvidence: (sessionId: string) => claims.filter((claim) => claim.sessionId === sessionId)
    },
    travelState: {
      get: (sessionId: string) => (state.sessionId === sessionId ? state : undefined),
      record: async (draft: SessionEventDraft) => {
        const event = SessionEventSchema.parse({
          ...draft,
          eventId: `event-${state.lastSeq + 1}`,
          seq: state.lastSeq + 1,
          timestamp: new Date().toISOString()
        })
        state = reduceTravelState(state, event)
        if (event.type === 'research/checklist-prepared') {
          for (const claim of event.payload.finalClaims ?? []) {
            const index = claims.findIndex((candidate) => candidate.claimId === claim.claimId)
            if (index >= 0) claims[index] = claim
            else claims.push(claim)
          }
        }
        events.push(event)
        return event
      }
    }
  } as unknown as Context
  return {
    coordinator: new CoordinatorService(context),
    events,
    claims,
    baseState,
    state: () => state,
    counts
  }
}

function userPasteClaim(sessionId: string, claimId: string): EvidenceClaim {
  const now = new Date().toISOString()
  return {
    claimId,
    sessionId,
    subject: '成都',
    predicate: 'userPasteClue',
    value: { text: '原始线索', sourceUrl: null },
    sourceId: 'USER_PASTE',
    sourceRef: 'USER_PASTE:local-digest',
    contentIdentity: 'UNKNOWN',
    verificationStatus: 'UNVERIFIED',
    observedAt: now,
    validUntil: new Date(Date.now() + 7 * DAY_MS).toISOString(),
    confidence: null,
    conflictsWith: [],
    notes: '用户提供的未核验线索。'
  }
}

function insertEvidence(database: Database.Database, claimId: string, sourceId: string): void {
  database
    .prepare(
      `INSERT INTO evidence_claims(
         claim_id, session_id, subject, predicate, value_json, source_id, source_ref,
         content_identity, verification_status, observed_at, valid_until, confidence,
         conflicts_with, notes
       ) VALUES (?, 'migration-session', 'subject', 'predicate', '"value"', ?, ?, 'UNKNOWN',
         'UNVERIFIED', '2026-08-30T00:00:00.000Z', '2026-09-01T00:00:00.000Z', NULL, '[]', NULL)`
    )
    .run(claimId, sourceId, `${sourceId}:ref`)
}
