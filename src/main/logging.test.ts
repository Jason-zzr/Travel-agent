import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AppLogger, redactLogContext } from './logging'
import { createAppPaths } from './paths'

test('structured logger only keeps allowlisted context keys', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-log-redaction-'))
  try {
    const paths = createAppPaths(root)
    const logger = new AppLogger(paths)
    const context = redactLogContext({
      sessionId: 'session-a',
      secret: 'must-not-appear',
      authorization: 'must-not-appear'
    })
    assert.deepEqual(context, { sessionId: 'session-a' })
    logger.warn('EVENT_FINAL_PARTIAL', 'Final partial event ignored.', {
      sessionId: 'session-a',
      secret: 'must-not-appear'
    })
    await logger.close()
    const date = new Date().toISOString().slice(0, 10)
    const persisted = await readFile(join(paths.logs, `app-${date}.jsonl`), 'utf8')
    assert.equal(persisted.includes('must-not-appear'), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
