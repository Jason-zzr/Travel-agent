import { z } from 'zod'
import { SerializedAppErrorSchema } from '../../shared/errors'
import {
  CredentialStatusEntrySchema,
  type CredentialId,
  type CredentialStatusEntry
} from '../../shared/schema/credentials'
import type { IpcResult } from '../../shared/ipc-contract'
import type { ChatIpcResult } from '../../shared/ipc-contract'
import {
  ChatTurnOutcomeSchema,
  SessionSummarySchema,
  UsageTotalSchema,
  type ChatTurnOutcome,
  type ConfirmationUpdateRequest,
  type EnvelopeChoiceRequest,
  type SessionSummary,
  type UsageTotal
} from '../../shared/schema/chat'
import { EnvelopeComparisonSchema } from '../../shared/schema/envelope'
import {
  ProviderConfigSummarySchema,
  type ProviderConfig,
  type ProviderConfigSummary
} from '../../shared/schema/provider'
import { EvidenceClaimSchema, type EvidenceClaim } from '../../shared/schema/evidence'
import {
  SourceConfigSchema,
  SourceHealthEntrySchema,
  SourceQueryOutcomeSchema,
  SourceStreamEventSchema,
  type ExternalSourceId,
  type RepresentativeSourceQuery,
  type SourceConfig,
  type SourceHealthEntry,
  type SourceQueryOutcome,
  type SourceStreamEvent
} from '../../shared/schema/source'
import {
  XhsConnectionStatusSchema,
  XhsLoginQrDisplaySchema,
  type XhsConnectionStatus,
  type XhsLoginQrDisplay
} from '../../shared/schema/mcp/xiaohongshu'
import {
  BlockedToolAuditSchema,
  ToolCallAuditSchema,
  type BlockedToolAudit,
  type ToolCallAudit
} from '../../shared/schema/tool-audit'
import {
  D4ProgressEventSchema,
  D4SnapshotSchema,
  NodeResearchPlanPreviewSchema,
  RouteNodeD4SnapshotSchema,
  RouteResearchProgressEventSchema,
  XhsRankingPreviewSchema,
  type ConflictResolveRequest,
  type D4ProgressEvent,
  type D4Snapshot,
  type NodeResearchPlanPreview,
  type RouteNodeD4Snapshot,
  type RouteResearchConfirmRequest,
  type RouteResearchConflictRequest,
  type RouteResearchDispositionRequest,
  type RouteResearchExecuteRequest,
  type RouteResearchManualRequest,
  type RouteResearchPreviewRequest,
  type RouteResearchProgressEvent,
  type RouteResearchSnapshotRequest,
  type RouteResearchUserPasteRequest,
  type DestinationGenerateRequest,
  type FixedDestinationConfirmRequest,
  type ManualResearchChecklistRequest,
  type DestinationSelectRequest,
  type ResearchConfirmRequest,
  type ResearchDispositionRequest,
  type ResearchPrepareRequest,
  type XhsRankingExecuteRequest,
  type XhsRankingPreview,
  type UserPasteRequest
} from '../../shared/schema/d4'
import {
  D5ProgressEventSchema,
  D5SourcePlanExecutionResultSchema,
  D5SourcePlanPreviewSchema,
  D5SnapshotSchema,
  RailDiscoveryPreviewSchema,
  RailDiscoveryResultSchema,
  RailSelectionResultSchema,
  type D5ProgressEvent,
  type D5SourcePlanExecuteRequest,
  type D5SourcePlanExecutionResult,
  type D5SourcePlanPreview,
  type D5SourcePlanPreviewRequest,
  type D5Snapshot,
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
} from '../../shared/schema/d5'
import {
  D6ProgressEventSchema,
  D6SnapshotSchema,
  type D6ProgressEvent,
  type D6Snapshot,
  type TimelinePrepareRequest,
  type TimelinePublishRequest
} from '../../shared/schema/d6'
import {
  D7SnapshotSchema,
  ExportResultSchema,
  InspectorSnapshotSchema,
  type D7Snapshot,
  type ExportResult,
  type InspectorQuery,
  type InspectorSnapshot,
  type ItineraryExportRequest,
  type TaskUpdateRequest
} from '../../shared/schema/d7'
import {
  MultiCityRouteSnapshotSchema,
  RoutePlanPreviewSchema,
  RouteProgressEventSchema,
  type MultiCityRouteSnapshot,
  type ManualRouteLegEvidenceRequest,
  type RoutePlanExecuteRequest,
  type RoutePlanPreview,
  type RouteProgressEvent,
  type RouteSelectRequest
} from '../../shared/schema/itinerary'
import {
  MultiSegmentD5SnapshotSchema,
  RouteD5PlanPreviewSchema,
  RouteD5ProgressEventSchema,
  type MultiSegmentD5Snapshot,
  type RouteD5ConfirmRequest,
  type RouteD5ExecuteRequest,
  type RouteD5LegSelectRequest,
  type RouteD5ManualLegRequest,
  type RouteD5PlanPreview,
  type RouteD5PreviewRequest,
  type RouteD5ProgressEvent,
  type RouteD5SkeletonPatchRequest,
  type RouteD5SkeletonPrepareRequest,
  type RouteD5StayPasteRequest,
  type RouteD5StaySelectRequest
} from '../../shared/schema/route-d5'

const StatusResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: CredentialStatusEntrySchema }),
  z.object({ ok: z.literal(false), error: SerializedAppErrorSchema })
])
const StatusListResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.array(CredentialStatusEntrySchema) }),
  z.object({ ok: z.literal(false), error: SerializedAppErrorSchema })
])

const ProviderSummaryResultSchema = resultSchema(ProviderConfigSummarySchema)
const SessionResultSchema = resultSchema(SessionSummarySchema)
const SessionListResultSchema = resultSchema(z.array(SessionSummarySchema))
const UsageResultSchema = resultSchema(z.array(UsageTotalSchema))
const SourceConfigResultSchema = resultSchema(SourceConfigSchema)
const SourceHealthResultSchema = resultSchema(SourceHealthEntrySchema)
const SourceHealthListResultSchema = resultSchema(z.array(SourceHealthEntrySchema))
const SourceQueryResultSchema = resultSchema(SourceQueryOutcomeSchema)
const CancelResultSchema = resultSchema(z.boolean())
const XhsConnectionStatusResultSchema = resultSchema(XhsConnectionStatusSchema)
const XhsLoginQrResultSchema = resultSchema(XhsLoginQrDisplaySchema)
const EvidenceResultSchema = resultSchema(z.array(EvidenceClaimSchema))
const ToolCallsResultSchema = resultSchema(z.array(ToolCallAuditSchema))
const BlockedToolsResultSchema = resultSchema(z.array(BlockedToolAuditSchema))
const D4SnapshotResultSchema = resultSchema(D4SnapshotSchema)
const XhsRankingPreviewResultSchema = resultSchema(XhsRankingPreviewSchema)
const RouteNodeD4SnapshotResultSchema = resultSchema(RouteNodeD4SnapshotSchema)
const NodeResearchPlanPreviewResultSchema = resultSchema(NodeResearchPlanPreviewSchema)
const MultiCityRouteSnapshotResultSchema = resultSchema(MultiCityRouteSnapshotSchema)
const RoutePlanPreviewResultSchema = resultSchema(RoutePlanPreviewSchema)
const D5SnapshotResultSchema = resultSchema(D5SnapshotSchema)
const RailDiscoveryPreviewResultSchema = resultSchema(RailDiscoveryPreviewSchema)
const RailDiscoveryResultResultSchema = resultSchema(RailDiscoveryResultSchema)
const RailSelectionResultResultSchema = resultSchema(RailSelectionResultSchema)
const D5SourcePlanPreviewResultSchema = resultSchema(D5SourcePlanPreviewSchema)
const D5SourcePlanExecutionResultResultSchema = resultSchema(D5SourcePlanExecutionResultSchema)
const RouteD5SnapshotResultSchema = resultSchema(MultiSegmentD5SnapshotSchema)
const RouteD5PlanPreviewResultSchema = resultSchema(RouteD5PlanPreviewSchema)
const D6SnapshotResultSchema = resultSchema(D6SnapshotSchema)
const D7SnapshotResultSchema = resultSchema(D7SnapshotSchema)
const ExportResultResultSchema = resultSchema(ExportResultSchema)
const InspectorSnapshotResultSchema = resultSchema(InspectorSnapshotSchema)
const EvidenceClaimResultSchema = resultSchema(EvidenceClaimSchema)
const ChatResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: ChatTurnOutcomeSchema }),
  z.object({
    ok: z.literal(false),
    error: SerializedAppErrorSchema,
    comparison: EnvelopeComparisonSchema.optional(),
    dependency: z.string().nullable().optional()
  })
])
const ConfirmResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: SessionSummarySchema }),
  z.object({
    ok: z.literal(false),
    error: SerializedAppErrorSchema,
    comparison: EnvelopeComparisonSchema.optional(),
    dependency: z.string().nullable().optional()
  })
])

export async function listCredentials(): Promise<IpcResult<CredentialStatusEntry[]>> {
  return StatusListResultSchema.parse(await window.api.credentials.list())
}

export async function saveCredential(
  id: CredentialId,
  value: string
): Promise<IpcResult<CredentialStatusEntry>> {
  return StatusResultSchema.parse(await window.api.credentials.save({ id, value }))
}

export async function clearCredential(id: CredentialId): Promise<IpcResult<CredentialStatusEntry>> {
  return StatusResultSchema.parse(await window.api.credentials.clear(id))
}

export async function getProviderConfig(): Promise<IpcResult<ProviderConfigSummary>> {
  return ProviderSummaryResultSchema.parse(await window.api.provider.get())
}

export async function saveProviderConfig(
  config: ProviderConfig
): Promise<IpcResult<ProviderConfigSummary>> {
  return ProviderSummaryResultSchema.parse(await window.api.provider.save(config))
}

export async function listSessions(): Promise<IpcResult<SessionSummary[]>> {
  return SessionListResultSchema.parse(await window.api.sessions.list())
}

export async function createSession(title: string | null): Promise<IpcResult<SessionSummary>> {
  return SessionResultSchema.parse(await window.api.sessions.create({ title }))
}

export async function submitChat(
  sessionId: string,
  text: string
): Promise<ChatIpcResult<ChatTurnOutcome>> {
  return ChatResultSchema.parse(await window.api.chat.submit({ sessionId, text }))
}

export async function confirmBasics(sessionId: string): Promise<ChatIpcResult<SessionSummary>> {
  return ConfirmResultSchema.parse(await window.api.chat.confirm({ sessionId }))
}

export async function updateConfirmation(
  request: ConfirmationUpdateRequest
): Promise<ChatIpcResult<ChatTurnOutcome>> {
  return ChatResultSchema.parse(await window.api.chat.updateConfirmation(request))
}

export async function chooseEnvelope(
  request: EnvelopeChoiceRequest
): Promise<IpcResult<SessionSummary[]>> {
  return SessionListResultSchema.parse(await window.api.chat.chooseEnvelope(request))
}

export async function getUsage(sessionId: string): Promise<IpcResult<UsageTotal[]>> {
  return UsageResultSchema.parse(await window.api.chat.usage(sessionId))
}

export async function getSourceConfig(): Promise<IpcResult<SourceConfig>> {
  return SourceConfigResultSchema.parse(await window.api.sources.getConfig())
}

export async function saveSourceConfig(config: SourceConfig): Promise<IpcResult<SourceConfig>> {
  return SourceConfigResultSchema.parse(await window.api.sources.saveConfig(config))
}

export async function listSourceHealth(): Promise<IpcResult<SourceHealthEntry[]>> {
  return SourceHealthListResultSchema.parse(await window.api.sources.health())
}

export async function probeSource(
  sourceId: ExternalSourceId,
  operationId: string
): Promise<IpcResult<SourceHealthEntry>> {
  return SourceHealthResultSchema.parse(await window.api.sources.probe(sourceId, operationId))
}

export async function runSourceQuery(
  query: RepresentativeSourceQuery,
  operationId: string
): Promise<IpcResult<SourceQueryOutcome>> {
  return SourceQueryResultSchema.parse(await window.api.sources.query(query, operationId))
}

export function subscribeSourceProgress(listener: (event: SourceStreamEvent) => void): () => void {
  return window.api.sources.onProgress((raw) => {
    const parsed = SourceStreamEventSchema.safeParse(raw)
    if (parsed.success) listener(parsed.data)
  })
}

export async function cancelSourceOperation(operationId: string): Promise<IpcResult<boolean>> {
  return CancelResultSchema.parse(await window.api.sources.cancel(operationId))
}

export async function getXhsConnectionStatus(
  operationId: string
): Promise<IpcResult<XhsConnectionStatus>> {
  return XhsConnectionStatusResultSchema.parse(
    await window.api.sources.xiaohongshuStatus(operationId)
  )
}

export async function getXhsLoginQr(operationId: string): Promise<IpcResult<XhsLoginQrDisplay>> {
  return XhsLoginQrResultSchema.parse(await window.api.sources.xiaohongshuLoginQr(operationId))
}

export async function openExternalSource(url: string): Promise<IpcResult<boolean>> {
  return CancelResultSchema.parse(await window.api.sources.openExternal(url))
}

export async function listEvidence(
  sessionId: string,
  limit = 100
): Promise<IpcResult<EvidenceClaim[]>> {
  return EvidenceResultSchema.parse(await window.api.sources.evidence(sessionId, limit))
}

export async function listToolCalls(
  sessionId?: string,
  limit = 100
): Promise<IpcResult<ToolCallAudit[]>> {
  return ToolCallsResultSchema.parse(await window.api.sources.toolCalls(sessionId, limit))
}

export async function listBlockedTools(limit = 100): Promise<IpcResult<BlockedToolAudit[]>> {
  return BlockedToolsResultSchema.parse(await window.api.sources.blockedTools(limit))
}

export async function getD4Snapshot(sessionId: string): Promise<IpcResult<D4Snapshot>> {
  return D4SnapshotResultSchema.parse(await window.api.d4.snapshot(sessionId))
}

export async function generateDestinationCandidates(
  request: DestinationGenerateRequest
): Promise<IpcResult<D4Snapshot>> {
  return D4SnapshotResultSchema.parse(await window.api.d4.generateDestination(request))
}

export async function confirmFixedDestination(
  request: FixedDestinationConfirmRequest
): Promise<IpcResult<D4Snapshot>> {
  return D4SnapshotResultSchema.parse(await window.api.d4.confirmFixedDestination(request))
}

export async function selectDestination(
  request: DestinationSelectRequest
): Promise<IpcResult<D4Snapshot>> {
  return D4SnapshotResultSchema.parse(await window.api.d4.selectDestination(request))
}

export async function prepareResearch(
  request: ResearchPrepareRequest
): Promise<IpcResult<D4Snapshot>> {
  return D4SnapshotResultSchema.parse(await window.api.d4.prepareResearch(request))
}

export async function prepareManualResearch(
  request: ManualResearchChecklistRequest
): Promise<IpcResult<D4Snapshot>> {
  return D4SnapshotResultSchema.parse(await window.api.d4.prepareManualResearch(request))
}

export async function previewXhsRanking(sessionId: string): Promise<IpcResult<XhsRankingPreview>> {
  return XhsRankingPreviewResultSchema.parse(await window.api.d4.previewXhsRanking(sessionId))
}

export async function executeXhsRanking(
  request: XhsRankingExecuteRequest
): Promise<IpcResult<D4Snapshot>> {
  return D4SnapshotResultSchema.parse(await window.api.d4.executeXhsRanking(request))
}

export async function addUserPaste(request: UserPasteRequest): Promise<IpcResult<EvidenceClaim>> {
  return EvidenceClaimResultSchema.parse(await window.api.d4.addUserPaste(request))
}

export async function setResearchDisposition(
  request: ResearchDispositionRequest
): Promise<IpcResult<D4Snapshot>> {
  return D4SnapshotResultSchema.parse(await window.api.d4.setDisposition(request))
}

export async function resolveResearchConflict(
  request: ConflictResolveRequest
): Promise<IpcResult<D4Snapshot>> {
  return D4SnapshotResultSchema.parse(await window.api.d4.resolveConflict(request))
}

export async function confirmResearch(
  request: ResearchConfirmRequest
): Promise<IpcResult<D4Snapshot>> {
  return D4SnapshotResultSchema.parse(await window.api.d4.confirmResearch(request))
}

export function subscribeD4Progress(listener: (event: D4ProgressEvent) => void): () => void {
  return window.api.d4.onProgress((raw) => {
    const parsed = D4ProgressEventSchema.safeParse(raw)
    if (parsed.success) listener(parsed.data)
  })
}

export async function cancelD4Operation(operationId: string): Promise<IpcResult<boolean>> {
  return CancelResultSchema.parse(await window.api.d4.cancel(operationId))
}

export async function getRouteNodeResearchSnapshot(
  request: RouteResearchSnapshotRequest
): Promise<IpcResult<RouteNodeD4Snapshot>> {
  return RouteNodeD4SnapshotResultSchema.parse(await window.api.routeResearch.snapshot(request))
}

export async function previewRouteNodeResearch(
  request: RouteResearchPreviewRequest
): Promise<IpcResult<NodeResearchPlanPreview>> {
  return NodeResearchPlanPreviewResultSchema.parse(await window.api.routeResearch.preview(request))
}

export async function executeRouteNodeResearch(
  request: RouteResearchExecuteRequest
): Promise<IpcResult<RouteNodeD4Snapshot>> {
  return RouteNodeD4SnapshotResultSchema.parse(await window.api.routeResearch.execute(request))
}

export async function prepareManualRouteNodeResearch(
  request: RouteResearchManualRequest
): Promise<IpcResult<RouteNodeD4Snapshot>> {
  return RouteNodeD4SnapshotResultSchema.parse(
    await window.api.routeResearch.prepareManual(request)
  )
}

export async function addRouteNodeUserPaste(
  request: RouteResearchUserPasteRequest
): Promise<IpcResult<EvidenceClaim>> {
  return EvidenceClaimResultSchema.parse(await window.api.routeResearch.addUserPaste(request))
}

export async function setRouteNodeResearchDisposition(
  request: RouteResearchDispositionRequest
): Promise<IpcResult<RouteNodeD4Snapshot>> {
  return RouteNodeD4SnapshotResultSchema.parse(
    await window.api.routeResearch.setDisposition(request)
  )
}

export async function resolveRouteNodeResearchConflict(
  request: RouteResearchConflictRequest
): Promise<IpcResult<RouteNodeD4Snapshot>> {
  return RouteNodeD4SnapshotResultSchema.parse(
    await window.api.routeResearch.resolveConflict(request)
  )
}

export async function confirmRouteNodeResearch(
  request: RouteResearchConfirmRequest
): Promise<IpcResult<RouteNodeD4Snapshot>> {
  return RouteNodeD4SnapshotResultSchema.parse(await window.api.routeResearch.confirm(request))
}

export function subscribeRouteNodeResearchProgress(
  listener: (event: RouteResearchProgressEvent) => void
): () => void {
  return window.api.routeResearch.onProgress((raw) => {
    const parsed = RouteResearchProgressEventSchema.safeParse(raw)
    if (parsed.success) listener(parsed.data)
  })
}

export async function cancelRouteNodeResearchOperation(
  operationId: string
): Promise<IpcResult<boolean>> {
  return CancelResultSchema.parse(await window.api.routeResearch.cancel(operationId))
}

export async function getMultiCityRouteSnapshot(
  sessionId: string
): Promise<IpcResult<MultiCityRouteSnapshot>> {
  return MultiCityRouteSnapshotResultSchema.parse(
    await window.api.itineraryRoutes.snapshot(sessionId)
  )
}

export async function previewMultiCityRoutes(
  sessionId: string
): Promise<IpcResult<RoutePlanPreview>> {
  return RoutePlanPreviewResultSchema.parse(await window.api.itineraryRoutes.preview(sessionId))
}

export async function executeMultiCityRoutes(
  request: RoutePlanExecuteRequest
): Promise<IpcResult<MultiCityRouteSnapshot>> {
  return MultiCityRouteSnapshotResultSchema.parse(await window.api.itineraryRoutes.execute(request))
}

export async function selectMultiCityRoute(
  request: RouteSelectRequest
): Promise<IpcResult<MultiCityRouteSnapshot>> {
  return MultiCityRouteSnapshotResultSchema.parse(await window.api.itineraryRoutes.select(request))
}

export async function applyManualRouteLegEvidence(
  request: ManualRouteLegEvidenceRequest
): Promise<IpcResult<MultiCityRouteSnapshot>> {
  return MultiCityRouteSnapshotResultSchema.parse(
    await window.api.itineraryRoutes.applyManualEvidence(request)
  )
}

export function subscribeMultiCityRouteProgress(
  listener: (event: RouteProgressEvent) => void
): () => void {
  return window.api.itineraryRoutes.onProgress((raw) => {
    const parsed = RouteProgressEventSchema.safeParse(raw)
    if (parsed.success) listener(parsed.data)
  })
}

export async function cancelMultiCityRouteOperation(
  operationId: string
): Promise<IpcResult<boolean>> {
  return CancelResultSchema.parse(await window.api.itineraryRoutes.cancel(operationId))
}

export async function getD5Snapshot(sessionId: string): Promise<IpcResult<D5Snapshot>> {
  return D5SnapshotResultSchema.parse(await window.api.d5.snapshot(sessionId))
}

export async function getRailDiscoveryPreview(
  sessionId: string
): Promise<IpcResult<RailDiscoveryPreview>> {
  return RailDiscoveryPreviewResultSchema.parse(await window.api.d5.railDiscoveryPreview(sessionId))
}

export async function discoverRailOptions(
  request: RailDiscoveryRequest
): Promise<IpcResult<RailDiscoveryResult>> {
  return RailDiscoveryResultResultSchema.parse(await window.api.d5.discoverRail(request))
}

export async function selectRailOptions(
  request: RailSelectionRequest
): Promise<IpcResult<RailSelectionResult>> {
  return RailSelectionResultResultSchema.parse(await window.api.d5.selectRail(request))
}

export async function previewD5SourcePlan(
  request: D5SourcePlanPreviewRequest
): Promise<IpcResult<D5SourcePlanPreview>> {
  return D5SourcePlanPreviewResultSchema.parse(await window.api.d5.previewSourcePlan(request))
}

export async function executeD5SourcePlan(
  request: D5SourcePlanExecuteRequest
): Promise<IpcResult<D5SourcePlanExecutionResult>> {
  return D5SourcePlanExecutionResultResultSchema.parse(
    await window.api.d5.executeSourcePlan(request)
  )
}

export async function prepareTransport(
  request: TransportPrepareRequest
): Promise<IpcResult<D5Snapshot>> {
  return D5SnapshotResultSchema.parse(await window.api.d5.prepareTransport(request))
}

export async function selectTransport(
  request: TransportSelectRequest
): Promise<IpcResult<D5Snapshot>> {
  return D5SnapshotResultSchema.parse(await window.api.d5.selectTransport(request))
}

export async function prepareSkeleton(
  request: SkeletonPrepareRequest
): Promise<IpcResult<D5Snapshot>> {
  return D5SnapshotResultSchema.parse(await window.api.d5.prepareSkeleton(request))
}

export async function confirmSkeleton(
  request: SkeletonConfirmRequest
): Promise<IpcResult<D5Snapshot>> {
  return D5SnapshotResultSchema.parse(await window.api.d5.confirmSkeleton(request))
}

export async function patchSkeleton(request: SkeletonPatchRequest): Promise<IpcResult<D5Snapshot>> {
  return D5SnapshotResultSchema.parse(await window.api.d5.patchSkeleton(request))
}

export async function prepareStay(request: StayPrepareRequest): Promise<IpcResult<D5Snapshot>> {
  return D5SnapshotResultSchema.parse(await window.api.d5.prepareStay(request))
}

export async function selectStay(request: StaySelectRequest): Promise<IpcResult<D5Snapshot>> {
  return D5SnapshotResultSchema.parse(await window.api.d5.selectStay(request))
}

export async function addStayPaste(request: StayPasteRequest): Promise<IpcResult<EvidenceClaim>> {
  return EvidenceClaimResultSchema.parse(await window.api.d5.addStayPaste(request))
}

export function subscribeD5Progress(listener: (event: D5ProgressEvent) => void): () => void {
  return window.api.d5.onProgress((raw) => {
    const parsed = D5ProgressEventSchema.safeParse(raw)
    if (parsed.success) listener(parsed.data)
  })
}

export async function getRouteD5Snapshot(
  sessionId: string
): Promise<IpcResult<MultiSegmentD5Snapshot>> {
  return RouteD5SnapshotResultSchema.parse(await window.api.routeD5.snapshot(sessionId))
}

export async function previewRouteD5Plan(
  request: RouteD5PreviewRequest
): Promise<IpcResult<RouteD5PlanPreview>> {
  return RouteD5PlanPreviewResultSchema.parse(await window.api.routeD5.preview(request))
}

export async function executeRouteD5Plan(
  request: RouteD5ExecuteRequest
): Promise<IpcResult<MultiSegmentD5Snapshot>> {
  return RouteD5SnapshotResultSchema.parse(await window.api.routeD5.execute(request))
}

export async function selectRouteD5Leg(
  request: RouteD5LegSelectRequest
): Promise<IpcResult<MultiSegmentD5Snapshot>> {
  return RouteD5SnapshotResultSchema.parse(await window.api.routeD5.selectLeg(request))
}

export async function attachRouteD5ManualLeg(
  request: RouteD5ManualLegRequest
): Promise<IpcResult<MultiSegmentD5Snapshot>> {
  return RouteD5SnapshotResultSchema.parse(await window.api.routeD5.attachManualLeg(request))
}

export async function prepareRouteD5Skeleton(
  request: RouteD5SkeletonPrepareRequest
): Promise<IpcResult<MultiSegmentD5Snapshot>> {
  return RouteD5SnapshotResultSchema.parse(await window.api.routeD5.prepareSkeleton(request))
}

export async function patchRouteD5Skeleton(
  request: RouteD5SkeletonPatchRequest
): Promise<IpcResult<MultiSegmentD5Snapshot>> {
  return RouteD5SnapshotResultSchema.parse(await window.api.routeD5.patchSkeleton(request))
}

export async function addRouteD5StayPaste(
  request: RouteD5StayPasteRequest
): Promise<IpcResult<MultiSegmentD5Snapshot>> {
  return RouteD5SnapshotResultSchema.parse(await window.api.routeD5.addStayPaste(request))
}

export async function selectRouteD5Stay(
  request: RouteD5StaySelectRequest
): Promise<IpcResult<MultiSegmentD5Snapshot>> {
  return RouteD5SnapshotResultSchema.parse(await window.api.routeD5.selectStay(request))
}

export async function confirmRouteD5(
  request: RouteD5ConfirmRequest
): Promise<IpcResult<MultiSegmentD5Snapshot>> {
  return RouteD5SnapshotResultSchema.parse(await window.api.routeD5.confirm(request))
}

export function subscribeRouteD5Progress(
  listener: (event: RouteD5ProgressEvent) => void
): () => void {
  return window.api.routeD5.onProgress((raw) => {
    const parsed = RouteD5ProgressEventSchema.safeParse(raw)
    if (parsed.success) listener(parsed.data)
  })
}

export async function cancelRouteD5Operation(operationId: string): Promise<IpcResult<boolean>> {
  return CancelResultSchema.parse(await window.api.routeD5.cancel(operationId))
}

export async function getD6Snapshot(
  sessionId: string,
  version?: number,
  routeId?: string
): Promise<IpcResult<D6Snapshot>> {
  return D6SnapshotResultSchema.parse(await window.api.d6.snapshot(sessionId, version, routeId))
}

export async function prepareTimeline(
  request: TimelinePrepareRequest
): Promise<IpcResult<D6Snapshot>> {
  return D6SnapshotResultSchema.parse(await window.api.d6.prepare(request))
}

export async function publishTimeline(
  request: TimelinePublishRequest
): Promise<IpcResult<D6Snapshot>> {
  return D6SnapshotResultSchema.parse(await window.api.d6.publish(request))
}

export function subscribeD6Progress(listener: (event: D6ProgressEvent) => void): () => void {
  return window.api.d6.onProgress((raw) => {
    const parsed = D6ProgressEventSchema.safeParse(raw)
    if (parsed.success) listener(parsed.data)
  })
}

export async function cancelD6Operation(operationId: string): Promise<IpcResult<boolean>> {
  return CancelResultSchema.parse(await window.api.d6.cancel(operationId))
}

export async function getD7Snapshot(
  sessionId: string,
  routeId?: string
): Promise<IpcResult<D7Snapshot>> {
  return D7SnapshotResultSchema.parse(await window.api.d7.snapshot(sessionId, routeId))
}

export async function deriveTasks(
  sessionId: string,
  routeId?: string
): Promise<IpcResult<D7Snapshot>> {
  return D7SnapshotResultSchema.parse(await window.api.d7.derive(sessionId, routeId))
}

export async function updateTask(request: TaskUpdateRequest): Promise<IpcResult<D7Snapshot>> {
  return D7SnapshotResultSchema.parse(await window.api.d7.update(request))
}

export async function runGateC(
  sessionId: string,
  routeId?: string
): Promise<IpcResult<D7Snapshot>> {
  return D7SnapshotResultSchema.parse(await window.api.d7.runGateC(sessionId, routeId))
}

export async function exportItinerary(
  request: ItineraryExportRequest
): Promise<IpcResult<ExportResult>> {
  return ExportResultResultSchema.parse(await window.api.d7.exportItinerary(request))
}

export async function getInspectorSnapshot(
  query: InspectorQuery
): Promise<IpcResult<InspectorSnapshot>> {
  return InspectorSnapshotResultSchema.parse(await window.api.inspector.snapshot(query))
}

export async function exportDiagnostic(query: InspectorQuery): Promise<IpcResult<ExportResult>> {
  return ExportResultResultSchema.parse(await window.api.inspector.exportDiagnostic(query))
}

function resultSchema<T extends z.ZodTypeAny>(data: T): z.ZodTypeAny {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), data }),
    z.object({ ok: z.literal(false), error: SerializedAppErrorSchema })
  ])
}
