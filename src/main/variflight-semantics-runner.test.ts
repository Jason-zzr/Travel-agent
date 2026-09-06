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
  claimVariflightGateR3,
  createVariflightGateR3Preview
} from './probes/variflight-semantics-gate'
import { runVariflightSemanticProbeOnce } from './probes/variflight-semantics-once'
import { SourceConfigStore } from './source-config-store'

const PLAN_ID = '33333333-3333-4333-8333-333333333333'
const OPERATION_ID = '44444444-4444-4444-8444-444444444444'
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
      dep_city: { type: 'string', pattern: '^[A-Z]{3}$' },
      arr_city: { type: 'string', pattern: '^[A-Z]{3}$' },
      dep_date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
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
  connectError?: AppError
  listError?: AppError
  callError?: AppError
  closeError?: Error
  received?: { name: string; args: Record<string, unknown>; timeoutMs: number }
}

interface ProbeHarness {
  root: string
  paths: AppPaths
  context: Context
  database: Database.Database
  stop(): Promise<void>
}

test('ToolRegistry semantic probe classifies one bounded result without retaining values', async () => {
  const state = createState(successEnvelope())
  const harness = await createHarness(state)
  try {
    const healthBefore = await harness.context.tools.listSourceHealth()
    const outcome = await harness.context.tools.runVariflightSemanticProbeOnce({
      args: ARGS,
      timeoutMs: 15_000,
      operationId: OPERATION_ID
    })

    assert.equal(outcome.ok, true)
    assert.equal(outcome.stage, 'classify')
    assert.equal(outcome.resultSchema, 'VALID')
    assert.equal(outcome.contractStatus, 'UNPROVEN')
    assert.equal(outcome.summary?.classificationStatus, 'FORMAT_AND_CONSISTENCY_ONLY')
    assert.equal(outcome.summary?.requestBinding.departureCity.status, 'CONSISTENCY_PROVEN')
    assert.equal(outcome.rawResponseRetained, false)
    assert.equal(outcome.valueRetention, false)
    assert.deepEqual(counts(state), { connects: 1, lists: 1, calls: 1, closes: 1 })
    assert.deepEqual(state.received, {
      name: VARIFLIGHT_FLIGHT_PRICE_TOOL_NAME,
      args: ARGS,
      timeoutMs: 15_000
    })
    const serialized = JSON.stringify(outcome)
    for (const rawValue of ['JHG', 'CAN', '2026-09-17', 'AQ1042', '589', 'fixture-request']) {
      assert.equal(serialized.includes(rawValue), false)
    }
    assert.deepEqual(await harness.context.tools.listSourceHealth(), healthBefore)
    assert.deepEqual(harness.context.tools.listToolCalls(undefined), [])
    assert.deepEqual(harness.context.tools.listEvidence('fixture-session'), [])
    assertProductionRegistrationEmpty()
  } finally {
    await harness.stop()
  }
})

test('ToolRegistry semantic probe rejects descriptor drift before a tool call', async () => {
  const state = createState(successEnvelope())
  state.descriptors = [
    {
      ...STRICT_DESCRIPTOR,
      inputSchema: { ...(STRICT_DESCRIPTOR.inputSchema as object), additionalProperties: true }
    }
  ]
  const harness = await createHarness(state)
  try {
    const outcome = await harness.context.tools.runVariflightSemanticProbeOnce({
      args: ARGS,
      timeoutMs: 15_000,
      operationId: OPERATION_ID
    })
    assert.equal(outcome.ok, false)
    assert.equal(outcome.errorCode, 'SOURCE_DRIFT')
    assert.equal(outcome.summary, null)
    assert.deepEqual(counts(state), { connects: 1, lists: 1, calls: 0, closes: 1 })
  } finally {
    await harness.stop()
  }
})

test('ToolRegistry semantic probe closes once on connect and discovery failures', async () => {
  const cases: Array<{
    state: ProbeState
    code: string
    expected: ReturnType<typeof counts>
  }> = [
    {
      state: Object.assign(createState(successEnvelope()), {
        connectError: new AppError('MCP_PROTOCOL_ERROR', 'connect-sensitive')
      }),
      code: 'MCP_PROTOCOL_ERROR',
      expected: { connects: 1, lists: 0, calls: 0, closes: 1 }
    },
    {
      state: Object.assign(createState(successEnvelope()), {
        listError: new AppError('MCP_TIMEOUT', 'list-sensitive')
      }),
      code: 'MCP_TIMEOUT',
      expected: { connects: 1, lists: 1, calls: 0, closes: 1 }
    }
  ]
  for (const failure of cases) {
    const harness = await createHarness(failure.state)
    try {
      const healthBefore = await harness.context.tools.listSourceHealth()
      const outcome = await harness.context.tools.runVariflightSemanticProbeOnce({
        args: ARGS,
        timeoutMs: 15_000,
        operationId: OPERATION_ID
      })
      assert.equal(outcome.ok, false)
      assert.equal(outcome.errorCode, failure.code)
      assert.equal(outcome.callAttempts, 0)
      assert.equal(outcome.summary, null)
      assert.equal(JSON.stringify(outcome).includes('sensitive'), false)
      assert.deepEqual(counts(failure.state), failure.expected)
      assert.deepEqual(await harness.context.tools.listSourceHealth(), healthBefore)
      assert.deepEqual(harness.context.tools.listToolCalls(undefined), [])
      assert.deepEqual(harness.context.tools.listEvidence('fixture-session'), [])
    } finally {
      await harness.stop()
    }
  }
})

test('ToolRegistry semantic probe rejects response/envelope drift without retaining payloads', async () => {
  const driftCases: Array<{ marker: string; response: unknown }> = [
    {
      marker: 'non-json-sensitive',
      response: { content: [{ type: 'text', text: 'non-json-sensitive' }] }
    },
    {
      marker: 'unknown-key-sensitive',
      response: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ ...successPayload(), unknown_key: 'unknown-key-sensitive' })
          }
        ]
      }
    },
    {
      marker: 'type-drift-sensitive',
      response: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ ...successPayload(), code: 'type-drift-sensitive' })
          }
        ]
      }
    },
    {
      marker: 'structured-sensitive',
      response: {
        content: [{ type: 'text', text: JSON.stringify(successPayload()) }],
        structuredContent: { leaked: 'structured-sensitive' }
      }
    }
  ]

  for (const drift of driftCases) {
    const state = createState(drift.response)
    const harness = await createHarness(state)
    try {
      const outcome = await harness.context.tools.runVariflightSemanticProbeOnce({
        args: ARGS,
        timeoutMs: 15_000,
        operationId: OPERATION_ID
      })
      assert.equal(outcome.ok, false)
      assert.equal(outcome.errorCode, 'SOURCE_DRIFT')
      assert.equal(outcome.resultSchema, 'INVALID')
      assert.equal(outcome.summary, null)
      assert.equal(JSON.stringify(outcome).includes(drift.marker), false)
      assert.deepEqual(counts(state), { connects: 1, lists: 1, calls: 1, closes: 1 })
    } finally {
      await harness.stop()
    }
  }
})

test('ToolRegistry semantic probe keeps tool errors and timeouts value-free with zero mutation', async () => {
  for (const errorCase of [
    {
      state: createState({
        content: [{ type: 'text', text: 'provider-error-sensitive JHG CAN 589' }],
        isError: true
      }),
      code: 'MCP_TOOL_ERROR'
    },
    {
      state: Object.assign(createState(successEnvelope()), {
        callError: new AppError('MCP_TIMEOUT', 'timeout-sensitive JHG CAN 589')
      }),
      code: 'MCP_TIMEOUT'
    }
  ]) {
    const harness = await createHarness(errorCase.state)
    try {
      const healthBefore = await harness.context.tools.listSourceHealth()
      const outcome = await harness.context.tools.runVariflightSemanticProbeOnce({
        args: ARGS,
        timeoutMs: 15_000,
        operationId: OPERATION_ID
      })
      assert.equal(outcome.ok, false)
      assert.equal(outcome.errorCode, errorCase.code)
      assert.equal(outcome.summary, null)
      assert.equal(JSON.stringify(outcome).includes('sensitive'), false)
      assert.deepEqual(counts(errorCase.state), { connects: 1, lists: 1, calls: 1, closes: 1 })
      assert.deepEqual(await harness.context.tools.listSourceHealth(), healthBefore)
      assert.deepEqual(harness.context.tools.listToolCalls(undefined), [])
      assert.deepEqual(harness.context.tools.listEvidence('fixture-session'), [])
      assertProductionRegistrationEmpty()
    } finally {
      await harness.stop()
    }
  }
})

test('ToolRegistry semantic probe reports close failure without retry or persistence', async () => {
  const state = createState(successEnvelope())
  state.closeError = new Error('close-sensitive')
  const harness = await createHarness(state)
  try {
    const outcome = await harness.context.tools.runVariflightSemanticProbeOnce({
      args: ARGS,
      timeoutMs: 15_000,
      operationId: OPERATION_ID
    })
    assert.equal(outcome.ok, false)
    assert.equal(outcome.stage, 'close')
    assert.equal(outcome.errorCode, 'MCP_PROTOCOL_ERROR')
    assert.equal(outcome.summary, null)
    assert.deepEqual(counts(state), { connects: 1, lists: 1, calls: 1, closes: 1 })
    assert.deepEqual(harness.context.tools.listToolCalls(undefined), [])
    assert.deepEqual(harness.context.tools.listEvidence('fixture-session'), [])
  } finally {
    await harness.stop()
  }
})

test('Gate R-3 runner consumes authorization before timeout and cannot replay', async () => {
  const state = createState(successEnvelope())
  state.callError = new AppError('MCP_TIMEOUT', 'timeout-sensitive')
  const harness = await createHarness(state)
  const artifactPath = join(harness.root, 'gate-r3-preview.json')
  const preview = createVariflightGateR3Preview({
    args: ARGS,
    now: new Date('2026-09-01T08:00:00.000Z'),
    planId: PLAN_ID,
    operationId: OPERATION_ID
  })
  await writeFile(artifactPath, `${JSON.stringify(preview, null, 2)}\n`, 'utf8')
  try {
    const authorization = await claimVariflightGateR3(
      artifactPath,
      { planId: PLAN_ID, digest: preview.digest, operationId: OPERATION_ID },
      { allowedRoot: harness.root, now: new Date('2026-09-01T08:01:00.000Z') }
    )
    const outcome = await runVariflightSemanticProbeOnce(
      harness.context.tools,
      authorization,
      new Date('2026-09-01T08:01:01.000Z')
    )
    assert.equal(outcome.ok, false)
    assert.equal(outcome.errorCode, 'MCP_TIMEOUT')
    assert.equal(outcome.toolCallAttempts, 1)
    assert.equal(outcome.retryCount, 0)
    assert.equal(outcome.productionAllowlistMutations, 0)
    await assert.rejects(
      runVariflightSemanticProbeOnce(
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

test('Gate R-3 runner rejects missing authorization before touching ToolRegistry', async () => {
  let calls = 0
  await assert.rejects(
    runVariflightSemanticProbeOnce(
      {
        async runVariflightSemanticProbeOnce() {
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

function successEnvelope(): unknown {
  return { content: [{ type: 'text', text: JSON.stringify(successPayload()) }] }
}

function successPayload(): Record<string, unknown> {
  return {
    code: 0,
    message: 'fixture-provider-message',
    request_id: 'fixture-request',
    timestamp: '2026-09-01T08:01:00+08:00',
    data: [
      {
        depcitycode: 'JHG',
        arrcitycode: 'CAN',
        depdate: '2026-09-17',
        arrdate: '2026-09-17',
        flightno: 'AQ1042',
        flightdeptimeplandate: 1_789_609_500_000,
        flightarrtimeplandate: 1_789_618_500_000,
        stopflag: 0,
        shareflag: 0,
        oilfee: '50',
        tax: '0',
        cabins: [{ cabinclass: 'Y', price: 589, stprice: 700, seatnum: 5, discount: 0.84 }]
      }
    ]
  }
}

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

function counts(state: ProbeState): Pick<ProbeState, 'connects' | 'lists' | 'calls' | 'closes'> {
  return {
    connects: state.connects,
    lists: state.lists,
    calls: state.calls,
    closes: state.closes
  }
}

function assertProductionRegistrationEmpty(): void {
  assert.deepEqual([...SOURCE_DEFINITIONS.SRC_FLIGHT.allowlist], [])
  assert.deepEqual(Object.keys(SOURCE_DEFINITIONS.SRC_FLIGHT.tools), [])
  assert.equal(SOURCE_DEFINITIONS.SRC_FLIGHT.probeTool, null)
  assert.equal(SOURCE_DEFINITIONS.SRC_FLIGHT.discoveryOnly, true)
}

async function createHarness(state: ProbeState): Promise<ProbeHarness> {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-variflight-semantics-'))
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
        if (state.connectError) throw state.connectError
      },
      async listTools(timeoutMs) {
        assert.equal(timeoutMs, 15_000)
        state.lists += 1
        if (state.listError) throw state.listError
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
