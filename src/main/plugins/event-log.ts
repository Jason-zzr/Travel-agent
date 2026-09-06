import { createReadStream } from 'node:fs'
import { mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createInterface } from 'node:readline'
import type { Context, Plugin } from 'cordis'
import { ulid } from 'ulid'
import { AppError } from '../../shared/errors'
import {
  SessionEventDraftSchema,
  SessionEventSchema,
  type SessionEvent,
  type SessionEventDraft
} from '../../shared/schema/session-event'
import { SessionSnapshotSchema, type SessionSnapshot } from '../../shared/schema/session-snapshot'
import { sessionEventLogPath, sessionSnapshotPath, type AppPaths } from '../paths'

const SNAPSHOT_APP_VERSION = '1.0.0'

export interface EventLogConfig {
  paths: AppPaths
  warn?: (message: string) => void
  openFile?: EventLogOpenFile
}

export interface EventLogAppendHandle {
  stat(): Promise<{ size: number }>
  writeFile(data: string, encoding: 'utf8'): Promise<void>
  sync(): Promise<void>
  truncate(length: number): Promise<void>
  close(): Promise<void>
}

export type EventLogOpenFile = (path: string, flags: 'a' | 'r+') => Promise<EventLogAppendHandle>

export class EventLogService {
  private readonly nextSequence = new Map<string, number>()
  private readonly queues = new Map<string, Promise<void>>()
  private readonly openFile: EventLogOpenFile

  constructor(private readonly config: EventLogConfig) {
    this.openFile = config.openFile ?? ((path, flags) => open(path, flags))
  }

  async append(input: SessionEventDraft): Promise<SessionEvent> {
    const draft = SessionEventDraftSchema.parse(input)
    const previous = this.queues.get(draft.sessionId) ?? Promise.resolve()
    const operation = previous.then(() => this.appendNow(draft))
    this.queues.set(
      draft.sessionId,
      operation.then(
        () => undefined,
        () => undefined
      )
    )
    return operation
  }

  async ensurePlanned(input: SessionEvent): Promise<SessionEvent> {
    const planned = SessionEventSchema.parse(input)
    const previous = this.queues.get(planned.sessionId) ?? Promise.resolve()
    const operation = previous.then(() => this.ensurePlannedNow(planned))
    this.queues.set(
      planned.sessionId,
      operation.then(
        () => undefined,
        () => undefined
      )
    )
    return operation
  }

  async read(sessionId: string): Promise<SessionEvent[]> {
    const path = sessionEventLogPath(this.config.paths, sessionId)
    let hasTrailingNewline: boolean
    try {
      hasTrailingNewline = await fileEndsWithNewline(path)
    } catch (error) {
      if (isMissingFile(error)) return []
      throw error
    }

    const events: SessionEvent[] = []
    const reader = createInterface({ input: createReadStream(path), crlfDelay: Infinity })
    let pendingLine: string | undefined
    let lineNumber = 0

    const consume = (line: string, isFinal: boolean): void => {
      lineNumber += 1
      if (!line.trim()) {
        throw new AppError('EVENT_LOG_CORRUPT', `会话 ${sessionId} 的第 ${lineNumber} 行为空。`)
      }
      let raw: unknown
      try {
        raw = JSON.parse(line)
      } catch (error) {
        const isMalformedFinalPartial = isFinal && !hasTrailingNewline && isTruncatedJson(error)
        if (isMalformedFinalPartial) {
          this.config.warn?.(`已忽略会话 ${sessionId} 的最后一条不完整 JSONL 记录。`)
          return
        }
        throw new AppError('EVENT_LOG_CORRUPT', `会话 ${sessionId} 的第 ${lineNumber} 行损坏。`, {
          cause: error
        })
      }

      let event: SessionEvent
      try {
        event = SessionEventSchema.parse(raw)
      } catch (error) {
        throw new AppError(
          'EVENT_LOG_CORRUPT',
          `会话 ${sessionId} 的第 ${lineNumber} 行不符合事件 schema。`,
          { cause: error }
        )
      }
      const expected = events.length + 1
      if (event.seq !== expected) {
        throw new AppError(
          'EVENT_SEQUENCE_GAP',
          `会话 ${sessionId} 的事件序号应为 ${expected}，实际为 ${event.seq}。`
        )
      }
      events.push(event)
    }

    for await (const line of reader) {
      if (pendingLine !== undefined) consume(pendingLine, false)
      pendingLine = line
    }
    if (pendingLine !== undefined) consume(pendingLine, true)
    return events
  }

  async listSessionIds(): Promise<string[]> {
    try {
      const entries = await readdir(this.config.paths.sessions, { withFileTypes: true })
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    } catch (error) {
      if (isMissingFile(error)) return []
      throw error
    }
  }

  async writeSnapshot(state: SessionSnapshot['state']): Promise<SessionSnapshot> {
    const events = await this.read(state.sessionId)
    const snapshot = SessionSnapshotSchema.parse({
      formatVersion: 1,
      appVersion: SNAPSHOT_APP_VERSION,
      sessionId: state.sessionId,
      seq: state.lastSeq,
      createdAt: new Date().toISOString(),
      state,
      events: events.slice(0, state.lastSeq)
    })
    const path = sessionSnapshotPath(this.config.paths, state.sessionId)
    const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`
    await mkdir(dirname(path), { recursive: true })
    const handle = await open(temporaryPath, 'wx')
    let closed = false
    try {
      await handle.writeFile(`${JSON.stringify(snapshot)}\n`, 'utf8')
      await handle.sync()
      await handle.close()
      closed = true
      await rename(temporaryPath, path)
    } catch (error) {
      if (!closed) await handle.close()
      await unlink(temporaryPath).catch(() => undefined)
      throw error
    }
    return snapshot
  }

  async readSnapshot(sessionId: string): Promise<SessionSnapshot | null> {
    try {
      const raw = JSON.parse(
        await readFile(sessionSnapshotPath(this.config.paths, sessionId), 'utf8')
      )
      const snapshot = SessionSnapshotSchema.parse(raw)
      if (snapshot.appVersion !== SNAPSHOT_APP_VERSION || snapshot.sessionId !== sessionId) {
        this.config.warn?.(`已忽略会话 ${sessionId} 的不兼容快照。`)
        return null
      }
      return snapshot
    } catch (error) {
      if (!isMissingFile(error)) this.config.warn?.(`已忽略会话 ${sessionId} 的损坏快照。`)
      return null
    }
  }

  async close(): Promise<void> {
    await Promise.all(this.queues.values())
  }

  private async appendNow(draft: SessionEventDraft): Promise<SessionEvent> {
    const cached = this.nextSequence.get(draft.sessionId)
    const next = cached ?? (await this.read(draft.sessionId)).length + 1
    const event = SessionEventSchema.parse({
      ...draft,
      eventId: ulid(),
      seq: next,
      timestamp: new Date().toISOString()
    })
    const path = sessionEventLogPath(this.config.paths, draft.sessionId)
    await this.appendLine(path, `${JSON.stringify(event)}\n`)
    this.nextSequence.set(draft.sessionId, next + 1)
    return event
  }

  private async ensurePlannedNow(planned: SessionEvent): Promise<SessionEvent> {
    const existing = await this.read(planned.sessionId)
    const sameId = existing.find((event) => event.eventId === planned.eventId)
    if (sameId) {
      if (JSON.stringify(sameId) !== JSON.stringify(planned)) {
        throw new AppError(
          'INTERNAL_INVARIANT_VIOLATED',
          `计划事件 ${planned.eventId} 已存在但内容不一致。`
        )
      }
      return sameId
    }
    if (planned.seq !== existing.length + 1) {
      throw new AppError(
        'EVENT_SEQUENCE_GAP',
        `计划事件 ${planned.eventId} 的序号与日志尾部不一致。`
      )
    }
    const path = sessionEventLogPath(this.config.paths, planned.sessionId)
    await this.appendLine(path, `${JSON.stringify(planned)}\n`)
    this.nextSequence.set(planned.sessionId, planned.seq + 1)
    return planned
  }

  private async appendLine(path: string, line: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    const handle = await this.openFile(path, 'a')
    let closed = false
    const closeAppendHandle = async (): Promise<void> => {
      if (closed) return
      closed = true
      await handle.close()
    }

    try {
      const { size: previousSize } = await handle.stat()
      try {
        await handle.writeFile(line, 'utf8')
        await handle.sync()
      } catch (error) {
        try {
          await closeAppendHandle()
          await this.rollbackAppend(path, previousSize)
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], `无法回滚事件日志追加：${path}`)
        }
        throw error
      }
    } finally {
      await closeAppendHandle()
    }
  }

  private async rollbackAppend(path: string, size: number): Promise<void> {
    const handle = await this.openFile(path, 'r+')
    try {
      await handle.truncate(size)
      await handle.sync()
    } finally {
      await handle.close()
    }
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function fileEndsWithNewline(path: string): Promise<boolean> {
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()
    if (size === 0) return false
    const lastByte = Buffer.allocUnsafe(1)
    await handle.read(lastByte, 0, 1, size - 1)
    return lastByte[0] === 0x0a
  } finally {
    await handle.close()
  }
}

function isTruncatedJson(error: unknown): boolean {
  return (
    error instanceof SyntaxError &&
    /unexpected end|unterminated string|unterminated fractional number/i.test(error.message)
  )
}

declare module 'cordis' {
  interface Context {
    eventLog: EventLogService
  }
}

export const eventLogPlugin: Plugin.Function<Context, EventLogConfig> = (ctx, config) => {
  const service = new EventLogService(config)
  ctx.set('eventLog', service)
  ctx.on('dispose', () => service.close())
}

eventLogPlugin.inject = []
