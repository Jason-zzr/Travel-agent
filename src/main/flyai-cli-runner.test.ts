import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PassThrough } from 'node:stream'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, before } from 'node:test'
import { AppError } from '../shared/errors'
import {
  classifyFlyaiCliStderr,
  flyaiCliFailureCategory,
  inspectFlyaiBundle,
  runFlyaiFlightCliStructureProbe,
  toFlyaiUtilityProcessLauncherArgs,
  type FlyaiCliStructureProbeInput,
  type FlyaiProcessExecutor,
  type FlyaiProcessHandle,
  type FlyaiProcessLaunchOptions,
  type ExpectedFlyaiPackageBinding
} from './probes/flyai-cli-runner'
import { createFlyaiRuntimePaths } from './paths'

let runnerFixtureRoot = ''
let deviceIdentitySequence = 0

before(async () => {
  runnerFixtureRoot = await mkdtemp(join(tmpdir(), 'travel-harness-flyai-runner-tests-'))
})

after(async () => {
  await rm(runnerFixtureRoot, { recursive: true, force: true })
})

test('FlyAI bundle inspection binds exact package metadata and a regular local file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-flyai-binding-'))
  const packageRoot = join(root, 'node_modules', '@fly-ai', 'flyai-cli')
  const bundle = Buffer.from('fixture bundle', 'utf8')
  const launcher = Buffer.from('fixture launcher', 'utf8')
  const expected: ExpectedFlyaiPackageBinding = {
    packageName: '@fly-ai/flyai-cli',
    packageVersion: '1.0.16',
    packageIntegrity: 'sha512-fixture',
    binRelativePath: 'dist/flyai-bundle.cjs',
    nodeEngine: '>=18',
    directDependencyNames: ['commander'],
    bundleSha256: `sha256:${createHash('sha256').update(bundle).digest('hex')}`,
    launcherRelativePath: 'resources/flyai-utility-process-launcher.cjs',
    launcherSha256: `sha256:${createHash('sha256').update(launcher).digest('hex')}`
  }
  try {
    await mkdir(join(packageRoot, 'dist'), { recursive: true })
    await writeFile(
      join(packageRoot, 'package.json'),
      JSON.stringify({
        name: '@fly-ai/flyai-cli',
        version: '1.0.16',
        bin: { flyai: './dist/flyai-bundle.cjs' },
        engines: { node: '>=18' },
        dependencies: { commander: '^12.1.0' },
        scripts: { start: 'node dist/flyai-bundle.cjs' }
      }),
      'utf8'
    )
    await writeFile(join(packageRoot, 'dist', 'flyai-bundle.cjs'), bundle)
    await mkdir(join(root, 'resources'), { recursive: true })
    await writeFile(join(root, 'resources', 'flyai-utility-process-launcher.cjs'), launcher)

    const paths = createFlyaiRuntimePaths({
      appPath: root,
      resourcesPath: root,
      isPackaged: false
    })
    const binding = await inspectFlyaiBundle(paths, expected)

    assert.equal(binding.bundlePath, join(packageRoot, 'dist', 'flyai-bundle.cjs'))
    assert.equal(binding.packageIntegrity, 'sha512-fixture')
    assert.equal(binding.bundleSha256, expected.bundleSha256)
    assert.match(binding.bundlePathDigest, /^sha256:[a-f0-9]{64}$/)
    assert.equal(
      binding.launcherPath,
      join(root, 'resources', 'flyai-utility-process-launcher.cjs')
    )
    assert.equal(binding.launcherSha256, expected.launcherSha256)
    assert.match(binding.launcherPathDigest, /^sha256:[a-f0-9]{64}$/)

    await writeFile(
      join(root, 'resources', 'flyai-utility-process-launcher.cjs'),
      Buffer.from('tampered launcher', 'utf8')
    )
    await assert.rejects(inspectFlyaiBundle(paths, expected), isAppError('SOURCE_DRIFT'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('FlyAI runner launches one bounded process and returns only a value-free structure', async () => {
  let launch:
    { modulePath: string; args: readonly string[]; options: FlyaiProcessLaunchOptions } | undefined
  const handle = new FakeFlyaiProcessHandle()
  const executor: FlyaiProcessExecutor = {
    fork(modulePath, args, options) {
      launch = { modulePath, args, options }
      queueMicrotask(() => {
        handle.stdout.write('{"data":{"secret":"sensitive-value","items":[1,2]}}\n')
        handle.stdout.end()
        handle.stderr.end()
        handle.finish(0)
      })
      return handle
    }
  }
  const binding = {
    packageName: '@fly-ai/flyai-cli',
    packageVersion: '1.0.16',
    packageIntegrity: 'sha512-fixture',
    binRelativePath: 'dist/flyai-bundle.cjs',
    nodeEngine: '>=18',
    directDependencyNames: ['commander'],
    bundleSha256: `sha256:${'a'.repeat(64)}`,
    bundlePath: 'C:\\safe\\flyai-bundle.cjs',
    bundlePathDigest: `sha256:${'b'.repeat(64)}`,
    launcherRelativePath: 'resources/flyai-utility-process-launcher.cjs',
    launcherSha256: `sha256:${'c'.repeat(64)}`,
    launcherPath: 'C:\\safe\\flyai-utility-process-launcher.cjs',
    launcherPathDigest: `sha256:${'d'.repeat(64)}`
  } as const

  const result = await runFlyaiFlightCliStructureProbe(
    {
      binding,
      credential: 'fixture-credential',
      deviceIdentityPath: join(runnerFixtureRoot, 'successful-run-device-id'),
      input: { origin: '西双版纳', destination: '广州', depDate: '2026-09-17' },
      operationId: '00000000-0000-4000-8000-000000000001'
    },
    {
      executor,
      hostEnvironment: { SystemRoot: 'C:\\Windows', UNRELATED_SECRET: 'must-not-pass' },
      createTimeoutSignal: () => new AbortController().signal
    }
  )

  assert.equal(launch?.modulePath, binding.launcherPath)
  assert.deepEqual(launch?.args, [
    binding.bundlePath,
    'search-flight',
    '--origin',
    '西双版纳',
    '--destination',
    '广州',
    '--dep-date',
    '2026-09-17'
  ])
  assert.equal(launch?.options.env.FLYAI_API_KEY, 'fixture-credential')
  assert.equal('UNRELATED_SECRET' in (launch?.options.env ?? {}), false)
  assert.deepEqual(launch?.options.stdio, ['ignore', 'pipe', 'pipe'])
  assert.equal(result.cliProcessAttempts, 1)
  assert.equal(result.applicationRetryCount, 0)
  assert.equal(result.internalProviderRequestCount, 'UNKNOWN')
  assert.equal(result.internalProviderRetryCount, 'UNKNOWN')
  assert.equal(result.summary.payloadKind, 'JSON')
  assert.equal(JSON.stringify(result).includes('sensitive-value'), false)
  assert.equal(handle.killCalls, 0)
})

test('FlyAI utility-process launcher receives the target module before logical arguments', () => {
  assert.deepEqual(
    toFlyaiUtilityProcessLauncherArgs('C:\\safe\\flyai-bundle.cjs', [
      'search-flight',
      '--origin',
      '西双版纳'
    ]),
    ['C:\\safe\\flyai-bundle.cjs', 'search-flight', '--origin', '西双版纳']
  )
})

test('FlyAI runner terminates and awaits exit when required pipes are unavailable', async () => {
  const handle = new ManualExitFlyaiProcessHandle(null, null)
  let settled = false
  let resolveProcessStarted: (() => void) | undefined
  const processStarted = new Promise<void>((resolve) => {
    resolveProcessStarted = resolve
  })
  const result = runFlyaiFlightCliStructureProbe(createProbeInput(), {
    executor: {
      fork: () => {
        resolveProcessStarted?.()
        return handle
      }
    },
    createTimeoutSignal: () => new AbortController().signal
  }).finally(() => {
    settled = true
  })
  void result.catch(() => undefined)

  await processStarted
  await waitForKill(handle)
  assert.equal(handle.killCalls, 1)
  assert.equal(settled, false)
  handle.finish(143)
  await assert.rejects(result, isAppError('MCP_PROTOCOL_ERROR'))
})

test('FlyAI runner terminates on timeout and reports the original bounded error after exit', async () => {
  const handle = new ManualExitFlyaiProcessHandle(new PassThrough(), new PassThrough())
  const timeout = new AbortController()
  let resolveProcessStarted: (() => void) | undefined
  const processStarted = new Promise<void>((resolve) => {
    resolveProcessStarted = resolve
  })
  const result = runFlyaiFlightCliStructureProbe(createProbeInput(), {
    executor: {
      fork: () => {
        resolveProcessStarted?.()
        return handle
      }
    },
    createTimeoutSignal: () => timeout.signal
  })

  await processStarted
  timeout.abort()
  await waitForKill(handle)
  assert.equal(handle.killCalls, 1)
  handle.finish(143)
  await assert.rejects(result, isAppError('MCP_TIMEOUT'))
})

test('FlyAI runner rejects oversized stdout without retaining provider values', async () => {
  const handle = new FakeFlyaiProcessHandle()
  const result = runFlyaiFlightCliStructureProbe(createProbeInput(), {
    executor: {
      fork: () => {
        queueMicrotask(() => handle.stdout.write(Buffer.alloc(1024 * 1024 + 1, 0x61)))
        return handle
      }
    },
    createTimeoutSignal: () => new AbortController().signal
  })

  await assert.rejects(result, isAppError('SOURCE_DRIFT'))
  assert.equal(handle.killCalls, 1)
})

test('FlyAI runner rejects nonzero, multiline, and invalid UTF-8 output', async () => {
  for (const fixture of [
    { code: 1, output: Buffer.from('{"ok":true}\n'), expected: 'MCP_TOOL_ERROR' },
    { code: 0, output: Buffer.from('{"a":1}\n{"b":2}\n'), expected: 'SOURCE_DRIFT' },
    { code: 0, output: Buffer.from([0xc3, 0x28]), expected: 'SOURCE_DRIFT' }
  ] as const) {
    const handle = new FakeFlyaiProcessHandle()
    const result = runFlyaiFlightCliStructureProbe(createProbeInput(), {
      executor: {
        fork: () => {
          queueMicrotask(() => {
            handle.stdout.write(fixture.output)
            handle.finish(fixture.code)
          })
          return handle
        }
      },
      createTimeoutSignal: () => new AbortController().signal
    })
    await assert.rejects(result, isAppError(fixture.expected))
  }
})

test('FlyAI runner keeps one application-scoped device identity across ephemeral homes', async () => {
  const deviceIdentityPath = join(runnerFixtureRoot, 'stable-device-id')
  const homes: string[] = []
  const stagedSeeds: string[] = []
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const handle = new FakeFlyaiProcessHandle()
    await runFlyaiFlightCliStructureProbe(
      { ...createProbeInput(), deviceIdentityPath },
      {
        executor: {
          fork: (_modulePath, _args, options) => {
            const home = options.env.HOME
            assert.ok(home)
            homes.push(home)
            stagedSeeds.push(readFileSync(join(home, '.flyai', 'device-id'), 'utf8').trim())
            queueMicrotask(() => {
              handle.stdout.write('{"ok":true}\n')
              handle.finish(0)
            })
            return handle
          }
        },
        createTimeoutSignal: () => new AbortController().signal
      }
    )
  }

  assert.notEqual(homes[0], homes[1])
  assert.equal(stagedSeeds[0], stagedSeeds[1])
  assert.match(stagedSeeds[0] ?? '', /^[0-9a-f-]{36}$/u)
  assert.equal((await readFile(deviceIdentityPath, 'utf8')).trim(), stagedSeeds[0])
})

test('FlyAI runner rejects a corrupt persistent device identity before launch', async () => {
  const identityDirectory = join(runnerFixtureRoot, 'corrupt-device-identity')
  const deviceIdentityPath = join(identityDirectory, 'device-id')
  await mkdir(identityDirectory, { recursive: true })
  await writeFile(deviceIdentityPath, 'not-a-uuid\n', 'utf8')

  let processCalls = 0
  await assert.rejects(
    runFlyaiFlightCliStructureProbe(
      { ...createProbeInput(), deviceIdentityPath },
      {
        executor: {
          fork() {
            processCalls += 1
            throw new Error('must not launch')
          }
        }
      }
    ),
    isAppError('INTERNAL_INVARIANT_VIOLATED')
  )
  assert.equal(processCalls, 0)
})

test('FlyAI stderr classifier returns only fixed value-free categories', async () => {
  const fixtures = [
    ['MCP HTTP 400: Bad Request', 'HTTP_OTHER_4XX'],
    ['MCP HTTP 401: Unauthorized', 'HTTP_401'],
    ['MCP HTTP 403: Forbidden', 'HTTP_403'],
    ['MCP HTTP 404: Not Found', 'HTTP_OTHER_4XX'],
    ['MCP HTTP 408: Request Timeout', 'HTTP_OTHER_4XX'],
    ['MCP HTTP 422: Unprocessable Content', 'HTTP_OTHER_4XX'],
    ['MCP HTTP 429: Too Many Requests', 'HTTP_429'],
    ['MCP HTTP 451: Unavailable For Legal Reasons', 'HTTP_451_RISK_CONTROL'],
    ['MCP HTTP 503: Service Unavailable', 'HTTP_5XX'],
    ['MCP HTTP 304: Not Modified', 'INVALID_RESPONSE'],
    ["error: unknown command 'search-flights'", 'CLI_USAGE_ERROR'],
    ["error: unknown option '--private-option'", 'CLI_USAGE_ERROR'],
    ['Usage: flyai search-flight [options]', 'CLI_USAGE_ERROR'],
    ['MCP error: private provider message', 'JSON_RPC_ERROR'],
    ['MCP response not valid JSON: private provider body', 'INVALID_RESPONSE'],
    ['MCP: no body for SSE response', 'INVALID_RESPONSE'],
    ['TypeError: fetch failed', 'NETWORK_ERROR'],
    ['unrecognized private provider text', 'UNKNOWN']
  ] as const
  for (const [stderr, expected] of fixtures) {
    assert.equal(classifyFlyaiCliStderr(stderr), expected)
  }

  assert.equal(
    classifyFlyaiCliStderr(
      'MCP HTTP 451: Unavailable For Legal Reasons\nBody: MCP HTTP 401: private response'
    ),
    'HTTP_451_RISK_CONTROL'
  )
  assert.equal(
    classifyFlyaiCliStderr('unrecognized header\nBody: MCP HTTP 403: private response'),
    'UNKNOWN'
  )
})

test('FlyAI runner propagates every supported stderr class without provider text', async () => {
  const fixtures = [
    ['MCP HTTP 400: Bad Request', 'HTTP_OTHER_4XX'],
    ['MCP HTTP 401: Unauthorized', 'HTTP_401'],
    ['MCP HTTP 403: Forbidden', 'HTTP_403'],
    ['MCP HTTP 429: Too Many Requests', 'HTTP_429'],
    ['MCP HTTP 451: Unavailable For Legal Reasons', 'HTTP_451_RISK_CONTROL'],
    ['MCP HTTP 503: Service Unavailable', 'HTTP_5XX'],
    ['MCP: no body for SSE response', 'INVALID_RESPONSE'],
    ["error: unknown command 'search-flights'", 'CLI_USAGE_ERROR']
  ] as const
  for (const [stderr, expected] of fixtures) {
    const handle = new FakeFlyaiProcessHandle()
    const error = await runFlyaiFlightCliStructureProbe(createProbeInput(), {
      executor: {
        fork: () => {
          queueMicrotask(() => {
            handle.stderr.write(`${stderr}\nBody: sensitive-value`)
            handle.finish(1)
          })
          return handle
        }
      },
      createTimeoutSignal: () => new AbortController().signal
    }).then(
      () => undefined,
      (caught: unknown) => caught
    )
    assert.ok(error instanceof AppError)
    assert.equal(error.code, 'MCP_TOOL_ERROR')
    assert.equal(flyaiCliFailureCategory(error), expected)
    assert.equal(JSON.stringify(error).includes('sensitive-value'), false)
    assert.equal(JSON.stringify(error).includes(stderr), false)
  }
})

test('FlyAI runner includes synchronous trailing stderr emitted by the exit boundary', async () => {
  const handle = new TrailingStderrFlyaiProcessHandle()
  const error = await runFlyaiFlightCliStructureProbe(createProbeInput(), {
    executor: {
      fork: () => {
        queueMicrotask(() =>
          handle.finishWithTrailingStderr(
            1,
            'MCP HTTP 451: Unavailable For Legal Reasons\nBody: sensitive-value'
          )
        )
        return handle
      }
    },
    createTimeoutSignal: () => new AbortController().signal
  }).then(
    () => undefined,
    (caught: unknown) => caught
  )
  assert.ok(error instanceof AppError)
  assert.equal(flyaiCliFailureCategory(error), 'HTTP_451_RISK_CONTROL')
  assert.equal(JSON.stringify(error).includes('sensitive-value'), false)
})

test('FlyAI runner fails before launch when the credential is absent', async () => {
  let processCalls = 0
  await assert.rejects(
    runFlyaiFlightCliStructureProbe(
      { ...createProbeInput(), credential: '' },
      {
        executor: {
          fork() {
            processCalls += 1
            throw new Error('must not launch')
          }
        }
      }
    ),
    isAppError('SOURCE_UNCONFIGURED')
  )
  assert.equal(processCalls, 0)
})

test('FlyAI runner classifies sandbox cleanup failures without leaking raw errors', async () => {
  const handle = new FakeFlyaiProcessHandle()
  let sandboxDirectory: string | undefined
  try {
    const result = runFlyaiFlightCliStructureProbe(createProbeInput(), {
      executor: {
        fork: () => {
          queueMicrotask(() => {
            handle.stdout.write('{"ok":true}\n')
            handle.finish(0)
          })
          return handle
        }
      },
      createTimeoutSignal: () => new AbortController().signal,
      removeSandboxDirectory: async (path) => {
        sandboxDirectory = path
        throw new Error('sensitive local cleanup detail')
      }
    })

    await assert.rejects(result, isAppError('INTERNAL_INVARIANT_VIOLATED'))
  } finally {
    if (sandboxDirectory) {
      await rm(sandboxDirectory, { recursive: true, force: true })
    }
  }
})

test('FlyAI runner normalizes fork, cancellation, fatal, and stderr overflow failures', async () => {
  let forkAttempts = 0
  await assert.rejects(
    runFlyaiFlightCliStructureProbe(createProbeInput(), {
      executor: {
        fork: () => {
          throw new Error('synthetic fork failure')
        }
      },
      onProcessAttempt: () => {
        forkAttempts += 1
      }
    }),
    isAppError('MCP_PROTOCOL_ERROR')
  )
  assert.equal(forkAttempts, 1)

  const cancellationHandle = new ManualExitFlyaiProcessHandle(new PassThrough(), new PassThrough())
  const cancellation = new AbortController()
  let resolveCancellationProcessStarted: (() => void) | undefined
  const cancellationProcessStarted = new Promise<void>((resolve) => {
    resolveCancellationProcessStarted = resolve
  })
  const cancelledResult = runFlyaiFlightCliStructureProbe(
    { ...createProbeInput(), signal: cancellation.signal },
    {
      executor: {
        fork: () => {
          resolveCancellationProcessStarted?.()
          return cancellationHandle
        }
      },
      createTimeoutSignal: () => new AbortController().signal
    }
  )
  await cancellationProcessStarted
  cancellation.abort()
  await waitForKill(cancellationHandle)
  cancellationHandle.finish(143)
  await assert.rejects(cancelledResult, isAppError('SOURCE_CANCELLED'))

  const fatalHandle = new FakeFlyaiProcessHandle()
  const fatalResult = runFlyaiFlightCliStructureProbe(createProbeInput(), {
    executor: {
      fork: () => {
        queueMicrotask(() => fatalHandle.failFatally())
        return fatalHandle
      }
    },
    createTimeoutSignal: () => new AbortController().signal
  })
  await assert.rejects(fatalResult, isAppError('MCP_PROTOCOL_ERROR'))

  const stderrHandle = new FakeFlyaiProcessHandle()
  const stderrResult = runFlyaiFlightCliStructureProbe(createProbeInput(), {
    executor: {
      fork: () => {
        queueMicrotask(() => stderrHandle.stderr.write(Buffer.alloc(8 * 1024 + 1, 0x61)))
        return stderrHandle
      }
    },
    createTimeoutSignal: () => new AbortController().signal
  })
  await assert.rejects(stderrResult, isAppError('MCP_PROTOCOL_ERROR'))

  const streamHandle = new FakeFlyaiProcessHandle()
  const streamResult = runFlyaiFlightCliStructureProbe(createProbeInput(), {
    executor: {
      fork: () => {
        queueMicrotask(() => streamHandle.stdout.emit('error', new Error('provider stream failed')))
        return streamHandle
      }
    },
    createTimeoutSignal: () => new AbortController().signal
  })
  await assert.rejects(streamResult, isAppError('MCP_PROTOCOL_ERROR'))
  assert.equal(streamHandle.killCalls, 1)
})

test('FlyAI runner detects a residual pid after an exit signal', async () => {
  const handle = new ResidualPidFlyaiProcessHandle()
  const result = runFlyaiFlightCliStructureProbe(createProbeInput(), {
    executor: {
      fork: () => {
        queueMicrotask(() => handle.finishWithoutClearingPid(0))
        return handle
      }
    },
    createTimeoutSignal: () => new AbortController().signal
  })
  await assert.rejects(result, isAppError('INTERNAL_INVARIANT_VIOLATED'))
})

function createProbeInput(): FlyaiCliStructureProbeInput {
  return {
    binding: {
      packageName: '@fly-ai/flyai-cli',
      packageVersion: '1.0.16',
      packageIntegrity: 'sha512-fixture',
      binRelativePath: 'dist/flyai-bundle.cjs',
      nodeEngine: '>=18',
      directDependencyNames: ['commander'],
      bundleSha256: `sha256:${'a'.repeat(64)}`,
      bundlePath: 'C:\\safe\\flyai-bundle.cjs',
      bundlePathDigest: `sha256:${'b'.repeat(64)}`,
      launcherRelativePath: 'resources/flyai-utility-process-launcher.cjs',
      launcherSha256: `sha256:${'c'.repeat(64)}`,
      launcherPath: 'C:\\safe\\flyai-utility-process-launcher.cjs',
      launcherPathDigest: `sha256:${'d'.repeat(64)}`
    },
    credential: 'fixture-credential',
    deviceIdentityPath: join(runnerFixtureRoot, `device-id-${deviceIdentitySequence++}`),
    input: { origin: '西双版纳', destination: '广州', depDate: '2026-09-17' },
    operationId: '00000000-0000-4000-8000-000000000001'
  }
}

function isAppError(code: string): (error: unknown) => boolean {
  return (error: unknown) =>
    error instanceof Error && 'code' in error && (error as Error & { code: string }).code === code
}

async function waitForKill(handle: { killCalls: number }): Promise<void> {
  for (let attempt = 0; attempt < 200 && handle.killCalls === 0; attempt += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

class FakeFlyaiProcessHandle implements FlyaiProcessHandle {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  pid: number | undefined = 42_001
  killCalls = 0
  private exitListener: ((code: number) => void) | undefined
  private fatalListener: (() => void) | undefined

  terminate(): boolean {
    this.killCalls += 1
    this.finish(143)
    return true
  }

  onExit(listener: (code: number) => void): () => void {
    this.exitListener = listener
    return () => {
      if (this.exitListener === listener) this.exitListener = undefined
    }
  }

  onFatalError(listener: () => void): () => void {
    this.fatalListener = listener
    return () => {
      if (this.fatalListener === listener) this.fatalListener = undefined
    }
  }

  finish(code: number): void {
    this.pid = undefined
    this.emitExit(code)
  }

  protected emitExit(code: number): void {
    this.exitListener?.(code)
  }

  failFatally(): void {
    this.fatalListener?.()
  }
}

class ManualExitFlyaiProcessHandle implements FlyaiProcessHandle {
  pid: number | undefined = 42_002
  killCalls = 0
  private exitListener: ((code: number) => void) | undefined

  constructor(
    readonly stdout: NodeJS.ReadableStream | null,
    readonly stderr: NodeJS.ReadableStream | null
  ) {}

  terminate(): boolean {
    this.killCalls += 1
    return true
  }

  onExit(listener: (code: number) => void): () => void {
    this.exitListener = listener
    return () => {
      if (this.exitListener === listener) this.exitListener = undefined
    }
  }

  onFatalError(): () => void {
    return () => undefined
  }

  finish(code: number): void {
    this.pid = undefined
    this.exitListener?.(code)
  }
}

class ResidualPidFlyaiProcessHandle extends FakeFlyaiProcessHandle {
  finishWithoutClearingPid(code: number): void {
    this.emitExit(code)
  }
}

class TrailingStderrFlyaiProcessHandle extends FakeFlyaiProcessHandle {
  finishWithTrailingStderr(code: number, stderr: string): void {
    this.pid = undefined
    this.emitExit(code)
    this.stderr.write(stderr)
  }
}
