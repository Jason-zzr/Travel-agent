import { randomUUID } from 'node:crypto'
import { open } from 'node:fs/promises'
import { z } from 'zod'
import { AppError } from '../../shared/errors'
import {
  VARIFLIGHT_FLIGHT_PRICE_INPUT_CONTRACT_VERSION,
  VARIFLIGHT_FLIGHT_PRICE_TOOL_NAME,
  VariflightFlightPriceArgsSchema,
  type VariflightFlightPriceArgs
} from '../../shared/schema/mcp/flight'
import { VARIFLIGHT_SSE_ENDPOINT } from '../mcp/sources/variflight'
import {
  acquireGateArtifactLock,
  assertGateNotConsumed,
  assertSafeGateArtifactPath,
  deepFreeze,
  digestString,
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
import { VARIFLIGHT_FLIGHT_PRICE_INPUT_CONTRACT_DIGEST } from './variflight-result-gate'
import { VARIFLIGHT_SEMANTIC_CLASSIFIER_CONTRACT_VERSION } from './variflight-semantics-classifier'

const GATE_LABEL = 'VariFlight Gate R-3'
const EXPECTED_ARTIFACT_FILE_NAME = 'gate-r3-preview.json'
const gateAuthorization = Symbol('variflight-gate-r3-authorization')
const claimedAuthorizations = new WeakSet<object>()

const SEMANTIC_CLASSIFIER_CONTRACT = {
  version: VARIFLIGHT_SEMANTIC_CLASSIFIER_CONTRACT_VERSION,
  classificationStatus: 'FORMAT_AND_CONSISTENCY_ONLY',
  contractStatus: 'UNPROVEN',
  allowedValueKinds: ['boolean', 'enum', 'count', 'json-pointer-path'],
  rawResponseRetained: false,
  valueRetention: false,
  maxFlights: 64,
  maxCabinsPerFlight: 64
} as const

export const VARIFLIGHT_GATE_R3_ARTIFACT_RELATIVE_PATH =
  '.trellis/tasks/09-01-variflight-mcp-flight-query/gate-r3-preview.json'

export const VARIFLIGHT_SEMANTIC_CLASSIFIER_CONTRACT_DIGEST = digestValue(
  SEMANTIC_CLASSIFIER_CONTRACT
)

export const VariflightGateR3PlanSchema = z
  .object({
    schemaVersion: z.literal('variflight-gate-r3/v1'),
    planId: z.string().uuid(),
    operationId: z.string().uuid(),
    createdAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    sourceId: z.literal('SRC_FLIGHT'),
    transport: z.literal('legacy-sse'),
    endpointBinding: z
      .object({ constant: z.literal('VARIFLIGHT_SSE_ENDPOINT'), digest: SHA256_SCHEMA })
      .strict(),
    toolBinding: z
      .object({
        name: z.literal(VARIFLIGHT_FLIGHT_PRICE_TOOL_NAME),
        inputContractVersion: z.literal(VARIFLIGHT_FLIGHT_PRICE_INPUT_CONTRACT_VERSION),
        inputContractDigest: SHA256_SCHEMA
      })
      .strict(),
    semanticClassifierBinding: z
      .object({
        version: z.literal(VARIFLIGHT_SEMANTIC_CLASSIFIER_CONTRACT_VERSION),
        digest: SHA256_SCHEMA
      })
      .strict(),
    args: VariflightFlightPriceArgsSchema,
    steps: z.tuple([
      z
        .object({ sequence: z.literal(1), action: z.literal('connect'), attempts: z.literal(1) })
        .strict(),
      z
        .object({ sequence: z.literal(2), action: z.literal('tools/list'), attempts: z.literal(1) })
        .strict(),
      z
        .object({ sequence: z.literal(3), action: z.literal('tools/call'), attempts: z.literal(1) })
        .strict(),
      z
        .object({ sequence: z.literal(4), action: z.literal('close'), attempts: z.literal(1) })
        .strict()
    ]),
    sessionCount: z.literal(1),
    toolCallAttempts: z.literal(1),
    retryCount: z.literal(0),
    timeoutMs: z.literal(15_000),
    previewExternalCalls: z.literal(0),
    retention: z
      .object({
        allowedFields: z.tuple([
          z.literal('contractStatus'),
          z.literal('classificationStatus'),
          z.literal('flightCount'),
          z.literal('cabinCount'),
          z.literal('requestBinding'),
          z.literal('stringFormats'),
          z.literal('numericSemantics'),
          z.literal('dateSemantics'),
          z.literal('timeSemantics'),
          z.literal('priceSemantics'),
          z.literal('cabinStructure'),
          z.literal('stopShareSemantics'),
          z.literal('topLevelStatus'),
          z.literal('conflicts'),
          z.literal('rawResponseRetained'),
          z.literal('valueRetention'),
          z.literal('errorCode')
        ]),
        rawToolResultRetained: z.literal(false),
        valueRetention: z.literal(false),
        productEvidencePersistence: z.literal(false),
        toolCallAuditPersistence: z.literal(false),
        databaseWrites: z.literal(false),
        cacheWrites: z.literal(false),
        healthMutations: z.literal(false)
      })
      .strict(),
    productionRegistration: z
      .object({ allowlistMutation: z.literal(false), toolContractMutation: z.literal(false) })
      .strict(),
    diagnosticScope: z.literal('format-and-consistency-only'),
    contractStatus: z.literal('UNPROVEN'),
    executionEntrypoint: z.literal('tool-registry-gated-semantic-one-shot'),
    stopPolicy: z.literal('fail-closed-on-first-error'),
    approvalScope: z.literal('exact-planId-digest-operationId-only')
  })
  .strict()

export const VariflightGateR3PreviewSchema = z
  .object({
    status: z.literal('AWAITING_EXACT_APPROVAL'),
    digest: SHA256_SCHEMA,
    plan: VariflightGateR3PlanSchema
  })
  .strict()

const VariflightGateR3StoredArtifactSchema = z.discriminatedUnion('status', [
  VariflightGateR3PreviewSchema,
  z
    .object({
      status: z.literal('EXPIRED'),
      digest: SHA256_SCHEMA,
      plan: VariflightGateR3PlanSchema
    })
    .strict(),
  z
    .object({
      status: z.literal('CONSUMED'),
      consumedAt: z.string().datetime({ offset: true }),
      digest: SHA256_SCHEMA,
      plan: VariflightGateR3PlanSchema
    })
    .strict()
])

export const VariflightGateR3ClaimRequestSchema = z
  .object({
    planId: z.string().uuid(),
    digest: SHA256_SCHEMA,
    operationId: z.string().uuid()
  })
  .strict()

export type VariflightGateR3Plan = z.infer<typeof VariflightGateR3PlanSchema>
export type VariflightGateR3Preview = z.infer<typeof VariflightGateR3PreviewSchema>
export type VariflightGateR3ClaimRequest = z.infer<typeof VariflightGateR3ClaimRequestSchema>

export interface AuthorizedVariflightSemanticProbe {
  readonly plan: VariflightGateR3Plan
  readonly digest: string
  readonly [gateAuthorization]: true
}

interface PreviewOptions {
  args: VariflightFlightPriceArgs
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

export function createVariflightGateR3Preview(options: PreviewOptions): VariflightGateR3Preview {
  const now = options.now ?? new Date()
  const args = parseFlightPriceArgs(options.args)
  const plan = VariflightGateR3PlanSchema.parse({
    schemaVersion: 'variflight-gate-r3/v1',
    planId: options.planId ?? randomUUID(),
    operationId: options.operationId ?? randomUUID(),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + GATE_TTL_MS).toISOString(),
    sourceId: 'SRC_FLIGHT',
    transport: 'legacy-sse',
    endpointBinding: {
      constant: 'VARIFLIGHT_SSE_ENDPOINT',
      digest: digestString(VARIFLIGHT_SSE_ENDPOINT)
    },
    toolBinding: {
      name: VARIFLIGHT_FLIGHT_PRICE_TOOL_NAME,
      inputContractVersion: VARIFLIGHT_FLIGHT_PRICE_INPUT_CONTRACT_VERSION,
      inputContractDigest: VARIFLIGHT_FLIGHT_PRICE_INPUT_CONTRACT_DIGEST
    },
    semanticClassifierBinding: {
      version: VARIFLIGHT_SEMANTIC_CLASSIFIER_CONTRACT_VERSION,
      digest: VARIFLIGHT_SEMANTIC_CLASSIFIER_CONTRACT_DIGEST
    },
    args,
    steps: [
      { sequence: 1, action: 'connect', attempts: 1 },
      { sequence: 2, action: 'tools/list', attempts: 1 },
      { sequence: 3, action: 'tools/call', attempts: 1 },
      { sequence: 4, action: 'close', attempts: 1 }
    ],
    sessionCount: 1,
    toolCallAttempts: 1,
    retryCount: 0,
    timeoutMs: 15_000,
    previewExternalCalls: 0,
    retention: {
      allowedFields: [
        'contractStatus',
        'classificationStatus',
        'flightCount',
        'cabinCount',
        'requestBinding',
        'stringFormats',
        'numericSemantics',
        'dateSemantics',
        'timeSemantics',
        'priceSemantics',
        'cabinStructure',
        'stopShareSemantics',
        'topLevelStatus',
        'conflicts',
        'rawResponseRetained',
        'valueRetention',
        'errorCode'
      ],
      rawToolResultRetained: false,
      valueRetention: false,
      productEvidencePersistence: false,
      toolCallAuditPersistence: false,
      databaseWrites: false,
      cacheWrites: false,
      healthMutations: false
    },
    productionRegistration: { allowlistMutation: false, toolContractMutation: false },
    diagnosticScope: 'format-and-consistency-only',
    contractStatus: 'UNPROVEN',
    executionEntrypoint: 'tool-registry-gated-semantic-one-shot',
    stopPolicy: 'fail-closed-on-first-error',
    approvalScope: 'exact-planId-digest-operationId-only'
  })
  return VariflightGateR3PreviewSchema.parse({
    status: 'AWAITING_EXACT_APPROVAL',
    digest: digestValue(plan),
    plan
  })
}

export async function writeVariflightGateR3Preview(
  artifactPath: string,
  options: WritePreviewOptions
): Promise<VariflightGateR3Preview> {
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
    const preview = createVariflightGateR3Preview(options)
    await writeGateArtifactAtomically(safeArtifactPath, preview)
    return preview
  } finally {
    await releaseGateArtifactLock(lock, lockPath)
  }
}

export async function claimVariflightGateR3(
  artifactPath: string,
  input: VariflightGateR3ClaimRequest,
  options: ClaimOptions
): Promise<AuthorizedVariflightSemanticProbe> {
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
    const parsedPreview = VariflightGateR3PreviewSchema.safeParse(raw)
    if (!parsedPreview.success) {
      throw new AppError('INPUT_INVALID', `${GATE_LABEL} 文件结构不合法。`)
    }
    const preview = parsedPreview.data
    assertPreviewIntegrity(preview, request, now)
    const consumed = {
      status: 'CONSUMED',
      consumedAt: now.toISOString(),
      digest: preview.digest,
      plan: preview.plan
    }
    await writeExclusiveGateArtifact(consumedPath, consumed, GATE_LABEL)
    await writeGateArtifactAtomically(safeArtifactPath, consumed)

    const authorization: AuthorizedVariflightSemanticProbe = Object.freeze({
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

export function consumeAuthorizedVariflightSemanticProbe(
  value: unknown,
  now = new Date()
): asserts value is AuthorizedVariflightSemanticProbe {
  if (
    value === null ||
    typeof value !== 'object' ||
    !claimedAuthorizations.has(value) ||
    (value as Partial<AuthorizedVariflightSemanticProbe>)[gateAuthorization] !== true
  ) {
    throw new AppError('GATE_BLOCKED', 'VariFlight semantic probe 缺少已消费的 Gate R-3 授权。')
  }
  const authorization = value as AuthorizedVariflightSemanticProbe
  const plan = VariflightGateR3PlanSchema.parse(authorization.plan)
  if (authorization.digest !== digestValue(plan)) {
    throw new AppError('INPUT_INVALID', `${GATE_LABEL} 授权摘要不匹配。`)
  }
  assertPlanPolicy(plan, now)
  claimedAuthorizations.delete(value)
}

export function parseVariflightGateR3PreviewCliArgs(args: string[]): VariflightFlightPriceArgs {
  const values = parseCliPairs(args, ['dep-city', 'arr-city', 'dep-date'], 'preview')
  return parseFlightPriceArgs({
    dep_city: values['dep-city'],
    arr_city: values['arr-city'],
    dep_date: values['dep-date']
  })
}

export function parseVariflightGateR3ClaimCliArgs(args: string[]): VariflightGateR3ClaimRequest {
  const values = parseCliPairs(args, ['plan-id', 'digest', 'operation-id'], 'execute')
  return parseClaimRequest({
    planId: values['plan-id'],
    digest: values.digest,
    operationId: values['operation-id']
  })
}

function parseCliPairs(
  args: string[],
  allowed: string[],
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
    if (!allowed.includes(key) || key in values) {
      throw new AppError('INPUT_INVALID', `${GATE_LABEL} ${mode} 包含未知或重复参数。`)
    }
    values[key] = value
  }
  return values
}

function parseFlightPriceArgs(input: unknown): VariflightFlightPriceArgs {
  const parsed = VariflightFlightPriceArgsSchema.safeParse(input)
  if (!parsed.success) {
    throw new AppError(
      'INPUT_INVALID',
      'getFlightPriceByCities 参数必须严格包含大写三字码 dep_city、arr_city 与有效日期 dep_date。'
    )
  }
  return parsed.data
}

function parseClaimRequest(input: unknown): VariflightGateR3ClaimRequest {
  const parsed = VariflightGateR3ClaimRequestSchema.safeParse(input)
  if (!parsed.success) throw new AppError('INPUT_INVALID', `${GATE_LABEL} 执行三元组不合法。`)
  return parsed.data
}

function assertPreviewIntegrity(
  preview: VariflightGateR3Preview,
  request: VariflightGateR3ClaimRequest,
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

function assertPlanPolicy(plan: VariflightGateR3Plan, now: Date): void {
  if (plan.endpointBinding.digest !== digestString(VARIFLIGHT_SSE_ENDPOINT)) {
    throw new AppError('GATE_BLOCKED', 'VariFlight endpoint 绑定已漂移，请重新生成 Gate R-3。')
  }
  if (plan.toolBinding.inputContractDigest !== VARIFLIGHT_FLIGHT_PRICE_INPUT_CONTRACT_DIGEST) {
    throw new AppError('GATE_BLOCKED', 'VariFlight 输入契约已漂移，请重新生成 Gate R-3。')
  }
  if (plan.semanticClassifierBinding.digest !== VARIFLIGHT_SEMANTIC_CLASSIFIER_CONTRACT_DIGEST) {
    throw new AppError('GATE_BLOCKED', 'VariFlight 去值化分类器已漂移，请重新生成 Gate R-3。')
  }
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
  stored: z.infer<typeof VariflightGateR3StoredArtifactSchema>,
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
): Promise<z.infer<typeof VariflightGateR3StoredArtifactSchema> | undefined> {
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
  Extract<z.infer<typeof VariflightGateR3StoredArtifactSchema>, { status: 'CONSUMED' }> | undefined
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

function parseStoredArtifact(value: string): z.infer<typeof VariflightGateR3StoredArtifactSchema> {
  const parsed = VariflightGateR3StoredArtifactSchema.safeParse(
    parseGateJsonObject(value, GATE_LABEL)
  )
  if (!parsed.success) throw new AppError('INPUT_INVALID', `${GATE_LABEL} 旧文件结构不合法。`)
  return parsed.data
}
