import { createHash } from 'node:crypto'
import type { Context } from 'cordis'
import {
  EvidenceClaimSchema,
  type EvidenceClaim,
  type EvidenceScope,
  type EvidenceSourceId
} from '../../shared/schema/evidence'
import type { ExternalSourceId } from '../../shared/schema/source'
import type { SourceRepository } from '../db/source-repository'

export class EvidenceService {
  constructor(
    private readonly ctx: Context,
    private readonly repository: SourceRepository
  ) {}

  async add(claim: EvidenceClaim): Promise<EvidenceClaim> {
    const validated = EvidenceClaimSchema.parse(claim)
    await this.ctx.travelState.record({
      eventVersion: 2,
      sessionId: validated.sessionId,
      type: 'evidence/added',
      payload: { claim: validated }
    })
    return validated
  }

  async addMany(claims: EvidenceClaim[]): Promise<EvidenceClaim[]> {
    const output: EvidenceClaim[] = []
    for (const claim of claims) output.push(await this.add(claim))
    return output
  }

  list(sessionId: string, limit: number): EvidenceClaim[] {
    return this.repository.listEvidence(sessionId, limit)
  }

  async staleSource(sourceId: ExternalSourceId): Promise<void> {
    for (const claim of this.repository.listActiveEvidenceBySource(sourceId)) {
      await this.add({ ...claim, verificationStatus: 'STALE' })
    }
  }
}

export function deterministicClaimId(input: {
  sourceId: EvidenceSourceId
  sourceRef: string
  subject: string
  predicate: string
  scope?: EvidenceScope | null
}): string {
  const scopeKey = evidenceScopeKey(input.scope)
  const scopeSuffix = scopeKey ? `\n${scopeKey}` : ''
  const digest = createHash('sha256')
    .update(
      `${input.sourceId}\n${input.sourceRef}\n${input.subject}\n${input.predicate}${scopeSuffix}`
    )
    .digest('hex')
    .slice(0, 24)
  return `clm_${digest}`
}

export function evidenceScopeKey(scope: EvidenceScope | null | undefined): string {
  if (!scope) return ''
  return scope.kind === 'ROUTE_NODE'
    ? `${scope.kind}\n${scope.routeId}\n${scope.nodeId}`
    : `${scope.kind}\n${scope.fromCity}\n${scope.toCity}\n${scope.travelDate}`
}
