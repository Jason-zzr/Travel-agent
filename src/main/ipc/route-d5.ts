import type { IpcMainInvokeEvent } from 'electron'
import type { IpcResult } from '../../shared/ipc-contract'
import {
  RouteD5CancelRequestSchema,
  RouteD5ConfirmRequestSchema,
  RouteD5ExecuteRequestSchema,
  RouteD5LegSelectRequestSchema,
  RouteD5ManualLegRequestSchema,
  RouteD5PreviewRequestSchema,
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
  type RouteD5ProgressEvent,
  type RouteD5SkeletonPatchRequest,
  type RouteD5SkeletonPrepareRequest,
  type RouteD5StayPasteRequest,
  type RouteD5StaySelectRequest
} from '../../shared/schema/route-d5'
import { parseRequest } from './request'
import { asIpcResult } from './wrap'

interface RouteD5HandlerDependencies {
  authorize: (event: IpcMainInvokeEvent) => void
  requireVisible: (sessionId: string) => void
  snapshot: (sessionId: string) => MultiSegmentD5Snapshot
  preview: (request: RouteD5PreviewRequest) => RouteD5PlanPreview
  execute: (
    request: RouteD5ExecuteRequest,
    onProgress: (event: RouteD5ProgressEvent) => void
  ) => Promise<MultiSegmentD5Snapshot>
  selectLeg: (request: RouteD5LegSelectRequest) => Promise<MultiSegmentD5Snapshot>
  attachManualLeg: (request: RouteD5ManualLegRequest) => Promise<MultiSegmentD5Snapshot>
  prepareSkeleton: (request: RouteD5SkeletonPrepareRequest) => Promise<MultiSegmentD5Snapshot>
  patchSkeleton: (request: RouteD5SkeletonPatchRequest) => Promise<MultiSegmentD5Snapshot>
  addStayPaste: (request: RouteD5StayPasteRequest) => Promise<MultiSegmentD5Snapshot>
  selectStay: (request: RouteD5StaySelectRequest) => Promise<MultiSegmentD5Snapshot>
  confirm: (request: RouteD5ConfirmRequest) => Promise<MultiSegmentD5Snapshot>
  cancel: (operationId: string) => Promise<boolean>
  emitProgress: (event: RouteD5ProgressEvent) => void
}

interface RouteD5Handlers {
  snapshot(event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<MultiSegmentD5Snapshot>>
  preview(event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<RouteD5PlanPreview>>
  execute(event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<MultiSegmentD5Snapshot>>
  selectLeg(event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<MultiSegmentD5Snapshot>>
  attachManualLeg(
    event: IpcMainInvokeEvent,
    raw: unknown
  ): Promise<IpcResult<MultiSegmentD5Snapshot>>
  prepareSkeleton(
    event: IpcMainInvokeEvent,
    raw: unknown
  ): Promise<IpcResult<MultiSegmentD5Snapshot>>
  patchSkeleton(event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<MultiSegmentD5Snapshot>>
  addStayPaste(event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<MultiSegmentD5Snapshot>>
  selectStay(event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<MultiSegmentD5Snapshot>>
  confirm(event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<MultiSegmentD5Snapshot>>
  cancel(event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<boolean>>
}

export function createRouteD5Handlers(dependencies: RouteD5HandlerDependencies): RouteD5Handlers {
  const visible = <T extends { scope: { sessionId: string } }>(request: T): T => {
    dependencies.requireVisible(request.scope.sessionId)
    return request
  }
  return {
    snapshot: (
      event: IpcMainInvokeEvent,
      raw: unknown
    ): Promise<IpcResult<MultiSegmentD5Snapshot>> =>
      asIpcResult(async () => {
        dependencies.authorize(event)
        const request = parseRequest(RouteD5SnapshotRequestSchema, raw)
        dependencies.requireVisible(request.sessionId)
        return dependencies.snapshot(request.sessionId)
      }),
    preview: (event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<RouteD5PlanPreview>> =>
      asIpcResult(async () => {
        dependencies.authorize(event)
        return dependencies.preview(visible(parseRequest(RouteD5PreviewRequestSchema, raw)))
      }),
    execute: (
      event: IpcMainInvokeEvent,
      raw: unknown
    ): Promise<IpcResult<MultiSegmentD5Snapshot>> =>
      asIpcResult(async () => {
        dependencies.authorize(event)
        return dependencies.execute(
          visible(parseRequest(RouteD5ExecuteRequestSchema, raw)),
          dependencies.emitProgress
        )
      }),
    selectLeg: (
      event: IpcMainInvokeEvent,
      raw: unknown
    ): Promise<IpcResult<MultiSegmentD5Snapshot>> =>
      asIpcResult(async () => {
        dependencies.authorize(event)
        return dependencies.selectLeg(visible(parseRequest(RouteD5LegSelectRequestSchema, raw)))
      }),
    attachManualLeg: (
      event: IpcMainInvokeEvent,
      raw: unknown
    ): Promise<IpcResult<MultiSegmentD5Snapshot>> =>
      asIpcResult(async () => {
        dependencies.authorize(event)
        return dependencies.attachManualLeg(
          visible(parseRequest(RouteD5ManualLegRequestSchema, raw))
        )
      }),
    prepareSkeleton: (
      event: IpcMainInvokeEvent,
      raw: unknown
    ): Promise<IpcResult<MultiSegmentD5Snapshot>> =>
      asIpcResult(async () => {
        dependencies.authorize(event)
        return dependencies.prepareSkeleton(
          visible(parseRequest(RouteD5SkeletonPrepareRequestSchema, raw))
        )
      }),
    patchSkeleton: (
      event: IpcMainInvokeEvent,
      raw: unknown
    ): Promise<IpcResult<MultiSegmentD5Snapshot>> =>
      asIpcResult(async () => {
        dependencies.authorize(event)
        return dependencies.patchSkeleton(
          visible(parseRequest(RouteD5SkeletonPatchRequestSchema, raw))
        )
      }),
    addStayPaste: (
      event: IpcMainInvokeEvent,
      raw: unknown
    ): Promise<IpcResult<MultiSegmentD5Snapshot>> =>
      asIpcResult(async () => {
        dependencies.authorize(event)
        return dependencies.addStayPaste(visible(parseRequest(RouteD5StayPasteRequestSchema, raw)))
      }),
    selectStay: (
      event: IpcMainInvokeEvent,
      raw: unknown
    ): Promise<IpcResult<MultiSegmentD5Snapshot>> =>
      asIpcResult(async () => {
        dependencies.authorize(event)
        return dependencies.selectStay(visible(parseRequest(RouteD5StaySelectRequestSchema, raw)))
      }),
    confirm: (
      event: IpcMainInvokeEvent,
      raw: unknown
    ): Promise<IpcResult<MultiSegmentD5Snapshot>> =>
      asIpcResult(async () => {
        dependencies.authorize(event)
        return dependencies.confirm(visible(parseRequest(RouteD5ConfirmRequestSchema, raw)))
      }),
    cancel: (event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<boolean>> =>
      asIpcResult(async () => {
        dependencies.authorize(event)
        const request = parseRequest(RouteD5CancelRequestSchema, raw)
        return dependencies.cancel(request.operationId)
      })
  }
}
