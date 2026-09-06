import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { Context } from 'cordis'
import { createAppPaths, sessionEventLogPath } from './paths'
import { assertKernelServices } from './kernel-contract'
import { eventLogPlugin } from './plugins/event-log'
import { travelStatePlugin } from './plugins/travel-state'
import { sessionPlugin } from './plugins/session'
import { policyPlugin } from './plugins/policy'
import { toolsPlugin } from './plugins/tool-registry'
import { providerPlugin } from './plugins/provider-runtime'
import { coordinatorPlugin } from './plugins/coordinator'
import { inspectorPlugin } from './plugins/inspector'
import { ProviderConfigStore } from './provider-config-store'
import { SourceConfigStore } from './source-config-store'

async function createTestKernel(
  root: string
): Promise<{ context: Context; database: Database.Database }> {
  const paths = createAppPaths(root)
  const database = new Database(paths.database)
  database.exec(await readFile(new URL('./db/migrations/0001_init.sql', import.meta.url), 'utf8'))
  const context = new Context()
  context.plugin(eventLogPlugin, { paths })
  context.plugin(travelStatePlugin, { database, paths })
  context.plugin(sessionPlugin)
  context.plugin(policyPlugin)
  context.plugin(toolsPlugin, {
    database,
    paths,
    sourceConfigStore: new SourceConfigStore(paths.sourceConfig),
    sleep: async () => undefined
  })
  context.plugin(providerPlugin, {
    database,
    configStore: new ProviderConfigStore(paths.providerConfig)
  })
  context.plugin(coordinatorPlugin)
  context.plugin(inspectorPlugin)
  await context.start()
  return { context, database }
}

async function stopTestKernel(context: Context, database: Database.Database): Promise<void> {
  await context.tools.close()
  await context.eventLog.close()
  database.close()
  await context.stop()
}

test('eight Cordis services register and legacy forward events rebuild byte-identically', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-kernel-'))
  try {
    const first = await createTestKernel(root)
    const keys = [
      'eventLog',
      'travelState',
      'session',
      'policy',
      'tools',
      'provider',
      'coordinator',
      'inspector'
    ]
    for (const key of keys) assert.ok(first.context.get(key), `${key} should be registered`)

    const journalMode = first.database.pragma('journal_mode', { simple: true })
    const foreignKeys = first.database.pragma('foreign_keys', { simple: true })
    assert.equal(String(journalMode).toLowerCase(), 'wal')
    assert.equal(foreignKeys, 1)

    const sessionId = 'd1-rebuild-session'
    await first.context.coordinator.record({
      sessionId,
      type: 'session/created',
      payload: { title: 'D1 rebuild' }
    })
    const stages = ['STAGE_2', 'STAGE_3', 'STAGE_4', 'STAGE_5', 'DONE'] as const
    for (const stage of stages) {
      await first.context.coordinator.record({
        sessionId,
        type: 'stage/confirmed',
        payload: { stage }
      })
    }
    assert.equal(first.context.travelState.get(sessionId)?.lastSeq, 6)
    assert.equal(first.context.inspector.appendedEvents, 6)
    const paths = createAppPaths(root)
    const bytesBefore = await readFile(sessionEventLogPath(paths, sessionId))
    await assert.rejects(() =>
      first.context.coordinator.record({
        sessionId,
        type: 'stage/confirmed',
        payload: { stage: 'STAGE_1' }
      })
    )
    await assert.rejects(() =>
      first.context.coordinator.record({
        sessionId,
        type: 'session/created',
        payload: { title: 'duplicate' }
      })
    )
    assert.deepEqual(await readFile(sessionEventLogPath(paths, sessionId)), bytesBefore)
    await stopTestKernel(first.context, first.database)

    await rm(paths.database)
    const second = await createTestKernel(root)
    await second.context.travelState.rebuildAll()
    assert.equal(second.context.travelState.get(sessionId)?.lastSeq, 6)
    assert.deepEqual(await readFile(sessionEventLogPath(paths, sessionId)), bytesBefore)
    await stopTestKernel(second.context, second.database)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('kernel self-check fails closed when a required service is missing', () => {
  const context = new Context()
  assert.throws(() => assertKernelServices(context), /eventLog/)
})
