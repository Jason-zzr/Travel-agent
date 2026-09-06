import { createHash } from 'node:crypto'
import type { EvidenceClaim, JsonValue } from '../shared/schema/evidence'
import {
  FitnessAssessmentSchema,
  ResearchEntitySchema,
  type ConflictResolution,
  type FitnessAssessment,
  type ResearchEntity,
  type ResearchEntityKind
} from '../shared/schema/d4'
import type { TravelerGroup } from '../shared/schema/interview'

const PROMOTION_MARKERS = [
  '福利',
  '下单立减',
  '专属优惠码',
  '限时优惠',
  '返现',
  '领券',
  '立即购买'
] as const

const KNOWN_SUBJECTS: ReadonlyArray<{ canonical: string; aliases: readonly string[] }> = [
  {
    canonical: '武侯祠',
    aliases: ['武侯祠', '成都武侯祠博物馆', '武侯祠锦里', '武侯祠·锦里']
  }
]

export function normalizeEvidenceSubject(value: string): string {
  const normalized = value
    .normalize('NFKC')
    .trim()
    .replace(/[\s·•・—–_()（）【】\u005b\u005d，,。.!！?？:：;；'"“”‘’/\\-]+/g, '')
  for (const entry of KNOWN_SUBJECTS) {
    if (entry.aliases.some((alias) => normalized === cleanSubject(alias))) {
      return entry.canonical
    }
  }
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ')
}

function cleanSubject(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\s·•・—–_()（）【】\u005b\u005d，,。.!！?？:：;；'"“”‘’/\\-]+/g, '')
}

export function validityWindowFor(predicate: string): number {
  if (/开放|营业|预约|票|opening|hours|reservation/i.test(predicate)) return 24 * 60 * 60 * 1000
  if (/位置|坐标|地址|location|coordinate|address/i.test(predicate)) return 30 * 24 * 60 * 60 * 1000
  return 7 * 24 * 60 * 60 * 1000
}

export function validUntilFor(predicate: string, observedAt: Date): string {
  return new Date(observedAt.getTime() + validityWindowFor(predicate)).toISOString()
}

export function containsPromotionMarker(input: EvidenceClaim | string): boolean {
  const text =
    typeof input === 'string'
      ? input
      : `${input.subject}\n${input.predicate}\n${JSON.stringify(input.value)}\n${input.notes ?? ''}`
  return PROMOTION_MARKERS.some((marker) => text.includes(marker))
}

export function applyPromotionOverride(claim: EvidenceClaim): EvidenceClaim {
  if (!containsPromotionMarker(claim)) return claim
  return {
    ...claim,
    contentIdentity: 'SUSPECTED_PROMOTION',
    verificationStatus:
      claim.verificationStatus === 'STALE' || claim.verificationStatus === 'CONFLICTED'
        ? claim.verificationStatus
        : 'UNVERIFIED',
    confidence: claim.confidence === null ? null : Math.min(claim.confidence, 0.4)
  }
}

export function applyFreshness(claim: EvidenceClaim, now: Date): EvidenceClaim {
  return Date.parse(claim.validUntil) < now.getTime()
    ? { ...claim, verificationStatus: 'STALE' }
    : claim
}

export function verifyEvidenceClaims(claims: EvidenceClaim[], now: Date): EvidenceClaim[] {
  const prepared = claims.map((claim) => applyFreshness(applyPromotionOverride(claim), now))
  const groups = new Map<string, EvidenceClaim[]>()
  for (const claim of prepared) {
    const key = `${normalizeEvidenceSubject(claim.subject)}\n${claim.predicate.normalize('NFKC').trim().toLowerCase()}`
    const group = groups.get(key) ?? []
    group.push(claim)
    groups.set(key, group)
  }

  const updates = new Map<string, EvidenceClaim>()
  for (const group of groups.values()) {
    const active = group.filter(
      (claim) => claim.verificationStatus !== 'STALE' && !isPromotionOnlyClaim(claim)
    )
    const sources = new Set(active.map((claim) => claim.sourceId))
    const equalValues = new Set(active.map((claim) => normalizedValue(claim.value)))
    if (sources.size >= 2 && equalValues.size === 1) {
      for (const claim of active) {
        updates.set(claim.claimId, {
          ...claim,
          verificationStatus: 'CORROBORATED',
          conflictsWith: []
        })
      }
      continue
    }
    if (!isObviousConflictPredicate(group[0]?.predicate ?? '') || active.length < 2) continue
    const conflicting = active.filter((claim) =>
      active.some(
        (other) =>
          other.claimId !== claim.claimId &&
          other.sourceId !== claim.sourceId &&
          normalizedValue(other.value) !== normalizedValue(claim.value)
      )
    )
    for (const claim of conflicting) {
      updates.set(claim.claimId, {
        ...claim,
        verificationStatus: 'CONFLICTED',
        conflictsWith: conflicting
          .filter(
            (other) =>
              other.claimId !== claim.claimId &&
              other.sourceId !== claim.sourceId &&
              normalizedValue(other.value) !== normalizedValue(claim.value)
          )
          .map((other) => other.claimId)
          .sort()
      })
    }
  }
  return prepared.map((claim) => updates.get(claim.claimId) ?? claim)
}

function normalizedValue(value: JsonValue): string {
  if (typeof value === 'string')
    return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
  return stableJson(value)
}

function stableJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function isObviousConflictPredicate(predicate: string): boolean {
  return /开放|营业|预约|关闭|opening|hours|reservation|closed/i.test(predicate)
}

function isPromotionOnlyClaim(claim: EvidenceClaim): boolean {
  return (
    claim.contentIdentity === 'COMMERCIAL_OFFER' || claim.contentIdentity === 'SUSPECTED_PROMOTION'
  )
}

export function assessMemberFitness(
  claims: EvidenceClaim[],
  travelers: TravelerGroup[]
): FitnessAssessment {
  const text = claims
    .map((claim) => `${claim.predicate} ${JSON.stringify(claim.value)} ${claim.notes ?? ''}`)
    .join(' ')
  const hasPhysicalEvidence = /步行|台阶|坡|爬|无障碍|休息|walking|stairs|slope|accessible/i.test(
    text
  )
  if (!hasPhysicalEvidence) {
    return FitnessAssessmentSchema.parse({
      status: 'UNKNOWN',
      reasons: ['缺少体力、步行或无障碍证据。']
    })
  }
  const strenuous = /长时间爬坡|长坡|陡坡|大量台阶|连续爬升|steep|long climb/i.test(text)
  const affected = travelers.filter(
    (group) =>
      group.ageBand === 'OLDER_ADULT' ||
      group.ageBand === 'CHILD' ||
      group.stamina === 'LOW' ||
      group.functionalLimits.length > 0
  )
  if (strenuous && affected.length > 0) {
    const members = affected
      .map(
        (group) =>
          `${group.count} 位${memberLabel(group.ageBand)}${group.stamina === 'LOW' ? '（低体力）' : ''}`
      )
      .join('、')
    return FitnessAssessmentSchema.parse({
      status: 'RISK',
      reasons: [`项目含长时间爬坡或大量台阶；同行成员含 ${members}。`]
    })
  }
  if (/无障碍|电梯|休息点|accessible|elevator|rest area/i.test(text)) {
    return FitnessAssessmentSchema.parse({
      status: 'FIT',
      reasons: ['证据提到无障碍设施或休息点。']
    })
  }
  return FitnessAssessmentSchema.parse({
    status: 'UNKNOWN',
    reasons: ['已有步行信息，但不足以判定所有成员均适合。']
  })
}

function memberLabel(ageBand: TravelerGroup['ageBand']): string {
  if (ageBand === 'OLDER_ADULT') return '老人'
  if (ageBand === 'CHILD') return '儿童'
  return '成人'
}

export function buildResearchEntities(input: {
  destinationCity: string
  claims: EvidenceClaim[]
  kinds?: ReadonlyMap<string, ResearchEntityKind>
  aliases?: ReadonlyMap<string, string[]>
  travelers: TravelerGroup[]
}): ResearchEntity[] {
  const groups = new Map<
    string,
    { subject: string; kind: ResearchEntityKind; claims: EvidenceClaim[] }
  >()
  for (const claim of input.claims) {
    const subject = normalizeEvidenceSubject(claim.subject)
    const kind = input.kinds?.get(claim.claimId) ?? input.kinds?.get(subject) ?? 'ATTRACTION'
    const key = `${input.destinationCity.normalize('NFKC').trim()}\n${kind}\n${subject}`
    const group = groups.get(key) ?? { subject, kind, claims: [] }
    group.claims.push(claim)
    groups.set(key, group)
  }
  return [...groups.values()].flatMap((group) => {
    const deterministic = knownIdentity(group.subject, group.claims)
    const structured = group.claims.every((claim) => input.kinds?.has(claim.claimId))
    const entityGroups =
      deterministic || structured || group.claims.length === 1
        ? [group.claims]
        : group.claims.map((claim) => [claim])
    return entityGroups.map((claims) =>
      researchEntityFromClaims({
        ...input,
        subject: group.subject,
        kind: group.kind,
        claims,
        identityStatus: deterministic ? 'DETERMINISTIC' : structured ? 'PROPOSED' : 'AMBIGUOUS',
        discriminator: entityGroups.length === 1 ? null : claims[0]!.claimId
      })
    )
  })
}

function researchEntityFromClaims(input: {
  destinationCity: string
  subject: string
  kind: ResearchEntityKind
  claims: EvidenceClaim[]
  aliases?: ReadonlyMap<string, string[]>
  travelers: TravelerGroup[]
  identityStatus: ResearchEntity['identityStatus']
  discriminator: string | null
}): ResearchEntity {
  const { subject, claims } = input
  const statuses = new Set(claims.map((claim) => claim.verificationStatus))
  const verificationStatus = statuses.has('CONFLICTED')
    ? 'CONFLICTED'
    : statuses.has('STALE') && statuses.size === 1
      ? 'STALE'
      : statuses.has('CORROBORATED')
        ? 'CORROBORATED'
        : statuses.has('VERIFIED')
          ? 'VERIFIED'
          : statuses.has('VERIFIED_BY_USER')
            ? 'VERIFIED_BY_USER'
            : 'UNVERIFIED'
  const aliases = [
    ...new Set([
      ...claims.map((claim) => claim.subject),
      ...claims.flatMap(
        (claim) => input.aliases?.get(claim.claimId) ?? input.aliases?.get(subject) ?? []
      )
    ])
  ].filter((alias) => alias !== subject)
  const activeClaims = claims.filter((claim) => claim.verificationStatus !== 'STALE')
  const promotionOnlySupport = activeClaims.length > 0 && activeClaims.every(isPromotionOnlyClaim)
  const unresolvedConflictClaimIds = claims
    .filter((claim) => claim.verificationStatus === 'CONFLICTED')
    .map((claim) => claim.claimId)
  const blockingReasons: string[] = []
  if (promotionOnlySupport) blockingReasons.push('仅有商业报价或疑似推广来源，不能单独支撑推荐。')
  if (unresolvedConflictClaimIds.length > 0) blockingReasons.push('存在尚未裁决的证据冲突。')
  const validTimes = claims.map((claim) => Date.parse(claim.validUntil)).filter(Number.isFinite)
  return ResearchEntitySchema.parse({
    entityId: entityId(input.destinationCity, input.kind, subject, input.discriminator),
    destinationCity: input.destinationCity,
    canonicalSubject: subject,
    aliases,
    kind: input.kind,
    claimIds: claims.map((claim) => claim.claimId),
    identityStatus: input.identityStatus,
    verificationStatus,
    contentIdentities: [...new Set(claims.map((claim) => claim.contentIdentity))],
    validUntil: validTimes.length > 0 ? new Date(Math.min(...validTimes)).toISOString() : null,
    promotionOnlySupport,
    fitness: assessMemberFitness(claims, input.travelers),
    disposition: 'NEUTRAL',
    blockingReasons,
    unresolvedConflictClaimIds
  })
}

function knownIdentity(subject: string, claims: EvidenceClaim[]): boolean {
  return (
    KNOWN_SUBJECTS.some((entry) => entry.canonical === subject) ||
    claims.some(
      (claim) =>
        claim.sourceId === 'SRC_MAP' && /location|coordinate|坐标|位置/i.test(claim.predicate)
    )
  )
}

function entityId(
  destinationCity: string,
  kind: ResearchEntityKind,
  subject: string,
  discriminator: string | null
): string {
  return `ent_${createHash('sha256')
    .update(`${destinationCity}\n${kind}\n${subject}\n${discriminator ?? ''}`)
    .digest('hex')
    .slice(0, 24)}`
}

export function unresolvedHardAnchorConflicts(
  entities: ResearchEntity[],
  claims: EvidenceClaim[],
  resolutions: ConflictResolution[]
): ResearchEntity[] {
  const claimById = new Map(claims.map((claim) => [claim.claimId, claim]))
  return entities.filter((entity) => {
    if (entity.disposition !== 'MUST_GO') return false
    return entity.unresolvedConflictClaimIds.some((claimId) => {
      const claim = claimById.get(claimId)
      if (!claim || !isObviousConflictPredicate(claim.predicate)) return false
      return !resolutions.some(
        (resolution) =>
          normalizeEvidenceSubject(resolution.subject) === entity.canonicalSubject &&
          resolution.predicate.normalize('NFKC').trim().toLowerCase() ===
            claim.predicate.normalize('NFKC').trim().toLowerCase()
      )
    })
  })
}
