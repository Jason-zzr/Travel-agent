import assert from 'node:assert/strict'
import test from 'node:test'
import type { XhsExtractionBatch } from '../shared/schema/d4'
import type { EvidenceClaim } from '../shared/schema/evidence'
import {
  XhsFeedDetailPayloadSchema,
  XhsSearchFeedsPayloadSchema,
  type XhsSearchFeedRaw
} from '../shared/schema/mcp/xiaohongshu'
import { SOURCE_DEFINITIONS } from './mcp/source-catalog'
import {
  fingerprintXhsToolResult,
  XHS_STRUCTURAL_FINGERPRINT_MAX_LENGTH
} from './mcp/xhs-structural-fingerprint'
import type { ProviderRuntime } from './plugins/provider-runtime'
import {
  XHS_RANKING_FILTERS,
  runXhsRankingBatch,
  xhsRankingQueries
} from './mcp/sources/xiaohongshu-ranking'
import {
  XhsRankingSkill,
  buildXhsAttractionOutput,
  materializeXhsSignals
} from './skills/s04-xhs-ranking'

type ToolCall = { toolName: string; args: Record<string, unknown> }

test('XHS structural fingerprint is deterministic, bounded, and value-free', () => {
  const sentinels = [
    'SENTINEL_TOKEN_DO_NOT_RETAIN',
    'SENTINEL_COMMENT_DO_NOT_RETAIN',
    'SENTINEL_CREDENTIAL_DO_NOT_RETAIN'
  ]
  const raw = {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          result: {
            feeds: [
              {
                xsecToken: sentinels[0],
                comments: [sentinels[1]],
                credential: sentinels[2]
              }
            ],
            count: 1
          }
        })
      }
    ]
  }
  const first = fingerprintXhsToolResult(raw)
  const second = fingerprintXhsToolResult(raw)

  assert.equal(first, second)
  assert.match(first, /\$text\.result:object/)
  assert.match(first, /\$text\.result\.feeds:array/)
  assert.match(first, /\$text\.result\.feeds\[\]\.xsecToken:string/)
  assert.ok(first.length <= XHS_STRUCTURAL_FINGERPRINT_MAX_LENGTH)
  for (const sentinel of sentinels) assert.equal(first.includes(sentinel), false)
  assert.equal(first.includes(':1'), false)
})

test('XHS structural fingerprint safely classifies primitive, missing text, cycles, and limits', () => {
  assert.equal(fingerprintXhsToolResult('secret text'), '$:string')
  assert.equal(
    fingerprintXhsToolResult({ content: [{ type: 'text', text: 'not-json-secret' }] }),
    '$:object|$.content:array|$.content[]:object|$.content[].text:string|$.content[].type:string|$text:string'
  )
  assert.equal(
    fingerprintXhsToolResult({ content: [{ type: 'image' }] }),
    '$:object|$.content:array|$.content[]:object|$.content[].type:string'
  )

  const cycle: { self?: unknown } = {}
  cycle.self = cycle
  assert.equal(fingerprintXhsToolResult(cycle), '$:object|$.self:cycle')

  const wide = Object.fromEntries(
    Array.from({ length: 80 }, (_, index) => [`safeKey${String(index).padStart(2, '0')}`, index])
  )
  const deep: Record<string, unknown> = {}
  let cursor = deep
  for (let index = 0; index < 20; index += 1) {
    const next: Record<string, unknown> = {}
    cursor.next = next
    cursor = next
  }
  const limited = fingerprintXhsToolResult({ wide, deep, 'unsafe\nkey': 'secret' })
  assert.ok(limited.length <= XHS_STRUCTURAL_FINGERPRINT_MAX_LENGTH)
  assert.match(limited, /\$\.<key>:string/)
  assert.match(limited, /!truncated/)
  assert.equal(limited.includes('unsafe'), false)
  assert.equal(limited.includes('secret'), false)

  const manyNodes = Object.fromEntries(
    Array.from({ length: 16 }, (_, groupIndex) => [
      `group${String(groupIndex).padStart(2, '0')}`,
      Object.fromEntries(
        Array.from({ length: 16 }, (_, keyIndex) => [
          `field${String(keyIndex).padStart(2, '0')}`,
          null
        ])
      )
    ])
  )
  assert.match(fingerprintXhsToolResult(manyNodes), /!truncated/)
})

test('XHS structural fingerprint masks likely data keys and never replaces drift with an exception', () => {
  const feedIdAsKey = '68abcdef0123456789abcdef'
  const dynamicKey = 'credential1234567890'
  const fingerprint = fingerprintXhsToolResult({
    [feedIdAsKey]: { value: 'SENTINEL_KEY_VALUE' },
    [dynamicKey]: true,
    stable_wrapper: null
  })

  assert.equal(fingerprint.includes(feedIdAsKey), false)
  assert.equal(fingerprint.includes(dynamicKey), false)
  assert.match(fingerprint, /\$\.<key>:/)
  assert.match(fingerprint, /\$\.stable_wrapper:null/)

  const throwingContent = Object.defineProperty({}, 'content', {
    enumerable: true,
    get() {
      throw new Error('SENTINEL_GETTER_DO_NOT_RETAIN')
    }
  })
  const failed = fingerprintXhsToolResult(throwingContent)
  assert.equal(failed, '$:unknown|!truncated')
  assert.equal(failed.includes('SENTINEL_GETTER_DO_NOT_RETAIN'), false)
})

test('XHS payload schemas normalize only the reviewed legacy and official wrappers', () => {
  const searchFeeds = feeds('shape', 1, 2)
  const detail = detailPayload(searchFeeds[0]!.id)

  assert.deepEqual(XhsSearchFeedsPayloadSchema.parse(searchFeeds), searchFeeds)
  assert.deepEqual(
    XhsSearchFeedsPayloadSchema.parse({ feeds: searchFeeds, count: searchFeeds.length }),
    searchFeeds
  )
  assert.deepEqual(XhsFeedDetailPayloadSchema.parse(detail), detail)
  assert.deepEqual(
    XhsFeedDetailPayloadSchema.parse({ feed_id: searchFeeds[0]!.id, data: detail }),
    detail
  )

  const searchContract = SOURCE_DEFINITIONS.SRC_XHS.tools.search_feeds!.result
  const detailContract = SOURCE_DEFINITIONS.SRC_XHS.tools.get_feed_detail!.result
  assert.equal(
    searchContract.safeParse(textResult({ feeds: searchFeeds, count: searchFeeds.length })).success,
    true
  )
  assert.equal(
    detailContract.safeParse(
      textResult({ feed_id: searchFeeds[0]!.id, data: detailPayload(searchFeeds[0]!.id) })
    ).success,
    true
  )

  const invalidSearchResults: unknown[] = [
    textResult({ feeds: searchFeeds, count: searchFeeds.length + 1 }),
    textResult({ feeds: [], count: 0 }),
    textResult({ result: searchFeeds }),
    { content: [{ type: 'text', text: 'not-json' }] },
    { structuredContent: { feeds: searchFeeds, count: searchFeeds.length } },
    {
      ...textResult({ feeds: searchFeeds, count: searchFeeds.length }),
      structuredContent: { feeds: searchFeeds, count: searchFeeds.length }
    }
  ]
  for (const result of invalidSearchResults) {
    assert.equal(searchContract.safeParse(result).success, false)
  }

  assert.equal(
    detailContract.safeParse(
      textResult({
        feed_id: searchFeeds[0]!.id,
        data: detailPayload(searchFeeds[1]!.id)
      })
    ).success,
    false
  )
  assert.equal(detailContract.safeParse(textResult({ result: detail })).success, false)
  assert.equal(
    detailContract.safeParse({
      ...textResult({ feed_id: searchFeeds[0]!.id, data: detail }),
      structuredContent: { feed_id: searchFeeds[0]!.id, data: detail }
    }).success,
    false
  )
})

test('D4 XHS ranking freezes 15+15 unique posts before 30 serial detail reads', async () => {
  const calls: ToolCall[] = []
  const progress: Array<[number, number]> = []
  const searchRows = [
    feeds('r', 1, 20),
    feeds('r', 21, 35),
    [feed('r', 20), ...feeds('a', 1, 15)],
    feeds('a', 16, 30)
  ]
  let searchIndex = 0

  const result = await runXhsRankingBatch({
    destinationCity: ' 昆明 ',
    invoke: async (toolName, args) => {
      calls.push({ toolName, args })
      if (toolName === 'search_feeds') {
        const rows = searchRows[searchIndex++]!
        return textResult({ feeds: rows, count: rows.length })
      }
      const feedId = String(args.feed_id)
      return textResult({
        feed_id: feedId,
        data: detailPayload(feedId, '不得持久化的评论')
      })
    },
    onProgress: (searches, details) => progress.push([searches, details])
  })

  assert.deepEqual(
    calls.slice(0, 4).map((call) => call.toolName),
    ['search_feeds', 'search_feeds', 'search_feeds', 'search_feeds']
  )
  assert.deepEqual(
    calls.slice(0, 4).map((call) => call.args),
    xhsRankingQueries('昆明').map((keyword) => ({ keyword, filters: XHS_RANKING_FILTERS }))
  )
  assert.equal(calls.length, 34)
  assert.ok(calls.slice(4).every((call) => call.toolName === 'get_feed_detail'))
  assert.deepEqual(
    calls.slice(4).map((call) => call.args),
    [...feeds('r', 1, 15), ...feeds('a', 1, 15)].map((item) => ({
      feed_id: item.id,
      xsec_token: item.xsecToken,
      load_all_comments: false
    }))
  )
  assert.deepEqual(result.audit, {
    searchCalls: 4,
    detailCalls: 30,
    recommendPostCount: 15,
    avoidPostCount: 15,
    retryCount: 0,
    loadAllComments: false,
    detailCharacters: result.audit.detailCharacters,
    truncatedDetailCount: 0
  })
  assert.equal(result.notes.filter((note) => note.sampleGroup === 'RECOMMEND').length, 15)
  assert.equal(result.notes.filter((note) => note.sampleGroup === 'AVOID').length, 15)
  assert.deepEqual(progress.slice(0, 4), [
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0]
  ])
  assert.deepEqual(progress.at(-1), [4, 30])
  const serialized = JSON.stringify(result)
  assert.doesNotMatch(serialized, /token-/)
  assert.doesNotMatch(serialized, /不得持久化的评论/)
})

test('D4 XHS ranking fails closed on a group shortage before reading any detail', async () => {
  const calls: ToolCall[] = []
  await assert.rejects(
    () =>
      runXhsRankingBatch({
        destinationCity: '昆明',
        invoke: async (toolName, args) => {
          calls.push({ toolName, args })
          return textResult([feed('r', 1)])
        }
      }),
    (error: unknown) =>
      error instanceof Error && error.message.includes('15 条推荐帖与 15 条避雷帖')
  )
  assert.equal(calls.length, 4)
  assert.ok(calls.every((call) => call.toolName === 'search_feeds'))
})

test('D4 XHS ranking stops after the first malformed search response', async () => {
  const calls: ToolCall[] = []
  const searchRows = feeds('r', 1, 15)

  await assert.rejects(() =>
    runXhsRankingBatch({
      destinationCity: '昆明',
      invoke: async (toolName, args) => {
        calls.push({ toolName, args })
        return textResult({ feeds: searchRows, count: searchRows.length + 1 })
      }
    })
  )

  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.toolName, 'search_feeds')

  const structuredContentCalls: ToolCall[] = []
  await assert.rejects(() =>
    runXhsRankingBatch({
      destinationCity: '昆明',
      invoke: async (toolName, args) => {
        structuredContentCalls.push({ toolName, args })
        return {
          ...textResult({ feeds: searchRows, count: searchRows.length }),
          structuredContent: { feeds: searchRows, count: searchRows.length }
        }
      }
    })
  )

  assert.equal(structuredContentCalls.length, 1)
  assert.equal(structuredContentCalls[0]!.toolName, 'search_feeds')
})

test('D4 XHS ranking stops on the first detail failure without retry or replacement', async () => {
  const calls: ToolCall[] = []
  let searchIndex = 0
  const searchRows = [feeds('r', 1, 15), [feed('r', 1)], feeds('a', 1, 15), [feed('a', 1)]]
  await assert.rejects(() =>
    runXhsRankingBatch({
      destinationCity: '昆明',
      invoke: async (toolName, args) => {
        calls.push({ toolName, args })
        if (toolName === 'search_feeds') return textResult(searchRows[searchIndex++]!)
        throw new Error('detail unavailable')
      }
    })
  )
  assert.equal(calls.length, 5)
  assert.deepEqual(
    calls.map((call) => call.toolName),
    ['search_feeds', 'search_feeds', 'search_feeds', 'search_feeds', 'get_feed_detail']
  )
})

test('D4 XHS ranking rejects a detail whose normalized ID differs from the frozen request', async () => {
  const calls: ToolCall[] = []
  let searchIndex = 0
  const searchRows = [feeds('r', 1, 15), [feed('r', 1)], feeds('a', 1, 15), [feed('a', 1)]]

  await assert.rejects(
    () =>
      runXhsRankingBatch({
        destinationCity: '昆明',
        invoke: async (toolName, args) => {
          calls.push({ toolName, args })
          if (toolName === 'search_feeds') return textResult(searchRows[searchIndex++]!)
          const differentId = 'feed-wrong-0001'
          return textResult({
            feed_id: differentId,
            data: detailPayload(differentId)
          })
        }
      }),
    /冻结帖子标识不一致/
  )

  assert.equal(calls.length, 5)
  assert.equal(calls.at(-1)!.toolName, 'get_feed_detail')
})

test('D4 XHS ranking makes exactly six no-repair EXTRACTION calls and one no-repair REVIEW', async () => {
  const sourceClaims = Array.from({ length: 30 }, (_, index) =>
    sourceClaim(index, index < 15 ? 'RECOMMEND' : 'AVOID')
  )
  const invocations: Array<{ role: string; repairInvalid: boolean | undefined }> = []
  const provider = {
    async invokeStructured(input: {
      role: string
      user: string
      repairInvalid?: boolean
    }): Promise<unknown> {
      invocations.push({ role: input.role, repairInvalid: input.repairInvalid })
      const payload = JSON.parse(input.user) as {
        posts?: Array<{ sourceClaimId: string; value: { sampleGroup: 'RECOMMEND' | 'AVOID' } }>
        claims?: Array<{ claimId: string }>
      }
      if (input.role === 'REVIEW') {
        return { reviewedClaimIds: payload.claims!.map((claim) => claim.claimId) }
      }
      return {
        posts: payload.posts!.map((post) => ({
          sourceClaimId: post.sourceClaimId,
          signals: [
            {
              destinationCity: '昆明',
              subject: '翠湖公园',
              aliases: [],
              kind: 'ATTRACTION',
              stance: post.value.sampleGroup,
              recommendationReasons: post.value.sampleGroup === 'RECOMMEND' ? ['适合慢游'] : [],
              avoidanceReasons: post.value.sampleGroup === 'AVOID' ? ['高峰拥挤'] : [],
              familyFit: 'FIT',
              familyFitReasons: ['路面平缓'],
              identityStatus: 'DETERMINISTIC',
              promotionOnlySupport: false
            }
          ]
        }))
      }
    }
  } as unknown as ProviderRuntime

  const output = await new XhsRankingSkill(provider).run({
    sessionId: 'xhs-ranking-session',
    destinationCity: '昆明',
    sourceClaims,
    travelers: [
      {
        ageBand: 'OLDER_ADULT',
        count: 1,
        relationship: '家人',
        stamina: 'LOW',
        careNeeds: [],
        functionalLimits: []
      },
      {
        ageBand: 'CHILD',
        count: 1,
        relationship: '家人',
        stamina: 'MEDIUM',
        careNeeds: [],
        functionalLimits: []
      }
    ]
  })

  assert.deepEqual(
    invocations.map((item) => item.role),
    ['EXTRACTION', 'EXTRACTION', 'EXTRACTION', 'EXTRACTION', 'EXTRACTION', 'EXTRACTION', 'REVIEW']
  )
  assert.ok(invocations.every((item) => item.repairInvalid === false))
  assert.equal(output.rankings.length, 1)
  assert.deepEqual(
    {
      score: output.rankings[0]!.score,
      recommend: output.rankings[0]!.recommendPostCount,
      avoid: output.rankings[0]!.avoidPostCount,
      adjustment: output.rankings[0]!.familyFitAdjustment
    },
    { score: -13, recommend: 15, avoid: 15, adjustment: 2 }
  )
})

test('D4 XHS deterministic ranking keeps avoidance evidence and applies exclusion gates', () => {
  const claims = [
    sourceClaim(0, 'RECOMMEND'),
    sourceClaim(1, 'RECOMMEND'),
    sourceClaim(2, 'AVOID'),
    sourceClaim(3, 'RECOMMEND'),
    sourceClaim(4, 'RECOMMEND')
  ]
  const materialized = materializeXhsSignals('xhs-ranking-session', '昆明', claims, [
    {
      posts: [
        extractionPost(claims[0]!, '推荐景点', 'RECOMMEND', 'FIT'),
        extractionPost(claims[1]!, '混合景点', 'MIXED', 'UNKNOWN'),
        extractionPost(claims[2]!, '风险景点', 'AVOID', 'RISK'),
        extractionPost(claims[3]!, '歧义景点', 'RECOMMEND', 'FIT', true, false),
        extractionPost(claims[4]!, '推广景点', 'RECOMMEND', 'FIT', false, true)
      ]
    }
  ])
  const initial = buildXhsAttractionOutput('昆明', materialized)
  const excluded = initial.entities.find((entity) => entity.canonicalSubject === '推荐景点')!
  const output = buildXhsAttractionOutput(
    '昆明',
    materialized,
    new Map([[excluded.entityId, 'EXCLUDE']])
  )

  assert.deepEqual(
    output.rankings.map((ranking) => ranking.subject),
    ['混合景点', '风险景点']
  )
  assert.deepEqual(
    output.rankings.map((ranking) => ranking.score),
    [-1, -7]
  )
  assert.equal(output.rankings[0]!.recommendPostCount, 1)
  assert.equal(output.rankings[0]!.avoidPostCount, 1)
  assert.equal(output.rankings[1]!.avoidanceEvidence[0]!.reason, '需要避雷')
  assert.ok(output.rankings.every((ranking) => ranking.verificationStatus === 'UNVERIFIED'))
})

test('D4 XHS deterministic identity aliases merge while ambiguous same-name signals stay separate', () => {
  const claims = Array.from({ length: 6 }, (_, index) =>
    sourceClaim(index, index === 1 ? 'AVOID' : 'RECOMMEND')
  )
  const materialized = materializeXhsSignals('xhs-ranking-session', '昆明', claims, [
    {
      posts: [
        extractionPostWithAliases(claims[0]!, '翠湖', ['翠湖公园'], 'RECOMMEND'),
        extractionPostWithAliases(claims[1]!, '翠湖公园', ['翠湖'], 'AVOID'),
        extractionPostWithAliases(claims[2]!, '乙景点', [], 'RECOMMEND'),
        extractionPostWithAliases(claims[3]!, '甲景点', [], 'RECOMMEND'),
        extractionPost(claims[4]!, '同名歧义景点', 'RECOMMEND', 'FIT', true),
        extractionPost(claims[5]!, '同名歧义景点', 'RECOMMEND', 'FIT', true)
      ]
    }
  ])

  const output = buildXhsAttractionOutput('昆明', materialized)
  const cuihu = output.entities.find((entity) => entity.canonicalSubject === '翠湖')!
  assert.deepEqual(cuihu.aliases, ['翠湖公园'])
  assert.equal(cuihu.claimIds.length, 2)
  assert.deepEqual(
    output.rankings.map((ranking) => ranking.subject),
    ['甲景点', '乙景点', '翠湖']
  )
  const cuihuRanking = output.rankings.find((ranking) => ranking.subject === '翠湖')!
  assert.equal(cuihuRanking.recommendPostCount, 1)
  assert.equal(cuihuRanking.avoidPostCount, 1)
  assert.equal(cuihuRanking.score, -1)
  assert.equal(
    output.entities.filter((entity) => entity.canonicalSubject === '同名歧义景点').length,
    2
  )
  assert.ok(output.rankings.every((ranking) => ranking.subject !== '同名歧义景点'))
})

function feeds(prefix: string, start: number, end: number): XhsSearchFeedRaw[] {
  return Array.from({ length: end - start + 1 }, (_, index) => feed(prefix, start + index))
}

function feed(prefix: string, index: number): XhsSearchFeedRaw {
  const id = `feed-${prefix}-${String(index).padStart(4, '0')}`
  return {
    id,
    xsecToken: `token-${id}`,
    modelType: 'note' as const,
    noteCard: {
      type: 'normal',
      displayTitle: `标题 ${id}`,
      user: { nickname: `作者 ${id}` }
    }
  }
}

function textResult(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] }
}

function detailPayload(feedId: string, comment = '评论内容'): Record<string, unknown> {
  return {
    note: {
      noteId: feedId,
      title: `详情 ${feedId}`,
      desc: `正文 ${feedId}`,
      type: 'normal',
      user: { nickname: `作者 ${feedId}` }
    },
    comments: [{ content: comment }]
  }
}

function sourceClaim(index: number, sampleGroup: 'RECOMMEND' | 'AVOID'): EvidenceClaim {
  const feedId = `source-${String(index).padStart(4, '0')}`
  return {
    claimId: `source-claim-${index}`,
    sessionId: 'xhs-ranking-session',
    subject: `帖子 ${index}`,
    predicate: 'xiaohongshuRankingSource',
    value: { sampleGroup, text: `正文 ${index}` },
    sourceId: 'SRC_XHS',
    sourceRef: `https://www.xiaohongshu.com/explore/${feedId}`,
    contentIdentity: 'INDEPENDENT_UGC',
    verificationStatus: 'UNVERIFIED',
    observedAt: '2026-08-30T00:00:00.000Z',
    validUntil: '2026-09-06T00:00:00.000Z',
    confidence: null,
    conflictsWith: [],
    notes: null
  }
}

function extractionPost(
  claim: EvidenceClaim,
  subject: string,
  stance: 'RECOMMEND' | 'AVOID' | 'MIXED',
  familyFit: 'FIT' | 'UNKNOWN' | 'RISK',
  ambiguous = false,
  promotionOnlySupport = false
): XhsExtractionBatch['posts'][number] {
  return {
    sourceClaimId: claim.claimId,
    signals: [
      {
        destinationCity: '昆明',
        subject,
        aliases: [],
        kind: 'ATTRACTION' as const,
        stance,
        recommendationReasons: stance === 'AVOID' ? [] : ['值得推荐'],
        avoidanceReasons: stance === 'RECOMMEND' ? [] : ['需要避雷'],
        familyFit,
        familyFitReasons: familyFit === 'UNKNOWN' ? [] : ['家庭适配证据'],
        identityStatus: ambiguous ? ('AMBIGUOUS' as const) : ('DETERMINISTIC' as const),
        promotionOnlySupport
      }
    ]
  }
}

function extractionPostWithAliases(
  claim: EvidenceClaim,
  subject: string,
  aliases: string[],
  stance: 'RECOMMEND' | 'AVOID'
): XhsExtractionBatch['posts'][number] {
  const post = extractionPost(claim, subject, stance, 'UNKNOWN')
  return {
    ...post,
    signals: post.signals.map((signal) => ({ ...signal, aliases }))
  }
}
