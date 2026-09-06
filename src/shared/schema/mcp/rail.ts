import { z } from 'zod'
import { firstMcpText, McpTextToolResultSchema } from './common'

export const RailToolResultSchema = McpTextToolResultSchema.transform((result) =>
  firstMcpText(result).trimStart().startsWith('Error:') ? { ...result, isError: true } : result
)

export type RailToolResult = z.infer<typeof RailToolResultSchema>

export const RailCurrentDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const RailClockSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
export const RailTicketSchema = z.object({
  train_no: z.string().min(1),
  start_train_code: z.string().trim().min(1).optional(),
  start_time: RailClockSchema,
  arrive_time: RailClockSchema
})
export const RailTicketsSchema = z.array(RailTicketSchema)

export function visibleRailTrainCode(ticket: z.infer<typeof RailTicketSchema>): string {
  return ticket.start_train_code ?? ticket.train_no
}

export const RailTicketDiscoverySourceRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    direction: z.enum(['OUTBOUND', 'RETURN']),
    date: RailCurrentDateSchema,
    fromStation: z.string().trim().min(1).max(120),
    toStation: z.string().trim().min(1).max(120)
  })
  .strict()
export type RailTicketDiscoverySourceRequest = z.infer<
  typeof RailTicketDiscoverySourceRequestSchema
>

export const RailJourneySourceRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    candidateId: z.string().trim().min(1).max(200),
    direction: z.enum(['OUTBOUND', 'RETURN']),
    trainNo: z.string().trim().min(1).max(40),
    date: RailCurrentDateSchema,
    fromStation: z.string().trim().min(1).max(120),
    toStation: z.string().trim().min(1).max(120)
  })
  .strict()
export type RailJourneySourceRequest = z.infer<typeof RailJourneySourceRequestSchema>

export const RailJourneyClaimValueSchema = z
  .object({
    candidateId: z.string().min(1),
    direction: z.enum(['OUTBOUND', 'RETURN']),
    title: z.string().min(1),
    label: z.string().min(1),
    trainNo: z.string().min(1),
    serviceDate: RailCurrentDateSchema,
    departureTime: RailClockSchema,
    arrivalTime: RailClockSchema,
    from: z.string().min(1),
    to: z.string().min(1),
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }).nullable(),
    durationMinutes: z.number().int().nonnegative().nullable(),
    costCents: z.null(),
    seatClass: z.null(),
    waitMinutes: z.null()
  })
  .strict()
export type RailJourneyClaimValue = z.infer<typeof RailJourneyClaimValueSchema>

export function normalizeRailJourney(
  ticket: z.infer<typeof RailTicketSchema>,
  input: RailJourneySourceRequest
): RailJourneyClaimValue {
  const trainNo = visibleRailTrainCode(ticket)
  const departureMinutes = clockMinutes(ticket.start_time)
  const arrivalMinutes = clockMinutes(ticket.arrive_time)
  const sameDayArrival = arrivalMinutes >= departureMinutes
  return RailJourneyClaimValueSchema.parse({
    candidateId: input.candidateId,
    direction: input.direction,
    title: `${input.fromStation}→${input.toStation} ${trainNo}`,
    label: `${trainNo} 铁路段`,
    trainNo,
    serviceDate: input.date,
    departureTime: ticket.start_time,
    arrivalTime: ticket.arrive_time,
    from: input.fromStation,
    to: input.toStation,
    startAt: `${input.date}T${ticket.start_time}:00+08:00`,
    endAt: sameDayArrival ? `${input.date}T${ticket.arrive_time}:00+08:00` : null,
    durationMinutes: sameDayArrival ? arrivalMinutes - departureMinutes : null,
    costCents: null,
    seatClass: null,
    waitMinutes: null
  })
}

function clockMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number)
  return (hours ?? 0) * 60 + (minutes ?? 0)
}

export const RailFixtureSchema = z.object({
  capturedAt: z.string().datetime(),
  package: z.literal('12306-mcp@0.3.10'),
  tool: z.string().min(1),
  arguments: z.record(z.unknown()),
  result: RailToolResultSchema
})
