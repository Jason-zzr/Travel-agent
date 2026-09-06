import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { Context } from 'cordis'
import { z } from 'zod'
import { applyMigrations } from './db/migrate'
import { ProviderConfigStore } from './provider-config-store'
import { createAppPaths, type AppPaths } from './paths'
import { eventLogPlugin } from './plugins/event-log'
import { travelStatePlugin } from './plugins/travel-state'
import { sessionPlugin } from './plugins/session'
import { policyPlugin } from './plugins/policy'
import { toolsPlugin } from './plugins/tool-registry'
import { ProviderRuntime, providerPlugin, type ProviderFetch } from './plugins/provider-runtime'
import { coordinatorPlugin } from './plugins/coordinator'
import { inspectorPlugin } from './plugins/inspector'
import { TravelBasicsSchema, type TravelBasics } from '../shared/schema/interview'
import type { ProviderConfig } from '../shared/schema/provider'
import { AppError } from '../shared/errors'
import { SourceConfigStore } from './source-config-store'

const providerConfig: ProviderConfig = {
  version: 2,
  channels: {
    DEEPSEEK_OFFICIAL: { baseUrl: 'https://api.deepseek.com' },
    SHUAI_API: { baseUrl: 'https://api.shuaiapi.com' }
  },
  roles: {
    EXTRACTION: {
      channel: 'SHUAI_API',
      model: 'gemini-through-shuai',
      currency: 'USD',
      inputMinorPerMillion: 100,
      outputMinorPerMillion: 200
    },
    PLANNING: {
      channel: 'DEEPSEEK_OFFICIAL',
      model: 'scripted-planning',
      currency: 'USD',
      inputMinorPerMillion: null,
      outputMinorPerMillion: null
    },
    REVIEW: {
      channel: 'DEEPSEEK_OFFICIAL',
      model: 'scripted-review',
      currency: 'USD',
      inputMinorPerMillion: null,
      outputMinorPerMillion: null
    },
    VISION: {
      channel: 'SHUAI_API',
      model: 'scripted-vision',
      currency: 'USD',
      inputMinorPerMillion: null,
      outputMinorPerMillion: null
    }
  }
}

function basics(destinations: string[]): TravelBasics {
  return TravelBasicsSchema.parse({
    originCities: ['上海'],
    destinationCities: destinations,
    destinationIntent: null,
    travelers: [
      {
        count: 2,
        ageBand: 'ADULT',
        relationship: '家人',
        stamina: 'MEDIUM',
        careNeeds: [],
        functionalLimits: []
      }
    ],
    dates: { kind: 'FIXED', startDate: '2026-05-10', endDate: '2026-05-13' },
    budget: {
      currency: 'CNY',
      basis: 'TOTAL',
      targetMinor: 800_000,
      flexibleRangeMinor: { min: 700_000, max: 900_000 },
      hardCapMinor: null,
      inclusions: ['TRANSPORT', 'ACCOMMODATION', 'MEALS']
    },
    intensity: 'BALANCED',
    preferences: {
      hardConstraints: [],
      softPreferences: ['本地餐饮'],
      negotiableVariables: ['酒店区域']
    },
    staySegments: 1
  })
}

async function migrationSql(version: 1 | 2): Promise<string> {
  return readFile(
    new URL(
      `./db/migrations/000${version}_${version === 1 ? 'init' : 'model_call_cost'}.sql`,
      import.meta.url
    ),
    'utf8'
  )
}

async function initializeDatabase(path: string): Promise<Database.Database> {
  const database = new Database(path)
  database.pragma('foreign_keys = ON')
  applyMigrations(database, [
    { version: 1, sql: await migrationSql(1) },
    { version: 2, sql: await migrationSql(2) }
  ])
  return database
}

interface TestKernel {
  context: Context
  database: Database.Database
  paths: AppPaths
}

async function createKernel(root: string, fetchPort: ProviderFetch): Promise<TestKernel> {
  const paths = createAppPaths(root)
  const database = await initializeDatabase(paths.database)
  const configStore = new ProviderConfigStore(paths.providerConfig)
  await configStore.save(providerConfig)
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
    configStore,
    readCredential: async () => 'sk-test-only',
    fetch: fetchPort,
    timeoutMs: 100
  })
  context.plugin(coordinatorPlugin)
  context.plugin(inspectorPlugin)
  await context.start()
  return { context, database, paths }
}

async function stopKernel(context: Context, database: Database.Database): Promise<void> {
  await context.tools.close()
  await context.eventLog.close()
  database.close()
  await context.stop()
}

const invalidFetch: ProviderFetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    choices: [{ message: { content: '{"garbage":1}' } }],
    usage: { prompt_tokens: 100, completion_tokens: 10 }
  })
})

function sequenceFetch(contents: string[]): ProviderFetch {
  let index = 0
  return async () => {
    const content = contents[index]
    index += 1
    if (content === undefined) throw new Error('Scripted Provider response exhausted.')
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 120, completion_tokens: 40 }
      })
    }
  }
}

test('D1 database receives additive model-call cost migration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-migration-'))
  const path = join(root, 'migration.db')
  const database = new Database(path)
  try {
    database.exec(await migrationSql(1))
    database
      .prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (1, ?)')
      .run(new Date().toISOString())
    const result = applyMigrations(database, [{ version: 2, sql: await migrationSql(2) }])
    assert.deepEqual(result.applied, [2])
    const columns = database.pragma('table_info(model_calls)') as Array<{ name: string }>
    assert.ok(columns.some((column) => column.name === 'cost_status'))
    assert.ok(columns.some((column) => column.name === 'cost_currency'))
    assert.deepEqual(
      applyMigrations(database, [{ version: 2, sql: await migrationSql(2) }]).applied,
      []
    )
  } finally {
    database.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('provider config is atomic and structured output repairs exactly once', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-provider-'))
  const paths = createAppPaths(root)
  const database = await initializeDatabase(paths.database)
  try {
    const store = new ProviderConfigStore(paths.providerConfig)
    const summary = await store.save(providerConfig)
    assert.equal(summary.version, 2)
    assert.equal(summary.routes?.EXTRACTION.channel, 'SHUAI_API')
    assert.equal(summary.routes?.PLANNING.channel, 'DEEPSEEK_OFFICIAL')
    assert.equal(summary.routes?.REVIEW.channel, 'DEEPSEEK_OFFICIAL')
    assert.equal(summary.routes?.VISION.channel, 'SHUAI_API')
    assert.deepEqual(await new ProviderConfigStore(paths.providerConfig).summary(), summary)
    assert.equal((await readFile(paths.providerConfig, 'utf8')).includes('sk-test-only'), false)
    const credentialReads: string[] = []
    const runtime = new ProviderRuntime({
      database,
      configStore: store,
      readCredential: async (credentialId) => {
        credentialReads.push(credentialId)
        return 'sk-test-only'
      },
      fetch: invalidFetch
    })
    await assert.rejects(
      () =>
        runtime.invokeStructured({
          sessionId: 'provider-test-session',
          role: 'EXTRACTION',
          system: 'system-secret-marker',
          user: 'user-secret-marker',
          schema: z.object({ answer: z.string() })
        }),
      (error: unknown) => error instanceof AppError && error.code === 'MODEL_OUTPUT_INVALID'
    )
    assert.deepEqual(credentialReads, ['SHUAI_API', 'SHUAI_API'])
    const rows = database.prepare('SELECT * FROM model_calls').all() as Array<{
      provider: string
      model: string
    }>
    assert.equal(rows.length, 2)
    assert.ok(rows.every((row) => row.provider === 'SHUAI_API'))
    assert.ok(rows.every((row) => row.model === 'gemini-through-shuai'))
    const persisted = JSON.stringify(rows)
    assert.equal(persisted.includes('sk-test-only'), false)
    assert.equal(persisted.includes('system-secret-marker'), false)
    assert.equal(persisted.includes('user-secret-marker'), false)
  } finally {
    database.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('provider runtime strict structured mode stops after one invalid response', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-provider-strict-'))
  const paths = createAppPaths(root)
  const database = await initializeDatabase(paths.database)
  let fetchAttempts = 0
  try {
    const store = new ProviderConfigStore(paths.providerConfig)
    await store.save(providerConfig)
    const runtime = new ProviderRuntime({
      database,
      configStore: store,
      readCredential: async () => 'sk-test-only',
      fetch: async (...args) => {
        fetchAttempts += 1
        return invalidFetch(...args)
      }
    })
    await assert.rejects(
      () =>
        runtime.invokeStructured({
          sessionId: 'provider-strict-session',
          role: 'EXTRACTION',
          system: 'strict-system',
          user: 'strict-user',
          schema: z.object({ answer: z.string() }),
          repairInvalid: false
        }),
      (error: unknown) => error instanceof AppError && error.code === 'MODEL_OUTPUT_INVALID'
    )
    assert.equal(fetchAttempts, 1)
    assert.equal(
      (database.prepare('SELECT COUNT(*) AS count FROM model_calls').get() as { count: number })
        .count,
      1
    )
  } finally {
    database.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('provider runtime makes one explicit-channel attempt and does not fallback on quota', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-provider-no-fallback-'))
  const paths = createAppPaths(root)
  const database = await initializeDatabase(paths.database)
  const credentialReads: string[] = []
  const requestUrls: string[] = []
  try {
    const store = new ProviderConfigStore(paths.providerConfig)
    await store.save(providerConfig)
    const runtime = new ProviderRuntime({
      database,
      configStore: store,
      readCredential: async (credentialId) => {
        credentialReads.push(credentialId)
        return 'quota-test-key'
      },
      fetch: async (url) => {
        requestUrls.push(url)
        return {
          ok: false,
          status: 429,
          json: async () => ({ error: { code: 'insufficient_quota', message: 'not retained' } })
        }
      }
    })
    await assert.rejects(
      () =>
        runtime.invokeStructured({
          sessionId: 'provider-no-fallback',
          role: 'EXTRACTION',
          system: 'system marker',
          user: 'user marker',
          schema: z.object({ answer: z.string() })
        }),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === 'MODEL_OUTPUT_INVALID' &&
        error.userHint === '模型渠道额度不足，请检查余额或令牌配额。'
    )
    assert.deepEqual(credentialReads, ['SHUAI_API'])
    assert.deepEqual(requestUrls, ['https://api.shuaiapi.com/v1/chat/completions'])
    assert.deepEqual(
      database
        .prepare('SELECT provider, ok FROM model_calls WHERE session_id = ?')
        .all('provider-no-fallback'),
      [{ provider: 'SHUAI_API', ok: 0 }]
    )
  } finally {
    database.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('provider runtime preserves DeepSeek official identity through request, credential, and audit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-provider-deepseek-'))
  const paths = createAppPaths(root)
  const database = await initializeDatabase(paths.database)
  const credentialReads: string[] = []
  const requestUrls: string[] = []
  try {
    const store = new ProviderConfigStore(paths.providerConfig)
    await store.save(providerConfig)
    const runtime = new ProviderRuntime({
      database,
      configStore: store,
      readCredential: async (credentialId) => {
        credentialReads.push(credentialId)
        return 'deepseek-test-key'
      },
      fetch: async (url) => {
        requestUrls.push(url)
        return {
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message: { content: '{"answer":"ok"}' } }] })
        }
      }
    })
    assert.deepEqual(
      await runtime.invokeStructured({
        sessionId: 'provider-deepseek',
        role: 'PLANNING',
        system: 'system marker',
        user: 'user marker',
        schema: z.object({ answer: z.string() })
      }),
      { answer: 'ok' }
    )
    assert.deepEqual(credentialReads, ['DEEPSEEK'])
    assert.deepEqual(requestUrls, ['https://api.deepseek.com/v1/chat/completions'])
    assert.deepEqual(
      database
        .prepare('SELECT provider, model, ok FROM model_calls WHERE session_id = ?')
        .all('provider-deepseek'),
      [{ provider: 'DEEPSEEK_OFFICIAL', model: 'scripted-planning', ok: 1 }]
    )
  } finally {
    database.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('provider runtime maps one network failure without retry or credential leakage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-provider-network-'))
  const paths = createAppPaths(root)
  const database = await initializeDatabase(paths.database)
  let attempts = 0
  try {
    const store = new ProviderConfigStore(paths.providerConfig)
    await store.save(providerConfig)
    const runtime = new ProviderRuntime({
      database,
      configStore: store,
      readCredential: async () => 'network-secret-key',
      fetch: async () => {
        attempts += 1
        throw new Error('network response with secret marker')
      }
    })
    await assert.rejects(
      () =>
        runtime.invokeStructured({
          sessionId: 'provider-network',
          role: 'VISION',
          system: 'system marker',
          user: 'user marker',
          schema: z.object({ answer: z.string() })
        }),
      (error: unknown) => error instanceof AppError && error.code === 'MODEL_TIMEOUT'
    )
    assert.equal(attempts, 1)
    const persisted = JSON.stringify(
      database.prepare('SELECT * FROM model_calls WHERE session_id = ?').all('provider-network')
    )
    assert.equal(persisted.includes('network-secret-key'), false)
    assert.equal(persisted.includes('secret marker'), false)
  } finally {
    database.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('provider runtime fails before transport when the selected channel credential is missing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-provider-missing-credential-'))
  const paths = createAppPaths(root)
  const database = await initializeDatabase(paths.database)
  let attempts = 0
  try {
    const store = new ProviderConfigStore(paths.providerConfig)
    await store.save(providerConfig)
    const runtime = new ProviderRuntime({
      database,
      configStore: store,
      readCredential: async () => undefined,
      fetch: async () => {
        attempts += 1
        throw new Error('transport must not run')
      }
    })
    await assert.rejects(
      () =>
        runtime.invokeStructured({
          sessionId: 'provider-missing-credential',
          role: 'EXTRACTION',
          system: 'system marker',
          user: 'user marker',
          schema: z.object({ answer: z.string() })
        }),
      (error: unknown) => error instanceof AppError && error.code === 'MODEL_UNAUTHORIZED'
    )
    assert.equal(attempts, 0)
    assert.equal(
      (
        database
          .prepare('SELECT COUNT(*) AS count FROM model_calls WHERE session_id = ?')
          .get('provider-missing-credential') as { count: number }
      ).count,
      0
    )
  } finally {
    database.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('provider runtime rejects one non-JSON response without retry or raw retention', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-provider-non-json-'))
  const paths = createAppPaths(root)
  const database = await initializeDatabase(paths.database)
  let attempts = 0
  try {
    const store = new ProviderConfigStore(paths.providerConfig)
    await store.save(providerConfig)
    const runtime = new ProviderRuntime({
      database,
      configStore: store,
      readCredential: async () => 'non-json-test-key',
      fetch: async () => {
        attempts += 1
        return {
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError('raw non-json secret marker')
          }
        }
      }
    })
    await assert.rejects(
      () =>
        runtime.invokeStructured({
          sessionId: 'provider-non-json',
          role: 'EXTRACTION',
          system: 'system marker',
          user: 'user marker',
          schema: z.object({ answer: z.string() })
        }),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === 'MODEL_OUTPUT_INVALID' &&
        error.userHint === '模型服务返回了无法验证的结果，请检查渠道配置。'
    )
    assert.equal(attempts, 1)
    const persisted = JSON.stringify(
      database.prepare('SELECT * FROM model_calls WHERE session_id = ?').all('provider-non-json')
    )
    assert.equal(persisted.includes('non-json-test-key'), false)
    assert.equal(persisted.includes('raw non-json secret marker'), false)
  } finally {
    database.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('legacy provider config remains readable without an implicit rewrite', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-provider-legacy-'))
  const paths = createAppPaths(root)
  const legacy = {
    version: 1,
    active: {
      version: 1,
      provider: 'OPENAI',
      baseUrl: 'https://legacy.example/v1',
      roles: Object.fromEntries(
        ['EXTRACTION', 'PLANNING', 'REVIEW', 'VISION'].map((role) => [
          role,
          {
            model: `legacy-${role.toLowerCase()}`,
            currency: 'USD',
            inputMinorPerMillion: null,
            outputMinorPerMillion: null
          }
        ])
      )
    }
  }
  await writeFile(paths.providerConfig, `${JSON.stringify(legacy)}\n`, 'utf8')
  const before = await readFile(paths.providerConfig, 'utf8')
  const database = await initializeDatabase(paths.database)
  try {
    const store = new ProviderConfigStore(paths.providerConfig)
    const summary = await store.summary()
    assert.equal(summary.version, 1)
    assert.equal(summary.provider, 'OPENAI')
    assert.equal(summary.routes?.PLANNING.channel, 'OPENAI')
    const credentialReads: string[] = []
    const requestUrls: string[] = []
    const runtime = new ProviderRuntime({
      database,
      configStore: store,
      readCredential: async (credentialId) => {
        credentialReads.push(credentialId)
        return 'legacy-test-key'
      },
      fetch: async (url) => {
        requestUrls.push(url)
        return {
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message: { content: '{"answer":"legacy"}' } }] })
        }
      }
    })
    assert.deepEqual(
      await runtime.invokeStructured({
        sessionId: 'provider-legacy',
        role: 'REVIEW',
        system: 'system marker',
        user: 'user marker',
        schema: z.object({ answer: z.string() })
      }),
      { answer: 'legacy' }
    )
    assert.deepEqual(credentialReads, ['OPENAI'])
    assert.deepEqual(requestUrls, ['https://legacy.example/v1/chat/completions'])
    assert.deepEqual(
      database
        .prepare('SELECT provider, model FROM model_calls WHERE session_id = ?')
        .all('provider-legacy'),
      [{ provider: 'OPENAI', model: 'legacy-review' }]
    )
    assert.equal(await readFile(paths.providerConfig, 'utf8'), before)
  } finally {
    database.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('invalid v2 provider roots fail closed without rewriting the file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-provider-invalid-v2-'))
  const paths = createAppPaths(root)
  const invalid = {
    version: 2,
    active: {
      ...providerConfig,
      channels: {
        ...providerConfig.channels,
        SHUAI_API: { baseUrl: 'https://api.shuaiapi.com/v1' }
      }
    }
  }
  const raw = `${JSON.stringify(invalid)}\n`
  await writeFile(paths.providerConfig, raw, 'utf8')
  try {
    const store = new ProviderConfigStore(paths.providerConfig)
    await assert.rejects(
      () => store.summary(),
      (error: unknown) => error instanceof AppError && error.code === 'INTERNAL_SCHEMA_MISMATCH'
    )
    assert.equal(await readFile(paths.providerConfig, 'utf8'), raw)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('two invalid interview outputs block without appending a TravelState event', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-invalid-interview-'))
  const kernel = await createKernel(root, invalidFetch)
  try {
    const session = await kernel.context.coordinator.createSession('invalid interview')
    const before = await kernel.context.eventLog.read(session.sessionId)
    const outcome = await kernel.context.coordinator.submitChatTurn(session.sessionId, '想去成都')
    assert.equal(outcome.kind, 'BLOCKED')
    if (outcome.kind === 'BLOCKED') assert.equal(outcome.error.code, 'MODEL_OUTPUT_INVALID')
    assert.equal((await kernel.context.eventLog.read(session.sessionId)).length, before.length)
    assert.equal(
      (
        kernel.database.prepare('SELECT COUNT(*) AS count FROM model_calls').get() as {
          count: number
        }
      ).count,
      2
    )
  } finally {
    await stopKernel(kernel.context, kernel.database)
    await rm(root, { recursive: true, force: true })
  }
})

test('canonical Chengdu interview reaches confirmation within five user turns', async () => {
  const scripted = [
    {
      patch: {
        destinationCities: ['成都'],
        destinationIntent: null,
        dates: { kind: 'FLEXIBLE', month: '2026-05', durationDays: 4 }
      },
      readiness: 'INCOMPLETE',
      nextQuestion: '全家从哪个城市出发？',
      blockingReason: null
    },
    {
      patch: { originCities: ['上海'] },
      readiness: 'INCOMPLETE',
      nextQuestion: '同行有几位成人、儿童或老人？',
      blockingReason: null
    },
    {
      patch: {
        travelers: [
          {
            count: 2,
            ageBand: 'ADULT',
            relationship: '夫妻',
            stamina: 'MEDIUM',
            careNeeds: [],
            functionalLimits: []
          }
        ]
      },
      readiness: 'INCOMPLETE',
      nextQuestion: '这趟旅行的总预算和包含范围是什么？',
      blockingReason: null
    },
    {
      patch: {
        budget: {
          currency: 'CNY',
          basis: 'TOTAL',
          targetMinor: 800_000,
          flexibleRangeMinor: { min: 700_000, max: 900_000 },
          hardCapMinor: null,
          inclusions: ['TRANSPORT', 'ACCOMMODATION', 'MEALS']
        }
      },
      readiness: 'INCOMPLETE',
      nextQuestion: '偏好轻松、均衡还是紧凑的节奏？',
      blockingReason: null
    },
    {
      patch: {
        intensity: 'BALANCED',
        preferences: {
          hardConstraints: [],
          softPreferences: ['本地餐饮'],
          negotiableVariables: ['酒店区域']
        },
        staySegments: 1
      },
      readiness: 'READY',
      nextQuestion: null,
      blockingReason: null
    }
  ].map((value) => JSON.stringify(value))
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-canonical-'))
  const kernel = await createKernel(root, sequenceFetch(scripted))
  try {
    const session = await kernel.context.coordinator.createSession('成都家庭旅行')
    const inputs = [
      '我们一家想五月去成都玩四天',
      '上海',
      '两位成人',
      '总预算八千含交通住宿餐饮',
      '均衡'
    ]
    let outcome
    for (const input of inputs)
      outcome = await kernel.context.coordinator.submitChatTurn(session.sessionId, input)
    assert.equal(outcome?.kind, 'CONFIRMATION')
    assert.equal(kernel.context.travelState.get(session.sessionId)?.interviewTurns, 5)
    assert.equal(
      (
        kernel.database.prepare('SELECT COUNT(*) AS count FROM model_calls').get() as {
          count: number
        }
      ).count,
      5
    )
  } finally {
    await stopKernel(kernel.context, kernel.database)
    await rm(root, { recursive: true, force: true })
  }
})

test('two-city input reports exact envelope error and holds STAGE_1', async () => {
  const output = JSON.stringify({
    patch: basics(['成都', '重庆']),
    readiness: 'READY',
    nextQuestion: null,
    blockingReason: null
  })
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-envelope-'))
  const kernel = await createKernel(root, sequenceFetch([output]))
  try {
    const session = await kernel.context.coordinator.createSession('双城')
    const outcome = await kernel.context.coordinator.submitChatTurn(
      session.sessionId,
      '想去成都和重庆两个城市'
    )
    assert.equal(outcome.kind, 'OUT_OF_ENVELOPE')
    if (outcome.kind === 'OUT_OF_ENVELOPE') {
      assert.equal(outcome.error.code, 'INPUT_OUT_OF_ENVELOPE')
      assert.equal(outcome.comparison.assessment.violations[0]?.dimension, 'DESTINATION_COUNT')
      assert.deepEqual(
        outcome.comparison.options.map((option) => option.id),
        ['SPLIT', 'SHRINK']
      )
      for (const option of outcome.comparison.options) {
        assert.ok(option.gains && option.losses && option.manualBurden && option.qualityDifference)
      }
    }
    assert.equal(kernel.context.travelState.get(session.sessionId)?.stage, 'STAGE_1')
    assert.equal(
      (await kernel.context.eventLog.read(session.sessionId)).some(
        (event) => event.type === 'stage/confirmed'
      ),
      false
    )
  } finally {
    await stopKernel(kernel.context, kernel.database)
    await rm(root, { recursive: true, force: true })
  }
})

test('split is contiguous, atomic in projection, and recoverable after database deletion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-split-'))
  const kernel = await createKernel(root, invalidFetch)
  const parent = await kernel.context.coordinator.createSession('双城行程')
  await kernel.context.coordinator.record({
    sessionId: parent.sessionId,
    eventVersion: 2,
    type: 'basics/updated',
    payload: {
      basics: basics(['成都', '重庆']),
      interviewTurns: 1,
      destinationResearchRequired: false
    }
  })
  const children = await kernel.context.coordinator.chooseEnvelope({
    sessionId: parent.sessionId,
    decision: 'SPLIT',
    rationale: '保留双城覆盖',
    retainedDestinationCities: []
  })
  assert.deepEqual(
    children.map((child) => child.splitIndex),
    [1, 2]
  )
  assert.equal(new Set(children.map((child) => child.linkedSessionGroup)).size, 1)
  assert.equal(
    (
      kernel.database.prepare('SELECT COUNT(*) AS count FROM decision_logs').get() as {
        count: number
      }
    ).count,
    1
  )
  assert.equal(
    (
      kernel.database.prepare('SELECT COUNT(*) AS count FROM day_skeletons').get() as {
        count: number
      }
    ).count,
    4
  )
  for (const child of children) {
    const confirmed = await kernel.context.coordinator.confirmBasics(child.sessionId)
    assert.ok('sessionId' in confirmed)
    if ('sessionId' in confirmed) assert.equal(confirmed.stage, 'STAGE_2')
  }
  const statesBefore = children.map((child) => kernel.context.travelState.get(child.sessionId))
  await stopKernel(kernel.context, kernel.database)

  await rm(kernel.paths.database)
  const rebuilt = await createKernel(root, invalidFetch)
  try {
    await rebuilt.context.travelState.rebuildAll()
    await rebuilt.context.coordinator.reconcileSplits()
    const rebuiltChildren = rebuilt.context.session
      .list()
      .filter((session) => session.linkedSessionGroup === children[0]!.linkedSessionGroup)
    assert.deepEqual(
      rebuiltChildren.map((child) => child.splitIndex),
      [1, 2]
    )
    assert.deepEqual(
      rebuiltChildren.map((child) => rebuilt.context.travelState.get(child.sessionId)),
      statesBefore
    )
    assert.equal(
      (
        rebuilt.database.prepare('SELECT COUNT(*) AS count FROM decision_logs').get() as {
          count: number
        }
      ).count,
      1
    )
    assert.equal(
      (
        rebuilt.database.prepare('SELECT COUNT(*) AS count FROM day_skeletons').get() as {
          count: number
        }
      ).count,
      4
    )
  } finally {
    await stopKernel(rebuilt.context, rebuilt.database)
    await rm(root, { recursive: true, force: true })
  }
})
