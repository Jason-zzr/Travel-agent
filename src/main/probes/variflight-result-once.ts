import type { JsonStructureSummary } from '../mcp/json-structure-summary'
import { AppError } from '../../shared/errors'
import {
  VARIFLIGHT_FLIGHT_PRICE_TOOL_NAME,
  type VariflightFlightPriceArgs
} from '../../shared/schema/mcp/flight'
import {
  consumeAuthorizedVariflightResultProbe,
  type AuthorizedVariflightResultProbe
} from './variflight-result-gate'

export interface VariflightResultShapeDiagnostic {
  ok: boolean
  source: string
  tool: string
  stage: 'credential' | 'connect' | 'discover' | 'call' | 'summarize' | 'close'
  discovered: boolean
  callAttempts: 0 | 1
  resultSchema: 'VALID' | 'INVALID' | 'NOT_RUN'
  summary: JsonStructureSummary | null
  errorCode: string | null
  rawResponseRetained: false
  contractStatus?: 'UNPROVEN'
}

export interface VariflightResultProbeToolRegistry {
  runVariflightResultShapeProbeOnce(input: {
    args: VariflightFlightPriceArgs
    timeoutMs: 15_000
    operationId: string
  }): Promise<VariflightResultShapeDiagnostic>
}

export interface VariflightResultProbeOutcome extends VariflightResultShapeDiagnostic {
  transport: 'sse'
  planId: string
  operationId: string
  digest: string
  toolCallAttempts: 0 | 1
  retryCount: 0
  productionAllowlistMutations: 0
}

export async function runVariflightResultProbeOnce(
  tools: VariflightResultProbeToolRegistry,
  authorization: AuthorizedVariflightResultProbe,
  now = new Date()
): Promise<VariflightResultProbeOutcome> {
  consumeAuthorizedVariflightResultProbe(authorization, now)
  const diagnostic = await tools.runVariflightResultShapeProbeOnce({
    args: authorization.plan.args,
    timeoutMs: authorization.plan.timeoutMs,
    operationId: authorization.plan.operationId
  })
  if (diagnostic.source !== 'SRC_FLIGHT' || diagnostic.tool !== VARIFLIGHT_FLIGHT_PRICE_TOOL_NAME) {
    throw new AppError('INTERNAL_INVARIANT_VIOLATED', 'VariFlight result probe identity drifted.')
  }
  return {
    ...diagnostic,
    source: 'SRC_FLIGHT',
    tool: VARIFLIGHT_FLIGHT_PRICE_TOOL_NAME,
    transport: 'sse',
    planId: authorization.plan.planId,
    operationId: authorization.plan.operationId,
    digest: authorization.digest,
    toolCallAttempts: diagnostic.callAttempts,
    retryCount: 0,
    productionAllowlistMutations: 0
  }
}
