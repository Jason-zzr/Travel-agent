import { AppError } from '../../shared/errors'
import {
  D5SourceOutcomeSchema,
  StayCandidateSchema,
  type D5SourceOutcome,
  type StayCandidate,
  type StaySegment
} from '../../shared/schema/d5'
import type { EvidenceClaim, JsonValue } from '../../shared/schema/evidence'

type JsonRecord = Record<string, JsonValue>
const SOURCES = ['SRC_HOTEL', 'SRC_SEARCH', 'USER_PASTE'] as const

export function buildStayCandidates(
  segment: StaySegment,
  claims: EvidenceClaim[],
  sourceOutcomeOverrides: D5SourceOutcome[] = []
): { candidates: StayCandidate[]; sourceOutcomes: D5SourceOutcome[] } {
  const eligible = claims.filter(
    (claim) =>
      SOURCES.includes(claim.sourceId as (typeof SOURCES)[number]) &&
      claim.predicate === 'lodgingCandidate'
  )
  const invalidHotelIdentity = eligible.find(
    (claim) => claim.sourceId === 'SRC_HOTEL' && claim.contentIdentity !== 'COMMERCIAL_OFFER'
  )
  if (invalidHotelIdentity) {
    throw new AppError('GATE_BLOCKED', '酒店来源候选缺少 COMMERCIAL_OFFER 身份。')
  }
  const candidates = eligible.flatMap((claim) => {
    const value = asRecord(claim.value)
    if (!value) return []
    const name = text(value.name)
    if (!name) return []
    const total = amount(value.totalCostCents)
    const totalComplete = value.totalCostComplete === true
    const capacity = amount(value.capacity)
    const roomFitsParty = typeof value.roomFitsParty === 'boolean' ? value.roomFitsParty : null
    const cancellationStatus =
      value.cancellationStatus === 'FREE_UNTIL' || value.cancellationStatus === 'NON_REFUNDABLE'
        ? value.cancellationStatus
        : 'UNKNOWN'
    const candidate = StayCandidateSchema.parse({
      candidateId: `stay-candidate-${claim.claimId}`,
      segmentId: segment.segmentId,
      sourceId: claim.sourceId,
      name,
      claimId: claim.claimId,
      contentIdentity: claim.contentIdentity,
      verificationStatus: claim.verificationStatus,
      totalCostCents: totalComplete ? total : null,
      totalCostComplete: totalComplete && total !== null,
      roomType: text(value.roomType),
      bedType: text(value.bedType),
      capacity,
      roomFitsParty,
      cancellation: {
        status: cancellationStatus,
        freeCancelUntil: cancellationStatus === 'FREE_UNTIL' ? text(value.freeCancelUntil) : null
      },
      positionAdvantage: text(value.positionAdvantage) ?? '位置优势尚待核验',
      recommendationEligible:
        totalComplete &&
        total !== null &&
        roomFitsParty === true &&
        claim.verificationStatus !== 'STALE' &&
        claim.verificationStatus !== 'CONFLICTED'
    })
    return [candidate]
  })
  const overrides = new Map(sourceOutcomeOverrides.map((outcome) => [outcome.sourceId, outcome]))
  const sourceOutcomes = SOURCES.map((sourceId) => {
    const override = overrides.get(sourceId)
    if (override) return D5SourceOutcomeSchema.parse(override)
    const count = candidates.filter((candidate) => candidate.sourceId === sourceId).length
    return D5SourceOutcomeSchema.parse({
      sourceId,
      status: count > 0 ? 'SUCCEEDED' : 'EMPTY',
      candidateCount: count,
      errorCode: null,
      capabilityImpact: count > 0 ? null : `${sourceId} 本轮没有可用的整段住宿报价`,
      manualAlternative: count > 0 ? null : '可粘贴带完整入住日期、房型、入住人数和退改规则的报价。'
    })
  })
  if (candidates.length === 0 && sourceOutcomes.every((outcome) => outcome.status === 'EMPTY'))
    throw new AppError('GATE_BLOCKED', '三个住宿来源均没有可用候选。', {
      userHint: '请补充 lodgingCandidate 证据，禁止用单晚最低价乘以晚数。'
    })
  return {
    candidates: candidates.sort(
      (a, b) =>
        (a.totalCostCents ?? Number.MAX_SAFE_INTEGER) -
        (b.totalCostCents ?? Number.MAX_SAFE_INTEGER)
    ),
    sourceOutcomes
  }
}

function asRecord(value: JsonValue): JsonRecord | null {
  return value !== null && !Array.isArray(value) && typeof value === 'object' ? value : null
}
function text(value: JsonValue | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
function amount(value: JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}
