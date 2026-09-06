import { createHash } from 'node:crypto'
import { AppError } from '../shared/errors'
import {
  EvidenceClaimSchema,
  RouteGoalLegEvidenceScopeSchema,
  type EvidenceClaim,
  type RouteGoalLegEvidenceScope
} from '../shared/schema/evidence'
import {
  ManualRouteLegEvidenceRequestSchema,
  RouteLegEvidenceValueSchema,
  type ManualRouteLegEvidenceRequest,
  type RouteLegEvidenceValue
} from '../shared/schema/itinerary'
import { deterministicClaimId } from './mcp/evidence'

const DAY_MS = 24 * 60 * 60 * 1000

export interface ManualRouteLegTarget {
  fromCity: string
  toCity: string
  travelDate: string
}

export interface MaterializedManualRouteLegEvidence {
  scope: RouteGoalLegEvidenceScope
  claim: EvidenceClaim
  value: RouteLegEvidenceValue
}

export function materializeManualRouteLegEvidence(
  input: ManualRouteLegEvidenceRequest,
  target: ManualRouteLegTarget,
  confirmedAt = new Date()
): MaterializedManualRouteLegEvidence {
  const request = ManualRouteLegEvidenceRequestSchema.parse(input)
  if (request.startAt.slice(0, 10) !== target.travelDate) {
    throw new AppError('INPUT_INVALID', '出发时间的本地日期必须与当前路线交通腿一致。')
  }
  const durationMinutes = Math.round(
    (Date.parse(request.endAt) - Date.parse(request.startAt)) / 60_000
  )
  if (durationMinutes <= 0) {
    throw new AppError('INPUT_INVALID', '到达时间必须晚于出发时间。')
  }
  const scope = RouteGoalLegEvidenceScopeSchema.parse({
    kind: 'ROUTE_GOAL_LEG',
    fromCity: target.fromCity,
    toCity: target.toCity,
    travelDate: target.travelDate
  })
  const sourceUrl = new URL(request.sourceUrl).toString()
  const value = RouteLegEvidenceValueSchema.parse({
    fromCity: target.fromCity,
    toCity: target.toCity,
    travelDate: target.travelDate,
    mode: request.mode,
    label: request.label,
    startAt: request.startAt,
    endAt: request.endAt,
    durationMinutes,
    costCents: request.costCents,
    transferCount: 0,
    overnightArrival: request.startAt.slice(0, 10) !== request.endAt.slice(0, 10),
    sourceLabel: request.sourceLabel,
    sourceUrl,
    summary: request.summary
  })
  const sourceRef = `USER_RESEARCH:${createHash('sha256')
    .update(
      JSON.stringify({
        routeId: request.routeId,
        legId: request.legId,
        scope,
        mode: request.mode,
        startAt: request.startAt,
        endAt: request.endAt,
        label: request.label,
        costCents: request.costCents,
        sourceLabel: request.sourceLabel,
        sourceUrl,
        summary: request.summary
      })
    )
    .digest('hex')
    .slice(0, 32)}`
  const subject = `${target.travelDate} ${target.fromCity}→${target.toCity} ${request.label}`
  const observedAt = confirmedAt.toISOString()
  const claim = EvidenceClaimSchema.parse({
    claimId: deterministicClaimId({
      sourceId: 'USER_RESEARCH',
      sourceRef,
      subject,
      predicate: 'routeLeg',
      scope
    }),
    sessionId: request.sessionId,
    subject,
    predicate: 'routeLeg',
    value,
    sourceId: 'USER_RESEARCH',
    sourceRef,
    contentIdentity: 'UNKNOWN',
    verificationStatus: 'VERIFIED_BY_USER',
    observedAt,
    validUntil: new Date(confirmedAt.getTime() + 7 * DAY_MS).toISOString(),
    scope,
    confidence: null,
    conflictsWith: [],
    notes: '用户显式确认的结构化交通证据；未调用外部来源或模型，不代表独立来源佐证。'
  })
  return { scope, claim, value }
}
