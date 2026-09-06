import assert from 'node:assert/strict'
import test from 'node:test'
import type { IpcMainInvokeEvent } from 'electron'
import { AppError } from '../../shared/errors'
import type { D4Snapshot, FixedDestinationConfirmRequest } from '../../shared/schema/d4'
import { createFixedDestinationConfirmHandler } from './fixed-destination'

const EVENT = { sender: { id: 7 } } as IpcMainInvokeEvent
const SNAPSHOT: D4Snapshot = {
  sessionId: 'session-1',
  stage: 'STAGE_3',
  fixedDestinationCity: null,
  destinationCandidates: [],
  selectedDestinationCandidateId: null,
  researchEntities: [],
  researchChecklistConfirmed: false,
  conflictResolutions: [],
  sourceResearchFailures: []
}

function createHandler(options?: { visible?: boolean; authorized?: boolean; fail?: boolean }): {
  calls: FixedDestinationConfirmRequest[]
  handler: ReturnType<typeof createFixedDestinationConfirmHandler>
} {
  const calls: FixedDestinationConfirmRequest[] = []
  return {
    calls,
    handler: createFixedDestinationConfirmHandler({
      authorize: () => {
        if (options?.authorized === false) {
          throw new AppError('IPC_FORBIDDEN', '拒绝来自非主窗口的请求。')
        }
      },
      requireVisible: () => {
        if (options?.visible === false) {
          throw new AppError('IPC_FORBIDDEN', '该会话未暴露给当前窗口。')
        }
      },
      confirm: async (request) => {
        calls.push(request)
        if (options?.fail) throw new Error('hidden coordinator failure')
        return SNAPSHOT
      }
    })
  }
}

test('destination:confirm-fixed validates and wraps the complete IPC path', async (t) => {
  await t.test(
    'accepts a strict payload and passes its normalized city to the coordinator',
    async () => {
      const { handler, calls } = createHandler()
      const result = await handler(EVENT, { sessionId: 'session-1', city: ' 成都 ' })

      assert.deepEqual(result, { ok: true, data: SNAPSHOT })
      assert.deepEqual(calls, [{ sessionId: 'session-1', city: '成都' }])
    }
  )

  await t.test('rejects an extra payload field before calling the coordinator', async () => {
    const { handler, calls } = createHandler()
    const result = await handler(EVENT, {
      sessionId: 'session-1',
      city: '成都',
      candidateId: 'not-allowed'
    })

    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error.code, 'INPUT_INVALID')
    assert.equal(calls.length, 0)
  })

  await t.test('rejects a session that is not visible to the current window', async () => {
    const { handler, calls } = createHandler({ visible: false })
    const result = await handler(EVENT, { sessionId: 'session-1', city: '成都' })

    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error.code, 'IPC_FORBIDDEN')
    assert.equal(calls.length, 0)
  })

  await t.test('rejects an unauthorized sender before inspecting visibility', async () => {
    const { handler, calls } = createHandler({ authorized: false })
    const result = await handler(EVENT, { sessionId: 'session-1', city: '成都' })

    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error.code, 'IPC_FORBIDDEN')
    assert.equal(calls.length, 0)
  })

  await t.test(
    'serializes unknown coordinator failures without exposing their message',
    async () => {
      const { handler } = createHandler({ fail: true })
      const result = await handler(EVENT, { sessionId: 'session-1', city: '成都' })

      assert.equal(result.ok, false)
      if (!result.ok) {
        assert.equal(result.error.code, 'INTERNAL_ERROR')
        assert.equal(result.error.userHint, '操作失败，请查看本机日志。')
      }
      assert.equal(JSON.stringify(result).includes('hidden coordinator failure'), false)
    }
  )
})
