import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AppError } from '../shared/errors'
import { SOURCE_DEFINITIONS } from './mcp/source-catalog'
import { digestValue } from './probes/gate-artifact-primitives'
import type { FlyaiBundleBinding } from './probes/flyai-cli-runner'
import {
  assertFlyaiBundleMatchesAuthorization,
  claimFlyaiFlightGate,
  consumeAuthorizedFlyaiFlightProbe,
  createFlyaiFlightGatePreview,
  FLYAI_FLIGHT_INPUT_CONTRACT_DIGEST,
  parseFlyaiFlightGateClaimCliArgs,
  parseFlyaiFlightGatePreviewCliArgs,
  type FlyaiFlightGatePreview,
  writeFlyaiFlightGatePreview
} from './probes/flyai-flight-gate'

const CREATED_AT = new Date('2026-09-02T08:00:00.000Z')
const CLAIMED_AT = new Date('2026-09-02T08:01:00.000Z')
const PLAN_ID = '11111111-1111-4111-8111-111111111111'
const OPERATION_ID = '22222222-2222-4222-8222-222222222222'
const ARGS = { origin: '西双版纳', destination: '广州', depDate: '2026-09-17' } as const
const BINDING: FlyaiBundleBinding = {
  packageName: '@fly-ai/flyai-cli',
  packageVersion: '1.0.16',
  packageIntegrity:
    'sha512-Ksi06xvJSJcdhmfoDbpAnA84K4/pF+SkLsa5ZLvNruUc3e2EpoGaI6FcJXKTODvB/evprfy5pdRzW3lVazqfkA==',
  binRelativePath: 'dist/flyai-bundle.cjs',
  nodeEngine: '>=18',
  directDependencyNames: ['commander'],
  bundleSha256: 'sha256:194a66eb84094f3d8ee20fac0a2d6cae10a405cd59ac100b7e7880ebc97297da',
  bundlePath: 'C:\\safe\\node_modules\\@fly-ai\\flyai-cli\\dist\\flyai-bundle.cjs',
  bundlePathDigest: `sha256:${'b'.repeat(64)}`,
  launcherRelativePath: 'resources/flyai-utility-process-launcher.cjs',
  launcherSha256: 'sha256:f2264a6037b91b3cb14084da75e80f02d5e5d7bffeb44090c4766e3b970a00a5',
  launcherPath: 'C:\\safe\\resources\\flyai-utility-process-launcher.cjs',
  launcherPathDigest: `sha256:${'c'.repeat(64)}`
}

test('FlyAI Gate preview binds exactly one process while preview has zero provider calls', () => {
  const calls = { process: 0, provider: 0 }
  const preview = createFlyaiFlightGatePreview({
    args: ARGS,
    binding: BINDING,
    now: CREATED_AT,
    planId: PLAN_ID,
    operationId: OPERATION_ID
  })

  assert.deepEqual(calls, { process: 0, provider: 0 })
  assert.equal(preview.plan.schemaVersion, 'flyai-flight-gate/v4')
  assert.equal(preview.plan.previewExternalCalls, 0)
  assert.equal(preview.plan.cliProcessAttempts, 1)
  assert.equal(preview.plan.applicationRetryCount, 0)
  assert.equal(preview.plan.internalProviderRequestCount, 'UNKNOWN')
  assert.equal(preview.plan.internalProviderRetryCount, 'UNKNOWN')
  assert.equal(preview.plan.toolBinding.name, 'search-flight')
  assert.equal(preview.plan.toolBinding.inputContractDigest, FLYAI_FLIGHT_INPUT_CONTRACT_DIGEST)
  assert.deepEqual(preview.plan.args, ARGS)
  assert.equal(preview.plan.credential.valueRetained, false)
  assert.equal(preview.plan.runtimeIsolation?.homeDirectory, 'ephemeral-per-operation')
  assert.equal(preview.plan.runtimeIsolation?.deviceIdentitySeed, 'application-private-persistent')
  assert.equal(preview.plan.runtimeIsolation?.credentialConfigPersistence, false)
  assert.equal(preview.plan.utilityProcessLauncher?.version, 'flyai-utility-process-launcher/v1')
  assert.equal(preview.plan.utilityProcessLauncher?.targetModuleArgIndex, 2)
  assert.equal(preview.plan.utilityProcessLauncher?.normalizedCommandIndex, 1)
  assert.equal(preview.plan.packageBinding.launcherSha256, BINDING.launcherSha256)
  assert.equal(preview.plan.failureClassification?.rawStderrRetained, false)
  assert.equal(preview.plan.failureClassification?.version, 'flyai-cli-stderr-classifier/v2')
  assert.deepEqual(preview.plan.failureClassification?.categories, [
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
  ])
  assert.equal(preview.plan.retention.allowedFields.at(-1), 'failureCategory')
  assert.equal(preview.plan.providerDisclosure.vendorEmbeddedCredentialFallbackPresent, true)
  assert.equal(preview.plan.providerDisclosure.runtimeRequiresUserCredential, true)
  assert.equal(preview.plan.productionRegistration.allowlistMutation, false)
  assert.equal(preview.plan.executionEntrypoint, 'electron-main-tool-registry-gated-one-shot')
})

test('FlyAI Gate writes, claims, and consumes the exact tuple only once', async () => {
  const fixture = await createFixture(false)
  try {
    const preview = await writeFlyaiFlightGatePreview(fixture.path, {
      allowedRoot: fixture.root,
      args: ARGS,
      binding: BINDING,
      now: CREATED_AT,
      planId: PLAN_ID,
      operationId: OPERATION_ID
    })
    assert.deepEqual(JSON.parse(await readFile(fixture.path, 'utf8')), preview)

    await assert.rejects(
      claimFlyaiFlightGate(
        fixture.path,
        { planId: PLAN_ID, operationId: OPERATION_ID, digest: `sha256:${'0'.repeat(64)}` },
        { allowedRoot: fixture.root, now: CLAIMED_AT }
      ),
      isAppError('INPUT_INVALID')
    )

    const authorization = await claimFlyaiFlightGate(
      fixture.path,
      { planId: PLAN_ID, operationId: OPERATION_ID, digest: preview.digest },
      { allowedRoot: fixture.root, now: CLAIMED_AT }
    )
    assert.equal(JSON.parse(await readFile(fixture.path, 'utf8')).status, 'CONSUMED')
    consumeAuthorizedFlyaiFlightProbe(authorization, new Date('2026-09-02T08:01:01.000Z'))
    assert.throws(
      () => consumeAuthorizedFlyaiFlightProbe(authorization, CLAIMED_AT),
      isAppError('GATE_BLOCKED')
    )
  } finally {
    await fixture.cleanup()
  }
})

test('FlyAI Gate rejects plan and local bundle drift after claim', async () => {
  const fixture = await createFixture()
  try {
    const tampered = structuredClone(fixture.preview)
    tampered.plan.toolBinding.inputContractDigest = `sha256:${'0'.repeat(64)}`
    tampered.digest = digestValue(tampered.plan)
    await writeFile(fixture.path, `${JSON.stringify(tampered, null, 2)}\n`, 'utf8')
    await assert.rejects(
      claimFlyaiFlightGate(
        fixture.path,
        { planId: PLAN_ID, operationId: OPERATION_ID, digest: tampered.digest },
        { allowedRoot: fixture.root, now: CLAIMED_AT }
      ),
      isAppError('GATE_BLOCKED')
    )

    const clean = await createFixture()
    try {
      const authorization = await claimFlyaiFlightGate(
        clean.path,
        { planId: PLAN_ID, operationId: OPERATION_ID, digest: clean.preview.digest },
        { allowedRoot: clean.root, now: CLAIMED_AT }
      )
      assert.throws(
        () =>
          assertFlyaiBundleMatchesAuthorization(authorization, {
            ...BINDING,
            bundleSha256: `sha256:${'f'.repeat(64)}`
          }),
        isAppError('SOURCE_DRIFT')
      )
    } finally {
      await clean.cleanup()
    }
  } finally {
    await fixture.cleanup()
  }
})

test('FlyAI Gate preserves old consumed artifacts but rejects legacy plans for execution', async () => {
  const fixture = await createFixture(false)
  try {
    const legacy = structuredClone(fixture.preview)
    legacy.plan.schemaVersion = 'flyai-flight-gate/v1'
    delete legacy.plan.runtimeIsolation
    delete legacy.plan.failureClassification
    legacy.plan.retention.allowedFields = ['path', 'type', 'arrayLength', 'truncated', 'errorCode']
    legacy.digest = digestValue(legacy.plan)
    await writeFile(fixture.path, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8')

    await assert.rejects(
      claimFlyaiFlightGate(
        fixture.path,
        { planId: PLAN_ID, operationId: OPERATION_ID, digest: legacy.digest },
        { allowedRoot: fixture.root, now: CLAIMED_AT }
      ),
      isAppError('GATE_BLOCKED')
    )
  } finally {
    await fixture.cleanup()
  }
})

test('FlyAI Gate parses classifier-v1 Gate v2 history but never restores execution', async () => {
  const fixture = await createFixture(false)
  try {
    const legacy = structuredClone(fixture.preview)
    legacy.plan.schemaVersion = 'flyai-flight-gate/v2'
    legacy.plan.failureClassification = {
      version: 'flyai-cli-stderr-classifier/v1',
      categories: [
        'HTTP_401',
        'HTTP_403',
        'HTTP_429',
        'HTTP_5XX',
        'JSON_RPC_ERROR',
        'NETWORK_ERROR',
        'INVALID_RESPONSE',
        'UNKNOWN'
      ],
      rawStderrRetained: false
    }
    legacy.digest = digestValue(legacy.plan)
    await writeFile(fixture.path, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8')

    await assert.rejects(
      claimFlyaiFlightGate(
        fixture.path,
        { planId: PLAN_ID, operationId: OPERATION_ID, digest: legacy.digest },
        { allowedRoot: fixture.root, now: CLAIMED_AT }
      ),
      isAppError('GATE_BLOCKED')
    )
  } finally {
    await fixture.cleanup()
  }
})

test('FlyAI Gate preserves Gate v3 history but rejects its missing launcher policy', async () => {
  const fixture = await createFixture(false)
  try {
    const legacy = structuredClone(fixture.preview)
    legacy.plan.schemaVersion = 'flyai-flight-gate/v3'
    delete legacy.plan.utilityProcessLauncher
    delete legacy.plan.packageBinding.launcherRelativePath
    delete legacy.plan.packageBinding.launcherSha256
    delete legacy.plan.packageBinding.launcherPathDigest
    legacy.digest = digestValue(legacy.plan)
    await writeFile(fixture.path, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8')

    await assert.rejects(
      claimFlyaiFlightGate(
        fixture.path,
        { planId: PLAN_ID, operationId: OPERATION_ID, digest: legacy.digest },
        { allowedRoot: fixture.root, now: CLAIMED_AT }
      ),
      isAppError('GATE_BLOCKED')
    )
  } finally {
    await fixture.cleanup()
  }
})

test('FlyAI Gate CLI parsers reject normalization, extras, duplicates, and stale dates', () => {
  assert.deepEqual(
    parseFlyaiFlightGatePreviewCliArgs(
      ['--origin', '西双版纳', '--destination', '广州', '--dep-date', '2026-09-17'],
      '2026-09-02'
    ),
    ARGS
  )
  for (const invalid of [
    ['--origin', 'Xishuangbanna', '--destination', '广州', '--dep-date', '2026-09-17'],
    ['--origin', ' 西双版纳', '--destination', '广州', '--dep-date', '2026-09-17'],
    ['--origin', '西双版纳', '--destination', '广州', '--dep-date', '2026-09-02'],
    ['--origin', '西双版纳', '--destination', '广州', '--dep-date', '2026-09-17', '--extra', '1'],
    [
      '--origin',
      '西双版纳',
      '--origin',
      '广州',
      '--destination',
      '广州',
      '--dep-date',
      '2026-09-17'
    ]
  ]) {
    assert.throws(
      () => parseFlyaiFlightGatePreviewCliArgs(invalid, '2026-09-02'),
      isAppError('INPUT_INVALID')
    )
  }

  const digest = `sha256:${'a'.repeat(64)}`
  assert.deepEqual(
    parseFlyaiFlightGateClaimCliArgs([
      '--plan-id',
      PLAN_ID,
      '--digest',
      digest,
      '--operation-id',
      OPERATION_ID
    ]),
    { planId: PLAN_ID, digest, operationId: OPERATION_ID }
  )
  assert.throws(
    () =>
      parseFlyaiFlightGateClaimCliArgs([
        '--plan-id',
        PLAN_ID,
        '--digest',
        digest,
        '--operation-id',
        OPERATION_ID,
        '--retry',
        '1'
      ]),
    isAppError('INPUT_INVALID')
  )
})

test('FlyAI Phase A leaves the production flight source closed', () => {
  const flight = SOURCE_DEFINITIONS.SRC_FLIGHT
  assert.deepEqual([...flight.allowlist], [])
  assert.deepEqual(Object.keys(flight.tools), [])
  assert.equal(flight.probeTool, null)
  assert.equal(flight.discoveryOnly, true)
})

async function createFixture(write = true): Promise<{
  root: string
  path: string
  preview: FlyaiFlightGatePreview
  cleanup(): Promise<void>
}> {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-flyai-gate-'))
  const path = join(root, 'flyai-flight-preview.json')
  const preview = createFlyaiFlightGatePreview({
    args: ARGS,
    binding: BINDING,
    now: CREATED_AT,
    planId: PLAN_ID,
    operationId: OPERATION_ID
  })
  if (write) await writeFile(path, `${JSON.stringify(preview, null, 2)}\n`, 'utf8')
  return { root, path, preview, cleanup: () => rm(root, { recursive: true, force: true }) }
}

function isAppError(code: AppError['code']): (error: unknown) => boolean {
  return (error: unknown) => error instanceof AppError && error.code === code
}
