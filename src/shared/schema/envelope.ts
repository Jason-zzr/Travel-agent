import { z } from 'zod'
import { TravelBasicsSchema } from './interview'

export const EnvelopeDimensionSchema = z.enum([
  'ORIGIN_COUNT',
  'DESTINATION_COUNT',
  'TRAVELER_COUNT',
  'CHILD_COUNT',
  'OLDER_ADULT_COUNT',
  'DURATION',
  'STAY_SEGMENTS'
])

export const EnvelopeViolationSchema = z.object({
  dimension: EnvelopeDimensionSchema,
  actual: z.number().nonnegative(),
  minimum: z.number().nonnegative().nullable().default(null),
  maximum: z.number().positive().nullable().default(null),
  message: z.string().trim().min(1).max(200)
})
export type EnvelopeViolation = z.infer<typeof EnvelopeViolationSchema>

export const EnvelopeAssessmentSchema = z.object({
  withinEnvelope: z.boolean(),
  violations: z.array(EnvelopeViolationSchema),
  canSplit: z.boolean()
})
export type EnvelopeAssessment = z.infer<typeof EnvelopeAssessmentSchema>

export const EnvelopeDecisionSchema = z.enum(['CONTINUE', 'ADJUST', 'SPLIT'])
export type EnvelopeDecision = z.infer<typeof EnvelopeDecisionSchema>

export const EnvelopeOptionSchema = z.object({
  id: z.enum(['SPLIT', 'SHRINK', 'STOP']),
  gains: z.string().trim().min(1).max(300),
  losses: z.string().trim().min(1).max(300),
  manualBurden: z.string().trim().min(1).max(300),
  qualityDifference: z.string().trim().min(1).max(300)
})
export type EnvelopeOption = z.infer<typeof EnvelopeOptionSchema>

export const EnvelopeComparisonSchema = z.object({
  assessment: EnvelopeAssessmentSchema,
  options: z.array(EnvelopeOptionSchema).min(2).max(3)
})
export type EnvelopeComparison = z.infer<typeof EnvelopeComparisonSchema>

export const SplitChildPlanSchema = z.object({
  sessionId: z.string().min(1),
  splitIndex: z.number().int().nonnegative(),
  sessionCreatedEventId: z.string().min(1),
  createdAt: z.string().datetime(),
  title: z.string().trim().min(1).max(120),
  destinationCities: z.array(z.string().trim().min(1)).min(1),
  basics: TravelBasicsSchema,
  handoff: z.string().trim().min(1).max(300).nullable().default(null)
})
export type SplitChildPlan = z.infer<typeof SplitChildPlanSchema>

export const SplitPlanSchema = z
  .object({
    version: z.literal(1),
    transactionId: z.string().min(1),
    linkedSessionGroup: z.string().min(1),
    expectedCount: z.number().int().min(2).max(6),
    decisionId: z.string().min(1),
    rationale: z.string().trim().min(1).max(500),
    decisionEventId: z.string().min(1),
    decisionCreatedAt: z.string().datetime(),
    children: z.array(SplitChildPlanSchema).min(2).max(6)
  })
  .superRefine((value, context) => {
    if (value.expectedCount !== value.children.length) {
      context.addIssue({ code: 'custom', message: 'expectedCount must match child count' })
    }
    const indexes = value.children.map((child) => child.splitIndex).sort((a, b) => a - b)
    if (indexes.some((index, offset) => index !== offset + 1)) {
      context.addIssue({ code: 'custom', message: 'split indexes must be contiguous from one' })
    }
  })
export type SplitPlan = z.infer<typeof SplitPlanSchema>
