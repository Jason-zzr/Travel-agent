import { z } from 'zod'
import { EnvelopeAssessmentSchema, EnvelopeDecisionSchema } from './envelope'
import { TravelBasicsSchema } from './interview'
import {
  ConflictResolutionSchema,
  AttractionRankingSchema,
  DestinationCandidateSchema,
  ManualResearchSummarySchema,
  ResearchEntitySchema,
  RouteNodeResearchStateSchema,
  SourceResearchFailureSchema,
  XhsSampleSummarySchema
} from './d4'
import {
  BoundaryAnchorSchema,
  D5SourceOutcomeSchema,
  DaySkeletonSchema,
  StayCandidateSchema,
  StaySegmentSchema,
  TransportCandidateSchema
} from './d5'
import { D6SourceOutcomeSchema, TimelineVersionSchema } from './d6'
import { GateCReportSchema, PreparationTaskSchema } from './d7'
import {
  ItineraryGoalSchema,
  RouteCandidateSchema,
  RouteSourceOutcomeSchema,
  RouteStaySegmentSchema
} from './itinerary'
import { RouteD5LegStateSchema, RouteD5StayStateSchema, RouteDaySkeletonSchema } from './route-d5'
import { TravelStageSchema } from './stage'

export { TravelStageSchema, type TravelStage } from './stage'

export const TravelStateSchema = z.object({
  sessionId: z.string().min(1),
  createdAt: z.string().datetime(),
  stage: TravelStageSchema,
  lastSeq: z.number().int().nonnegative(),
  title: z.string().min(1).nullable(),
  linkedSessionGroup: z.string().min(1).nullable().default(null),
  splitIndex: z.number().int().nonnegative().nullable().default(null),
  basics: TravelBasicsSchema.nullable().default(null),
  interviewTurns: z.number().int().nonnegative().max(5).default(0),
  envelope: EnvelopeAssessmentSchema.nullable().default(null),
  envelopeDecision: EnvelopeDecisionSchema.nullable().default(null),
  destinationResearchRequired: z.boolean().default(false),
  handoffs: z.array(z.string().trim().min(1).max(300)).max(8).default([]),
  itineraryGoal: ItineraryGoalSchema.nullable().default(null),
  routeCandidates: z.array(RouteCandidateSchema).max(3).default([]),
  selectedRouteId: z.string().min(1).max(120).nullable().default(null),
  routeSourceOutcomes: z.array(RouteSourceOutcomeSchema).max(24).default([]),
  routeStaySegments: z.array(RouteStaySegmentSchema).max(6).default([]),
  routeBlockingReasons: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  destinationCandidates: z.array(DestinationCandidateSchema).max(4).default([]),
  selectedDestinationCandidateId: z.string().min(1).nullable().default(null),
  researchEntities: z.array(ResearchEntitySchema).default([]),
  researchChecklistConfirmed: z.boolean().default(false),
  conflictResolutions: z.array(ConflictResolutionSchema).default([]),
  sourceResearchFailures: z.array(SourceResearchFailureSchema).default([]),
  xhsSampleSummary: XhsSampleSummarySchema.nullable().default(null),
  manualResearchSummary: ManualResearchSummarySchema.nullable().default(null),
  attractionRankings: z.array(AttractionRankingSchema).default([]),
  routeNodeResearchStates: z.array(RouteNodeResearchStateSchema).max(8).default([]),
  routeD5LegStates: z.array(RouteD5LegStateSchema).max(9).default([]),
  routeD5StayStates: z.array(RouteD5StayStateSchema).max(8).default([]),
  routeDaySkeletons: z.array(RouteDaySkeletonSchema).max(31).default([]),
  routeD5Confirmed: z.boolean().default(false),
  transportCandidates: z.array(TransportCandidateSchema).max(3).default([]),
  selectedTransportCandidateId: z.string().min(1).nullable().default(null),
  boundaryAnchors: z.array(BoundaryAnchorSchema).max(2).default([]),
  daySkeletons: z.array(DaySkeletonSchema).max(31).default([]),
  staySegment: StaySegmentSchema.nullable().default(null),
  stayCandidates: z.array(StayCandidateSchema).max(20).default([]),
  selectedStayCandidateId: z.string().min(1).nullable().default(null),
  staySourceOutcomes: z.array(D5SourceOutcomeSchema).max(3).default([]),
  timelineVersions: z.array(TimelineVersionSchema).default([]),
  d6SourceOutcomes: z.array(D6SourceOutcomeSchema).max(12).default([]),
  tasks: z.array(PreparationTaskSchema).max(200).default([]),
  latestGateC: GateCReportSchema.nullable().default(null)
})
export type TravelState = z.infer<typeof TravelStateSchema>
