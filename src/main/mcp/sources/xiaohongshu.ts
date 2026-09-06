import { AppError } from '../../../shared/errors'
import { firstMcpText } from '../../../shared/schema/mcp/common'
import {
  XhsFeedDetailPayloadSchema,
  XhsMcpTextToolResultSchema,
  XhsNormalizedNoteSchema,
  XhsResearchResultSchema,
  XhsSearchFeedsPayloadSchema,
  type XhsNormalizedNote,
  type XhsQueryKind,
  type XhsResearchResult
} from '../../../shared/schema/mcp/xiaohongshu'

const MAX_SEARCH_RESULTS = 10
const MAX_DETAILS = 2
const MAX_DETAIL_CHARACTERS = 4000

export type XhsReadToolName = 'search_feeds' | 'get_feed_detail'
export type XhsToolInvoker = (
  toolName: XhsReadToolName,
  args: Record<string, unknown>
) => Promise<unknown>

interface TransientCandidate {
  feedId: string
  xsecToken: string
  title: string
  author: string | null
  noteType: string
}

export async function runXhsResearch(input: {
  queryKind: XhsQueryKind
  query: string
  invoke: XhsToolInvoker
}): Promise<XhsResearchResult> {
  const searchResult = await input.invoke('search_feeds', { keyword: input.query })
  const feeds = XhsSearchFeedsPayloadSchema.parse(
    JSON.parse(firstMcpText(XhsMcpTextToolResultSchema.parse(searchResult)))
  )
  const candidates = normalizeCandidates(feeds)
  if (candidates.length === 0) {
    throw new AppError('SOURCE_DRIFT', '小红书搜索没有可追溯的笔记结果。', {
      userHint: '小红书返回内容缺少笔记标题或标识，请稍后重新登录伴随服务。'
    })
  }

  const notes: XhsNormalizedNote[] = candidates.map((candidate) =>
    XhsNormalizedNoteSchema.parse({
      feedId: candidate.feedId,
      sourceUrl: canonicalXhsUrl(candidate.feedId),
      title: candidate.title,
      author: candidate.author,
      noteType: candidate.noteType,
      text: '',
      enriched: false,
      queryKind: input.queryKind
    })
  )
  let detailCalls = 0
  let detailCharacters = 0
  let truncatedDetailCount = 0
  let detailFailureCount = 0

  for (let index = 0; index < Math.min(MAX_DETAILS, candidates.length); index += 1) {
    const candidate = candidates[index]!
    detailCalls += 1
    try {
      const raw = await input.invoke('get_feed_detail', {
        feed_id: candidate.feedId,
        xsec_token: candidate.xsecToken,
        load_all_comments: false
      })
      const detail = XhsFeedDetailPayloadSchema.parse(
        JSON.parse(firstMcpText(XhsMcpTextToolResultSchema.parse(raw)))
      )
      if (detail.note.noteId !== candidate.feedId) {
        throw new AppError('SOURCE_DRIFT', '小红书详情与搜索笔记标识不一致。')
      }
      const fullText = [detail.note.title, detail.note.desc]
        .map((part) => part.trim())
        .filter(Boolean)
        .join('\n')
      const text = fullText.slice(0, MAX_DETAIL_CHARACTERS)
      if (fullText.length > text.length) truncatedDetailCount += 1
      detailCharacters += text.length
      notes[index] = XhsNormalizedNoteSchema.parse({
        ...notes[index],
        title: detail.note.title.trim() || candidate.title,
        author: normalizedAuthor(detail.note.user) ?? candidate.author,
        noteType: detail.note.type.trim() || candidate.noteType,
        text,
        enriched: true
      })
    } catch {
      detailFailureCount += 1
    }
  }

  return XhsResearchResultSchema.parse({
    queryKind: input.queryKind,
    query: input.query,
    notes,
    audit: {
      searchCalls: 1,
      detailCalls,
      retainedSourceCount: notes.length,
      detailCharacters,
      truncatedDetailCount,
      detailFailureCount,
      retryCount: 0
    }
  })
}

function normalizeCandidates(
  feeds: ReturnType<typeof XhsSearchFeedsPayloadSchema.parse>
): TransientCandidate[] {
  const seen = new Set<string>()
  const candidates: TransientCandidate[] = []
  for (const feed of feeds) {
    if (seen.has(feed.id)) continue
    seen.add(feed.id)
    candidates.push({
      feedId: feed.id,
      xsecToken: feed.xsecToken,
      title: feed.noteCard.displayTitle,
      author: normalizedAuthor(feed.noteCard.user),
      noteType: feed.noteCard.type
    })
    if (candidates.length === MAX_SEARCH_RESULTS) break
  }
  return candidates
}

function normalizedAuthor(user: { nickname?: string; nickName?: string }): string | null {
  const value = (user.nickname || user.nickName || '').normalize('NFKC').trim()
  return value ? value.slice(0, 200) : null
}

function canonicalXhsUrl(feedId: string): string {
  return `https://www.xiaohongshu.com/explore/${encodeURIComponent(feedId)}`
}
