import { createHash } from 'node:crypto'
import { AppError } from '../shared/errors'
import {
  ManualResearchChecklistRequestSchema,
  ManualResearchSummarySchema,
  ResearchEntitySchema,
  type ManualResearchChecklistRequest,
  type ManualResearchHardAnchorKind,
  type ManualResearchSummary,
  type ResearchEntity
} from '../shared/schema/d4'
import {
  EvidenceClaimSchema,
  type EvidenceClaim,
  type EvidenceScope
} from '../shared/schema/evidence'
import { deterministicClaimId, evidenceScopeKey } from './mcp/evidence'

const DAY_MS = 24 * 60 * 60 * 1000

export interface MaterializedManualResearch {
  claims: EvidenceClaim[]
  entities: ResearchEntity[]
  summary: ManualResearchSummary
}

export function materializeManualResearch(
  input: ManualResearchChecklistRequest,
  destinationCity: string,
  confirmedAt = new Date(),
  scope: EvidenceScope | null = null
): MaterializedManualResearch {
  const request = ManualResearchChecklistRequestSchema.parse(input)
  const confirmedAtIso = confirmedAt.toISOString()
  const claims: EvidenceClaim[] = []
  const entities = request.items.map((item) => {
    const digest = createHash('sha256')
      .update(JSON.stringify(canonicalValue(item)))
      .digest('hex')
    const sourceRef = `USER_RESEARCH:${digest.slice(0, 32)}`
    const common = {
      sessionId: request.sessionId,
      subject: item.subject,
      sourceId: 'USER_RESEARCH' as const,
      sourceRef,
      contentIdentity: item.contentIdentity,
      confidence: null,
      conflictsWith: [] as string[],
      notes: '用户逐项确认的结构化研究事实；不代表独立来源佐证。',
      scope
    }
    const itemClaims: EvidenceClaim[] = [
      buildClaim({
        ...common,
        predicate: 'manualResearchSummary',
        value: {
          summary: item.summary,
          sourceLabel: item.sourceLabel,
          sourceUrl: item.sourceUrl,
          sourceClaimId: item.sourceClaimId
        },
        observedAt: confirmedAtIso,
        validUntil: new Date(confirmedAt.getTime() + 7 * DAY_MS).toISOString(),
        verificationStatus: 'VERIFIED_BY_USER'
      }),
      buildClaim({
        ...common,
        predicate: 'memberFitness',
        value: {
          status: item.fitness.status,
          reasons: item.fitness.reasons,
          sourceLabel: item.sourceLabel,
          sourceUrl: item.sourceUrl,
          sourceClaimId: item.sourceClaimId
        },
        observedAt: confirmedAtIso,
        validUntil: new Date(confirmedAt.getTime() + 7 * DAY_MS).toISOString(),
        verificationStatus: 'VERIFIED_BY_USER'
      }),
      ...item.hardAnchors.map((anchor) => {
        const checkedAt = new Date(anchor.checkedAt)
        if (checkedAt.getTime() > confirmedAt.getTime() + 5 * 60 * 1000) {
          throw new AppError('INPUT_INVALID', '硬锚点核验时间不能晚于当前时间。')
        }
        const validUntil = new Date(checkedAt.getTime() + DAY_MS)
        return buildClaim({
          ...common,
          predicate: hardAnchorPredicate(anchor.kind),
          value: {
            kind: anchor.kind,
            status: anchor.status,
            value: anchor.value,
            checkedAt: anchor.checkedAt,
            sourceLabel: item.sourceLabel,
            sourceUrl: item.sourceUrl,
            sourceClaimId: item.sourceClaimId
          },
          observedAt: anchor.checkedAt,
          validUntil: validUntil.toISOString(),
          verificationStatus:
            validUntil.getTime() < confirmedAt.getTime() ? 'STALE' : 'VERIFIED_BY_USER'
        })
      })
    ]
    claims.push(...itemClaims)
    const promotionOnlySupport =
      item.contentIdentity === 'COMMERCIAL_OFFER' || item.contentIdentity === 'SUSPECTED_PROMOTION'
    const blockingReasons: string[] = []
    if (promotionOnlySupport) {
      blockingReasons.push('仅有商业报价或疑似推广来源，不能单独支撑推荐。')
    }
    if (item.disposition === 'MUST_GO') {
      for (const anchor of item.hardAnchors) {
        if (anchor.status !== 'KNOWN') {
          blockingReasons.push(`${hardAnchorLabel(anchor.kind)}仍为${anchor.status}。`)
        } else if (Date.parse(anchor.checkedAt) + DAY_MS < confirmedAt.getTime()) {
          blockingReasons.push(`${hardAnchorLabel(anchor.kind)}已超过 24 小时有效期。`)
        }
      }
    }
    const validTimes = itemClaims.map((claim) => Date.parse(claim.validUntil))
    return ResearchEntitySchema.parse({
      entityId: manualEntityId(destinationCity, item.kind, item.subject, scope),
      destinationCity,
      canonicalSubject: item.subject,
      aliases: item.aliases,
      kind: item.kind,
      claimIds: itemClaims.map((claim) => claim.claimId),
      identityStatus: 'DETERMINISTIC',
      verificationStatus: 'VERIFIED_BY_USER',
      contentIdentities: [item.contentIdentity],
      validUntil: new Date(Math.min(...validTimes)).toISOString(),
      promotionOnlySupport,
      fitness: item.fitness,
      disposition: item.disposition,
      blockingReasons,
      unresolvedConflictClaimIds: [],
      scope
    })
  })
  return {
    claims,
    entities,
    summary: ManualResearchSummarySchema.parse({
      mode: 'USER_CONFIRMED',
      itemCount: request.items.length,
      linkedPasteCount: request.items.filter((item) => item.sourceClaimId !== null).length,
      confirmedAt: confirmedAtIso,
      scope
    })
  }
}

function buildClaim(input: Omit<EvidenceClaim, 'claimId'> & { predicate: string }): EvidenceClaim {
  return EvidenceClaimSchema.parse({
    ...input,
    claimId: deterministicClaimId({
      sourceId: input.sourceId,
      sourceRef: input.sourceRef,
      subject: input.subject,
      predicate: input.predicate,
      scope: input.scope
    })
  })
}

function hardAnchorPredicate(kind: ManualResearchHardAnchorKind): string {
  if (kind === 'OPENING_HOURS') return 'openingHours'
  if (kind === 'CLOSURE_SCHEDULE') return 'closureSchedule'
  return 'reservationRequirement'
}

function hardAnchorLabel(kind: ManualResearchHardAnchorKind): string {
  if (kind === 'OPENING_HOURS') return '开放时间'
  if (kind === 'CLOSURE_SCHEDULE') return '闭园安排'
  return '预约要求'
}

function manualEntityId(
  destinationCity: string,
  kind: string,
  subject: string,
  scope: EvidenceScope | null
): string {
  const digest = createHash('sha256')
    .update(
      `${destinationCity}\n${kind}\n${subject.normalize('NFKC').trim()}${
        scope ? `\n${evidenceScopeKey(scope)}` : ''
      }`
    )
    .digest('hex')
  return `ent_${digest.slice(0, 24)}`
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)])
    )
  }
  return value
}
