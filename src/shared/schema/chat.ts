import { z } from 'zod'
import { SerializedAppErrorSchema } from '../errors'
import { EnvelopeAssessmentSchema, EnvelopeComparisonSchema } from './envelope'
import { ConfirmationCardSchema, TravelBasicsSchema } from './interview'
import { TravelStageSchema } from './travel-state'

export const SessionSummarySchema = z.object({
  sessionId: z.string().min(1),
  title: z.string().min(1).nullable(),
  stage: TravelStageSchema,
  linkedSessionGroup: z.string().min(1).nullable(),
  splitIndex: z.number().int().nonnegative().nullable()
})
export type SessionSummary = z.infer<typeof SessionSummarySchema>

export const UsageTotalSchema = z.object({
  provider: z.string().min(1),
  currency: z.string().nullable(),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  costMinor: z.number().int().nonnegative().nullable()
})
export type UsageTotal = z.infer<typeof UsageTotalSchema>

export const ChatTurnOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('QUESTION'),
    assistantText: z.string().min(1),
    nextQuestion: z.string().min(1),
    turnNumber: z.number().int().min(1).max(5)
  }),
  z.object({
    kind: z.literal('CONFIRMATION'),
    assistantText: z.string().min(1),
    card: ConfirmationCardSchema,
    assessment: EnvelopeAssessmentSchema,
    turnNumber: z.number().int().min(1).max(5)
  }),
  z.object({
    kind: z.literal('OUT_OF_ENVELOPE'),
    assistantText: z.string().min(1),
    error: SerializedAppErrorSchema,
    comparison: EnvelopeComparisonSchema,
    turnNumber: z.number().int().min(1).max(5)
  }),
  z.object({
    kind: z.literal('BLOCKED'),
    assistantText: z.string().min(1),
    error: SerializedAppErrorSchema,
    dependency: z.string().min(1).nullable()
  })
])
export type ChatTurnOutcome = z.infer<typeof ChatTurnOutcomeSchema>

export const SessionCreateRequestSchema = z.object({
  title: z.string().trim().min(1).max(120).nullable().default(null)
})
export const ChatSubmitRequestSchema = z.object({
  sessionId: z.string().min(1),
  text: z.string().trim().min(1).max(4000)
})
export const ConfirmationUpdateRequestSchema = z.object({
  sessionId: z.string().min(1),
  basics: TravelBasicsSchema
})
export const ConfirmationConfirmRequestSchema = z.object({ sessionId: z.string().min(1) })
export const EnvelopeChoiceRequestSchema = z.object({
  sessionId: z.string().min(1),
  decision: z.enum(['SPLIT', 'ADJUST']),
  rationale: z.string().trim().min(1).max(500),
  retainedDestinationCities: z.array(z.string().trim().min(1)).max(1).default([])
})

export type SessionCreateRequest = z.infer<typeof SessionCreateRequestSchema>
export type ChatSubmitRequest = z.infer<typeof ChatSubmitRequestSchema>
export type ConfirmationUpdateRequest = z.infer<typeof ConfirmationUpdateRequestSchema>
export type ConfirmationConfirmRequest = z.infer<typeof ConfirmationConfirmRequestSchema>
export type EnvelopeChoiceRequest = z.infer<typeof EnvelopeChoiceRequestSchema>
