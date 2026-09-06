import assert from 'node:assert/strict'
import test from 'node:test'
import type { IpcMainInvokeEvent } from 'electron'
import { AppError } from '../../shared/errors'
import type { D4Snapshot, ManualResearchChecklistRequest } from '../../shared/schema/d4'
import { createManualResearchPrepareHandler } from './manual-research'

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
  sourceResearchFailures: [],
  manualResearchSummary: null
}

function request(): ManualResearchChecklistRequest {
  return {
    sessionId: 'session-1',
    items: [
      {
        itemId: '123e4567-e89b-12d3-a456-426614174000',
        subject: '武侯祠',
        kind: 'ATTRACTION',
        aliases: [],
        disposition: 'NEUTRAL',
        sourceLabel: '官方公众号',
        sourceUrl: 'https://example.com/notice',
        sourceClaimId: null,
        contentIdentity: 'OFFICIAL',
        summary: '适合家庭慢游。',
        fitness: { status: 'UNKNOWN', reasons: [] },
        hardAnchors: [],
        confirmed: true
      }
    ]
  }
}

function createHandler(options?: { visible?: boolean; authorized?: boolean; fail?: boolean }): {
  calls: ManualResearchChecklistRequest[]
  handler: ReturnType<typeof createManualResearchPrepareHandler>
} {
  const calls: ManualResearchChecklistRequest[] = []
  return {
    calls,
    handler: createManualResearchPrepareHandler({
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
      prepare: async (input) => {
        calls.push(input)
        if (options?.fail) throw new Error('hidden body https://secret.example/?token=secret')
        return SNAPSHOT
      }
    })
  }
}

test('research:manual-checklist-prepare enforces the complete IPC boundary', async (t) => {
  await t.test('accepts a strict user-confirmed checklist', async () => {
    const { handler, calls } = createHandler()
    const result = await handler(EVENT, request())

    assert.deepEqual(result, { ok: true, data: SNAPSHOT })
    assert.deepEqual(calls, [request()])
  })

  await t.test('rejects extra fields and unsafe URLs before coordinator work', async () => {
    for (const raw of [
      { ...request(), unexpected: true },
      {
        ...request(),
        items: [{ ...request().items[0]!, sourceUrl: 'https://example.com/?token=secret' }]
      }
    ]) {
      const { handler, calls } = createHandler()
      const result = await handler(EVENT, raw)
      assert.equal(result.ok, false)
      if (!result.ok) assert.equal(result.error.code, 'INPUT_INVALID')
      assert.equal(calls.length, 0)
    }
  })

  await t.test('rejects invisible sessions and unauthorized senders', async () => {
    for (const options of [{ visible: false }, { authorized: false }]) {
      const { handler, calls } = createHandler(options)
      const result = await handler(EVENT, request())
      assert.equal(result.ok, false)
      if (!result.ok) assert.equal(result.error.code, 'IPC_FORBIDDEN')
      assert.equal(calls.length, 0)
    }
  })

  await t.test('serializes failures without raw body, URL, or credentials', async () => {
    const { handler } = createHandler({ fail: true })
    const result = await handler(EVENT, request())
    const serialized = JSON.stringify(result)

    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.error.code, 'INTERNAL_ERROR')
      assert.equal(result.error.userHint, '操作失败，请查看本机日志。')
    }
    assert.doesNotMatch(serialized, /hidden body|secret\.example|token=secret/)
    assert.doesNotMatch(serialized, /适合家庭慢游|官方公众号/)
  })
})
