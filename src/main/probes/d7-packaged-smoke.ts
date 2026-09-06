import type { Context } from 'cordis'
import { EvidenceClaimSchema, type EvidenceClaim } from '../../shared/schema/evidence'

export const D7_PACKAGED_SMOKE_SESSION_ID = 'd7-packaged-smoke'

export async function seedD7PackagedSmoke(ctx: Context): Promise<{
  currentVersion: number
  taskCount: number
  gateReady: boolean
  externalCalls: 0
  modelCalls: 0
  irreversibleActions: 0
}> {
  if (ctx.travelState.get(D7_PACKAGED_SMOKE_SESSION_ID)) {
    return summarize(ctx)
  }
  await ctx.coordinator.record({
    sessionId: D7_PACKAGED_SMOKE_SESSION_ID,
    eventVersion: 2,
    type: 'session/created',
    payload: {
      title: 'Packaged D7 LOCAL smoke',
      linkedSessionGroup: null,
      splitIndex: null,
      basics: null,
      handoffs: []
    }
  })
  for (const [fromStage, toStage] of [
    ['STAGE_1', 'STAGE_2'],
    ['STAGE_2', 'STAGE_3'],
    ['STAGE_3', 'STAGE_4'],
    ['STAGE_4', 'STAGE_5']
  ] as const) {
    await ctx.coordinator.record({
      sessionId: D7_PACKAGED_SMOKE_SESSION_ID,
      eventVersion: 2,
      type: 'stage/confirmed',
      payload: { fromStage, toStage, confirmed: true }
    })
  }
  await ctx.tools.addEvidenceClaims([
    packagedClaim('reservation', 'reservationRequirement', {
      reservationRequired: true,
      officialChannelLabel: 'LOCAL fixture official channel',
      officialChannelUrl: 'https://official.example/reserve',
      deadline: '2030-09-08T08:00:00.000Z'
    }),
    packagedClaim('weather', 'weatherForecast', { status: 'clear' }),
    packagedClaim('closure', 'closureNotice', { status: 'open' })
  ])
  await ctx.coordinator.record({
    sessionId: D7_PACKAGED_SMOKE_SESSION_ID,
    eventVersion: 2,
    type: 'timeline/published',
    payload: {
      timeline: {
        version: 1,
        createdAt: '2026-08-29T00:00:00.000Z',
        summary: 'Packaged D7 fixture timeline',
        isCurrent: true,
        items: [
          {
            itemId: 'packaged-item-reservation',
            date: '2030-09-10',
            startTime: '10:00',
            endTime: '12:00',
            crossesMidnight: false,
            title: 'LOCAL fixture attraction',
            itemClass: 'FIXED',
            anchorClass: 'HARD_LOCKED',
            location: {
              name: 'LOCAL fixture attraction',
              kind: 'POI',
              address: null,
              coordinates: null
            },
            arrivalTransport: null,
            bufferMinutes: 0,
            costCents: null,
            claimIds: ['packaged-claim-reservation'],
            verificationSummary: {
              status: 'VERIFIED',
              claimCount: 1,
              allClaimsUsable: true
            }
          },
          {
            itemId: 'packaged-item-backup',
            date: '2030-09-10',
            startTime: '18:00',
            endTime: '18:00',
            crossesMidnight: false,
            title: 'LOCAL fixture backup',
            itemClass: 'BACKUP',
            anchorClass: 'FLEXIBLE',
            location: { name: 'Indoor backup', kind: 'POI', address: null, coordinates: null },
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
          decisionId: 'packaged-decision-v1',
          category: 'TIMELINE_PUBLISH',
          selected: 'timeline-v1',
          reason: 'LOCAL packaged smoke fixture',
          alternatives: [],
          claimIds: ['packaged-claim-reservation']
        }
      },
      sourceOutcomes: [],
      verification: { hardAnchorCount: 1, verifiedHardAnchorCount: 1, orphanFactCount: 0 },
      changedDates: ['2030-09-10']
    }
  })
  const derived = await ctx.coordinator.deriveTasks({ sessionId: D7_PACKAGED_SMOKE_SESSION_ID })
  const task = derived.tasks[0]
  if (!task) throw new Error('Packaged D7 smoke did not derive a task.')
  await ctx.coordinator.updateTask({
    sessionId: D7_PACKAGED_SMOKE_SESSION_ID,
    taskId: task.taskId,
    expectedUpdatedAt: task.updatedAt,
    action: 'CONFIRM_EXTERNAL_RESULT'
  })
  await ctx.coordinator.runGateC({ sessionId: D7_PACKAGED_SMOKE_SESSION_ID })
  return summarize(ctx)
}

function summarize(ctx: Context): {
  currentVersion: number
  taskCount: number
  gateReady: boolean
  externalCalls: 0
  modelCalls: 0
  irreversibleActions: 0
} {
  const snapshot = ctx.coordinator.d7Snapshot({ sessionId: D7_PACKAGED_SMOKE_SESSION_ID })
  if (!snapshot.currentVersion || !snapshot.latestGateC) {
    throw new Error('Packaged D7 smoke state is incomplete.')
  }
  return {
    currentVersion: snapshot.currentVersion,
    taskCount: snapshot.tasks.length,
    gateReady: snapshot.latestGateC.ready,
    externalCalls: 0 as const,
    modelCalls: 0 as const,
    irreversibleActions: 0 as const
  }
}

function packagedClaim(
  suffix: string,
  predicate: string,
  value: Record<string, unknown>
): EvidenceClaim {
  return EvidenceClaimSchema.parse({
    claimId: `packaged-claim-${suffix}`,
    sessionId: D7_PACKAGED_SMOKE_SESSION_ID,
    subject: 'LOCAL packaged fixture',
    predicate,
    value,
    sourceId: 'SRC_SEARCH',
    sourceRef: `https://official.example/${suffix}`,
    contentIdentity: 'OFFICIAL',
    verificationStatus: 'VERIFIED',
    observedAt: '2026-08-29T00:00:00.000Z',
    validUntil: '2030-09-09T00:00:00.000Z',
    confidence: 1,
    conflictsWith: [],
    notes: 'LOCAL packaged smoke fixture only.'
  })
}
