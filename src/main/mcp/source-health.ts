import { AppError } from '../../shared/errors'
import {
  SourceHealthEntrySchema,
  type ExternalSourceId,
  type SourceHealthEntry
} from '../../shared/schema/source'
import type { SourceRepository } from '../db/source-repository'
import type { EvidenceService } from './evidence'
import { SOURCE_DEFINITIONS } from './source-catalog'

const COOLDOWN_MS = 5 * 60 * 1000

export class SourceHealthService {
  constructor(
    private readonly repository: SourceRepository,
    private readonly evidence: EvidenceService,
    private readonly now: () => Date = () => new Date(),
    private readonly log: (
      code: string,
      message: string,
      context: Record<string, unknown>
    ) => void = () => undefined
  ) {}

  setConfigured(sourceId: ExternalSourceId, configured: boolean): void {
    const now = this.now().toISOString()
    if (configured) this.repository.ensureHealth(sourceId, 'OK', now)
    else this.repository.setUnconfigured(sourceId, now)
  }

  list(): SourceHealthEntry[] {
    return Object.values(SOURCE_DEFINITIONS).map((definition) => {
      const stored = this.repository.getHealth(definition.sourceId)
      const now = this.now().toISOString()
      const health = stored ?? {
        sourceId: definition.sourceId,
        status: 'UNCONFIGURED' as const,
        lastOkAt: null,
        lastErrorCode: null,
        failStreak: 0,
        updatedAt: now
      }
      return SourceHealthEntrySchema.parse({
        ...health,
        capabilityImpact: definition.capabilityImpact,
        manualAlternative: definition.manualAlternative
      })
    })
  }

  assertAvailable(sourceId: ExternalSourceId): void {
    const health = this.repository.getHealth(sourceId)
    if (!health || health.status === 'UNCONFIGURED') {
      throw new AppError('SOURCE_UNCONFIGURED', `${sourceId} 尚未配置。`, {
        userHint: `请先在设置中配置 ${sourceId}。`
      })
    }
    if (
      health.status === 'DEGRADED' &&
      this.now().getTime() < Date.parse(health.updatedAt) + COOLDOWN_MS
    ) {
      const definition = SOURCE_DEFINITIONS[sourceId]
      throw new AppError('SOURCE_ADAPTER_DEGRADED', `${sourceId} 仍处于降级冷却期。`, {
        userHint: `${definition.capabilityImpact}；${definition.manualAlternative}`
      })
    }
  }

  markSuccess(sourceId: ExternalSourceId): SourceHealthEntry {
    this.repository.markSuccess(sourceId, this.now().toISOString())
    return this.list().find((entry) => entry.sourceId === sourceId)!
  }

  async markNetworkFailure(sourceId: ExternalSourceId, errorCode: string): Promise<void> {
    const health = this.repository.markNetworkFailure(sourceId, errorCode, this.now().toISOString())
    if (health.status !== 'DEGRADED') return
    await this.evidence.staleSource(sourceId)
    this.log('SOURCE_ADAPTER_DEGRADED', `${sourceId} 连续失败后降级。`, {
      sourceId,
      errorCode
    })
  }

  async markDrift(sourceId: ExternalSourceId, missing: string[], keys?: string): Promise<void> {
    this.repository.markDrift(sourceId, this.now().toISOString())
    this.log('SOURCE_DRIFT', `${sourceId} 返回结构不符合本地契约。`, {
      sourceId,
      errorCode: 'SOURCE_DRIFT',
      missing: missing.join(','),
      ...(keys ? { keys } : {})
    })
    await this.evidence.staleSource(sourceId)
    this.log('SOURCE_ADAPTER_DEGRADED', `${sourceId} 因结构漂移降级。`, {
      sourceId,
      errorCode: 'SOURCE_ADAPTER_DEGRADED'
    })
  }
}
