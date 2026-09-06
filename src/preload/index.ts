import { contextBridge } from 'electron'
import { ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { IPC_CHANNELS, type TravelHarnessApi } from '../shared/ipc-contract'

const api: TravelHarnessApi = {
  credentials: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.credentialsList),
    save: (request) => ipcRenderer.invoke(IPC_CHANNELS.credentialsSave, request),
    clear: (id) => ipcRenderer.invoke(IPC_CHANNELS.credentialsClear, { id })
  },
  provider: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.providerGet),
    save: (config) => ipcRenderer.invoke(IPC_CHANNELS.providerSave, config),
    clear: () => ipcRenderer.invoke(IPC_CHANNELS.providerClear)
  },
  sessions: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.sessionsList),
    create: (request) => ipcRenderer.invoke(IPC_CHANNELS.sessionsCreate, request),
    get: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.sessionsGet, { sessionId })
  },
  chat: {
    submit: (request) => ipcRenderer.invoke(IPC_CHANNELS.chatSubmit, request),
    updateConfirmation: (request) => ipcRenderer.invoke(IPC_CHANNELS.confirmationUpdate, request),
    confirm: (request) => ipcRenderer.invoke(IPC_CHANNELS.confirmationConfirm, request),
    chooseEnvelope: (request) => ipcRenderer.invoke(IPC_CHANNELS.envelopeChoose, request),
    usage: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.usageTotals, { sessionId })
  },
  sources: {
    getConfig: () => ipcRenderer.invoke(IPC_CHANNELS.sourceConfigGet),
    saveConfig: (config) => ipcRenderer.invoke(IPC_CHANNELS.sourceConfigSave, config),
    clearConfig: () => ipcRenderer.invoke(IPC_CHANNELS.sourceConfigClear),
    health: () => ipcRenderer.invoke(IPC_CHANNELS.sourceHealthList),
    probe: (sourceId, operationId) =>
      ipcRenderer.invoke(IPC_CHANNELS.sourceProbe, { sourceId, operationId }),
    query: (query, operationId) =>
      ipcRenderer.invoke(IPC_CHANNELS.sourceQuery, { query, operationId }),
    onProgress: (listener) => {
      const wrapped = (_event: IpcRendererEvent, payload: unknown): void => listener(payload)
      ipcRenderer.on(IPC_CHANNELS.sourceProgress, wrapped)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.sourceProgress, wrapped)
    },
    cancel: (operationId) => ipcRenderer.invoke(IPC_CHANNELS.sourceCancel, { operationId }),
    xiaohongshuStatus: (operationId) =>
      ipcRenderer.invoke(IPC_CHANNELS.sourceXhsStatus, { operationId }),
    xiaohongshuLoginQr: (operationId) =>
      ipcRenderer.invoke(IPC_CHANNELS.sourceXhsLoginQr, { operationId }),
    openExternal: (url) => ipcRenderer.invoke(IPC_CHANNELS.sourceOpenExternal, { url }),
    evidence: (sessionId, limit = 100) =>
      ipcRenderer.invoke(IPC_CHANNELS.evidenceList, { sessionId, limit }),
    toolCalls: (sessionId, limit = 100) =>
      ipcRenderer.invoke(IPC_CHANNELS.toolCallsList, { sessionId, limit }),
    blockedTools: (limit = 100) => ipcRenderer.invoke(IPC_CHANNELS.blockedToolsList, { limit })
  },
  d4: {
    snapshot: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.d4Snapshot, { sessionId }),
    generateDestination: (request) => ipcRenderer.invoke(IPC_CHANNELS.destinationGenerate, request),
    confirmFixedDestination: (request) =>
      ipcRenderer.invoke(IPC_CHANNELS.destinationConfirmFixed, request),
    selectDestination: (request) => ipcRenderer.invoke(IPC_CHANNELS.destinationSelect, request),
    prepareResearch: (request) => ipcRenderer.invoke(IPC_CHANNELS.researchPrepare, request),
    prepareManualResearch: (request) =>
      ipcRenderer.invoke(IPC_CHANNELS.researchManualChecklistPrepare, request),
    previewXhsRanking: (sessionId) =>
      ipcRenderer.invoke(IPC_CHANNELS.researchXhsRankingPreview, { sessionId }),
    executeXhsRanking: (request) =>
      ipcRenderer.invoke(IPC_CHANNELS.researchXhsRankingExecute, request),
    addUserPaste: (request) => ipcRenderer.invoke(IPC_CHANNELS.researchUserPaste, request),
    setDisposition: (request) => ipcRenderer.invoke(IPC_CHANNELS.researchDisposition, request),
    resolveConflict: (request) => ipcRenderer.invoke(IPC_CHANNELS.researchConflictResolve, request),
    confirmResearch: (request) => ipcRenderer.invoke(IPC_CHANNELS.researchConfirm, request),
    onProgress: (listener) => {
      const wrapped = (_event: IpcRendererEvent, payload: unknown): void => listener(payload)
      ipcRenderer.on(IPC_CHANNELS.d4Progress, wrapped)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.d4Progress, wrapped)
    },
    cancel: (operationId) => ipcRenderer.invoke(IPC_CHANNELS.d4Cancel, { operationId })
  },
  routeResearch: {
    snapshot: (request) => ipcRenderer.invoke(IPC_CHANNELS.routeResearchSnapshot, request),
    preview: (request) => ipcRenderer.invoke(IPC_CHANNELS.routeResearchPreview, request),
    execute: (request) => ipcRenderer.invoke(IPC_CHANNELS.routeResearchExecute, request),
    prepareManual: (request) =>
      ipcRenderer.invoke(IPC_CHANNELS.routeResearchManualPrepare, request),
    addUserPaste: (request) => ipcRenderer.invoke(IPC_CHANNELS.routeResearchUserPaste, request),
    setDisposition: (request) => ipcRenderer.invoke(IPC_CHANNELS.routeResearchDisposition, request),
    resolveConflict: (request) =>
      ipcRenderer.invoke(IPC_CHANNELS.routeResearchConflictResolve, request),
    confirm: (request) => ipcRenderer.invoke(IPC_CHANNELS.routeResearchConfirm, request),
    onProgress: (listener) => {
      const wrapped = (_event: IpcRendererEvent, payload: unknown): void => listener(payload)
      ipcRenderer.on(IPC_CHANNELS.routeResearchProgress, wrapped)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.routeResearchProgress, wrapped)
    },
    cancel: (operationId) => ipcRenderer.invoke(IPC_CHANNELS.routeResearchCancel, { operationId })
  },
  itineraryRoutes: {
    snapshot: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.itineraryRouteSnapshot, { sessionId }),
    preview: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.itineraryRoutePreview, { sessionId }),
    execute: (request) => ipcRenderer.invoke(IPC_CHANNELS.itineraryRouteExecute, request),
    select: (request) => ipcRenderer.invoke(IPC_CHANNELS.itineraryRouteSelect, request),
    applyManualEvidence: (request) =>
      ipcRenderer.invoke(IPC_CHANNELS.itineraryRouteManualEvidenceApply, request),
    onProgress: (listener) => {
      const wrapped = (_event: IpcRendererEvent, payload: unknown): void => listener(payload)
      ipcRenderer.on(IPC_CHANNELS.itineraryRouteProgress, wrapped)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.itineraryRouteProgress, wrapped)
    },
    cancel: (operationId) => ipcRenderer.invoke(IPC_CHANNELS.itineraryRouteCancel, { operationId })
  },
  d5: {
    snapshot: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.d5Snapshot, { sessionId }),
    railDiscoveryPreview: (sessionId) =>
      ipcRenderer.invoke(IPC_CHANNELS.railDiscoveryPreview, { sessionId }),
    discoverRail: (request) => ipcRenderer.invoke(IPC_CHANNELS.railDiscover, request),
    selectRail: (request) => ipcRenderer.invoke(IPC_CHANNELS.railSelect, request),
    previewSourcePlan: (request) => ipcRenderer.invoke(IPC_CHANNELS.d5SourcePlanPreview, request),
    executeSourcePlan: (request) => ipcRenderer.invoke(IPC_CHANNELS.d5SourcePlanExecute, request),
    prepareTransport: (request) => ipcRenderer.invoke(IPC_CHANNELS.transportPrepare, request),
    selectTransport: (request) => ipcRenderer.invoke(IPC_CHANNELS.transportSelect, request),
    prepareSkeleton: (request) => ipcRenderer.invoke(IPC_CHANNELS.skeletonPrepare, request),
    patchSkeleton: (request) => ipcRenderer.invoke(IPC_CHANNELS.skeletonPatch, request),
    confirmSkeleton: (request) => ipcRenderer.invoke(IPC_CHANNELS.skeletonConfirm, request),
    prepareStay: (request) => ipcRenderer.invoke(IPC_CHANNELS.stayPrepare, request),
    addStayPaste: (request) => ipcRenderer.invoke(IPC_CHANNELS.stayPaste, request),
    selectStay: (request) => ipcRenderer.invoke(IPC_CHANNELS.staySelect, request),
    onProgress: (listener) => {
      const wrapped = (_event: IpcRendererEvent, payload: unknown): void => listener(payload)
      ipcRenderer.on(IPC_CHANNELS.d5Progress, wrapped)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.d5Progress, wrapped)
    }
  },
  routeD5: {
    snapshot: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.routeD5Snapshot, { sessionId }),
    preview: (request) => ipcRenderer.invoke(IPC_CHANNELS.routeD5Preview, request),
    execute: (request) => ipcRenderer.invoke(IPC_CHANNELS.routeD5Execute, request),
    selectLeg: (request) => ipcRenderer.invoke(IPC_CHANNELS.routeD5LegSelect, request),
    attachManualLeg: (request) => ipcRenderer.invoke(IPC_CHANNELS.routeD5ManualLeg, request),
    prepareSkeleton: (request) => ipcRenderer.invoke(IPC_CHANNELS.routeD5SkeletonPrepare, request),
    patchSkeleton: (request) => ipcRenderer.invoke(IPC_CHANNELS.routeD5SkeletonPatch, request),
    addStayPaste: (request) => ipcRenderer.invoke(IPC_CHANNELS.routeD5StayPaste, request),
    selectStay: (request) => ipcRenderer.invoke(IPC_CHANNELS.routeD5StaySelect, request),
    confirm: (request) => ipcRenderer.invoke(IPC_CHANNELS.routeD5Confirm, request),
    onProgress: (listener) => {
      const wrapped = (_event: IpcRendererEvent, payload: unknown): void => listener(payload)
      ipcRenderer.on(IPC_CHANNELS.routeD5Progress, wrapped)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.routeD5Progress, wrapped)
    },
    cancel: (operationId) => ipcRenderer.invoke(IPC_CHANNELS.routeD5Cancel, { operationId })
  },
  d6: {
    snapshot: (sessionId, version, routeId) =>
      ipcRenderer.invoke(IPC_CHANNELS.timelineSnapshot, { sessionId, version, routeId }),
    prepare: (request) => ipcRenderer.invoke(IPC_CHANNELS.timelinePrepare, request),
    publish: (request) => ipcRenderer.invoke(IPC_CHANNELS.timelinePublish, request),
    onProgress: (listener) => {
      const wrapped = (_event: IpcRendererEvent, payload: unknown): void => listener(payload)
      ipcRenderer.on(IPC_CHANNELS.d6Progress, wrapped)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.d6Progress, wrapped)
    },
    cancel: (operationId) => ipcRenderer.invoke(IPC_CHANNELS.d6Cancel, { operationId })
  },
  d7: {
    snapshot: (sessionId, routeId) =>
      ipcRenderer.invoke(IPC_CHANNELS.d7Snapshot, { sessionId, routeId }),
    derive: (sessionId, routeId) =>
      ipcRenderer.invoke(IPC_CHANNELS.taskDerive, { sessionId, routeId }),
    update: (request) => ipcRenderer.invoke(IPC_CHANNELS.taskUpdate, request),
    runGateC: (sessionId, routeId) =>
      ipcRenderer.invoke(IPC_CHANNELS.gateCRun, { sessionId, routeId }),
    exportItinerary: (request) => ipcRenderer.invoke(IPC_CHANNELS.itineraryExport, request)
  },
  inspector: {
    snapshot: (query) => ipcRenderer.invoke(IPC_CHANNELS.inspectorSnapshot, query),
    exportDiagnostic: (query) => ipcRenderer.invoke(IPC_CHANNELS.diagnosticExport, query)
  }
}

contextBridge.exposeInMainWorld('api', api)
