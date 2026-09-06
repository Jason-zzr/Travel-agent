import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { z } from 'zod'
import { AppError } from '../../shared/errors'
import {
  FLYAI_BIN_RELATIVE_PATH,
  FLYAI_PACKAGE_INTEGRITY,
  FLYAI_PACKAGE_NAME,
  FLYAI_PACKAGE_VERSION,
  FLYAI_UTILITY_PROCESS_LAUNCHER_RELATIVE_PATH,
  FlyaiCliStructureResultSchema,
  toFlyaiFlightCliArgs,
  type FlyaiCliStructureResult,
  type FlyaiFlightSearchInput
} from '../../shared/schema/mcp/flyai-flight'
import { summarizeJsonText } from '../mcp/json-structure-summary'
import type { JsonStructureSummary } from '../../shared/schema/mcp/json-structure-summary'
import { flyaiTemporaryDirectoryPrefix, type FlyaiRuntimePaths } from '../paths'
import { digestString, isNodeErrorCode } from './gate-artifact-primitives'

const FLYAI_BUNDLE_SHA256 =
  'sha256:194a66eb84094f3d8ee20fac0a2d6cae10a405cd59ac100b7e7880ebc97297da'
const FLYAI_UTILITY_PROCESS_LAUNCHER_SHA256 =
  'sha256:f2264a6037b91b3cb14084da75e80f02d5e5d7bffeb44090c4766e3b970a00a5'
const INSTALL_LIFECYCLE_SCRIPTS = new Set(['preinstall', 'install', 'postinstall', 'prepare'])
export const FLYAI_CLI_TIMEOUT_MS = 15_000
export const FLYAI_STDOUT_MAX_BYTES = 1024 * 1024
export const FLYAI_STDERR_MAX_BYTES = 8 * 1024
const SAFE_ENVIRONMENT_KEYS = [
  'SystemRoot',
  'WINDIR',
  'TEMP',
  'TMP',
  'TMPDIR',
  'LANG',
  'LC_ALL'
] as const
const FLYAI_DEVICE_ID_SEED_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export const LEGACY_FLYAI_STDERR_CLASSIFIER_VERSION = 'flyai-cli-stderr-classifier/v1'
export const LEGACY_FLYAI_CLI_FAILURE_CATEGORIES = [
  'HTTP_401',
  'HTTP_403',
  'HTTP_429',
  'HTTP_5XX',
  'JSON_RPC_ERROR',
  'NETWORK_ERROR',
  'INVALID_RESPONSE',
  'UNKNOWN'
] as const
export const FLYAI_STDERR_CLASSIFIER_VERSION = 'flyai-cli-stderr-classifier/v2'
export const FLYAI_UTILITY_PROCESS_LAUNCHER_CONTRACT_VERSION = 'flyai-utility-process-launcher/v1'
export const FLYAI_CLI_FAILURE_CATEGORIES = [
  'HTTP_401',
  'HTTP_403',
  'HTTP_429',
  'HTTP_451_RISK_CONTROL',
  'HTTP_OTHER_4XX',
  'HTTP_5XX',
  'CLI_USAGE_ERROR',
  'JSON_RPC_ERROR',
  'NETWORK_ERROR',
  'INVALID_RESPONSE',
  'UNKNOWN'
] as const
export const FlyaiCliFailureCategorySchema = z.enum(FLYAI_CLI_FAILURE_CATEGORIES)
export type FlyaiCliFailureCategory = z.infer<typeof FlyaiCliFailureCategorySchema>

const FlyaiPackageJsonSchema = z
  .object({
    name: z.string(),
    version: z.string(),
    bin: z.object({ flyai: z.string() }).passthrough(),
    engines: z.object({ node: z.string() }).passthrough(),
    dependencies: z.record(z.string()),
    scripts: z.record(z.string()).default({})
  })
  .passthrough()

export interface ExpectedFlyaiPackageBinding {
  packageName: string
  packageVersion: string
  packageIntegrity: string
  binRelativePath: string
  nodeEngine: string
  directDependencyNames: readonly string[]
  bundleSha256: string
  launcherRelativePath: string
  launcherSha256: string
}

export interface FlyaiBundleBinding extends ExpectedFlyaiPackageBinding {
  bundlePath: string
  bundlePathDigest: string
  launcherPath: string
  launcherPathDigest: string
}

export interface FlyaiProcessLaunchOptions {
  cwd: string
  env: Readonly<Record<string, string>>
  stdio: readonly ['ignore', 'pipe', 'pipe']
  serviceName: string
}

export interface FlyaiProcessHandle {
  readonly stdout: NodeJS.ReadableStream | null
  readonly stderr: NodeJS.ReadableStream | null
  readonly pid: number | undefined
  terminate(): boolean
  onExit(listener: (code: number) => void): () => void
  onFatalError(listener: () => void): () => void
}

export interface FlyaiProcessExecutor {
  fork(
    modulePath: string,
    args: readonly string[],
    options: FlyaiProcessLaunchOptions
  ): FlyaiProcessHandle
}

export interface FlyaiCliStructureProbeInput {
  binding: FlyaiBundleBinding
  credential: string
  deviceIdentityPath: string
  input: FlyaiFlightSearchInput
  operationId: string
  signal?: AbortSignal
}

interface FlyaiCliRunnerDependencies {
  executor: FlyaiProcessExecutor
  hostEnvironment?: NodeJS.ProcessEnv
  createTimeoutSignal?: (timeoutMs: number) => AbortSignal
  onProcessAttempt?: () => void
  removeSandboxDirectory?: (path: string) => Promise<void>
}

export const EXPECTED_FLYAI_PACKAGE_BINDING: ExpectedFlyaiPackageBinding = Object.freeze({
  packageName: FLYAI_PACKAGE_NAME,
  packageVersion: FLYAI_PACKAGE_VERSION,
  packageIntegrity: FLYAI_PACKAGE_INTEGRITY,
  binRelativePath: FLYAI_BIN_RELATIVE_PATH,
  nodeEngine: '>=18',
  directDependencyNames: Object.freeze(['commander']),
  bundleSha256: FLYAI_BUNDLE_SHA256,
  launcherRelativePath: FLYAI_UTILITY_PROCESS_LAUNCHER_RELATIVE_PATH,
  launcherSha256: FLYAI_UTILITY_PROCESS_LAUNCHER_SHA256
})

export async function inspectFlyaiBundle(
  paths: FlyaiRuntimePaths,
  expected: ExpectedFlyaiPackageBinding = EXPECTED_FLYAI_PACKAGE_BINDING
): Promise<FlyaiBundleBinding> {
  const parsed = parsePackageJson(await readFile(paths.packageJson, 'utf8'))
  const dependencyNames = Object.keys(parsed.dependencies).sort()
  const lifecycleScripts = Object.keys(parsed.scripts).filter((name) =>
    INSTALL_LIFECYCLE_SCRIPTS.has(name)
  )
  if (
    parsed.name !== expected.packageName ||
    parsed.version !== expected.packageVersion ||
    normalizePackageRelativePath(parsed.bin.flyai) !== expected.binRelativePath ||
    parsed.engines.node !== expected.nodeEngine ||
    dependencyNames.join('\0') !== [...expected.directDependencyNames].sort().join('\0') ||
    lifecycleScripts.length > 0
  ) {
    throw new AppError('SOURCE_DRIFT', 'FlyAI package metadata does not match the pinned contract.')
  }

  const bundlePath = resolve(paths.bundle)
  const bundleStat = await lstat(bundlePath).catch((error: unknown) => {
    throw new AppError('SOURCE_DRIFT', 'FlyAI bundle is missing or unreadable.', { cause: error })
  })
  if (!bundleStat.isFile() || bundleStat.isSymbolicLink()) {
    throw new AppError('SOURCE_DRIFT', 'FlyAI bundle must be a regular file.')
  }
  const canonicalBundlePath = await realpath(bundlePath)
  if (normalizeAbsolutePath(canonicalBundlePath) !== normalizeAbsolutePath(bundlePath)) {
    throw new AppError('SOURCE_DRIFT', 'FlyAI bundle path must not traverse a symbolic link.')
  }
  const bundleSha256 = digestBuffer(await readFile(bundlePath))
  if (bundleSha256 !== expected.bundleSha256) {
    throw new AppError('SOURCE_DRIFT', 'FlyAI bundle digest does not match the pinned contract.')
  }

  const launcherPath = resolve(paths.launcher)
  const launcherStat = await lstat(launcherPath).catch((error: unknown) => {
    throw new AppError('SOURCE_DRIFT', 'FlyAI launcher is missing or unreadable.', { cause: error })
  })
  if (!launcherStat.isFile() || launcherStat.isSymbolicLink()) {
    throw new AppError('SOURCE_DRIFT', 'FlyAI launcher must be a regular file.')
  }
  const canonicalLauncherPath = await realpath(launcherPath)
  if (normalizeAbsolutePath(canonicalLauncherPath) !== normalizeAbsolutePath(launcherPath)) {
    throw new AppError('SOURCE_DRIFT', 'FlyAI launcher path must not traverse a symbolic link.')
  }
  const launcherSha256 = digestBuffer(await readFile(launcherPath))
  if (launcherSha256 !== expected.launcherSha256) {
    throw new AppError('SOURCE_DRIFT', 'FlyAI launcher digest does not match the pinned contract.')
  }

  return Object.freeze({
    ...expected,
    directDependencyNames: Object.freeze([...expected.directDependencyNames]),
    bundlePath,
    bundlePathDigest: digestString(normalizeAbsolutePath(bundlePath)),
    launcherPath,
    launcherPathDigest: digestString(normalizeAbsolutePath(launcherPath))
  })
}

export async function runFlyaiFlightCliStructureProbe(
  input: FlyaiCliStructureProbeInput,
  dependencies: FlyaiCliRunnerDependencies
): Promise<FlyaiCliStructureResult> {
  if (!input.credential) {
    throw new AppError('SOURCE_UNCONFIGURED', 'FlyAI credential is not configured.')
  }
  const sandboxDirectory = await mkdtemp(flyaiTemporaryDirectoryPrefix(tmpdir()))
  try {
    await stageFlyaiDeviceIdentity(input.deviceIdentityPath, sandboxDirectory)
    const handle = forkFlyaiProcess(input, dependencies, sandboxDirectory)
    const summary = await collectBoundedStructure(handle, input.signal, dependencies)
    return FlyaiCliStructureResultSchema.parse({
      cliProcessAttempts: 1,
      applicationRetryCount: 0,
      internalProviderRequestCount: 'UNKNOWN',
      internalProviderRetryCount: 'UNKNOWN',
      rawResponseRetained: false,
      valueRetention: false,
      summary
    })
  } finally {
    await cleanupFlyaiSandboxDirectory(sandboxDirectory, dependencies.removeSandboxDirectory)
  }
}

export function classifyFlyaiCliStderr(value: string): FlyaiCliFailureCategory {
  const lines = value.split(/\r?\n/u)
  const bodyStart = lines.findIndex((line) => line.startsWith('Body:'))
  const diagnostic = lines.slice(0, bodyStart < 0 ? lines.length : bodyStart).join('\n')
  const httpStatusMatch = /^MCP HTTP (\d{3}):/imu.exec(diagnostic)
  const httpStatus = Number(httpStatusMatch?.[1] ?? Number.NaN)
  if (httpStatus === 401) return 'HTTP_401'
  if (httpStatus === 403) return 'HTTP_403'
  if (httpStatus === 429) return 'HTTP_429'
  if (httpStatus === 451) return 'HTTP_451_RISK_CONTROL'
  if (httpStatus >= 400 && httpStatus <= 499) return 'HTTP_OTHER_4XX'
  if (httpStatus >= 500 && httpStatus <= 599) return 'HTTP_5XX'
  if (httpStatusMatch) return 'INVALID_RESPONSE'
  if (
    /^(?:error: (?:unknown command|unknown option|option .* argument missing|required option .* not specified)|Usage: )/imu.test(
      diagnostic
    )
  ) {
    return 'CLI_USAGE_ERROR'
  }
  if (/^MCP error:/imu.test(diagnostic)) return 'JSON_RPC_ERROR'
  if (/^MCP response not valid JSON:/imu.test(diagnostic)) return 'INVALID_RESPONSE'
  if (/^MCP(?:: no body for SSE response| (?:SSE|response body))/imu.test(diagnostic)) {
    return 'INVALID_RESPONSE'
  }
  if (
    /(?:fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|CERT_|TLS|socket hang up)/iu.test(
      diagnostic
    )
  ) {
    return 'NETWORK_ERROR'
  }
  return 'UNKNOWN'
}

export function flyaiCliFailureCategory(error: unknown): FlyaiCliFailureCategory | null {
  return error instanceof FlyaiCliToolError ? error.failureCategory : null
}

class FlyaiCliToolError extends AppError {
  constructor(readonly failureCategory: FlyaiCliFailureCategory) {
    super('MCP_TOOL_ERROR', 'FlyAI utility process returned an error.')
  }
}

async function stageFlyaiDeviceIdentity(
  deviceIdentityPath: string,
  sandboxDirectory: string
): Promise<void> {
  try {
    if (!isAbsolute(deviceIdentityPath)) {
      throw new Error('device identity path must be absolute')
    }
    const seed = await readOrCreateFlyaiDeviceIdentity(deviceIdentityPath)
    const sandboxConfigDirectory = join(sandboxDirectory, '.flyai')
    await mkdir(sandboxConfigDirectory, { recursive: true, mode: 0o700 })
    await writeFile(join(sandboxConfigDirectory, 'device-id'), `${seed}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    })
  } catch (error) {
    throw new AppError(
      'INTERNAL_INVARIANT_VIOLATED',
      'FlyAI device identity could not be prepared.',
      { cause: error }
    )
  }
}

async function readOrCreateFlyaiDeviceIdentity(deviceIdentityPath: string): Promise<string> {
  await mkdir(dirname(deviceIdentityPath), { recursive: true, mode: 0o700 })
  let created = false
  try {
    await writeFile(deviceIdentityPath, `${randomUUID()}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    })
    created = true
  } catch (error) {
    if (!isNodeErrorCode(error, 'EEXIST')) throw error
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const stat = await lstat(deviceIdentityPath)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('device identity must be a regular file')
    }
    const seed = (await readFile(deviceIdentityPath, 'utf8')).trim()
    if (FLYAI_DEVICE_ID_SEED_PATTERN.test(seed)) return seed
    if (created || attempt === 4) throw new Error('device identity is invalid')
    await new Promise<void>((resolvePromise) => setImmediate(resolvePromise))
  }
  throw new Error('device identity is invalid')
}

async function cleanupFlyaiSandboxDirectory(
  path: string,
  removeSandboxDirectory = removeFlyaiSandboxDirectory
): Promise<void> {
  try {
    await removeSandboxDirectory(path)
  } catch (error) {
    throw new AppError('INTERNAL_INVARIANT_VIOLATED', 'FlyAI temporary directory cleanup failed.', {
      cause: error
    })
  }
}

async function removeFlyaiSandboxDirectory(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
}

export async function createElectronFlyaiProcessExecutor(): Promise<FlyaiProcessExecutor> {
  const electron = await import('electron')
  if (!electron.app.isReady()) {
    throw new AppError('INTERNAL_SERVICE_NOT_READY', 'FlyAI runner requires Electron app.ready.')
  }
  return {
    fork(modulePath, args, options) {
      const child = electron.utilityProcess.fork(modulePath, [...args], {
        cwd: options.cwd,
        env: { ...options.env },
        stdio: [...options.stdio],
        serviceName: options.serviceName
      })
      return {
        get stdout() {
          return child.stdout
        },
        get stderr() {
          return child.stderr
        },
        get pid() {
          return child.pid
        },
        terminate: () => child.kill(),
        onExit(listener) {
          child.once('exit', listener)
          return () => child.off('exit', listener)
        },
        onFatalError(listener) {
          const wrapped = (): void => listener()
          child.once('error', wrapped)
          return () => child.off('error', wrapped)
        }
      }
    }
  }
}

export function toFlyaiUtilityProcessLauncherArgs(
  targetModulePath: string,
  args: readonly string[]
): string[] {
  return [targetModulePath, ...args]
}

function parsePackageJson(value: string): z.infer<typeof FlyaiPackageJsonSchema> {
  try {
    return FlyaiPackageJsonSchema.parse(JSON.parse(value))
  } catch (error) {
    throw new AppError('SOURCE_DRIFT', 'FlyAI package metadata is invalid.', { cause: error })
  }
}

function forkFlyaiProcess(
  input: FlyaiCliStructureProbeInput,
  dependencies: FlyaiCliRunnerDependencies,
  sandboxDirectory: string
): FlyaiProcessHandle {
  try {
    dependencies.onProcessAttempt?.()
    return dependencies.executor.fork(
      input.binding.launcherPath,
      toFlyaiUtilityProcessLauncherArgs(
        input.binding.bundlePath,
        toFlyaiFlightCliArgs(input.input)
      ),
      {
        cwd: sandboxDirectory,
        env: createFlyaiEnvironment(
          input.credential,
          sandboxDirectory,
          dependencies.hostEnvironment ?? process.env
        ),
        stdio: ['ignore', 'pipe', 'pipe'],
        serviceName: `FlyAI flight ${input.operationId}`
      }
    )
  } catch (error) {
    throw new AppError('MCP_PROTOCOL_ERROR', 'FlyAI utility process could not start.', {
      cause: error
    })
  }
}

function createFlyaiEnvironment(
  credential: string,
  sandboxDirectory: string,
  hostEnvironment: NodeJS.ProcessEnv
): Readonly<Record<string, string>> {
  const environment: Record<string, string> = {}
  for (const key of SAFE_ENVIRONMENT_KEYS) {
    const value = hostEnvironment[key]
    if (value) environment[key] = value
  }
  environment.HOME = sandboxDirectory
  environment.USERPROFILE = sandboxDirectory
  environment.FLYAI_API_KEY = credential
  return Object.freeze(environment)
}

async function collectBoundedStructure(
  handle: FlyaiProcessHandle,
  signal: AbortSignal | undefined,
  dependencies: FlyaiCliRunnerDependencies
): Promise<JsonStructureSummary> {
  const stdout = handle.stdout
  const stderr = handle.stderr
  if (!stdout || !stderr) {
    return await terminateAndAwaitExit(
      handle,
      new AppError('MCP_PROTOCOL_ERROR', 'FlyAI utility process pipes are unavailable.')
    )
  }

  const timeoutSignal = (dependencies.createTimeoutSignal ?? AbortSignal.timeout)(
    FLYAI_CLI_TIMEOUT_MS
  )
  const stdoutChunks: Buffer[] = []
  const stderrChunks: Buffer[] = []
  let stdoutBytes = 0
  let stderrBytes = 0

  return await new Promise<ReturnType<typeof summarizeJsonText>>(
    (resolvePromise, rejectPromise) => {
      let pendingError: AppError | undefined
      let exited = false

      const stopWith = (error: AppError): void => {
        if (pendingError || exited) return
        pendingError = error
        handle.terminate()
      }
      const onStdout = (chunk: string | Buffer): void => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        stdoutBytes += bytes.length
        if (stdoutBytes > FLYAI_STDOUT_MAX_BYTES) {
          stopWith(new AppError('SOURCE_DRIFT', 'FlyAI stdout exceeded the local limit.'))
          return
        }
        stdoutChunks.push(bytes)
      }
      const onStderr = (chunk: string | Buffer): void => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        stderrBytes += bytes.length
        if (stderrBytes > FLYAI_STDERR_MAX_BYTES) {
          stopWith(new AppError('MCP_PROTOCOL_ERROR', 'FlyAI stderr exceeded the local limit.'))
          return
        }
        stderrChunks.push(bytes)
      }
      const onStdoutError = (): void =>
        stopWith(new AppError('MCP_PROTOCOL_ERROR', 'FlyAI stdout stream failed.'))
      const onStderrError = (): void =>
        stopWith(new AppError('MCP_PROTOCOL_ERROR', 'FlyAI stderr stream failed.'))
      const onTimeout = (): void =>
        stopWith(new AppError('MCP_TIMEOUT', 'FlyAI utility process timed out.'))
      const onCancelled = (): void =>
        stopWith(new AppError('SOURCE_CANCELLED', 'FlyAI utility process was cancelled.'))
      const removeExit = handle.onExit((code) => {
        exited = true
        queueMicrotask(() => {
          cleanup()
          const failureCategory =
            code === 0 ? null : classifyFlyaiCliStderr(Buffer.concat(stderrChunks).toString('utf8'))
          clearBufferChunks(stderrChunks)
          if (handle.pid !== undefined) {
            rejectPromise(
              new AppError(
                'INTERNAL_INVARIANT_VIOLATED',
                'FlyAI utility process did not exit cleanly.'
              )
            )
            return
          }
          if (pendingError) {
            rejectPromise(pendingError)
            return
          }
          if (code !== 0) {
            rejectPromise(new FlyaiCliToolError(failureCategory ?? 'UNKNOWN'))
            return
          }
          try {
            const decoded = new TextDecoder('utf-8', { fatal: true }).decode(
              Buffer.concat(stdoutChunks)
            )
            const jsonLine = removeOneTerminalNewline(decoded)
            if (!jsonLine || /[\r\n]/u.test(jsonLine)) {
              throw new AppError('SOURCE_DRIFT', 'FlyAI stdout was not one JSON line.')
            }
            const summary = summarizeJsonText(jsonLine)
            if (summary.payloadKind !== 'JSON') {
              throw new AppError('SOURCE_DRIFT', 'FlyAI stdout was not valid JSON.')
            }
            resolvePromise(summary)
          } catch (error) {
            rejectPromise(
              error instanceof AppError
                ? error
                : new AppError('SOURCE_DRIFT', 'FlyAI stdout was not valid UTF-8 JSON.', {
                    cause: error
                  })
            )
          }
        })
      })
      const removeFatal = handle.onFatalError(() => {
        stopWith(new AppError('MCP_PROTOCOL_ERROR', 'FlyAI utility process failed fatally.'))
      })

      const cleanup = (): void => {
        stdout.removeListener('data', onStdout)
        stderr.removeListener('data', onStderr)
        stdout.removeListener('error', onStdoutError)
        stderr.removeListener('error', onStderrError)
        timeoutSignal.removeEventListener('abort', onTimeout)
        signal?.removeEventListener('abort', onCancelled)
        removeExit()
        removeFatal()
      }

      stdout.on('data', onStdout)
      stderr.on('data', onStderr)
      stdout.on('error', onStdoutError)
      stderr.on('error', onStderrError)
      timeoutSignal.addEventListener('abort', onTimeout, { once: true })
      signal?.addEventListener('abort', onCancelled, { once: true })
      if (timeoutSignal.aborted) onTimeout()
      if (signal?.aborted) onCancelled()
    }
  )
}

function clearBufferChunks(chunks: Buffer[]): void {
  for (const chunk of chunks) chunk.fill(0)
  chunks.length = 0
}

async function terminateAndAwaitExit(handle: FlyaiProcessHandle, error: AppError): Promise<never> {
  if (handle.pid !== undefined) {
    await new Promise<void>((resolvePromise) => {
      let settled = false
      const removeExit = handle.onExit(() => {
        if (settled) return
        settled = true
        removeExit()
        queueMicrotask(resolvePromise)
      })
      handle.terminate()
      if (handle.pid === undefined && !settled) {
        settled = true
        removeExit()
        queueMicrotask(resolvePromise)
      }
    })
  }
  if (handle.pid !== undefined) {
    throw new AppError(
      'INTERNAL_INVARIANT_VIOLATED',
      'FlyAI utility process remained alive after termination.',
      { cause: error }
    )
  }
  throw error
}

function removeOneTerminalNewline(value: string): string {
  if (value.endsWith('\r\n')) return value.slice(0, -2)
  if (value.endsWith('\n')) return value.slice(0, -1)
  return value
}

function normalizePackageRelativePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '')
}

function normalizeAbsolutePath(value: string): string {
  const normalized = resolve(value).replaceAll('\\', '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function digestBuffer(value: Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}
