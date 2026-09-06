import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { Context } from 'cordis'
import {
  PreparationTaskSchema,
  TaskUpdatedPayloadSchema,
  TaskUpdatedPayloadWriteSchema
} from '../shared/schema/d7'
import { TimelineVersionSchema, type TimelineVersion } from '../shared/schema/d6'
import { EvidenceClaimSchema, type EvidenceClaim } from '../shared/schema/evidence'
import type { SessionEventDraft } from '../shared/schema/session-event'
import { applyMigrations } from './db/migrate'
import { assertNoSecrets, prepareItineraryExport } from './export/d7-export'
import { createAppPaths, type AppPaths } from './paths'
import { eventLogPlugin } from './plugins/event-log'
import { travelStatePlugin } from './plugins/travel-state'
import { buildGateC } from './skills/d7-gate'
import { applyTaskUpdate } from './skills/d7-task-update'
import { derivePreparationTasks } from './skills/s11-task-derivation'

const SESSION_ID = 'd7-session'
const NOW = '2026-09-01T00:00:00.000Z'

test('D7 task schema freezes four M1 axes and strict write payload while replay permits additions', () => {
  const task = derivePreparationTasks({
    sessionId: SESSION_ID,
    timeline: fixtureTimeline(),
    claims: fixtureClaims(),
    now: NOW
  })[0]!
  assert.equal(PreparationTaskSchema.safeParse({ ...task, payment: 'PAID' }).success, false)
  const payload = {
    tasks: [task],
    updatedTaskId: null,
    reason: 'DERIVED',
    replacementTimeline: null,
    decision: null
  }
  assert.equal(TaskUpdatedPayloadWriteSchema.safeParse({ ...payload, future: true }).success, false)
  assert.equal(TaskUpdatedPayloadSchema.safeParse({ ...payload, future: true }).success, true)
})

test('SKILL-11 derives one evidence-backed reservation handoff with no external work', () => {
  const tasks = derivePreparationTasks({
    sessionId: SESSION_ID,
    timeline: fixtureTimeline(),
    claims: fixtureClaims(),
    now: NOW
  })
  assert.equal(tasks.length, 1)
  assert.equal(tasks[0]?.kind, 'RESERVATION_TICKET')
  assert.equal(tasks[0]?.dueAt, '2026-09-08T08:00:00.000Z')
  assert.equal(tasks[0]?.handover.channelUrl, 'https://official.example/reserve')
  assert.equal(tasks[0]?.handover.evidenceStatus, 'VERIFIED')
  assert.equal(tasks[0]?.readiness, 'UNKNOWN')
  assert.equal(
    derivePreparationTasks({
      sessionId: SESSION_ID,
      timeline: fixtureTimeline(),
      claims: fixtureClaims(),
      now: NOW
    })[0]?.taskId,
    tasks[0]?.taskId
  )
})

test('SKILL-11 keeps missing official handover blocked instead of inventing a URL', () => {
  const claim = evidenceClaim({
    contentIdentity: 'INDEPENDENT_UGC',
    sourceRef: 'https://ugc.example/post',
    value: { reservationRequired: true }
  })
  const timeline = fixtureTimeline([claim.claimId])
  const task = derivePreparationTasks({
    sessionId: SESSION_ID,
    timeline,
    claims: [claim],
    now: NOW
  })[0]
  assert.equal(task?.handover.channelUrl, null)
  assert.equal(task?.handover.deadlineSource, 'ESTIMATED')
  assert.equal(task?.handover.evidenceStatus, 'INCOMPLETE')
  assert.equal(task?.readiness, 'BLOCKED')
})

test('confirming a reservation creates vN+1, remaps all task links, and preserves itemClass', () => {
  const timeline = fixtureTimeline()
  const tasks = derivePreparationTasks({
    sessionId: SESSION_ID,
    timeline,
    claims: fixtureClaims(),
    now: NOW
  })
  const payload = applyTaskUpdate({
    tasks,
    currentTimeline: timeline,
    taskId: tasks[0]!.taskId,
    expectedUpdatedAt: tasks[0]!.updatedAt,
    action: 'CONFIRM_EXTERNAL_RESULT',
    now: '2026-09-02T00:00:00.000Z'
  })
  assert.equal(payload.replacementTimeline?.version, 2)
  assert.equal(payload.tasks[0]?.sourceTimelineVersion, 2)
  assert.notEqual(payload.tasks[0]?.itemId, tasks[0]?.itemId)
  const confirmed = payload.replacementTimeline?.items.find(
    (item) => item.itemId === payload.tasks[0]?.itemId
  )
  assert.equal(confirmed?.anchorClass, 'CONFIRMED_EXTERNAL')
  assert.equal(confirmed?.itemClass, 'FIXED')
  assert.equal(payload.tasks[0]?.reservation, 'DONE')
  assert.ok((payload.decision?.alternatives.length ?? 0) > 0)
})

test('GATE_C names pending high task and stale hard anchor and never reports ready', () => {
  const stale = evidenceClaim({
    verificationStatus: 'STALE',
    observedAt: '2026-08-30T00:00:00.000Z',
    validUntil: '2026-08-31T00:00:00.000Z'
  })
  const timeline = fixtureTimeline([stale.claimId])
  const tasks = derivePreparationTasks({
    sessionId: SESSION_ID,
    timeline,
    claims: [stale],
    now: NOW
  })
  const report = buildGateC({ timeline, tasks, claims: [stale], now: NOW })
  assert.equal(report.ready, false)
  assert.ok(report.blockers.some((blocker) => blocker.code === 'HIGH_PRIORITY_TASK_PENDING'))
  assert.ok(report.blockers.some((blocker) => blocker.code === 'HARD_ANCHOR_STALE'))
  assert.ok(report.blockers.every((blocker) => blocker.message.length > 0))
})

test('GATE_C reports ready only with completed tasks and current weather/closure evidence', () => {
  const timeline = fixtureTimeline()
  const claims = fixtureClaims()
  const tasks = derivePreparationTasks({ sessionId: SESSION_ID, timeline, claims, now: NOW }).map(
    (task) => ({
      ...task,
      userDecision: 'ACCEPTED' as const,
      reservation: 'DONE' as const,
      readiness: 'READY' as const
    })
  )
  const report = buildGateC({ timeline, tasks, claims, now: NOW })
  assert.equal(report.ready, true)
  assert.deepEqual(report.blockers, [])
})

test('ICS export preserves cross-midnight UTC instants and represents zero-duration BACKUP items', () => {
  const base = fixtureTimeline()
  const timeline = TimelineVersionSchema.parse({
    ...base,
    items: [
      ...base.items,
      {
        itemId: 'item-night-train',
        date: '2026-09-10',
        startTime: '23:30',
        endTime: '01:00',
        crossesMidnight: true,
        title: '夜间列车',
        itemClass: 'FIXED',
        anchorClass: 'CONFIRMED_EXTERNAL',
        location: { name: '车站', kind: 'STATION', address: null, coordinates: null },
        arrivalTransport: null,
        bufferMinutes: 0,
        costCents: null,
        claimIds: ['claim-reservation'],
        verificationSummary: {
          status: 'VERIFIED',
          claimCount: 1,
          allClaimsUsable: true
        }
      }
    ]
  })
  const prepared = prepareItineraryExport(
    { sessionId: SESSION_ID, timeline, tasks: [], gate: null },
    'ICS'
  )
  assert.match(prepared.content, /DTSTART:20260910T153000Z/)
  assert.match(prepared.content, /DTEND:20260910T170000Z/)
  assert.match(prepared.content, /雨天备用/)
  const backupEvent = prepared.content.match(
    /BEGIN:VEVENT\r\nUID:item-backup@travel-harness\.local\r\n[\s\S]*?END:VEVENT/
  )?.[0]
  assert.match(backupEvent ?? '', /DTSTART:20260910T100000Z/)
  assert.doesNotMatch(backupEvent ?? '', /DTEND:/)
  assert.equal(prepared.content.endsWith('\r\n'), true)
})

test('export secret scanner fails closed before a credential sentinel can be written', () => {
  assert.throws(
    () => assertNoSecrets('OPENAI_API_KEY=sk-1234567890abcdefghijklmnop'),
    /凭据安全检查/
  )
})

test('D7 task, replacement timeline, gate and DecisionLog rebuild atomically from JSONL', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d7-'))
  let harness = await createD7StateHarness(root)
  try {
    for (const draft of stage5Drafts()) await harness.context.travelState.record(draft)
    const timeline = fixtureTimeline()
    await harness.context.travelState.record({
      sessionId: SESSION_ID,
      eventVersion: 2,
      type: 'timeline/published',
      payload: {
        timeline,
        sourceOutcomes: [],
        verification: { hardAnchorCount: 1, verifiedHardAnchorCount: 1, orphanFactCount: 0 },
        changedDates: ['2026-09-10']
      }
    })
    const tasks = derivePreparationTasks({
      sessionId: SESSION_ID,
      timeline,
      claims: fixtureClaims(),
      now: NOW
    })
    await harness.context.travelState.record({
      sessionId: SESSION_ID,
      eventVersion: 2,
      type: 'task/updated',
      payload: {
        tasks,
        updatedTaskId: null,
        reason: 'DERIVED',
        replacementTimeline: null,
        decision: null
      }
    })
    const update = applyTaskUpdate({
      tasks,
      currentTimeline: timeline,
      taskId: tasks[0]!.taskId,
      expectedUpdatedAt: tasks[0]!.updatedAt,
      action: 'CONFIRM_EXTERNAL_RESULT',
      now: '2026-09-02T00:00:00.000Z'
    })
    await harness.context.travelState.record({
      sessionId: SESSION_ID,
      eventVersion: 2,
      type: 'task/updated',
      payload: update
    })
    const report = buildGateC({
      timeline: update.replacementTimeline!,
      tasks: update.tasks,
      claims: fixtureClaims(),
      now: '2026-09-02T00:00:00.000Z'
    })
    await harness.context.travelState.record({
      sessionId: SESSION_ID,
      eventVersion: 2,
      type: 'gate/result',
      payload: { report }
    })

    assert.equal(harness.context.travelState.get(SESSION_ID)?.timelineVersions.length, 2)
    assert.equal(harness.context.travelState.get(SESSION_ID)?.tasks[0]?.reservation, 'DONE')
    assert.equal(harness.context.travelState.get(SESSION_ID)?.latestGateC?.ready, true)
    assert.deepEqual(
      harness.database
        .prepare('SELECT timeline_version, reservation FROM tasks WHERE session_id = ?')
        .get(SESSION_ID),
      { timeline_version: 2, reservation: 'DONE' }
    )
    assert.equal(
      (
        harness.database
          .prepare('SELECT COUNT(*) AS count FROM decision_logs WHERE session_id = ?')
          .get(SESSION_ID) as { count: number }
      ).count,
      2
    )
    assert.equal(
      (
        harness.database.prepare('SELECT COUNT(*) AS count FROM tool_calls').get() as {
          count: number
        }
      ).count,
      0
    )
    assert.equal(
      (
        harness.database.prepare('SELECT COUNT(*) AS count FROM model_calls').get() as {
          count: number
        }
      ).count,
      0
    )

    await harness.stop()
    await rm(harness.paths.database, { force: true })
    harness = await createD7StateHarness(root)
    const rebuilt = harness.context.travelState.get(SESSION_ID)
    assert.equal(rebuilt?.timelineVersions.length, 2)
    assert.equal(rebuilt?.tasks[0]?.sourceTimelineVersion, 2)
    assert.equal(rebuilt?.latestGateC?.ready, true)
  } finally {
    await harness.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('unified route scope projects to timeline and task read models', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d7-route-'))
  const harness = await createD7StateHarness(root)
  try {
    for (const draft of stage5Drafts()) await harness.context.travelState.record(draft)
    const routeContext = {
      routeId: 'route-yunnan',
      dayType: 'INTERCITY_TRANSFER_DAY' as const,
      role: 'INTERCITY_LEG' as const,
      nodeId: 'node-dali',
      segmentId: null,
      routeLegId: 'leg-gz-dali',
      fromNodeId: null,
      toNodeId: 'node-dali'
    }
    const base = fixtureTimeline()
    const timeline = TimelineVersionSchema.parse({
      ...base,
      routeId: routeContext.routeId,
      items: base.items.map((item, index) =>
        index === 0
          ? { ...item, title: '广州→大理', routeContext }
          : {
              ...item,
              routeContext: {
                ...routeContext,
                role: 'BACKUP',
                routeLegId: null,
                fromNodeId: null,
                toNodeId: null
              }
            }
      )
    })
    await harness.context.travelState.record({
      sessionId: SESSION_ID,
      eventVersion: 2,
      type: 'timeline/published',
      payload: {
        timeline,
        sourceOutcomes: [],
        verification: { hardAnchorCount: 1, verifiedHardAnchorCount: 1, orphanFactCount: 0 },
        changedDates: ['2026-09-10']
      }
    })
    const tasks = derivePreparationTasks({
      sessionId: SESSION_ID,
      timeline,
      claims: fixtureClaims(),
      now: NOW
    })
    await harness.context.travelState.record({
      sessionId: SESSION_ID,
      eventVersion: 2,
      type: 'task/updated',
      payload: {
        tasks,
        updatedTaskId: null,
        reason: 'DERIVED',
        replacementTimeline: null,
        decision: null
      }
    })
    assert.deepEqual(
      harness.database
        .prepare(
          'SELECT route_id, node_id, segment_id, route_leg_id FROM timeline_items WHERE item_id = ?'
        )
        .get('item-attraction'),
      {
        route_id: 'route-yunnan',
        node_id: 'node-dali',
        segment_id: null,
        route_leg_id: 'leg-gz-dali'
      }
    )
    const projectedTask = harness.database
      .prepare(
        'SELECT route_id, node_id, segment_id, route_leg_id, route_context_json FROM tasks WHERE task_id = ?'
      )
      .get(tasks[0]!.taskId) as {
      route_id: string
      node_id: string
      segment_id: string | null
      route_leg_id: string
      route_context_json: string
    }
    assert.deepEqual(
      {
        route_id: projectedTask.route_id,
        node_id: projectedTask.node_id,
        segment_id: projectedTask.segment_id,
        route_leg_id: projectedTask.route_leg_id
      },
      {
        route_id: 'route-yunnan',
        node_id: 'node-dali',
        segment_id: null,
        route_leg_id: 'leg-gz-dali'
      }
    )
    assert.deepEqual(JSON.parse(projectedTask.route_context_json), routeContext)
  } finally {
    await harness.stop()
    await rm(root, { recursive: true, force: true })
  }
})

function fixtureTimeline(claimIds: string[] = ['claim-reservation']): TimelineVersion {
  return TimelineVersionSchema.parse({
    version: 1,
    createdAt: NOW,
    summary: 'D7 fixture timeline',
    isCurrent: true,
    items: [
      {
        itemId: 'item-attraction',
        date: '2026-09-10',
        startTime: '10:00',
        endTime: '12:00',
        crossesMidnight: false,
        title: '预约景点',
        itemClass: 'FIXED',
        anchorClass: 'HARD_LOCKED',
        location: {
          name: '预约景点',
          kind: 'POI',
          address: null,
          coordinates: null
        },
        arrivalTransport: null,
        bufferMinutes: 0,
        costCents: null,
        claimIds,
        verificationSummary: {
          status: claimIds.length ? 'VERIFIED' : 'UNVERIFIED',
          claimCount: claimIds.length,
          allClaimsUsable: claimIds.length > 0
        }
      },
      {
        itemId: 'item-backup',
        date: '2026-09-10',
        startTime: '18:00',
        endTime: '18:00',
        crossesMidnight: false,
        title: '雨天备用',
        itemClass: 'BACKUP',
        anchorClass: 'FLEXIBLE',
        location: { name: '室内', kind: 'POI', address: null, coordinates: null },
        arrivalTransport: null,
        bufferMinutes: 0,
        costCents: null,
        claimIds: [],
        verificationSummary: {
          status: 'ESTIMATED',
          claimCount: 0,
          allClaimsUsable: true
        }
      }
    ],
    decision: {
      decisionId: 'decision-v1',
      category: 'TIMELINE_PUBLISH',
      selected: 'timeline-v1',
      reason: 'fixture',
      alternatives: [],
      claimIds
    }
  })
}

function fixtureClaims(): EvidenceClaim[] {
  return [
    evidenceClaim(),
    evidenceClaim({
      claimId: 'claim-weather',
      predicate: 'weatherForecast',
      value: { status: 'clear' }
    }),
    evidenceClaim({
      claimId: 'claim-closure',
      predicate: 'closureNotice',
      value: { status: 'open' }
    })
  ]
}

function evidenceClaim(overrides: Partial<EvidenceClaim> = {}): EvidenceClaim {
  return EvidenceClaimSchema.parse({
    claimId: 'claim-reservation',
    sessionId: SESSION_ID,
    subject: '预约景点',
    predicate: 'reservationRequirement',
    value: {
      reservationRequired: true,
      officialChannelLabel: '景点官方预约页',
      officialChannelUrl: 'https://official.example/reserve',
      deadline: '2026-09-08T08:00:00.000Z'
    },
    sourceId: 'SRC_SEARCH',
    sourceRef: 'https://official.example/reserve',
    contentIdentity: 'OFFICIAL',
    verificationStatus: 'VERIFIED',
    observedAt: NOW,
    validUntil: '2026-09-09T00:00:00.000Z',
    confidence: 1,
    conflictsWith: [],
    notes: null,
    ...overrides
  })
}

function stage5Drafts(): SessionEventDraft[] {
  return [
    {
      sessionId: SESSION_ID,
      eventVersion: 2 as const,
      type: 'session/created' as const,
      payload: {
        title: 'D7 integration',
        linkedSessionGroup: null,
        splitIndex: null,
        basics: null,
        handoffs: []
      }
    },
    ...(
      [
        ['STAGE_1', 'STAGE_2'],
        ['STAGE_2', 'STAGE_3'],
        ['STAGE_3', 'STAGE_4'],
        ['STAGE_4', 'STAGE_5']
      ] as const
    ).map(([fromStage, toStage]) => ({
      sessionId: SESSION_ID,
      eventVersion: 2 as const,
      type: 'stage/confirmed' as const,
      payload: { fromStage, toStage, confirmed: true as const }
    }))
  ]
}

async function createD7StateHarness(root: string): Promise<{
  context: Context
  database: Database.Database
  paths: AppPaths
  stop(): Promise<void>
}> {
  const paths = createAppPaths(root)
  const database = new Database(paths.database)
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
    await Promise.all(
      names.map(async (name, index) => ({
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
      await context.eventLog.close()
      database.close()
      await context.stop()
    }
  }
}
