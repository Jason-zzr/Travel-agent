import assert from 'node:assert/strict'
import test from 'node:test'
import type { IpcMainInvokeEvent } from 'electron'
import { AppError } from '../../shared/errors'
import type { RouteNodeD4Snapshot } from '../../shared/schema/d4'
import type { EvidenceClaim } from '../../shared/schema/evidence'
import { createRouteResearchHandlers } from './route-research'

const EVENT = { sender: { id: 11 } } as IpcMainInvokeEvent
const SCOPE = {
  sessionId: 'visible-session',
  routeId: 'route-1',
  nodeId: 'node-dali',
  city: '大理',
  nodeKind: 'STAY' as const,
  mandatoryPlaceIds: ['must-erhai']
}
const SNAPSHOT: RouteNodeD4Snapshot = {
  sessionId: SCOPE.sessionId,
  stage: 'STAGE_3',
  selectedRouteId: SCOPE.routeId,
  currentScope: SCOPE,
  currentNode: {
    scope: SCOPE,
    sequence: 1,
    required: true,
    status: 'NOT_STARTED',
    skipReason: null,
    researchEntities: [],
    researchChecklistConfirmed: false,
    conflictResolutions: [],
    sourceResearchFailures: [],
    xhsSampleSummary: null,
    manualResearchSummary: null,
    attractionRankings: [],
    blockingReasons: [],
    confirmedAt: null
  },
  nodeSummaries: [
    {
      scope: SCOPE,
      sequence: 1,
      required: true,
      status: 'NOT_STARTED',
      blockerCount: 0,
      entityCount: 0,
      confirmedAt: null,
      skipReason: null
    }
  ],
  routeResearchComplete: false,
  nextRequiredNodeId: SCOPE.nodeId
}

function createHandlers(options?: { authorized?: boolean; visible?: boolean; fail?: boolean }): {
  handlers: ReturnType<typeof createRouteResearchHandlers>
  getCalls(): number
} {
  let calls = 0
  const touch = (): RouteNodeD4Snapshot => {
    calls += 1
    if (options?.fail) throw new Error('private node coordinator detail')
    return SNAPSHOT
  }
  const claim = {
    claimId: 'claim-node-paste',
    sessionId: SCOPE.sessionId,
    subject: '用户粘贴线索',
    predicate: 'userProvidedText',
    value: 'fixture',
    sourceId: 'USER_PASTE',
    sourceRef: 'user-paste:fixture',
    contentIdentity: 'UNKNOWN',
    verificationStatus: 'UNVERIFIED',
    observedAt: '2026-08-31T00:00:00.000Z',
    validUntil: '2026-09-01T00:00:00.000Z',
    confidence: null,
    conflictsWith: [],
    notes: null,
    scope: { kind: 'ROUTE_NODE', routeId: SCOPE.routeId, nodeId: SCOPE.nodeId }
  } satisfies EvidenceClaim
  const handlers = createRouteResearchHandlers({
    authorize: () => {
      if (options?.authorized === false) throw new AppError('IPC_FORBIDDEN', 'blocked sender')
    },
    requireVisible: () => {
      if (options?.visible === false) throw new AppError('IPC_FORBIDDEN', 'hidden session')
    },
    snapshot: touch,
    preview: async (request) => {
      touch()
      return {
        ...request,
        scope: SCOPE,
        planId: '11111111-1111-4111-8111-111111111111',
        digest: `sha256:${'a'.repeat(64)}`,
        expiresAt: '2026-08-31T01:00:00.000Z',
        sourcePlan: [],
        modelPlan: [],
        totalExternalCalls: 0,
        totalModelCalls: 0,
        timeoutMs: 60_000,
        retryCount: 0
      }
    },
    execute: async (_request, onProgress) => {
      onProgress({
        operationId: '22222222-2222-4222-8222-222222222222',
        sessionId: SCOPE.sessionId,
        routeId: SCOPE.routeId,
        nodeId: SCOPE.nodeId,
        kind: 'COMPLETED',
        sourceId: null,
        message: 'done'
      })
      return touch()
    },
    prepareManual: async () => touch(),
    addUserPaste: async () => {
      touch()
      return claim
    },
    setDisposition: async () => touch(),
    resolveConflict: async () => touch(),
    confirm: async () => touch(),
    cancel: async () => {
      calls += 1
      return true
    },
    emitProgress: () => undefined
  })
  return { handlers, getCalls: () => calls }
}

test('route node research IPC enforces authorization, visibility and strict node payloads', async () => {
  const valid = createHandlers()
  assert.deepEqual(
    await valid.handlers.snapshot(EVENT, {
      sessionId: SCOPE.sessionId,
      routeId: SCOPE.routeId,
      nodeId: SCOPE.nodeId
    }),
    { ok: true, data: SNAPSHOT }
  )
  assert.equal(valid.getCalls(), 1)

  const strict = createHandlers()
  const strictResult = await strict.handlers.snapshot(EVENT, {
    sessionId: SCOPE.sessionId,
    routeId: SCOPE.routeId,
    nodeId: SCOPE.nodeId,
    extra: true
  })
  assert.equal(strictResult.ok, false)
  assert.equal(strict.getCalls(), 0)

  const unsafe = createHandlers()
  const unsafeResult = await unsafe.handlers.addUserPaste(EVENT, {
    sessionId: SCOPE.sessionId,
    routeId: SCOPE.routeId,
    nodeId: SCOPE.nodeId,
    text: 'fixture',
    sourceUrl: 'https://example.com/?token=secret'
  })
  assert.equal(unsafeResult.ok, false)
  assert.equal(unsafe.getCalls(), 0)

  const hidden = createHandlers({ visible: false })
  const hiddenResult = await hidden.handlers.snapshot(EVENT, {
    sessionId: SCOPE.sessionId,
    routeId: SCOPE.routeId,
    nodeId: SCOPE.nodeId
  })
  assert.equal(hiddenResult.ok, false)
  assert.equal(hidden.getCalls(), 0)

  const unauthorized = createHandlers({ authorized: false })
  const unauthorizedResult = await unauthorized.handlers.snapshot(EVENT, {
    sessionId: SCOPE.sessionId,
    routeId: SCOPE.routeId,
    nodeId: SCOPE.nodeId
  })
  assert.equal(unauthorizedResult.ok, false)
  assert.equal(unauthorized.getCalls(), 0)
})

test('route node research IPC redacts unknown coordinator failures', async () => {
  const { handlers } = createHandlers({ fail: true })
  const result = await handlers.snapshot(EVENT, {
    sessionId: SCOPE.sessionId,
    routeId: SCOPE.routeId,
    nodeId: SCOPE.nodeId
  })
  assert.equal(result.ok, false)
  assert.equal(JSON.stringify(result).includes('private node coordinator detail'), false)
})
