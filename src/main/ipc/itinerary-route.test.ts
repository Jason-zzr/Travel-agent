import assert from 'node:assert/strict'
import test from 'node:test'
import type { IpcMainInvokeEvent } from 'electron'
import { AppError } from '../../shared/errors'
import type { MultiCityRouteSnapshot } from '../../shared/schema/itinerary'
import { createItineraryRouteHandlers } from './itinerary-route'

const EVENT = { sender: { id: 9 } } as IpcMainInvokeEvent
const SNAPSHOT: MultiCityRouteSnapshot = {
  sessionId: 'route-visible',
  stage: 'STAGE_2',
  goal: null,
  candidates: [],
  selectedRouteId: null,
  sourceOutcomes: [],
  blockingReasons: []
}
const MANUAL_REQUEST = {
  sessionId: 'route-visible',
  routeId: 'route-1',
  legId: 'leg-1',
  mode: 'MANUAL_FLIGHT' as const,
  startAt: '2026-09-01T08:00:00+08:00',
  endAt: '2026-09-01T10:00:00+08:00',
  label: 'MU1234',
  costCents: null,
  sourceLabel: '航司官网',
  sourceUrl: 'https://example.com/flight',
  summary: '用户核对后的航班班次与时间。',
  confirmed: true as const
}

function createHandlers(options?: { authorized?: boolean; visible?: boolean; fail?: boolean }): {
  handlers: ReturnType<typeof createItineraryRouteHandlers>
  getCalls(): number
} {
  let calls = 0
  const handlers = createItineraryRouteHandlers({
    authorize: () => {
      if (options?.authorized === false) throw new AppError('IPC_FORBIDDEN', 'sender blocked')
    },
    requireVisible: () => {
      if (options?.visible === false) throw new AppError('IPC_FORBIDDEN', 'session blocked')
    },
    snapshot: () => {
      calls += 1
      if (options?.fail) throw new Error('private coordinator detail')
      return SNAPSHOT
    },
    preview: () => {
      calls += 1
      throw new AppError('GATE_BLOCKED', 'fixture has no route goal')
    },
    execute: async () => {
      calls += 1
      return SNAPSHOT
    },
    select: async () => {
      calls += 1
      return SNAPSHOT
    },
    applyManualEvidence: async () => {
      calls += 1
      if (options?.fail) {
        throw new Error(`private coordinator detail ${MANUAL_REQUEST.sourceUrl}`)
      }
      return SNAPSHOT
    },
    cancel: async () => {
      calls += 1
      return true
    },
    emitProgress: () => undefined
  })
  return { handlers, getCalls: () => calls }
}

test('itinerary route IPC enforces authorization, strict parsing and visibility before coordinator calls', async () => {
  const valid = createHandlers()
  assert.deepEqual(await valid.handlers.snapshot(EVENT, { sessionId: 'route-visible' }), {
    ok: true,
    data: SNAPSHOT
  })
  assert.equal(valid.getCalls(), 1)

  const strict = createHandlers()
  const strictResult = await strict.handlers.select(EVENT, {
    sessionId: 'route-visible',
    routeId: 'route-1',
    chosen: 'not-allowed'
  })
  assert.equal(strictResult.ok, false)
  if (!strictResult.ok) assert.equal(strictResult.error.code, 'INPUT_INVALID')
  assert.equal(strict.getCalls(), 0)

  const manualStrict = createHandlers()
  const manualStrictResult = await manualStrict.handlers.applyManualEvidence(EVENT, {
    ...MANUAL_REQUEST,
    confirmed: false
  })
  assert.equal(manualStrictResult.ok, false)
  if (!manualStrictResult.ok) assert.equal(manualStrictResult.error.code, 'INPUT_INVALID')
  assert.equal(manualStrict.getCalls(), 0)

  const manualValid = createHandlers()
  assert.deepEqual(await manualValid.handlers.applyManualEvidence(EVENT, MANUAL_REQUEST), {
    ok: true,
    data: SNAPSHOT
  })
  assert.equal(manualValid.getCalls(), 1)

  const manualHidden = createHandlers({ visible: false })
  const manualHiddenResult = await manualHidden.handlers.applyManualEvidence(EVENT, MANUAL_REQUEST)
  assert.equal(manualHiddenResult.ok, false)
  if (!manualHiddenResult.ok) assert.equal(manualHiddenResult.error.code, 'IPC_FORBIDDEN')
  assert.equal(manualHidden.getCalls(), 0)

  const hidden = createHandlers({ visible: false })
  const hiddenResult = await hidden.handlers.snapshot(EVENT, { sessionId: 'route-visible' })
  assert.equal(hiddenResult.ok, false)
  if (!hiddenResult.ok) assert.equal(hiddenResult.error.code, 'IPC_FORBIDDEN')
  assert.equal(hidden.getCalls(), 0)

  const unauthorized = createHandlers({ authorized: false })
  const unauthorizedResult = await unauthorized.handlers.snapshot(EVENT, {
    sessionId: 'route-visible'
  })
  assert.equal(unauthorizedResult.ok, false)
  if (!unauthorizedResult.ok) assert.equal(unauthorizedResult.error.code, 'IPC_FORBIDDEN')
  assert.equal(unauthorized.getCalls(), 0)
})

test('itinerary route IPC serializes unknown failures without leaking coordinator details', async () => {
  const { handlers } = createHandlers({ fail: true })
  const result = await handlers.snapshot(EVENT, { sessionId: 'route-visible' })
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.error.code, 'INTERNAL_ERROR')
    assert.equal(result.error.userHint, '操作失败，请查看本机日志。')
  }
  assert.equal(JSON.stringify(result).includes('private coordinator detail'), false)

  const manualResult = await handlers.applyManualEvidence(EVENT, MANUAL_REQUEST)
  assert.equal(manualResult.ok, false)
  assert.equal(JSON.stringify(manualResult).includes('private coordinator detail'), false)
  assert.equal(JSON.stringify(manualResult).includes(MANUAL_REQUEST.sourceUrl), false)
})
