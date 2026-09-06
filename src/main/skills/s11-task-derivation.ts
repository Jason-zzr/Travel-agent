import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  PreparationTaskSchema,
  type PreparationTask,
  type TaskHandover
} from '../../shared/schema/d7'
import type { TimelineItem, TimelineVersion } from '../../shared/schema/d6'
import type { EvidenceClaim } from '../../shared/schema/evidence'
import { ExternalSourceUrlSchema } from '../../shared/schema/source'

const ReservationPredicate = /预约|购票|票务|reservation|ticket/i
const RecheckPredicate = /开放|关闭|闭园|天气|营业|规则|recheck|opening|closed|weather/i
const UsableStatuses = new Set(['VERIFIED', 'CORROBORATED', 'VERIFIED_BY_USER'])
const ClaimObjectSchema = z.record(z.unknown())
const DateTimeSchema = z.string().datetime()

export interface DerivePreparationTasksInput {
  sessionId: string
  timeline: TimelineVersion
  claims: EvidenceClaim[]
  now: string
}

export function derivePreparationTasks(input: DerivePreparationTasksInput): PreparationTask[] {
  const claimsById = new Map(input.claims.map((claim) => [claim.claimId, claim]))
  const tasks = input.timeline.items
    .filter((item) => item.itemClass !== 'BACKUP')
    .sort(compareTimelineItems)
    .flatMap((item) => {
      const claims = item.claimIds.flatMap((claimId) => {
        const claim = claimsById.get(claimId)
        return claim ? [claim] : []
      })
      const forcedKind = routeTaskKind(item)
      const reservation = forcedKind === 'RESERVATION_TICKET' || claims.some(isReservationClaim)
      const preparation = isHardAnchor(item) || claims.some(isRecheckClaim)
      if (!reservation && !preparation && forcedKind === null) return []
      return [
        buildTask(
          input,
          item,
          claims,
          reservation ? 'RESERVATION_TICKET' : (forcedKind ?? 'PREPARATION')
        )
      ]
    })
  const unique = new Map<string, PreparationTask>()
  for (const task of tasks) unique.set(routeTaskKey(task), task)
  return [...unique.values()]
}

function buildTask(
  input: DerivePreparationTasksInput,
  item: TimelineItem,
  claims: EvidenceClaim[],
  kind: PreparationTask['kind']
): PreparationTask {
  const explicitDeadline = firstDateTime(claims, ['deadline', 'dueAt', 'hardDeadlineAt'])
  const dueAt = explicitDeadline ?? fallbackDueAt(item)
  const explicitRecheck = firstDateTime(claims, ['recheckAt'])
  const dueTimestamp = Date.parse(dueAt)
  const nowTimestamp = Date.parse(input.now)
  const validUntil =
    claims.length > 0 ? earliestTimestamp(claims.map((claim) => claim.validUntil)) : dueAt
  const recheckAt =
    dueTimestamp <= nowTimestamp
      ? input.now
      : new Date(
          Math.max(nowTimestamp, Math.min(dueTimestamp, Date.parse(explicitRecheck ?? validUntil)))
        ).toISOString()
  const officialClaim = claims.find(
    (claim) =>
      claim.contentIdentity === 'OFFICIAL' &&
      UsableStatuses.has(claim.verificationStatus) &&
      Date.parse(claim.validUntil) > nowTimestamp
  )
  const channelUrl = officialClaim ? officialChannelUrl(officialClaim) : null
  const channelLabel = officialClaim
    ? (firstString(claimObject(officialClaim), ['officialChannelLabel', 'channelLabel']) ??
      '已核验官方渠道')
    : null
  const stale = claims.some(
    (claim) => claim.verificationStatus === 'STALE' || Date.parse(claim.validUntil) <= nowTimestamp
  )
  const incomplete =
    claims.length === 0 ||
    explicitDeadline === null ||
    (kind === 'RESERVATION_TICKET' && (channelUrl === null || channelLabel === null))
  const evidenceStatus: TaskHandover['evidenceStatus'] = stale
    ? 'STALE'
    : incomplete
      ? 'INCOMPLETE'
      : 'VERIFIED'
  const taskId = stableTaskId(
    input.sessionId,
    input.timeline.version,
    item.itemId,
    kind,
    routeTaskScope(item)
  )
  return PreparationTaskSchema.parse({
    taskId,
    sessionId: input.sessionId,
    sourceTimelineVersion: input.timeline.version,
    itemId: item.itemId,
    claimIds: [...new Set(claims.map((claim) => claim.claimId))],
    kind,
    title: taskTitle(item, kind),
    owner: 'USER',
    dueAt,
    recheckAt,
    priority: isHardAnchor(item) || kind === 'RESERVATION_TICKET' ? 'HIGH' : 'NORMAL',
    userDecision: 'PENDING',
    reservation: 'NOT_STARTED',
    readiness: evidenceStatus === 'VERIFIED' ? 'UNKNOWN' : 'BLOCKED',
    payment: 'NA',
    document: 'NA',
    refund: 'NA',
    reminder: 'NA',
    handover: handoverFor(
      item,
      claims,
      kind,
      dueAt,
      explicitDeadline !== null,
      channelLabel,
      channelUrl,
      evidenceStatus
    ),
    routeContext: item.routeContext,
    updatedAt: input.now
  })
}

function handoverFor(
  item: TimelineItem,
  claims: EvidenceClaim[],
  kind: PreparationTask['kind'],
  deadline: string,
  explicitDeadline: boolean,
  channelLabel: string | null,
  channelUrl: string | null,
  evidenceStatus: TaskHandover['evidenceStatus']
): TaskHandover {
  const warnings = claims
    .flatMap((claim) => {
      const value = claimObject(claim)
      const raw = value?.warnings
      const parsed = z.array(z.string().trim().min(1).max(500)).max(8).safeParse(raw)
      return parsed.success ? parsed.data : []
    })
    .slice(0, 12)
  if (!explicitDeadline) warnings.push('截止时间为保守估算，需在官方渠道再次确认。')
  if (kind === 'RESERVATION_TICKET' && channelUrl === null) {
    warnings.push('缺少已核验官方渠道，任务保持阻塞。')
  }
  return {
    action:
      kind === 'RESERVATION_TICKET'
        ? `由用户在外部官方渠道办理“${item.title}”预约或购票。`
        : `由用户复核“${item.title}”的出发前有效性。`,
    channelLabel,
    channelUrl,
    requiredInformation:
      kind === 'RESERVATION_TICKET'
        ? ['日期、时段与人数；证件信息仅在官方渠道填写，不在本应用保存。']
        : ['核对日期、时刻、对象与当前规则。'],
    warnings: [...new Set(warnings)].slice(0, 12),
    deadline,
    deadlineSource: explicitDeadline ? 'EXPLICIT' : 'ESTIMATED',
    checklist:
      kind === 'RESERVATION_TICKET'
        ? ['确认对象、日期与时段', '确认全部同行人适用', '完成后回填结果']
        : ['检查证据是否仍在有效期', '确认无关闭或变更公告', '完成后标记任务'],
    evidenceStatus
  }
}

function isReservationClaim(claim: EvidenceClaim): boolean {
  if (ReservationPredicate.test(claim.predicate)) return true
  return firstBoolean(claimObject(claim), ['reservationRequired', 'ticketRequired']) === true
}

function isRecheckClaim(claim: EvidenceClaim): boolean {
  return RecheckPredicate.test(claim.predicate)
}

function isHardAnchor(item: TimelineItem): boolean {
  if (item.routeContext?.role === 'STAY_CHECKOUT') return false
  return (
    item.anchorClass === 'HARD_LOCKED' ||
    item.anchorClass === 'CONFIRMED_EXTERNAL' ||
    (item.routeContext !== null && item.routeContext !== undefined && item.anchorClass === 'MUST')
  )
}

function routeTaskKind(item: TimelineItem): PreparationTask['kind'] | null {
  if (item.routeContext?.role === 'INTERCITY_LEG' || item.routeContext?.role === 'STAY_CHECKIN') {
    return 'RESERVATION_TICKET'
  }
  if (item.routeContext && item.anchorClass === 'MUST') return 'PREPARATION'
  return null
}

function taskTitle(item: TimelineItem, kind: PreparationTask['kind']): string {
  if (item.routeContext?.role === 'INTERCITY_LEG') return `确认并办理跨城路段“${item.title}”`
  if (item.routeContext?.role === 'STAY_CHECKIN') return `确认住宿段“${item.title}”`
  if (item.routeContext && item.anchorClass === 'MUST') return `复核必去项目“${item.title}”`
  return kind === 'RESERVATION_TICKET'
    ? `办理“${item.title}”预约或购票`
    : `出发前复核“${item.title}”`
}

function routeTaskScope(item: TimelineItem): string {
  const scope = item.routeContext
  if (!scope) return 'legacy'
  return [scope.routeId, scope.routeLegId ?? '', scope.segmentId ?? '', scope.nodeId ?? ''].join(
    ':'
  )
}

function routeTaskKey(task: PreparationTask): string {
  const scope = task.routeContext
  if (!scope) return task.taskId
  if (scope.role === 'INTERCITY_LEG') return `${scope.routeId}:leg:${scope.routeLegId}`
  if (scope.role === 'STAY_CHECKIN') return `${scope.routeId}:stay:${scope.segmentId}`
  return task.taskId
}

function officialChannelUrl(claim: EvidenceClaim): string | null {
  const value = claimObject(claim)
  for (const candidate of [
    firstString(value, ['officialChannelUrl', 'channelUrl']),
    claim.sourceRef
  ]) {
    const parsed = ExternalSourceUrlSchema.safeParse(candidate)
    if (parsed.success) return parsed.data
  }
  return null
}

function firstDateTime(claims: EvidenceClaim[], keys: string[]): string | null {
  for (const claim of claims) {
    const value = claimObject(claim)
    for (const key of keys) {
      const parsed = DateTimeSchema.safeParse(value?.[key])
      if (parsed.success) return parsed.data
    }
  }
  return null
}

function firstString(value: Record<string, unknown> | null, keys: string[]): string | null {
  for (const key of keys) {
    const parsed = z.string().trim().min(1).max(1000).safeParse(value?.[key])
    if (parsed.success) return parsed.data
  }
  return null
}

function firstBoolean(value: Record<string, unknown> | null, keys: string[]): boolean | null {
  for (const key of keys) {
    const parsed = z.boolean().safeParse(value?.[key])
    if (parsed.success) return parsed.data
  }
  return null
}

function claimObject(claim: EvidenceClaim): Record<string, unknown> | null {
  const parsed = ClaimObjectSchema.safeParse(claim.value)
  return parsed.success ? parsed.data : null
}

function fallbackDueAt(item: TimelineItem): string {
  return new Date(Date.parse(`${item.date}T${item.startTime}:00+08:00`) - 86_400_000).toISOString()
}

function earliestTimestamp(values: string[]): string {
  return new Date(Math.min(...values.map(Date.parse))).toISOString()
}

function stableTaskId(
  sessionId: string,
  timelineVersion: number,
  itemId: string,
  kind: PreparationTask['kind'],
  routeScope: string
): string {
  const stableInput =
    routeScope === 'legacy'
      ? `${sessionId}\n${timelineVersion}\n${itemId}\n${kind}`
      : `${sessionId}\n${timelineVersion}\n${itemId}\n${kind}\n${routeScope}`
  return `task_${createHash('sha256').update(stableInput).digest('hex').slice(0, 32)}`
}

function compareTimelineItems(left: TimelineItem, right: TimelineItem): number {
  return (
    left.date.localeCompare(right.date) ||
    left.startTime.localeCompare(right.startTime) ||
    left.itemId.localeCompare(right.itemId)
  )
}
