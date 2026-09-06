import type { Context, Plugin } from 'cordis'
import type { TravelState } from '../../shared/schema/travel-state'
import { SessionSummarySchema, type SessionSummary } from '../../shared/schema/chat'

export class SessionService {
  constructor(private readonly ctx: Context) {}

  getMeta(sessionId: string): TravelState | undefined {
    return this.ctx.travelState.get(sessionId)
  }

  list(): SessionSummary[] {
    return this.ctx.travelState.list().map((state) =>
      SessionSummarySchema.parse({
        sessionId: state.sessionId,
        title: state.title,
        stage: state.stage,
        linkedSessionGroup: state.linkedSessionGroup,
        splitIndex: state.splitIndex
      })
    )
  }
}

declare module 'cordis' {
  interface Context {
    session: SessionService
  }
}

export const sessionPlugin: Plugin.Function<Context, undefined> = (ctx) => {
  ctx.set('session', new SessionService(ctx))
}
sessionPlugin.inject = ['eventLog', 'travelState']
