import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { Context } from 'cordis'
import { serializeError } from '../shared/errors'
import type { EvidenceClaim } from '../shared/schema/evidence'
import {
  D4ProgressEventSchema,
  FixedDestinationConfirmRequestSchema,
  ManualResearchChecklistRequestSchema,
  SourceSubagentTaskSchema,
  UserPasteRequestSchema
} from '../shared/schema/d4'
import type { TravelBasics } from '../shared/schema/interview'
import type { XhsSearchFeedRaw } from '../shared/schema/mcp/xiaohongshu'
import type { ProviderConfig } from '../shared/schema/provider'
import { SessionEventSchema } from '../shared/schema/session-event'
import {
  applyPromotionOverride,
  buildResearchEntities,
  normalizeEvidenceSubject,
  unresolvedHardAnchorConflicts,
  verifyEvidenceClaims
} from './evidence-rules'
import { applyMigrations } from './db/migrate'
import type { McpToolDescriptor, SourceSession } from './mcp/client'
import { SOURCE_DEFINITIONS } from './mcp/source-catalog'
import { runXhsResearch } from './mcp/sources/xiaohongshu'
import { createAppPaths, sessionEventLogPath } from './paths'
import { eventLogPlugin } from './plugins/event-log'
import { PolicyService, policyPlugin } from './plugins/policy'
import { providerPlugin } from './plugins/provider-runtime'
import { sessionPlugin } from './plugins/session'
import { gateDiscoveredTools, toolsPlugin, type ToolRegistryConfig } from './plugins/tool-registry'
import { travelStatePlugin } from './plugins/travel-state'
import { coordinatorPlugin, currentOperationResearchClaims } from './plugins/coordinator'
import { ProviderConfigStore } from './provider-config-store'
import { SourceConfigStore } from './source-config-store'
import { buildXhsDestinationTasks, SourceSubagentRunner } from './source-subagent'
import { isResearchExtractionEligible, materializeFacts } from './skills/s04-research'

const NOW = new Date('2026-08-26T04:00:00.000Z')
const D4_PROVIDER_CONFIG: ProviderConfig = {
  version: 2,
  channels: {
    DEEPSEEK_OFFICIAL: { baseUrl: 'https://api.deepseek.com' },
    SHUAI_API: { baseUrl: 'https://api.shuaiapi.com' }
  },
  roles: {
    EXTRACTION: {
      channel: 'SHUAI_API',
      model: 'xhs-extraction-model',
      currency: 'CNY',
      inputMinorPerMillion: null,
      outputMinorPerMillion: null
    },
    PLANNING: {
      channel: 'DEEPSEEK_OFFICIAL',
      model: 'planning-model',
      currency: 'CNY',
      inputMinorPerMillion: null,
      outputMinorPerMillion: null
    },
    REVIEW: {
      channel: 'DEEPSEEK_OFFICIAL',
      model: 'xhs-review-model',
      currency: 'CNY',
      inputMinorPerMillion: null,
      outputMinorPerMillion: null
    },
    VISION: {
      channel: 'SHUAI_API',
      model: 'vision-model',
      currency: 'CNY',
      inputMinorPerMillion: null,
      outputMinorPerMillion: null
    }
  }
}
const BASICS: TravelBasics = {
  originCities: ['上海'],
  destinationCities: ['成都'],
  destinationIntent: null,
  travelers: [
    {
      count: 2,
      ageBand: 'ADULT',
      relationship: '家人',
      stamina: 'MEDIUM',
      careNeeds: [],
      functionalLimits: []
    },
    {
      count: 1,
      ageBand: 'OLDER_ADULT',
      relationship: '长辈',
      stamina: 'LOW',
      careNeeds: [],
      functionalLimits: []
    },
    {
      count: 1,
      ageBand: 'CHILD',
      relationship: '孩子',
      stamina: 'MEDIUM',
      careNeeds: [],
      functionalLimits: []
    }
  ],
  dates: { kind: 'FIXED', startDate: '2026-10-01', endDate: '2026-10-04' },
  budget: {
    currency: 'CNY',
    basis: 'TOTAL',
    targetMinor: 1200000,
    flexibleRangeMinor: null,
    hardCapMinor: null,
    inclusions: ['TRANSPORT', 'ACCOMMODATION', 'MEALS']
  },
  intensity: 'RELAXED',
  preferences: { hardConstraints: [], softPreferences: [], negotiableVariables: [] },
  staySegments: 1
}

type TestToolRegistryOptions = Pick<ToolRegistryConfig, 'createSession' | 'readCredential' | 'log'>

function claim(
  input: Partial<EvidenceClaim> & Pick<EvidenceClaim, 'claimId' | 'sourceId' | 'sourceRef'>
): EvidenceClaim {
  return {
    claimId: input.claimId,
    sessionId: input.sessionId ?? 'd4-session',
    subject: input.subject ?? '武侯祠',
    predicate: input.predicate ?? 'openingHours',
    value: input.value ?? '09:00-18:00',
    sourceId: input.sourceId,
    sourceRef: input.sourceRef,
    contentIdentity: input.contentIdentity ?? 'OFFICIAL',
    verificationStatus: input.verificationStatus ?? 'VERIFIED',
    observedAt: input.observedAt ?? NOW.toISOString(),
    validUntil: input.validUntil ?? '2026-08-27T04:00:00.000Z',
    confidence: input.confidence ?? 0.9,
    conflictsWith: input.conflictsWith ?? [],
    notes: input.notes ?? null
  }
}

test('AC-M0-10 preserves three source claims while grouping known 武侯祠 aliases', () => {
  const claims = [
    claim({
      claimId: 'claim-official',
      sourceId: 'SRC_SEARCH',
      sourceRef: 'https://a.example/1',
      subject: '武侯祠'
    }),
    claim({
      claimId: 'claim-map',
      sourceId: 'SRC_MAP',
      sourceRef: 'SRC_MAP:maps_geo:1',
      subject: '成都武侯祠博物馆',
      predicate: 'coordinates',
      value: { city: '成都', lng: 104.04, lat: 30.64 }
    }),
    claim({
      claimId: 'claim-ugc',
      sourceId: 'SRC_SEARCH',
      sourceRef: 'https://b.example/2',
      subject: '武侯祠·锦里',
      contentIdentity: 'INDEPENDENT_UGC'
    })
  ]
  const entities = buildResearchEntities({
    destinationCity: '成都',
    claims,
    travelers: BASICS.travelers
  })
  assert.equal(normalizeEvidenceSubject('成都武侯祠博物馆'), '武侯祠')
  assert.equal(entities.length, 1)
  assert.deepEqual(new Set(entities[0]?.claimIds), new Set(claims.map((item) => item.claimId)))
  assert.equal(new Set(claims.map((item) => item.sourceRef)).size, 3)
})

test('entity grouping scopes by kind and keeps unsupported ambiguous duplicates separate', () => {
  const attraction = claim({
    claimId: 'same-name-attraction',
    sourceId: 'SRC_SEARCH',
    sourceRef: 'https://attraction.example',
    subject: '同名空间'
  })
  const food = claim({
    claimId: 'same-name-food',
    sourceId: 'SRC_MAP',
    sourceRef: 'SRC_MAP:maps_geo:same-name',
    subject: '同名空间',
    predicate: 'coordinates'
  })
  const incompatibleKinds = buildResearchEntities({
    destinationCity: '成都',
    claims: [attraction, food],
    travelers: BASICS.travelers,
    kinds: new Map([
      [attraction.claimId, 'ATTRACTION'],
      [food.claimId, 'FOOD']
    ])
  })
  assert.equal(incompatibleKinds.length, 2)
  assert.deepEqual(
    new Set(incompatibleKinds.map((entity) => entity.kind)),
    new Set(['ATTRACTION', 'FOOD'])
  )
  assert.equal(new Set(incompatibleKinds.map((entity) => entity.entityId)).size, 2)

  const ambiguous = buildResearchEntities({
    destinationCity: '成都',
    claims: [
      { ...attraction, claimId: 'ambiguous-a', sourceRef: 'https://ambiguous.example/a' },
      { ...attraction, claimId: 'ambiguous-b', sourceRef: 'https://ambiguous.example/b' }
    ],
    travelers: BASICS.travelers
  })
  assert.equal(ambiguous.length, 2)
  assert.equal(
    ambiguous.every((entity) => entity.identityStatus === 'AMBIGUOUS'),
    true
  )
})

test('SKILL-04 rejects a structured fact that crosses the selected destination boundary', () => {
  const source = claim({
    claimId: 'cross-city-source',
    sourceId: 'SRC_SEARCH',
    sourceRef: 'https://research.example/chengdu',
    subject: '成都研究结果'
  })
  assert.throws(
    () =>
      materializeFacts('d4-session', '成都', [source], {
        facts: [
          {
            sourceClaimId: source.claimId,
            destinationCity: '重庆',
            subject: '同名空间',
            predicate: 'openingHours',
            value: '09:00-18:00',
            kind: 'ATTRACTION',
            aliases: []
          }
        ]
      }),
    /跨越了当前目的地边界/
  )
})

test('research extraction only consumes claims returned by the current destination operation', () => {
  const current = claim({
    claimId: 'current-destination-claim',
    sourceId: 'SRC_SEARCH',
    sourceRef: 'https://research.example/current'
  })
  const previous = claim({
    claimId: 'previous-destination-claim',
    sourceId: 'SRC_SEARCH',
    sourceRef: 'https://research.example/previous'
  })
  const selected = currentOperationResearchClaims(
    [previous, current],
    [
      {
        taskId: '55555555-5555-4555-8555-555555555555',
        sourceId: 'SRC_SEARCH',
        status: 'SUCCEEDED',
        claimIds: [current.claimId]
      }
    ]
  )
  assert.deepEqual(
    selected.map((item) => item.claimId),
    [current.claimId]
  )
})

test('AC-M0-11 deterministic promotion override blocks promotion-only support', () => {
  const promoted = applyPromotionOverride(
    claim({
      claimId: 'promotion',
      sourceId: 'SRC_SEARCH',
      sourceRef: 'https://promo.example/item',
      value: '专属优惠码，下单立减 50 元'
    })
  )
  assert.equal(promoted.contentIdentity, 'SUSPECTED_PROMOTION')
  assert.equal(promoted.verificationStatus, 'UNVERIFIED')
  const entity = buildResearchEntities({
    destinationCity: '成都',
    claims: [promoted],
    travelers: BASICS.travelers
  })[0]
  assert.equal(entity?.promotionOnlySupport, true)
  assert.match(entity?.blockingReasons.join('') ?? '', /不能单独支撑推荐/)
})

test('AC-M0-12 member fit explains older-adult and child risk; missing evidence stays unknown', () => {
  const risky = claim({
    claimId: 'stairs',
    sourceId: 'SRC_SEARCH',
    sourceRef: 'https://walk.example/route',
    predicate: 'physicalDemand',
    value: '长时间爬坡，并包含大量台阶'
  })
  const risk = buildResearchEntities({
    destinationCity: '成都',
    claims: [risky],
    travelers: BASICS.travelers
  })[0]?.fitness
  assert.equal(risk?.status, 'RISK')
  assert.match(risk?.reasons.join('') ?? '', /老人/)
  assert.match(risk?.reasons.join('') ?? '', /儿童/)
  const unknown = buildResearchEntities({
    destinationCity: '成都',
    claims: [
      claim({ claimId: 'plain', sourceId: 'SRC_SEARCH', sourceRef: 'https://plain.example' })
    ],
    travelers: BASICS.travelers
  })[0]?.fitness
  assert.equal(unknown?.status, 'UNKNOWN')
})

test('AC-M0-13 conflicts remain bilateral and block only unresolved MUST_GO hard anchors', () => {
  const input = [
    claim({
      claimId: 'hours-a',
      sourceId: 'SRC_SEARCH',
      sourceRef: 'https://official.example/hours',
      value: '09:00-18:00'
    }),
    claim({
      claimId: 'hours-b',
      sourceId: 'SRC_MAP',
      sourceRef: 'SRC_MAP:maps_geo:hours',
      value: '10:00-17:00'
    })
  ]
  const verified = verifyEvidenceClaims(input, NOW)
  assert.equal(
    verified.every((item) => item.verificationStatus === 'CONFLICTED'),
    true
  )
  assert.deepEqual(verified[0]?.conflictsWith, ['hours-b'])
  assert.deepEqual(verified[1]?.conflictsWith, ['hours-a'])
  const entity = buildResearchEntities({
    destinationCity: '成都',
    claims: verified,
    travelers: BASICS.travelers
  })[0]!
  const mustGo = { ...entity, disposition: 'MUST_GO' as const }
  assert.deepEqual(
    unresolvedHardAnchorConflicts([mustGo], verified, []).map((item) => item.entityId),
    [mustGo.entityId]
  )
  assert.equal(
    unresolvedHardAnchorConflicts([mustGo], verified, [
      {
        subject: '武侯祠',
        predicate: 'openingHours',
        resolution: 'CLAIM_SELECTED',
        selectedClaimId: 'hours-a',
        resolvedAt: NOW.toISOString()
      }
    ]).length,
    0
  )
})

test('freshness and independent corroboration use the injected clock', () => {
  const stale = claim({
    claimId: 'stale',
    sourceId: 'SRC_SEARCH',
    sourceRef: 'https://old.example',
    validUntil: '2026-08-25T04:00:00.000Z'
  })
  const sameA = claim({ claimId: 'same-a', sourceId: 'SRC_SEARCH', sourceRef: 'https://a.example' })
  const sameB = claim({
    claimId: 'same-b',
    sourceId: 'SRC_MAP',
    sourceRef: 'SRC_MAP:maps_geo:same'
  })
  const output = verifyEvidenceClaims([stale, sameA, sameB], NOW)
  assert.equal(output.find((item) => item.claimId === 'stale')?.verificationStatus, 'STALE')
  assert.equal(output.find((item) => item.claimId === 'same-a')?.verificationStatus, 'CORROBORATED')
  assert.equal(output.find((item) => item.claimId === 'same-b')?.verificationStatus, 'CORROBORATED')
})

test('Source Subagent accepts only minimal reviewed tasks, runs serially, and never retries or falls back', async () => {
  const seen: string[] = []
  let calls = 0
  const runner = new SourceSubagentRunner(async (task) => {
    calls += 1
    seen.push(task.sourceId)
    assert.deepEqual(Object.keys(task).sort(), [
      'destination',
      'memberConstraints',
      'query',
      'sessionId',
      'sourceId',
      'taskId',
      'toolName'
    ])
    if (task.sourceId === 'SRC_SEARCH') throw new Error('fixture source failure')
    return ['map-claim']
  })
  const results = await runner.runSerial([
    SourceSubagentTaskSchema.parse({
      taskId: '11111111-1111-4111-8111-111111111111',
      sessionId: 's',
      sourceId: 'SRC_SEARCH',
      destination: '成都',
      query: '成都 景点',
      toolName: 'deepseek_web_search',
      memberConstraints: []
    }),
    SourceSubagentTaskSchema.parse({
      taskId: '22222222-2222-4222-8222-222222222222',
      sessionId: 's',
      sourceId: 'SRC_MAP',
      destination: '成都',
      query: '武侯祠',
      toolName: 'maps_geo',
      memberConstraints: []
    })
  ])
  assert.equal(calls, 2)
  assert.deepEqual(seen, ['SRC_SEARCH', 'SRC_MAP'])
  assert.equal(results[0]?.status, 'FAILED')
  assert.equal(results[1]?.status, 'SUCCEEDED')
  assert.throws(() =>
    SourceSubagentTaskSchema.parse({
      taskId: '33333333-3333-4333-8333-333333333333',
      sessionId: 's',
      sourceId: 'SRC_SEARCH',
      destination: '成都',
      query: 'x',
      toolName: 'maps_geo',
      memberConstraints: [],
      travelState: {}
    })
  )
})

test('Xiaohongshu task builder emits one location query and one avoidance query in fixed order', () => {
  const tasks = buildXhsDestinationTasks({
    sessionId: 'd4-session',
    destination: ' 成都 ',
    memberConstraints: [{ count: 1, ageBand: 'OLDER_ADULT', stamina: 'LOW', functionalLimits: [] }]
  })

  assert.equal(tasks.length, 2)
  assert.deepEqual(
    tasks.map((task) => {
      assert.equal(task.sourceId, 'SRC_XHS')
      if (task.sourceId !== 'SRC_XHS') throw new Error('unexpected fixture task')
      return {
        sourceId: task.sourceId,
        destination: task.destination,
        query: task.query,
        queryKind: task.queryKind,
        toolName: task.toolName
      }
    }),
    [
      {
        sourceId: 'SRC_XHS',
        destination: '成都',
        query: '成都',
        queryKind: 'POSITIVE_LOCATION',
        toolName: 'search_feeds'
      },
      {
        sourceId: 'SRC_XHS',
        destination: '成都',
        query: '避雷 成都',
        queryKind: 'NEGATIVE_AVOIDANCE',
        toolName: 'search_feeds'
      }
    ]
  )
})

test('Xiaohongshu adapter keeps complete source rows, bounds detail reads, and drops xsec tokens', async () => {
  const calls: Array<{ toolName: string; args: Record<string, unknown> }> = []
  const tokens = ['transient-token-a', 'transient-token-b', 'transient-token-c']
  const feeds = tokens.map((xsecToken, index) => ({
    id: `note000${index + 1}`,
    xsecToken,
    modelType: 'note',
    noteCard: {
      type: 'normal',
      displayTitle: `成都线索 ${index + 1}`,
      user: { userId: `user-${index + 1}`, nickname: `作者 ${index + 1}` }
    }
  }))

  const result = await runXhsResearch({
    queryKind: 'NEGATIVE_AVOIDANCE',
    query: '避雷 成都',
    invoke: async (toolName, args) => {
      calls.push({ toolName, args })
      if (toolName === 'search_feeds') {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ feeds, count: feeds.length })
            }
          ]
        }
      }
      const feedId = String(args.feed_id)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              feed_id: feedId,
              data: {
                note: {
                  noteId: feedId,
                  xsecToken: String(args.xsec_token),
                  title: `详情 ${feedId}`,
                  desc: feedId === 'note0001' ? '避雷信息'.repeat(1200) : '排队较久，注意时段',
                  type: 'normal',
                  user: { nickname: `详情作者 ${feedId}` }
                },
                comments: { items: ['不读取评论分页'] }
              }
            })
          }
        ]
      }
    }
  })

  assert.deepEqual(
    calls.map((item) => item.toolName),
    ['search_feeds', 'get_feed_detail', 'get_feed_detail']
  )
  assert.deepEqual(calls[0]?.args, { keyword: '避雷 成都' })
  assert.deepEqual(calls[1]?.args, {
    feed_id: 'note0001',
    xsec_token: tokens[0],
    load_all_comments: false
  })
  assert.equal(result.notes.length, 3)
  assert.equal(result.notes.filter((note) => note.enriched).length, 2)
  assert.equal(result.notes[0]?.text.length, 4000)
  assert.equal(result.notes[2]?.text, '')
  assert.deepEqual(
    result.notes.map((note) => note.sourceUrl),
    [
      'https://www.xiaohongshu.com/explore/note0001',
      'https://www.xiaohongshu.com/explore/note0002',
      'https://www.xiaohongshu.com/explore/note0003'
    ]
  )
  assert.deepEqual(result.audit, {
    searchCalls: 1,
    detailCalls: 2,
    retainedSourceCount: 3,
    detailCharacters: result.notes[0]!.text.length + result.notes[1]!.text.length,
    truncatedDetailCount: 1,
    detailFailureCount: 0,
    retryCount: 0
  })
  const serialized = JSON.stringify(result)
  for (const token of tokens) assert.equal(serialized.includes(token), false)
  assert.equal(serialized.includes('comments'), false)
})

test('Xiaohongshu discovery registers only the four reviewed read and login tools', () => {
  const definition = SOURCE_DEFINITIONS.SRC_XHS
  const writeTools = [
    'publish_content',
    'publish_with_video',
    'post_comment_to_feed',
    'reply_comment_in_feed',
    'like_feed',
    'favorite_feed',
    'delete_cookies'
  ]
  const discovered: McpToolDescriptor[] = [
    ...Object.keys(definition.tools).map((name) => ({
      name,
      description: '只读工具',
      inputSchema: {}
    })),
    ...writeTools.map((name) => ({ name, description: '写入或登录工具', inputSchema: {} }))
  ]
  const blocked: Array<{ name: string; reason: string }> = []
  const registered = gateDiscoveredTools({
    policy: new PolicyService(),
    sourceId: 'SRC_XHS',
    discovered,
    allowlist: definition.allowlist,
    contracts: definition.tools,
    recordBlocked: (_sourceId, name, reason) => blocked.push({ name, reason })
  })

  assert.deepEqual([...registered.keys()].sort(), [
    'check_login_status',
    'get_feed_detail',
    'get_login_qrcode',
    'search_feeds'
  ])
  for (const toolName of writeTools) {
    assert.equal(registered.has(toolName), false)
    assert.equal(
      blocked.some((item) => item.name === toolName),
      true
    )
  }
})

test('Xiaohongshu UGC stays unverified, preserves polarity, and only corroborates independently', () => {
  const positive = claim({
    claimId: 'xhs-positive',
    sourceId: 'SRC_XHS',
    sourceRef: 'https://www.xiaohongshu.com/explore/note0001',
    predicate: 'xiaohongshuPositiveResult',
    value: { queryKind: 'POSITIVE_LOCATION', title: '适合带长辈慢游' },
    contentIdentity: 'INDEPENDENT_UGC',
    verificationStatus: 'UNVERIFIED'
  })
  const negative = claim({
    claimId: 'xhs-negative',
    sourceId: 'SRC_XHS',
    sourceRef: 'https://www.xiaohongshu.com/explore/note0002',
    predicate: 'xiaohongshuAvoidanceResult',
    value: { queryKind: 'NEGATIVE_AVOIDANCE', title: '避雷高峰排队' },
    contentIdentity: 'INDEPENDENT_UGC',
    verificationStatus: 'UNVERIFIED'
  })
  const standalone = verifyEvidenceClaims([positive, negative], NOW)

  assert.equal(
    standalone.every((item) => item.verificationStatus === 'UNVERIFIED'),
    true
  )
  assert.equal(
    standalone.every((item) => item.conflictsWith.length === 0),
    true
  )
  assert.equal(standalone.every(isResearchExtractionEligible), true)

  const official = claim({
    claimId: 'official-corroboration',
    sourceId: 'SRC_SEARCH',
    sourceRef: 'https://official.example/slow-travel',
    predicate: positive.predicate,
    value: positive.value
  })
  const corroborated = verifyEvidenceClaims([positive, official], NOW)
  assert.equal(
    corroborated.every((item) => item.verificationStatus === 'CORROBORATED'),
    true
  )

  const promoted = applyPromotionOverride({
    ...positive,
    claimId: 'xhs-promotion',
    value: '专属优惠码，立即下单'
  })
  assert.equal(promoted.contentIdentity, 'SUSPECTED_PROMOTION')
  assert.equal(promoted.verificationStatus, 'UNVERIFIED')
  assert.equal(isResearchExtractionEligible(promoted), false)
})

test('migration 0003 preserves stay candidates and accepts Xiaohongshu evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d4-xhs-migration-'))
  const database = new Database(join(root, 'migration.sqlite'))
  database.pragma('foreign_keys = ON')
  try {
    const [first, second, third] = await Promise.all([
      readFile(new URL('./db/migrations/0001_init.sql', import.meta.url), 'utf8'),
      readFile(new URL('./db/migrations/0002_model_call_cost.sql', import.meta.url), 'utf8'),
      readFile(new URL('./db/migrations/0003_xiaohongshu_source.sql', import.meta.url), 'utf8')
    ])
    applyMigrations(database, [
      { version: 1, sql: first },
      { version: 2, sql: second }
    ])
    database
      .prepare(
        `INSERT INTO sessions (session_id, created_at, stage, last_seq, title)
         VALUES (?, ?, 'STAGE_3', 0, ?)`
      )
      .run('migration-session', NOW.toISOString(), '迁移测试')
    database
      .prepare(
        `INSERT INTO evidence_claims
         (claim_id, session_id, subject, predicate, value_json, source_id, source_ref,
          content_identity, verification_status, observed_at, valid_until, confidence,
          conflicts_with, notes)
         VALUES (?, ?, ?, ?, ?, 'SRC_SEARCH', ?, 'OFFICIAL', 'VERIFIED', ?, ?, 0.9, '[]', NULL)`
      )
      .run(
        'legacy-claim',
        'migration-session',
        '旧证据',
        'openingHours',
        JSON.stringify('09:00-18:00'),
        'https://official.example/legacy',
        NOW.toISOString(),
        '2026-09-02T04:00:00.000Z'
      )
    database
      .prepare(
        `INSERT INTO stay_segments
         (segment_id, session_id, area_hint, check_in_date, check_out_date, nights)
         VALUES ('segment-1', 'migration-session', '锦江区', '2026-10-01', '2026-10-02', 1)`
      )
      .run()
    database
      .prepare(
        `INSERT INTO stay_candidates
         (candidate_id, session_id, segment_id, source_id, name, detail_json, claim_id)
         VALUES ('stay-1', 'migration-session', 'segment-1', 'SRC_SEARCH', '旧住宿候选', '{}', 'legacy-claim')`
      )
      .run()

    applyMigrations(database, [{ version: 3, sql: third }])
    database
      .prepare(
        `INSERT INTO evidence_claims
         (claim_id, session_id, subject, predicate, value_json, source_id, source_ref,
          content_identity, verification_status, observed_at, valid_until, confidence,
          conflicts_with, notes)
         VALUES (?, ?, ?, ?, ?, 'SRC_XHS', ?, 'INDEPENDENT_UGC', 'UNVERIFIED', ?, ?, NULL, '[]', NULL)`
      )
      .run(
        'xhs-claim',
        'migration-session',
        '成都',
        'xiaohongshuPositiveResult',
        JSON.stringify({ queryKind: 'POSITIVE_LOCATION' }),
        'https://www.xiaohongshu.com/explore/note0001',
        NOW.toISOString(),
        '2026-09-02T04:00:00.000Z'
      )

    const stayRow = database
      .prepare("SELECT COUNT(*) AS count FROM stay_candidates WHERE candidate_id = 'stay-1'")
      .get() as { count: number } | undefined
    const xhsRow = database
      .prepare("SELECT source_id FROM evidence_claims WHERE claim_id = 'xhs-claim'")
      .get() as { source_id: string } | undefined
    assert.equal(stayRow?.count, 1)
    assert.equal(xhsRow?.source_id, 'SRC_XHS')
    assert.deepEqual(database.pragma('foreign_key_check'), [])
  } finally {
    database.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('D4 boundary schemas reject credential-bearing URLs and malformed progress pushes', () => {
  assert.equal(
    FixedDestinationConfirmRequestSchema.safeParse({ sessionId: 's', city: ' 成都 ' }).success,
    true
  )
  assert.equal(
    FixedDestinationConfirmRequestSchema.safeParse({
      sessionId: 's',
      city: '成都',
      candidateId: 'forbidden'
    }).success,
    false
  )
  assert.equal(
    SessionEventSchema.safeParse({
      eventId: 'fixed-destination-confirmed',
      sessionId: 's',
      seq: 3,
      timestamp: NOW.toISOString(),
      eventVersion: 2,
      type: 'stage/confirmed',
      payload: {
        fromStage: 'STAGE_2',
        toStage: 'STAGE_3',
        confirmed: true,
        confirmation: { kind: 'FIXED_DESTINATION', city: '成都' }
      }
    }).success,
    true
  )
  assert.equal(
    UserPasteRequestSchema.safeParse({
      sessionId: 's',
      text: '线索',
      sourceUrl: 'https://example.com/page'
    }).success,
    true
  )
  assert.equal(
    UserPasteRequestSchema.safeParse({
      sessionId: 's',
      text: '线索',
      sourceUrl: 'https://example.com/page?api_key=secret'
    }).success,
    false
  )
  assert.equal(
    UserPasteRequestSchema.safeParse({
      sessionId: 's',
      text: '线索',
      sourceUrl: 'http://example.com'
    }).success,
    false
  )
  assert.equal(
    D4ProgressEventSchema.safeParse({
      operationId: '44444444-4444-4444-8444-444444444444',
      sessionId: 's',
      kind: 'COMPLETED',
      sourceId: null,
      message: 'done',
      raw: 'leak'
    }).success,
    false
  )
})

function xhsTextResult(value: unknown): unknown {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] }
}

function xhsFixtureFeed(id: string, xsecToken = `token-${id}`): XhsSearchFeedRaw {
  return {
    id,
    xsecToken,
    modelType: 'note' as const,
    noteCard: {
      type: 'normal',
      displayTitle: `标题 ${id}`,
      user: { nickname: `作者 ${id}` }
    }
  }
}

function xhsFixtureFeeds(prefix: string, count: number): XhsSearchFeedRaw[] {
  return Array.from({ length: count }, (_, index) =>
    xhsFixtureFeed(`${prefix}-${String(index + 1).padStart(4, '0')}`)
  )
}

function xhsSourceSession(
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
): SourceSession {
  return {
    connect: async () => undefined,
    async listTools() {
      return ['search_feeds', 'get_feed_detail'].map((name) => ({
        name,
        description: '只读小红书测试工具',
        inputSchema: {}
      }))
    },
    callTool,
    close: async () => undefined
  }
}

async function createTestKernel(
  root: string,
  toolRegistryOptions: TestToolRegistryOptions = {}
): Promise<{ context: Context; database: Database.Database }> {
  const paths = createAppPaths(root)
  const database = new Database(paths.database)
  const migrationFiles = [
    '0001_init.sql',
    '0002_model_call_cost.sql',
    '0003_xiaohongshu_source.sql',
    '0004_d5_transport_candidates.sql',
    '0005_d7_task_links.sql',
    '0006_user_research_source.sql'
  ]
  applyMigrations(
    database,
    await Promise.all(
      migrationFiles.map(async (name, index) => ({
        version: index + 1,
        sql: await readFile(new URL(`./db/migrations/${name}`, import.meta.url), 'utf8')
      }))
    )
  )
  const context = new Context()
  context.plugin(eventLogPlugin, { paths })
  context.plugin(travelStatePlugin, { database, paths })
  context.plugin(sessionPlugin)
  context.plugin(policyPlugin)
  context.plugin(toolsPlugin, {
    database,
    paths,
    sourceConfigStore: new SourceConfigStore(paths.sourceConfig),
    sleep: async () => undefined,
    ...toolRegistryOptions
  })
  context.plugin(providerPlugin, {
    database,
    configStore: new ProviderConfigStore(paths.providerConfig)
  })
  context.plugin(coordinatorPlugin)
  await context.start()
  return { context, database }
}

async function stopTestKernel(context: Context, database: Database.Database): Promise<void> {
  await context.tools.close()
  await context.eventLog.close()
  database.close()
  await context.stop()
}

async function seedStage2(
  context: Context,
  sessionId: string,
  basics: TravelBasics | null
): Promise<void> {
  await context.coordinator.record({
    sessionId,
    eventVersion: 2,
    type: 'session/created',
    payload: {
      title: '固定目的地确认',
      linkedSessionGroup: null,
      splitIndex: null,
      basics,
      handoffs: []
    }
  })
  await context.coordinator.record({
    sessionId,
    eventVersion: 2,
    type: 'stage/confirmed',
    payload: { fromStage: 'STAGE_1', toStage: 'STAGE_2', confirmed: true }
  })
}

test('fixed destination confirmation records one auditable stage event and replays without candidates', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-fixed-destination-'))
  const paths = createAppPaths(root)
  try {
    const first = await createTestKernel(root)
    const sessionId = 'fixed-destination-session'
    await seedStage2(first.context, sessionId, { ...BASICS, destinationCities: [' 成都 '] })
    const beforeEvents = await first.context.eventLog.read(sessionId)
    const initial = first.context.coordinator.d4Snapshot(sessionId)
    assert.equal(initial.stage, 'STAGE_2')
    assert.equal(initial.fixedDestinationCity, '成都')

    const snapshot = await first.context.coordinator.confirmFixedDestination({
      sessionId,
      city: '成都'
    })
    const afterEvents = await first.context.eventLog.read(sessionId)
    assert.equal(afterEvents.length, beforeEvents.length + 1)
    assert.deepEqual(afterEvents.at(-1)?.payload, {
      fromStage: 'STAGE_2',
      toStage: 'STAGE_3',
      confirmed: true,
      confirmation: { kind: 'FIXED_DESTINATION', city: '成都' }
    })
    assert.equal(snapshot.stage, 'STAGE_3')
    assert.equal(snapshot.fixedDestinationCity, null)
    assert.deepEqual(snapshot.destinationCandidates, [])
    assert.equal(snapshot.selectedDestinationCandidateId, null)
    assert.equal(
      afterEvents.some((event) => event.type === 'destination/selected'),
      false
    )

    const journal = await readFile(sessionEventLogPath(paths, sessionId))
    await stopTestKernel(first.context, first.database)
    await rm(paths.database)
    const second = await createTestKernel(root)
    await second.context.travelState.rebuildAll()
    const rebuilt = second.context.travelState.get(sessionId)
    assert.equal(rebuilt?.stage, 'STAGE_3')
    assert.deepEqual(rebuilt?.destinationCandidates, [])
    assert.equal(rebuilt?.selectedDestinationCandidateId, null)
    assert.deepEqual(await readFile(sessionEventLogPath(paths, sessionId)), journal)
    await stopTestKernel(second.context, second.database)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('fixed destination confirmation fails closed for stale or invalid state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-fixed-destination-invalid-'))
  try {
    const kernel = await createTestKernel(root)
    const cases: Array<{ sessionId: string; basics: TravelBasics | null; city: string }> = [
      { sessionId: 'fixed-no-basics', basics: null, city: '成都' },
      {
        sessionId: 'fixed-zero-cities',
        basics: {
          ...BASICS,
          destinationCities: [],
          destinationIntent: { climate: [], themes: ['美食'], avoid: [] }
        },
        city: '成都'
      },
      {
        sessionId: 'fixed-multiple-cities',
        basics: { ...BASICS, destinationCities: ['成都', '重庆'] },
        city: '成都'
      },
      { sessionId: 'fixed-city-mismatch', basics: BASICS, city: '重庆' }
    ]
    for (const item of cases) {
      await seedStage2(kernel.context, item.sessionId, item.basics)
      const before = (await kernel.context.eventLog.read(item.sessionId)).length
      await assert.rejects(
        kernel.context.coordinator.confirmFixedDestination({
          sessionId: item.sessionId,
          city: item.city
        }),
        (error: unknown) =>
          error instanceof Error && /基础信息|只能包含一个城市|已经变化/.test(error.message)
      )
      assert.equal((await kernel.context.eventLog.read(item.sessionId)).length, before)
    }

    const wrongStageId = 'fixed-wrong-stage'
    await kernel.context.coordinator.record({
      sessionId: wrongStageId,
      eventVersion: 2,
      type: 'session/created',
      payload: {
        title: '错误阶段',
        linkedSessionGroup: null,
        splitIndex: null,
        basics: BASICS,
        handoffs: []
      }
    })
    const beforeWrongStage = (await kernel.context.eventLog.read(wrongStageId)).length
    await assert.rejects(
      kernel.context.coordinator.confirmFixedDestination({ sessionId: wrongStageId, city: '成都' }),
      /STAGE_2/
    )
    assert.equal((await kernel.context.eventLog.read(wrongStageId)).length, beforeWrongStage)

    const repeatId = 'fixed-repeat'
    await seedStage2(kernel.context, repeatId, BASICS)
    await kernel.context.coordinator.confirmFixedDestination({ sessionId: repeatId, city: '成都' })
    const beforeRepeat = (await kernel.context.eventLog.read(repeatId)).length
    await assert.rejects(
      kernel.context.coordinator.confirmFixedDestination({ sessionId: repeatId, city: '成都' }),
      /STAGE_2/
    )
    assert.equal((await kernel.context.eventLog.read(repeatId)).length, beforeRepeat)
    await stopTestKernel(kernel.context, kernel.database)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('D4 XHS ranking preview freezes the exact digest with zero source or model calls', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d4-xhs-preview-'))
  try {
    const kernel = await createTestKernel(root)
    try {
      const sessionId = 'd4-xhs-preview-session'
      await kernel.context.provider.saveConfig(D4_PROVIDER_CONFIG)
      await seedStage2(kernel.context, sessionId, { ...BASICS, destinationCities: [' 昆明 '] })
      await kernel.context.coordinator.confirmFixedDestination({ sessionId, city: '昆明' })
      const beforeEvents = await kernel.context.eventLog.read(sessionId)

      const preview = await kernel.context.coordinator.previewXhsRanking({ sessionId })

      assert.equal(preview.sessionId, sessionId)
      assert.equal(preview.destinationCity, '昆明')
      assert.deepEqual(preview.queries, [
        '昆明 景点推荐 亲子 老人',
        '昆明 小众景点 轻松 少走路',
        '昆明 景点避雷 排队',
        '昆明 景点踩雷 步行 坡度'
      ])
      assert.deepEqual(preview.filters, {
        sort_by: '综合',
        note_type: '图文',
        publish_time: '半年内',
        search_scope: '不限',
        location: '不限'
      })
      assert.deepEqual(
        {
          searchCalls: preview.searchCalls,
          detailCalls: preview.detailCalls,
          detailCharacterLimit: preview.detailCharacterLimit,
          extractionCalls: preview.extractionCalls,
          reviewCalls: preview.reviewCalls,
          retryCount: preview.retryCount,
          loadAllComments: preview.loadAllComments
        },
        {
          searchCalls: 4,
          detailCalls: 30,
          detailCharacterLimit: 4000,
          extractionCalls: 6,
          reviewCalls: 1,
          retryCount: 0,
          loadAllComments: false
        }
      )
      assert.deepEqual(preview.extractionRoute, {
        provider: 'SHUAI_API',
        model: 'xhs-extraction-model'
      })
      assert.deepEqual(preview.reviewRoute, {
        provider: 'DEEPSEEK_OFFICIAL',
        model: 'xhs-review-model'
      })
      assert.match(preview.digest, /^sha256:[a-f0-9]{64}$/)
      assert.deepEqual(await kernel.context.eventLog.read(sessionId), beforeEvents)
      assert.equal(kernel.context.tools.listToolCalls(sessionId).length, 0)
      assert.equal(
        (
          kernel.database
            .prepare('SELECT COUNT(*) AS count FROM model_calls WHERE session_id = ?')
            .get(sessionId) as { count: number }
        ).count,
        0
      )
    } finally {
      await stopTestKernel(kernel.context, kernel.database)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('ToolRegistry accepts official XHS wrappers for the complete 4+30 source batch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d4-xhs-official-success-'))
  const sessionId = 'd4-xhs-official-success-session'
  const tokenSentinel = 'SENTINEL_XSEC_SUCCESS_DO_NOT_PERSIST'
  const commentSentinel = 'SENTINEL_COMMENT_SUCCESS_DO_NOT_PERSIST'
  const rawSentinel = 'SENTINEL_RAW_SUCCESS_DO_NOT_PERSIST'
  const credentialSentinel = 'SENTINEL_CREDENTIAL_SUCCESS_DO_NOT_PERSIST'
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  const logs: Array<{ code: string; message: string; context: Record<string, unknown> }> = []
  const recommend = xhsFixtureFeeds('success-r', 15)
  recommend[0] = xhsFixtureFeed(recommend[0]!.id, tokenSentinel)
  const avoid = xhsFixtureFeeds('success-a', 15)
  const searchRows = [recommend, [recommend[0]!], avoid, [avoid[0]!]]
  let searchIndex = 0
  const kernel = await createTestKernel(root, {
    createSession: () =>
      xhsSourceSession(async (name, args) => {
        calls.push({ name, args })
        if (name === 'search_feeds') {
          const feeds = searchRows[searchIndex++]!
          return xhsTextResult({ feeds, count: feeds.length, raw: rawSentinel })
        }
        const feedId = String(args.feed_id)
        return xhsTextResult({
          feed_id: feedId,
          data: {
            note: {
              noteId: feedId,
              xsecToken: tokenSentinel,
              title: `详情 ${feedId}`,
              desc: `正文 ${feedId}`,
              type: 'normal',
              user: { nickname: `作者 ${feedId}` }
            },
            comments: [{ content: commentSentinel }]
          },
          raw: rawSentinel
        })
      }),
    readCredential: async (credentialId) =>
      credentialId === 'XIAOHONGSHU_MCP_AUTH' ? credentialSentinel : undefined,
    log: (code, message, context) => logs.push({ code, message, context })
  })
  try {
    await seedStage2(kernel.context, sessionId, { ...BASICS, destinationCities: ['昆明'] })
    await kernel.context.coordinator.confirmFixedDestination({ sessionId, city: '昆明' })

    const source = await kernel.context.tools.runXhsRankingResearch({
      sessionId,
      destinationCity: '昆明'
    })

    assert.equal(calls.length, 34)
    assert.deepEqual(
      calls.slice(0, 4).map((call) => call.name),
      ['search_feeds', 'search_feeds', 'search_feeds', 'search_feeds']
    )
    assert.equal(
      calls.slice(4).every((call) => call.name === 'get_feed_detail'),
      true
    )
    assert.equal(source.claims.length, 30)
    assert.deepEqual(
      {
        searchCalls: source.sampleSummary.searchCalls,
        detailCalls: source.sampleSummary.detailCalls,
        retryCount: source.sampleSummary.retryCount,
        loadAllComments: source.sampleSummary.loadAllComments
      },
      { searchCalls: 4, detailCalls: 30, retryCount: 0, loadAllComments: false }
    )
    const toolCalls = kernel.context.tools.listToolCalls(sessionId)
    assert.equal(toolCalls.length, 34)
    assert.equal(
      toolCalls.every((call) => call.ok),
      true
    )
    assert.equal(kernel.context.tools.listEvidence(sessionId).length, 30)
    assert.equal(
      (
        kernel.database
          .prepare('SELECT COUNT(*) AS count FROM model_calls WHERE session_id = ?')
          .get(sessionId) as { count: number }
      ).count,
      0
    )

    const safeSurfaces = JSON.stringify({ source, toolCalls, logs })
    assert.equal(
      logs.some((entry) => 'keys' in entry.context),
      false
    )
    for (const sentinel of [tokenSentinel, commentSentinel, rawSentinel, credentialSentinel]) {
      assert.equal(safeSurfaces.includes(sentinel), false)
    }
  } finally {
    await stopTestKernel(kernel.context, kernel.database)
    await rm(root, { recursive: true, force: true })
  }
})

test('D4 XHS ranking logs only a bounded shape for an unknown search wrapper', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d4-xhs-search-drift-'))
  const sessionId = 'd4-xhs-search-drift-session'
  const tokenSentinel = 'SENTINEL_XSEC_SEARCH_DO_NOT_LOG'
  const commentSentinel = 'SENTINEL_COMMENT_SEARCH_DO_NOT_LOG'
  const rawSentinel = 'SENTINEL_RAW_SEARCH_DO_NOT_LOG'
  const credentialSentinel = 'SENTINEL_CREDENTIAL_SEARCH_DO_NOT_LOG'
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  const logs: Array<{ code: string; message: string; context: Record<string, unknown> }> = []
  const rows = [xhsFixtureFeed('search-drift-0001', tokenSentinel)]
  const kernel = await createTestKernel(root, {
    createSession: () =>
      xhsSourceSession(async (name, args) => {
        calls.push({ name, args })
        return xhsTextResult({
          result: { feeds: rows, count: rows.length },
          comments: [commentSentinel],
          raw: rawSentinel
        })
      }),
    readCredential: async (credentialId) =>
      credentialId === 'XIAOHONGSHU_MCP_AUTH' ? credentialSentinel : undefined,
    log: (code, message, context) => logs.push({ code, message, context })
  })
  try {
    await kernel.context.provider.saveConfig(D4_PROVIDER_CONFIG)
    await seedStage2(kernel.context, sessionId, { ...BASICS, destinationCities: ['昆明'] })
    await kernel.context.coordinator.confirmFixedDestination({ sessionId, city: '昆明' })
    const preview = await kernel.context.coordinator.previewXhsRanking({ sessionId })
    const beforeEvents = await kernel.context.eventLog.read(sessionId)
    const beforeSnapshot = kernel.context.coordinator.d4Snapshot(sessionId)
    let failure: unknown

    await assert.rejects(
      kernel.context.coordinator.executeXhsRanking({
        sessionId,
        planId: preview.planId,
        digest: preview.digest,
        operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      }),
      (error: unknown) => {
        failure = error
        return serializeError(error).code === 'SOURCE_DRIFT'
      }
    )

    assert.deepEqual(
      calls.map((call) => call.name),
      ['search_feeds']
    )
    const toolCalls = kernel.context.tools.listToolCalls(sessionId)
    assert.equal(toolCalls.length, 1)
    assert.deepEqual(
      toolCalls.map((call) => ({
        sourceId: call.sourceId,
        toolName: call.toolName,
        ok: call.ok,
        errorCode: call.errorCode
      })),
      [{ sourceId: 'SRC_XHS', toolName: 'search_feeds', ok: false, errorCode: 'SOURCE_DRIFT' }]
    )
    assert.equal(
      (
        kernel.database
          .prepare('SELECT COUNT(*) AS count FROM model_calls WHERE session_id = ?')
          .get(sessionId) as { count: number }
      ).count,
      0
    )
    assert.equal(kernel.context.tools.listEvidence(sessionId).length, 0)
    assert.deepEqual(await kernel.context.eventLog.read(sessionId), beforeEvents)
    assert.deepEqual(kernel.context.coordinator.d4Snapshot(sessionId), beforeSnapshot)
    assert.equal(
      logs.some((entry) => entry.code === 'SOURCE_DRIFT'),
      true
    )
    const driftLog = logs.find((entry) => entry.code === 'SOURCE_DRIFT')!
    assert.equal(driftLog.context.missing, 'content.0.text')
    assert.equal(typeof driftLog.context.keys, 'string')
    assert.match(String(driftLog.context.keys), /\$text\.result:object/)
    assert.match(String(driftLog.context.keys), /\$text\.result\.feeds:array/)
    assert.ok(String(driftLog.context.keys).length <= 2048)

    const safeSurfaces = JSON.stringify({
      ipcError: serializeError(failure),
      toolCalls,
      logs
    })
    for (const sentinel of [tokenSentinel, commentSentinel, rawSentinel, credentialSentinel]) {
      assert.equal(safeSurfaces.includes(sentinel), false)
    }
  } finally {
    await stopTestKernel(kernel.context, kernel.database)
    await rm(root, { recursive: true, force: true })
  }
})

test('D4 XHS ranking stops on the first malformed detail with no model or final projection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d4-xhs-detail-drift-'))
  const sessionId = 'd4-xhs-detail-drift-session'
  const tokenSentinel = 'SENTINEL_XSEC_DETAIL_DO_NOT_LOG'
  const commentSentinel = 'SENTINEL_COMMENT_DETAIL_DO_NOT_LOG'
  const rawSentinel = 'SENTINEL_RAW_DETAIL_DO_NOT_LOG'
  const credentialSentinel = 'SENTINEL_CREDENTIAL_DETAIL_DO_NOT_LOG'
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  const logs: Array<{ code: string; message: string; context: Record<string, unknown> }> = []
  const recommend = xhsFixtureFeeds('detail-r', 15)
  recommend[0] = xhsFixtureFeed(recommend[0]!.id, tokenSentinel)
  const avoid = xhsFixtureFeeds('detail-a', 15)
  const searchRows = [recommend, [recommend[0]!], avoid, [avoid[0]!]]
  let searchIndex = 0
  const kernel = await createTestKernel(root, {
    createSession: () =>
      xhsSourceSession(async (name, args) => {
        calls.push({ name, args })
        if (name === 'search_feeds') {
          const feeds = searchRows[searchIndex++]!
          return xhsTextResult({ feeds, count: feeds.length })
        }
        const requestedId = String(args.feed_id)
        return xhsTextResult({
          feed_id: requestedId,
          data: {
            note: {
              noteId: 'detail-wrong-0001',
              xsecToken: tokenSentinel,
              title: '详情漂移',
              desc: rawSentinel,
              type: 'normal',
              user: { nickname: '详情作者' }
            },
            comments: [{ content: commentSentinel }]
          }
        })
      }),
    readCredential: async (credentialId) =>
      credentialId === 'XIAOHONGSHU_MCP_AUTH' ? credentialSentinel : undefined,
    log: (code, message, context) => logs.push({ code, message, context })
  })
  try {
    await kernel.context.provider.saveConfig(D4_PROVIDER_CONFIG)
    await seedStage2(kernel.context, sessionId, { ...BASICS, destinationCities: ['昆明'] })
    await kernel.context.coordinator.confirmFixedDestination({ sessionId, city: '昆明' })
    const preview = await kernel.context.coordinator.previewXhsRanking({ sessionId })
    const beforeEvents = await kernel.context.eventLog.read(sessionId)
    const beforeSnapshot = kernel.context.coordinator.d4Snapshot(sessionId)
    let failure: unknown

    await assert.rejects(
      kernel.context.coordinator.executeXhsRanking({
        sessionId,
        planId: preview.planId,
        digest: preview.digest,
        operationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      }),
      (error: unknown) => {
        failure = error
        return serializeError(error).code === 'SOURCE_DRIFT'
      }
    )

    assert.deepEqual(
      calls.map((call) => call.name),
      ['search_feeds', 'search_feeds', 'search_feeds', 'search_feeds', 'get_feed_detail']
    )
    const toolCalls = kernel.context.tools.listToolCalls(sessionId)
    assert.equal(toolCalls.length, 5)
    assert.equal(toolCalls.filter((call) => call.ok).length, 4)
    const failedToolCall = toolCalls.find((call) => !call.ok)!
    assert.deepEqual(
      {
        sourceId: failedToolCall.sourceId,
        toolName: failedToolCall.toolName,
        ok: failedToolCall.ok,
        errorCode: failedToolCall.errorCode
      },
      {
        sourceId: 'SRC_XHS',
        toolName: 'get_feed_detail',
        ok: false,
        errorCode: 'SOURCE_DRIFT'
      }
    )
    assert.equal(
      (
        kernel.database
          .prepare('SELECT COUNT(*) AS count FROM model_calls WHERE session_id = ?')
          .get(sessionId) as { count: number }
      ).count,
      0
    )
    assert.equal(kernel.context.tools.listEvidence(sessionId).length, 0)
    assert.deepEqual(await kernel.context.eventLog.read(sessionId), beforeEvents)
    assert.deepEqual(kernel.context.coordinator.d4Snapshot(sessionId), beforeSnapshot)
    assert.equal(
      logs.some((entry) => entry.code === 'SOURCE_DRIFT'),
      true
    )
    const driftLog = logs.find((entry) => entry.code === 'SOURCE_DRIFT')!
    assert.equal(typeof driftLog.context.keys, 'string')
    assert.match(String(driftLog.context.keys), /\$text\.data\.note\.noteId:string/)
    assert.ok(String(driftLog.context.keys).length <= 2048)

    const safeSurfaces = JSON.stringify({
      ipcError: serializeError(failure),
      toolCalls,
      logs
    })
    for (const sentinel of [tokenSentinel, commentSentinel, rawSentinel, credentialSentinel]) {
      assert.equal(safeSurfaces.includes(sentinel), false)
    }
  } finally {
    await stopTestKernel(kernel.context, kernel.database)
    await rm(root, { recursive: true, force: true })
  }
})

test('D4 destination, atomic checklist claims and conflicts rebuild from JSONL after projection reset', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d4-'))
  const paths = createAppPaths(root)
  try {
    const first = await createTestKernel(root)
    const sessionId = 'd4-session'
    await first.context.coordinator.record({
      sessionId,
      eventVersion: 2,
      type: 'session/created',
      payload: {
        title: 'D4 replay',
        linkedSessionGroup: null,
        splitIndex: null,
        basics: BASICS,
        handoffs: []
      }
    })
    await first.context.coordinator.record({
      sessionId,
      eventVersion: 2,
      type: 'stage/confirmed',
      payload: { fromStage: 'STAGE_1', toStage: 'STAGE_2', confirmed: true }
    })
    const evidence = verifyEvidenceClaims(
      [
        claim({
          claimId: 'hours-a',
          sessionId,
          sourceId: 'SRC_SEARCH',
          sourceRef: 'https://official.example/hours',
          value: '09:00-18:00'
        }),
        claim({
          claimId: 'hours-b',
          sessionId,
          sourceId: 'SRC_MAP',
          sourceRef: 'SRC_MAP:maps_geo:hours',
          value: '10:00-17:00'
        })
      ],
      NOW
    )
    await first.context.tools.addEvidenceClaims(evidence)
    await first.context.coordinator.record({
      sessionId,
      eventVersion: 2,
      type: 'destination/candidates-generated',
      payload: {
        candidates: [
          {
            id: 'chengdu',
            city: '成都',
            fitReasons: ['适合家庭'],
            tradeoffs: ['热门'],
            risks: [],
            claimIds: ['hours-a']
          },
          {
            id: 'chongqing',
            city: '重庆',
            fitReasons: ['城市体验'],
            tradeoffs: ['坡度'],
            risks: ['步行'],
            claimIds: ['hours-b']
          }
        ]
      }
    })
    await first.context.coordinator.record({
      sessionId,
      eventVersion: 2,
      type: 'destination/selected',
      payload: { candidateId: 'chengdu', city: '成都' }
    })
    await first.context.coordinator.record({
      sessionId,
      eventVersion: 2,
      type: 'stage/confirmed',
      payload: { fromStage: 'STAGE_2', toStage: 'STAGE_3', confirmed: true }
    })
    const entity = buildResearchEntities({
      destinationCity: '成都',
      claims: evidence,
      travelers: BASICS.travelers
    })[0]!
    const rankingClaim = claim({
      claimId: 'xhs-ranking-final',
      sessionId,
      subject: entity.canonicalSubject,
      predicate: 'xiaohongshuAttractionSignal',
      sourceId: 'SRC_XHS',
      sourceRef: 'https://www.xiaohongshu.com/explore/final0001',
      value: { stance: 'RECOMMEND', familyFit: 'FIT' }
    })
    await first.context.coordinator.record({
      sessionId,
      eventVersion: 2,
      type: 'research/checklist-prepared',
      payload: {
        entities: [entity],
        sourceFailures: [],
        xhsSampleSummary: {
          destinationCity: '成都',
          recommendPostCount: 15,
          avoidPostCount: 15,
          searchCalls: 4,
          detailCalls: 30,
          detailCharacterLimit: 4000,
          extractionCalls: 6,
          reviewCalls: 1,
          retryCount: 0,
          loadAllComments: false
        },
        attractionRankings: [
          {
            rank: 1,
            entityId: entity.entityId,
            subject: entity.canonicalSubject,
            score: 5,
            recommendPostCount: 1,
            avoidPostCount: 0,
            familyFit: 'FIT',
            familyFitAdjustment: 2,
            familyFitReasons: ['适合家庭慢游'],
            recommendationEvidence: [
              {
                claimId: rankingClaim.claimId,
                sourceRef: rankingClaim.sourceRef,
                reason: '适合家庭慢游'
              }
            ],
            avoidanceEvidence: [],
            claimIds: [rankingClaim.claimId],
            verificationStatus: 'UNVERIFIED'
          }
        ],
        finalClaims: [rankingClaim]
      }
    })
    await first.context.coordinator.record({
      sessionId,
      eventVersion: 2,
      type: 'research/disposition-set',
      payload: { entityId: entity.entityId, disposition: 'EXCLUDE' }
    })
    assert.equal(first.context.coordinator.d4Snapshot(sessionId).attractionRankings?.length, 0)
    await first.context.coordinator.record({
      sessionId,
      eventVersion: 2,
      type: 'research/disposition-set',
      payload: { entityId: entity.entityId, disposition: 'MUST_GO' }
    })
    await first.context.coordinator.record({
      sessionId,
      eventVersion: 2,
      type: 'research/conflict-resolved',
      payload: {
        resolution: {
          subject: '武侯祠',
          predicate: 'openingHours',
          resolution: 'CLAIM_SELECTED',
          selectedClaimId: 'hours-a',
          resolvedAt: NOW.toISOString()
        }
      }
    })
    await first.context.coordinator.record({
      sessionId,
      eventVersion: 2,
      type: 'research/confirmed',
      payload: { confirmedAt: NOW.toISOString() }
    })
    await first.context.coordinator.record({
      sessionId,
      eventVersion: 2,
      type: 'stage/confirmed',
      payload: { fromStage: 'STAGE_3', toStage: 'STAGE_4', confirmed: true }
    })
    const before = first.context.travelState.get(sessionId)
    const atomicEvents = await first.context.eventLog.read(sessionId)
    assert.equal(
      atomicEvents.filter(
        (event) =>
          event.type === 'evidence/added' && event.payload.claim.claimId === rankingClaim.claimId
      ).length,
      0
    )
    assert.equal(
      atomicEvents.filter(
        (event) =>
          event.type === 'research/checklist-prepared' &&
          event.payload.finalClaims?.some((item) => item.claimId === rankingClaim.claimId)
      ).length,
      1
    )
    const journal = await readFile(sessionEventLogPath(paths, sessionId))
    try {
      first.database.exec('DELETE FROM evidence_claims; DELETE FROM sessions;')
      await first.context.travelState.rebuildAll()
      const after = first.context.travelState.get(sessionId)
      assert.deepEqual(after, before)
      assert.equal(after?.stage, 'STAGE_4')
      assert.equal(after?.researchEntities[0]?.disposition, 'MUST_GO')
      assert.equal(after?.conflictResolutions[0]?.selectedClaimId, 'hours-a')
      assert.equal(after?.xhsSampleSummary?.detailCalls, 30)
      assert.equal(after?.attractionRankings[0]?.score, 5)
      assert.ok(
        first.context.tools
          .listEvidence(sessionId)
          .some((item) => item.claimId === rankingClaim.claimId)
      )
      assert.equal(
        first.context.tools
          .listEvidence(sessionId)
          .filter((item) => item.claimId === 'hours-a' || item.claimId === 'hours-b')
          .every((item) => item.verificationStatus === 'CONFLICTED'),
        true
      )
      assert.deepEqual(await readFile(sessionEventLogPath(paths, sessionId)), journal)
    } finally {
      await stopTestKernel(first.context, first.database)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('D4 formal manual checklist and USER_RESEARCH claims rebuild from JSONL without calls', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-d4-manual-rebuild-'))
  const paths = createAppPaths(root)
  try {
    const kernel = await createTestKernel(root)
    const sessionId = 'd4-manual-rebuild-session'
    try {
      await kernel.context.coordinator.record({
        sessionId,
        eventVersion: 2,
        type: 'session/created',
        payload: {
          title: 'D4 manual rebuild',
          linkedSessionGroup: null,
          splitIndex: null,
          basics: BASICS,
          handoffs: []
        }
      })
      await kernel.context.coordinator.record({
        sessionId,
        eventVersion: 2,
        type: 'stage/confirmed',
        payload: { fromStage: 'STAGE_1', toStage: 'STAGE_2', confirmed: true }
      })
      await kernel.context.coordinator.record({
        sessionId,
        eventVersion: 2,
        type: 'stage/confirmed',
        payload: {
          fromStage: 'STAGE_2',
          toStage: 'STAGE_3',
          confirmed: true,
          confirmation: { kind: 'FIXED_DESTINATION', city: '成都' }
        }
      })
      const checkedAt = new Date().toISOString()
      const request = ManualResearchChecklistRequestSchema.parse({
        sessionId,
        items: [
          {
            itemId: crypto.randomUUID(),
            subject: '成都武侯祠博物馆',
            kind: 'ATTRACTION',
            aliases: ['武侯祠'],
            disposition: 'MUST_GO',
            sourceLabel: '现场公告',
            sourceUrl: 'https://example.com/manual-notice',
            sourceClaimId: null,
            contentIdentity: 'OFFICIAL',
            summary: '用户现场核验的结构化研究项。',
            fitness: { status: 'FIT', reasons: ['有休息区域'] },
            hardAnchors: [
              {
                kind: 'OPENING_HOURS',
                status: 'KNOWN',
                value: '09:00-18:00',
                checkedAt,
                confirmed: true
              },
              {
                kind: 'CLOSURE_SCHEDULE',
                status: 'KNOWN',
                value: '当前公告未列临时闭馆',
                checkedAt,
                confirmed: true
              },
              {
                kind: 'RESERVATION_REQUIREMENT',
                status: 'KNOWN',
                value: '需实名预约',
                checkedAt,
                confirmed: true
              }
            ],
            confirmed: true
          }
        ]
      })
      await kernel.context.coordinator.prepareManualResearch(request)
      const beforeState = kernel.context.travelState.get(sessionId)
      const beforeClaims = kernel.context.tools
        .listEvidence(sessionId)
        .filter((item) => item.sourceId === 'USER_RESEARCH')
        .sort((left, right) => left.claimId.localeCompare(right.claimId))
      const journal = await readFile(sessionEventLogPath(paths, sessionId))
      assert.equal(beforeClaims.length, 5)
      assert.equal(beforeState?.manualResearchSummary?.mode, 'USER_CONFIRMED')
      assert.equal(
        (
          kernel.database.prepare('SELECT COUNT(*) AS count FROM tool_calls').get() as {
            count: number
          }
        ).count,
        0
      )
      assert.equal(
        (
          kernel.database.prepare('SELECT COUNT(*) AS count FROM model_calls').get() as {
            count: number
          }
        ).count,
        0
      )

      kernel.database.exec('DELETE FROM evidence_claims; DELETE FROM sessions;')
      await kernel.context.travelState.rebuildAll()
      const afterState = kernel.context.travelState.get(sessionId)
      const afterClaims = kernel.context.tools
        .listEvidence(sessionId)
        .filter((item) => item.sourceId === 'USER_RESEARCH')
        .sort((left, right) => left.claimId.localeCompare(right.claimId))
      assert.deepEqual(afterState, beforeState)
      assert.deepEqual(afterClaims, beforeClaims)
      assert.deepEqual(await readFile(sessionEventLogPath(paths, sessionId)), journal)
    } finally {
      await stopTestKernel(kernel.context, kernel.database)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
