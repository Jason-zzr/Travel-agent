import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, readFile, realpath } from 'node:fs/promises'
import { connect } from 'node:net'
import { dirname, join, relative, resolve } from 'node:path'
import { z } from 'zod'
import { AppError } from '../../shared/errors'
import type { AppPaths } from '../paths'
import { createHttpSourceSession, type SourceSession } from './client'

export const XHS_MCP_VERSION = '2.5.0'
export const XHS_MCP_COMMIT = '6583124dfda92312b6bc19a042a6acfae63fe498'
export const XHS_MCP_FILE = 'xiaohongshu-mcp-windows-amd64.exe'
export const XHS_MCP_SIZE = 15_601_664
export const XHS_MCP_SHA256 = '3578c9fcf3e7be0b79564aeceef8c4f38e0072d9357ca1f911ee14cd37bd454c'
export const XHS_MCP_PORT = 18_061

type XhsSidecarState = 'STOPPED' | 'STARTING' | 'READY' | 'STOPPING'

export type XhsSidecarPaths = Pick<
  AppPaths,
  | 'xhsMcpExecutable'
  | 'xhsMcpManifest'
  | 'xhsMcpCookies'
  | 'xhsMcpCacheDirectory'
  | 'xhsMcpWorkDirectory'
>

interface XhsSidecarConnection {
  url: URL
  headers: Record<string, string>
}

export interface XhsSidecarProcess {
  pid?: number
  exitCode: number | null
  once(event: 'error' | 'exit', listener: () => void): this
  off(event: 'error' | 'exit', listener: () => void): this
}

export interface XhsSidecarRuntimeOptions {
  paths: XhsSidecarPaths
  spawnProcess?: (input: {
    executable: string
    args: string[]
    cwd: string
    env: Record<string, string>
  }) => XhsSidecarProcess
  stopProcess?: (process: XhsSidecarProcess) => Promise<void>
  probePort?: () => Promise<boolean>
  verifyArtifact?: (paths: XhsSidecarPaths) => Promise<void>
  ensureDirectories?: (paths: XhsSidecarPaths) => Promise<void>
  createHttpSession?: typeof createHttpSourceSession
  tokenFactory?: () => string
  now?: () => number
  sleep?: (milliseconds: number) => Promise<void>
  startupTimeoutMs?: number
  idleStopMs?: number
}

const XhsManifestSchema = z
  .object({
    name: z.literal('xiaohongshu-mcp'),
    version: z.literal(XHS_MCP_VERSION),
    commit: z.literal(XHS_MCP_COMMIT),
    platform: z.literal('windows'),
    arch: z.literal('x64'),
    file: z.literal(XHS_MCP_FILE),
    size: z.literal(XHS_MCP_SIZE),
    sha256: z.literal(XHS_MCP_SHA256),
    source: z.literal('https://github.com/xpzouying/xiaohongshu-mcp/releases/tag/v2.5.0'),
    browserVersion: z.literal('148.0.7778.215')
  })
  .strict()

export class XhsSidecarRuntime {
  private readonly spawnProcess: NonNullable<XhsSidecarRuntimeOptions['spawnProcess']>
  private readonly stopProcess: NonNullable<XhsSidecarRuntimeOptions['stopProcess']>
  private readonly probePort: NonNullable<XhsSidecarRuntimeOptions['probePort']>
  private readonly verifyArtifact: NonNullable<XhsSidecarRuntimeOptions['verifyArtifact']>
  private readonly ensureDirectories: NonNullable<XhsSidecarRuntimeOptions['ensureDirectories']>
  private readonly createHttpSession: typeof createHttpSourceSession
  private readonly tokenFactory: () => string
  private readonly now: () => number
  private readonly sleep: (milliseconds: number) => Promise<void>
  private readonly startupTimeoutMs: number
  private readonly idleStopMs: number
  private state: XhsSidecarState = 'STOPPED'
  private process: XhsSidecarProcess | undefined
  private token: string | undefined
  private startPromise: Promise<void> | undefined
  private stopPromise: Promise<void> | undefined
  private leases = 0
  private lifecycleGeneration = 0
  private idleGeneration = 0
  private closed = false

  constructor(private readonly options: XhsSidecarRuntimeOptions) {
    this.spawnProcess = options.spawnProcess ?? spawnXhsProcess
    this.stopProcess = options.stopProcess ?? stopXhsProcess
    this.probePort = options.probePort ?? (() => probeLoopbackPort(XHS_MCP_PORT))
    this.verifyArtifact = options.verifyArtifact ?? verifyXhsArtifact
    this.ensureDirectories = options.ensureDirectories ?? ensureXhsDirectories
    this.createHttpSession = options.createHttpSession ?? createHttpSourceSession
    this.tokenFactory = options.tokenFactory ?? (() => randomBytes(32).toString('base64url'))
    this.now = options.now ?? Date.now
    this.sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
    this.startupTimeoutMs = options.startupTimeoutMs ?? 10 * 60_000
    this.idleStopMs = options.idleStopMs ?? 5_000
  }

  createSession(): SourceSession {
    return new XhsSidecarSourceSession(this, this.createHttpSession)
  }

  snapshot(): { state: XhsSidecarState; leases: number } {
    return { state: this.state, leases: this.leases }
  }

  async acquire(): Promise<XhsSidecarConnection> {
    if (this.closed) throw new AppError('SOURCE_CANCELLED', '小红书本机组件已关闭。')
    this.leases += 1
    this.idleGeneration += 1
    await this.ensureStarted()
    if (this.closed || this.state !== 'READY' || !this.token) {
      throw new AppError('MCP_PROTOCOL_ERROR', '小红书本机组件没有进入可用状态。', {
        userHint: '小红书本机组件启动未完成，请重试。'
      })
    }
    return {
      url: new URL(`http://127.0.0.1:${XHS_MCP_PORT}/mcp`),
      headers: { authorization: `Bearer ${this.token}` }
    }
  }

  async release(): Promise<void> {
    if (this.leases > 0) this.leases -= 1
    if (this.leases > 0) return
    if (this.state === 'STARTING') {
      await this.stopNow()
      return
    }
    if (this.state !== 'READY') return
    const generation = ++this.idleGeneration
    void this.sleep(this.idleStopMs)
      .then(async () => {
        if (this.leases === 0 && this.idleGeneration === generation && !this.closed) {
          await this.stopNow()
        }
      })
      .catch(() => undefined)
  }

  async close(): Promise<void> {
    if (this.closed && this.state === 'STOPPED') return
    this.closed = true
    this.leases = 0
    this.idleGeneration += 1
    await this.stopNow()
  }

  async stopIfIdle(): Promise<void> {
    if (this.leases === 0) await this.stopNow()
  }

  private async ensureStarted(): Promise<void> {
    if (this.state === 'READY') return
    if (this.stopPromise) await this.stopPromise
    if (this.isReady()) return
    if (this.startPromise) return this.startPromise
    const generation = ++this.lifecycleGeneration
    this.state = 'STARTING'
    const start = this.start(generation)
    this.startPromise = start
    try {
      await start
    } finally {
      if (this.startPromise === start) this.startPromise = undefined
    }
  }

  private isReady(): boolean {
    return this.state === 'READY'
  }

  private async start(generation: number): Promise<void> {
    try {
      if (process.platform !== 'win32') {
        throw new AppError('SOURCE_UNCONFIGURED', '内置小红书组件仅支持 Windows x64。', {
          userHint: '当前版本仅支持 Windows x64。'
        })
      }
      await this.verifyArtifact(this.options.paths)
      this.assertStarting(generation)
      await this.ensureDirectories(this.options.paths)
      this.assertStarting(generation)
      if (await this.probePort()) {
        throw new AppError('SOURCE_UNREACHABLE', '小红书本机专用端口已被占用。', {
          userHint: '小红书本机组件端口被占用，请关闭占用程序后重试。'
        })
      }
      this.assertStarting(generation)
      const token = this.tokenFactory()
      const processHandle = this.spawnProcess({
        executable: this.options.paths.xhsMcpExecutable,
        args: ['-headless=true', `-port=127.0.0.1:${XHS_MCP_PORT}`],
        cwd: this.options.paths.xhsMcpWorkDirectory,
        env: xhsProcessEnvironment(this.options.paths, token)
      })
      this.process = processHandle
      this.token = token
      let failed = false
      const markFailed = (): void => {
        failed = true
        if (this.process === processHandle && this.state === 'READY') {
          this.process = undefined
          this.token = undefined
          this.state = 'STOPPED'
          this.lifecycleGeneration += 1
        }
      }
      processHandle.once('error', markFailed)
      processHandle.once('exit', markFailed)
      const deadline = this.now() + this.startupTimeoutMs
      while (this.now() < deadline) {
        this.assertStarting(generation)
        if (failed || processHandle.exitCode !== null) {
          throw new AppError('MCP_PROTOCOL_ERROR', '小红书本机组件提前退出。', {
            userHint: '小红书组件准备失败，请检查网络后重试。'
          })
        }
        if (await this.probePort()) {
          this.assertStarting(generation)
          this.state = 'READY'
          return
        }
        await this.sleep(250)
      }
      throw new AppError('MCP_TIMEOUT', '小红书本机组件准备超时。', {
        userHint: '小红书组件准备超时；首次运行需下载约 140–190MB，请检查网络后重试。'
      })
    } catch (error) {
      if (generation === this.lifecycleGeneration) await this.stopNow()
      if (error instanceof AppError) throw error
      throw new AppError('MCP_PROTOCOL_ERROR', '小红书本机组件启动失败。', {
        cause: error,
        userHint: '小红书本机组件启动失败，请重新安装应用后重试。'
      })
    }
  }

  private assertStarting(generation: number): void {
    if (
      this.closed ||
      this.leases === 0 ||
      this.state !== 'STARTING' ||
      generation !== this.lifecycleGeneration
    ) {
      throw new AppError('SOURCE_CANCELLED', '小红书本机组件准备已取消。')
    }
  }

  private async stopNow(): Promise<void> {
    if (this.stopPromise) return this.stopPromise
    if (this.state === 'STOPPED' && !this.process) return
    this.state = 'STOPPING'
    this.lifecycleGeneration += 1
    this.idleGeneration += 1
    const processHandle = this.process
    this.process = undefined
    this.token = undefined
    const stop = (async () => {
      try {
        if (processHandle) await this.stopProcess(processHandle)
      } finally {
        this.state = 'STOPPED'
      }
    })()
    this.stopPromise = stop
    try {
      await stop
    } finally {
      if (this.stopPromise === stop) this.stopPromise = undefined
    }
  }
}

class XhsSidecarSourceSession implements SourceSession {
  private inner: SourceSession | undefined
  private leaseReserved = false
  private closed = false

  constructor(
    private readonly runtime: XhsSidecarRuntime,
    private readonly createHttpSession: typeof createHttpSourceSession
  ) {}

  async connect(timeoutMs: number): Promise<void> {
    if (this.closed) throw new AppError('SOURCE_CANCELLED', '小红书会话已取消。')
    this.leaseReserved = true
    try {
      const connection = await this.runtime.acquire()
      if (this.closed) throw new AppError('SOURCE_CANCELLED', '小红书会话已取消。')
      const inner = this.createHttpSession(connection)
      this.inner = inner
      await inner.connect(timeoutMs)
    } catch (error) {
      await this.releaseLease()
      throw error
    }
  }

  listTools(timeoutMs: number): Promise<Awaited<ReturnType<SourceSession['listTools']>>> {
    return this.requireInner().listTools(timeoutMs)
  }

  callTool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs: number,
    onProgress?: Parameters<SourceSession['callTool']>[3]
  ): Promise<unknown> {
    return this.requireInner().callTool(name, args, timeoutMs, onProgress)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    try {
      await this.inner?.close()
    } finally {
      this.inner = undefined
      await this.releaseLease()
    }
  }

  private requireInner(): SourceSession {
    if (!this.inner) {
      throw new AppError('MCP_PROTOCOL_ERROR', '小红书 MCP 会话尚未连接。')
    }
    return this.inner
  }

  private async releaseLease(): Promise<void> {
    if (!this.leaseReserved) return
    this.leaseReserved = false
    await this.runtime.release()
  }
}

export async function verifyXhsArtifact(paths: XhsSidecarPaths): Promise<void> {
  try {
    const resourceRoot = await realpath(dirname(paths.xhsMcpExecutable))
    const executableStat = await lstat(paths.xhsMcpExecutable)
    const manifestStat = await lstat(paths.xhsMcpManifest)
    if (
      !executableStat.isFile() ||
      executableStat.isSymbolicLink() ||
      !manifestStat.isFile() ||
      manifestStat.isSymbolicLink()
    ) {
      throw new Error('artifact is not a regular file')
    }
    const executable = await realpath(paths.xhsMcpExecutable)
    const manifestPath = await realpath(paths.xhsMcpManifest)
    assertContained(resourceRoot, executable)
    assertContained(resourceRoot, manifestPath)
    const manifest = XhsManifestSchema.parse(
      JSON.parse(await readFile(paths.xhsMcpManifest, 'utf8')) as unknown
    )
    if (executableStat.size !== manifest.size) throw new Error('artifact size mismatch')
    const digest = await sha256File(paths.xhsMcpExecutable)
    if (digest !== manifest.sha256) throw new Error('artifact digest mismatch')
  } catch (error) {
    throw new AppError('SOURCE_UNCONFIGURED', '内置小红书组件校验失败。', {
      cause: error,
      userHint: '内置小红书组件缺失或损坏，请重新安装 Travel Harness。'
    })
  }
}

async function ensureXhsDirectories(paths: XhsSidecarPaths): Promise<void> {
  await Promise.all([
    mkdir(dirname(paths.xhsMcpCookies), { recursive: true }),
    mkdir(paths.xhsMcpCacheDirectory, { recursive: true }),
    mkdir(paths.xhsMcpWorkDirectory, { recursive: true })
  ])
}

function spawnXhsProcess(input: {
  executable: string
  args: string[]
  cwd: string
  env: Record<string, string>
}): XhsSidecarProcess {
  return spawn(input.executable, input.args, {
    cwd: input.cwd,
    env: input.env,
    shell: false,
    windowsHide: true,
    stdio: 'ignore'
  })
}

function xhsProcessEnvironment(paths: XhsSidecarPaths, token: string): Record<string, string> {
  const environment: Record<string, string> = {
    AUTH_TOKEN: token,
    COOKIES_PATH: paths.xhsMcpCookies,
    LOCALAPPDATA: paths.xhsMcpCacheDirectory,
    APPDATA: paths.xhsMcpCacheDirectory,
    USERPROFILE: paths.xhsMcpWorkDirectory,
    HOME: paths.xhsMcpWorkDirectory
  }
  for (const name of ['SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']) {
    const value = process.env[name]
    if (value) environment[name] = value
  }
  return environment
}

async function probeLoopbackPort(port: number): Promise<boolean> {
  return new Promise((resolveProbe) => {
    const socket = connect({ host: '127.0.0.1', port })
    let settled = false
    const settle = (value: boolean): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolveProbe(value)
    }
    socket.once('connect', () => settle(true))
    socket.once('error', () => settle(false))
    socket.setTimeout(250, () => settle(false))
    socket.unref()
  })
}

async function stopXhsProcess(processHandle: XhsSidecarProcess): Promise<void> {
  if (processHandle.exitCode !== null) return
  const pid = processHandle.pid
  if (!pid) {
    throw new AppError('INTERNAL_INVARIANT_VIOLATED', '小红书组件缺少可回收的进程标识。')
  }
  if (process.platform !== 'win32') {
    globalThis.process.kill(pid, 'SIGTERM')
    return
  }
  const systemRoot = globalThis.process.env.SystemRoot ?? globalThis.process.env.SYSTEMROOT
  if (!systemRoot) {
    throw new AppError('INTERNAL_INVARIANT_VIOLATED', 'Windows 系统目录不可用。')
  }
  const taskkill = join(systemRoot, 'System32', 'taskkill.exe')
  await runTaskkill(taskkill, pid, false)
  if (processHandle.exitCode !== null) return
  await runTaskkill(taskkill, pid, true)
  if (processHandle.exitCode === null) {
    throw new AppError('INTERNAL_INVARIANT_VIOLATED', '小红书组件进程树未能回收。')
  }
}

async function runTaskkill(command: string, pid: number, force: boolean): Promise<void> {
  await new Promise<void>((resolveTask) => {
    const child = spawn(command, ['/pid', String(pid), '/t', ...(force ? ['/f'] : [])], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore'
    })
    child.once('error', () => resolveTask())
    child.once('exit', () => resolveTask())
  })
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function assertContained(root: string, candidate: string): void {
  const contained = relative(resolve(root), resolve(candidate))
  if (!contained || contained.startsWith('..') || resolve(contained) === contained) {
    throw new Error('artifact escaped its resource root')
  }
}
