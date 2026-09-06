import { createHash } from 'node:crypto'
import { AppError } from '../../shared/errors'
import {
  TransportCandidateSchema,
  type TransportCandidate,
  type TransportLeg
} from '../../shared/schema/d5'
import type { EvidenceClaim, JsonValue } from '../../shared/schema/evidence'

type JsonRecord = Record<string, JsonValue>

function record(value: JsonValue): JsonRecord | null {
  return value !== null && !Array.isArray(value) && typeof value === 'object' ? value : null
}

function text(value: JsonValue | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function number(value: JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function leg(
  kind: TransportLeg['kind'],
  claim: EvidenceClaim,
  value: JsonRecord,
  fallback: { from: string; to: string; durationMinutes?: number }
): TransportLeg {
  const startAt = text(value.startAt)
  const durationSeconds = number(value.durationSeconds)
  return {
    kind,
    label: text(value.label) ?? kind,
    from: text(value.from) ?? fallback.from,
    to: text(value.to) ?? fallback.to,
    startAt,
    endAt:
      startAt && durationSeconds !== null
        ? addSecondsPreservingOffset(startAt, durationSeconds)
        : text(value.endAt),
    durationMinutes: number(value.durationMinutes) ?? fallback.durationMinutes ?? 0,
    costCents: number(value.costCents),
    sourceId: claim.sourceId === 'SRC_RAIL' || claim.sourceId === 'SRC_MAP' ? claim.sourceId : null,
    claimIds: [claim.claimId],
    verificationStatus: claim.verificationStatus
  }
}

export function buildTransportCandidates(claims: EvidenceClaim[]): TransportCandidate[] {
  const railClaims = claims.filter(
    (claim) => claim.sourceId === 'SRC_RAIL' && claim.predicate === 'railJourney'
  )
  const transferClaims = claims.filter(
    (claim) => claim.sourceId === 'SRC_MAP' && claim.predicate === 'groundTransfer'
  )
  const grouped = new Map<string, EvidenceClaim[]>()
  for (const claim of railClaims) {
    const value = record(claim.value)
    const candidateId = value ? text(value.candidateId) : null
    if (!candidateId) continue
    grouped.set(candidateId, [...(grouped.get(candidateId) ?? []), claim])
  }

  const candidates = [...grouped.entries()].flatMap(([candidateId, journeys]) => {
    const directions = ['OUTBOUND', 'RETURN'] as const
    const built = directions.map((direction) => {
      const railClaim = journeys.find((claim) => text(record(claim.value)?.direction) === direction)
      if (!railClaim) return null
      const railValue = record(railClaim.value)!
      const matchingTransfers = transferClaims.filter((claim) => {
        const value = record(claim.value)
        return (
          value && text(value.candidateId) === candidateId && text(value.direction) === direction
        )
      })
      const firstClaim = matchingTransfers.find(
        (claim) => text(record(claim.value)?.kind) === 'FIRST_MILE'
      )
      const lastClaim = matchingTransfers.find(
        (claim) => text(record(claim.value)?.kind) === 'LAST_MILE'
      )
      if (!firstClaim || !lastClaim) return null
      const firstValue = record(firstClaim.value)!
      const lastValue = record(lastClaim.value)!
      const first = leg('FIRST_MILE', firstClaim, firstValue, { from: '出发地', to: '车站' })
      const intercity = leg('INTERCITY', railClaim, railValue, { from: '出发站', to: '到达站' })
      const wait = leg(
        'WAIT',
        railClaim,
        { ...railValue, durationMinutes: number(railValue.waitMinutes) ?? 45, costCents: 0 },
        { from: first.to, to: intercity.from }
      )
      const last = leg('LAST_MILE', lastClaim, lastValue, { from: '车站', to: '目的地区域' })
      const legs = [first, wait, intercity, last] as const
      const costs = legs.map((item) => item.costCents)
      return {
        direction,
        legs,
        totalDurationMinutes: legs.reduce((sum, item) => sum + item.durationMinutes, 0),
        totalCostCents: costs.every((item) => item !== null)
          ? costs.reduce<number>((sum, item) => sum + (item ?? 0), 0)
          : null
      }
    })
    const outbound = built[0]
    const returnDirection = built[1]
    if (!outbound || !returnDirection) return []
    const allClaims = [
      ...new Set([...outbound.legs, ...returnDirection.legs].flatMap((item) => item.claimIds))
    ]
    const totalCostComplete =
      outbound.totalCostCents !== null && returnDirection.totalCostCents !== null
    const totalMinutes = outbound.totalDurationMinutes + returnDirection.totalDurationMinutes
    return [
      TransportCandidateSchema.parse({
        candidateId: `transport-${createHash('sha256').update(candidateId).digest('hex').slice(0, 16)}`,
        title: text(record(journeys[0]!.value)?.title) ?? `铁路往返方案 ${candidateId}`,
        mode: 'RAIL',
        outbound,
        return: returnDirection,
        doorToDoorTotalMinutes: totalMinutes,
        totalCostCents: totalCostComplete
          ? outbound.totalCostCents! + returnDirection.totalCostCents!
          : null,
        costComplete: totalCostComplete,
        arrivalUsableMinutes: Math.max(
          0,
          1320 - localMinutes(outbound.legs[3].endAt ?? outbound.legs[2].endAt)
        ),
        departureUsableMinutes: Math.max(
          0,
          localMinutes(returnDirection.legs[0].startAt ?? returnDirection.legs[2].startAt) - 480
        ),
        comfort: totalMinutes <= 720 ? 'GOOD' : totalMinutes <= 960 ? 'FAIR' : 'RISK',
        comfortReasons: [`往返门到门约 ${totalMinutes} 分钟`, '包含首段、候车、城际和末段接驳'],
        isRecommended: false,
        materialDifferences: [],
        claimIds: allClaims
      })
    ]
  })
  if (candidates.length === 0) {
    throw new AppError('GATE_BLOCKED', '没有同时覆盖往返铁路与首末接驳的交通证据。', {
      userHint: '请先补齐 SRC_RAIL 的 railJourney 和 SRC_MAP 的 groundTransfer 证据。'
    })
  }
  const sorted = candidates
    .sort((a, b) => a.doorToDoorTotalMinutes - b.doorToDoorTotalMinutes)
    .slice(0, 3)
  const fastest = sorted[0]!
  return sorted.map((candidate, index) => ({
    ...candidate,
    isRecommended: index === 0,
    materialDifferences:
      index === 0
        ? ['当前候选中门到门总时长最短']
        : [`比首选多 ${candidate.doorToDoorTotalMinutes - fastest.doorToDoorTotalMinutes} 分钟`]
  }))
}

function localMinutes(value: string | null): number {
  if (!value) return 0
  const match = /T(\d{2}):(\d{2})/.exec(value)
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0
}

function addSecondsPreservingOffset(value: string, seconds: number): string {
  const offset = /(Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1]
  const timestamp = new Date(value).getTime()
  if (!offset || Number.isNaN(timestamp)) return value
  if (offset === 'Z') return new Date(timestamp + seconds * 1000).toISOString()
  const sign = offset.startsWith('-') ? -1 : 1
  const [hours, minutes] = offset.slice(1).split(':').map(Number)
  const offsetMinutes = sign * ((hours ?? 0) * 60 + (minutes ?? 0))
  return `${new Date(timestamp + seconds * 1000 + offsetMinutes * 60_000)
    .toISOString()
    .slice(0, -1)}${offset}`
}
