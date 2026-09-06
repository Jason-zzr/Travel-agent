import { createHash, randomUUID } from 'node:crypto'
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { z } from 'zod'
import { AppError } from '../../shared/errors'

export const SHA256_SCHEMA = z.string().regex(/^sha256:[a-f0-9]{64}$/)
export const GATE_TTL_MS = 30 * 60 * 1000

interface SafeArtifactPathOptions {
  allowMissing?: boolean
  expectedFileName: string
  gateLabel: string
}

export async function assertSafeGateArtifactPath(
  artifactPath: string,
  allowedRoot: string,
  options: SafeArtifactPathOptions
): Promise<string> {
  const resolvedRoot = await realpath(resolve(allowedRoot))
  const resolvedArtifact = resolve(artifactPath)
  const pathFromRoot = relative(resolvedRoot, resolvedArtifact)
  if (pathFromRoot.startsWith('..') || resolve(resolvedRoot, pathFromRoot) !== resolvedArtifact) {
    throw new AppError('INPUT_INVALID', `${options.gateLabel} 文件不在允许的工作区内。`)
  }
  if (resolvedArtifact.split(/[\\/]/).at(-1) !== options.expectedFileName) {
    throw new AppError('INPUT_INVALID', `${options.gateLabel} 文件名不合法。`)
  }
  const resolvedParent = await realpath(dirname(resolvedArtifact))
  if (resolvedParent !== dirname(resolvedArtifact)) {
    throw new AppError('INPUT_INVALID', `${options.gateLabel} 父目录不得经过符号链接。`)
  }
  try {
    const artifactStat = await lstat(resolvedArtifact)
    if (!artifactStat.isFile() || artifactStat.isSymbolicLink()) {
      throw new AppError('INPUT_INVALID', `${options.gateLabel} 必须是普通文件。`)
    }
  } catch (error) {
    if (options.allowMissing && isNodeErrorCode(error, 'ENOENT')) return resolvedArtifact
    throw error
  }
  return resolvedArtifact
}

export async function readRegularGateArtifactFile(
  artifactPath: string,
  gateLabel: string
): Promise<string> {
  const artifactHandle = await open(artifactPath, 'r')
  try {
    const [handleStat, pathStat] = await Promise.all([artifactHandle.stat(), lstat(artifactPath)])
    if (
      !handleStat.isFile() ||
      !pathStat.isFile() ||
      pathStat.isSymbolicLink() ||
      handleStat.dev !== pathStat.dev ||
      handleStat.ino !== pathStat.ino
    ) {
      throw new AppError('INPUT_INVALID', `${gateLabel} 文件在读取前发生替换。`)
    }
    return await artifactHandle.readFile('utf8')
  } finally {
    await artifactHandle.close()
  }
}

export async function writeGateArtifactAtomically(
  artifactPath: string,
  value: unknown
): Promise<void> {
  await assertGateParentPathStable(artifactPath)
  const temporaryPath = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`
  let temporaryHandle: Awaited<ReturnType<typeof open>> | undefined
  try {
    temporaryHandle = await open(temporaryPath, 'wx', 0o600)
    await assertOpenHandleMatchesPath(temporaryHandle, temporaryPath)
    await assertGateParentPathStable(artifactPath)
    await temporaryHandle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await temporaryHandle.sync()
    await temporaryHandle.close()
    temporaryHandle = undefined
    await assertGateParentPathStable(artifactPath)
    await rename(temporaryPath, artifactPath)
  } finally {
    await temporaryHandle?.close().catch(() => undefined)
    await unlink(temporaryPath).catch(() => undefined)
  }
}

export async function writeExclusiveGateArtifact(
  artifactPath: string,
  value: unknown,
  gateLabel: string
): Promise<void> {
  await assertGateParentPathStable(artifactPath, gateLabel)
  const artifactHandle = await open(artifactPath, 'wx', 0o600)
  try {
    await assertOpenHandleMatchesPath(artifactHandle, artifactPath, gateLabel)
    await assertGateParentPathStable(artifactPath, gateLabel)
    await artifactHandle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await artifactHandle.sync()
  } finally {
    await artifactHandle.close()
  }
}

export async function acquireGateArtifactLock(
  lockPath: string,
  gateLabel: string
): Promise<Awaited<ReturnType<typeof open>>> {
  try {
    return await open(lockPath, 'wx')
  } catch (error) {
    if (isNodeErrorCode(error, 'EEXIST')) {
      throw new AppError('GATE_BLOCKED', `${gateLabel} 正在被另一个执行占用。`)
    }
    throw error
  }
}

export async function releaseGateArtifactLock(
  lock: Awaited<ReturnType<typeof open>> | undefined,
  lockPath: string
): Promise<void> {
  await lock?.close()
  if (lock) await unlink(lockPath).catch(() => undefined)
}

export async function assertGateNotConsumed(
  consumedPath: string,
  gateLabel: string
): Promise<void> {
  try {
    await lstat(consumedPath)
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return
    throw error
  }
  throw new AppError('INPUT_INVALID', `${gateLabel} 已消费或不可执行。`)
}

export function parseGateJsonObject(value: string, gateLabel: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Normalize malformed local approval artifacts to one fail-closed error.
  }
  throw new AppError('INPUT_INVALID', `${gateLabel} 文件不是有效 JSON 对象。`)
}

export function digestValue(value: unknown): string {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(canonicalValue(value)))
    .digest('hex')}`
}

export function digestString(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value)
    for (const item of Object.values(value)) deepFreeze(item)
  }
  return value
}

export function isNodeErrorCode(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException).code === code
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)])
    )
  }
  return value
}

async function assertGateParentPathStable(
  artifactPath: string,
  gateLabel = 'Gate artifact'
): Promise<void> {
  const expectedParent = dirname(resolve(artifactPath))
  if ((await realpath(expectedParent)) !== expectedParent) {
    throw new AppError('INPUT_INVALID', `${gateLabel} 父目录在写入前发生替换。`)
  }
}

async function assertOpenHandleMatchesPath(
  artifactHandle: Awaited<ReturnType<typeof open>>,
  artifactPath: string,
  gateLabel = 'Gate artifact'
): Promise<void> {
  const [handleStat, pathStat] = await Promise.all([artifactHandle.stat(), lstat(artifactPath)])
  if (
    !handleStat.isFile() ||
    !pathStat.isFile() ||
    pathStat.isSymbolicLink() ||
    handleStat.dev !== pathStat.dev ||
    handleStat.ino !== pathStat.ino
  ) {
    throw new AppError('INPUT_INVALID', `${gateLabel} 文件在写入前发生替换。`)
  }
}
