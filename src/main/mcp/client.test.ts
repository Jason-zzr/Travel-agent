import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { AppError, serializeError } from '../../shared/errors'
import { railMcpLaunchInput } from '../plugins/tool-registry'
import {
  createSseSourceSession,
  createStdioSourceSession,
  type McpConnectDiagnostic,
  type SourceSession
} from './client'

const STDIO_FIXTURE = fileURLToPath(
  new URL('../../../test/fixtures/mcp/stdio-server.ts', import.meta.url)
)

test('Rail MCP launch is pinned to the offline package cache', () => {
  assert.deepEqual(railMcpLaunchInput(), {
    command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
    args: ['--offline', '-y', '12306-mcp@0.3.10']
  })
})

test('stdio session completes initialize, tools/list and tools/call without diagnostics', async () => {
  await withFixture('success', async ({ session, diagnostics }) => {
    await session.connect(1_000)
    const tools = await session.listTools(1_000)
    assert.deepEqual(tools, [
      {
        name: 'fixture-read',
        description: 'read-only local fixture',
        inputSchema: { type: 'object', additionalProperties: false }
      }
    ])
    assert.deepEqual(await session.callTool('fixture-read', {}, 1_000), {
      content: [{ type: 'text', text: '{"ok":true}' }]
    })
    assert.deepEqual(diagnostics, [])
  })
})

test('legacy SSE session completes initialize and tools/list locally, then closes idempotently', async () => {
  await withSseFixture('success', async (session) => {
    await session.connect(1_000)
    assert.deepEqual(await session.listTools(1_000), [
      {
        name: 'fixture-read',
        description: 'read-only local SSE fixture',
        inputSchema: { type: 'object', additionalProperties: false }
      }
    ])
    await session.close()
    await session.close()
  })
})

test('legacy SSE initialize timeout maps to MCP_TIMEOUT without a remote request', async () => {
  await withSseFixture('hang', async (session) => {
    await assert.rejects(
      () => session.connect(100),
      (error) => error instanceof AppError && error.code === 'MCP_TIMEOUT'
    )
  })
})

test('stdio connect failures have stable safe diagnostics and leave no child process', async (t) => {
  const cases: Array<{
    mode: string
    expectedDiagnostic: McpConnectDiagnostic
    expectedCode: AppError['code']
  }> = [
    {
      mode: 'cache-miss',
      expectedDiagnostic: 'PACKAGE_CACHE_MISS',
      expectedCode: 'SOURCE_UNCONFIGURED'
    },
    {
      mode: 'early-exit',
      expectedDiagnostic: 'PROCESS_EXITED',
      expectedCode: 'MCP_PROTOCOL_ERROR'
    },
    {
      mode: 'invalid-protocol',
      expectedDiagnostic: 'INVALID_PROTOCOL',
      expectedCode: 'MCP_PROTOCOL_ERROR'
    },
    {
      mode: 'hang',
      expectedDiagnostic: 'INITIALIZE_TIMEOUT',
      expectedCode: 'MCP_TIMEOUT'
    }
  ]

  for (const item of cases) {
    await t.test(item.mode, async () => {
      await withFixture(item.mode, async ({ session, diagnostics }) => {
        await assert.rejects(
          () => session.connect(item.mode === 'hang' ? 250 : 1_000),
          (error) => {
            assert.ok(error instanceof AppError)
            assert.equal(error.code, item.expectedCode)
            const exposed = JSON.stringify({
              message: error.message,
              serialized: serializeError(error)
            })
            assert.equal(exposed.includes('ENOTCACHED'), false)
            assert.equal(exposed.includes('private-path-should-not-leak'), false)
            return true
          }
        )
        assert.deepEqual(diagnostics, [item.expectedDiagnostic])
      })
    })
  }
})

test('missing stdio command maps to SOURCE_UNCONFIGURED/SPAWN_FAILED without path leakage', async () => {
  const diagnostics: McpConnectDiagnostic[] = []
  const missingCommand = join(tmpdir(), 'travel-harness-command-that-does-not-exist')
  const session = createStdioSourceSession({
    command: missingCommand,
    args: [],
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic)
  })
  try {
    await assert.rejects(
      () => session.connect(1_000),
      (error) => {
        assert.ok(error instanceof AppError)
        assert.equal(error.code, 'SOURCE_UNCONFIGURED')
        assert.equal(error.message.includes(missingCommand), false)
        assert.equal(JSON.stringify(serializeError(error)).includes(missingCommand), false)
        return true
      }
    )
    assert.deepEqual(diagnostics, ['SPAWN_FAILED'])
  } finally {
    await session.close()
  }
})

async function withFixture(
  mode: string,
  run: (input: { session: SourceSession; diagnostics: McpConnectDiagnostic[] }) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-stdio-fixture-'))
  const pidPath = join(root, 'child.pid')
  const diagnostics: McpConnectDiagnostic[] = []
  const session = createStdioSourceSession({
    command: process.execPath,
    args: ['--import', 'tsx', STDIO_FIXTURE, mode, pidPath],
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic)
  })
  try {
    await run({ session, diagnostics })
  } finally {
    await session.close()
    const pid = Number(await readFile(pidPath, 'utf8'))
    assertProcessStopped(pid)
    await rm(root, { recursive: true, force: true })
  }
}

function assertProcessStopped(pid: number): void {
  assert.throws(
    () => process.kill(pid, 0),
    (error) => error instanceof Error && 'code' in error && error.code === 'ESRCH'
  )
}

async function withSseFixture(
  mode: 'success' | 'hang',
  run: (session: SourceSession) => Promise<void>
): Promise<void> {
  const streams = new Set<ServerResponse>()
  const server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/sse') {
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      })
      streams.add(response)
      request.on('close', () => streams.delete(response))
      if (mode === 'success') {
        response.write('event: endpoint\ndata: /messages?sessionId=local-fixture\n\n')
      }
      return
    }
    if (request.method === 'POST' && request.url === '/messages?sessionId=local-fixture') {
      const message = await readJsonRpc(request)
      response.writeHead(202).end()
      if (typeof message.id !== 'number' && typeof message.id !== 'string') return
      if (message.method === 'initialize') {
        sendSseMessage(streams, {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: protocolVersion(message),
            capabilities: { tools: {} },
            serverInfo: { name: 'local-sse-fixture', version: '1.0.0' }
          }
        })
        return
      }
      if (message.method === 'tools/list') {
        sendSseMessage(streams, {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            tools: [
              {
                name: 'fixture-read',
                description: 'read-only local SSE fixture',
                inputSchema: { type: 'object', additionalProperties: false }
              }
            ]
          }
        })
      }
      return
    }
    response.writeHead(404).end()
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('SSE fixture did not bind a port')
  const session = createSseSourceSession({
    url: new URL(`http://127.0.0.1:${address.port}/sse`)
  })
  try {
    await run(session)
  } finally {
    await session.close()
    for (const stream of streams) stream.end()
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
}

async function readJsonRpc(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

function sendSseMessage(streams: ReadonlySet<ServerResponse>, message: unknown): void {
  const event = `event: message\ndata: ${JSON.stringify(message)}\n\n`
  for (const stream of streams) stream.write(event)
}

function protocolVersion(message: Record<string, unknown>): string {
  const params = message.params
  if (!params || typeof params !== 'object') return '2025-06-18'
  const value = (params as Record<string, unknown>).protocolVersion
  return typeof value === 'string' ? value : '2025-06-18'
}
