import { z } from 'zod'
import { EnvelopeAssessmentSchema, EnvelopeDecisionSchema, SplitPlanSchema } from './envelope'
import { EvidenceClaimSchema } from './evidence'
import { TravelBasicsSchema } from './interview'
import { TravelStageSchema } from './travel-state'
import {
  ConflictResolutionSchema,
  AttractionRankingSchema,
  DestinationCandidateSchema,
  LeadDispositionSchema,
  ManualResearchSummarySchema,
  RouteNodeResearchScopeSchema,
  RouteNodeResearchSummarySchema,
  ResearchEntitySchema,
  SourceResearchFailureSchema,
  XhsSampleSummarySchema
} from './d4'
import {
  BoundaryAnchorSchema,
  D5DateSchema,
  D5SourceOutcomeSchema,
  DaySkeletonSchema,
  StayCandidateSchema,
  StaySegmentSchema,
  TransportCandidateSchema
} from './d5'
import { TimelinePublishedPayloadSchema, TimelinePublishedPayloadWriteSchema } from './d6'
import {
  GateResultPayloadSchema,
  GateResultPayloadWriteSchema,
  TaskUpdatedPayloadSchema,
  TaskUpdatedPayloadWriteSchema
} from './d7'
import {
  RouteCandidatesPreparedPayloadSchema,
  RouteManualEvidenceAppliedPayloadSchema,
  RouteSelectedPayloadSchema
} from './itinerary'
import {
  RouteD5ConfirmedPayloadSchema,
  RouteD5LegOptionsPreparedPayloadSchema,
  RouteD5LegSelectedPayloadSchema,
  RouteD5LegTransfersPreparedPayloadSchema,
  RouteD5SkeletonUpdatedPayloadSchema,
  RouteD5StayCandidatesPreparedPayloadSchema,
  RouteD5StaySelectedPayloadSchema
} from './route-d5'

const EventIdentitySchema = z.object({
  eventId: z.string().min(1),
  sessionId: z.string().min(1),
  seq: z.number().int().positive(),
  timestamp: z.string().datetime(),
  eventVersion: z.literal(2).optional()
})

const LegacySessionCreatedPayloadSchema = z.object({
  title: z.string().min(1).nullable().default(null)
})

const SessionCreatedV2PayloadSchema = z.object({
  title: z.string().min(1).nullable().default(null),
  linkedSessionGroup: z.string().min(1).nullable().default(null),
  splitIndex: z.number().int().nonnegative().nullable().default(null),
  basics: TravelBasicsSchema.nullable().default(null),
  handoffs: z.array(z.string().trim().min(1).max(300)).max(8).default([])
})

const LegacyStagePayloadSchema = z.object({ stage: TravelStageSchema })
const FixedDestinationConfirmationSchema = z
  .object({
    kind: z.literal('FIXED_DESTINATION'),
    city: z.string().trim().min(1).max(80)
  })
  .strict()
const StageConfirmedV2PayloadSchema = z.object({
  fromStage: TravelStageSchema,
  toStage: TravelStageSchema,
  confirmed: z.boolean(),
  confirmation: FixedDestinationConfirmationSchema.optional()
})

const BasicsUpdatedPayloadSchema = z.object({
  basics: TravelBasicsSchema,
  interviewTurns: z.number().int().min(1).max(5),
  destinationResearchRequired: z.boolean()
})

const EnvelopeDecisionPayloadSchema = z
  .object({
    assessment: EnvelopeAssessmentSchema,
    decision: EnvelopeDecisionSchema,
    splitPlan: SplitPlanSchema.nullable().default(null)
  })
  .superRefine((value, context) => {
    if (value.decision === 'SPLIT' && value.splitPlan === null) {
      context.addIssue({ code: 'custom', message: 'split decision requires splitPlan' })
    }
    if (value.decision !== 'SPLIT' && value.splitPlan !== null) {
      context.addIssue({ code: 'custom', message: 'splitPlan is only valid for split decision' })
    }
  })

const DecisionLoggedPayloadSchema = z.object({
  decisionId: z.string().min(1),
  category: z.string().trim().min(1).max(80),
  selected: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(1).max(500),
  alternatives: z.array(z.string().trim().min(1).max(200)).max(10).default([])
})

const EvidenceAddedPayloadSchema = z.object({ claim: EvidenceClaimSchema })

const DestinationCandidatesGeneratedPayloadSchema = z.object({
  candidates: z.array(DestinationCandidateSchema).min(2).max(4)
})
const DestinationSelectedPayloadSchema = z.object({
  candidateId: z.string().min(1),
  city: z.string().trim().min(1).max(80)
})
const ResearchChecklistPreparedPayloadSchema = z.object({
  entities: z.array(ResearchEntitySchema),
  sourceFailures: z.array(SourceResearchFailureSchema).default([]),
  xhsSampleSummary: XhsSampleSummarySchema.optional(),
  manualResearchSummary: ManualResearchSummarySchema.optional(),
  attractionRankings: z.array(AttractionRankingSchema).optional(),
  finalClaims: z.array(EvidenceClaimSchema).max(90).optional()
})
const ResearchDispositionSetPayloadSchema = z.object({
  entityId: z.string().min(1),
  disposition: LeadDispositionSchema
})
const ResearchConflictResolvedPayloadSchema = z.object({ resolution: ConflictResolutionSchema })
const ResearchConfirmedPayloadSchema = z.object({ confirmedAt: z.string().datetime() })
const NodeResearchChecklistPreparedPayloadSchema = z
  .object({
    scope: RouteNodeResearchScopeSchema,
    entities: z.array(ResearchEntitySchema),
    sourceFailures: z.array(SourceResearchFailureSchema).default([]),
    xhsSampleSummary: XhsSampleSummarySchema.optional(),
    manualResearchSummary: ManualResearchSummarySchema.optional(),
    attractionRankings: z.array(AttractionRankingSchema).optional(),
    finalClaims: z.array(EvidenceClaimSchema).max(90).default([])
  })
  .strict()
const NodeResearchDispositionSetPayloadSchema = z
  .object({
    scope: RouteNodeResearchScopeSchema,
    entityId: z.string().min(1),
    disposition: LeadDispositionSchema
  })
  .strict()
const NodeResearchConflictResolvedPayloadSchema = z
  .object({ scope: RouteNodeResearchScopeSchema, resolution: ConflictResolutionSchema })
  .strict()
const NodeResearchConfirmedPayloadSchema = z
  .object({
    scope: RouteNodeResearchScopeSchema,
    confirmedAt: z.string().datetime(),
    nodeSummaries: z.array(RouteNodeResearchSummarySchema).min(1).max(8),
    routeResearchComplete: z.boolean(),
    transition: z
      .object({
        fromStage: z.literal('STAGE_3'),
        toStage: z.literal('STAGE_4'),
        confirmed: z.literal(true)
      })
      .strict()
      .nullable()
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.routeResearchComplete !== (payload.transition !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'final node completion requires atomic transition'
      })
    }
  })
const NodeResearchUserPasteAddedPayloadSchema = z
  .object({ scope: RouteNodeResearchScopeSchema, claim: EvidenceClaimSchema })
  .strict()
const TransportCandidatesPreparedPayloadSchema = z.object({
  candidates: z.array(TransportCandidateSchema).min(1).max(3)
})
const TransportCandidateSelectedPayloadSchema = z.object({ candidateId: z.string().min(1) })
const SkeletonUpdatedPayloadSchema = z.object({
  days: z.array(DaySkeletonSchema).min(1).max(31),
  changedDates: z.array(D5DateSchema).min(1).max(31),
  boundaryAnchors: z.array(BoundaryAnchorSchema).length(2),
  staySegment: StaySegmentSchema
})
const StayCandidatesPreparedPayloadSchema = z.object({
  candidates: z.array(StayCandidateSchema).max(20),
  sourceOutcomes: z.array(D5SourceOutcomeSchema).max(3)
})
const StaySelectedPayloadSchema = z.object({ candidateId: z.string().min(1) })

export const SessionCreatedEventSchema = EventIdentitySchema.extend({
  type: z.literal('session/created'),
  payload: z.union([SessionCreatedV2PayloadSchema, LegacySessionCreatedPayloadSchema])
})

export const BasicsUpdatedEventSchema = EventIdentitySchema.extend({
  eventVersion: z.literal(2),
  type: z.literal('basics/updated'),
  payload: BasicsUpdatedPayloadSchema
})

export const EnvelopeDecisionEventSchema = EventIdentitySchema.extend({
  eventVersion: z.literal(2),
  type: z.literal('envelope/decision'),
  payload: EnvelopeDecisionPayloadSchema
})

export const DecisionLoggedEventSchema = EventIdentitySchema.extend({
  eventVersion: z.literal(2),
  type: z.literal('decision/logged'),
  payload: DecisionLoggedPayloadSchema
})

export const StageConfirmedEventSchema = EventIdentitySchema.extend({
  type: z.literal('stage/confirmed'),
  payload: z.union([StageConfirmedV2PayloadSchema, LegacyStagePayloadSchema])
})

export const EvidenceAddedEventSchema = EventIdentitySchema.extend({
  eventVersion: z.literal(2),
  type: z.literal('evidence/added'),
  payload: EvidenceAddedPayloadSchema
})

export const DestinationCandidatesGeneratedEventSchema = EventIdentitySchema.extend({
  eventVersion: z.literal(2),
  type: z.literal('destination/candidates-generated'),
  payload: DestinationCandidatesGeneratedPayloadSchema
})

export const DestinationSelectedEventSchema = EventIdentitySchema.extend({
  eventVersion: z.literal(2),
  type: z.literal('destination/selected'),
  payload: DestinationSelectedPayloadSchema
})

export const ResearchChecklistPreparedEventSchema = EventIdentitySchema.extend({
  eventVersion: z.literal(2),
  type: z.literal('research/checklist-prepared'),
  payload: ResearchChecklistPreparedPayloadSchema
})

export const ResearchDispositionSetEventSchema = EventIdentitySchema.extend({
  eventVersion: z.literal(2),
  type: z.literal('research/disposition-set'),
  payload: ResearchDispositionSetPayloadSchema
})

export const ResearchConflictResolvedEventSchema = EventIdentitySchema.extend({
  eventVersion: z.literal(2),
  type: z.literal('research/conflict-resolved'),
  payload: ResearchConflictResolvedPayloadSchema
})

export const ResearchConfirmedEventSchema = EventIdentitySchema.extend({
  eventVersion: z.literal(2),
  type: z.literal('research/confirmed'),
  payload: ResearchConfirmedPayloadSchema
})

export const NodeResearchChecklistPreparedEventSchema = EventIdentitySchema.extend({
  eventVersion: z.literal(2),
  type: z.literal('research/node-checklist-prepared'),
  payload: NodeResearchChecklistPreparedPayloadSchema
})

export const NodeResearchDispositionSetEventSchema = EventIdentitySchema.extend({
  eventVersion: z.literal(2),
  type: z.literal('research/node-disposition-set'),
  payload: NodeResearchDispositionSetPayloadSchema
})

export const NodeResearchConflictResolvedEventSchema = EventIdentitySchema.extend({
  eventVersion: z.literal(2),
  type: z.literal('research/node-conflict-resolved'),
  payload: NodeResearchConflictResolvedPayloadSchema
})

export const NodeResearchConfirmedEventSchema = EventIdentitySchema.extend({
  eventVersion: z.literal(2),
  type: z.literal('research/node-confirmed'),
  payload: NodeResearchConfirmedPayloadSchema
})

export const NodeResearchUserPasteAddedEventSchema = EventIdentitySchema.extend({
  eventVersion: z.literal(2),
  type: z.literal('research/node-user-paste-added'),
  payload: NodeResearchUserPasteAddedPayloadSchema
})

export const TransportCandidatesPreparedEventSchema = EventIdentitySchema.extend({
  eventVersion: z.literal(2),
  type: z.literal('transport/candidates-prepared'),
  payload: TransportCandidatesPreparedPayloadSchema
})

export const TransportCandidateSelectedEventSchema = EventIdentitySchema.extend({
  eventVersion: z.literal(2),
  type: z.literal('transport/candidate-selected'),
  payload: TransportCandidateSelectedPayloadSchema
})

export const SkeletonUpdatedEventSchema = EventIdentitySchema.extend({
  eventVersion: z.literal(2),
  type: z.literal('skeleton/updated'),
  payload: SkeletonUpdatedPayloadSchema
})

export const StayCandidatesPreparedEventSchema = EventIdentitySchema.extend({
  eventVersion: z.literal(2),
  type: z.literal('stay/candidates-prepared'),
  payload: StayCandidatesPreparedPayloadSchema
})

export const StaySelectedEventSchema = EventIdentitySchema.extend({
  eventVersion: z.literal(2),
  type: z.literal('stay/selected'),
  payload: StaySelectedPayloadSchema
})

export const RouteCandidatesPreparedEventSchema = EventIdentitySchema.extend({
  eventVersion: z.literal(2),
  type: z.literal('itinerary/route-candidates-prepared'),
  payload: RouteCandidatesPreparedPayloadSchema
})

export const RouteManualEvidenceAppliedEventSchema = EventIdentitySchema.extend({
  eventVersion: z.literal(2),
  type: z.literal('itinerary/route-manual-evidence-applied'),
  payload: RouteManualEvidenceAppliedPayloadSchema
})

export const RouteSelectedEventSchema = EventIdentitySchema.extend({
  eventVersion: z.literal(2),
  type: z.literal('itinerary/route-selected'),
  payload: RouteSelectedPayloadSchema
})

export const RouteD5LegOptionsPreparedEventSchema = EventIdentitySchema.extend({
  eventVersion: z.literal(2),
  type: z.literal('route-d5/leg-options-prepared'),
  payload: RouteD5LegOptionsPreparedPayloadSchema
})

export const RouteD5LegSelectedEventSchema = EventIdentitySchema.extend({
  eventVersion: z.literal(2),
  type: z.literal('route-d5/leg-selected'),
  payload: RouteD5LegSelectedPayloadSchema
})

export const RouteD5LegTransfersPreparedEventSchema = EventIdentitySchema.extend({
  eventVersion: z.literal(2),
  type: z.literal('route-d5/leg-transfers-prepared'),
  payload: RouteD5LegTransfersPreparedPayloadSchema
})

export const RouteD5SkeletonUpdatedEventSchema = EventIdentitySchema.extend({
  eventVersion: z.literal(2),
  type: z.literal('route-d5/skeleton-updated'),
  payload: RouteD5SkeletonUpdatedPayloadSchema
})

export const RouteD5StayCandidatesPreparedEventSchema = EventIdentitySchema.extend({
  eventVersion: z.literal(2),
  type: z.literal('route-d5/stay-candidates-prepared'),
  payload: RouteD5StayCandidatesPreparedPayloadSchema
})

export const RouteD5StaySelectedEventSchema = EventIdentitySchema.extend({
  eventVersion: z.literal(2),
  type: z.literal('route-d5/stay-selected'),
  payload: RouteD5StaySelectedPayloadSchema
})

export const RouteD5ConfirmedEventSchema = EventIdentitySchema.extend({
  eventVersion: z.literal(2),
  type: z.literal('route-d5/confirmed'),
  payload: RouteD5ConfirmedPayloadSchema
})

export const TimelinePublishedEventSchema = EventIdentitySchema.extend({
  eventVersion: z.literal(2),
  type: z.literal('timeline/published'),
  payload: TimelinePublishedPayloadSchema
})

export const TaskUpdatedEventSchema = EventIdentitySchema.extend({
  eventVersion: z.literal(2),
  type: z.literal('task/updated'),
  payload: TaskUpdatedPayloadSchema
})

export const GateResultEventSchema = EventIdentitySchema.extend({
  eventVersion: z.literal(2),
  type: z.literal('gate/result'),
  payload: GateResultPayloadSchema
})

export const SessionEventSchema = z.discriminatedUnion('type', [
  SessionCreatedEventSchema,
  BasicsUpdatedEventSchema,
  EnvelopeDecisionEventSchema,
  DecisionLoggedEventSchema,
  EvidenceAddedEventSchema,
  DestinationCandidatesGeneratedEventSchema,
  DestinationSelectedEventSchema,
  ResearchChecklistPreparedEventSchema,
  ResearchDispositionSetEventSchema,
  ResearchConflictResolvedEventSchema,
  ResearchConfirmedEventSchema,
  NodeResearchChecklistPreparedEventSchema,
  NodeResearchDispositionSetEventSchema,
  NodeResearchConflictResolvedEventSchema,
  NodeResearchConfirmedEventSchema,
  NodeResearchUserPasteAddedEventSchema,
  TransportCandidatesPreparedEventSchema,
  TransportCandidateSelectedEventSchema,
  SkeletonUpdatedEventSchema,
  StayCandidatesPreparedEventSchema,
  StaySelectedEventSchema,
  RouteCandidatesPreparedEventSchema,
  RouteManualEvidenceAppliedEventSchema,
  RouteSelectedEventSchema,
  RouteD5LegOptionsPreparedEventSchema,
  RouteD5LegSelectedEventSchema,
  RouteD5LegTransfersPreparedEventSchema,
  RouteD5SkeletonUpdatedEventSchema,
  RouteD5StayCandidatesPreparedEventSchema,
  RouteD5StaySelectedEventSchema,
  RouteD5ConfirmedEventSchema,
  TimelinePublishedEventSchema,
  TaskUpdatedEventSchema,
  GateResultEventSchema,
  StageConfirmedEventSchema
])
export type SessionEvent = z.infer<typeof SessionEventSchema>

const DraftIdentitySchema = z.object({
  sessionId: z.string().min(1),
  eventVersion: z.literal(2).optional()
})

export const SessionEventDraftSchema = z.discriminatedUnion('type', [
  DraftIdentitySchema.extend({
    type: z.literal('session/created'),
    payload: z.union([SessionCreatedV2PayloadSchema, LegacySessionCreatedPayloadSchema])
  }),
  DraftIdentitySchema.extend({
    eventVersion: z.literal(2),
    type: z.literal('basics/updated'),
    payload: BasicsUpdatedPayloadSchema
  }),
  DraftIdentitySchema.extend({
    eventVersion: z.literal(2),
    type: z.literal('envelope/decision'),
    payload: EnvelopeDecisionPayloadSchema
  }),
  DraftIdentitySchema.extend({
    eventVersion: z.literal(2),
    type: z.literal('decision/logged'),
    payload: DecisionLoggedPayloadSchema
  }),
  DraftIdentitySchema.extend({
    eventVersion: z.literal(2),
    type: z.literal('evidence/added'),
    payload: EvidenceAddedPayloadSchema
  }),
  DraftIdentitySchema.extend({
    eventVersion: z.literal(2),
    type: z.literal('destination/candidates-generated'),
    payload: DestinationCandidatesGeneratedPayloadSchema
  }),
  DraftIdentitySchema.extend({
    eventVersion: z.literal(2),
    type: z.literal('destination/selected'),
    payload: DestinationSelectedPayloadSchema
  }),
  DraftIdentitySchema.extend({
    eventVersion: z.literal(2),
    type: z.literal('research/checklist-prepared'),
    payload: ResearchChecklistPreparedPayloadSchema
  }),
  DraftIdentitySchema.extend({
    eventVersion: z.literal(2),
    type: z.literal('research/disposition-set'),
    payload: ResearchDispositionSetPayloadSchema
  }),
  DraftIdentitySchema.extend({
    eventVersion: z.literal(2),
    type: z.literal('research/conflict-resolved'),
    payload: ResearchConflictResolvedPayloadSchema
  }),
  DraftIdentitySchema.extend({
    eventVersion: z.literal(2),
    type: z.literal('research/confirmed'),
    payload: ResearchConfirmedPayloadSchema
  }),
  DraftIdentitySchema.extend({
    eventVersion: z.literal(2),
    type: z.literal('research/node-checklist-prepared'),
    payload: NodeResearchChecklistPreparedPayloadSchema
  }),
  DraftIdentitySchema.extend({
    eventVersion: z.literal(2),
    type: z.literal('research/node-disposition-set'),
    payload: NodeResearchDispositionSetPayloadSchema
  }),
  DraftIdentitySchema.extend({
    eventVersion: z.literal(2),
    type: z.literal('research/node-conflict-resolved'),
    payload: NodeResearchConflictResolvedPayloadSchema
  }),
  DraftIdentitySchema.extend({
    eventVersion: z.literal(2),
    type: z.literal('research/node-confirmed'),
    payload: NodeResearchConfirmedPayloadSchema
  }),
  DraftIdentitySchema.extend({
    eventVersion: z.literal(2),
    type: z.literal('research/node-user-paste-added'),
    payload: NodeResearchUserPasteAddedPayloadSchema
  }),
  DraftIdentitySchema.extend({
    eventVersion: z.literal(2),
    type: z.literal('transport/candidates-prepared'),
    payload: TransportCandidatesPreparedPayloadSchema
  }),
  DraftIdentitySchema.extend({
    eventVersion: z.literal(2),
    type: z.literal('transport/candidate-selected'),
    payload: TransportCandidateSelectedPayloadSchema
  }),
  DraftIdentitySchema.extend({
    eventVersion: z.literal(2),
    type: z.literal('skeleton/updated'),
    payload: SkeletonUpdatedPayloadSchema
  }),
  DraftIdentitySchema.extend({
    eventVersion: z.literal(2),
    type: z.literal('stay/candidates-prepared'),
    payload: StayCandidatesPreparedPayloadSchema
  }),
  DraftIdentitySchema.extend({
    eventVersion: z.literal(2),
    type: z.literal('stay/selected'),
    payload: StaySelectedPayloadSchema
  }),
  DraftIdentitySchema.extend({
    eventVersion: z.literal(2),
    type: z.literal('itinerary/route-candidates-prepared'),
    payload: RouteCandidatesPreparedPayloadSchema
  }),
  DraftIdentitySchema.extend({
    eventVersion: z.literal(2),
    type: z.literal('itinerary/route-manual-evidence-applied'),
    payload: RouteManualEvidenceAppliedPayloadSchema
  }),
  DraftIdentitySchema.extend({
    eventVersion: z.literal(2),
    type: z.literal('itinerary/route-selected'),
    payload: RouteSelectedPayloadSchema
  }),
  DraftIdentitySchema.extend({
    eventVersion: z.literal(2),
    type: z.literal('route-d5/leg-options-prepared'),
    payload: RouteD5LegOptionsPreparedPayloadSchema
  }),
  DraftIdentitySchema.extend({
    eventVersion: z.literal(2),
    type: z.literal('route-d5/leg-selected'),
    payload: RouteD5LegSelectedPayloadSchema
  }),
  DraftIdentitySchema.extend({
    eventVersion: z.literal(2),
    type: z.literal('route-d5/leg-transfers-prepared'),
    payload: RouteD5LegTransfersPreparedPayloadSchema
  }),
  DraftIdentitySchema.extend({
    eventVersion: z.literal(2),
    type: z.literal('route-d5/skeleton-updated'),
    payload: RouteD5SkeletonUpdatedPayloadSchema
  }),
  DraftIdentitySchema.extend({
    eventVersion: z.literal(2),
    type: z.literal('route-d5/stay-candidates-prepared'),
    payload: RouteD5StayCandidatesPreparedPayloadSchema
  }),
  DraftIdentitySchema.extend({
    eventVersion: z.literal(2),
    type: z.literal('route-d5/stay-selected'),
    payload: RouteD5StaySelectedPayloadSchema
  }),
  DraftIdentitySchema.extend({
    eventVersion: z.literal(2),
    type: z.literal('route-d5/confirmed'),
    payload: RouteD5ConfirmedPayloadSchema
  }),
  DraftIdentitySchema.extend({
    eventVersion: z.literal(2),
    type: z.literal('timeline/published'),
    payload: TimelinePublishedPayloadWriteSchema
  }),
  DraftIdentitySchema.extend({
    eventVersion: z.literal(2),
    type: z.literal('task/updated'),
    payload: TaskUpdatedPayloadWriteSchema
  }),
  DraftIdentitySchema.extend({
    eventVersion: z.literal(2),
    type: z.literal('gate/result'),
    payload: GateResultPayloadWriteSchema
  }),
  DraftIdentitySchema.extend({
    type: z.literal('stage/confirmed'),
    payload: z.union([StageConfirmedV2PayloadSchema, LegacyStagePayloadSchema])
  })
])
export type SessionEventDraft = z.infer<typeof SessionEventDraftSchema>
