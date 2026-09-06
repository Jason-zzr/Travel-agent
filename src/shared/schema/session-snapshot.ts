import { z } from 'zod'
import { SessionEventSchema } from './session-event'
import { TravelStateSchema } from './travel-state'

export const SessionSnapshotSchema = z
  .object({
    formatVersion: z.literal(1),
    appVersion: z.string().trim().min(1).max(40),
    sessionId: z.string().min(1),
    seq: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    state: TravelStateSchema,
    events: z.array(SessionEventSchema)
  })
  .strict()
  .superRefine((value, context) => {
    if (value.state.sessionId !== value.sessionId || value.state.lastSeq !== value.seq) {
      context.addIssue({ code: 'custom', message: 'snapshot state identity does not match header' })
    }
    if (value.events.length !== value.seq || (value.events.at(-1)?.seq ?? 0) !== value.seq) {
      context.addIssue({ code: 'custom', message: 'snapshot events do not end at snapshot seq' })
    }
    if (value.events.some((event) => event.sessionId !== value.sessionId)) {
      context.addIssue({ code: 'custom', message: 'snapshot contains another session' })
    }
  })

export type SessionSnapshot = z.infer<typeof SessionSnapshotSchema>
