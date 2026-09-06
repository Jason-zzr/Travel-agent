import { AppError } from '../../shared/errors'
import {
  VARIFLIGHT_FLIGHT_PRICE_TOOL_NAME,
  type VariflightFlightPriceArgs
} from '../../shared/schema/mcp/flight'
import type { VariflightSemanticSummary } from './variflight-semantics-classifier'
import {
  consumeAuthorizedVariflightSemanticProbe,
  type AuthorizedVariflightSemanticProbe
} from './variflight-semantics-gate'

export interface VariflightSemanticDiagnostic {
  ok: boolean
  source: 'SRC_FLIGHT'
  tool: typeof VARIFLIGHT_FLIGHT_PRICE_TOOL_NAME
  stage: 'credential' | 'connect' | 'discover' | 'call' | 'classify' | 'close'
  discovered: boolean
  callAttempts: 0 | 1
  resultSchema: 'VALID' | 'INVALID' | 'NOT_RUN'
  summary: VariflightSemanticSummary | null
  errorCode: string | null
  rawResponseRetained: false
  valueRetention: false
  contractStatus: 'UNPROVEN'
}

export interface VariflightSemanticProbeToolRegistry {
  runVariflightSemanticProbeOnce(input: {
    args: VariflightFlightPriceArgs
    timeoutMs: 15_000
    operationId: string
  }): Promise<VariflightSemanticDiagnostic>
}

export interface VariflightSemanticProbeOutcome extends VariflightSemanticDiagnostic {
  transport: 'sse'
  planId: string
  operationId: string
  digest: string
  toolCallAttempts: 0 | 1
  retryCount: 0
  productionAllowlistMutations: 0
  toolCallAuditWrites: 0
  evidenceWrites: 0
  databaseWrites: 0
  cacheWrites: 0
  healthMutations: 0
}

export async function runVariflightSemanticProbeOnce(
  tools: VariflightSemanticProbeToolRegistry,
  authorization: AuthorizedVariflightSemanticProbe,
  now = new Date()
): Promise<VariflightSemanticProbeOutcome> {
  consumeAuthorizedVariflightSemanticProbe(authorization, now)
  const diagnostic = await tools.runVariflightSemanticProbeOnce({
    args: authorization.plan.args,
    timeoutMs: authorization.plan.timeoutMs,
    operationId: authorization.plan.operationId
  })
  if (diagnostic.source !== 'SRC_FLIGHT' || diagnostic.tool !== VARIFLIGHT_FLIGHT_PRICE_TOOL_NAME) {
    throw new AppError('INTERNAL_INVARIANT_VIOLATED', 'VariFlight semantic probe identity drifted.')
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
    productionAllowlistMutations: 0,
    toolCallAuditWrites: 0,
    evidenceWrites: 0,
    databaseWrites: 0,
    cacheWrites: 0,
    healthMutations: 0
  }
}
