import { AppError } from '../../../shared/errors'
import { firstMcpText } from '../../../shared/schema/mcp/common'
import {
  XhsFeedDetailPayloadSchema,
  XhsMcpTextToolResultSchema,
  XhsRankingBatchResultSchema,
  XhsRankingNoteSchema,
  XhsSearchFeedsPayloadSchema,
  type XhsRankingBatchResult,
  type XhsRankingNote,
  type XhsSearchFeedRaw
} from '../../../shared/schema/mcp/xiaohongshu'
import type { XhsToolInvoker } from './xiaohongshu'

export const XHS_RANKING_QUERY_SUFFIXES = [
  '景点推荐 亲子 老人',
  '小众景点 轻松 少走路',
  '景点避雷 排队',
  '景点踩雷 步行 坡度'
] as const

export const XHS_RANKING_FILTERS = {
  sort_by: '综合',
  note_type: '图文',
  publish_time: '半年内',
  search_scope: '不限',
  location: '不限'
} as const

const SAMPLE_SIZE = 15
const MAX_DETAIL_CHARACTERS = 4000

interface Candidate {
  feedId: string
  xsecToken: string
  title: string
  author: string | null
  noteType: string
  sampleGroup: 'RECOMMEND' | 'AVOID'
  query: string
}

export function xhsRankingQueries(city: string): [string, string, string, string] {
  const destinationCity = city.normalize('NFKC').trim()
  return XHS_RANKING_QUERY_SUFFIXES.map((suffix) => `${destinationCity} ${suffix}`) as [
    string,
    string,
    string,
    string
  ]
}

export async function runXhsRankingBatch(input: {
  destinationCity: string
  invoke: XhsToolInvoker
  onProgress?: (completedSearches: number, completedDetails: number) => void
}): Promise<XhsRankingBatchResult> {
  const queries = xhsRankingQueries(input.destinationCity)
  const seen = new Set<string>()
  const recommend: Candidate[] = []
  const avoid: Candidate[] = []

  for (let queryIndex = 0; queryIndex < queries.length; queryIndex += 1) {
    const query = queries[queryIndex]!
    const group = queryIndex < 2 ? 'RECOMMEND' : 'AVOID'
    const raw = await input.invoke('search_feeds', { keyword: query, filters: XHS_RANKING_FILTERS })
    const feeds = XhsSearchFeedsPayloadSchema.parse(
      JSON.parse(firstMcpText(XhsMcpTextToolResultSchema.parse(raw)))
    )
    const target = group === 'RECOMMEND' ? recommend : avoid
    for (const feed of feeds) {
      if (seen.has(feed.id)) continue
      seen.add(feed.id)
      if (target.length >= SAMPLE_SIZE) continue
      target.push(candidateFrom(feed, group, query))
    }
    input.onProgress?.(queryIndex + 1, 0)
  }

  if (recommend.length !== SAMPLE_SIZE || avoid.length !== SAMPLE_SIZE) {
    throw new AppError('GATE_BLOCKED', '小红书候选不足以冻结 15 条推荐帖与 15 条避雷帖。', {
      userHint: `推荐帖缺口 ${SAMPLE_SIZE - recommend.length}，避雷帖缺口 ${SAMPLE_SIZE - avoid.length}；不会跨组补足或缩小样本。`
    })
  }

  const notes: XhsRankingNote[] = []
  let detailCharacters = 0
  let truncatedDetailCount = 0
  const candidates = [...recommend, ...avoid]
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!
    const raw = await input.invoke('get_feed_detail', {
      feed_id: candidate.feedId,
      xsec_token: candidate.xsecToken,
      load_all_comments: false
    })
    const detail = XhsFeedDetailPayloadSchema.parse(
      JSON.parse(firstMcpText(XhsMcpTextToolResultSchema.parse(raw)))
    )
    if (detail.note.noteId !== candidate.feedId) {
      throw new AppError('SOURCE_DRIFT', '小红书详情与冻结帖子标识不一致。')
    }
    const fullText = [detail.note.title, detail.note.desc]
      .map((part) => part.trim())
      .filter(Boolean)
      .join('\n')
    const text = fullText.slice(0, MAX_DETAIL_CHARACTERS)
    if (text.length < fullText.length) truncatedDetailCount += 1
    detailCharacters += text.length
    notes.push(
      XhsRankingNoteSchema.parse({
        feedId: candidate.feedId,
        sourceUrl: canonicalXhsUrl(candidate.feedId),
        title: detail.note.title.trim() || candidate.title,
        author: normalizedAuthor(detail.note.user) ?? candidate.author,
        noteType: detail.note.type.trim() || candidate.noteType,
        text,
        enriched: true,
        sampleGroup: candidate.sampleGroup,
        query: candidate.query
      })
    )
    input.onProgress?.(4, index + 1)
  }

  return XhsRankingBatchResultSchema.parse({
    destinationCity: input.destinationCity,
    notes,
    audit: {
      searchCalls: 4,
      detailCalls: 30,
      recommendPostCount: 15,
      avoidPostCount: 15,
      retryCount: 0,
      loadAllComments: false,
      detailCharacters,
      truncatedDetailCount
    }
  })
}

function candidateFrom(
  feed: XhsSearchFeedRaw,
  sampleGroup: Candidate['sampleGroup'],
  query: string
): Candidate {
  return {
    feedId: feed.id,
    xsecToken: feed.xsecToken,
    title: feed.noteCard.displayTitle,
    author: normalizedAuthor(feed.noteCard.user),
    noteType: feed.noteCard.type,
    sampleGroup,
    query
  }
}

function normalizedAuthor(user: { nickname?: string; nickName?: string }): string | null {
  const value = (user.nickname || user.nickName || '').normalize('NFKC').trim()
  return value ? value.slice(0, 200) : null
}

function canonicalXhsUrl(feedId: string): string {
  return `https://www.xiaohongshu.com/explore/${encodeURIComponent(feedId)}`
}
