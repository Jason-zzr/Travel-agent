import { AppError } from '../../shared/errors'
import { createStdioSourceSession } from '../mcp/client'
import { SOURCE_DEFINITIONS } from '../mcp/source-catalog'

const SOURCE_ID = 'SRC_RAIL' as const
const TOOL_NAME = 'get-current-date'
const TIMEOUT_MS = 120_000

async function main(): Promise<void> {
  const source = SOURCE_DEFINITIONS[SOURCE_ID]
  const contract = source.tools[TOOL_NAME]
  const session = createStdioSourceSession({
    command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
    args: ['--offline', '-y', '12306-mcp@0.3.10']
  })
  let stage: 'connect' | 'discover' | 'call' | 'validate' = 'connect'
  let callAttempted = false

  try {
    if (!contract || !source.allowlist.has(TOOL_NAME)) {
      throw new AppError('NOT_IN_ALLOWLIST', 'Rail acceptance tool is not allowlisted.')
    }

    const args = contract.args.parse({})
    await session.connect(TIMEOUT_MS)
    stage = 'discover'
    const tools = await session.listTools(TIMEOUT_MS)
    if (!tools.some((tool) => tool.name === TOOL_NAME)) {
      throw new AppError('MCP_PROTOCOL_ERROR', 'Rail acceptance tool was not discovered.')
    }

    stage = 'call'
    callAttempted = true
    const result = await session.callTool(TOOL_NAME, args, TIMEOUT_MS)
    stage = 'validate'
    contract.result.parse(result)
    console.log(
      JSON.stringify({
        ok: true,
        source: SOURCE_ID,
        tool: TOOL_NAME,
        discovered: true,
        resultSchema: 'VALID',
        callAttempts: 1,
        rawResponseRetained: false
      })
    )
  } catch (error) {
    const errorCode =
      error instanceof AppError
        ? error.code
        : error instanceof Error && error.name === 'ZodError'
          ? 'SOURCE_DRIFT'
          : 'PROBE_FAILED'
    console.error(
      JSON.stringify({
        ok: false,
        source: SOURCE_ID,
        tool: TOOL_NAME,
        stage,
        callAttempts: callAttempted ? 1 : 0,
        errorCode,
        rawResponseRetained: false
      })
    )
    process.exitCode = 1
  } finally {
    await session.close().catch(() => {
      process.exitCode = 1
    })
  }
}

void main()
