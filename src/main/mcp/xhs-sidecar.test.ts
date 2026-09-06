import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AppError } from '../../shared/errors'
import { normalizeXhsLoginQrResult } from '../../shared/schema/mcp/xiaohongshu'
import { createAppPaths } from '../paths'
import type { SourceSession } from './client'
import {
  XHS_MCP_PORT,
  XhsSidecarRuntime,
  type XhsSidecarProcess,
  verifyXhsArtifact
} from './xhs-sidecar'

class FakeProcess extends EventEmitter implements XhsSidecarProcess {
  readonly pid = 42
  exitCode: number | null = null

  stop(): void {
    this.exitCode = 0
    this.emit('exit')
  }
}

class FakeSession implements SourceSession {
  connects = 0
  closes = 0

  async connect(): Promise<void> {
    this.connects += 1
  }

  async listTools(): Promise<[]> {
    return []
  }

  async callTool(): Promise<unknown> {
    return { content: [{ type: 'text', text: 'fixture' }] }
  }

  async close(): Promise<void> {
    this.closes += 1
  }
}

test('XHS runtime paths stay fixed across development and packaged layouts', () => {
  const development = createAppPaths('C:\\travel-user', 'C:\\travel-app', {
    resourcesPath: 'C:\\packaged-resources',
    isPackaged: false
  })
  assert.equal(
    development.xhsMcpExecutable,
    'C:\\travel-app\\resources\\xhs-mcp\\xiaohongshu-mcp-windows-amd64.exe'
  )
  const packaged = createAppPaths('C:\\travel-user', 'C:\\travel-app\\app.asar', {
    resourcesPath: 'C:\\packaged-resources',
    isPackaged: true
  })
  assert.equal(
    packaged.xhsMcpExecutable,
    'C:\\packaged-resources\\xhs-mcp\\xiaohongshu-mcp-windows-amd64.exe'
  )
  assert.equal(packaged.xhsMcpCookies, 'C:\\travel-user\\xhs-mcp\\cookies.json')
})

test('pinned XHS artifact and manifest verify without executing the binary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-xhs-artifact-'))
  try {
    const paths = createAppPaths(root, process.cwd(), {
      resourcesPath: process.cwd(),
      isPackaged: false
    })
    await verifyXhsArtifact(paths)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('XHS sidecar is lazy, authenticated, singleton and closed deterministically', async () => {
  const paths = createAppPaths('C:\\travel-user', 'C:\\travel-app', {
    resourcesPath: 'C:\\packaged-resources',
    isPackaged: false
  })
  const fakeProcess = new FakeProcess()
  const fakeSessions: FakeSession[] = []
  const spawns: Array<{
    executable: string
    args: string[]
    cwd: string
    env: Record<string, string>
  }> = []
  const httpInputs: Array<{ url: URL; headers?: Record<string, string> }> = []
  let probes = 0
  let stops = 0
  const runtime = new XhsSidecarRuntime({
    paths,
    verifyArtifact: async () => undefined,
    ensureDirectories: async () => undefined,
    spawnProcess: (input) => {
      spawns.push(input)
      return fakeProcess
    },
    stopProcess: async (processHandle) => {
      stops += 1
      if (processHandle instanceof FakeProcess) processHandle.stop()
    },
    probePort: async () => {
      probes += 1
      return probes > 1
    },
    createHttpSession: (input) => {
      httpInputs.push(input)
      const session = new FakeSession()
      fakeSessions.push(session)
      return session
    },
    tokenFactory: () => 'fixture-random-main-only-token',
    sleep: async () => undefined,
    idleStopMs: 60_000
  })

  const first = runtime.createSession()
  const second = runtime.createSession()
  assert.deepEqual(runtime.snapshot(), { state: 'STOPPED', leases: 0 })
  assert.equal(spawns.length, 0)
  await Promise.all([first.connect(1_000), second.connect(1_000)])
  assert.equal(spawns.length, 1)
  assert.deepEqual(spawns[0]?.args, ['-headless=true', `-port=127.0.0.1:${XHS_MCP_PORT}`])
  assert.equal(spawns[0]?.env.AUTH_TOKEN, 'fixture-random-main-only-token')
  assert.equal(spawns[0]?.env.COOKIES_PATH, paths.xhsMcpCookies)
  assert.equal(spawns[0]?.env.FLYAI_API_KEY, undefined)
  assert.equal(spawns[0]?.env.DEEPSEEK_API_KEY, undefined)
  assert.equal(spawns[0]?.env.SERPER_API_KEY, undefined)
  assert.equal(spawns[0]?.env.XIAOHONGSHU_MCP_AUTH, undefined)
  assert.equal(httpInputs.length, 2)
  assert.equal(httpInputs[0]?.url.toString(), `http://127.0.0.1:${XHS_MCP_PORT}/mcp`)
  assert.deepEqual(httpInputs[0]?.headers, {
    authorization: 'Bearer fixture-random-main-only-token'
  })
  await Promise.all([first.close(), second.close()])
  await runtime.close()
  assert.equal(stops, 1)
  assert.deepEqual(
    fakeSessions.map((session) => [session.connects, session.closes]),
    [
      [1, 1],
      [1, 1]
    ]
  )
  assert.deepEqual(runtime.snapshot(), { state: 'STOPPED', leases: 0 })
})

test('XHS sidecar refuses an occupied fixed port before spawn', async () => {
  const paths = createAppPaths('C:\\travel-user', 'C:\\travel-app', {
    resourcesPath: 'C:\\packaged-resources',
    isPackaged: false
  })
  let spawns = 0
  const runtime = new XhsSidecarRuntime({
    paths,
    verifyArtifact: async () => undefined,
    ensureDirectories: async () => undefined,
    spawnProcess: () => {
      spawns += 1
      return new FakeProcess()
    },
    probePort: async () => true,
    createHttpSession: () => new FakeSession(),
    sleep: async () => undefined
  })
  const session = runtime.createSession()
  await assert.rejects(
    () => session.connect(1_000),
    (error) => error instanceof AppError && error.code === 'SOURCE_UNREACHABLE'
  )
  assert.equal(spawns, 0)
  assert.deepEqual(runtime.snapshot(), { state: 'STOPPED', leases: 0 })
  await session.close()
  await runtime.close()
})

test('XHS login normalization accepts the pinned text-only already logged in result', () => {
  assert.deepEqual(
    normalizeXhsLoginQrResult({
      content: [{ type: 'text', text: '你当前已处于登录状态' }]
    }),
    { status: 'ALREADY_LOGGED_IN' }
  )
})
