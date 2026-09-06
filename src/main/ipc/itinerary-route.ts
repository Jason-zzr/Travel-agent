import type { IpcMainInvokeEvent } from 'electron'
import type { IpcResult } from '../../shared/ipc-contract'
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
  type RouteProgressEvent,
  type RouteSelectRequest
} from '../../shared/schema/itinerary'
import { parseRequest } from './request'
import { asIpcResult } from './wrap'

interface ItineraryRouteHandlerDependencies {
  authorize: (event: IpcMainInvokeEvent) => void
  requireVisible: (sessionId: string) => void
  snapshot: (sessionId: string) => MultiCityRouteSnapshot
  preview: (sessionId: string) => RoutePlanPreview
  execute: (
    request: RoutePlanExecuteRequest,
    onProgress: (event: RouteProgressEvent) => void
  ) => Promise<MultiCityRouteSnapshot>
  select: (request: RouteSelectRequest) => Promise<MultiCityRouteSnapshot>
  applyManualEvidence: (request: ManualRouteLegEvidenceRequest) => Promise<MultiCityRouteSnapshot>
  cancel: (operationId: string) => Promise<boolean>
  emitProgress: (event: RouteProgressEvent) => void
}

interface ItineraryRouteHandlers {
  snapshot(event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<MultiCityRouteSnapshot>>
  preview(event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<RoutePlanPreview>>
  execute(event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<MultiCityRouteSnapshot>>
  select(event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<MultiCityRouteSnapshot>>
  applyManualEvidence(
    event: IpcMainInvokeEvent,
    raw: unknown
  ): Promise<IpcResult<MultiCityRouteSnapshot>>
  cancel(event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<boolean>>
}

export function createItineraryRouteHandlers(
  dependencies: ItineraryRouteHandlerDependencies
): ItineraryRouteHandlers {
  return {
    snapshot: (
      event: IpcMainInvokeEvent,
      raw: unknown
    ): Promise<IpcResult<MultiCityRouteSnapshot>> =>
      asIpcResult(async () => {
        dependencies.authorize(event)
        const request = parseRequest(MultiCityRouteSnapshotRequestSchema, raw)
        dependencies.requireVisible(request.sessionId)
        return dependencies.snapshot(request.sessionId)
      }),
    preview: (event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<RoutePlanPreview>> =>
      asIpcResult(async () => {
        dependencies.authorize(event)
        const request = parseRequest(RoutePlanPreviewRequestSchema, raw)
        dependencies.requireVisible(request.sessionId)
        return dependencies.preview(request.sessionId)
      }),
    execute: (
      event: IpcMainInvokeEvent,
      raw: unknown
    ): Promise<IpcResult<MultiCityRouteSnapshot>> =>
      asIpcResult(async () => {
        dependencies.authorize(event)
        const request = parseRequest(RoutePlanExecuteRequestSchema, raw)
        dependencies.requireVisible(request.sessionId)
        return dependencies.execute(request, dependencies.emitProgress)
      }),
    select: (event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<MultiCityRouteSnapshot>> =>
      asIpcResult(async () => {
        dependencies.authorize(event)
        const request = parseRequest(RouteSelectRequestSchema, raw)
        dependencies.requireVisible(request.sessionId)
        return dependencies.select(request)
      }),
    applyManualEvidence: (
      event: IpcMainInvokeEvent,
      raw: unknown
    ): Promise<IpcResult<MultiCityRouteSnapshot>> =>
      asIpcResult(async () => {
        dependencies.authorize(event)
        const request = parseRequest(ManualRouteLegEvidenceRequestSchema, raw)
        dependencies.requireVisible(request.sessionId)
        return dependencies.applyManualEvidence(request)
      }),
    cancel: (event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<boolean>> =>
      asIpcResult(async () => {
        dependencies.authorize(event)
        const request = parseRequest(RouteCancelRequestSchema, raw)
        return dependencies.cancel(request.operationId)
      })
  }
}
