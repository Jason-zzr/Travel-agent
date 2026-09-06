import { randomUUID } from 'node:crypto'
import { open } from 'node:fs/promises'
import { z } from 'zod'
import { AppError } from '../../shared/errors'
import {
  FLYAI_FLIGHT_COMMAND,
  FLYAI_FLIGHT_INPUT_CONTRACT_VERSION,
  FlyaiFlightSearchInputSchema,
  parseFlyaiFlightSearchInput,
  type FlyaiFlightSearchInput
} from '../../shared/schema/mcp/flyai-flight'
import {
  EXPECTED_FLYAI_PACKAGE_BINDING,
  FLYAI_CLI_FAILURE_CATEGORIES,
  FLYAI_CLI_TIMEOUT_MS,
  FLYAI_STDERR_MAX_BYTES,
  FLYAI_STDERR_CLASSIFIER_VERSION,
  FLYAI_STDOUT_MAX_BYTES,
  FLYAI_UTILITY_PROCESS_LAUNCHER_CONTRACT_VERSION,
  LEGACY_FLYAI_STDERR_CLASSIFIER_VERSION,
  type FlyaiBundleBinding
} from './flyai-cli-runner'
import {
  acquireGateArtifactLock,
  assertGateNotConsumed,
  assertSafeGateArtifactPath,
  deepFreeze,
  digestValue,
  GATE_TTL_MS,
  isNodeErrorCode,
  parseGateJsonObject,
  readRegularGateArtifactFile,
  releaseGateArtifactLock,
  SHA256_SCHEMA,
  writeExclusiveGateArtifact,
  writeGateArtifactAtomically
} from './gate-artifact-primitives'

const GATE_LABEL = 'FlyAI Flight Gate'
const EXPECTED_ARTIFACT_FILE_NAME = 'flyai-flight-preview.json'
const gateAuthorization = Symbol('flyai-flight-gate-authorization')
const claimedAuthorizations = new WeakSet<object>()

const FLYAI_FLIGHT_INPUT_CONTRACT = {
  version: FLYAI_FLIGHT_INPUT_CONTRACT_VERSION,
  additionalProperties: false,
  required: ['origin', 'destination', 'depDate'],
  properties: {
    origin: { type: 'string', pattern: '^\\p{Script=Han}+$', normalization: false },
    destination: { type: 'string', pattern: '^\\p{Script=Han}+$', normalization: false },
    depDate: { type: 'string', format: 'date', constraint: 'strictly-future-local-date' }
  }
} as const

export const FLYAI_FLIGHT_GATE_ARTIFACT_RELATIVE_PATH =
  '.trellis/tasks/09-01-variflight-mcp-flight-query/flyai-flight-preview.json'

export const FLYAI_FLIGHT_INPUT_CONTRACT_DIGEST = digestValue(FLYAI_FLIGHT_INPUT_CONTRACT)

const FlyaiGatePackageBindingSchema = z
  .object({
    packageName: z.literal(EXPECTED_FLYAI_PACKAGE_BINDING.packageName),
    packageVersion: z.literal(EXPECTED_FLYAI_PACKAGE_BINDING.packageVersion),
    packageIntegrity: z.literal(EXPECTED_FLYAI_PACKAGE_BINDING.packageIntegrity),
    binRelativePath: z.literal(EXPECTED_FLYAI_PACKAGE_BINDING.binRelativePath),
    nodeEngine: z.literal(EXPECTED_FLYAI_PACKAGE_BINDING.nodeEngine),
    directDependencyNames: z.tuple([z.literal('commander')]),
    bundleSha256: SHA256_SCHEMA,
    bundlePathDigest: SHA256_SCHEMA,
    launcherRelativePath: z.string().optional(),
    launcherSha256: SHA256_SCHEMA.optional(),
    launcherPathDigest: SHA256_SCHEMA.optional()
  })
  .strict()

const LegacyFlyaiRetentionFieldsSchema = z.tuple([
  z.literal('path'),
  z.literal('type'),
  z.literal('arrayLength'),
  z.literal('truncated'),
  z.literal('errorCode')
])

const CurrentFlyaiRetentionFieldsSchema = z.tuple([
  z.literal('path'),
  z.literal('type'),
  z.literal('arrayLength'),
  z.literal('truncated'),
  z.literal('errorCode'),
  z.literal('failureCategory')
])

const FlyaiRuntimeIsolationSchema = z
  .object({
    workingDirectory: z.literal('ephemeral-per-operation'),
    homeDirectory: z.literal('ephemeral-per-operation'),
    deviceIdentitySeed: z.literal('application-private-persistent'),
    credentialConfigPersistence: z.literal(false)
  })
  .strict()

const FlyaiUtilityProcessLauncherSchema = z
  .object({
    version: z.literal(FLYAI_UTILITY_PROCESS_LAUNCHER_CONTRACT_VERSION),
    targetModuleArgIndex: z.literal(2),
    normalizedCommandIndex: z.literal(1)
  })
  .strict()

const LegacyFlyaiFailureClassificationSchema = z
  .object({
    version: z.literal(LEGACY_FLYAI_STDERR_CLASSIFIER_VERSION),
    categories: z.tuple([
      z.literal('HTTP_401'),
      z.literal('HTTP_403'),
      z.literal('HTTP_429'),
      z.literal('HTTP_5XX'),
      z.literal('JSON_RPC_ERROR'),
      z.literal('NETWORK_ERROR'),
      z.literal('INVALID_RESPONSE'),
      z.literal('UNKNOWN')
    ]),
    rawStderrRetained: z.literal(false)
  })
  .strict()

const CurrentFlyaiFailureClassificationSchema = z
  .object({
    version: z.literal(FLYAI_STDERR_CLASSIFIER_VERSION),
    categories: z.tuple([
      z.literal('HTTP_401'),
      z.literal('HTTP_403'),
      z.literal('HTTP_429'),
      z.literal('HTTP_451_RISK_CONTROL'),
      z.literal('HTTP_OTHER_4XX'),
      z.literal('HTTP_5XX'),
      z.literal('CLI_USAGE_ERROR'),
      z.literal('JSON_RPC_ERROR'),
      z.literal('NETWORK_ERROR'),
      z.literal('INVALID_RESPONSE'),
      z.literal('UNKNOWN')
    ]),
    rawStderrRetained: z.literal(false)
  })
  .strict()

const FlyaiFailureClassificationSchema = z.union([
  LegacyFlyaiFailureClassificationSchema,
  CurrentFlyaiFailureClassificationSchema
])

export const FlyaiFlightGatePlanSchema = z
  .object({
    schemaVersion: z.enum([
      'flyai-flight-gate/v1',
      'flyai-flight-gate/v2',
      'flyai-flight-gate/v3',
      'flyai-flight-gate/v4'
    ]),
    planId: z.string().uuid(),
    operationId: z.string().uuid(),
    createdAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    sourceId: z.literal('SRC_FLIGHT'),
    transport: z.literal('utility-process'),
    packageBinding: FlyaiGatePackageBindingSchema,
    toolBinding: z
      .object({
        name: z.literal(FLYAI_FLIGHT_COMMAND),
        inputContractVersion: z.literal(FLYAI_FLIGHT_INPUT_CONTRACT_VERSION),
        inputContractDigest: SHA256_SCHEMA
      })
      .strict(),
    args: FlyaiFlightSearchInputSchema,
    steps: z.tuple([
      z
        .object({
          sequence: z.literal(1),
          action: z.literal('inspect-local-bundle'),
          attempts: z.literal(1)
        })
        .strict(),
      z
        .object({
          sequence: z.literal(2),
          action: z.literal('utilityProcess.fork'),
          attempts: z.literal(1)
        })
        .strict(),
      z
        .object({
          sequence: z.literal(3),
          action: z.literal('capture-bounded-structure'),
          attempts: z.literal(1)
        })
        .strict(),
      z
        .object({
          sequence: z.literal(4),
          action: z.literal('await-exit-and-cleanup'),
          attempts: z.literal(1)
        })
        .strict()
    ]),
    cliProcessAttempts: z.literal(1),
    applicationRetryCount: z.literal(0),
    internalProviderRequestCount: z.literal('UNKNOWN'),
    internalProviderRetryCount: z.literal('UNKNOWN'),
    timeoutMs: z.literal(FLYAI_CLI_TIMEOUT_MS),
    stdoutMaxBytes: z.literal(FLYAI_STDOUT_MAX_BYTES),
    stderrMaxBytes: z.literal(FLYAI_STDERR_MAX_BYTES),
    previewExternalCalls: z.literal(0),
    credential: z
      .object({
        id: z.literal('FLYAI'),
        environmentVariable: z.literal('FLYAI_API_KEY'),
        valueRetained: z.literal(false)
      })
      .strict(),
    retention: z
      .object({
        allowedFields: z.union([
          LegacyFlyaiRetentionFieldsSchema,
          CurrentFlyaiRetentionFieldsSchema
        ]),
        rawResponseRetained: z.literal(false),
        scalarValuesRetained: z.literal(false),
        productEvidencePersistence: z.literal(false),
        databaseWrites: z.literal(false),
        cacheWrites: z.literal(false)
      })
      .strict(),
    runtimeIsolation: FlyaiRuntimeIsolationSchema.optional(),
    utilityProcessLauncher: FlyaiUtilityProcessLauncherSchema.optional(),
    failureClassification: FlyaiFailureClassificationSchema.optional(),
    providerDisclosure: z
      .object({
        contextHeader: z.literal('x-ff-ctx'),
        contextMayBeSentByPinnedCli: z.literal(true),
        vendorEmbeddedCredentialFallbackPresent: z.literal(true),
        runtimeRequiresUserCredential: z.literal(true)
      })
      .strict(),
    productionRegistration: z
      .object({
        allowlistMutation: z.literal(false),
        toolContractMutation: z.literal(false)
      })
      .strict(),
    executionEntrypoint: z.literal('electron-main-tool-registry-gated-one-shot'),
    stopPolicy: z.literal('fail-closed-on-first-error'),
    approvalScope: z.literal('exact-planId-digest-operationId-only')
  })
  .strict()

export const FlyaiFlightGatePreviewSchema = z
  .object({
    status: z.literal('AWAITING_EXACT_APPROVAL'),
    digest: SHA256_SCHEMA,
    plan: FlyaiFlightGatePlanSchema
  })
  .strict()

const FlyaiFlightGateStoredArtifactSchema = z.discriminatedUnion('status', [
  FlyaiFlightGatePreviewSchema,
  z
    .object({
      status: z.literal('EXPIRED'),
      digest: SHA256_SCHEMA,
      plan: FlyaiFlightGatePlanSchema
    })
    .strict(),
  z
    .object({
      status: z.literal('CONSUMED'),
      consumedAt: z.string().datetime({ offset: true }),
      digest: SHA256_SCHEMA,
      plan: FlyaiFlightGatePlanSchema
    })
    .strict()
])

export const FlyaiFlightGateClaimRequestSchema = z
  .object({
    planId: z.string().uuid(),
    digest: SHA256_SCHEMA,
    operationId: z.string().uuid()
  })
  .strict()

export type FlyaiFlightGatePlan = z.infer<typeof FlyaiFlightGatePlanSchema>
export type FlyaiFlightGatePreview = z.infer<typeof FlyaiFlightGatePreviewSchema>
export type FlyaiFlightGateClaimRequest = z.infer<typeof FlyaiFlightGateClaimRequestSchema>

export interface AuthorizedFlyaiFlightProbe {
  readonly plan: FlyaiFlightGatePlan
  readonly digest: string
  readonly [gateAuthorization]: true
}

interface PreviewOptions {
  args: FlyaiFlightSearchInput
  binding: FlyaiBundleBinding
  now?: Date
  planId?: string
  operationId?: string
}

interface WritePreviewOptions extends PreviewOptions {
  allowedRoot: string
}

interface ClaimOptions {
  allowedRoot: string
  now?: Date
}

export function createFlyaiFlightGatePreview(options: PreviewOptions): FlyaiFlightGatePreview {
  const now = options.now ?? new Date()
  const args = parseFlightArgs(options.args, localIsoDate(now))
  const packageBinding = packageBindingFromInspection(options.binding)
  assertExpectedPackageBinding(packageBinding)
  const plan = FlyaiFlightGatePlanSchema.parse({
    schemaVersion: 'flyai-flight-gate/v4',
    planId: options.planId ?? randomUUID(),
    operationId: options.operationId ?? randomUUID(),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + GATE_TTL_MS).toISOString(),
    sourceId: 'SRC_FLIGHT',
    transport: 'utility-process',
    packageBinding,
    toolBinding: {
      name: FLYAI_FLIGHT_COMMAND,
      inputContractVersion: FLYAI_FLIGHT_INPUT_CONTRACT_VERSION,
      inputContractDigest: FLYAI_FLIGHT_INPUT_CONTRACT_DIGEST
    },
    args,
    steps: [
      { sequence: 1, action: 'inspect-local-bundle', attempts: 1 },
      { sequence: 2, action: 'utilityProcess.fork', attempts: 1 },
      { sequence: 3, action: 'capture-bounded-structure', attempts: 1 },
      { sequence: 4, action: 'await-exit-and-cleanup', attempts: 1 }
    ],
    cliProcessAttempts: 1,
    applicationRetryCount: 0,
    internalProviderRequestCount: 'UNKNOWN',
    internalProviderRetryCount: 'UNKNOWN',
    timeoutMs: FLYAI_CLI_TIMEOUT_MS,
    stdoutMaxBytes: FLYAI_STDOUT_MAX_BYTES,
    stderrMaxBytes: FLYAI_STDERR_MAX_BYTES,
    previewExternalCalls: 0,
    credential: {
      id: 'FLYAI',
      environmentVariable: 'FLYAI_API_KEY',
      valueRetained: false
    },
    retention: {
      allowedFields: ['path', 'type', 'arrayLength', 'truncated', 'errorCode', 'failureCategory'],
      rawResponseRetained: false,
      scalarValuesRetained: false,
      productEvidencePersistence: false,
      databaseWrites: false,
      cacheWrites: false
    },
    runtimeIsolation: {
      workingDirectory: 'ephemeral-per-operation',
      homeDirectory: 'ephemeral-per-operation',
      deviceIdentitySeed: 'application-private-persistent',
      credentialConfigPersistence: false
    },
    utilityProcessLauncher: {
      version: FLYAI_UTILITY_PROCESS_LAUNCHER_CONTRACT_VERSION,
      targetModuleArgIndex: 2,
      normalizedCommandIndex: 1
    },
    failureClassification: {
      version: FLYAI_STDERR_CLASSIFIER_VERSION,
      categories: FLYAI_CLI_FAILURE_CATEGORIES,
      rawStderrRetained: false
    },
    providerDisclosure: {
      contextHeader: 'x-ff-ctx',
      contextMayBeSentByPinnedCli: true,
      vendorEmbeddedCredentialFallbackPresent: true,
      runtimeRequiresUserCredential: true
    },
    productionRegistration: {
      allowlistMutation: false,
      toolContractMutation: false
    },
    executionEntrypoint: 'electron-main-tool-registry-gated-one-shot',
    stopPolicy: 'fail-closed-on-first-error',
    approvalScope: 'exact-planId-digest-operationId-only'
  })
  return FlyaiFlightGatePreviewSchema.parse({
    status: 'AWAITING_EXACT_APPROVAL',
    digest: digestValue(plan),
    plan
  })
}

export async function writeFlyaiFlightGatePreview(
  artifactPath: string,
  options: WritePreviewOptions
): Promise<FlyaiFlightGatePreview> {
  const now = options.now ?? new Date()
  const safeArtifactPath = await assertSafeGateArtifactPath(artifactPath, options.allowedRoot, {
    allowMissing: true,
    expectedFileName: EXPECTED_ARTIFACT_FILE_NAME,
    gateLabel: GATE_LABEL
  })
  const lockPath = `${safeArtifactPath}.lock`
  let lock: Awaited<ReturnType<typeof open>> | undefined
  try {
    lock = await acquireGateArtifactLock(lockPath, GATE_LABEL)
    const stored = await readStoredArtifactIfPresent(safeArtifactPath)
    if (stored) {
      if (stored.digest !== digestValue(stored.plan)) {
        throw new AppError('INPUT_INVALID', `${GATE_LABEL} 旧文件摘要不匹配。`)
      }
      const consumedMarker = await readConsumedMarker(
        `${safeArtifactPath}.${stored.plan.operationId}.consumed`
      )
      if (consumedMarker) {
        if (
          consumedMarker.digest !== stored.digest ||
          consumedMarker.digest !== digestValue(consumedMarker.plan)
        ) {
          throw new AppError('INPUT_INVALID', `${GATE_LABEL} 消费记录与旧计划不匹配。`)
        }
        assertReplaceableStoredArtifact(consumedMarker, now)
      } else {
        assertReplaceableStoredArtifact(stored, now)
      }
    }
    const preview = createFlyaiFlightGatePreview(options)
    await writeGateArtifactAtomically(safeArtifactPath, preview)
    return preview
  } finally {
    await releaseGateArtifactLock(lock, lockPath)
  }
}

export async function claimFlyaiFlightGate(
  artifactPath: string,
  input: FlyaiFlightGateClaimRequest,
  options: ClaimOptions
): Promise<AuthorizedFlyaiFlightProbe> {
  const request = parseClaimRequest(input)
  const now = options.now ?? new Date()
  const safeArtifactPath = await assertSafeGateArtifactPath(artifactPath, options.allowedRoot, {
    expectedFileName: EXPECTED_ARTIFACT_FILE_NAME,
    gateLabel: GATE_LABEL
  })
  const lockPath = `${safeArtifactPath}.lock`
  const consumedPath = `${safeArtifactPath}.${request.operationId}.consumed`
  let lock: Awaited<ReturnType<typeof open>> | undefined
  try {
    lock = await acquireGateArtifactLock(lockPath, GATE_LABEL)
    await assertGateNotConsumed(consumedPath, GATE_LABEL)
    const raw = parseGateJsonObject(
      await readRegularGateArtifactFile(safeArtifactPath, GATE_LABEL),
      GATE_LABEL
    )
    if (raw.status !== 'AWAITING_EXACT_APPROVAL') {
      throw new AppError('INPUT_INVALID', `${GATE_LABEL} 已消费或不可执行。`)
    }
    const parsed = FlyaiFlightGatePreviewSchema.safeParse(raw)
    if (!parsed.success) {
      throw new AppError('INPUT_INVALID', `${GATE_LABEL} 文件结构不合法。`)
    }
    const preview = parsed.data
    assertPreviewIntegrity(preview, request, now)

    const consumed = {
      status: 'CONSUMED',
      consumedAt: now.toISOString(),
      digest: preview.digest,
      plan: preview.plan
    }
    await writeExclusiveGateArtifact(consumedPath, consumed, GATE_LABEL)
    await writeGateArtifactAtomically(safeArtifactPath, consumed)

    const authorization: AuthorizedFlyaiFlightProbe = Object.freeze({
      plan: deepFreeze(structuredClone(preview.plan)),
      digest: preview.digest,
      [gateAuthorization]: true as const
    })
    claimedAuthorizations.add(authorization)
    return authorization
  } finally {
    await releaseGateArtifactLock(lock, lockPath)
  }
}

export function consumeAuthorizedFlyaiFlightProbe(
  value: unknown,
  now = new Date()
): asserts value is AuthorizedFlyaiFlightProbe {
  if (
    value === null ||
    typeof value !== 'object' ||
    !claimedAuthorizations.has(value) ||
    (value as Partial<AuthorizedFlyaiFlightProbe>)[gateAuthorization] !== true
  ) {
    throw new AppError('GATE_BLOCKED', 'FlyAI flight probe 缺少已消费的精确 Gate 授权。')
  }
  const authorization = value as AuthorizedFlyaiFlightProbe
  const plan = FlyaiFlightGatePlanSchema.parse(authorization.plan)
  if (authorization.digest !== digestValue(plan)) {
    throw new AppError('INPUT_INVALID', `${GATE_LABEL} 授权摘要不匹配。`)
  }
  assertPlanPolicy(plan, now)
  claimedAuthorizations.delete(value)
}

export function assertFlyaiBundleMatchesAuthorization(
  authorization: AuthorizedFlyaiFlightProbe,
  binding: FlyaiBundleBinding
): void {
  const actual = packageBindingFromInspection(binding)
  if (digestValue(actual) !== digestValue(authorization.plan.packageBinding)) {
    throw new AppError('SOURCE_DRIFT', 'FlyAI 本地 CLI 绑定已漂移；Gate 不可继续执行。')
  }
}

export function parseFlyaiFlightGatePreviewCliArgs(
  args: string[],
  currentDate = localIsoDate(new Date())
): FlyaiFlightSearchInput {
  const values = parseNamedCliValues(args, ['origin', 'destination', 'dep-date'], 'preview')
  return parseFlightArgs(
    {
      origin: values.origin,
      destination: values.destination,
      depDate: values['dep-date']
    },
    currentDate
  )
}

export function parseFlyaiFlightGateClaimCliArgs(args: string[]): FlyaiFlightGateClaimRequest {
  const values = parseNamedCliValues(args, ['plan-id', 'digest', 'operation-id'], 'execute')
  return parseClaimRequest({
    planId: values['plan-id'],
    digest: values.digest,
    operationId: values['operation-id']
  })
}

function parseNamedCliValues(
  args: string[],
  allowedNames: readonly string[],
  mode: 'preview' | 'execute'
): Record<string, string> {
  const values: Record<string, string> = {}
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]
    const value = args[index + 1]
    if (!name?.startsWith('--') || !value || value.startsWith('--')) {
      throw new AppError('INPUT_INVALID', `${GATE_LABEL} ${mode} 参数不完整。`)
    }
    const key = name.slice(2)
    if (!allowedNames.includes(key) || key in values) {
      throw new AppError('INPUT_INVALID', `${GATE_LABEL} ${mode} 包含未知或重复参数。`)
    }
    values[key] = value
  }
  return values
}

function parseFlightArgs(input: unknown, currentDate: string): FlyaiFlightSearchInput {
  try {
    return parseFlyaiFlightSearchInput(input, currentDate)
  } catch (error) {
    throw new AppError(
      'INPUT_INVALID',
      'FlyAI search-flight 参数必须严格包含中文 origin、中文 destination 与未来日期 depDate。',
      { cause: error }
    )
  }
}

function parseClaimRequest(input: unknown): FlyaiFlightGateClaimRequest {
  const parsed = FlyaiFlightGateClaimRequestSchema.safeParse(input)
  if (!parsed.success) {
    throw new AppError('INPUT_INVALID', `${GATE_LABEL} 执行三元组不合法。`)
  }
  return parsed.data
}

function packageBindingFromInspection(
  binding: FlyaiBundleBinding
): z.infer<typeof FlyaiGatePackageBindingSchema> {
  return FlyaiGatePackageBindingSchema.parse({
    packageName: binding.packageName,
    packageVersion: binding.packageVersion,
    packageIntegrity: binding.packageIntegrity,
    binRelativePath: binding.binRelativePath,
    nodeEngine: binding.nodeEngine,
    directDependencyNames: binding.directDependencyNames,
    bundleSha256: binding.bundleSha256,
    bundlePathDigest: binding.bundlePathDigest,
    launcherRelativePath: binding.launcherRelativePath,
    launcherSha256: binding.launcherSha256,
    launcherPathDigest: binding.launcherPathDigest
  })
}

function assertExpectedPackageBinding(
  binding: z.infer<typeof FlyaiGatePackageBindingSchema>
): void {
  const expected = EXPECTED_FLYAI_PACKAGE_BINDING
  if (
    binding.bundleSha256 !== expected.bundleSha256 ||
    binding.packageName !== expected.packageName ||
    binding.packageVersion !== expected.packageVersion ||
    binding.packageIntegrity !== expected.packageIntegrity ||
    binding.binRelativePath !== expected.binRelativePath ||
    binding.nodeEngine !== expected.nodeEngine ||
    binding.directDependencyNames.join('\0') !== expected.directDependencyNames.join('\0') ||
    (binding.launcherRelativePath !== undefined &&
      binding.launcherRelativePath !== expected.launcherRelativePath) ||
    (binding.launcherSha256 !== undefined && binding.launcherSha256 !== expected.launcherSha256)
  ) {
    throw new AppError('SOURCE_DRIFT', 'FlyAI package binding does not match the pinned contract.')
  }
}

function assertPreviewIntegrity(
  preview: FlyaiFlightGatePreview,
  request: FlyaiFlightGateClaimRequest,
  now: Date
): void {
  if (preview.digest !== digestValue(preview.plan)) {
    throw new AppError('INPUT_INVALID', `${GATE_LABEL} 文件摘要与计划不匹配。`)
  }
  assertPlanPolicy(preview.plan, now)
  if (
    request.planId !== preview.plan.planId ||
    request.operationId !== preview.plan.operationId ||
    request.digest !== preview.digest
  ) {
    throw new AppError('INPUT_INVALID', `${GATE_LABEL} 未获得当前三元组的精确授权。`)
  }
}

function assertPlanPolicy(plan: FlyaiFlightGatePlan, now: Date): void {
  assertExpectedPackageBinding(plan.packageBinding)
  if (
    plan.schemaVersion !== 'flyai-flight-gate/v4' ||
    !plan.runtimeIsolation ||
    !plan.utilityProcessLauncher ||
    !plan.failureClassification ||
    plan.packageBinding.launcherRelativePath !==
      EXPECTED_FLYAI_PACKAGE_BINDING.launcherRelativePath ||
    plan.packageBinding.launcherSha256 !== EXPECTED_FLYAI_PACKAGE_BINDING.launcherSha256 ||
    !plan.packageBinding.launcherPathDigest ||
    digestValue(plan.runtimeIsolation) !==
      digestValue({
        workingDirectory: 'ephemeral-per-operation',
        homeDirectory: 'ephemeral-per-operation',
        deviceIdentitySeed: 'application-private-persistent',
        credentialConfigPersistence: false
      }) ||
    digestValue(plan.utilityProcessLauncher) !==
      digestValue({
        version: FLYAI_UTILITY_PROCESS_LAUNCHER_CONTRACT_VERSION,
        targetModuleArgIndex: 2,
        normalizedCommandIndex: 1
      }) ||
    digestValue(plan.failureClassification) !==
      digestValue({
        version: FLYAI_STDERR_CLASSIFIER_VERSION,
        categories: FLYAI_CLI_FAILURE_CATEGORIES,
        rawStderrRetained: false
      }) ||
    plan.retention.allowedFields.at(-1) !== 'failureCategory'
  ) {
    throw new AppError('GATE_BLOCKED', 'FlyAI 执行隔离或失败分类契约已漂移，请重新生成 Gate。')
  }
  if (plan.toolBinding.inputContractDigest !== FLYAI_FLIGHT_INPUT_CONTRACT_DIGEST) {
    throw new AppError('GATE_BLOCKED', 'FlyAI 输入契约已漂移，请重新生成 Gate。')
  }
  parseFlightArgs(plan.args, localIsoDate(now))
  const createdAt = Date.parse(plan.createdAt)
  const expiresAt = Date.parse(plan.expiresAt)
  if (
    createdAt > now.getTime() ||
    expiresAt - createdAt !== GATE_TTL_MS ||
    expiresAt <= now.getTime()
  ) {
    throw new AppError('GATE_BLOCKED', `${GATE_LABEL} 尚未生效、已过期或有效期不合法。`)
  }
}

function assertReplaceableStoredArtifact(
  stored: z.infer<typeof FlyaiFlightGateStoredArtifactSchema>,
  now: Date
): void {
  const expiresAt = Date.parse(stored.plan.expiresAt)
  if (stored.status === 'AWAITING_EXACT_APPROVAL') {
    if (expiresAt > now.getTime()) {
      throw new AppError('GATE_BLOCKED', `当前 ${GATE_LABEL} 尚未过期，不得覆盖。`)
    }
    return
  }
  if (stored.status === 'EXPIRED') {
    if (expiresAt > now.getTime()) {
      throw new AppError('INPUT_INVALID', `${GATE_LABEL} 的 EXPIRED 状态与有效期冲突。`)
    }
    return
  }
  const consumedAt = Date.parse(stored.consumedAt)
  if (
    consumedAt < Date.parse(stored.plan.createdAt) ||
    consumedAt > now.getTime() ||
    consumedAt >= expiresAt
  ) {
    throw new AppError('INPUT_INVALID', `${GATE_LABEL} 的 CONSUMED 状态时间不合法。`)
  }
}

async function readStoredArtifactIfPresent(
  artifactPath: string
): Promise<z.infer<typeof FlyaiFlightGateStoredArtifactSchema> | undefined> {
  try {
    return parseStoredArtifact(await readRegularGateArtifactFile(artifactPath, GATE_LABEL))
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return undefined
    throw error
  }
}

async function readConsumedMarker(
  consumedPath: string
): Promise<
  Extract<z.infer<typeof FlyaiFlightGateStoredArtifactSchema>, { status: 'CONSUMED' }> | undefined
> {
  try {
    const stored = parseStoredArtifact(await readRegularGateArtifactFile(consumedPath, GATE_LABEL))
    if (stored.status !== 'CONSUMED') {
      throw new AppError('INPUT_INVALID', `${GATE_LABEL} 消费记录结构不合法。`)
    }
    return stored
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return undefined
    throw error
  }
}

function parseStoredArtifact(value: string): z.infer<typeof FlyaiFlightGateStoredArtifactSchema> {
  const parsed = FlyaiFlightGateStoredArtifactSchema.safeParse(
    parseGateJsonObject(value, GATE_LABEL)
  )
  if (!parsed.success) {
    throw new AppError('INPUT_INVALID', `${GATE_LABEL} 旧文件结构不合法。`)
  }
  return parsed.data
}

function localIsoDate(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
