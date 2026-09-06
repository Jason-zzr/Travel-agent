import { GateCReportSchema, type GateCBlocker, type PreparationTask } from '../../shared/schema/d7'
import type { TimelineVersion } from '../../shared/schema/d6'
import type { EvidenceClaim } from '../../shared/schema/evidence'

const WeatherPredicate = /天气|weather/i
const ClosurePredicate = /闭园|关闭|停运|closure|closed/i
const HardAnchorClasses = new Set(['HARD_LOCKED', 'CONFIRMED_EXTERNAL'])
const UsableStatuses = new Set(['VERIFIED', 'CORROBORATED', 'VERIFIED_BY_USER'])

export interface BuildGateCInput {
  timeline: TimelineVersion
  tasks: PreparationTask[]
  claims: EvidenceClaim[]
  now: string
}

export function buildGateC(input: BuildGateCInput): ReturnType<typeof GateCReportSchema.parse> {
  const blockers: GateCBlocker[] = []
  const claimsById = new Map(input.claims.map((claim) => [claim.claimId, claim]))
  const now = Date.parse(input.now)

  for (const task of input.tasks) {
    if (task.priority === 'HIGH' && task.readiness !== 'READY') {
      blockers.push({
        code: 'HIGH_PRIORITY_TASK_PENDING',
        message: `高优先级任务“${task.title}”尚未完成。`,
        itemId: task.itemId,
        taskId: task.taskId,
        claimIds: task.claimIds,
        routeContext: task.routeContext
      })
    }
    if (task.handover.evidenceStatus !== 'VERIFIED') {
      blockers.push({
        code: 'TASK_HANDOVER_INCOMPLETE',
        message: `任务“${task.title}”缺少可用官方渠道或截止证据。`,
        itemId: task.itemId,
        taskId: task.taskId,
        claimIds: task.claimIds,
        routeContext: task.routeContext
      })
    }
    if (Date.parse(task.dueAt) < now && task.readiness !== 'READY') {
      blockers.push({
        code: 'TASK_OVERDUE',
        message: `任务“${task.title}”已超过截止时间。`,
        itemId: task.itemId,
        taskId: task.taskId,
        claimIds: task.claimIds,
        routeContext: task.routeContext
      })
    }
  }

  for (const item of input.timeline.items.filter(
    (entry) =>
      HardAnchorClasses.has(entry.anchorClass) ||
      (entry.routeContext !== null &&
        entry.routeContext !== undefined &&
        entry.anchorClass === 'MUST')
  )) {
    const claims = item.claimIds.flatMap((claimId) => {
      const claim = claimsById.get(claimId)
      return claim ? [claim] : []
    })
    const stale = claims.filter(
      (claim) => claim.verificationStatus === 'STALE' || Date.parse(claim.validUntil) <= now
    )
    if (stale.length > 0) {
      blockers.push({
        code: 'HARD_ANCHOR_STALE',
        message: `硬锚点“${item.title}”存在已过期证据。`,
        itemId: item.itemId,
        taskId: null,
        claimIds: stale.map((claim) => claim.claimId),
        routeContext: item.routeContext
      })
    }
    const unverified = claims.filter(
      (claim) =>
        !UsableStatuses.has(claim.verificationStatus) || Date.parse(claim.validUntil) <= now
    )
    if (claims.length === 0 || unverified.length > 0) {
      const routeRole = item.routeContext?.role
      const code =
        routeRole === 'INTERCITY_LEG'
          ? 'ROUTE_LEG_UNVERIFIED'
          : routeRole === 'STAY_CHECKIN'
            ? 'STAY_SEGMENT_UNVERIFIED'
            : item.anchorClass === 'MUST' && item.routeContext
              ? 'MUST_ANCHOR_UNVERIFIED'
              : 'HARD_ANCHOR_UNVERIFIED'
      blockers.push({
        code,
        message: `${routeBlockerLabel(code)}“${item.title}”缺少当前可用核验证据。`,
        itemId: item.itemId,
        taskId: null,
        claimIds: unverified.map((claim) => claim.claimId),
        routeContext: item.routeContext
      })
    }
  }

  const currentClaims = input.claims.filter(
    (claim) => claim.verificationStatus !== 'STALE' && Date.parse(claim.validUntil) > now
  )
  if (input.timeline.routeId) {
    const routeItems = input.timeline.items.filter((item) => item.itemClass !== 'BACKUP')
    const mismatched = routeItems.filter(
      (item) => item.routeContext?.routeId !== input.timeline.routeId
    )
    const mismatchedTasks = input.tasks.filter(
      (task) => task.routeContext?.routeId !== input.timeline.routeId
    )
    if (mismatched.length > 0 || mismatchedTasks.length > 0) {
      blockers.push({
        code: 'ROUTE_COVERAGE_INCOMPLETE',
        message: '当前时间轴或任务存在缺失、陈旧或跨路线的作用域。',
        itemId: mismatched[0]?.itemId ?? mismatchedTasks[0]?.itemId ?? null,
        taskId: mismatchedTasks[0]?.taskId ?? null,
        claimIds: [],
        routeContext: mismatched[0]?.routeContext ?? mismatchedTasks[0]?.routeContext
      })
    }
    const nodeContexts = new Map(
      routeItems.flatMap((item) =>
        item.routeContext?.nodeId ? ([[item.routeContext.nodeId, item.routeContext]] as const) : []
      )
    )
    for (const [nodeId, routeContext] of nodeContexts) {
      const hasWeather = currentClaims.some(
        (claim) =>
          WeatherPredicate.test(claim.predicate) &&
          claim.scope?.kind === 'ROUTE_NODE' &&
          claim.scope.routeId === input.timeline.routeId &&
          claim.scope.nodeId === nodeId
      )
      if (!hasWeather) {
        blockers.push({
          code: 'WEATHER_RECHECK_MISSING',
          message: `路线节点 ${nodeId} 缺少出发前仍有效的天气复核证据。`,
          itemId: null,
          taskId: null,
          claimIds: [],
          routeContext
        })
      }
    }
    for (const item of routeItems.filter((candidate) => candidate.anchorClass === 'MUST')) {
      const hasClosure = currentClaims.some(
        (claim) =>
          ClosurePredicate.test(claim.predicate) &&
          (item.claimIds.includes(claim.claimId) ||
            (claim.scope?.kind === 'ROUTE_NODE' &&
              claim.scope.routeId === input.timeline.routeId &&
              claim.scope.nodeId === item.routeContext?.nodeId))
      )
      if (!hasClosure) {
        blockers.push({
          code: 'CLOSURE_RECHECK_MISSING',
          message: `必去项目“${item.title}”缺少出发前仍有效的闭园公告复核证据。`,
          itemId: item.itemId,
          taskId: null,
          claimIds: [],
          routeContext: item.routeContext
        })
      }
    }
  } else if (!currentClaims.some((claim) => WeatherPredicate.test(claim.predicate))) {
    blockers.push({
      code: 'WEATHER_RECHECK_MISSING',
      message: '缺少出发前仍有效的天气复核证据。',
      itemId: null,
      taskId: null,
      claimIds: []
    })
  }
  if (
    !input.timeline.routeId &&
    !currentClaims.some((claim) => ClosurePredicate.test(claim.predicate))
  ) {
    blockers.push({
      code: 'CLOSURE_RECHECK_MISSING',
      message: '缺少出发前仍有效的闭园或停运公告复核证据。',
      itemId: null,
      taskId: null,
      claimIds: []
    })
  }

  const uniqueBlockers = deduplicateBlockers(blockers)
  return GateCReportSchema.parse({
    gateId: 'GATE_C',
    evaluatedAt: input.now,
    ready: uniqueBlockers.length === 0,
    timelineVersion: input.timeline.version,
    routeId: input.timeline.routeId ?? null,
    blockers: uniqueBlockers,
    taskIds: [...new Set(input.tasks.map((task) => task.taskId))],
    claimIds: [...new Set(input.timeline.items.flatMap((item) => item.claimIds))]
  })
}

function routeBlockerLabel(code: GateCBlocker['code']): string {
  if (code === 'ROUTE_LEG_UNVERIFIED') return '跨城路段'
  if (code === 'STAY_SEGMENT_UNVERIFIED') return '住宿段'
  if (code === 'MUST_ANCHOR_UNVERIFIED') return '必去项目'
  return '硬锚点'
}

function deduplicateBlockers(blockers: GateCBlocker[]): GateCBlocker[] {
  const seen = new Set<string>()
  return blockers.filter((blocker) => {
    const key = `${blocker.code}\n${blocker.taskId ?? ''}\n${blocker.itemId ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
