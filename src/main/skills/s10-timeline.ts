import { AppError } from '../../shared/errors'
import {
  D6SourceOutcomeSchema,
  TimelineDraftSchema,
  TimelineGateReportSchema,
  TimelineItemSchema,
  TimelinePublishedPayloadWriteSchema,
  TimelineVersionSchema,
  type D6SourceOutcome,
  type TimelineBlockingItem,
  type TimelineDraft,
  type TimelineItem,
  type TimelinePublishedPayload
} from '../../shared/schema/d6'
import type { EvidenceClaim } from '../../shared/schema/evidence'
import type { TravelState } from '../../shared/schema/travel-state'
import { refineDailyRoutes } from './s09-route-refinement'

export interface CreateTimelineDraftInput {
  state: TravelState
  claims: EvidenceClaim[]
  draftId: string
  now: string
}

export interface PublishTimelineDraftInput {
  draft: TimelineDraft
  currentVersion: number
  now: string
}

export function createTimelineDraft(input: CreateTimelineDraftInput): TimelineDraft {
  const refined = refineDailyRoutes(input.state, input.claims)
  const routeDays =
    input.state.selectedRouteId === null ? input.state.daySkeletons : input.state.routeDaySkeletons
  const items = refined.items.map((refinedItem, index) => {
    const item: Partial<typeof refinedItem> = { ...refinedItem }
    delete item.itemKey
    return TimelineItemSchema.parse({
      ...item,
      itemId: `${input.draftId}:${index + 1}`
    })
  })
  const gate = buildTimelineGate(items, refined.blockingItems)
  return TimelineDraftSchema.parse({
    draftId: input.draftId,
    sessionId: input.state.sessionId,
    routeId: input.state.selectedRouteId,
    createdAt: input.now,
    summary: `将 ${routeDays.length} 天${input.state.selectedRouteId ? '多城市路线' : ''}骨架编译为 ${items.length} 个时间轴条目`,
    items,
    gate,
    sourceOutcomes: sourceOutcomes(input.claims, input.state.sessionId),
    changedDates: [...new Set(routeDays.map((day) => day.date))]
  })
}

export function publishTimelineDraft(input: PublishTimelineDraftInput): TimelinePublishedPayload {
  const gate = buildTimelineGate(input.draft.items)
  if (!gate.publishable) {
    throw new AppError('GATE_BLOCKED', '时间轴未通过发布门禁。', {
      userHint: gate.blockingItems.map((item) => item.message).join('；')
    })
  }
  const version = input.currentVersion + 1
  const claimIds = [
    ...new Set(
      input.draft.items.flatMap((item) => [
        ...item.claimIds,
        ...(item.arrivalTransport?.claimIds ?? [])
      ])
    )
  ]
  const hardAnchors = input.draft.items.filter(
    (item) =>
      item.anchorClass === 'HARD_LOCKED' ||
      (item.routeContext !== null && item.routeContext !== undefined && item.anchorClass === 'MUST')
  )
  const timeline = TimelineVersionSchema.parse({
    version,
    createdAt: input.now,
    summary: input.draft.summary,
    isCurrent: true,
    routeId: input.draft.routeId ?? null,
    items: input.draft.items,
    decision: {
      decisionId: `${input.draft.draftId}:publish`,
      category: 'TIMELINE_PUBLISH',
      selected: `timeline-v${version}`,
      reason: '通过时间冲突、缓冲、每日备用项和硬锚点证据门禁后发布。',
      alternatives: input.currentVersion > 0 ? [`timeline-v${input.currentVersion}`] : [],
      claimIds
    }
  })
  return TimelinePublishedPayloadWriteSchema.parse({
    timeline,
    sourceOutcomes: input.draft.sourceOutcomes,
    verification: {
      hardAnchorCount: hardAnchors.length,
      verifiedHardAnchorCount: hardAnchors.filter(
        (item) => item.verificationSummary.allClaimsUsable
      ).length,
      orphanFactCount: countOrphanFacts(input.draft.items)
    },
    changedDates: input.draft.changedDates
  })
}

export function buildTimelineGate(
  items: TimelineItem[],
  initialBlockingItems: TimelineBlockingItem[] = []
): TimelineDraft['gate'] {
  const blockingItems = [...initialBlockingItems]
  for (const item of items) {
    if (
      (item.anchorClass === 'HARD_LOCKED' ||
        (item.routeContext !== null &&
          item.routeContext !== undefined &&
          item.anchorClass === 'MUST')) &&
      !item.verificationSummary.allClaimsUsable
    ) {
      blockingItems.push({
        itemId: item.itemId,
        title: item.title,
        code: 'UNVERIFIED_HARD_ANCHOR',
        message: `${item.anchorClass === 'MUST' ? '必去项目' : '硬锚点'}“${item.title}”缺少可用验证证据。`,
        routeContext: item.routeContext
      })
    }
    if ((item.costCents !== null || item.itemClass !== 'FLEXIBLE') && item.claimIds.length === 0) {
      blockingItems.push({
        itemId: item.itemId,
        title: item.title,
        code: 'MISSING_CLAIM',
        message: `“${item.title}”包含具体事实但未关联 EvidenceClaim。`,
        routeContext: item.routeContext
      })
    }
  }
  blockingItems.push(...timelineOrderConflicts(items))
  const dates = [...new Set(items.map((item) => item.date))]
  for (const date of dates) {
    if (!items.some((item) => item.date === date && item.itemClass === 'BACKUP')) {
      const routeContext = items.find((item) => item.date === date)?.routeContext
      blockingItems.push({
        itemId: null,
        title: `${date} 备用项`,
        code: 'MISSING_BACKUP',
        message: `${date} 缺少 BACKUP。`,
        routeContext
      })
    }
  }
  return TimelineGateReportSchema.parse({
    publishable: blockingItems.length === 0,
    blockingItems: deduplicateBlockingItems(blockingItems)
  })
}

export function timelineOrderConflicts(items: TimelineItem[]): TimelineBlockingItem[] {
  const conflicts: TimelineBlockingItem[] = []
  const main = items
    .filter((item) => item.itemClass !== 'BACKUP')
    .sort((a, b) => normalizedStart(a) - normalizedStart(b))
  for (let index = 1; index < main.length; index += 1) {
    const previous = main[index - 1]!
    const current = main[index]!
    const required =
      normalizedEnd(previous) + (current.arrivalTransport?.etaMinutes ?? 0) + current.bufferMinutes
    if (normalizedStart(current) < required) {
      conflicts.push({
        itemId: current.itemId,
        title: current.title,
        code: 'TIME_CONFLICT',
        message: `“${current.title}”早于前一项目结束、ETA 与缓冲之和。`,
        routeContext: current.routeContext
      })
    }
  }
  return conflicts
}

function sourceOutcomes(claims: EvidenceClaim[], sessionId: string): D6SourceOutcome[] {
  const eligible = claims.filter((claim) => claim.sessionId === sessionId)
  const routeClaims = eligible.filter(
    (claim) =>
      claim.sourceId === 'SRC_MAP' && ['routeEta', 'groundTransfer'].includes(claim.predicate)
  )
  const restaurantClaims = eligible.filter((claim) => claim.predicate === 'restaurantCandidate')
  const backupClaims = eligible.filter((claim) => claim.predicate === 'backupCandidate')
  return [
    D6SourceOutcomeSchema.parse({
      sourceId: 'SRC_MAP',
      capability: 'ROUTE_ETA',
      status: routeClaims.length > 0 ? 'SUCCEEDED' : 'EMPTY',
      claimCount: routeClaims.length,
      externalCallCount: 0,
      errorCode: null,
      capabilityImpact: routeClaims.length > 0 ? null : '缺少路线 ETA 证据',
      manualAlternative:
        routeClaims.length > 0 ? null : '补充经 ToolRegistry 校验的 SRC_MAP 路线结果。'
    }),
    D6SourceOutcomeSchema.parse({
      sourceId: 'SRC_SEARCH',
      capability: 'RESTAURANT',
      status: restaurantClaims.length > 0 ? 'SUCCEEDED' : 'EMPTY',
      claimCount: restaurantClaims.length,
      externalCallCount: 0,
      errorCode: null,
      capabilityImpact: restaurantClaims.length > 0 ? null : '缺少具体餐厅候选',
      manualAlternative:
        restaurantClaims.length > 0 ? null : '补充餐厅位置、营业时间和预约要求证据。'
    }),
    D6SourceOutcomeSchema.parse({
      sourceId: 'USER_PASTE',
      capability: 'RESTAURANT',
      status: backupClaims.length > 0 ? 'SUCCEEDED' : 'NOT_REQUIRED',
      claimCount: backupClaims.length,
      externalCallCount: 0,
      errorCode: null,
      capabilityImpact: null,
      manualAlternative: null
    })
  ]
}

function countOrphanFacts(items: TimelineItem[]): number {
  return items.filter(
    (item) =>
      (item.costCents !== null && item.claimIds.length === 0) ||
      (item.arrivalTransport !== null && item.arrivalTransport.claimIds.length === 0)
  ).length
}

function normalizedStart(item: TimelineItem): number {
  return dateMinutes(item.date) + parseClock(item.startTime)
}

function normalizedEnd(item: TimelineItem): number {
  const end = dateMinutes(item.date) + parseClock(item.endTime)
  return item.crossesMidnight ? end + 1_440 : end
}

function dateMinutes(value: string): number {
  return Math.floor(Date.parse(`${value}T00:00:00.000Z`) / 86_400_000) * 1_440
}

function parseClock(value: string): number {
  const [hours, minutes] = value.split(':').map(Number)
  return (hours ?? 0) * 60 + (minutes ?? 0)
}

function deduplicateBlockingItems(items: TimelineBlockingItem[]): TimelineBlockingItem[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = `${item.itemId ?? ''}\n${item.code}\n${item.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
