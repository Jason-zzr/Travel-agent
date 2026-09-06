import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppPaths } from './paths'

const ALLOWED_CONTEXT_KEYS = new Set([
  'sessionId',
  'sourceId',
  'toolName',
  'errorCode',
  'lineNumber',
  'durationMs',
  'claimId',
  'count',
  'missing',
  'keys'
])

type LogPrimitive = string | number | boolean | null

export function redactLogContext(input: Record<string, unknown>): Record<string, LogPrimitive> {
  const output: Record<string, LogPrimitive> = {}
  for (const [key, value] of Object.entries(input)) {
    if (!ALLOWED_CONTEXT_KEYS.has(key)) continue
    if (value === null) output[key] = null
    if (typeof value === 'string') output[key] = value
    if (typeof value === 'number') output[key] = value
    if (typeof value === 'boolean') output[key] = value
  }
  return output
}

export class AppLogger {
  private queue = Promise.resolve()

  constructor(private readonly paths: AppPaths) {}

  warn(code: string, message: string, context: Record<string, unknown> = {}): void {
    const record = {
      timestamp: new Date().toISOString(),
      level: 'warn',
      code,
      message,
      context: redactLogContext(context)
    }
    this.queue = this.queue.then(async () => {
      await mkdir(this.paths.logs, { recursive: true })
      const date = record.timestamp.slice(0, 10)
      await appendFile(
        join(this.paths.logs, `app-${date}.jsonl`),
        `${JSON.stringify(record)}\n`,
        'utf8'
      )
    })
  }

  close(): Promise<void> {
    return this.queue
  }
}
