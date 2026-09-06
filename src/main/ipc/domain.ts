import { dialog, ipcMain, shell } from 'electron'
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import type { Context } from 'cordis'
import { AppError } from '../../shared/errors'
import {
  ChatSubmitRequestSchema,
  ConfirmationConfirmRequestSchema,
  ConfirmationUpdateRequestSchema,
  EnvelopeChoiceRequestSchema,
  IPC_CHANNELS,
  ProviderSaveRequestSchema,
  SessionCreateRequestSchema,
  SessionGetRequestSchema,
  UsageTotalsRequestSchema,
  SourceConfigSaveRequestSchema,
  SourceProbeIpcRequestSchema,
  SourceQueryIpcRequestSchema,
  SourceCancelRequestSchema,
  EvidenceListIpcRequestSchema,
  ExternalSourceOpenRequestSchema,
  ToolAuditListIpcRequestSchema,
  ConflictResolveRequestSchema,
  D4SnapshotRequestSchema,
  DestinationGenerateRequestSchema,
  DestinationSelectRequestSchema,
  ResearchConfirmRequestSchema,
  ResearchDispositionRequestSchema,
  ResearchPrepareRequestSchema,
  XhsRankingExecuteRequestSchema,
  XhsRankingPreviewRequestSchema,
  UserPasteRequestSchema,
  XhsStatusRequestSchema,
  XhsLoginQrRequestSchema,
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
  D6SnapshotRequestSchema,
  TimelinePrepareRequestSchema,
  TimelinePublishRequestSchema,
  D6CancelRequestSchema,
  D7SnapshotRequestSchema,
  TaskDeriveRequestSchema,
  TaskUpdateRequestSchema,
  GateCRunRequestSchema,
  ItineraryExportRequestSchema,
  InspectorQuerySchema,
  DiagnosticExportRequestSchema,
  type ChatIpcResult
} from '../../shared/ipc-contract'
import type { ChatTurnOutcome, SessionSummary } from '../../shared/schema/chat'
import { ExportResultSchema, type ExportResult } from '../../shared/schema/d7'
import { SourceStreamEventSchema } from '../../shared/schema/source'
import {
  prepareDiagnosticExport,
  writePreparedExport,
  type PreparedExport
} from '../export/d7-export'
import { asIpcResult } from './wrap'
import { assertAuthorizedSender } from './authorize'
import { createFixedDestinationConfirmHandler } from './fixed-destination'
import { createItineraryRouteHandlers } from './itinerary-route'
import { createManualResearchPrepareHandler } from './manual-research'
import { createRouteResearchHandlers } from './route-research'
import { createRouteD5Handlers } from './route-d5'
import { parseRequest } from './request'
import { RouteD5Service } from '../route-d5-service'

export function registerDomainIpc(context: Context, sender: WebContents): () => void {
  const visibleSessionIds = new Set(
    context.coordinator.listSessions().map((item) => item.sessionId)
  )
  const authorize = (event: IpcMainInvokeEvent): void => assertAuthorizedSender(event, sender)
  const requireVisible = (sessionId: string): void => {
    if (!visibleSessionIds.has(sessionId)) {
      throw new AppError('IPC_FORBIDDEN', '该会话未暴露给当前窗口。')
    }
  }
  const itineraryRouteHandlers = createItineraryRouteHandlers({
    authorize,
    requireVisible,
    snapshot: (sessionId) => context.coordinator.multiCityRouteSnapshot({ sessionId }),
    preview: (sessionId) => context.coordinator.previewMultiCityRoutes({ sessionId }),
    execute: (request, onProgress) =>
      context.coordinator.executeMultiCityRoutes(request, onProgress),
    select: (request) => context.coordinator.selectMultiCityRoute(request),
    applyManualEvidence: (request) => context.coordinator.applyManualRouteLegEvidence(request),
    cancel: (operationId) => context.coordinator.cancelMultiCityRouteOperation({ operationId }),
    emitProgress: (progress) => {
      if (!sender.isDestroyed()) sender.send(IPC_CHANNELS.itineraryRouteProgress, progress)
    }
  })
  const routeResearchHandlers = createRouteResearchHandlers({
    authorize,
    requireVisible,
    snapshot: (request) => context.coordinator.routeNodeResearchSnapshot(request),
    preview: (request) => context.coordinator.previewRouteNodeResearch(request),
    execute: (request, onProgress) =>
      context.coordinator.executeRouteNodeResearch(request, onProgress),
    prepareManual: (request) => context.coordinator.prepareManualRouteNodeResearch(request),
    addUserPaste: (request) => context.coordinator.addRouteNodeUserPaste(request),
    setDisposition: (request) => context.coordinator.setRouteNodeResearchDisposition(request),
    resolveConflict: (request) => context.coordinator.resolveRouteNodeResearchConflict(request),
    confirm: (request) => context.coordinator.confirmRouteNodeResearch(request),
    cancel: (operationId) => context.coordinator.cancelRouteNodeResearchOperation({ operationId }),
    emitProgress: (progress) => {
      if (!sender.isDestroyed()) sender.send(IPC_CHANNELS.routeResearchProgress, progress)
    }
  })
  const routeD5Service = new RouteD5Service(context)
  const routeD5Handlers = createRouteD5Handlers({
    authorize,
    requireVisible,
    snapshot: (sessionId) => routeD5Service.snapshot(sessionId),
    preview: (request) => routeD5Service.preview(request),
    execute: (request, onProgress) => routeD5Service.execute(request, onProgress),
    selectLeg: (request) => routeD5Service.selectRail(request),
    attachManualLeg: (request) => routeD5Service.attachManualLeg(request),
    prepareSkeleton: (request) => routeD5Service.prepareSkeleton(request),
    patchSkeleton: (request) => routeD5Service.patchSkeleton(request),
    addStayPaste: (request) => routeD5Service.addStayPaste(request),
    selectStay: (request) => routeD5Service.selectStay(request),
    confirm: (request) => routeD5Service.confirm(request.scope),
    cancel: (operationId) => routeD5Service.cancel(operationId),
    emitProgress: (progress) => {
      if (!sender.isDestroyed()) sender.send(IPC_CHANNELS.routeD5Progress, progress)
    }
  })

  ipcMain.handle(IPC_CHANNELS.providerGet, (event) =>
    asIpcResult(async () => {
      authorize(event)
      return context.provider.configSummary()
    })
  )
  ipcMain.handle(IPC_CHANNELS.providerSave, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      return context.provider.saveConfig(parseRequest(ProviderSaveRequestSchema, raw))
    })
  )
  ipcMain.handle(IPC_CHANNELS.providerClear, (event) =>
    asIpcResult(async () => {
      authorize(event)
      return context.provider.clearConfig()
    })
  )
  ipcMain.handle(IPC_CHANNELS.sessionsList, (event) =>
    asIpcResult(async () => {
      authorize(event)
      const sessions = context.coordinator.listSessions()
      for (const session of sessions) visibleSessionIds.add(session.sessionId)
      return sessions
    })
  )
  ipcMain.handle(IPC_CHANNELS.sessionsCreate, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(SessionCreateRequestSchema, raw)
      const session = await context.coordinator.createSession(request.title)
      visibleSessionIds.add(session.sessionId)
      return session
    })
  )
  ipcMain.handle(IPC_CHANNELS.sessionsGet, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const { sessionId } = parseRequest(SessionGetRequestSchema, raw)
      requireVisible(sessionId)
      return context.coordinator.getSession(sessionId)
    })
  )
  ipcMain.handle(IPC_CHANNELS.chatSubmit, async (event, raw: unknown) => {
    try {
      authorize(event)
      const request = parseRequest(ChatSubmitRequestSchema, raw)
      requireVisible(request.sessionId)
      return asChatResult(await context.coordinator.submitChatTurn(request.sessionId, request.text))
    } catch (error) {
      return asChatFailure(error)
    }
  })
  ipcMain.handle(IPC_CHANNELS.confirmationUpdate, async (event, raw: unknown) => {
    try {
      authorize(event)
      const request = parseRequest(ConfirmationUpdateRequestSchema, raw)
      requireVisible(request.sessionId)
      return asChatResult(
        await context.coordinator.updateConfirmation(request.sessionId, request.basics)
      )
    } catch (error) {
      return asChatFailure(error)
    }
  })
  ipcMain.handle(IPC_CHANNELS.confirmationConfirm, async (event, raw: unknown) => {
    try {
      authorize(event)
      const request = parseRequest(ConfirmationConfirmRequestSchema, raw)
      requireVisible(request.sessionId)
      const result = await context.coordinator.confirmBasics(request.sessionId)
      if ('sessionId' in result) return { ok: true, data: result }
      return asChatResult(result)
    } catch (error) {
      return asChatFailure(error)
    }
  })
  ipcMain.handle(IPC_CHANNELS.envelopeChoose, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(EnvelopeChoiceRequestSchema, raw)
      requireVisible(request.sessionId)
      const sessions = await context.coordinator.chooseEnvelope(request)
      for (const session of sessions) visibleSessionIds.add(session.sessionId)
      return sessions
    })
  )
  ipcMain.handle(IPC_CHANNELS.usageTotals, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const { sessionId } = parseRequest(UsageTotalsRequestSchema, raw)
      requireVisible(sessionId)
      return context.provider.usageTotals(sessionId)
    })
  )
  ipcMain.handle(IPC_CHANNELS.sourceConfigGet, (event) =>
    asIpcResult(async () => {
      authorize(event)
      return context.tools.sourceConfig()
    })
  )
  ipcMain.handle(IPC_CHANNELS.sourceConfigSave, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      return context.tools.saveSourceConfig(parseRequest(SourceConfigSaveRequestSchema, raw))
    })
  )
  ipcMain.handle(IPC_CHANNELS.sourceConfigClear, (event) =>
    asIpcResult(async () => {
      authorize(event)
      return context.tools.clearSourceConfig()
    })
  )
  ipcMain.handle(IPC_CHANNELS.sourceHealthList, (event) =>
    asIpcResult(async () => {
      authorize(event)
      return context.tools.listSourceHealth()
    })
  )
  ipcMain.handle(IPC_CHANNELS.sourceProbe, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(SourceProbeIpcRequestSchema, raw)
      return context.tools.probe(request.sourceId, 15_000, request.operationId)
    })
  )
  ipcMain.handle(IPC_CHANNELS.sourceQuery, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(SourceQueryIpcRequestSchema, raw)
      requireVisible(request.query.sessionId)
      return context.tools.runRepresentativeQuery(request.query, request.operationId, (payload) => {
        if (sender.isDestroyed()) return
        sender.send(
          IPC_CHANNELS.sourceProgress,
          SourceStreamEventSchema.parse({
            operationId: request.operationId,
            sourceId: 'SRC_SEARCH',
            payload
          })
        )
      })
    })
  )
  ipcMain.handle(IPC_CHANNELS.sourceCancel, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(SourceCancelRequestSchema, raw)
      return context.tools.cancelOperation(request.operationId)
    })
  )
  ipcMain.handle(IPC_CHANNELS.sourceXhsStatus, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(XhsStatusRequestSchema, raw)
      return context.tools.xhsConnectionStatus(15_000, request.operationId)
    })
  )
  ipcMain.handle(IPC_CHANNELS.sourceXhsLoginQr, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(XhsLoginQrRequestSchema, raw)
      return context.tools.xhsLoginQr(60_000, request.operationId)
    })
  )
  ipcMain.handle(IPC_CHANNELS.sourceOpenExternal, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(ExternalSourceOpenRequestSchema, raw)
      await shell.openExternal(request.url, { activate: true })
      return true
    })
  )
  ipcMain.handle(IPC_CHANNELS.evidenceList, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(EvidenceListIpcRequestSchema, raw)
      requireVisible(request.sessionId)
      return context.tools.listEvidence(request.sessionId, request.limit)
    })
  )
  ipcMain.handle(IPC_CHANNELS.toolCallsList, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(ToolAuditListIpcRequestSchema, raw)
      if (request.sessionId) requireVisible(request.sessionId)
      return context.tools.listToolCalls(request.sessionId, request.limit)
    })
  )
  ipcMain.handle(IPC_CHANNELS.blockedToolsList, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(ToolAuditListIpcRequestSchema, raw)
      return context.tools.listBlockedTools(request.limit)
    })
  )
  ipcMain.handle(IPC_CHANNELS.d4Snapshot, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(D4SnapshotRequestSchema, raw)
      requireVisible(request.sessionId)
      return context.coordinator.d4Snapshot(request.sessionId)
    })
  )
  ipcMain.handle(IPC_CHANNELS.destinationGenerate, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(DestinationGenerateRequestSchema, raw)
      requireVisible(request.sessionId)
      return context.coordinator.generateDestinationCandidates(request, (progress) => {
        if (!sender.isDestroyed()) sender.send(IPC_CHANNELS.d4Progress, progress)
      })
    })
  )
  ipcMain.handle(
    IPC_CHANNELS.destinationConfirmFixed,
    createFixedDestinationConfirmHandler({
      authorize,
      requireVisible,
      confirm: (request) => context.coordinator.confirmFixedDestination(request)
    })
  )
  ipcMain.handle(IPC_CHANNELS.destinationSelect, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(DestinationSelectRequestSchema, raw)
      requireVisible(request.sessionId)
      return context.coordinator.selectDestination(request)
    })
  )
  ipcMain.handle(IPC_CHANNELS.researchPrepare, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(ResearchPrepareRequestSchema, raw)
      requireVisible(request.sessionId)
      return context.coordinator.prepareResearch(request, (progress) => {
        if (!sender.isDestroyed()) sender.send(IPC_CHANNELS.d4Progress, progress)
      })
    })
  )
  ipcMain.handle(
    IPC_CHANNELS.researchManualChecklistPrepare,
    createManualResearchPrepareHandler({
      authorize,
      requireVisible,
      prepare: (request) => context.coordinator.prepareManualResearch(request)
    })
  )
  ipcMain.handle(IPC_CHANNELS.researchXhsRankingPreview, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(XhsRankingPreviewRequestSchema, raw)
      requireVisible(request.sessionId)
      return context.coordinator.previewXhsRanking(request)
    })
  )
  ipcMain.handle(IPC_CHANNELS.researchXhsRankingExecute, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(XhsRankingExecuteRequestSchema, raw)
      requireVisible(request.sessionId)
      return context.coordinator.executeXhsRanking(request, (progress) => {
        if (!sender.isDestroyed()) sender.send(IPC_CHANNELS.d4Progress, progress)
      })
    })
  )
  ipcMain.handle(IPC_CHANNELS.researchUserPaste, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(UserPasteRequestSchema, raw)
      requireVisible(request.sessionId)
      return context.coordinator.addUserPaste(request)
    })
  )
  ipcMain.handle(IPC_CHANNELS.researchDisposition, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(ResearchDispositionRequestSchema, raw)
      requireVisible(request.sessionId)
      return context.coordinator.setResearchDisposition(request)
    })
  )
  ipcMain.handle(IPC_CHANNELS.researchConflictResolve, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(ConflictResolveRequestSchema, raw)
      requireVisible(request.sessionId)
      return context.coordinator.resolveResearchConflict(request)
    })
  )
  ipcMain.handle(IPC_CHANNELS.researchConfirm, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(ResearchConfirmRequestSchema, raw)
      requireVisible(request.sessionId)
      return context.coordinator.confirmResearch(request)
    })
  )
  ipcMain.handle(IPC_CHANNELS.d4Cancel, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(SourceCancelRequestSchema, raw)
      return context.coordinator.cancelD4Operation(request.operationId)
    })
  )
  ipcMain.handle(IPC_CHANNELS.routeResearchSnapshot, routeResearchHandlers.snapshot)
  ipcMain.handle(IPC_CHANNELS.routeResearchPreview, routeResearchHandlers.preview)
  ipcMain.handle(IPC_CHANNELS.routeResearchExecute, routeResearchHandlers.execute)
  ipcMain.handle(IPC_CHANNELS.routeResearchManualPrepare, routeResearchHandlers.prepareManual)
  ipcMain.handle(IPC_CHANNELS.routeResearchUserPaste, routeResearchHandlers.addUserPaste)
  ipcMain.handle(IPC_CHANNELS.routeResearchDisposition, routeResearchHandlers.setDisposition)
  ipcMain.handle(IPC_CHANNELS.routeResearchConflictResolve, routeResearchHandlers.resolveConflict)
  ipcMain.handle(IPC_CHANNELS.routeResearchConfirm, routeResearchHandlers.confirm)
  ipcMain.handle(IPC_CHANNELS.routeResearchCancel, routeResearchHandlers.cancel)
  ipcMain.handle(IPC_CHANNELS.itineraryRouteSnapshot, itineraryRouteHandlers.snapshot)
  ipcMain.handle(IPC_CHANNELS.itineraryRoutePreview, itineraryRouteHandlers.preview)
  ipcMain.handle(IPC_CHANNELS.itineraryRouteExecute, itineraryRouteHandlers.execute)
  ipcMain.handle(IPC_CHANNELS.itineraryRouteSelect, itineraryRouteHandlers.select)
  ipcMain.handle(
    IPC_CHANNELS.itineraryRouteManualEvidenceApply,
    itineraryRouteHandlers.applyManualEvidence
  )
  ipcMain.handle(IPC_CHANNELS.itineraryRouteCancel, itineraryRouteHandlers.cancel)
  ipcMain.handle(IPC_CHANNELS.routeD5Snapshot, routeD5Handlers.snapshot)
  ipcMain.handle(IPC_CHANNELS.routeD5Preview, routeD5Handlers.preview)
  ipcMain.handle(IPC_CHANNELS.routeD5Execute, routeD5Handlers.execute)
  ipcMain.handle(IPC_CHANNELS.routeD5LegSelect, routeD5Handlers.selectLeg)
  ipcMain.handle(IPC_CHANNELS.routeD5ManualLeg, routeD5Handlers.attachManualLeg)
  ipcMain.handle(IPC_CHANNELS.routeD5SkeletonPrepare, routeD5Handlers.prepareSkeleton)
  ipcMain.handle(IPC_CHANNELS.routeD5SkeletonPatch, routeD5Handlers.patchSkeleton)
  ipcMain.handle(IPC_CHANNELS.routeD5StayPaste, routeD5Handlers.addStayPaste)
  ipcMain.handle(IPC_CHANNELS.routeD5StaySelect, routeD5Handlers.selectStay)
  ipcMain.handle(IPC_CHANNELS.routeD5Confirm, routeD5Handlers.confirm)
  ipcMain.handle(IPC_CHANNELS.routeD5Cancel, routeD5Handlers.cancel)
  ipcMain.handle(IPC_CHANNELS.d5Snapshot, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(D5SnapshotRequestSchema, raw)
      requireVisible(request.sessionId)
      return context.coordinator.d5Snapshot(request.sessionId)
    })
  )
  ipcMain.handle(IPC_CHANNELS.railDiscoveryPreview, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(D5SnapshotRequestSchema, raw)
      requireVisible(request.sessionId)
      return context.coordinator.railDiscoveryPreview(request.sessionId)
    })
  )
  ipcMain.handle(IPC_CHANNELS.railDiscover, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(RailDiscoveryRequestSchema, raw)
      requireVisible(request.sessionId)
      return context.coordinator.discoverRailOptions(request, (progress) => {
        if (!sender.isDestroyed()) sender.send(IPC_CHANNELS.d5Progress, progress)
      })
    })
  )
  ipcMain.handle(IPC_CHANNELS.railSelect, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(RailSelectionRequestSchema, raw)
      requireVisible(request.sessionId)
      return context.coordinator.selectRailOptions(request)
    })
  )
  ipcMain.handle(IPC_CHANNELS.d5SourcePlanPreview, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(D5SourcePlanPreviewRequestSchema, raw)
      requireVisible(request.sessionId)
      return context.coordinator.previewD5SourcePlan(request)
    })
  )
  ipcMain.handle(IPC_CHANNELS.d5SourcePlanExecute, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(D5SourcePlanExecuteRequestSchema, raw)
      requireVisible(request.sessionId)
      return context.coordinator.executeD5SourcePlan(request, (progress) => {
        if (!sender.isDestroyed()) sender.send(IPC_CHANNELS.d5Progress, progress)
      })
    })
  )
  ipcMain.handle(IPC_CHANNELS.transportPrepare, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(TransportPrepareRequestSchema, raw)
      requireVisible(request.sessionId)
      return context.coordinator.prepareTransport(request, (progress) => {
        if (!sender.isDestroyed()) sender.send(IPC_CHANNELS.d5Progress, progress)
      })
    })
  )
  ipcMain.handle(IPC_CHANNELS.transportSelect, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(TransportSelectRequestSchema, raw)
      requireVisible(request.sessionId)
      return context.coordinator.selectTransport(request)
    })
  )
  ipcMain.handle(IPC_CHANNELS.skeletonPrepare, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(SkeletonPrepareRequestSchema, raw)
      requireVisible(request.sessionId)
      return context.coordinator.prepareSkeleton(request, (progress) => {
        if (!sender.isDestroyed()) sender.send(IPC_CHANNELS.d5Progress, progress)
      })
    })
  )
  ipcMain.handle(IPC_CHANNELS.skeletonConfirm, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(SkeletonConfirmRequestSchema, raw)
      requireVisible(request.sessionId)
      return context.coordinator.confirmSkeleton(request)
    })
  )
  ipcMain.handle(IPC_CHANNELS.skeletonPatch, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(SkeletonPatchRequestSchema, raw)
      requireVisible(request.sessionId)
      return context.coordinator.patchSkeleton(request)
    })
  )
  ipcMain.handle(IPC_CHANNELS.stayPrepare, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(StayPrepareRequestSchema, raw)
      requireVisible(request.sessionId)
      return context.coordinator.prepareStay(request, (progress) => {
        if (!sender.isDestroyed()) sender.send(IPC_CHANNELS.d5Progress, progress)
      })
    })
  )
  ipcMain.handle(IPC_CHANNELS.staySelect, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(StaySelectRequestSchema, raw)
      requireVisible(request.sessionId)
      return context.coordinator.selectStay(request)
    })
  )
  ipcMain.handle(IPC_CHANNELS.stayPaste, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(StayPasteRequestSchema, raw)
      requireVisible(request.sessionId)
      return context.coordinator.addStayPaste(request)
    })
  )
  ipcMain.handle(IPC_CHANNELS.timelineSnapshot, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(D6SnapshotRequestSchema, raw)
      requireVisible(request.sessionId)
      return context.coordinator.d6Snapshot(request)
    })
  )
  ipcMain.handle(IPC_CHANNELS.timelinePrepare, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(TimelinePrepareRequestSchema, raw)
      requireVisible(request.sessionId)
      return context.coordinator.prepareTimeline(request, (progress) => {
        if (!sender.isDestroyed()) sender.send(IPC_CHANNELS.d6Progress, progress)
      })
    })
  )
  ipcMain.handle(IPC_CHANNELS.timelinePublish, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(TimelinePublishRequestSchema, raw)
      requireVisible(request.sessionId)
      return context.coordinator.publishTimeline(request)
    })
  )
  ipcMain.handle(IPC_CHANNELS.d6Cancel, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(D6CancelRequestSchema, raw)
      return context.coordinator.cancelD6Operation(request.operationId)
    })
  )
  ipcMain.handle(IPC_CHANNELS.d7Snapshot, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(D7SnapshotRequestSchema, raw)
      requireVisible(request.sessionId)
      return context.coordinator.d7Snapshot(request)
    })
  )
  ipcMain.handle(IPC_CHANNELS.taskDerive, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(TaskDeriveRequestSchema, raw)
      requireVisible(request.sessionId)
      return context.coordinator.deriveTasks(request)
    })
  )
  ipcMain.handle(IPC_CHANNELS.taskUpdate, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(TaskUpdateRequestSchema, raw)
      requireVisible(request.sessionId)
      return context.coordinator.updateTask(request)
    })
  )
  ipcMain.handle(IPC_CHANNELS.gateCRun, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(GateCRunRequestSchema, raw)
      requireVisible(request.sessionId)
      return context.coordinator.runGateC(request)
    })
  )
  ipcMain.handle(IPC_CHANNELS.itineraryExport, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(ItineraryExportRequestSchema, raw)
      requireVisible(request.sessionId)
      return savePreparedExport(context.coordinator.prepareItineraryExport(request))
    })
  )
  ipcMain.handle(IPC_CHANNELS.inspectorSnapshot, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(InspectorQuerySchema, raw)
      requireVisible(request.sessionId)
      return context.inspector.snapshot(request)
    })
  )
  ipcMain.handle(IPC_CHANNELS.diagnosticExport, (event, raw: unknown) =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(DiagnosticExportRequestSchema, raw)
      requireVisible(request.sessionId)
      const snapshot = await context.inspector.snapshot(request)
      return savePreparedExport(prepareDiagnosticExport(snapshot))
    })
  )

  return () => {
    for (const channel of [
      IPC_CHANNELS.providerGet,
      IPC_CHANNELS.providerSave,
      IPC_CHANNELS.providerClear,
      IPC_CHANNELS.sessionsList,
      IPC_CHANNELS.sessionsCreate,
      IPC_CHANNELS.sessionsGet,
      IPC_CHANNELS.chatSubmit,
      IPC_CHANNELS.confirmationUpdate,
      IPC_CHANNELS.confirmationConfirm,
      IPC_CHANNELS.envelopeChoose,
      IPC_CHANNELS.usageTotals,
      IPC_CHANNELS.sourceConfigGet,
      IPC_CHANNELS.sourceConfigSave,
      IPC_CHANNELS.sourceConfigClear,
      IPC_CHANNELS.sourceHealthList,
      IPC_CHANNELS.sourceProbe,
      IPC_CHANNELS.sourceQuery,
      IPC_CHANNELS.sourceCancel,
      IPC_CHANNELS.sourceXhsStatus,
      IPC_CHANNELS.sourceXhsLoginQr,
      IPC_CHANNELS.sourceOpenExternal,
      IPC_CHANNELS.evidenceList,
      IPC_CHANNELS.toolCallsList,
      IPC_CHANNELS.blockedToolsList,
      IPC_CHANNELS.d4Snapshot,
      IPC_CHANNELS.destinationGenerate,
      IPC_CHANNELS.destinationConfirmFixed,
      IPC_CHANNELS.destinationSelect,
      IPC_CHANNELS.researchPrepare,
      IPC_CHANNELS.researchManualChecklistPrepare,
      IPC_CHANNELS.researchXhsRankingPreview,
      IPC_CHANNELS.researchXhsRankingExecute,
      IPC_CHANNELS.researchUserPaste,
      IPC_CHANNELS.researchDisposition,
      IPC_CHANNELS.researchConflictResolve,
      IPC_CHANNELS.researchConfirm,
      IPC_CHANNELS.d4Cancel,
      IPC_CHANNELS.routeResearchSnapshot,
      IPC_CHANNELS.routeResearchPreview,
      IPC_CHANNELS.routeResearchExecute,
      IPC_CHANNELS.routeResearchManualPrepare,
      IPC_CHANNELS.routeResearchUserPaste,
      IPC_CHANNELS.routeResearchDisposition,
      IPC_CHANNELS.routeResearchConflictResolve,
      IPC_CHANNELS.routeResearchConfirm,
      IPC_CHANNELS.routeResearchCancel,
      IPC_CHANNELS.itineraryRouteSnapshot,
      IPC_CHANNELS.itineraryRoutePreview,
      IPC_CHANNELS.itineraryRouteExecute,
      IPC_CHANNELS.itineraryRouteSelect,
      IPC_CHANNELS.itineraryRouteManualEvidenceApply,
      IPC_CHANNELS.itineraryRouteCancel,
      IPC_CHANNELS.routeD5Snapshot,
      IPC_CHANNELS.routeD5Preview,
      IPC_CHANNELS.routeD5Execute,
      IPC_CHANNELS.routeD5LegSelect,
      IPC_CHANNELS.routeD5ManualLeg,
      IPC_CHANNELS.routeD5SkeletonPrepare,
      IPC_CHANNELS.routeD5SkeletonPatch,
      IPC_CHANNELS.routeD5StayPaste,
      IPC_CHANNELS.routeD5StaySelect,
      IPC_CHANNELS.routeD5Confirm,
      IPC_CHANNELS.routeD5Cancel,
      IPC_CHANNELS.d5Snapshot,
      IPC_CHANNELS.railDiscoveryPreview,
      IPC_CHANNELS.railDiscover,
      IPC_CHANNELS.railSelect,
      IPC_CHANNELS.d5SourcePlanPreview,
      IPC_CHANNELS.d5SourcePlanExecute,
      IPC_CHANNELS.transportPrepare,
      IPC_CHANNELS.transportSelect,
      IPC_CHANNELS.skeletonPrepare,
      IPC_CHANNELS.skeletonPatch,
      IPC_CHANNELS.skeletonConfirm,
      IPC_CHANNELS.stayPrepare,
      IPC_CHANNELS.stayPaste,
      IPC_CHANNELS.staySelect,
      IPC_CHANNELS.timelineSnapshot,
      IPC_CHANNELS.timelinePrepare,
      IPC_CHANNELS.timelinePublish,
      IPC_CHANNELS.d6Cancel,
      IPC_CHANNELS.d7Snapshot,
      IPC_CHANNELS.taskDerive,
      IPC_CHANNELS.taskUpdate,
      IPC_CHANNELS.gateCRun,
      IPC_CHANNELS.itineraryExport,
      IPC_CHANNELS.inspectorSnapshot,
      IPC_CHANNELS.diagnosticExport
    ])
      ipcMain.removeHandler(channel)
  }
}

function asChatResult(outcome: ChatTurnOutcome): ChatIpcResult<ChatTurnOutcome | SessionSummary> {
  if (outcome.kind === 'OUT_OF_ENVELOPE') {
    return { ok: false, error: outcome.error, comparison: outcome.comparison }
  }
  if (outcome.kind === 'BLOCKED') {
    return { ok: false, error: outcome.error, dependency: outcome.dependency }
  }
  return { ok: true, data: outcome }
}

function asChatFailure(error: unknown): ChatIpcResult<never> {
  const appError =
    error instanceof AppError ? error : new AppError('INTERNAL_ERROR', '操作失败，请查看本机日志。')
  return {
    ok: false,
    error: { code: appError.code, klass: appError.klass, userHint: appError.userHint }
  }
}

async function savePreparedExport(prepared: PreparedExport): Promise<ExportResult> {
  const extension = prepared.kind === 'ICS' ? 'ics' : prepared.kind === 'MARKDOWN' ? 'md' : 'json'
  const result = await dialog.showSaveDialog({
    title: '导出 Travel Harness 文件',
    defaultPath: prepared.suggestedFileName,
    filters: [{ name: prepared.kind, extensions: [extension] }],
    properties: ['createDirectory', 'showOverwriteConfirmation']
  })
  if (result.canceled || !result.filePath) {
    throw new AppError('INPUT_INVALID', '用户取消了导出。')
  }
  const { bytes } = await writePreparedExport(result.filePath, prepared)
  return ExportResultSchema.parse({
    kind: prepared.kind,
    savedPath: result.filePath,
    itemCount: prepared.itemCount,
    bytes
  })
}
