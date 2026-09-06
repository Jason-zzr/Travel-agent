import { z } from 'zod'
import { AppError } from '../../shared/errors'
import type { EvidenceClaim, EvidenceScope } from '../../shared/schema/evidence'
import { ResearchEntitySchema, type ResearchEntity } from '../../shared/schema/d4'
import type { TravelerGroup } from '../../shared/schema/interview'
import type { ProviderRuntime } from '../plugins/provider-runtime'
import { buildResearchEntities, verifyEvidenceClaims } from '../evidence-rules'

const ReviewOutputSchema = z.object({
  reviewedClaimIds: z.array(z.string().min(1)).max(200)
})

export interface VerificationSkillOutput {
  claims: EvidenceClaim[]
  entities: ResearchEntity[]
}

export class VerificationSkill {
  constructor(private readonly provider: ProviderRuntime) {}

  async run(input: {
    sessionId: string
    destinationCity: string
    claims: EvidenceClaim[]
    travelers: TravelerGroup[]
    now: Date
    kinds: ReadonlyMap<string, ResearchEntity['kind']>
    aliases: ReadonlyMap<string, string[]>
    scope?: EvidenceScope | null
  }): Promise<VerificationSkillOutput> {
    const review = await this.provider.invokeStructured({
      sessionId: input.sessionId,
      role: 'REVIEW',
      schema: ReviewOutputSchema,
      system: [
        'You are SKILL-05 evidence review.',
        'Review only the supplied bounded facts.',
        'Return the claim IDs you inspected. Do not resolve conflicts or override deterministic rules.'
      ].join(' '),
      user: JSON.stringify({
        claims: input.claims.map((claim) => ({
          claimId: claim.claimId,
          subject: claim.subject,
          predicate: claim.predicate,
          value: claim.value,
          sourceId: claim.sourceId
        }))
      })
    })
    const expectedIds = [...new Set(input.claims.map((claim) => claim.claimId))].sort()
    const reviewedIds = [...new Set(review.reviewedClaimIds)].sort()
    if (
      reviewedIds.length !== expectedIds.length ||
      reviewedIds.some((claimId, index) => claimId !== expectedIds[index])
    ) {
      throw new AppError('MODEL_OUTPUT_INVALID', '证据复核遗漏或引入了未知 Claim ID。')
    }
    return verifyResearchDeterministically(input)
  }
}

export function verifyResearchDeterministically(input: {
  destinationCity: string
  claims: EvidenceClaim[]
  travelers: TravelerGroup[]
  now: Date
  kinds?: ReadonlyMap<string, ResearchEntity['kind']>
  aliases?: ReadonlyMap<string, string[]>
  scope?: EvidenceScope | null
}): VerificationSkillOutput {
  const scope = input.scope ?? null
  if (
    input.claims.some(
      (claim) =>
        (scope === null) !== (claim.scope === null) ||
        (scope !== null &&
          (scope.kind !== 'ROUTE_NODE' ||
            claim.scope?.kind !== 'ROUTE_NODE' ||
            claim.scope.routeId !== scope.routeId ||
            claim.scope.nodeId !== scope.nodeId))
    )
  ) {
    throw new AppError('MODEL_OUTPUT_INVALID', '研究证据 scope 与当前节点不一致。')
  }
  const claims = verifyEvidenceClaims(input.claims, input.now)
  const entities = buildResearchEntities({
    destinationCity: input.destinationCity,
    claims,
    travelers: input.travelers,
    kinds: input.kinds,
    aliases: input.aliases
  }).map((entity) => ResearchEntitySchema.parse({ ...entity, scope }))
  return { claims, entities }
}
