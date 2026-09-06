import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { Context } from 'cordis'
import { AppError } from '../shared/errors'
import { applyMigrations } from './db/migrate'
import { SOURCE_DEFINITIONS } from './mcp/source-catalog'
import { createAppPaths, createFlyaiRuntimePaths, type AppPaths } from './paths'
import { eventLogPlugin } from './plugins/event-log'
import { policyPlugin } from './plugins/policy'
import { toolsPlugin } from './plugins/tool-registry'
import { travelStatePlugin } from './plugins/travel-state'
import {
  claimFlyaiFlightGate,
  createFlyaiFlightGatePreview,
  type AuthorizedFlyaiFlightProbe
} from './probes/flyai-flight-gate'
import {
  flyaiFlightProbeErrorCode,
  flyaiFlightProbeFailureCategory
} from './probes/flyai-flight-once'
import {
  inspectFlyaiBundle,
  type FlyaiProcessExecutor,
  type FlyaiProcessHandle
} from './probes/flyai-cli-runner'
import { SourceConfigStore } from './source-config-store'

const PLAN_ID = '11111111-1111-4111-8111-111111111111'
const OPERATION_ID = '22222222-2222-4222-8222-222222222222'
const CREATED_AT = new Date('2026-09-02T08:00:00.000Z')
const CLAIMED_AT = new Date('2026-09-02T08:01:00.000Z')

test('FlyAI one-shot maps unknown failures to a stable internal error code', () => {
  assert.equal(flyaiFlightProbeErrorCode(new Error('sensitive detail')), 'INTERNAL_ERROR')
  assert.equal(flyaiFlightProbeFailureCategory(new Error('sensitive detail')), null)
  assert.equal(
    flyaiFlightProbeErrorCode(new AppError('MCP_TOOL_ERROR', 'safe classification')),
    'MCP_TOOL_ERROR'
  )
})

test('ToolRegistry FlyAI entry exposes a fixed failure category without provider text', async () => {
  const handle = new FakeHandle()
  const harness = await createHarness({
    executor: {
      fork() {
        queueMicrotask(() => {
          handle.stderr.write(
            'MCP HTTP 451: Unavailable For Legal Reasons\nBody: sensitive-provider-text'
          )
          handle.finish(1)
        })
        return handle
      }
    },
    readCredential: async () => 'fixture-flyai-credential'
  })
  try {
    const authorization = await createAuthorization(harness.root, harness.runtimePaths)
    const error = await harness.context.tools
      .runFlyaiFlightStructureProbeOnce({ authorization, runtimePaths: harness.runtimePaths })
      .then(
        () => undefined,
        (caught: unknown) => caught
      )
    assert.ok(error instanceof AppError)
    assert.equal(flyaiFlightProbeErrorCode(error), 'MCP_TOOL_ERROR')
    assert.equal(flyaiFlightProbeFailureCategory(error), 'HTTP_451_RISK_CONTROL')
    assert.equal(JSON.stringify(error).includes('sensitive-provider-text'), false)
  } finally {
    await harness.stop()
  }
})

test('ToolRegistry FlyAI entry consumes Gate before one isolated process and persists nothing', async () => {
  const state = {
    processAttempts: 0,
    processCalls: 0,
    sourceSessions: 0,
    credentialReads: [] as string[]
  }
  const handle = new FakeHandle()
  const executor: FlyaiProcessExecutor = {
    fork() {
      state.processCalls += 1
      queueMicrotask(() => {
        handle.stdout.write('{"flights":[{"flightNo":"MU1234","price":589}]}\n')
        handle.finish(0)
      })
      return handle
    }
  }
  const harness = await createHarness({
    executor,
    readCredential: async (id) => {
      state.credentialReads.push(id)
      return 'fixture-flyai-credential'
    },
    onSourceSession: () => {
      state.sourceSessions += 1
    }
  })
  try {
    const authorization = await createAuthorization(harness.root, harness.runtimePaths)
    const outcome = await harness.context.tools.runFlyaiFlightStructureProbeOnce({
      authorization,
      runtimePaths: harness.runtimePaths,
      onProcessAttempt: () => {
        state.processAttempts += 1
      }
    })

    assert.equal(state.processAttempts, 1)
    assert.equal(state.processCalls, 1)
    assert.deepEqual(state.credentialReads, ['FLYAI'])
    assert.equal(state.sourceSessions, 0)
    assert.equal(outcome.cliProcessAttempts, 1)
    assert.equal(outcome.applicationRetryCount, 0)
    assert.equal(outcome.internalProviderRequestCount, 'UNKNOWN')
    assert.equal(outcome.internalProviderRetryCount, 'UNKNOWN')
    assert.equal(outcome.rawResponseRetained, false)
    assert.equal(outcome.valueRetention, false)
    assert.equal(JSON.stringify(outcome).includes('MU1234'), false)
    assert.equal(JSON.stringify(outcome).includes('589'), false)
    assert.deepEqual(harness.context.tools.listToolCalls(undefined), [])
    assert.deepEqual(harness.context.tools.listEvidence('fixture-session'), [])
    assert.deepEqual([...SOURCE_DEFINITIONS.SRC_FLIGHT.allowlist], [])
    assert.deepEqual(Object.keys(SOURCE_DEFINITIONS.SRC_FLIGHT.tools), [])

    await assert.rejects(
      harness.context.tools.runFlyaiFlightStructureProbeOnce({
        authorization,
        runtimePaths: harness.runtimePaths
      }),
      isAppError('GATE_BLOCKED')
    )
    assert.equal(state.processCalls, 1)
    assert.equal(state.processAttempts, 1)
    assert.deepEqual(state.credentialReads, ['FLYAI'])
  } finally {
    await harness.stop()
  }
})

test('ToolRegistry FlyAI entry reports zero process attempts when credential preparation fails', async () => {
  let processAttempts = 0
  let processCalls = 0
  const harness = await createHarness({
    executor: {
      fork() {
        processCalls += 1
        throw new Error('must not launch')
      }
    },
    readCredential: async () => undefined
  })
  try {
    const authorization = await createAuthorization(harness.root, harness.runtimePaths)
    await assert.rejects(
      harness.context.tools.runFlyaiFlightStructureProbeOnce({
        authorization,
        runtimePaths: harness.runtimePaths,
        onProcessAttempt: () => {
          processAttempts += 1
        }
      }),
      isAppError('SOURCE_UNCONFIGURED')
    )
    assert.equal(processAttempts, 0)
    assert.equal(processCalls, 0)
  } finally {
    await harness.stop()
  }
})

test('ToolRegistry FlyAI entry rejects missing Gate before credentials or process creation', async () => {
  let credentialReads = 0
  let executorCreations = 0
  const harness = await createHarness({
    executor: {
      fork() {
        throw new Error('must not launch')
      }
    },
    readCredential: async () => {
      credentialReads += 1
      return 'fixture'
    },
    onExecutorCreate: () => {
      executorCreations += 1
    }
  })
  try {
    await assert.rejects(
      harness.context.tools.runFlyaiFlightStructureProbeOnce({
        authorization: {} as never,
        runtimePaths: harness.runtimePaths
      }),
      isAppError('GATE_BLOCKED')
    )
    assert.equal(credentialReads, 0)
    assert.equal(executorCreations, 0)
  } finally {
    await harness.stop()
  }
})

interface HarnessOptions {
  executor: FlyaiProcessExecutor
  readCredential(id: string): Promise<string | undefined>
  onSourceSession?: () => void
  onExecutorCreate?: () => void
}

interface FlyaiHarness {
  root: string
  context: Context
  runtimePaths: ReturnType<typeof createFlyaiRuntimePaths>
  stop(): Promise<void>
}

async function createHarness(options: HarnessOptions): Promise<FlyaiHarness> {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-flyai-registry-'))
  const paths = createAppPaths(root)
  const runtimePaths = createFlyaiRuntimePaths({
    appPath: process.cwd(),
    resourcesPath: process.cwd(),
    isPackaged: false
  })
  const database = await openFixtureDatabase(paths)
  const sourceConfigStore = new SourceConfigStore(paths.sourceConfig)
  await sourceConfigStore.save({ version: 1, searchModel: null })
  const context = new Context()
  context.plugin(eventLogPlugin, { paths })
  context.plugin(travelStatePlugin, { database, paths })
  context.plugin(policyPlugin)
  context.plugin(toolsPlugin, {
    database,
    paths,
    sourceConfigStore,
    readCredential: options.readCredential,
    createSession: () => {
      options.onSourceSession?.()
      throw new Error('production source session must not be used')
    },
    createFlyaiProcessExecutor: async () => {
      options.onExecutorCreate?.()
      return options.executor
    },
    now: () => CLAIMED_AT,
    sleep: async () => undefined
  })
  await context.start()

  return {
    root,
    context,
    runtimePaths,
    async stop() {
      await context.tools.close()
      await context.eventLog.close()
      database.close()
      await context.stop()
      await rm(root, { recursive: true, force: true })
    }
  }
}

async function createAuthorization(
  root: string,
  runtimePaths: ReturnType<typeof createFlyaiRuntimePaths>
): Promise<AuthorizedFlyaiFlightProbe> {
  const binding = await inspectFlyaiBundle(runtimePaths)
  const preview = createFlyaiFlightGatePreview({
    args: { origin: '西双版纳', destination: '广州', depDate: '2026-09-17' },
    binding,
    now: CREATED_AT,
    planId: PLAN_ID,
    operationId: OPERATION_ID
  })
  const artifactPath = join(root, 'flyai-flight-preview.json')
  await writeFile(artifactPath, `${JSON.stringify(preview, null, 2)}\n`, 'utf8')
  return claimFlyaiFlightGate(
    artifactPath,
    { planId: PLAN_ID, digest: preview.digest, operationId: OPERATION_ID },
    { allowedRoot: root, now: CLAIMED_AT }
  )
}

async function openFixtureDatabase(paths: AppPaths): Promise<Database.Database> {
  const database = new Database(paths.database)
  database.pragma('foreign_keys = ON')
  const [first, second, third] = await Promise.all([
    readFile(new URL('./db/migrations/0001_init.sql', import.meta.url), 'utf8'),
    readFile(new URL('./db/migrations/0002_model_call_cost.sql', import.meta.url), 'utf8'),
    readFile(new URL('./db/migrations/0003_xiaohongshu_source.sql', import.meta.url), 'utf8')
  ])
  applyMigrations(database, [
    { version: 1, sql: first },
    { version: 2, sql: second },
    { version: 3, sql: third }
  ])
  return database
}

function isAppError(code: AppError['code']): (error: unknown) => boolean {
  return (error: unknown) => error instanceof AppError && error.code === code
}

class FakeHandle implements FlyaiProcessHandle {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  pid: number | undefined = 43_001
  private exitListener: ((code: number) => void) | undefined

  terminate(): boolean {
    this.finish(143)
    return true
  }

  onExit(listener: (code: number) => void): () => void {
    this.exitListener = listener
    return () => {
      if (this.exitListener === listener) this.exitListener = undefined
    }
  }

  onFatalError(): () => void {
    return () => undefined
  }

  finish(code: number): void {
    this.pid = undefined
    this.exitListener?.(code)
  }
}
