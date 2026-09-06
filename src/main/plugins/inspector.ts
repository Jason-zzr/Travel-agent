import type Database from 'better-sqlite3'
import type { Context, Plugin } from 'cordis'
import {
  InspectorModelCallSchema,
  InspectorQuerySchema,
  InspectorSnapshotSchema,
  type InspectorQuery,
  type InspectorSnapshot
} from '../../shared/schema/d7'

export interface InspectorConfig {
  database: Database.Database
}

interface ModelCallRow {
  call_id: string
  session_id: string
  role: string
  provider: string
  model: string
  tokens_in: number
  tokens_out: number
  cost_cents: number
  latency_ms: number
  ok: number
  created_at: string
}

export class InspectorService {
  private eventCount = 0

  constructor(
    private readonly ctx: Context,
    private readonly config?: InspectorConfig
  ) {
    ctx.on('event/appended', () => {
      this.eventCount += 1
    })
  }

  get appendedEvents(): number {
    return this.eventCount
  }

  async snapshot(input: InspectorQuery): Promise<InspectorSnapshot> {
    const query = InspectorQuerySchema.parse(input)
    const withinRange = (createdAt: string): boolean =>
      (!query.from || createdAt >= query.from) && (!query.to || createdAt <= query.to)
    const events = (await this.ctx.eventLog.read(query.sessionId))
      .filter((event) => withinRange(event.timestamp))
      .slice(-query.limit)
      .reverse()
      .map((event) => ({
        eventId: event.eventId,
        sessionId: event.sessionId,
        seq: event.seq,
        type: event.type,
        timestamp: event.timestamp
      }))
    const toolCalls = this.ctx.tools
      .listToolCalls(query.sessionId, query.limit)
      .filter((call) => withinRange(call.createdAt))
    const blockedTools = this.ctx.tools
      .listBlockedTools(query.limit)
      .filter((call) => withinRange(call.createdAt))
    const modelCalls = this.listModelCalls(query).filter((call) => withinRange(call.createdAt))
    const sourceHealth = await this.ctx.tools.listSourceHealth()
    return InspectorSnapshotSchema.parse({
      query,
      events,
      toolCalls,
      modelCalls,
      blockedTools,
      sourceHealth
    })
  }

  private listModelCalls(query: InspectorQuery): InspectorSnapshot['modelCalls'] {
    if (!this.config) return []
    const rows = this.config.database
      .prepare(
        `SELECT call_id, session_id, role, provider, model, tokens_in, tokens_out,
           cost_cents, latency_ms, ok, created_at
         FROM model_calls WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`
      )
      .all(query.sessionId, query.limit) as ModelCallRow[]
    return rows.map((row) =>
      InspectorModelCallSchema.parse({
        callId: row.call_id,
        sessionId: row.session_id,
        role: row.role,
        provider: row.provider,
        model: row.model,
        tokensIn: row.tokens_in,
        tokensOut: row.tokens_out,
        costCents: row.cost_cents,
        latencyMs: row.latency_ms,
        ok: row.ok === 1,
        createdAt: row.created_at
      })
    )
  }
}

declare module 'cordis' {
  interface Context {
    inspector: InspectorService
  }
}

export const inspectorPlugin: Plugin.Function<Context, InspectorConfig | undefined> = (
  ctx,
  config
) => {
  ctx.set('inspector', new InspectorService(ctx, config))
}
inspectorPlugin.inject = ['eventLog', 'tools']
