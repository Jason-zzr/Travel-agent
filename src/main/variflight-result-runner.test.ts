import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { Context } from 'cordis'
import { AppError } from '../shared/errors'
import {
  VARIFLIGHT_FLIGHT_PRICE_TOOL_NAME,
  type VariflightFlightPriceArgs
} from '../shared/schema/mcp/flight'
import { applyMigrations } from './db/migrate'
import type { McpToolDescriptor, SourceSession } from './mcp/client'
import { SOURCE_DEFINITIONS } from './mcp/source-catalog'
import { createAppPaths, type AppPaths } from './paths'
import { eventLogPlugin } from './plugins/event-log'
import { policyPlugin } from './plugins/policy'
import { toolsPlugin, type SourceSessionFactory } from './plugins/tool-registry'
import { travelStatePlugin } from './plugins/travel-state'
import {
  claimVariflightGateR2,
  createVariflightGateR2Preview
} from './probes/variflight-result-gate'
import { runVariflightResultProbeOnce } from './probes/variflight-result-once'
import { SourceConfigStore } from './source-config-store'

const PLAN_ID = '11111111-1111-4111-8111-111111111111'
const OPERATION_ID = '22222222-2222-4222-8222-222222222222'
const ARGS: VariflightFlightPriceArgs = {
  dep_city: 'JHG',
  arr_city: 'CAN',
  dep_date: '2026-09-17'
}

const STRICT_DESCRIPTOR: McpToolDescriptor = {
  name: VARIFLIGHT_FLIGHT_PRICE_TOOL_NAME,
  description: 'Read-only flight price query by departure and arrival city.',
  inputSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      dep_city: {
        type: 'string',
        pattern: '^[A-Z]{3}$',
        description: 'Departure city IATA code.'
      },
      arr_city: {
        type: 'string',
        pattern: '^[A-Z]{3}$',
        description: 'Arrival city IATA code.'
      },
      dep_date: {
        type: 'string',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'Departure date.'
      }
    },
    required: ['dep_city', 'arr_city', 'dep_date'],
    additionalProperties: false
  }
}

interface ProbeState {
  connects: number
  lists: number
  calls: number
  closes: number
  descriptors: McpToolDescriptor[]
  response: unknown
  callError?: AppError
  closeError?: Error
  received?: {
    name: string
    args: Record<string, unknown>
    timeoutMs: number
  }
}

interface ProbeHarness {
  root: string
  paths: AppPaths
  context: Context
  database: Database.Database
  stop(): Promise<void>
}

test('ToolRegistry result probe performs one bounded call and retains only JSON shape', async () => {
  const state = createState({
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          flights: [{ flightNo: 'AQ1042', cabins: [{ price: 589 }] }]
        })
      }
    ]
  })
  const harness = await createHarness(state)
  try {
    const outcome = await harness.context.tools.runVariflightResultShapeProbeOnce({
      args: ARGS,
      timeoutMs: 15_000,
      operationId: OPERATION_ID
    })

    assert.equal(outcome.ok, true)
    assert.equal(outcome.source, 'SRC_FLIGHT')
    assert.equal(outcome.tool, VARIFLIGHT_FLIGHT_PRICE_TOOL_NAME)
    assert.equal(outcome.callAttempts, 1)
    assert.equal(outcome.resultSchema, 'NOT_RUN')
    assert.equal(outcome.contractStatus, 'UNPROVEN')
    assert.equal(outcome.rawResponseRetained, false)
    assert.equal(outcome.summary?.payloadKind, 'JSON')
    assert.equal(
      outcome.summary?.entries.some((entry) => entry.path === '$/flights/*/cabins/*/price'),
      true
    )
    assert.deepEqual(
      { connects: state.connects, lists: state.lists, calls: state.calls, closes: state.closes },
      { connects: 1, lists: 1, calls: 1, closes: 1 }
    )
    assert.deepEqual(state.received, {
      name: VARIFLIGHT_FLIGHT_PRICE_TOOL_NAME,
      args: ARGS,
      timeoutMs: 15_000
    })

    const serialized = JSON.stringify(outcome)
    for (const rawValue of ['AQ1042', '589', 'JHG', 'CAN']) {
      assert.equal(serialized.includes(rawValue), false)
    }
    assert.deepEqual(harness.context.tools.listToolCalls(undefined), [])
    assert.deepEqual(harness.context.tools.listEvidence('fixture-session'), [])
    assert.deepEqual([...SOURCE_DEFINITIONS.SRC_FLIGHT.allowlist], [])
    assert.deepEqual(Object.keys(SOURCE_DEFINITIONS.SRC_FLIGHT.tools), [])
    assert.equal(SOURCE_DEFINITIONS.SRC_FLIGHT.probeTool, null)
  } finally {
    await harness.stop()
  }
})

test('ToolRegistry result probe rejects descriptor drift before a call', async () => {
  const state = createState({ content: [{ type: 'text', text: '{}' }] })
  state.descriptors = [
    {
      ...STRICT_DESCRIPTOR,
      inputSchema: { ...(STRICT_DESCRIPTOR.inputSchema as object), additionalProperties: true }
    }
  ]
  const harness = await createHarness(state)
  try {
    const outcome = await harness.context.tools.runVariflightResultShapeProbeOnce({
      args: ARGS,
      timeoutMs: 15_000,
      operationId: OPERATION_ID
    })

    assert.equal(outcome.ok, false)
    assert.equal(outcome.errorCode, 'SOURCE_DRIFT')
    assert.equal(outcome.discovered, false)
    assert.deepEqual(
      { connects: state.connects, lists: state.lists, calls: state.calls, closes: state.closes },
      { connects: 1, lists: 1, calls: 0, closes: 1 }
    )
  } finally {
    await harness.stop()
  }
})

test('ToolRegistry result probe classifies non-JSON text without retaining it', async () => {
  const rawText = 'AQ1042 costs 589 from JHG to CAN'
  const state = createState({ content: [{ type: 'text', text: rawText }] })
  const harness = await createHarness(state)
  try {
    const outcome = await harness.context.tools.runVariflightResultShapeProbeOnce({
      args: ARGS,
      timeoutMs: 15_000,
      operationId: OPERATION_ID
    })

    assert.equal(outcome.ok, false)
    assert.equal(outcome.errorCode, 'SOURCE_DRIFT')
    assert.equal(outcome.summary?.payloadKind, 'NON_JSON_TEXT')
    assert.equal(JSON.stringify(outcome).includes(rawText), false)
    assert.deepEqual(
      { connects: state.connects, lists: state.lists, calls: state.calls, closes: state.closes },
      { connects: 1, lists: 1, calls: 1, closes: 1 }
    )
  } finally {
    await harness.stop()
  }
})

test('ToolRegistry result probe keeps explicit tool errors value-free and out of health state', async () => {
  const rawError = 'sensitive synthetic provider error JHG CAN 589'
  const state = createState({
    content: [{ type: 'text', text: rawError }],
    isError: true
  })
  const harness = await createHarness(state)
  try {
    const healthBefore = await harness.context.tools.listSourceHealth()
    const outcome = await harness.context.tools.runVariflightResultShapeProbeOnce({
      args: ARGS,
      timeoutMs: 15_000,
      operationId: OPERATION_ID
    })

    assert.equal(outcome.ok, false)
    assert.equal(outcome.errorCode, 'MCP_TOOL_ERROR')
    assert.equal(outcome.callAttempts, 1)
    assert.equal(outcome.rawResponseRetained, false)
    assert.equal(JSON.stringify(outcome).includes(rawError), false)
    assert.deepEqual(
      { connects: state.connects, lists: state.lists, calls: state.calls, closes: state.closes },
      { connects: 1, lists: 1, calls: 1, closes: 1 }
    )
    assert.deepEqual(await harness.context.tools.listSourceHealth(), healthBefore)
    assert.deepEqual(harness.context.tools.listToolCalls(undefined), [])
    assert.deepEqual(harness.context.tools.listEvidence('fixture-session'), [])
  } finally {
    await harness.stop()
  }
})

test('ToolRegistry result probe reports a close failure without retry or persistence', async () => {
  const state = createState({ content: [{ type: 'text', text: '{"ok":true}' }] })
  state.closeError = new Error('synthetic close failure')
  const harness = await createHarness(state)
  try {
    const outcome = await harness.context.tools.runVariflightResultShapeProbeOnce({
      args: ARGS,
      timeoutMs: 15_000,
      operationId: OPERATION_ID
    })

    assert.equal(outcome.ok, false)
    assert.equal(outcome.stage, 'close')
    assert.equal(outcome.errorCode, 'MCP_PROTOCOL_ERROR')
    assert.equal(outcome.callAttempts, 1)
    assert.deepEqual(
      { connects: state.connects, lists: state.lists, calls: state.calls, closes: state.closes },
      { connects: 1, lists: 1, calls: 1, closes: 1 }
    )
    assert.deepEqual(harness.context.tools.listToolCalls(undefined), [])
    assert.deepEqual(harness.context.tools.listEvidence('fixture-session'), [])
  } finally {
    await harness.stop()
  }
})

test('Gate R-2 runner consumes authorization before a timeout and cannot replay it', async () => {
  const state = createState({ content: [{ type: 'text', text: '{}' }] })
  state.callError = new AppError('MCP_TIMEOUT', 'synthetic timeout fixture')
  const harness = await createHarness(state)
  const artifactPath = join(harness.root, 'gate-r2-preview.json')
  const preview = createVariflightGateR2Preview({
    args: ARGS,
    now: new Date('2026-09-01T08:00:00.000Z'),
    planId: PLAN_ID,
    operationId: OPERATION_ID
  })
  await writeFile(artifactPath, `${JSON.stringify(preview, null, 2)}\n`, 'utf8')
  try {
    const authorization = await claimVariflightGateR2(
      artifactPath,
      { planId: PLAN_ID, digest: preview.digest, operationId: OPERATION_ID },
      { allowedRoot: harness.root, now: new Date('2026-09-01T08:01:00.000Z') }
    )
    const outcome = await runVariflightResultProbeOnce(
      harness.context.tools,
      authorization,
      new Date('2026-09-01T08:01:01.000Z')
    )
    assert.equal(outcome.ok, false)
    assert.equal(outcome.errorCode, 'MCP_TIMEOUT')
    assert.equal(outcome.toolCallAttempts, 1)
    assert.equal(outcome.retryCount, 0)
    assert.equal(outcome.productionAllowlistMutations, 0)
    assert.deepEqual(
      { connects: state.connects, lists: state.lists, calls: state.calls, closes: state.closes },
      { connects: 1, lists: 1, calls: 1, closes: 1 }
    )
    assert.deepEqual(harness.context.tools.listToolCalls(undefined), [])
    assert.deepEqual(harness.context.tools.listEvidence('fixture-session'), [])
    assert.match(SOURCE_DEFINITIONS.SRC_FLIGHT.manualAlternative, /人工航班证据/)

    await assert.rejects(
      runVariflightResultProbeOnce(
        harness.context.tools,
        authorization,
        new Date('2026-09-01T08:01:02.000Z')
      ),
      isAppError('GATE_BLOCKED')
    )
    assert.equal(state.calls, 1)
  } finally {
    await harness.stop()
  }
})

test('Gate R-2 runner rejects missing authorization before touching ToolRegistry', async () => {
  let calls = 0
  await assert.rejects(
    runVariflightResultProbeOnce(
      {
        async runVariflightResultShapeProbeOnce() {
          calls += 1
          throw new Error('must not run')
        }
      },
      {} as never,
      new Date('2026-09-01T08:01:00.000Z')
    ),
    isAppError('GATE_BLOCKED')
  )
  assert.equal(calls, 0)
})

function createState(response: unknown): ProbeState {
  return {
    connects: 0,
    lists: 0,
    calls: 0,
    closes: 0,
    descriptors: [structuredClone(STRICT_DESCRIPTOR)],
    response
  }
}

async function createHarness(state: ProbeState): Promise<ProbeHarness> {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-variflight-result-'))
  const paths = createAppPaths(root)
  const database = await openFixtureDatabase(paths.database)
  const sourceConfigStore = new SourceConfigStore(paths.sourceConfig)
  await sourceConfigStore.save({ version: 1, searchModel: null })
  const createSession: SourceSessionFactory = ({ sourceId }) => {
    assert.equal(sourceId, 'SRC_FLIGHT')
    const session: SourceSession = {
      async connect(timeoutMs) {
        assert.equal(timeoutMs, 15_000)
        state.connects += 1
      },
      async listTools(timeoutMs) {
        assert.equal(timeoutMs, 15_000)
        state.lists += 1
        return structuredClone(state.descriptors)
      },
      async callTool(name, args, timeoutMs) {
        state.calls += 1
        state.received = { name, args: structuredClone(args), timeoutMs }
        if (state.callError) throw state.callError
        return structuredClone(state.response)
      },
      async close() {
        state.closes += 1
        if (state.closeError) throw state.closeError
      }
    }
    return session
  }

  const context = new Context()
  context.plugin(eventLogPlugin, { paths })
  context.plugin(travelStatePlugin, { database, paths })
  context.plugin(policyPlugin)
  context.plugin(toolsPlugin, {
    database,
    paths,
    sourceConfigStore,
    readCredential: async () => 'fixture-credential',
    createSession,
    now: () => new Date('2026-09-01T08:01:00.000Z'),
    sleep: async () => undefined
  })
  await context.start()

  let stopped = false
  return {
    root,
    paths,
    context,
    database,
    async stop() {
      if (stopped) return
      stopped = true
      await context.tools.close()
      await context.eventLog.close()
      database.close()
      await context.stop()
      await rm(root, { recursive: true, force: true })
    }
  }
}

async function openFixtureDatabase(path: string): Promise<Database.Database> {
  const database = new Database(path)
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
