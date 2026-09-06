import { z } from 'zod'
import { TimelineDecisionSchema, TimelineRouteContextSchema, TimelineVersionSchema } from './d6'
import { ModelRoleSchema } from './provider'
import { ExternalSourceUrlSchema, SourceHealthEntrySchema } from './source'
import { TravelStageSchema } from './stage'
import { BlockedToolAuditSchema, ToolCallAuditSchema } from './tool-audit'

export const TaskKindSchema = z.enum(['PREPARATION', 'RESERVATION_TICKET'])
export const TaskPrioritySchema = z.enum(['HIGH', 'NORMAL', 'LOW'])
export const TaskUserDecisionSchema = z.enum(['PENDING', 'ACCEPTED', 'SKIPPED'])
export const TaskReservationSchema = z.enum(['NOT_STARTED', 'IN_PROGRESS', 'DONE', 'FAILED'])
export const TaskReadinessSchema = z.enum(['UNKNOWN', 'READY', 'BLOCKED'])
export const TaskHandoverEvidenceSchema = z.enum(['VERIFIED', 'INCOMPLETE', 'STALE'])
export const TaskUpdateReasonSchema = z.enum([
  'DERIVED',
  'USER_CONFIRMED',
  'USER_SKIPPED',
  'RECHECKED'
])
export const TaskUpdateActionSchema = z.enum(['CONFIRM_EXTERNAL_RESULT', 'MARK_DONE', 'SKIP'])

export const TaskHandoverSchema = z
  .object({
    action: z.string().trim().min(1).max(500),
    channelLabel: z.string().trim().min(1).max(200).nullable(),
    channelUrl: ExternalSourceUrlSchema.nullable(),
    requiredInformation: z.array(z.string().trim().min(1).max(300)).max(12),
    warnings: z.array(z.string().trim().min(1).max(500)).max(12),
    deadline: z.string().datetime(),
    deadlineSource: z.enum(['EXPLICIT', 'ESTIMATED']),
    checklist: z.array(z.string().trim().min(1).max(300)).min(1).max(12),
    evidenceStatus: TaskHandoverEvidenceSchema
  })
  .strict()
export type TaskHandover = z.infer<typeof TaskHandoverSchema>

export const PreparationTaskSchema = z
  .object({
    taskId: z.string().min(1).max(500),
    sessionId: z.string().min(1),
    sourceTimelineVersion: z.number().int().positive(),
    itemId: z.string().min(1),
    claimIds: z.array(z.string().min(1)).max(80),
    kind: TaskKindSchema,
    title: z.string().trim().min(1).max(300),
    owner: z.string().trim().min(1).max(100),
    dueAt: z.string().datetime(),
    recheckAt: z.string().datetime(),
    priority: TaskPrioritySchema,
    userDecision: TaskUserDecisionSchema,
    reservation: TaskReservationSchema,
    readiness: TaskReadinessSchema,
    payment: z.literal('NA'),
    document: z.literal('NA'),
    refund: z.literal('NA'),
    reminder: z.literal('NA'),
    handover: TaskHandoverSchema,
    routeContext: TimelineRouteContextSchema.nullable().optional(),
    updatedAt: z.string().datetime()
  })
  .strict()
  .superRefine((task, context) => {
    if (
      task.reservation === 'DONE' &&
      (task.userDecision !== 'ACCEPTED' || task.readiness !== 'READY')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'completed reservation must be accepted and ready'
      })
    }
    if (task.userDecision === 'SKIPPED' && task.reservation === 'DONE') {
      context.addIssue({
        code: 'custom',
        message: 'skipped task cannot have a completed reservation'
      })
    }
  })
export type PreparationTask = z.infer<typeof PreparationTaskSchema>

const TaskUpdatedPayloadBaseSchema = z.object({
  tasks: z.array(PreparationTaskSchema).max(200),
  updatedTaskId: z.string().min(1).nullable().default(null),
  reason: TaskUpdateReasonSchema,
  replacementTimeline: TimelineVersionSchema.nullable().default(null),
  decision: TimelineDecisionSchema.nullable().default(null)
})

function validateTaskUpdatedPayload(
  payload: z.infer<typeof TaskUpdatedPayloadBaseSchema>,
  context: z.RefinementCtx
): void {
  const taskIds = payload.tasks.map((task) => task.taskId)
  if (new Set(taskIds).size !== taskIds.length) {
    context.addIssue({ code: 'custom', message: 'task post-state contains duplicate IDs' })
  }
  if (payload.reason === 'DERIVED' && payload.updatedTaskId !== null) {
    context.addIssue({
      code: 'custom',
      message: 'derived task batch must not name one updated task'
    })
  }
  if (payload.reason !== 'DERIVED' && !taskIds.includes(payload.updatedTaskId ?? '')) {
    context.addIssue({ code: 'custom', message: 'updated task must exist in task post-state' })
  }
  if ((payload.replacementTimeline === null) !== (payload.decision === null)) {
    context.addIssue({
      code: 'custom',
      message: 'replacement timeline and decision must be paired'
    })
  }
  if (payload.replacementTimeline !== null) {
    const updatedTask = payload.tasks.find((task) => task.taskId === payload.updatedTaskId)
    if (payload.reason !== 'USER_CONFIRMED' || updatedTask?.kind !== 'RESERVATION_TICKET') {
      context.addIssue({
        code: 'custom',
        message: 'only a confirmed reservation may revise timeline'
      })
    }
    if (payload.replacementTimeline.decision.decisionId !== payload.decision?.decisionId) {
      context.addIssue({
        code: 'custom',
        message: 'replacement timeline decision must match payload'
      })
    }
    const itemIds = new Set(payload.replacementTimeline.items.map((item) => item.itemId))
    if (
      payload.tasks.some(
        (task) =>
          task.sourceTimelineVersion !== payload.replacementTimeline?.version ||
          !itemIds.has(task.itemId)
      )
    ) {
      context.addIssue({ code: 'custom', message: 'replacement timeline must own every task link' })
    }
  }
}

export const TaskUpdatedPayloadWriteSchema = TaskUpdatedPayloadBaseSchema.strict().superRefine(
  validateTaskUpdatedPayload
)
export const TaskUpdatedPayloadSchema = TaskUpdatedPayloadBaseSchema.passthrough().superRefine(
  validateTaskUpdatedPayload
)
export type TaskUpdatedPayload = z.infer<typeof TaskUpdatedPayloadWriteSchema>

export const GateCBlockerSchema = z
  .object({
    code: z.enum([
      'HIGH_PRIORITY_TASK_PENDING',
      'TASK_HANDOVER_INCOMPLETE',
      'TASK_OVERDUE',
      'HARD_ANCHOR_UNVERIFIED',
      'HARD_ANCHOR_STALE',
      'WEATHER_RECHECK_MISSING',
      'CLOSURE_RECHECK_MISSING',
      'ROUTE_LEG_UNVERIFIED',
      'STAY_SEGMENT_UNVERIFIED',
      'MUST_ANCHOR_UNVERIFIED',
      'ROUTE_COVERAGE_INCOMPLETE'
    ]),
    message: z.string().trim().min(1).max(500),
    itemId: z.string().min(1).nullable(),
    taskId: z.string().min(1).nullable(),
    claimIds: z.array(z.string().min(1)).max(80),
    routeContext: TimelineRouteContextSchema.nullable().optional()
  })
  .strict()
export type GateCBlocker = z.infer<typeof GateCBlockerSchema>

export const GateCReportSchema = z
  .object({
    gateId: z.literal('GATE_C'),
    evaluatedAt: z.string().datetime(),
    ready: z.boolean(),
    timelineVersion: z.number().int().positive(),
    routeId: z.string().min(1).max(120).nullable().optional(),
    blockers: z.array(GateCBlockerSchema).max(200),
    taskIds: z.array(z.string().min(1)).max(200),
    claimIds: z.array(z.string().min(1)).max(500)
  })
  .strict()
  .superRefine((report, context) => {
    if (report.ready === report.blockers.length > 0) {
      context.addIssue({ code: 'custom', message: 'gate readiness must match blocker absence' })
    }
  })
export type GateCReport = z.infer<typeof GateCReportSchema>

const GateResultPayloadBaseSchema = z.object({ report: GateCReportSchema })
export const GateResultPayloadWriteSchema = GateResultPayloadBaseSchema.strict()
export const GateResultPayloadSchema = GateResultPayloadBaseSchema.passthrough()

export const D7ExecutionAuditSchema = z
  .object({
    externalCalls: z.number().int().nonnegative(),
    modelCalls: z.number().int().nonnegative(),
    irreversibleActions: z.number().int().nonnegative()
  })
  .strict()

export const D7SnapshotSchema = z
  .object({
    sessionId: z.string().min(1),
    routeId: z.string().min(1).max(120).nullable().optional(),
    stage: TravelStageSchema,
    currentVersion: z.number().int().positive().nullable(),
    tasks: z.array(PreparationTaskSchema).max(200),
    latestGateC: GateCReportSchema.nullable(),
    audit: D7ExecutionAuditSchema
  })
  .strict()
export type D7Snapshot = z.infer<typeof D7SnapshotSchema>

export const D7SnapshotRequestSchema = z
  .object({ sessionId: z.string().min(1), routeId: z.string().min(1).max(120).optional() })
  .strict()
export const TaskDeriveRequestSchema = D7SnapshotRequestSchema
export const TaskUpdateRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    routeId: z.string().min(1).max(120).optional(),
    taskId: z.string().min(1),
    expectedUpdatedAt: z.string().datetime(),
    action: TaskUpdateActionSchema
  })
  .strict()
export const GateCRunRequestSchema = D7SnapshotRequestSchema
export const ItineraryExportRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    routeId: z.string().min(1).max(120).optional(),
    format: z.enum(['ICS', 'MARKDOWN'])
  })
  .strict()

export type TaskUpdateRequest = z.infer<typeof TaskUpdateRequestSchema>
export type TaskUpdateAction = z.infer<typeof TaskUpdateActionSchema>
export type ItineraryExportRequest = z.infer<typeof ItineraryExportRequestSchema>

export const ExportResultSchema = z
  .object({
    kind: z.enum(['ICS', 'MARKDOWN', 'DIAGNOSTIC']),
    savedPath: z.string().min(1),
    itemCount: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative()
  })
  .strict()
export type ExportResult = z.infer<typeof ExportResultSchema>

export const InspectorQuerySchema = z
  .object({
    sessionId: z.string().min(1),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    limit: z.number().int().min(1).max(500).default(100)
  })
  .strict()
  .superRefine((query, context) => {
    if (query.from && query.to && Date.parse(query.from) > Date.parse(query.to)) {
      context.addIssue({ code: 'custom', message: 'inspector from must not be after to' })
    }
  })
export type InspectorQuery = z.infer<typeof InspectorQuerySchema>

export const InspectorEventSummarySchema = z
  .object({
    eventId: z.string().min(1),
    sessionId: z.string().min(1),
    seq: z.number().int().positive(),
    type: z.string().min(1),
    timestamp: z.string().datetime()
  })
  .strict()

export const InspectorModelCallSchema = z
  .object({
    callId: z.string().min(1),
    sessionId: z.string().min(1),
    role: ModelRoleSchema,
    provider: z.string().min(1),
    model: z.string().min(1),
    tokensIn: z.number().int().nonnegative(),
    tokensOut: z.number().int().nonnegative(),
    costCents: z.number().int().nonnegative(),
    latencyMs: z.number().int().nonnegative(),
    ok: z.boolean(),
    createdAt: z.string().datetime()
  })
  .strict()

export const InspectorSnapshotSchema = z
  .object({
    query: InspectorQuerySchema,
    events: z.array(InspectorEventSummarySchema),
    toolCalls: z.array(ToolCallAuditSchema),
    modelCalls: z.array(InspectorModelCallSchema),
    blockedTools: z.array(BlockedToolAuditSchema),
    sourceHealth: z.array(SourceHealthEntrySchema)
  })
  .strict()
export type InspectorSnapshot = z.infer<typeof InspectorSnapshotSchema>

export const DiagnosticExportRequestSchema = InspectorQuerySchema
