import { randomUUID } from 'node:crypto'
import { open } from 'node:fs/promises'
import { z } from 'zod'
import { AppError } from '../../shared/errors'
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

const GATE_LABEL = 'VariFlight Gate R-1'
const gateAuthorization = Symbol('variflight-gate-r1-authorization')
const claimedAuthorizations = new WeakSet<object>()

export const VARIFLIGHT_GATE_R1_ARTIFACT_RELATIVE_PATH =
  '.trellis/tasks/09-01-variflight-mcp-flight-query/gate-r1-preview.json'

export const VariflightGateR1PlanSchema = z
  .object({
    schemaVersion: z.literal('variflight-gate-r1/v1'),
    planId: z.string().uuid(),
    operationId: z.string().uuid(),
    createdAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    sourceId: z.literal('SRC_FLIGHT'),
    transport: z.literal('legacy-sse'),
    endpointBinding: z
      .object({
        constant: z.literal('VARIFLIGHT_SSE_ENDPOINT'),
        digest: SHA256_SCHEMA
      })
      .strict(),
    steps: z.tuple([
      z.object({ sequence: z.literal(1), action: z.literal('connect'), attempts: z.literal(1) }),
      z.object({ sequence: z.literal(2), action: z.literal('tools/list'), attempts: z.literal(1) }),
      z.object({ sequence: z.literal(3), action: z.literal('close'), attempts: z.literal(1) })
    ]),
    sessionCount: z.literal(1),
    toolCallAttempts: z.literal(0),
    retryCount: z.literal(0),
    timeoutMs: z.literal(15_000),
    descriptorBounds: z
      .object({
        maxTools: z.literal(64),
        maxToolNameChars: z.literal(128),
        maxDescriptionChars: z.literal(4_000),
        maxInputSchemaBytes: z.literal(65_536)
      })
      .strict(),
    retention: z
      .object({
        allowedFields: z.tuple([
          z.literal('name'),
          z.literal('description'),
          z.literal('inputSchema')
        ]),
        rawToolResultRetained: z.literal(false),
        evidencePersistence: z.literal(false)
      })
      .strict(),
    stopPolicy: z.literal('fail-closed-on-first-error'),
    approvalScope: z.literal('exact-planId-digest-operationId-only')
  })
  .strict()

export const VariflightGateR1PreviewSchema = z
  .object({
    status: z.literal('AWAITING_EXACT_APPROVAL'),
    digest: SHA256_SCHEMA,
    plan: VariflightGateR1PlanSchema
  })
  .strict()

const VariflightGateR1StoredArtifactSchema = z.discriminatedUnion('status', [
  VariflightGateR1PreviewSchema,
  z
    .object({
      status: z.literal('EXPIRED'),
      digest: SHA256_SCHEMA,
      plan: VariflightGateR1PlanSchema
    })
    .strict(),
  z
    .object({
      status: z.literal('CONSUMED'),
      consumedAt: z.string().datetime({ offset: true }),
      digest: SHA256_SCHEMA,
      plan: VariflightGateR1PlanSchema
    })
    .strict()
])

export const VariflightGateR1ExecuteRequestSchema = z
  .object({
    planId: z.string().uuid(),
    digest: SHA256_SCHEMA,
    operationId: z.string().uuid()
  })
  .strict()

export type VariflightGateR1Plan = z.infer<typeof VariflightGateR1PlanSchema>
export type VariflightGateR1Preview = z.infer<typeof VariflightGateR1PreviewSchema>
export type VariflightGateR1ExecuteRequest = z.infer<typeof VariflightGateR1ExecuteRequestSchema>

export interface AuthorizedVariflightDiscovery {
  readonly plan: VariflightGateR1Plan
  readonly digest: string
  readonly [gateAuthorization]: true
}

interface ClaimOptions {
  allowedRoot: string
  now?: Date
}

interface PreviewOptions {
  now?: Date
  planId?: string
  operationId?: string
}

interface ReplacePreviewOptions extends PreviewOptions {
  allowedRoot: string
}

export function createVariflightGateR1Preview(
  options: PreviewOptions = {}
): VariflightGateR1Preview {
  const now = options.now ?? new Date()
  const plan = VariflightGateR1PlanSchema.parse({
    schemaVersion: 'variflight-gate-r1/v1',
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
    steps: [
      { sequence: 1, action: 'connect', attempts: 1 },
      { sequence: 2, action: 'tools/list', attempts: 1 },
      { sequence: 3, action: 'close', attempts: 1 }
    ],
    sessionCount: 1,
    toolCallAttempts: 0,
    retryCount: 0,
    timeoutMs: 15_000,
    descriptorBounds: {
      maxTools: 64,
      maxToolNameChars: 128,
      maxDescriptionChars: 4_000,
      maxInputSchemaBytes: 65_536
    },
    retention: {
      allowedFields: ['name', 'description', 'inputSchema'],
      rawToolResultRetained: false,
      evidencePersistence: false
    },
    stopPolicy: 'fail-closed-on-first-error',
    approvalScope: 'exact-planId-digest-operationId-only'
  })
  return VariflightGateR1PreviewSchema.parse({
    status: 'AWAITING_EXACT_APPROVAL',
    digest: digestValue(plan),
    plan
  })
}

export async function replaceVariflightGateR1Preview(
  artifactPath: string,
  options: ReplacePreviewOptions
): Promise<VariflightGateR1Preview> {
  const now = options.now ?? new Date()
  const safeArtifactPath = await assertSafeGateArtifactPath(artifactPath, options.allowedRoot, {
    expectedFileName: 'gate-r1-preview.json',
    gateLabel: GATE_LABEL
  })
  const lockPath = `${safeArtifactPath}.lock`
  let lock: Awaited<ReturnType<typeof open>> | undefined
  try {
    lock = await acquireGateArtifactLock(lockPath, GATE_LABEL)
    const stored = parseStoredArtifact(
      await readRegularGateArtifactFile(safeArtifactPath, GATE_LABEL)
    )
    if (stored.digest !== digestValue(stored.plan)) {
      throw new AppError('INPUT_INVALID', 'VariFlight Gate R-1 旧文件摘要不匹配。')
    }
    const consumedMarker = await readConsumedMarker(
      `${safeArtifactPath}.${stored.plan.operationId}.consumed`
    )
    if (consumedMarker) {
      if (
        consumedMarker.digest !== stored.digest ||
        consumedMarker.digest !== digestValue(consumedMarker.plan)
      ) {
        throw new AppError('INPUT_INVALID', 'VariFlight Gate R-1 消费记录与旧计划不匹配。')
      }
      assertReplaceableStoredArtifact(consumedMarker, now)
    } else {
      assertReplaceableStoredArtifact(stored, now)
    }
    const preview = createVariflightGateR1Preview(options)
    await writeGateArtifactAtomically(safeArtifactPath, preview)
    return preview
  } finally {
    await releaseGateArtifactLock(lock, lockPath)
  }
}

export async function claimVariflightGateR1(
  artifactPath: string,
  input: VariflightGateR1ExecuteRequest,
  options: ClaimOptions
): Promise<AuthorizedVariflightDiscovery> {
  const request = parseExecuteRequest(input)
  const now = options.now ?? new Date()
  const safeArtifactPath = await assertSafeGateArtifactPath(artifactPath, options.allowedRoot, {
    expectedFileName: 'gate-r1-preview.json',
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
      throw new AppError('INPUT_INVALID', 'VariFlight Gate R-1 已消费或不可执行。')
    }
    const parsedPreview = VariflightGateR1PreviewSchema.safeParse(raw)
    if (!parsedPreview.success) {
      throw new AppError('INPUT_INVALID', 'VariFlight Gate R-1 文件结构不合法。')
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

    const authorization: AuthorizedVariflightDiscovery = Object.freeze({
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

export function consumeAuthorizedVariflightDiscovery(
  value: unknown,
  now = new Date()
): asserts value is AuthorizedVariflightDiscovery {
  if (
    value === null ||
    typeof value !== 'object' ||
    !claimedAuthorizations.has(value) ||
    (value as Partial<AuthorizedVariflightDiscovery>)[gateAuthorization] !== true
  ) {
    throw new AppError('GATE_BLOCKED', 'VariFlight discovery 缺少已消费的 Gate R-1 授权。')
  }
  const authorization = value as AuthorizedVariflightDiscovery
  const plan = VariflightGateR1PlanSchema.parse(authorization.plan)
  if (authorization.digest !== digestValue(plan)) {
    throw new AppError('INPUT_INVALID', 'VariFlight Gate R-1 授权摘要不匹配。')
  }
  assertPlanPolicy(plan, now)
  claimedAuthorizations.delete(value)
}

export function parseVariflightDiscoveryCliArgs(args: string[]): VariflightGateR1ExecuteRequest {
  const values: Record<string, string> = {}
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]
    const value = args[index + 1]
    if (!name?.startsWith('--') || !value || value.startsWith('--')) {
      throw new AppError('INPUT_INVALID', 'VariFlight Gate R-1 命令参数不完整。')
    }
    const key = name.slice(2)
    if (!['plan-id', 'digest', 'operation-id'].includes(key) || key in values) {
      throw new AppError('INPUT_INVALID', 'VariFlight Gate R-1 命令包含未知或重复参数。')
    }
    values[key] = value
  }
  return parseExecuteRequest({
    planId: values['plan-id'],
    digest: values.digest,
    operationId: values['operation-id']
  })
}

function assertPreviewIntegrity(
  preview: VariflightGateR1Preview,
  request: VariflightGateR1ExecuteRequest,
  now: Date
): void {
  const { plan } = preview
  if (preview.digest !== digestValue(plan)) {
    throw new AppError('INPUT_INVALID', 'VariFlight Gate R-1 文件摘要与计划不匹配。')
  }
  if (plan.endpointBinding.digest !== digestString(VARIFLIGHT_SSE_ENDPOINT)) {
    throw new AppError('GATE_BLOCKED', 'VariFlight endpoint 绑定已漂移，请重新生成 Gate R-1。')
  }
  assertPlanPolicy(plan, now)
  if (
    request.planId !== plan.planId ||
    request.operationId !== plan.operationId ||
    request.digest !== preview.digest
  ) {
    throw new AppError('INPUT_INVALID', 'VariFlight Gate R-1 未获得当前三元组的精确授权。')
  }
}

function assertPlanPolicy(plan: VariflightGateR1Plan, now: Date): void {
  if (plan.endpointBinding.digest !== digestString(VARIFLIGHT_SSE_ENDPOINT)) {
    throw new AppError('GATE_BLOCKED', 'VariFlight endpoint 绑定已漂移，请重新生成 Gate R-1。')
  }
  const createdAt = Date.parse(plan.createdAt)
  const expiresAt = Date.parse(plan.expiresAt)
  if (
    createdAt > now.getTime() ||
    expiresAt - createdAt !== GATE_TTL_MS ||
    expiresAt <= now.getTime()
  ) {
    throw new AppError('GATE_BLOCKED', 'VariFlight Gate R-1 尚未生效、已过期或有效期不合法。')
  }
}

function assertReplaceableStoredArtifact(
  stored: z.infer<typeof VariflightGateR1StoredArtifactSchema>,
  now: Date
): void {
  const expiresAt = Date.parse(stored.plan.expiresAt)
  if (stored.status === 'AWAITING_EXACT_APPROVAL') {
    if (expiresAt > now.getTime()) {
      throw new AppError('GATE_BLOCKED', '当前 VariFlight Gate R-1 尚未过期，不得覆盖。')
    }
    return
  }
  if (stored.status === 'EXPIRED') {
    if (expiresAt > now.getTime()) {
      throw new AppError('INPUT_INVALID', 'VariFlight Gate R-1 的 EXPIRED 状态与有效期冲突。')
    }
    return
  }
  const consumedAt = Date.parse(stored.consumedAt)
  if (
    consumedAt < Date.parse(stored.plan.createdAt) ||
    consumedAt > now.getTime() ||
    consumedAt >= expiresAt
  ) {
    throw new AppError('INPUT_INVALID', 'VariFlight Gate R-1 的 CONSUMED 状态时间不合法。')
  }
}

function parseExecuteRequest(input: unknown): VariflightGateR1ExecuteRequest {
  const parsed = VariflightGateR1ExecuteRequestSchema.safeParse(input)
  if (!parsed.success) {
    throw new AppError('INPUT_INVALID', 'VariFlight Gate R-1 执行三元组不合法。')
  }
  return parsed.data
}

async function readConsumedMarker(
  consumedPath: string
): Promise<
  Extract<z.infer<typeof VariflightGateR1StoredArtifactSchema>, { status: 'CONSUMED' }> | undefined
> {
  try {
    const stored = parseStoredArtifact(await readRegularGateArtifactFile(consumedPath, GATE_LABEL))
    if (stored.status !== 'CONSUMED') {
      throw new AppError('INPUT_INVALID', 'VariFlight Gate R-1 消费记录结构不合法。')
    }
    return stored
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return undefined
    throw error
  }
}

function parseStoredArtifact(value: string): z.infer<typeof VariflightGateR1StoredArtifactSchema> {
  const parsed = VariflightGateR1StoredArtifactSchema.safeParse(
    parseGateJsonObject(value, GATE_LABEL)
  )
  if (!parsed.success) {
    throw new AppError('INPUT_INVALID', 'VariFlight Gate R-1 旧文件结构不合法。')
  }
  return parsed.data
}
