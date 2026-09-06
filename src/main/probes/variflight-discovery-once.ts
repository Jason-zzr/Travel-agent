import type { McpToolDescriptor } from '../mcp/client'
import {
  consumeAuthorizedVariflightDiscovery,
  type AuthorizedVariflightDiscovery
} from './variflight-discovery-gate'

export interface VariflightDiscoveryToolRegistry {
  discoverSourceDescriptorsOnce(
    sourceId: 'SRC_FLIGHT',
    timeoutMs: number,
    operationId: string
  ): Promise<McpToolDescriptor[]>
}

export interface VariflightDiscoveryOutcome {
  source: 'SRC_FLIGHT'
  transport: 'sse'
  planId: string
  operationId: string
  digest: string
  toolCallAttempts: 0
  tools: McpToolDescriptor[]
  rawToolResultRetained: false
}

export async function runVariflightDiscoveryOnce(
  tools: VariflightDiscoveryToolRegistry,
  authorization: AuthorizedVariflightDiscovery,
  now = new Date()
): Promise<VariflightDiscoveryOutcome> {
  consumeAuthorizedVariflightDiscovery(authorization, now)
  const discovered = await tools.discoverSourceDescriptorsOnce(
    'SRC_FLIGHT',
    authorization.plan.timeoutMs,
    authorization.plan.operationId
  )
  return {
    source: 'SRC_FLIGHT',
    transport: 'sse',
    planId: authorization.plan.planId,
    operationId: authorization.plan.operationId,
    digest: authorization.digest,
    toolCallAttempts: 0,
    tools: discovered,
    rawToolResultRetained: false
  }
}
