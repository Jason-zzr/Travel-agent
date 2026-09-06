import { z } from 'zod'
import { McpTextToolResultSchema } from './common'

export const XHS_LOGIN_QR_MAX_DECODED_BYTES = 512 * 1024
const XHS_LOGIN_QR_MAX_BASE64_LENGTH = Math.ceil(XHS_LOGIN_QR_MAX_DECODED_BYTES / 3) * 4
const XHS_LOGIN_QR_DATA_URL_PREFIX = 'data:image/png;base64,'
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

function isBoundedPngBase64(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > XHS_LOGIN_QR_MAX_BASE64_LENGTH ||
    !value.startsWith('iVBORw0KGgo') ||
    !BASE64_PATTERN.test(value)
  ) {
    return false
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return (value.length / 4) * 3 - padding <= XHS_LOGIN_QR_MAX_DECODED_BYTES
}

const XhsLoginQrTextBlockSchema = z
  .object({ type: z.literal('text'), text: z.string().trim().min(1).max(1000) })
  .strict()
const XhsLoginQrImageBlockSchema = z
  .object({
    type: z.literal('image'),
    data: z.string().refine(isBoundedPngBase64, 'Expected a bounded PNG base64 payload.'),
    mimeType: z.literal('image/png')
  })
  .strict()
const XhsLoginQrContentBlockSchema = z.union([
  XhsLoginQrTextBlockSchema,
  XhsLoginQrImageBlockSchema
])

export const XhsLoginQrSuccessMcpResultSchema = z
  .object({
    content: z.array(XhsLoginQrContentBlockSchema).length(2),
    isError: z.literal(false).optional()
  })
  .strict()
  .superRefine((result, context) => {
    if (result.content.filter((block) => block.type === 'text').length !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['content'],
        message: 'Expected exactly one text block.'
      })
    }
    if (result.content.filter((block) => block.type === 'image').length !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['content'],
        message: 'Expected exactly one image block.'
      })
    }
  })

const XhsAlreadyLoggedInMcpResultSchema = z
  .object({
    content: z
      .array(XhsLoginQrTextBlockSchema)
      .length(1)
      .refine(
        ([block]) => block?.text === '你当前已处于登录状态',
        'Expected the pinned already-logged-in response.'
      ),
    isError: z.literal(false).optional()
  })
  .strict()

const XhsLoginQrErrorMcpResultSchema = z
  .object({
    content: z.array(XhsLoginQrTextBlockSchema).min(1).max(2),
    isError: z.literal(true)
  })
  .strict()

export const XhsLoginQrMcpResultSchema = z.union([
  XhsLoginQrSuccessMcpResultSchema,
  XhsAlreadyLoggedInMcpResultSchema,
  XhsLoginQrErrorMcpResultSchema
])

export const XhsLoginQrRequiredSchema = z
  .object({
    status: z.literal('QR_REQUIRED'),
    imageDataUrl: z
      .string()
      .max(XHS_LOGIN_QR_DATA_URL_PREFIX.length + XHS_LOGIN_QR_MAX_BASE64_LENGTH)
      .refine(
        (value) =>
          value.startsWith(XHS_LOGIN_QR_DATA_URL_PREFIX) &&
          isBoundedPngBase64(value.slice(XHS_LOGIN_QR_DATA_URL_PREFIX.length)),
        'Expected a bounded PNG data URL.'
      ),
    hint: z.string().trim().min(1).max(1000),
    expiresAt: z.string().datetime({ offset: true })
  })
  .strict()
export type XhsLoginQrRequired = z.infer<typeof XhsLoginQrRequiredSchema>

export const XhsLoginQrDisplaySchema = z.discriminatedUnion('status', [
  XhsLoginQrRequiredSchema,
  z.object({ status: z.literal('ALREADY_LOGGED_IN') }).strict()
])
export type XhsLoginQrDisplay = z.infer<typeof XhsLoginQrDisplaySchema>

export function normalizeXhsLoginQrResult(input: unknown):
  | { status: 'ALREADY_LOGGED_IN' }
  | {
      status: 'QR_REQUIRED'
      hint: string
      imageBase64: string
    } {
  const envelope = XhsLoginQrMcpResultSchema.parse(input)
  if (
    envelope.isError !== true &&
    envelope.content.length === 1 &&
    envelope.content[0]?.type === 'text'
  ) {
    return { status: 'ALREADY_LOGGED_IN' }
  }
  const result = XhsLoginQrSuccessMcpResultSchema.parse(envelope)
  const hint = result.content.find((block) => block.type === 'text')
  const image = result.content.find((block) => block.type === 'image')
  if (!hint || hint.type !== 'text' || !image || image.type !== 'image') {
    throw new Error('XHS login QR schema invariant failed.')
  }
  return { status: 'QR_REQUIRED', hint: hint.text, imageBase64: image.data }
}

export const XhsMcpTextToolResultSchema = McpTextToolResultSchema.passthrough()
  .superRefine((result, context) => {
    if (Object.prototype.hasOwnProperty.call(result, 'structuredContent')) {
      context.addIssue({
        code: 'custom',
        path: ['structuredContent'],
        message: 'XHS structuredContent is not supported.'
      })
    }
  })
  .transform((result) => McpTextToolResultSchema.parse(result))

export const XhsQueryKindSchema = z.enum(['POSITIVE_LOCATION', 'NEGATIVE_AVOIDANCE'])
export type XhsQueryKind = z.infer<typeof XhsQueryKindSchema>

const XhsFeedIdSchema = z
  .string()
  .trim()
  .min(8)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/)
const XhsUserRawSchema = z
  .object({
    userId: z.string().optional(),
    nickname: z.string().optional(),
    nickName: z.string().optional()
  })
  .passthrough()

export const XhsSearchFeedRawSchema = z
  .object({
    id: XhsFeedIdSchema,
    xsecToken: z.string().min(1).max(4096),
    modelType: z.literal('note'),
    noteCard: z
      .object({
        type: z.string().trim().min(1).max(40),
        displayTitle: z.string().trim().min(1).max(500),
        user: XhsUserRawSchema
      })
      .passthrough()
  })
  .passthrough()

export const XhsSearchFeedsRawSchema = z.array(XhsSearchFeedRawSchema).min(1).max(100)
export type XhsSearchFeedRaw = z.infer<typeof XhsSearchFeedRawSchema>

const XhsSearchFeedsOfficialSchema = z
  .object({
    feeds: XhsSearchFeedsRawSchema,
    count: z.number().int().nonnegative()
  })
  .passthrough()
  .superRefine((value, context) => {
    if (value.count !== value.feeds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['count'],
        message: 'count must equal feeds length.'
      })
    }
  })

export const XhsSearchFeedsPayloadSchema = z.union([
  XhsSearchFeedsRawSchema,
  XhsSearchFeedsOfficialSchema.transform((value) => value.feeds)
])

export const XhsFeedDetailRawSchema = z
  .object({
    note: z
      .object({
        noteId: XhsFeedIdSchema,
        xsecToken: z.string().optional(),
        title: z.string().trim().max(500).default(''),
        desc: z.string().trim().max(100_000).default(''),
        type: z.string().trim().max(40).default(''),
        time: z.number().int().nonnegative().optional(),
        ipLocation: z.string().trim().max(120).optional(),
        user: XhsUserRawSchema
      })
      .passthrough(),
    comments: z.unknown().optional()
  })
  .passthrough()
export type XhsFeedDetailRaw = z.infer<typeof XhsFeedDetailRawSchema>

const XhsFeedDetailOfficialSchema = z
  .object({
    feed_id: XhsFeedIdSchema,
    data: XhsFeedDetailRawSchema
  })
  .passthrough()
  .superRefine((value, context) => {
    if (value.feed_id !== value.data.note.noteId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['feed_id'],
        message: 'feed_id must equal data.note.noteId.'
      })
    }
  })

export const XhsFeedDetailPayloadSchema = z.union([
  XhsFeedDetailRawSchema,
  XhsFeedDetailOfficialSchema.transform((value) => value.data)
])

export const XhsNormalizedNoteSchema = z
  .object({
    feedId: XhsFeedIdSchema,
    sourceUrl: z
      .string()
      .url()
      .refine((value) => {
        const url = new URL(value)
        return (
          url.protocol === 'https:' &&
          url.hostname === 'www.xiaohongshu.com' &&
          /^\/explore\/[A-Za-z0-9_-]+$/.test(url.pathname) &&
          !url.search &&
          !url.hash &&
          !url.username &&
          !url.password
        )
      }),
    title: z.string().trim().min(1).max(500),
    author: z.string().trim().min(1).max(200).nullable(),
    noteType: z.string().trim().min(1).max(40),
    text: z.string().max(4000),
    enriched: z.boolean(),
    queryKind: XhsQueryKindSchema
  })
  .strict()
export type XhsNormalizedNote = z.infer<typeof XhsNormalizedNoteSchema>

export const XhsRankingNoteSchema = XhsNormalizedNoteSchema.omit({ queryKind: true })
  .extend({
    sampleGroup: z.enum(['RECOMMEND', 'AVOID']),
    query: z.string().trim().min(1).max(4000)
  })
  .strict()
export type XhsRankingNote = z.infer<typeof XhsRankingNoteSchema>

export const XhsRankingBatchResultSchema = z
  .object({
    destinationCity: z.string().trim().min(1).max(80),
    notes: z.array(XhsRankingNoteSchema).length(30),
    audit: z
      .object({
        searchCalls: z.literal(4),
        detailCalls: z.literal(30),
        recommendPostCount: z.literal(15),
        avoidPostCount: z.literal(15),
        retryCount: z.literal(0),
        loadAllComments: z.literal(false),
        detailCharacters: z.number().int().nonnegative().max(120_000),
        truncatedDetailCount: z.number().int().nonnegative().max(30)
      })
      .strict()
  })
  .strict()
export type XhsRankingBatchResult = z.infer<typeof XhsRankingBatchResultSchema>

export const XhsResearchAuditSchema = z
  .object({
    searchCalls: z.literal(1),
    detailCalls: z.number().int().min(0).max(2),
    retainedSourceCount: z.number().int().min(1).max(10),
    detailCharacters: z.number().int().min(0).max(8000),
    truncatedDetailCount: z.number().int().min(0).max(2),
    detailFailureCount: z.number().int().min(0).max(2),
    retryCount: z.literal(0)
  })
  .strict()
export type XhsResearchAudit = z.infer<typeof XhsResearchAuditSchema>

export const XhsResearchResultSchema = z
  .object({
    queryKind: XhsQueryKindSchema,
    query: z.string().trim().min(1).max(4000),
    notes: z.array(XhsNormalizedNoteSchema).min(1).max(10),
    audit: XhsResearchAuditSchema
  })
  .strict()
export type XhsResearchResult = z.infer<typeof XhsResearchResultSchema>

export const XhsConnectionStatusSchema = z
  .object({
    connected: z.literal(true),
    loggedIn: z.boolean(),
    authTokenConfigured: z.boolean()
  })
  .strict()
export type XhsConnectionStatus = z.infer<typeof XhsConnectionStatusSchema>
