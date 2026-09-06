import type { FlyaiCliStructureResult } from '../../shared/schema/mcp/flyai-flight'
import { serializeError, type ErrorCode } from '../../shared/errors'
import type { FlyaiRuntimePaths } from '../paths'
import type { AuthorizedFlyaiFlightProbe } from './flyai-flight-gate'
import { flyaiCliFailureCategory, type FlyaiCliFailureCategory } from './flyai-cli-runner'

export interface FlyaiFlightProbeToolRegistry {
  runFlyaiFlightStructureProbeOnce(input: {
    authorization: AuthorizedFlyaiFlightProbe
    runtimePaths: FlyaiRuntimePaths
    onProcessAttempt?: () => void
  }): Promise<FlyaiCliStructureResult>
}

export interface FlyaiFlightProbeOutcome extends FlyaiCliStructureResult {
  source: 'SRC_FLIGHT'
  tool: 'search-flight'
  transport: 'utility-process'
  planId: string
  operationId: string
  digest: string
  productionAllowlistMutations: 0
}

export async function runFlyaiFlightProbeOnce(
  tools: FlyaiFlightProbeToolRegistry,
  authorization: AuthorizedFlyaiFlightProbe,
  runtimePaths: FlyaiRuntimePaths,
  onProcessAttempt?: () => void
): Promise<FlyaiFlightProbeOutcome> {
  const result = await tools.runFlyaiFlightStructureProbeOnce({
    authorization,
    runtimePaths,
    onProcessAttempt
  })
  return {
    ...result,
    source: 'SRC_FLIGHT',
    tool: 'search-flight',
    transport: 'utility-process',
    planId: authorization.plan.planId,
    operationId: authorization.plan.operationId,
    digest: authorization.digest,
    productionAllowlistMutations: 0
  }
}

export function flyaiFlightProbeErrorCode(error: unknown): ErrorCode {
  return serializeError(error).code
}

export function flyaiFlightProbeFailureCategory(error: unknown): FlyaiCliFailureCategory | null {
  return flyaiCliFailureCategory(error)
}
