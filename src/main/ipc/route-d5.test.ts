import assert from 'node:assert/strict'
import test from 'node:test'
import type { IpcMainInvokeEvent } from 'electron'
import { AppError } from '../../shared/errors'
import type {
  MultiSegmentD5Snapshot,
  RouteD5PlanPreview,
  RouteD5ProgressEvent
} from '../../shared/schema/route-d5'
import { createRouteD5Handlers } from './route-d5'

const EVENT = { sender: { id: 17 } } as IpcMainInvokeEvent
const SCOPE = {
  kind: 'LEG' as const,
  sessionId: 'visible-route-d5-session',
  routeId: 'route-yunnan',
  legId: 'leg-gz-dali'
}
const SNAPSHOT = {
  sessionId: SCOPE.sessionId,
  stage: 'STAGE_4',
  selectedRouteId: SCOPE.routeId
} as MultiSegmentD5Snapshot
const PREVIEW: RouteD5PlanPreview = {
  scope: SCOPE,
  action: 'DISCOVER_RAIL',
  planId: '11111111-1111-4111-8111-111111111111',
  digest: `sha256:${'a'.repeat(64)}`,
  expiresAt: '2026-08-31T03:00:00.000Z',
  plannedCalls: [
    {
      sequence: 1,
      sourceId: 'SRC_RAIL',
      capability: 'RAIL_DISCOVERY',
      label: '查询一个路段'
    }
  ],
  totalExternalCalls: 1,
  retryCount: 0,
  timeoutSeconds: 60
}

function setup(options?: { authorized?: boolean; visible?: boolean; fail?: boolean }): {
  handlers: ReturnType<typeof createRouteD5Handlers>
  getCalls: () => number
  getProgress: () => RouteD5ProgressEvent | null
} {
  let calls = 0
  let progress: RouteD5ProgressEvent | null = null
  const touch = (): MultiSegmentD5Snapshot => {
    calls += 1
    if (options?.fail) throw new Error('private route-d5 coordinator detail')
    return SNAPSHOT
  }
  const handlers = createRouteD5Handlers({
    authorize: () => {
      if (options?.authorized === false) throw new AppError('IPC_FORBIDDEN', 'blocked sender')
    },
    requireVisible: () => {
      if (options?.visible === false) throw new AppError('IPC_FORBIDDEN', 'hidden session')
    },
    snapshot: touch,
    preview: () => {
      calls += 1
      return PREVIEW
    },
    execute: async (_request, onProgress) => {
      onProgress({
        operationId: '22222222-2222-4222-8222-222222222222',
        scope: SCOPE,
        completedCalls: 1,
        totalCalls: 1,
        phase: 'COMPLETED'
      })
      return touch()
    },
    selectLeg: async () => touch(),
    attachManualLeg: async () => touch(),
    prepareSkeleton: async () => touch(),
    patchSkeleton: async () => touch(),
    addStayPaste: async () => touch(),
    selectStay: async () => touch(),
    confirm: async () => touch(),
    cancel: async () => {
      calls += 1
      return true
    },
    emitProgress: (event) => {
      progress = event
    }
  })
  return { handlers, getCalls: () => calls, getProgress: () => progress }
}

test('route-D5 IPC enforces sender, visible session and strict full scope', async () => {
  const valid = setup()
  assert.deepEqual(await valid.handlers.snapshot(EVENT, { sessionId: SCOPE.sessionId }), {
    ok: true,
    data: SNAPSHOT
  })
  assert.equal(valid.getCalls(), 1)

  const preview = await valid.handlers.preview(EVENT, {
    scope: SCOPE,
    action: 'DISCOVER_RAIL'
  })
  assert.deepEqual(preview, { ok: true, data: PREVIEW })

  const strict = setup()
  const strictResult = await strict.handlers.preview(EVENT, {
    scope: { ...SCOPE, extra: 'cross-scope' },
    action: 'DISCOVER_RAIL'
  })
  assert.equal(strictResult.ok, false)
  assert.equal(strict.getCalls(), 0)

  const hidden = setup({ visible: false })
  const hiddenResult = await hidden.handlers.snapshot(EVENT, { sessionId: SCOPE.sessionId })
  assert.equal(hiddenResult.ok, false)
  assert.equal(hidden.getCalls(), 0)

  const unauthorized = setup({ authorized: false })
  const unauthorizedResult = await unauthorized.handlers.snapshot(EVENT, {
    sessionId: SCOPE.sessionId
  })
  assert.equal(unauthorizedResult.ok, false)
  assert.equal(unauthorized.getCalls(), 0)
})

test('route-D5 IPC passes progress with exact operation and leg identity', async () => {
  const target = setup()
  const result = await target.handlers.execute(EVENT, {
    scope: SCOPE,
    action: 'DISCOVER_RAIL',
    operationId: '22222222-2222-4222-8222-222222222222',
    planId: PREVIEW.planId,
    digest: PREVIEW.digest
  })
  assert.equal(result.ok, true)
  assert.deepEqual(target.getProgress(), {
    operationId: '22222222-2222-4222-8222-222222222222',
    scope: SCOPE,
    completedCalls: 1,
    totalCalls: 1,
    phase: 'COMPLETED'
  })
})

test('route-D5 IPC redacts unknown service errors', async () => {
  const target = setup({ fail: true })
  const result = await target.handlers.snapshot(EVENT, { sessionId: SCOPE.sessionId })
  assert.equal(result.ok, false)
  assert.equal(JSON.stringify(result).includes('private route-d5 coordinator detail'), false)
})
