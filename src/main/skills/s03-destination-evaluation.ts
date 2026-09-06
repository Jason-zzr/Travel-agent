import { createHash } from 'node:crypto'
import { z } from 'zod'
import { AppError } from '../../shared/errors'
import { DestinationCandidateSchema, type DestinationCandidate } from '../../shared/schema/d4'
import type { EvidenceClaim } from '../../shared/schema/evidence'
import type { TravelBasics } from '../../shared/schema/interview'
import type { ProviderRuntime } from '../plugins/provider-runtime'

const CandidateDraftSchema = DestinationCandidateSchema.omit({ id: true })
const DestinationEvaluationOutputSchema = z.object({
  candidates: z.array(CandidateDraftSchema).min(2).max(4)
})

export class DestinationEvaluationSkill {
  constructor(private readonly provider: ProviderRuntime) {}

  async run(
    sessionId: string,
    basics: TravelBasics,
    claims: EvidenceClaim[]
  ): Promise<DestinationCandidate[]> {
    if (basics.destinationCities.length > 0 || basics.destinationIntent === null) {
      throw new AppError('GATE_BLOCKED', '只有模糊目的地意向可以生成候选城市。')
    }
    const eligibleClaims = claims.filter(isEligibleSupport)
    if (eligibleClaims.length < 2) {
      throw new AppError('GATE_BLOCKED', '目的地候选缺少可用的独立证据。', {
        userHint: '请先添加至少两条非推广、未过期且可追溯的目的地证据。'
      })
    }
    const output = await this.provider.invokeStructured({
      sessionId,
      role: 'PLANNING',
      schema: DestinationEvaluationOutputSchema,
      system: [
        'You are SKILL-03 for destination evaluation.',
        'Use only the supplied evidence summaries and traveler constraints.',
        'Return 2 to 4 city candidates. Every candidate must cite claimIds.',
        'Do not select a winner and do not use general model knowledge.'
      ].join(' '),
      user: JSON.stringify({
        basics: {
          originCities: basics.originCities,
          destinationIntent: basics.destinationIntent,
          dates: basics.dates,
          budget: basics.budget,
          travelers: basics.travelers.map((group) => ({
            count: group.count,
            ageBand: group.ageBand,
            stamina: group.stamina,
            functionalLimits: group.functionalLimits
          }))
        },
        evidence: eligibleClaims.map((claim) => ({
          claimId: claim.claimId,
          subject: claim.subject,
          predicate: claim.predicate,
          value: claim.value,
          sourceId: claim.sourceId,
          verificationStatus: claim.verificationStatus
        }))
      })
    })
    const candidates = output.candidates.map((draft) =>
      DestinationCandidateSchema.parse({ ...draft, id: candidateId(sessionId, draft.city) })
    )
    const knownIds = new Set(eligibleClaims.map((claim) => claim.claimId))
    const cities = new Set<string>()
    for (const candidate of candidates) {
      if (cities.has(candidate.city)) {
        throw new AppError('MODEL_OUTPUT_INVALID', '模型返回了重复的目的地候选。')
      }
      cities.add(candidate.city)
      if (!candidate.claimIds.every((claimId) => knownIds.has(claimId))) {
        throw new AppError('MODEL_OUTPUT_INVALID', '目的地候选引用了不存在或不可用的证据。')
      }
    }
    return candidates
  }
}

function isEligibleSupport(claim: EvidenceClaim): boolean {
  return (
    claim.sourceId !== 'USER_PASTE' &&
    claim.verificationStatus !== 'STALE' &&
    claim.verificationStatus !== 'UNVERIFIED' &&
    claim.verificationStatus !== 'CONFLICTED' &&
    claim.contentIdentity !== 'COMMERCIAL_OFFER' &&
    claim.contentIdentity !== 'SUSPECTED_PROMOTION'
  )
}

function candidateId(sessionId: string, city: string): string {
  const digest = createHash('sha256')
    .update(`${sessionId}\n${city.normalize('NFKC').trim()}`)
    .digest('hex')
    .slice(0, 20)
  return `dst_${digest}`
}
