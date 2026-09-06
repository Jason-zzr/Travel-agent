import {
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport,
  type Progress,
  type Transport
} from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { AppError } from '../../shared/errors'

export type McpConnectDiagnostic =
  | 'PACKAGE_CACHE_MISS'
  | 'SPAWN_FAILED'
  | 'PROCESS_EXITED'
  | 'INVALID_PROTOCOL'
  | 'INITIALIZE_TIMEOUT'
  | 'UNKNOWN_CONNECT_FAILURE'

export interface StdioSourceSessionInput {
  command: string
  args: string[]
  env?: Record<string, string>
  onDiagnostic?: (diagnostic: McpConnectDiagnostic) => void
}

export interface McpToolDescriptor {
  name: string
  description: string
  inputSchema: unknown
}

export interface SourceSession {
  connect(timeoutMs: number): Promise<void>
  listTools(timeoutMs: number): Promise<McpToolDescriptor[]>
  callTool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs: number,
    onProgress?: (progress: Progress) => void
  ): Promise<unknown>
  close(): Promise<void>
}

export class McpClientSession implements SourceSession {
  private readonly client = new Client(
    { name: 'travel-harness', version: '1.0.0' },
    { versionNegotiation: { mode: 'legacy' } }
  )
  private started = false

  constructor(
    private readonly transport: Transport,
    private readonly connectDiagnostics?: ConnectDiagnostics
  ) {}

  async connect(timeoutMs: number): Promise<void> {
    this.started = true
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    let rejectTimeout = (): void => undefined
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      rejectTimeout = (): void => reject(timeoutSignal.reason)
      if (timeoutSignal.aborted) rejectTimeout()
      else timeoutSignal.addEventListener('abort', rejectTimeout, { once: true })
    })
    try {
      await Promise.race([
        this.client.connect(this.transport, { timeout: timeoutMs }),
        timeoutPromise
      ])
    } catch (error) {
      const diagnostic = this.connectDiagnostics?.classify(error)
      if (diagnostic) this.connectDiagnostics?.report(diagnostic)
      await this.close().catch(() => undefined)
      throw wrapMcpError(error, '连接', diagnostic)
    } finally {
      timeoutSignal.removeEventListener('abort', rejectTimeout)
    }
  }

  async listTools(timeoutMs: number): Promise<McpToolDescriptor[]> {
    try {
      const response = await this.client.listTools(undefined, { timeout: timeoutMs })
      return response.tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? '',
        inputSchema: tool.inputSchema
      }))
    } catch (error) {
      throw wrapMcpError(error, '发现工具')
    }
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs: number,
    onProgress?: (progress: Progress) => void
  ): Promise<unknown> {
    try {
      return await this.client.callTool(
        { name, arguments: args },
        { timeout: timeoutMs, onprogress: onProgress }
      )
    } catch (error) {
      throw wrapMcpError(error, '调用')
    }
  }

  async close(): Promise<void> {
    if (!this.started) {
      this.connectDiagnostics?.dispose()
      return
    }
    this.started = false
    try {
      await this.client.close()
    } finally {
      try {
        await this.transport.close()
      } finally {
        this.connectDiagnostics?.dispose()
      }
    }
  }
}

export function createStdioSourceSession(input: StdioSourceSessionInput): SourceSession {
  const transport = new AwaitableStdioClientTransport({
    command: input.command,
    args: input.args,
    env: input.env,
    stderr: 'pipe'
  })
  const diagnostics = createStdioConnectDiagnostics(transport, input.onDiagnostic)
  return new McpClientSession(transport, diagnostics)
}

class AwaitableStdioClientTransport extends StdioClientTransport {
  private closePromise: Promise<void> | undefined

  override close(): Promise<void> {
    this.closePromise ??= super.close()
    return this.closePromise
  }
}

export function createHttpSourceSession(input: {
  url: URL
  headers?: Record<string, string>
  fetch?: typeof fetch
}): SourceSession {
  return new McpClientSession(
    new StreamableHTTPClientTransport(input.url, {
      requestInit: input.headers ? { headers: input.headers } : undefined,
      fetch: input.fetch
    })
  )
}

export function createSseSourceSession(input: { url: URL; fetch?: typeof fetch }): SourceSession {
  return new McpClientSession(
    new SSEClientTransport(input.url, {
      fetch: input.fetch
    })
  )
}

interface ConnectDiagnostics {
  classify(error: unknown): McpConnectDiagnostic
  report(diagnostic: McpConnectDiagnostic): void
  dispose(): void
}

function createStdioConnectDiagnostics(
  transport: StdioClientTransport,
  onDiagnostic: StdioSourceSessionInput['onDiagnostic']
): ConnectDiagnostics {
  let stderrTail = ''
  let packageCacheMiss = false
  let spawnFailed = false
  let processExited = false
  let invalidProtocol = false
  let reported = false

  const onStderr = (chunk: string | Buffer): void => {
    const candidate = `${stderrTail}${String(chunk)}`
    if (/\bENOTCACHED\b/i.test(candidate)) packageCacheMiss = true
    stderrTail = candidate.slice(-32)
  }
  transport.stderr?.on('data', onStderr)
  transport.onerror = (error) => {
    if (errorCode(error) === 'ENOENT' || errorCode(error) === 'EACCES') spawnFailed = true
    if (isInvalidProtocolError(error)) invalidProtocol = true
  }
  transport.onclose = () => {
    processExited = true
  }

  return {
    classify(error): McpConnectDiagnostic {
      if (packageCacheMiss) return 'PACKAGE_CACHE_MISS'
      if (spawnFailed || ['ENOENT', 'EACCES'].includes(errorCode(error) ?? '')) {
        return 'SPAWN_FAILED'
      }
      if (invalidProtocol || isInvalidProtocolError(error)) return 'INVALID_PROTOCOL'
      if (isTimeoutError(error)) return 'INITIALIZE_TIMEOUT'
      if (
        processExited ||
        /connection closed|\bclosed\b|\bepipe\b|exited/i.test(errorText(error))
      ) {
        return 'PROCESS_EXITED'
      }
      return 'UNKNOWN_CONNECT_FAILURE'
    },
    report(diagnostic): void {
      if (reported) return
      reported = true
      onDiagnostic?.(diagnostic)
    },
    dispose(): void {
      transport.stderr?.off('data', onStderr)
      stderrTail = ''
    }
  }
}

function wrapMcpError(error: unknown, action: string, diagnostic?: McpConnectDiagnostic): AppError {
  if (error instanceof AppError) return error
  if (diagnostic === 'PACKAGE_CACHE_MISS') {
    return new AppError('SOURCE_UNCONFIGURED', `MCP ${action}失败。`, {
      cause: error,
      userHint: '本地 MCP 固定版本尚未预灌到离线缓存，请先完成运行时安装。'
    })
  }
  if (diagnostic === 'SPAWN_FAILED') {
    return new AppError('SOURCE_UNCONFIGURED', `MCP ${action}失败。`, {
      cause: error,
      userHint: '本地 MCP 运行依赖不可用，请检查安装后重试。'
    })
  }
  if (diagnostic === 'INVALID_PROTOCOL') {
    return new AppError('MCP_PROTOCOL_ERROR', `MCP ${action}失败。`, {
      cause: error,
      userHint: '本地 MCP 返回了无效协议，请检查固定版本运行时。'
    })
  }
  const isTimeout = diagnostic === 'INITIALIZE_TIMEOUT' || isTimeoutError(error)
  return new AppError(isTimeout ? 'MCP_TIMEOUT' : 'MCP_PROTOCOL_ERROR', `MCP ${action}失败。`, {
    cause: error,
    userHint: isTimeout
      ? '数据源初始化超时，请稍后重试。'
      : '数据源暂时不可达，请检查本地运行时后重试。'
  })
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code.toUpperCase() : undefined
}

function isTimeoutError(error: unknown): boolean {
  return /timeout|timed out|abort/i.test(errorText(error))
}

function isInvalidProtocolError(error: unknown): boolean {
  return (
    error instanceof SyntaxError ||
    (error instanceof Error && error.name === 'ZodError') ||
    /invalid (json|message|protocol)|json.*parse|unexpected token/i.test(errorText(error))
  )
}
