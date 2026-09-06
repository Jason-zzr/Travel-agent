import type { IpcMainInvokeEvent } from 'electron'
import type { IpcResult } from '../../shared/ipc-contract'
import {
  RouteResearchCancelRequestSchema,
  RouteResearchConfirmRequestSchema,
  RouteResearchConflictRequestSchema,
  RouteResearchDispositionRequestSchema,
  RouteResearchExecuteRequestSchema,
  RouteResearchManualRequestSchema,
  RouteResearchPreviewRequestSchema,
  RouteResearchSnapshotRequestSchema,
  RouteResearchUserPasteRequestSchema,
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
  type RouteResearchUserPasteRequest
} from '../../shared/schema/d4'
import type { EvidenceClaim } from '../../shared/schema/evidence'
import { parseRequest } from './request'
import { asIpcResult } from './wrap'

interface RouteResearchHandlerDependencies {
  authorize: (event: IpcMainInvokeEvent) => void
  requireVisible: (sessionId: string) => void
  snapshot: (request: RouteResearchSnapshotRequest) => RouteNodeD4Snapshot
  preview: (request: RouteResearchPreviewRequest) => Promise<NodeResearchPlanPreview>
  execute: (
    request: RouteResearchExecuteRequest,
    onProgress: (event: RouteResearchProgressEvent) => void
  ) => Promise<RouteNodeD4Snapshot>
  prepareManual: (request: RouteResearchManualRequest) => Promise<RouteNodeD4Snapshot>
  addUserPaste: (request: RouteResearchUserPasteRequest) => Promise<EvidenceClaim>
  setDisposition: (request: RouteResearchDispositionRequest) => Promise<RouteNodeD4Snapshot>
  resolveConflict: (request: RouteResearchConflictRequest) => Promise<RouteNodeD4Snapshot>
  confirm: (request: RouteResearchConfirmRequest) => Promise<RouteNodeD4Snapshot>
  cancel: (operationId: string) => Promise<boolean>
  emitProgress: (event: RouteResearchProgressEvent) => void
}

interface RouteResearchHandlers {
  snapshot(event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<RouteNodeD4Snapshot>>
  preview(event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<NodeResearchPlanPreview>>
  execute(event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<RouteNodeD4Snapshot>>
  prepareManual(event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<RouteNodeD4Snapshot>>
  addUserPaste(event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<EvidenceClaim>>
  setDisposition(event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<RouteNodeD4Snapshot>>
  resolveConflict(event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<RouteNodeD4Snapshot>>
  confirm(event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<RouteNodeD4Snapshot>>
  cancel(event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<boolean>>
}

export function createRouteResearchHandlers(
  dependencies: RouteResearchHandlerDependencies
): RouteResearchHandlers {
  const visible = <T extends { sessionId: string }>(request: T): T => {
    dependencies.requireVisible(request.sessionId)
    return request
  }
  return {
    snapshot: (event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<RouteNodeD4Snapshot>> =>
      asIpcResult(async () => {
        dependencies.authorize(event)
        return dependencies.snapshot(visible(parseRequest(RouteResearchSnapshotRequestSchema, raw)))
      }),
    preview: (
      event: IpcMainInvokeEvent,
      raw: unknown
    ): Promise<IpcResult<NodeResearchPlanPreview>> =>
      asIpcResult(async () => {
        dependencies.authorize(event)
        return dependencies.preview(visible(parseRequest(RouteResearchPreviewRequestSchema, raw)))
      }),
    execute: (event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<RouteNodeD4Snapshot>> =>
      asIpcResult(async () => {
        dependencies.authorize(event)
        return dependencies.execute(
          visible(parseRequest(RouteResearchExecuteRequestSchema, raw)),
          dependencies.emitProgress
        )
      }),
    prepareManual: (
      event: IpcMainInvokeEvent,
      raw: unknown
    ): Promise<IpcResult<RouteNodeD4Snapshot>> =>
      asIpcResult(async () => {
        dependencies.authorize(event)
        return dependencies.prepareManual(
          visible(parseRequest(RouteResearchManualRequestSchema, raw))
        )
      }),
    addUserPaste: (event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<EvidenceClaim>> =>
      asIpcResult(async () => {
        dependencies.authorize(event)
        return dependencies.addUserPaste(
          visible(parseRequest(RouteResearchUserPasteRequestSchema, raw))
        )
      }),
    setDisposition: (
      event: IpcMainInvokeEvent,
      raw: unknown
    ): Promise<IpcResult<RouteNodeD4Snapshot>> =>
      asIpcResult(async () => {
        dependencies.authorize(event)
        return dependencies.setDisposition(
          visible(parseRequest(RouteResearchDispositionRequestSchema, raw))
        )
      }),
    resolveConflict: (
      event: IpcMainInvokeEvent,
      raw: unknown
    ): Promise<IpcResult<RouteNodeD4Snapshot>> =>
      asIpcResult(async () => {
        dependencies.authorize(event)
        return dependencies.resolveConflict(
          visible(parseRequest(RouteResearchConflictRequestSchema, raw))
        )
      }),
    confirm: (event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<RouteNodeD4Snapshot>> =>
      asIpcResult(async () => {
        dependencies.authorize(event)
        return dependencies.confirm(visible(parseRequest(RouteResearchConfirmRequestSchema, raw)))
      }),
    cancel: (event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<boolean>> =>
      asIpcResult(async () => {
        dependencies.authorize(event)
        const request = parseRequest(RouteResearchCancelRequestSchema, raw)
        return dependencies.cancel(request.operationId)
      })
  }
}
