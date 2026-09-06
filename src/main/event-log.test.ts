import assert from 'node:assert/strict'
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { AppError } from '../shared/errors'
import { createAppPaths, sessionEventLogPath } from './paths'
import { EventLogService } from './plugins/event-log'

function event(seq: number): string {
  return JSON.stringify({
    eventId: `event-${seq}`,
    sessionId: 'session-a',
    seq,
    timestamp: '2026-08-22T00:00:00.000Z',
    type: 'session/created',
    payload: { title: null }
  })
}

test('JSONL ignores only a malformed final partial line', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-log-'))
  try {
    const paths = createAppPaths(root)
    const path = sessionEventLogPath(paths, 'session-a')
    await mkdir(dirname(path), { recursive: true })
    const warnings: string[] = []
    await writeFile(path, `${event(1)}\n{"eventId":`, 'utf8')
    const service = new EventLogService({ paths, warn: (message) => warnings.push(message) })
    assert.equal((await service.read('session-a')).length, 1)
    assert.equal(warnings.length, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('JSONL fails closed on malformed middle lines and sequence gaps', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-log-'))
  try {
    const paths = createAppPaths(root)
    const path = sessionEventLogPath(paths, 'session-a')
    await mkdir(dirname(path), { recursive: true })
    const service = new EventLogService({ paths })

    await writeFile(path, `${event(1)}\nnot-json\n${event(2)}\n`, 'utf8')
    await assert.rejects(
      () => service.read('session-a'),
      (error: unknown) => {
        return error instanceof AppError && error.code === 'EVENT_LOG_CORRUPT'
      }
    )

    await writeFile(path, `${event(1)}\n${event(3)}\n`, 'utf8')
    await assert.rejects(
      () => service.read('session-a'),
      (error: unknown) => {
        return error instanceof AppError && error.code === 'EVENT_SEQUENCE_GAP'
      }
    )

    await writeFile(path, 'not-json', 'utf8')
    await assert.rejects(
      () => service.read('session-a'),
      (error: unknown) => error instanceof AppError && error.code === 'EVENT_LOG_CORRUPT'
    )

    await writeFile(path, `${event(1)}\n${event(3)}`, 'utf8')
    await assert.rejects(
      () => service.read('session-a'),
      (error: unknown) => error instanceof AppError && error.code === 'EVENT_SEQUENCE_GAP'
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('JSONL rolls back appended bytes when sync fails and retries without a sequence gap', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-log-'))
  try {
    const paths = createAppPaths(root)
    const path = sessionEventLogPath(paths, 'session-a')
    await mkdir(dirname(path), { recursive: true })
    const original = `${event(1)}\n`
    await writeFile(path, original, 'utf8')
    let failNextAppendSync = true
    const service = new EventLogService({
      paths,
      openFile: async (filePath, flags) => {
        const handle = await open(filePath, flags)
        if (flags !== 'a' || !failNextAppendSync) return handle
        return {
          stat: () => handle.stat(),
          writeFile: (data, encoding) => handle.writeFile(data, encoding),
          sync: async () => {
            failNextAppendSync = false
            throw new Error('simulated sync failure')
          },
          truncate: (length) => handle.truncate(length),
          close: () => handle.close()
        }
      }
    })
    const draft = {
      sessionId: 'session-a',
      type: 'stage/confirmed' as const,
      payload: { stage: 'STAGE_2' as const }
    }

    await assert.rejects(() => service.append(draft), /simulated sync failure/)
    assert.equal(await readFile(path, 'utf8'), original)

    const appended = await service.append(draft)
    assert.equal(appended.seq, 2)
    assert.equal((await service.read('session-a')).length, 2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
