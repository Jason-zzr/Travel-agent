import { ExternalSourceUrlSchema } from '../../../shared/schema/source'
import { createSseSourceSession, type SourceSession } from '../client'

export const VARIFLIGHT_SSE_ENDPOINT = ExternalSourceUrlSchema.parse(
  'https://mcp.api-inference.modelscope.net/cd43171bbbf24d/sse'
)

export function createVariflightSourceSession(): SourceSession {
  return createSseSourceSession({ url: new URL(VARIFLIGHT_SSE_ENDPOINT) })
}
