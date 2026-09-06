import { z } from 'zod'
import type { SerializedAppError } from './errors'
import {
  CredentialIdSchema,
  CredentialStatusEntrySchema,
  type CredentialId,
  type CredentialStatusEntry
} from './schema/credentials'
import {
  ChatSubmitRequestSchema,
  ConfirmationConfirmRequestSchema,
  ConfirmationUpdateRequestSchema,
  EnvelopeChoiceRequestSchema,
  SessionCreateRequestSchema,
  type ChatSubmitRequest,
  type ChatTurnOutcome,
  type ConfirmationConfirmRequest,
  type ConfirmationUpdateRequest,
  type EnvelopeChoiceRequest,
  type SessionCreateRequest,
  type SessionSummary,
  type UsageTotal
} from './schema/chat'
import type { EnvelopeComparison } from './schema/envelope'
import {
  ProviderConfigSchema,
  type ProviderConfig,
  type ProviderConfigSummary
} from './schema/provider'
import { EvidenceListRequestSchema, type EvidenceClaim } from './schema/evidence'
import {
  ExternalSourceIdSchema,
  ExternalSourceUrlSchema,
  RepresentativeSourceQuerySchema,
  SourceConfigSchema,
  type ExternalSourceId,
  type RepresentativeSourceQuery,
  type SourceConfig,
  type SourceHealthEntry,
  type SourceQueryOutcome
} from './schema/source'
import {
  ToolAuditListRequestSchema,
  type BlockedToolAudit,
  type ToolCallAudit
} from './schema/tool-audit'
import {
  ConflictResolveRequestSchema,
  D4ProgressEventSchema,
  D4SnapshotRequestSchema,
  DestinationGenerateRequestSchema,
  FixedDestinationConfirmRequestSchema,
  ManualResearchChecklistRequestSchema,
  DestinationSelectRequestSchema,
  ResearchConfirmRequestSchema,
  ResearchDispositionRequestSchema,
  ResearchPrepareRequestSchema,
  RouteResearchCancelRequestSchema,
  RouteResearchConfirmRequestSchema,
  RouteResearchConflictRequestSchema,
  RouteResearchDispositionRequestSchema,
  RouteResearchExecuteRequestSchema,
  RouteResearchManualRequestSchema,
  RouteResearchPreviewRequestSchema,
  RouteResearchProgressEventSchema,
  RouteResearchSnapshotRequestSchema,
  RouteResearchUserPasteRequestSchema,
  XhsRankingExecuteRequestSchema,
  XhsRankingPreviewRequestSchema,
  UserPasteRequestSchema,
  type ConflictResolveRequest,
  type D4Snapshot,
  type DestinationGenerateRequest,
  type FixedDestinationConfirmRequest,
  type ManualResearchChecklistRequest,
  type DestinationSelectRequest,
  type ResearchConfirmRequest,
  type ResearchDispositionRequest,
  type ResearchPrepareRequest,
  type NodeResearchPlanPreview,
  type RouteNodeD4Snapshot,
  type RouteResearchConfirmRequest,
  type RouteResearchConflictRequest,
  type RouteResearchDispositionRequest,
  type RouteResearchExecuteRequest,
  type RouteResearchManualRequest,
  type RouteResearchPreviewRequest,
  type RouteResearchSnapshotRequest,
  type RouteResearchUserPasteRequest,
  type XhsRankingExecuteRequest,
  type XhsRankingPreview,
  type UserPasteRequest
} from './schema/d4'
import type { XhsConnectionStatus, XhsLoginQrDisplay } from './schema/mcp/xiaohongshu'
import {
  D5ProgressEventSchema,
  D5SourcePlanExecuteRequestSchema,
  D5SourcePlanPreviewRequestSchema,
  D5SnapshotRequestSchema,
  RailDiscoveryRequestSchema,
  RailSelectionRequestSchema,
  SkeletonConfirmRequestSchema,
  SkeletonPrepareRequestSchema,
  SkeletonPatchRequestSchema,
  StayPrepareRequestSchema,
  StayPasteRequestSchema,
  StaySelectRequestSchema,
  TransportPrepareRequestSchema,
  TransportSelectRequestSchema,
  type D5Snapshot,
  type D5SourcePlanExecuteRequest,
  type D5SourcePlanExecutionResult,
  type D5SourcePlanPreview,
  type D5SourcePlanPreviewRequest,
  type RailDiscoveryPreview,
  type RailDiscoveryRequest,
  type RailDiscoveryResult,
  type RailSelectionRequest,
  type RailSelectionResult,
  type SkeletonConfirmRequest,
  type SkeletonPrepareRequest,
  type SkeletonPatchRequest,
  type StayPrepareRequest,
  type StayPasteRequest,
  type StaySelectRequest,
  type TransportPrepareRequest,
  type TransportSelectRequest
} from './schema/d5'
import {
  D6CancelRequestSchema,
  D6ProgressEventSchema,
  D6SnapshotRequestSchema,
  TimelinePrepareRequestSchema,
  TimelinePublishRequestSchema,
  type D6Snapshot,
  type TimelinePrepareRequest,
  type TimelinePublishRequest
} from './schema/d6'
import {
  D7SnapshotRequestSchema,
  DiagnosticExportRequestSchema,
  GateCRunRequestSchema,
  InspectorQuerySchema,
  ItineraryExportRequestSchema,
  TaskDeriveRequestSchema,
  TaskUpdateRequestSchema,
  type D7Snapshot,
  type ExportResult,
  type InspectorQuery,
  type InspectorSnapshot,
  type ItineraryExportRequest,
  type TaskUpdateRequest
} from './schema/d7'
import {
  ManualRouteLegEvidenceRequestSchema,
  MultiCityRouteSnapshotRequestSchema,
  RouteCancelRequestSchema,
  RoutePlanExecuteRequestSchema,
  RoutePlanPreviewRequestSchema,
  RouteSelectRequestSchema,
  type MultiCityRouteSnapshot,
  type ManualRouteLegEvidenceRequest,
  type RoutePlanExecuteRequest,
  type RoutePlanPreview,
  type RouteSelectRequest
} from './schema/itinerary'
import {
  RouteD5CancelRequestSchema,
  RouteD5ConfirmRequestSchema,
  RouteD5ExecuteRequestSchema,
  RouteD5LegSelectRequestSchema,
  RouteD5ManualLegRequestSchema,
  RouteD5PreviewRequestSchema,
  RouteD5ProgressEventSchema,
  RouteD5SkeletonPatchRequestSchema,
  RouteD5SkeletonPrepareRequestSchema,
  RouteD5SnapshotRequestSchema,
  RouteD5StayPasteRequestSchema,
  RouteD5StaySelectRequestSchema,
  type MultiSegmentD5Snapshot,
  type RouteD5ConfirmRequest,
  type RouteD5ExecuteRequest,
  type RouteD5LegSelectRequest,
  type RouteD5ManualLegRequest,
  type RouteD5PlanPreview,
  type RouteD5PreviewRequest,
  type RouteD5SkeletonPatchRequest,
  type RouteD5SkeletonPrepareRequest,
  type RouteD5StayPasteRequest,
  type RouteD5StaySelectRequest
} from './schema/route-d5'

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: SerializedAppError }
export type ChatIpcResult<T> =
  | { ok: true; data: T }
  | {
      ok: false
      error: SerializedAppError
      comparison?: EnvelopeComparison
      dependency?: string | null
    }

export const IPC_CHANNELS = {
  credentialsList: 'credentials:list',
  credentialsSave: 'credentials:save',
  credentialsClear: 'credentials:clear',
  providerGet: 'provider:get',
  providerSave: 'provider:save',
  providerClear: 'provider:clear',
  sessionsList: 'sessions:list',
  sessionsCreate: 'sessions:create',
  sessionsGet: 'sessions:get',
  chatSubmit: 'chat:submit',
  confirmationUpdate: 'confirmation:update',
  confirmationConfirm: 'confirmation:confirm',
  envelopeChoose: 'envelope:choose',
  usageTotals: 'usage:totals',
  sourceConfigGet: 'source-config:get',
  sourceConfigSave: 'source-config:save',
  sourceConfigClear: 'source-config:clear',
  sourceHealthList: 'source-health:list',
  sourceProbe: 'source:probe',
  sourceQuery: 'source:query',
  sourceProgress: 'source:progress',
  sourceCancel: 'source:cancel',
  sourceXhsStatus: 'source:xiaohongshu-status',
  sourceXhsLoginQr: 'source:xiaohongshu-login-qr',
  sourceOpenExternal: 'source:open-external',
  evidenceList: 'evidence:list',
  toolCallsList: 'inspector:tool-calls',
  blockedToolsList: 'inspector:blocked-tools',
  destinationGenerate: 'destination:generate',
  destinationConfirmFixed: 'destination:confirm-fixed',
  destinationSelect: 'destination:select',
  researchPrepare: 'research:prepare',
  researchManualChecklistPrepare: 'research:manual-checklist-prepare',
  researchXhsRankingPreview: 'research:xhs-ranking-preview',
  researchXhsRankingExecute: 'research:xhs-ranking-execute',
  researchUserPaste: 'research:user-paste',
  researchDisposition: 'research:disposition',
  researchConflictResolve: 'research:conflict-resolve',
  researchConfirm: 'research:confirm',
  d4Snapshot: 'd4:snapshot',
  d4Progress: 'd4:progress',
  d4Cancel: 'd4:cancel',
  routeResearchSnapshot: 'route-research:snapshot',
  routeResearchPreview: 'route-research:preview',
  routeResearchExecute: 'route-research:execute',
  routeResearchManualPrepare: 'route-research:manual-prepare',
  routeResearchUserPaste: 'route-research:user-paste',
  routeResearchDisposition: 'route-research:disposition',
  routeResearchConflictResolve: 'route-research:conflict-resolve',
  routeResearchConfirm: 'route-research:confirm',
  routeResearchProgress: 'route-research:progress',
  routeResearchCancel: 'route-research:cancel',
  itineraryRouteSnapshot: 'itinerary-route:snapshot',
  itineraryRoutePreview: 'itinerary-route:preview',
  itineraryRouteExecute: 'itinerary-route:execute',
  itineraryRouteSelect: 'itinerary-route:select',
  itineraryRouteManualEvidenceApply: 'itinerary-route:manual-evidence-apply',
  itineraryRouteProgress: 'itinerary-route:progress',
  itineraryRouteCancel: 'itinerary-route:cancel',
  d5Snapshot: 'd5:snapshot',
  railDiscoveryPreview: 'transport:rail-discovery-preview',
  railDiscover: 'transport:rail-discover',
  railSelect: 'transport:rail-select',
  d5SourcePlanPreview: 'transport:source-plan-preview',
  d5SourcePlanExecute: 'transport:source-plan-execute',
  transportPrepare: 'transport:prepare',
  transportSelect: 'transport:select',
  skeletonPrepare: 'skeleton:prepare',
  skeletonPatch: 'skeleton:patch',
  skeletonConfirm: 'skeleton:confirm',
  stayPrepare: 'stay:prepare',
  stayPaste: 'stay:paste',
  staySelect: 'stay:select',
  d5Progress: 'd5:progress',
  routeD5Snapshot: 'route-d5:snapshot',
  routeD5Preview: 'route-d5:preview',
  routeD5Execute: 'route-d5:execute',
  routeD5LegSelect: 'route-d5:leg-select',
  routeD5ManualLeg: 'route-d5:manual-leg',
  routeD5SkeletonPrepare: 'route-d5:skeleton-prepare',
  routeD5SkeletonPatch: 'route-d5:skeleton-patch',
  routeD5StayPaste: 'route-d5:stay-paste',
  routeD5StaySelect: 'route-d5:stay-select',
  routeD5Confirm: 'route-d5:confirm',
  routeD5Progress: 'route-d5:progress',
  routeD5Cancel: 'route-d5:cancel',
  timelineSnapshot: 'timeline:snapshot',
  timelinePrepare: 'timeline:prepare',
  timelinePublish: 'timeline:publish',
  d6Progress: 'd6:progress',
  d6Cancel: 'd6:cancel',
  d7Snapshot: 'd7:snapshot',
  taskDerive: 'task:derive',
  taskUpdate: 'task:update',
  gateCRun: 'gate-c:run',
  itineraryExport: 'itinerary:export',
  inspectorSnapshot: 'inspector:snapshot',
  diagnosticExport: 'inspector:diagnostic-export'
} as const

export const SourceOperationIdSchema = z.string().uuid()
export const SourceProbeIpcRequestSchema = z.object({
  sourceId: ExternalSourceIdSchema,
  operationId: SourceOperationIdSchema
})
export const SourceQueryIpcRequestSchema = z.object({
  operationId: SourceOperationIdSchema,
  query: RepresentativeSourceQuerySchema
})
export const SourceCancelRequestSchema = z.object({ operationId: SourceOperationIdSchema })
export const XhsStatusRequestSchema = SourceCancelRequestSchema
export const XhsLoginQrRequestSchema = z.object({ operationId: SourceOperationIdSchema }).strict()
export const ExternalSourceOpenRequestSchema = z.object({ url: ExternalSourceUrlSchema }).strict()

export const CredentialSaveRequestSchema = z.object({
  id: CredentialIdSchema,
  value: z.string().min(1)
})
export type CredentialSaveRequest = z.infer<typeof CredentialSaveRequestSchema>

export const CredentialClearRequestSchema = z.object({ id: CredentialIdSchema })
export type CredentialClearRequest = z.infer<typeof CredentialClearRequestSchema>

export interface TravelHarnessApi {
  credentials: {
    list(): Promise<IpcResult<CredentialStatusEntry[]>>
    save(request: CredentialSaveRequest): Promise<IpcResult<CredentialStatusEntry>>
    clear(id: CredentialId): Promise<IpcResult<CredentialStatusEntry>>
  }
  provider: {
    get(): Promise<IpcResult<ProviderConfigSummary>>
    save(config: ProviderConfig): Promise<IpcResult<ProviderConfigSummary>>
    clear(): Promise<IpcResult<ProviderConfigSummary>>
  }
  sessions: {
    list(): Promise<IpcResult<SessionSummary[]>>
    create(request: SessionCreateRequest): Promise<IpcResult<SessionSummary>>
    get(sessionId: string): Promise<IpcResult<SessionSummary>>
  }
  chat: {
    submit(request: ChatSubmitRequest): Promise<ChatIpcResult<ChatTurnOutcome>>
    updateConfirmation(request: ConfirmationUpdateRequest): Promise<ChatIpcResult<ChatTurnOutcome>>
    confirm(request: ConfirmationConfirmRequest): Promise<ChatIpcResult<SessionSummary>>
    chooseEnvelope(request: EnvelopeChoiceRequest): Promise<IpcResult<SessionSummary[]>>
    usage(sessionId: string): Promise<IpcResult<UsageTotal[]>>
  }
  sources: {
    getConfig(): Promise<IpcResult<SourceConfig>>
    saveConfig(config: SourceConfig): Promise<IpcResult<SourceConfig>>
    clearConfig(): Promise<IpcResult<SourceConfig>>
    health(): Promise<IpcResult<SourceHealthEntry[]>>
    probe(sourceId: ExternalSourceId, operationId: string): Promise<IpcResult<SourceHealthEntry>>
    query(
      query: RepresentativeSourceQuery,
      operationId: string
    ): Promise<IpcResult<SourceQueryOutcome>>
    onProgress(listener: (event: unknown) => void): () => void
    cancel(operationId: string): Promise<IpcResult<boolean>>
    xiaohongshuStatus(operationId: string): Promise<IpcResult<XhsConnectionStatus>>
    xiaohongshuLoginQr(operationId: string): Promise<IpcResult<XhsLoginQrDisplay>>
    openExternal(url: string): Promise<IpcResult<boolean>>
    evidence(sessionId: string, limit?: number): Promise<IpcResult<EvidenceClaim[]>>
    toolCalls(sessionId?: string, limit?: number): Promise<IpcResult<ToolCallAudit[]>>
    blockedTools(limit?: number): Promise<IpcResult<BlockedToolAudit[]>>
  }
  d4: {
    snapshot(sessionId: string): Promise<IpcResult<D4Snapshot>>
    generateDestination(request: DestinationGenerateRequest): Promise<IpcResult<D4Snapshot>>
    confirmFixedDestination(request: FixedDestinationConfirmRequest): Promise<IpcResult<D4Snapshot>>
    selectDestination(request: DestinationSelectRequest): Promise<IpcResult<D4Snapshot>>
    prepareResearch(request: ResearchPrepareRequest): Promise<IpcResult<D4Snapshot>>
    prepareManualResearch(request: ManualResearchChecklistRequest): Promise<IpcResult<D4Snapshot>>
    previewXhsRanking(sessionId: string): Promise<IpcResult<XhsRankingPreview>>
    executeXhsRanking(request: XhsRankingExecuteRequest): Promise<IpcResult<D4Snapshot>>
    addUserPaste(request: UserPasteRequest): Promise<IpcResult<EvidenceClaim>>
    setDisposition(request: ResearchDispositionRequest): Promise<IpcResult<D4Snapshot>>
    resolveConflict(request: ConflictResolveRequest): Promise<IpcResult<D4Snapshot>>
    confirmResearch(request: ResearchConfirmRequest): Promise<IpcResult<D4Snapshot>>
    onProgress(listener: (event: unknown) => void): () => void
    cancel(operationId: string): Promise<IpcResult<boolean>>
  }
  routeResearch: {
    snapshot(request: RouteResearchSnapshotRequest): Promise<IpcResult<RouteNodeD4Snapshot>>
    preview(request: RouteResearchPreviewRequest): Promise<IpcResult<NodeResearchPlanPreview>>
    execute(request: RouteResearchExecuteRequest): Promise<IpcResult<RouteNodeD4Snapshot>>
    prepareManual(request: RouteResearchManualRequest): Promise<IpcResult<RouteNodeD4Snapshot>>
    addUserPaste(request: RouteResearchUserPasteRequest): Promise<IpcResult<EvidenceClaim>>
    setDisposition(
      request: RouteResearchDispositionRequest
    ): Promise<IpcResult<RouteNodeD4Snapshot>>
    resolveConflict(request: RouteResearchConflictRequest): Promise<IpcResult<RouteNodeD4Snapshot>>
    confirm(request: RouteResearchConfirmRequest): Promise<IpcResult<RouteNodeD4Snapshot>>
    onProgress(listener: (event: unknown) => void): () => void
    cancel(operationId: string): Promise<IpcResult<boolean>>
  }
  itineraryRoutes: {
    snapshot(sessionId: string): Promise<IpcResult<MultiCityRouteSnapshot>>
    preview(sessionId: string): Promise<IpcResult<RoutePlanPreview>>
    execute(request: RoutePlanExecuteRequest): Promise<IpcResult<MultiCityRouteSnapshot>>
    select(request: RouteSelectRequest): Promise<IpcResult<MultiCityRouteSnapshot>>
    applyManualEvidence(
      request: ManualRouteLegEvidenceRequest
    ): Promise<IpcResult<MultiCityRouteSnapshot>>
    onProgress(listener: (event: unknown) => void): () => void
    cancel(operationId: string): Promise<IpcResult<boolean>>
  }
  d5: {
    snapshot(sessionId: string): Promise<IpcResult<D5Snapshot>>
    railDiscoveryPreview(sessionId: string): Promise<IpcResult<RailDiscoveryPreview>>
    discoverRail(request: RailDiscoveryRequest): Promise<IpcResult<RailDiscoveryResult>>
    selectRail(request: RailSelectionRequest): Promise<IpcResult<RailSelectionResult>>
    previewSourcePlan(request: D5SourcePlanPreviewRequest): Promise<IpcResult<D5SourcePlanPreview>>
    executeSourcePlan(
      request: D5SourcePlanExecuteRequest
    ): Promise<IpcResult<D5SourcePlanExecutionResult>>
    prepareTransport(request: TransportPrepareRequest): Promise<IpcResult<D5Snapshot>>
    selectTransport(request: TransportSelectRequest): Promise<IpcResult<D5Snapshot>>
    prepareSkeleton(request: SkeletonPrepareRequest): Promise<IpcResult<D5Snapshot>>
    patchSkeleton(request: SkeletonPatchRequest): Promise<IpcResult<D5Snapshot>>
    confirmSkeleton(request: SkeletonConfirmRequest): Promise<IpcResult<D5Snapshot>>
    prepareStay(request: StayPrepareRequest): Promise<IpcResult<D5Snapshot>>
    addStayPaste(request: StayPasteRequest): Promise<IpcResult<EvidenceClaim>>
    selectStay(request: StaySelectRequest): Promise<IpcResult<D5Snapshot>>
    onProgress(listener: (event: unknown) => void): () => void
  }
  routeD5: {
    snapshot(sessionId: string): Promise<IpcResult<MultiSegmentD5Snapshot>>
    preview(request: RouteD5PreviewRequest): Promise<IpcResult<RouteD5PlanPreview>>
    execute(request: RouteD5ExecuteRequest): Promise<IpcResult<MultiSegmentD5Snapshot>>
    selectLeg(request: RouteD5LegSelectRequest): Promise<IpcResult<MultiSegmentD5Snapshot>>
    attachManualLeg(request: RouteD5ManualLegRequest): Promise<IpcResult<MultiSegmentD5Snapshot>>
    prepareSkeleton(
      request: RouteD5SkeletonPrepareRequest
    ): Promise<IpcResult<MultiSegmentD5Snapshot>>
    patchSkeleton(request: RouteD5SkeletonPatchRequest): Promise<IpcResult<MultiSegmentD5Snapshot>>
    addStayPaste(request: RouteD5StayPasteRequest): Promise<IpcResult<MultiSegmentD5Snapshot>>
    selectStay(request: RouteD5StaySelectRequest): Promise<IpcResult<MultiSegmentD5Snapshot>>
    confirm(request: RouteD5ConfirmRequest): Promise<IpcResult<MultiSegmentD5Snapshot>>
    onProgress(listener: (event: unknown) => void): () => void
    cancel(operationId: string): Promise<IpcResult<boolean>>
  }
  d6: {
    snapshot(sessionId: string, version?: number, routeId?: string): Promise<IpcResult<D6Snapshot>>
    prepare(request: TimelinePrepareRequest): Promise<IpcResult<D6Snapshot>>
    publish(request: TimelinePublishRequest): Promise<IpcResult<D6Snapshot>>
    onProgress(listener: (event: unknown) => void): () => void
    cancel(operationId: string): Promise<IpcResult<boolean>>
  }
  d7: {
    snapshot(sessionId: string, routeId?: string): Promise<IpcResult<D7Snapshot>>
    derive(sessionId: string, routeId?: string): Promise<IpcResult<D7Snapshot>>
    update(request: TaskUpdateRequest): Promise<IpcResult<D7Snapshot>>
    runGateC(sessionId: string, routeId?: string): Promise<IpcResult<D7Snapshot>>
    exportItinerary(request: ItineraryExportRequest): Promise<IpcResult<ExportResult>>
  }
  inspector: {
    snapshot(query: InspectorQuery): Promise<IpcResult<InspectorSnapshot>>
    exportDiagnostic(query: InspectorQuery): Promise<IpcResult<ExportResult>>
  }
}

export const CredentialStatusListSchema = z.array(CredentialStatusEntrySchema)

export const ProviderSaveRequestSchema = ProviderConfigSchema
export const SessionGetRequestSchema = z.object({ sessionId: z.string().min(1) })
export const UsageTotalsRequestSchema = SessionGetRequestSchema
export const SourceConfigSaveRequestSchema = SourceConfigSchema
export const EvidenceListIpcRequestSchema = EvidenceListRequestSchema
export const ToolAuditListIpcRequestSchema = ToolAuditListRequestSchema
export {
  SessionCreateRequestSchema,
  ChatSubmitRequestSchema,
  ConfirmationUpdateRequestSchema,
  ConfirmationConfirmRequestSchema,
  EnvelopeChoiceRequestSchema,
  DestinationGenerateRequestSchema,
  FixedDestinationConfirmRequestSchema,
  DestinationSelectRequestSchema,
  ResearchPrepareRequestSchema,
  ManualResearchChecklistRequestSchema,
  XhsRankingPreviewRequestSchema,
  XhsRankingExecuteRequestSchema,
  UserPasteRequestSchema,
  ResearchDispositionRequestSchema,
  ConflictResolveRequestSchema,
  ResearchConfirmRequestSchema,
  D4SnapshotRequestSchema,
  D4ProgressEventSchema,
  RouteResearchSnapshotRequestSchema,
  RouteResearchPreviewRequestSchema,
  RouteResearchExecuteRequestSchema,
  RouteResearchManualRequestSchema,
  RouteResearchUserPasteRequestSchema,
  RouteResearchDispositionRequestSchema,
  RouteResearchConflictRequestSchema,
  RouteResearchConfirmRequestSchema,
  RouteResearchCancelRequestSchema,
  RouteResearchProgressEventSchema,
  MultiCityRouteSnapshotRequestSchema,
  RoutePlanPreviewRequestSchema,
  RoutePlanExecuteRequestSchema,
  RouteSelectRequestSchema,
  ManualRouteLegEvidenceRequestSchema,
  RouteCancelRequestSchema,
  D5SnapshotRequestSchema,
  RailDiscoveryRequestSchema,
  RailSelectionRequestSchema,
  D5SourcePlanPreviewRequestSchema,
  D5SourcePlanExecuteRequestSchema,
  TransportPrepareRequestSchema,
  TransportSelectRequestSchema,
  SkeletonPrepareRequestSchema,
  SkeletonPatchRequestSchema,
  SkeletonConfirmRequestSchema,
  StayPrepareRequestSchema,
  StayPasteRequestSchema,
  StaySelectRequestSchema,
  D5ProgressEventSchema,
  RouteD5SnapshotRequestSchema,
  RouteD5PreviewRequestSchema,
  RouteD5ExecuteRequestSchema,
  RouteD5LegSelectRequestSchema,
  RouteD5ManualLegRequestSchema,
  RouteD5SkeletonPrepareRequestSchema,
  RouteD5SkeletonPatchRequestSchema,
  RouteD5StayPasteRequestSchema,
  RouteD5StaySelectRequestSchema,
  RouteD5ConfirmRequestSchema,
  RouteD5CancelRequestSchema,
  RouteD5ProgressEventSchema,
  D6SnapshotRequestSchema,
  TimelinePrepareRequestSchema,
  TimelinePublishRequestSchema,
  D6CancelRequestSchema,
  D6ProgressEventSchema,
  D7SnapshotRequestSchema,
  TaskDeriveRequestSchema,
  TaskUpdateRequestSchema,
  GateCRunRequestSchema,
  ItineraryExportRequestSchema,
  InspectorQuerySchema,
  DiagnosticExportRequestSchema
}
