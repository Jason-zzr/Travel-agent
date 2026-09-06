import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { Context } from 'cordis'
import type { Progress } from '@modelcontextprotocol/client'
import { AppError } from '../shared/errors'
import { XhsLoginQrRequestSchema } from '../shared/ipc-contract'
import { EvidenceClaimSchema } from '../shared/schema/evidence'
import { DeepSeekSearchResultSchema } from '../shared/schema/mcp/search'
import {
  XHS_LOGIN_QR_MAX_DECODED_BYTES,
  XhsLoginQrMcpResultSchema
} from '../shared/schema/mcp/xiaohongshu'
import type { SearchStreamPayload } from '../shared/schema/mcp/search'
import type { ExternalSourceId } from '../shared/schema/source'
import { applyMigrations } from './db/migrate'
import { SourceRepository } from './db/source-repository'
import type { McpToolDescriptor, SourceSession } from './mcp/client'
import { classifyAmapBusinessError } from './mcp/amap-error-classifier'
import { PoiCacheStore } from './mcp/poi-cache'
import { SOURCE_DEFINITIONS } from './mcp/source-catalog'
import { createAppPaths, type AppPaths } from './paths'
import { runHotelAcceptanceOnce } from './probes/hotel-once'
import { runSearchAcceptanceOnce } from './probes/search-once'
import { eventLogPlugin } from './plugins/event-log'
import { PolicyService, policyPlugin } from './plugins/policy'
import {
  gateDiscoveredTools,
  toolsPlugin,
  type SourceSessionFactory
} from './plugins/tool-registry'
import { travelStatePlugin } from './plugins/travel-state'
import { SourceConfigStore } from './source-config-store'

type SourceMode = 'healthy' | 'network' | 'call-network' | 'drift' | 'slow'

interface FixtureState {
  modes: Record<ExternalSourceId, SourceMode>
  calls: Record<ExternalSourceId, number>
  connects: Record<ExternalSourceId, number>
  closes: Record<ExternalSourceId, number>
  mapText?: string
  mapIsError?: boolean
  hotelText?: string
  hotelArgs?: Record<string, unknown>
  searchArgs?: Record<string, unknown>
  searchResult?: unknown
  xhsLoginText?: string
  xhsQrResult?: unknown
  xhsCalls: Array<{ name: string; args: Record<string, unknown> }>
  xhsAuthValues: Array<string | undefined>
  flightTools?: McpToolDescriptor[]
  signalCallStarted?: () => void
  rejectSlowCall?: (error: Error) => void
}

interface D3Harness {
  context: Context
  database: Database.Database
  paths: AppPaths
  stop(): Promise<void>
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

function fixtureState(): FixtureState {
  return {
    modes: {
      SRC_RAIL: 'healthy',
      SRC_MAP: 'healthy',
      SRC_HOTEL: 'healthy',
      SRC_SEARCH: 'healthy',
      SRC_XHS: 'healthy',
      SRC_FLIGHT: 'healthy'
    },
    calls: {
      SRC_RAIL: 0,
      SRC_MAP: 0,
      SRC_HOTEL: 0,
      SRC_SEARCH: 0,
      SRC_XHS: 0,
      SRC_FLIGHT: 0
    },
    connects: {
      SRC_RAIL: 0,
      SRC_MAP: 0,
      SRC_HOTEL: 0,
      SRC_SEARCH: 0,
      SRC_XHS: 0,
      SRC_FLIGHT: 0
    },
    closes: {
      SRC_RAIL: 0,
      SRC_MAP: 0,
      SRC_HOTEL: 0,
      SRC_SEARCH: 0,
      SRC_XHS: 0,
      SRC_FLIGHT: 0
    },
    xhsCalls: [],
    xhsAuthValues: []
  }
}

function fixtureFactory(state: FixtureState): SourceSessionFactory {
  return ({ sourceId, credentials }) => {
    if (sourceId === 'SRC_XHS') {
      state.xhsAuthValues.push(credentials.XIAOHONGSHU_MCP_AUTH)
    }
    return new FixtureSession(sourceId, state)
  }
}

class FixtureSession implements SourceSession {
  constructor(
    private readonly sourceId: ExternalSourceId,
    private readonly state: FixtureState
  ) {}

  connect(): Promise<void> {
    this.state.connects[this.sourceId] += 1
    if (this.state.modes[this.sourceId] === 'network') {
      throw new AppError('SOURCE_UNREACHABLE', 'fixture unavailable')
    }
    return Promise.resolve()
  }

  listTools(): Promise<McpToolDescriptor[]> {
    if (this.sourceId === 'SRC_FLIGHT' && this.state.flightTools) {
      return Promise.resolve(this.state.flightTools)
    }
    return Promise.resolve(
      Object.keys(SOURCE_DEFINITIONS[this.sourceId].tools).map((name) => ({
        name,
        description: `fixture read-only ${name}`,
        inputSchema: { type: 'object' }
      }))
    )
  }

  callTool(
    name: string,
    args: Record<string, unknown>,
    _timeoutMs: number,
    onProgress?: (progress: Progress) => void
  ): Promise<unknown> {
    this.state.calls[this.sourceId] += 1
    if (this.state.modes[this.sourceId] === 'call-network') {
      throw new AppError('SOURCE_UNREACHABLE', 'fixture call unavailable')
    }
    if (this.sourceId === 'SRC_RAIL') {
      if (this.state.modes.SRC_RAIL === 'slow') {
        this.state.signalCallStarted?.()
        return new Promise((_, reject) => {
          this.state.rejectSlowCall = reject
        })
      }
      if (name === 'get-tickets') {
        const ticket =
          this.state.modes.SRC_RAIL === 'drift'
            ? { train_no: 'G1', start_time: '08:00' }
            : { train_no: 'G1', start_time: '08:00', arrive_time: '09:00' }
        return Promise.resolve({ content: [{ type: 'text', text: JSON.stringify([ticket]) }] })
      }
      return Promise.resolve({ content: [{ type: 'text', text: '2026-08-22' }] })
    }
    if (this.sourceId === 'SRC_MAP') {
      const value =
        this.state.modes.SRC_MAP === 'drift'
          ? { results: [{ location: '104.06' }] }
          : { results: [{ location: '104.06,30.67' }] }
      return Promise.resolve({
        content: [{ type: 'text', text: this.state.mapText ?? JSON.stringify(value) }],
        isError: this.state.mapIsError
      })
    }
    if (this.sourceId === 'SRC_HOTEL') {
      this.state.hotelArgs = args
      return Promise.resolve({
        content: [
          {
            type: 'text',
            text:
              this.state.hotelText ??
              JSON.stringify({
                message: 'fixture hotels',
                hotelInformationList: [
                  {
                    hotelId: 'hotel-1',
                    name: '本地夹具酒店',
                    address: '成都',
                    starRating: 4,
                    price: { hasPrice: true, currency: 'CNY', lowestPrice: 520 }
                  }
                ]
              })
          }
        ]
      })
    }
    if (this.sourceId === 'SRC_XHS') {
      this.state.xhsCalls.push({ name, args })
      if (name === 'check_login_status') {
        return Promise.resolve({
          content: [{ type: 'text', text: this.state.xhsLoginText ?? '✅ 已登录\nfixture-user' }]
        })
      }
      if (name === 'get_login_qrcode') {
        return Promise.resolve(
          this.state.xhsQrResult ?? {
            content: [
              { type: 'text', text: '请在五分钟内扫码登录。' },
              {
                type: 'image',
                data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
                mimeType: 'image/png'
              }
            ]
          }
        )
      }
      if (name === 'search_feeds') {
        return Promise.resolve({
          content: [
            {
              type: 'text',
              text: JSON.stringify([
                {
                  id: 'note0001',
                  xsecToken: 'transient-xhs-token',
                  modelType: 'note',
                  noteCard: {
                    type: 'normal',
                    displayTitle: '成都本地夹具',
                    user: { userId: 'fixture-user', nickname: '夹具作者' }
                  }
                }
              ])
            }
          ]
        })
      }
      if (name === 'get_feed_detail') {
        return Promise.resolve({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                note: {
                  noteId: String(args.feed_id),
                  title: '成都本地夹具详情',
                  desc: '只读详情',
                  type: 'normal',
                  user: { nickname: '夹具作者' }
                }
              })
            }
          ]
        })
      }
      throw new Error(`Unexpected Xiaohongshu tool ${name}`)
    }
    if (name !== 'deepseek_web_search') throw new Error(`Unexpected search tool ${name}`)
    this.state.searchArgs = args
    const defaultSources = [
      {
        url: 'https://example.gov.cn/travel',
        title: '官方夹具',
        snippet: '公开信息摘要'
      }
    ]
    const searchResult = this.state.searchResult ?? {
      ok: true,
      answer: 'fixture public result',
      model: 'deepseek-v4-flash',
      search_provider: 'serper-search',
      sources: defaultSources,
      usage: {
        input_tokens: 120,
        output_tokens: 20,
        cached_input_tokens: 0,
        reasoning_tokens: 5,
        total_tokens: 140
      },
      audit: {
        search_api_calls: 1,
        search_result_count: 1,
        grounding_characters: 300,
        native_web_search_calls: 0,
        native_open_page_calls: 0,
        open_page_tokens: 0
      },
      error_code: null,
      message: null
    }
    const progressResult = searchResult as {
      ok?: unknown
      answer?: unknown
      sources?: unknown
      usage?: unknown
      audit?: unknown
    }
    onProgress?.({
      progress: 10,
      total: 100,
      message: JSON.stringify({ kind: 'SEARCH_STARTED' })
    })
    const progressSources = Array.isArray(progressResult.sources)
      ? progressResult.sources
      : defaultSources
    onProgress?.({
      progress: 30,
      total: 100,
      message: JSON.stringify({ kind: 'SEARCH_RESULTS', sources: progressSources })
    })
    if (progressResult.ok === true && typeof progressResult.answer === 'string') {
      onProgress?.({
        progress: 60,
        total: 100,
        message: JSON.stringify({ kind: 'ANSWER_DELTA', delta: progressResult.answer })
      })
      onProgress?.({
        progress: 100,
        total: 100,
        message: JSON.stringify({
          kind: 'USAGE',
          usage: progressResult.usage,
          audit: progressResult.audit
        })
      })
    }
    return Promise.resolve({
      content: [
        {
          type: 'text',
          text: JSON.stringify(searchResult)
        }
      ]
    })
  }

  close(): Promise<void> {
    this.state.closes[this.sourceId] += 1
    this.state.rejectSlowCall?.(new Error('fixture transport closed'))
    this.state.rejectSlowCall = undefined
    return Promise.resolve()
  }
}

async function createHarness(input: {
  root: string
  fixtures: FixtureState
  now: { value: string }
  logs?: string[]
  amapLbsQuota?: number
  readCredential?: (id: string) => Promise<string | undefined>
}): Promise<D3Harness> {
  const paths = createAppPaths(input.root)
  const database = await openFixtureDatabase(paths.database)
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
    readCredential: input.readCredential ?? (async () => 'fixture-credential'),
    createSession: fixtureFactory(input.fixtures),
    now: () => new Date(input.now.value),
    sleep: async () => undefined,
    amapQuotas: input.amapLbsQuota ? { AMAP_LBS: input.amapLbsQuota } : undefined,
    log: (code) => input.logs?.push(code)
  })
  await context.start()
  let stopped = false
  return {
    context,
    database,
    paths,
    async stop() {
      if (stopped) return
      stopped = true
      await context.tools.close()
      await context.eventLog.close()
      database.close()
      await context.stop()
    }
  }
}

async function createSession(context: Context, sessionId: string): Promise<void> {
  await context.travelState.record({
    sessionId,
    type: 'session/created',
    payload: { title: 'D3 fixture' }
  })
}

test('VariFlight descriptor discovery lists tools without calls, registration, or persistence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-variflight-discovery-'))
  const fixtures = fixtureState()
  fixtures.flightTools = [
    {
      name: 'searchFlightItineraries',
      description: 'fixture read-only flight search',
      inputSchema: {
        type: 'object',
        properties: {
          depCityCode: { type: 'string' },
          arrCityCode: { type: 'string' },
          depDate: { type: 'string' }
        }
      }
    }
  ]
  let harness: D3Harness | undefined
  try {
    harness = await createHarness({
      root,
      fixtures,
      now: { value: '2026-09-01T07:00:00.000Z' }
    })
    assert.deepEqual(
      await harness.context.tools.discoverSourceDescriptorsOnce('SRC_FLIGHT', 15_000),
      fixtures.flightTools
    )
    fixtures.flightTools = Array.from({ length: 65 }, (_, index) => ({
      name: `fixtureFlightTool${index}`,
      description: 'bounded discovery fixture',
      inputSchema: { type: 'object' }
    }))
    await assert.rejects(
      () => harness!.context.tools.discoverSourceDescriptorsOnce('SRC_FLIGHT', 15_000),
      (error) => error instanceof AppError && error.code === 'MCP_PROTOCOL_ERROR'
    )
    assert.equal(fixtures.connects.SRC_FLIGHT, 2)
    assert.equal(fixtures.calls.SRC_FLIGHT, 0)
    assert.equal(fixtures.closes.SRC_FLIGHT, 2)
    assert.equal(harness.context.tools.listBlockedTools().length, 0)
    assert.equal(harness.context.tools.listToolCalls(undefined).length, 0)
    assert.equal(
      (await harness.context.tools.listSourceHealth()).find(
        (entry) => entry.sourceId === 'SRC_FLIGHT'
      )?.status,
      'UNCONFIGURED'
    )
  } finally {
    await harness?.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('Xiaohongshu status uses app-owned auth and ignores the legacy stored token', async () => {
  const now = { value: '2026-08-27T02:00:00.000Z' }

  const noTokenRoot = await mkdtemp(join(tmpdir(), 'travel-harness-xhs-status-no-token-'))
  const noTokenFixtures = fixtureState()
  let noTokenHarness: D3Harness | undefined
  try {
    noTokenHarness = await createHarness({
      root: noTokenRoot,
      fixtures: noTokenFixtures,
      now,
      readCredential: async (id) =>
        id === 'XIAOHONGSHU_MCP_AUTH' ? undefined : 'fixture-credential'
    })
    assert.deepEqual(await noTokenHarness.context.tools.xhsConnectionStatus(), {
      connected: true,
      loggedIn: true,
      authTokenConfigured: true
    })
    assert.equal(noTokenFixtures.connects.SRC_XHS, 2)
    assert.equal(noTokenFixtures.calls.SRC_XHS, 1)
    assert.equal(noTokenFixtures.closes.SRC_XHS, 2)
    assert.deepEqual(noTokenFixtures.xhsAuthValues, [undefined, undefined])
    assert.deepEqual(noTokenFixtures.xhsCalls, [{ name: 'check_login_status', args: {} }])
  } finally {
    await noTokenHarness?.stop()
    await rm(noTokenRoot, { recursive: true, force: true })
  }

  const tokenRoot = await mkdtemp(join(tmpdir(), 'travel-harness-xhs-status-token-'))
  const tokenFixtures = fixtureState()
  tokenFixtures.xhsLoginText = '❌ 未登录\n请在伴随程序中登录'
  let tokenHarness: D3Harness | undefined
  try {
    tokenHarness = await createHarness({
      root: tokenRoot,
      fixtures: tokenFixtures,
      now,
      readCredential: async (id) =>
        id === 'XIAOHONGSHU_MCP_AUTH' ? 'fixture-xhs-auth' : 'fixture-credential'
    })
    assert.deepEqual(await tokenHarness.context.tools.xhsConnectionStatus(), {
      connected: true,
      loggedIn: false,
      authTokenConfigured: true
    })
    assert.deepEqual(tokenFixtures.xhsAuthValues, [undefined, undefined])
    assert.equal(tokenFixtures.closes.SRC_XHS, 2)
  } finally {
    await tokenHarness?.stop()
    await rm(tokenRoot, { recursive: true, force: true })
  }

  const unavailableRoot = await mkdtemp(join(tmpdir(), 'travel-harness-xhs-status-unavailable-'))
  const unavailableFixtures = fixtureState()
  unavailableFixtures.modes.SRC_XHS = 'network'
  let unavailableHarness: D3Harness | undefined
  try {
    unavailableHarness = await createHarness({
      root: unavailableRoot,
      fixtures: unavailableFixtures,
      now
    })
    await assert.rejects(
      () => unavailableHarness!.context.tools.xhsConnectionStatus(),
      (error) => error instanceof AppError && error.code === 'SOURCE_UNREACHABLE'
    )
    assert.equal(unavailableFixtures.connects.SRC_XHS, 1)
    assert.equal(unavailableFixtures.calls.SRC_XHS, 0)
    assert.equal(unavailableFixtures.closes.SRC_XHS, 1)
  } finally {
    await unavailableHarness?.stop()
    await rm(unavailableRoot, { recursive: true, force: true })
  }
})

test('Xiaohongshu login QR is one-shot, bounded and normalized without content calls', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-xhs-login-qr-'))
  const fixtures = fixtureState()
  const now = { value: '2026-09-04T12:00:00.000Z' }
  let harness: D3Harness | undefined
  try {
    harness = await createHarness({ root, fixtures, now })
    const result = await harness.context.tools.xhsLoginQr(
      60_000,
      '123e4567-e89b-42d3-a456-426614174000'
    )
    assert.equal(result.status, 'QR_REQUIRED')
    if (result.status !== 'QR_REQUIRED') assert.fail('expected Xiaohongshu QR response')
    assert.match(result.imageDataUrl, /^data:image\/png;base64,iVBORw0KGgo/)
    assert.equal(result.hint, '请在五分钟内扫码登录。')
    assert.equal(result.expiresAt, '2026-09-04T12:05:00.000Z')
    assert.deepEqual(fixtures.xhsCalls, [{ name: 'get_login_qrcode', args: {} }])
    assert.equal(fixtures.calls.SRC_XHS, 1)
    assert.equal(fixtures.connects.SRC_XHS, 2)
    assert.equal(fixtures.closes.SRC_XHS, 2)
    const persistedDatabase = Buffer.from(harness.database.serialize()).toString('utf8')
    assert.doesNotMatch(persistedDatabase, /iVBORw0KGgo/)
    assert.doesNotMatch(persistedDatabase, /请在五分钟内扫码登录/)
  } finally {
    await harness?.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('Xiaohongshu login QR maps the exact already-logged-in response without an image', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-xhs-already-logged-in-'))
  const fixtures = fixtureState()
  fixtures.xhsQrResult = {
    content: [{ type: 'text', text: '你当前已处于登录状态' }]
  }
  const now = { value: '2026-09-04T12:00:00.000Z' }
  let harness: D3Harness | undefined
  try {
    harness = await createHarness({ root, fixtures, now })
    assert.deepEqual(await harness.context.tools.xhsLoginQr(), {
      status: 'ALREADY_LOGGED_IN'
    })
  } finally {
    await harness?.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('Xiaohongshu QR schema rejects unsafe shapes and accepts reversed bounded blocks', () => {
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
  assert.equal(
    XhsLoginQrMcpResultSchema.safeParse({
      content: [
        { type: 'image', data: png, mimeType: 'image/png' },
        { type: 'text', text: '扫码登录' }
      ]
    }).success,
    true
  )
  assert.equal(
    XhsLoginQrMcpResultSchema.safeParse({
      content: [{ type: 'text', text: '你当前已处于登录状态' }]
    }).success,
    true
  )
  assert.equal(
    XhsLoginQrMcpResultSchema.safeParse({
      content: [{ type: 'text', text: '你当前已处于登录状态。' }]
    }).success,
    false
  )
  for (const unsafe of [
    {
      content: [
        { type: 'text', text: '扫码登录' },
        { type: 'image', data: png, mimeType: 'image/jpeg' }
      ]
    },
    {
      content: [
        { type: 'text', text: '扫码登录' },
        {
          type: 'image',
          data: Buffer.concat([
            Buffer.from('89504e470d0a1a0a', 'hex'),
            Buffer.alloc(XHS_LOGIN_QR_MAX_DECODED_BYTES)
          ]).toString('base64'),
          mimeType: 'image/png'
        }
      ]
    },
    {
      content: [
        { type: 'text', text: '扫码登录' },
        { type: 'image', data: png, mimeType: 'image/png' }
      ],
      structuredContent: {}
    }
  ]) {
    assert.equal(XhsLoginQrMcpResultSchema.safeParse(unsafe).success, false)
  }
  assert.equal(
    XhsLoginQrRequestSchema.safeParse({
      operationId: '123e4567-e89b-42d3-a456-426614174000',
      toolName: 'search_feeds'
    }).success,
    false
  )
})

test('four sources create replayable claims and one drift stales prior evidence immediately', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d3-evidence-'))
  const fixtures = fixtureState()
  const now = { value: '2026-08-22T08:00:00.000Z' }
  const logs: string[] = []
  let harness: D3Harness | undefined
  try {
    harness = await createHarness({ root, fixtures, now, logs })
    await createSession(harness.context, 'session-d3')
    await harness.context.tools.runRepresentativeQuery({
      sourceId: 'SRC_RAIL',
      sessionId: 'session-d3',
      input: {}
    })
    await harness.context.tools.runRepresentativeQuery({
      sourceId: 'SRC_MAP',
      sessionId: 'session-d3',
      input: { address: '天府广场', city: '成都' }
    })
    await harness.context.tools.runRepresentativeQuery({
      sourceId: 'SRC_HOTEL',
      sessionId: 'session-d3',
      input: { place: '成都', checkInDate: '2026-09-10', stayNights: 2, adultCount: 2 }
    })
    await harness.context.tools.runRepresentativeQuery({
      sourceId: 'SRC_SEARCH',
      sessionId: 'session-d3',
      input: { query: '成都官方旅游公告' }
    })
    assert.equal(harness.context.tools.listEvidence('session-d3').length, 4)
    const mapClaim = harness.context.tools
      .listEvidence('session-d3')
      .find((claim) => claim.sourceId === 'SRC_MAP')
    assert.equal(mapClaim?.subject, '天府广场')
    assert.deepEqual(mapClaim?.value, {
      city: '成都',
      address: '天府广场',
      lng: 104.06,
      lat: 30.67
    })

    fixtures.modes.SRC_RAIL = 'drift'
    await assert.rejects(
      () =>
        harness!.context.tools.invokeRail(
          'session-d3',
          'get-tickets',
          {
            date: '2026-09-10',
            fromStation: '成都东',
            toStation: '重庆北',
            format: 'json'
          },
          15_000
        ),
      (error) => error instanceof AppError && error.code === 'SOURCE_DRIFT'
    )
    const railHealth = (await harness.context.tools.listSourceHealth()).find(
      (item) => item.sourceId === 'SRC_RAIL'
    )!
    assert.equal(railHealth.status, 'DEGRADED')
    assert.equal(railHealth.failStreak, 0)
    assert.deepEqual(logs.slice(-2), ['SOURCE_DRIFT', 'SOURCE_ADAPTER_DEGRADED'])
    assert.equal(
      harness.context.tools
        .listEvidence('session-d3')
        .filter((claim) => claim.sourceId === 'SRC_RAIL')[0]!.verificationStatus,
      'STALE'
    )
    assert.equal(
      harness.context.tools.listToolCalls('session-d3').filter((call) => !call.ok).length,
      1
    )

    const attemptsAfterDrift = fixtures.calls.SRC_RAIL
    await assert.rejects(
      () =>
        harness!.context.tools.invokeRail(
          'session-d3',
          'get-tickets',
          {
            date: '2026-09-10',
            fromStation: '成都东',
            toStation: '重庆北',
            format: 'json'
          },
          15_000
        ),
      (error) => error instanceof AppError && error.code === 'SOURCE_ADAPTER_DEGRADED'
    )
    assert.equal(fixtures.calls.SRC_RAIL, attemptsAfterDrift)

    await harness.stop()
    harness = undefined
    await rm(createAppPaths(root).database, { force: true })
    const rebuilt = await createHarness({ root, fixtures, now, logs })
    harness = rebuilt
    await rebuilt.context.travelState.rebuildAll()
    const claims = rebuilt.context.tools.listEvidence('session-d3')
    assert.equal(claims.length, 4)
    assert.equal(claims.find((claim) => claim.sourceId === 'SRC_RAIL')?.verificationStatus, 'STALE')
  } finally {
    await harness?.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('two exhausted discovery failures degrade once per probe and then fast-fail', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d3-health-'))
  const fixtures = fixtureState()
  fixtures.modes.SRC_RAIL = 'network'
  const now = { value: '2026-08-22T09:00:00.000Z' }
  let harness: D3Harness | undefined
  try {
    harness = await createHarness({ root, fixtures, now })
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await assert.rejects(() => harness!.context.tools.probe('SRC_RAIL'), AppError)
    }
    const health = (await harness.context.tools.listSourceHealth()).find(
      (item) => item.sourceId === 'SRC_RAIL'
    )!
    assert.equal(health.status, 'DEGRADED')
    assert.equal(health.failStreak, 2)
    assert.equal(fixtures.connects.SRC_RAIL, 4)
    assert.equal(fixtures.closes.SRC_RAIL, 4)
    await assert.rejects(
      () => harness!.context.tools.probe('SRC_RAIL'),
      (error) => error instanceof AppError && error.code === 'SOURCE_ADAPTER_DEGRADED'
    )
    assert.equal(fixtures.connects.SRC_RAIL, 4)
  } finally {
    await harness?.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('live acceptance validates one call without retry, audit, cache, or evidence persistence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d3-live-acceptance-'))
  const fixtures = fixtureState()
  const now = { value: '2026-08-22T09:30:00.000Z' }
  let harness: D3Harness | undefined
  try {
    harness = await createHarness({ root, fixtures, now })
    const success = await harness.context.tools.runLiveAcceptanceOnce({
      sourceId: 'SRC_MAP',
      toolName: 'maps_geo',
      args: { address: '上海市人民广场', city: '上海' },
      timeoutMs: 15_000
    })
    assert.deepEqual(success, {
      ok: true,
      source: 'SRC_MAP',
      tool: 'maps_geo',
      stage: 'validate',
      discovered: true,
      resultSchema: 'VALID',
      callAttempts: 1,
      errorCode: null,
      rawResponseRetained: false
    })
    assert.equal(fixtures.connects.SRC_MAP, 1)
    assert.equal(fixtures.calls.SRC_MAP, 1)
    assert.equal(fixtures.closes.SRC_MAP, 1)
    assert.equal(harness.context.tools.listToolCalls(undefined).length, 0)
    assert.equal(harness.context.tools.listEvidence('acceptance-only').length, 0)

    fixtures.modes.SRC_MAP = 'drift'
    const drift = await harness.context.tools.runLiveAcceptanceOnce({
      sourceId: 'SRC_MAP',
      toolName: 'maps_geo',
      args: { address: '上海市人民广场', city: '上海' },
      timeoutMs: 15_000
    })
    assert.equal(drift.ok, false)
    assert.equal(drift.stage, 'validate')
    assert.equal(drift.callAttempts, 1)
    assert.equal(drift.errorCode, 'SOURCE_DRIFT')
    assert.equal(fixtures.connects.SRC_MAP, 2)
    assert.equal(fixtures.calls.SRC_MAP, 2)
    assert.equal(fixtures.closes.SRC_MAP, 2)

    fixtures.modes.SRC_MAP = 'call-network'
    const failed = await harness.context.tools.runLiveAcceptanceOnce({
      sourceId: 'SRC_MAP',
      toolName: 'maps_geo',
      args: { address: '上海市人民广场', city: '上海' },
      timeoutMs: 15_000
    })
    assert.equal(failed.ok, false)
    assert.equal(failed.stage, 'call')
    assert.equal(failed.callAttempts, 1)
    assert.equal(failed.errorCode, 'SOURCE_UNREACHABLE')
    assert.equal(fixtures.connects.SRC_MAP, 3)
    assert.equal(fixtures.calls.SRC_MAP, 3)
    assert.equal(fixtures.closes.SRC_MAP, 3)
    assert.equal(harness.context.tools.listToolCalls(undefined).length, 0)
    assert.equal(harness.context.tools.listEvidence('acceptance-only').length, 0)

    fixtures.hotelText = JSON.stringify({
      message: 'private fixture message',
      hotelInformationList: [
        {
          hotelId: 'private-hotel-1',
          name: 'private hotel alpha',
          address: 'private address alpha',
          price: { hasPrice: true, currency: 'CNY', lowestPrice: 500 }
        },
        {
          hotelId: 'private-hotel-2',
          name: 'private hotel beta',
          address: 'private address beta',
          price: { hasPrice: true, currency: 'private currency', lowestPrice: 800 }
        },
        {
          hotelId: 'private-hotel-3',
          name: 'private hotel gamma',
          address: 'private address gamma',
          price: { hasPrice: false, currency: null, lowestPrice: null }
        }
      ]
    })
    const hotel = await runHotelAcceptanceOnce(harness.context.tools)
    assert.deepEqual(hotel, {
      ok: true,
      source: 'SRC_HOTEL',
      tool: 'searchHotels',
      stage: 'validate',
      discovered: true,
      resultSchema: 'VALID',
      callAttempts: 1,
      errorCode: null,
      rawResponseRetained: false,
      coverage: {
        resultCount: 3,
        pricedResultCount: 2,
        lowestPriceRanges: [
          { currency: 'CNY', count: 1, min: 500, max: 500 },
          { currency: 'UNKNOWN', count: 1, min: 800, max: 800 }
        ]
      }
    })
    const serializedHotel = JSON.stringify(hotel)
    for (const forbidden of [
      'private fixture message',
      'private-hotel-1',
      'private hotel alpha',
      'private address alpha',
      'private currency',
      '上海酒店查询',
      '2026-09-15',
      'fixture-credential'
    ]) {
      assert.equal(serializedHotel.includes(forbidden), false)
    }
    assert.equal(fixtures.connects.SRC_HOTEL, 1)
    assert.equal(fixtures.calls.SRC_HOTEL, 1)
    assert.equal(fixtures.closes.SRC_HOTEL, 1)
    assert.deepEqual(fixtures.hotelArgs, {
      originQuery: '上海酒店查询',
      place: '上海',
      placeType: '城市',
      size: 5,
      checkInParam: { adultCount: 2, checkInDate: '2026-09-15', stayNights: 2 }
    })
    assert.equal(harness.context.tools.listToolCalls(undefined).length, 0)
    assert.equal(harness.context.tools.listBlockedTools().length, 0)
    assert.equal(harness.context.tools.listEvidence('acceptance-only').length, 0)
    const repository = new SourceRepository(harness.database)
    assert.equal(repository.getHealth('SRC_MAP'), undefined)
    assert.equal(repository.getHealth('SRC_HOTEL'), undefined)

    const search = await runSearchAcceptanceOnce(harness.context.tools)
    assert.deepEqual(search, {
      ok: true,
      source: 'SRC_SEARCH',
      tool: 'deepseek_web_search',
      stage: 'validate',
      discovered: true,
      resultSchema: 'VALID',
      callAttempts: 1,
      errorCode: null,
      rawResponseRetained: false
    })
    const serializedSearch = JSON.stringify(search)
    for (const forbidden of [
      'fixture public result',
      'https://example.gov.cn/travel',
      '官方夹具',
      '上海市人民广场开放信息 官方',
      'fixture-credential'
    ]) {
      assert.equal(serializedSearch.includes(forbidden), false)
    }
    assert.equal(fixtures.connects.SRC_SEARCH, 1)
    assert.equal(fixtures.calls.SRC_SEARCH, 1)
    assert.equal(fixtures.closes.SRC_SEARCH, 1)
    assert.deepEqual(fixtures.searchArgs, { query: '上海市人民广场开放信息 官方' })
    assert.equal(harness.context.tools.listToolCalls(undefined).length, 0)
    assert.equal(harness.context.tools.listBlockedTools().length, 0)
    assert.equal(harness.context.tools.listEvidence('acceptance-only').length, 0)
    assert.equal(repository.getHealth('SRC_SEARCH'), undefined)
  } finally {
    await harness?.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('D5 source adapters materialize only proven Rail, Map and Hotel fields in one call', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d5-source-claims-'))
  const fixtures = fixtureState()
  const now = { value: '2026-08-29T06:00:00.000Z' }
  let harness: D3Harness | undefined
  try {
    harness = await createHarness({ root, fixtures, now })
    await createSession(harness.context, 'session-d5-source-claims')

    fixtures.mapText = JSON.stringify({
      results: [{ origin_id: '1', dest_id: '1', distance: '1234', duration: '567' }]
    })

    const rail = await harness.context.tools.materializeRailJourney({
      sessionId: 'session-d5-source-claims',
      candidateId: 'round-trip-a',
      direction: 'OUTBOUND',
      trainNo: 'G1',
      date: '2026-09-15',
      fromStation: '成都东',
      toStation: '重庆北'
    })
    const hotel = await harness.context.tools.materializeHotelLodgingCandidates({
      sessionId: 'session-d5-source-claims',
      place: '成都',
      checkInDate: '2026-09-15',
      stayNights: 2,
      adultCount: 2,
      size: 5
    })
    const map = await harness.context.tools.materializeMapGroundTransfer({
      sessionId: 'session-d5-source-claims',
      candidateId: 'round-trip-a',
      direction: 'OUTBOUND',
      kind: 'LAST_MILE',
      from: '重庆北',
      to: '酒店区域',
      origin: '106.5516,29.5630',
      destination: '106.5740,29.5590',
      travelMode: 'DRIVING',
      startAt: '2026-09-15T09:00:00+08:00'
    })

    assert.equal(fixtures.calls.SRC_RAIL, 1)
    assert.equal(fixtures.calls.SRC_HOTEL, 1)
    assert.equal(fixtures.calls.SRC_MAP, 1)
    assert.equal(rail.claims.length, 1)
    assert.equal(rail.claims[0]?.predicate, 'railJourney')
    assert.equal(rail.claims[0]?.contentIdentity, 'TRANSACTION')
    assert.deepEqual(rail.claims[0]?.value, {
      candidateId: 'round-trip-a',
      direction: 'OUTBOUND',
      title: '成都东→重庆北 G1',
      label: 'G1 铁路段',
      trainNo: 'G1',
      serviceDate: '2026-09-15',
      departureTime: '08:00',
      arrivalTime: '09:00',
      from: '成都东',
      to: '重庆北',
      startAt: '2026-09-15T08:00:00+08:00',
      endAt: '2026-09-15T09:00:00+08:00',
      durationMinutes: 60,
      costCents: null,
      seatClass: null,
      waitMinutes: null
    })
    assert.equal(hotel.claims.length, 1)
    assert.equal(hotel.claims[0]?.predicate, 'lodgingCandidate')
    assert.equal(hotel.claims[0]?.contentIdentity, 'COMMERCIAL_OFFER')
    assert.equal(hotel.claims[0]?.verificationStatus, 'UNVERIFIED')
    assert.deepEqual(hotel.claims[0]?.value, {
      name: '本地夹具酒店',
      hotelId: 'hotel-1',
      address: '成都',
      starRating: 4,
      totalCostCents: null,
      totalCostComplete: false,
      roomType: null,
      bedType: null,
      capacity: null,
      roomFitsParty: null,
      cancellationStatus: 'UNKNOWN',
      freeCancelUntil: null,
      positionAdvantage: null,
      observedLowestPrice: { amount: 520, currency: 'CNY' }
    })
    assert.equal(map.claims.length, 1)
    assert.equal(map.claims[0]?.predicate, 'groundTransfer')
    assert.equal(map.claims[0]?.contentIdentity, 'OFFICIAL')
    assert.deepEqual(map.claims[0]?.value, {
      candidateId: 'round-trip-a',
      direction: 'OUTBOUND',
      kind: 'LAST_MILE',
      label: '重庆北→酒店区域 驾车接驳',
      from: '重庆北',
      to: '酒店区域',
      travelMode: 'DRIVING',
      startAt: '2026-09-15T09:00:00+08:00',
      endAt: '2026-09-15T01:09:27.000Z',
      distanceMeters: 1234,
      durationSeconds: 567,
      durationMinutes: 10,
      costCents: null
    })
    assert.equal(harness.context.tools.listEvidence('session-d5-source-claims').length, 3)
    assert.equal(harness.context.tools.listToolCalls('session-d5-source-claims').length, 3)
    assert.equal(
      JSON.stringify([...rail.claims, ...hotel.claims]).includes('fixture hotels'),
      false
    )

    fixtures.modes.SRC_RAIL = 'call-network'
    const callsBeforeFailure = fixtures.calls.SRC_RAIL
    await assert.rejects(
      () =>
        harness!.context.tools.materializeRailJourney({
          sessionId: 'session-d5-source-claims',
          candidateId: 'round-trip-b',
          direction: 'RETURN',
          trainNo: 'G1',
          date: '2026-09-17',
          fromStation: '重庆北',
          toStation: '成都东'
        }),
      (error) => error instanceof AppError && error.code === 'SOURCE_UNREACHABLE'
    )
    assert.equal(fixtures.calls.SRC_RAIL - callsBeforeFailure, 1)
    assert.equal(harness.context.tools.listEvidence('session-d5-source-claims').length, 3)
  } finally {
    await harness?.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('frozen Map distance contract is diagnosed once without values or persistence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d5-map-distance-structure-'))
  const fixtures = fixtureState()
  fixtures.mapText = JSON.stringify({
    results: [
      {
        origin_id: 'private-origin',
        dest_id: 'private-destination',
        distance: '1234',
        duration: '567'
      }
    ]
  })
  const now = { value: '2026-08-29T06:10:00.000Z' }
  let harness: D3Harness | undefined
  try {
    harness = await createHarness({ root, fixtures, now })
    const outcome = await harness.context.tools.runStructureDiagnosticOnce({
      sourceId: 'SRC_MAP',
      toolName: 'maps_distance',
      args: {
        origins: '121.4737,31.2304',
        destination: '121.4998,31.2397',
        type: '1'
      },
      timeoutMs: 15_000
    })

    assert.deepEqual(outcome, {
      ok: true,
      source: 'SRC_MAP',
      tool: 'maps_distance',
      stage: 'summarize',
      discovered: true,
      callAttempts: 1,
      resultSchema: 'VALID',
      summary: {
        payloadKind: 'JSON',
        entries: [
          { path: '$', type: 'object' },
          { path: '$/results', type: 'array', arrayLength: 1 },
          { path: '$/results/*', type: 'object' },
          { path: '$/results/*/dest_id', type: 'string' },
          { path: '$/results/*/distance', type: 'string' },
          { path: '$/results/*/duration', type: 'string' },
          { path: '$/results/*/origin_id', type: 'string' }
        ],
        truncated: false
      },
      errorCategory: null,
      errorCode: null,
      rawResponseRetained: false
    })
    const serialized = JSON.stringify(outcome)
    for (const forbidden of [
      'private-origin',
      'private-destination',
      '121.4737,31.2304',
      '121.4998,31.2397',
      'fixture-credential'
    ]) {
      assert.equal(serialized.includes(forbidden), false)
    }
    assert.equal(fixtures.calls.SRC_MAP, 1)
    assert.equal(harness.context.tools.listToolCalls(undefined).length, 0)
    assert.equal(harness.context.tools.listEvidence('diagnostic-only').length, 0)
    assert.equal(new SourceRepository(harness.database).getHealth('SRC_MAP'), undefined)
  } finally {
    await harness?.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('Serper results stay complete while DeepSeek answer and token audit stream in order', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d3-search-stream-'))
  const fixtures = fixtureState()
  const now = { value: '2026-08-25T00:30:00.000Z' }
  const sources = [
    {
      url: 'https://example.gov.cn/travel',
      title: '官方旅游公告',
      snippet: '第一条公开搜索结果。'
    },
    {
      url: 'https://example.edu.cn/guide',
      title: '公共交通指南',
      snippet: '第二条公开搜索结果。'
    }
  ]
  fixtures.searchResult = {
    ok: true,
    answer: '基于两条公开结果生成的答案。',
    model: 'deepseek-v4-flash',
    search_provider: 'serper-search',
    sources,
    usage: {
      input_tokens: 210,
      output_tokens: 32,
      cached_input_tokens: 10,
      reasoning_tokens: 6,
      total_tokens: 242
    },
    audit: {
      search_api_calls: 1,
      search_result_count: 2,
      grounding_characters: 480,
      native_web_search_calls: 0,
      native_open_page_calls: 0,
      open_page_tokens: 0
    },
    error_code: null,
    message: null
  }
  const progress: SearchStreamPayload[] = []
  let harness: D3Harness | undefined
  try {
    harness = await createHarness({ root, fixtures, now })
    await createSession(harness.context, 'session-search-stream')

    const outcome = await harness.context.tools.runRepresentativeQuery(
      {
        sourceId: 'SRC_SEARCH',
        sessionId: 'session-search-stream',
        input: { query: '成都官方旅游与公共交通信息' }
      },
      '00000000-0000-4000-8000-000000000001',
      (payload) => progress.push(payload)
    )

    assert.deepEqual(
      progress.map((payload) => payload.kind),
      ['SEARCH_STARTED', 'SEARCH_RESULTS', 'ANSWER_DELTA', 'USAGE']
    )
    assert.deepEqual(
      progress.find((payload) => payload.kind === 'SEARCH_RESULTS'),
      { kind: 'SEARCH_RESULTS', sources }
    )
    assert.deepEqual(outcome.search?.sources, sources)
    assert.equal(outcome.search?.answer, '基于两条公开结果生成的答案。')
    assert.equal(outcome.search?.audit.nativeOpenPageCalls, 0)
    assert.equal(outcome.search?.audit.openPageTokens, 0)
    assert.equal(outcome.search?.usage.totalTokens, 242)
    assert.equal(outcome.claims.length, 2)
    assert.equal(harness.context.tools.listEvidence('session-search-stream').length, 2)
    assert.equal(fixtures.calls.SRC_SEARCH, 1)
  } finally {
    await harness?.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('search fails closed before transport when the Serper credential is missing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d3-search-credentials-'))
  const fixtures = fixtureState()
  const now = { value: '2026-08-25T00:45:00.000Z' }
  let harness: D3Harness | undefined
  try {
    harness = await createHarness({
      root,
      fixtures,
      now,
      readCredential: async (id) => (id === 'SERPER_SEARCH' ? undefined : 'fixture-credential')
    })
    await createSession(harness.context, 'session-search-no-serper')

    await assert.rejects(
      () =>
        harness!.context.tools.runRepresentativeQuery({
          sourceId: 'SRC_SEARCH',
          sessionId: 'session-search-no-serper',
          input: { query: '成都官方旅游公告' }
        }),
      (error) => error instanceof AppError && error.code === 'SOURCE_UNCONFIGURED'
    )

    assert.equal(fixtures.connects.SRC_SEARCH, 0)
    assert.equal(fixtures.calls.SRC_SEARCH, 0)
    assert.equal(
      (await harness.context.tools.listSourceHealth()).find(
        (entry) => entry.sourceId === 'SRC_SEARCH'
      )?.status,
      'UNCONFIGURED'
    )
  } finally {
    await harness?.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('DeepSeek search missing citations fails closed once and writes no evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d3-search-citations-'))
  const fixtures = fixtureState()
  const now = { value: '2026-08-24T16:00:00.000Z' }
  let harness: D3Harness | undefined
  try {
    harness = await createHarness({ root, fixtures, now })
    await createSession(harness.context, 'session-search-drift')
    await harness.context.tools.discoverSourceTools('SRC_SEARCH')
    fixtures.searchResult = {
      ok: false,
      answer: null,
      model: 'deepseek-v4-flash',
      search_provider: 'serper-search',
      sources: [],
      usage: null,
      audit: null,
      error_code: 'MISSING_CITATIONS',
      message: 'Serper Search 未返回可核验的 HTTPS 搜索结果。'
    }
    const callsBefore = fixtures.calls.SRC_SEARCH

    await assert.rejects(
      () =>
        harness!.context.tools.runRepresentativeQuery({
          sourceId: 'SRC_SEARCH',
          sessionId: 'session-search-drift',
          input: { query: '上海官方旅游公告' }
        }),
      (error) => error instanceof AppError && error.code === 'SOURCE_DRIFT'
    )

    assert.equal(fixtures.calls.SRC_SEARCH - callsBefore, 1)
    assert.equal(harness.context.tools.listEvidence('session-search-drift').length, 0)
    assert.equal(
      (await harness.context.tools.listSourceHealth()).find(
        (entry) => entry.sourceId === 'SRC_SEARCH'
      )?.status,
      'DEGRADED'
    )
  } finally {
    await harness?.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('DeepSeek acceptance exposes only bounded validation categories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d3-search-category-'))
  const fixtures = fixtureState()
  const now = { value: '2026-08-25T01:00:00.000Z' }
  let harness: D3Harness | undefined
  try {
    harness = await createHarness({ root, fixtures, now })
    const cases = [
      {
        result: {
          ok: false,
          answer: null,
          model: 'deepseek-v4-flash',
          search_provider: 'serper-search',
          sources: [],
          usage: null,
          audit: null,
          error_code: 'MISSING_ANSWER',
          message: 'DeepSeek 官方 API 未返回可用的搜索文本。'
        },
        category: 'MISSING_ANSWER'
      },
      {
        result: {
          ok: false,
          answer: null,
          model: 'deepseek-v4-flash',
          search_provider: 'serper-search',
          sources: [],
          usage: null,
          audit: null,
          error_code: 'MISSING_CITATIONS',
          message: 'DeepSeek 官方 API 未返回可核验的 HTTPS 引用。'
        },
        category: 'MISSING_CITATIONS'
      },
      {
        result: {
          ok: true,
          answer: 'private drift answer',
          model: 'unexpected-model',
          search_provider: 'serper-search',
          sources: [
            {
              url: 'https://private.example/drift',
              title: 'private title',
              snippet: 'private snippet'
            }
          ],
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            cached_input_tokens: 0,
            reasoning_tokens: 0,
            total_tokens: 2
          },
          audit: {
            search_api_calls: 1,
            search_result_count: 1,
            grounding_characters: 1,
            native_web_search_calls: 0,
            native_open_page_calls: 0,
            open_page_tokens: 0
          },
          error_code: null,
          message: null
        },
        category: 'RESULT_SCHEMA_DRIFT'
      },
      {
        result: {
          ok: false,
          answer: null,
          model: 'deepseek-v4-flash',
          search_provider: 'serper-search',
          sources: [],
          usage: null,
          audit: null,
          error_code: 'INVALID_RESPONSE',
          message: 'DeepSeek 官方 API 未返回可用的搜索文本和 HTTPS 引用。'
        },
        category: 'RESULT_SCHEMA_DRIFT'
      }
    ] as const

    for (const fixture of cases) {
      fixtures.searchResult = fixture.result
      const callsBefore = fixtures.calls.SRC_SEARCH
      const outcome = await runSearchAcceptanceOnce(harness.context.tools)
      assert.equal(outcome.ok, false)
      assert.equal(outcome.errorCode, 'SOURCE_DRIFT')
      assert.equal(outcome.validationCategory, fixture.category)
      assert.equal(outcome.callAttempts, 1)
      assert.equal(outcome.rawResponseRetained, false)
      assert.equal(fixtures.calls.SRC_SEARCH - callsBefore, 1)
      const serialized = JSON.stringify(outcome)
      for (const forbidden of [
        'private drift answer',
        'https://private.example/drift',
        'private title',
        'private snippet',
        'unexpected-model',
        'fixture-credential'
      ]) {
        assert.equal(serialized.includes(forbidden), false)
      }
    }

    assert.equal(harness.context.tools.listToolCalls(undefined).length, 0)
    assert.equal(harness.context.tools.listBlockedTools().length, 0)
    assert.equal(harness.context.tools.listEvidence('acceptance-only').length, 0)
  } finally {
    await harness?.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('structure diagnostic validates the frozen contract on the same single call', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d3-structure-valid-contract-'))
  const fixtures = fixtureState()
  const now = { value: '2026-08-23T09:55:00.000Z' }
  let harness: D3Harness | undefined
  try {
    harness = await createHarness({ root, fixtures, now })
    const outcome = await harness.context.tools.runStructureDiagnosticOnce({
      sourceId: 'SRC_MAP',
      toolName: 'maps_geo',
      args: { address: '上海市人民广场', city: '上海' },
      timeoutMs: 15_000
    })
    assert.equal(outcome.ok, true)
    assert.equal(outcome.resultSchema, 'VALID')
    assert.equal(outcome.errorCode, null)
    assert.deepEqual(outcome.summary, {
      payloadKind: 'JSON',
      entries: [
        { path: '$', type: 'object' },
        { path: '$/results', type: 'array', arrayLength: 1 },
        { path: '$/results/*', type: 'object' },
        { path: '$/results/*/location', type: 'string' }
      ],
      truncated: false
    })
    const serialized = JSON.stringify(outcome)
    for (const forbidden of ['104.06,30.67', '上海市人民广场', '上海', 'fixture-credential']) {
      assert.equal(serialized.includes(forbidden), false)
    }
    assert.equal(fixtures.connects.SRC_MAP, 1)
    assert.equal(fixtures.calls.SRC_MAP, 1)
    assert.equal(fixtures.closes.SRC_MAP, 1)
    assert.equal(harness.context.tools.listToolCalls(undefined).length, 0)
    assert.equal(harness.context.tools.listEvidence('diagnostic-only').length, 0)
  } finally {
    await harness?.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('structure diagnostic keeps only JSON key paths, types, and array lengths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d3-structure-diagnostic-'))
  const fixtures = fixtureState()
  fixtures.mapText = JSON.stringify({
    return: [
      {
        location: '121.4737,31.2304',
        token: 'private-field-value',
        meta: { tags: ['first-private-value', 'second-private-value'] }
      }
    ],
    count: 1,
    enabled: true,
    nothing: null
  })
  const now = { value: '2026-08-23T10:00:00.000Z' }
  let harness: D3Harness | undefined
  try {
    harness = await createHarness({ root, fixtures, now })
    const outcome = await harness.context.tools.runStructureDiagnosticOnce({
      sourceId: 'SRC_MAP',
      toolName: 'maps_geo',
      args: { address: '上海市人民广场', city: '上海' },
      timeoutMs: 15_000
    })
    assert.deepEqual(outcome, {
      ok: false,
      source: 'SRC_MAP',
      tool: 'maps_geo',
      stage: 'summarize',
      discovered: true,
      callAttempts: 1,
      resultSchema: 'INVALID',
      summary: {
        payloadKind: 'JSON',
        entries: [
          { path: '$', type: 'object' },
          { path: '$/count', type: 'number' },
          { path: '$/enabled', type: 'boolean' },
          { path: '$/nothing', type: 'null' },
          { path: '$/return', type: 'array', arrayLength: 1 },
          { path: '$/return/*', type: 'object' },
          { path: '$/return/*/location', type: 'string' },
          { path: '$/return/*/meta', type: 'object' },
          { path: '$/return/*/meta/tags', type: 'array', arrayLength: 2 },
          { path: '$/return/*/meta/tags/*', type: 'string' },
          { path: '$/return/*/token', type: 'string' }
        ],
        truncated: false
      },
      errorCategory: null,
      errorCode: 'SOURCE_DRIFT',
      rawResponseRetained: false
    })
    const serialized = JSON.stringify(outcome)
    for (const forbidden of [
      '121.4737,31.2304',
      'private-field-value',
      'first-private-value',
      'second-private-value',
      '上海市人民广场',
      'fixture-credential'
    ]) {
      assert.equal(serialized.includes(forbidden), false)
    }
    assert.equal(fixtures.connects.SRC_MAP, 1)
    assert.equal(fixtures.calls.SRC_MAP, 1)
    assert.equal(fixtures.closes.SRC_MAP, 1)
    assert.equal(harness.context.tools.listToolCalls(undefined).length, 0)
    assert.equal(harness.context.tools.listBlockedTools().length, 0)
    assert.equal(harness.context.tools.listEvidence('diagnostic-only').length, 0)
    assert.equal(new SourceRepository(harness.database).getHealth('SRC_MAP'), undefined)
    const cache = new PoiCacheStore(harness.paths.poiCacheDatabase)
    assert.equal(cache.getPoi('上海市人民广场', '上海', new Date(now.value)), undefined)
    assert.equal(cache.quota('AMAP_LBS', new Date(now.value)), 0)
    cache.close()
  } finally {
    await harness?.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('structure diagnostic marks non-JSON text without retaining it and never retries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d3-structure-non-json-'))
  const fixtures = fixtureState()
  fixtures.mapText = 'private non-json response text'
  const now = { value: '2026-08-23T10:05:00.000Z' }
  let harness: D3Harness | undefined
  try {
    harness = await createHarness({ root, fixtures, now })
    const nonJson = await harness.context.tools.runStructureDiagnosticOnce({
      sourceId: 'SRC_MAP',
      toolName: 'maps_geo',
      args: { address: '上海市人民广场', city: '上海' },
      timeoutMs: 15_000
    })
    assert.deepEqual(nonJson.summary, {
      payloadKind: 'NON_JSON_TEXT',
      entries: [],
      truncated: false
    })
    assert.equal(nonJson.resultSchema, 'INVALID')
    assert.equal(nonJson.errorCode, 'SOURCE_DRIFT')
    assert.equal(JSON.stringify(nonJson).includes('private non-json response text'), false)

    fixtures.modes.SRC_MAP = 'call-network'
    const failed = await harness.context.tools.runStructureDiagnosticOnce({
      sourceId: 'SRC_MAP',
      toolName: 'maps_geo',
      args: { address: '上海市人民广场', city: '上海' },
      timeoutMs: 15_000
    })
    assert.equal(failed.ok, false)
    assert.equal(failed.stage, 'call')
    assert.equal(failed.callAttempts, 1)
    assert.equal(failed.resultSchema, 'NOT_RUN')
    assert.equal(failed.summary, null)
    assert.equal(failed.errorCode, 'SOURCE_UNREACHABLE')
    assert.equal(fixtures.connects.SRC_MAP, 2)
    assert.equal(fixtures.calls.SRC_MAP, 2)
    assert.equal(fixtures.closes.SRC_MAP, 2)
    assert.equal(harness.context.tools.listToolCalls(undefined).length, 0)
    assert.equal(harness.context.tools.listEvidence('diagnostic-only').length, 0)
  } finally {
    await harness?.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('structure diagnostic safely summarizes MCP error results without retaining values', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d3-structure-error-result-'))
  const fixtures = fixtureState()
  fixtures.mapIsError = true
  fixtures.mapText = JSON.stringify({
    error: { code: 'PRIVATE-CODE', details: [{ token: 'private-value' }] }
  })
  const now = { value: '2026-08-23T10:07:00.000Z' }
  let harness: D3Harness | undefined
  try {
    harness = await createHarness({ root, fixtures, now })
    const outcome = await harness.context.tools.runStructureDiagnosticOnce({
      sourceId: 'SRC_MAP',
      toolName: 'maps_geo',
      args: { address: '上海市人民广场', city: '上海' },
      timeoutMs: 15_000
    })
    assert.deepEqual(outcome, {
      ok: false,
      source: 'SRC_MAP',
      tool: 'maps_geo',
      stage: 'summarize',
      discovered: true,
      callAttempts: 1,
      resultSchema: 'NOT_RUN',
      summary: {
        payloadKind: 'JSON',
        entries: [
          { path: '$', type: 'object' },
          { path: '$/error', type: 'object' },
          { path: '$/error/code', type: 'string' },
          { path: '$/error/details', type: 'array', arrayLength: 1 },
          { path: '$/error/details/*', type: 'object' },
          { path: '$/error/details/*/token', type: 'string' }
        ],
        truncated: false
      },
      errorCategory: null,
      errorCode: 'MCP_TOOL_ERROR',
      rawResponseRetained: false
    })

    const serialized = JSON.stringify(outcome)
    for (const secret of [
      'PRIVATE-CODE',
      'private-value',
      '上海市人民广场',
      '上海',
      'fixture-credential'
    ]) {
      assert.equal(serialized.includes(secret), false)
    }
    assert.equal(fixtures.connects.SRC_MAP, 1)
    assert.equal(fixtures.calls.SRC_MAP, 1)
    assert.equal(fixtures.closes.SRC_MAP, 1)
    assert.equal(harness.context.tools.listToolCalls(undefined).length, 0)
    assert.equal(harness.context.tools.listBlockedTools().length, 0)
    assert.equal(harness.context.tools.listEvidence('diagnostic-only').length, 0)
    assert.equal(new SourceRepository(harness.database).getHealth('SRC_MAP'), undefined)
    const cache = new PoiCacheStore(harness.paths.poiCacheDatabase)
    assert.equal(cache.getPoi('上海市人民广场', '上海', new Date(now.value)), undefined)
    assert.equal(cache.quota('AMAP_LBS', new Date(now.value)), 0)
    cache.close()
  } finally {
    await harness?.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('Amap error classifier returns only allowlisted coarse categories', () => {
  const cases = [
    ['Geocoding failed: INVALID_USER_KEY', 'CREDENTIAL_INVALID'],
    ['Geocoding failed: 10013', 'CREDENTIAL_INVALID'],
    ['Geocoding failed: USERKEY_PLAT_NOMATCH', 'CREDENTIAL_PLATFORM_MISMATCH'],
    ['Geocoding failed: 10009', 'CREDENTIAL_PLATFORM_MISMATCH'],
    ['Geocoding failed: INVALID_USER_IP', 'CREDENTIAL_RESTRICTION'],
    ['Geocoding failed: 10007', 'CREDENTIAL_RESTRICTION'],
    ['Geocoding failed: INSUFFICIENT_PRIVILEGES', 'PERMISSION_DENIED'],
    ['Geocoding failed: 10012', 'PERMISSION_DENIED'],
    ['Geocoding failed: USER_DAILY_QUERY_OVER_LIMIT', 'QUOTA_OR_RATE_LIMIT'],
    ['Geocoding failed: 10044', 'QUOTA_OR_RATE_LIMIT'],
    ['Geocoding failed: 20000', 'INVALID_REQUEST'],
    ['Geocoding failed: SERVER_IS_BUSY', 'UPSTREAM_UNAVAILABLE'],
    ['Geocoding failed: 10016', 'UPSTREAM_UNAVAILABLE'],
    ['geocoding failed: invalid_user_key', 'CREDENTIAL_INVALID'],
    ['Geocoding failed: PRIVATE_UPSTREAM_DETAIL', 'OTHER']
  ] as const

  for (const [text, expected] of cases) {
    assert.equal(classifyAmapBusinessError(text), expected)
  }
  assert.equal(classifyAmapBusinessError('Geocoding failed: 110001'), 'OTHER')
})

test('structure diagnostic classifies non-JSON Amap errors without retaining identifiers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d3-amap-error-category-'))
  const fixtures = fixtureState()
  fixtures.mapIsError = true
  fixtures.mapText = 'Geocoding failed: INVALID_USER_IP'
  const now = { value: '2026-08-24T15:30:00.000Z' }
  let harness: D3Harness | undefined
  try {
    harness = await createHarness({ root, fixtures, now })
    const outcome = await harness.context.tools.runStructureDiagnosticOnce({
      sourceId: 'SRC_MAP',
      toolName: 'maps_geo',
      args: { address: '上海市人民广场', city: '上海' },
      timeoutMs: 15_000
    })
    assert.deepEqual(outcome, {
      ok: false,
      source: 'SRC_MAP',
      tool: 'maps_geo',
      stage: 'summarize',
      discovered: true,
      callAttempts: 1,
      resultSchema: 'NOT_RUN',
      summary: { payloadKind: 'NON_JSON_TEXT', entries: [], truncated: false },
      errorCategory: 'CREDENTIAL_RESTRICTION',
      errorCode: 'MCP_TOOL_ERROR',
      rawResponseRetained: false
    })

    const serialized = JSON.stringify(outcome)
    for (const forbidden of [
      'INVALID_USER_IP',
      'Geocoding failed',
      '上海市人民广场',
      '上海',
      'fixture-credential'
    ]) {
      assert.equal(serialized.includes(forbidden), false)
    }
    assert.equal(fixtures.connects.SRC_MAP, 1)
    assert.equal(fixtures.calls.SRC_MAP, 1)
    assert.equal(fixtures.closes.SRC_MAP, 1)
    assert.equal(harness.context.tools.listToolCalls(undefined).length, 0)
    assert.equal(harness.context.tools.listBlockedTools().length, 0)
    assert.equal(harness.context.tools.listEvidence('diagnostic-only').length, 0)
    assert.equal(new SourceRepository(harness.database).getHealth('SRC_MAP'), undefined)
    const cache = new PoiCacheStore(harness.paths.poiCacheDatabase)
    assert.equal(cache.getPoi('上海市人民广场', '上海', new Date(now.value)), undefined)
    assert.equal(cache.quota('AMAP_LBS', new Date(now.value)), 0)
    cache.close()
  } finally {
    await harness?.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('structure diagnostic bounds oversized key sets and marks truncation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d3-structure-bounded-'))
  const fixtures = fixtureState()
  fixtures.mapText = JSON.stringify(
    Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`key-${index}`, index]))
  )
  const now = { value: '2026-08-23T10:10:00.000Z' }
  let harness: D3Harness | undefined
  try {
    harness = await createHarness({ root, fixtures, now })
    const outcome = await harness.context.tools.runStructureDiagnosticOnce({
      sourceId: 'SRC_MAP',
      toolName: 'maps_geo',
      args: { address: '上海市人民广场', city: '上海' },
      timeoutMs: 15_000
    })
    assert.equal(outcome.summary?.payloadKind, 'JSON')
    assert.equal(outcome.summary?.entries.length, 256)
    assert.equal(outcome.summary?.truncated, true)
    assert.equal(fixtures.calls.SRC_MAP, 1)
  } finally {
    await harness?.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('evil discovery passes only the read tool and records both policy gates exactly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d3-policy-'))
  const paths = createAppPaths(root)
  const database = await openFixtureDatabase(paths.database)
  try {
    const repository = new SourceRepository(database)
    const registered = gateDiscoveredTools({
      policy: new PolicyService(),
      sourceId: 'evil-fixture',
      discovered: [
        { name: 'searchHotels', description: '查询酒店', inputSchema: {} },
        { name: 'createOrder', description: '创建订单', inputSchema: {} },
        { name: 'payOrder', description: '支付订单', inputSchema: {} },
        { name: 'confirmBooking', description: '预订确认房间', inputSchema: {} }
      ],
      allowlist: new Set(['searchHotels', 'confirmBooking']),
      contracts: { searchHotels: {}, confirmBooking: {} },
      recordBlocked: (sourceId, toolName, reason) =>
        repository.recordBlocked(sourceId, toolName, reason, '2026-08-22T10:00:00.000Z')
    })
    assert.deepEqual([...registered.keys()], ['searchHotels'])
    assert.deepEqual(
      repository
        .listBlockedTools(10)
        .map((item) => [item.sourceId, item.toolName, item.reason])
        .sort((left, right) => left[1]!.localeCompare(right[1]!)),
      [
        ['evil-fixture', 'confirmBooking', 'WRITE_KEYWORD_HIT'],
        ['evil-fixture', 'createOrder', 'NOT_IN_ALLOWLIST'],
        ['evil-fixture', 'payOrder', 'NOT_IN_ALLOWLIST']
      ]
    )
  } finally {
    database.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('source operation cancellation closes the active session without degrading health', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d3-cancel-'))
  const fixtures = fixtureState()
  const now = { value: '2026-08-22T10:30:00.000Z' }
  let harness: D3Harness | undefined
  try {
    harness = await createHarness({ root, fixtures, now })
    await createSession(harness.context, 'session-cancel')
    await harness.context.tools.discoverRailTools()
    fixtures.modes.SRC_RAIL = 'slow'
    let markStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    fixtures.signalCallStarted = () => markStarted?.()
    const operationId = '0198d5b8-5820-7b2a-a2fb-8cd9456c6310'
    const pending = harness.context.tools.runRepresentativeQuery(
      { sourceId: 'SRC_RAIL', sessionId: 'session-cancel', input: {} },
      operationId
    )
    await started
    assert.equal(await harness.context.tools.cancelOperation(operationId), true)
    await assert.rejects(
      () => pending,
      (error) => error instanceof AppError && error.code === 'SOURCE_CANCELLED'
    )
    const health = (await harness.context.tools.listSourceHealth()).find(
      (entry) => entry.sourceId === 'SRC_RAIL'
    )!
    assert.equal(health.status, 'OK')
    assert.equal(health.failStreak, 0)
    assert.equal(
      harness.context.tools.listToolCalls('session-cancel')[0]?.errorCode,
      'SOURCE_CANCELLED'
    )
  } finally {
    await harness?.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('EvidenceClaim rejects empty or credential-bearing source references before append', () => {
  const base = {
    claimId: 'claim-contract',
    sessionId: 'session-contract',
    subject: 'subject',
    predicate: 'predicate',
    value: 'value',
    sourceId: 'SRC_SEARCH' as const,
    contentIdentity: 'UNKNOWN' as const,
    verificationStatus: 'VERIFIED' as const,
    observedAt: '2026-08-22T10:00:00.000Z',
    validUntil: '2026-08-23T10:00:00.000Z',
    confidence: null,
    conflictsWith: [],
    notes: null
  }
  assert.equal(EvidenceClaimSchema.safeParse({ ...base, sourceRef: '' }).success, false)
  assert.equal(
    EvidenceClaimSchema.safeParse({ ...base, sourceRef: 'https://example.com/?api_key=secret' })
      .success,
    false
  )
  assert.equal(
    EvidenceClaimSchema.safeParse({
      ...base,
      sourceRef: 'https://example.com/?access_token=secret'
    }).success,
    false
  )
})

test('DeepSeek search contract rejects non-HTTPS and userinfo citation URLs', () => {
  const base = {
    ok: true,
    answer: 'fixture answer',
    model: 'deepseek-v4-flash',
    search_provider: 'serper-search',
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cached_input_tokens: 0,
      reasoning_tokens: 0,
      total_tokens: 2
    },
    audit: {
      search_api_calls: 1,
      search_result_count: 1,
      grounding_characters: 1,
      native_web_search_calls: 0,
      native_open_page_calls: 0,
      open_page_tokens: 0
    },
    error_code: null,
    message: null
  }
  assert.equal(
    DeepSeekSearchResultSchema.safeParse({
      ...base,
      sources: [{ url: 'http://example.com/travel', title: 'example', snippet: 'example' }]
    }).success,
    false
  )
  assert.equal(
    DeepSeekSearchResultSchema.safeParse({
      ...base,
      sources: [
        { url: 'https://user:secret@example.com/travel', title: 'example', snippet: 'example' }
      ]
    }).success,
    false
  )
})

test('Amap cache avoids calls while quota warning and hard stop persist independently', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d3-quota-'))
  const fixtures = fixtureState()
  const now = { value: '2026-08-22T11:00:00.000Z' }
  const logs: string[] = []
  let harness: D3Harness | undefined
  try {
    harness = await createHarness({ root, fixtures, now, logs, amapLbsQuota: 5 })
    await createSession(harness.context, 'session-quota')
    for (let index = 0; index < 4; index += 1) {
      await harness.context.tools.runRepresentativeQuery({
        sourceId: 'SRC_MAP',
        sessionId: 'session-quota',
        input: { address: `地点${index}`, city: '成都' }
      })
    }
    assert.equal(fixtures.calls.SRC_MAP, 4)
    assert.ok(logs.includes('SOURCE_RATE_LIMITED'))
    await harness.context.tools.runRepresentativeQuery({
      sourceId: 'SRC_MAP',
      sessionId: 'session-quota',
      input: { address: '地点0', city: '成都' }
    })
    assert.equal(fixtures.calls.SRC_MAP, 4)
    await assert.rejects(
      () =>
        harness!.context.tools.runRepresentativeQuery({
          sourceId: 'SRC_MAP',
          sessionId: 'session-quota',
          input: { address: '熔断地点', city: '成都' }
        }),
      (error) => error instanceof AppError && error.code === 'SOURCE_QUOTA_EXHAUSTED'
    )
    assert.equal(harness.context.tools.listToolCalls('session-quota').length, 4)
    await harness.stop()
    harness = undefined

    const cache = new PoiCacheStore(createAppPaths(root).poiCacheDatabase)
    assert.equal(cache.quota('AMAP_LBS', new Date(now.value)), 4)
    assert.equal(cache.getPoi('地点0', '成都', new Date(now.value))?.lng, 104.06)
    cache.clearPoiDetails()
    assert.equal(cache.quota('AMAP_LBS', new Date(now.value)), 4)
    assert.equal(cache.getPoi('地点0', '成都', new Date(now.value))?.detail, null)
    cache.close()
  } finally {
    await harness?.stop()
    await rm(root, { recursive: true, force: true })
  }
})
