import type { IpcMainInvokeEvent } from 'electron'
import type { IpcResult } from '../../shared/ipc-contract'
import {
  ManualResearchChecklistRequestSchema,
  type D4Snapshot,
  type ManualResearchChecklistRequest
} from '../../shared/schema/d4'
import { asIpcResult } from './wrap'
import { parseRequest } from './request'

interface ManualResearchHandlerDependencies {
  authorize: (event: IpcMainInvokeEvent) => void
  requireVisible: (sessionId: string) => void
  prepare: (request: ManualResearchChecklistRequest) => Promise<D4Snapshot>
}

export function createManualResearchPrepareHandler({
  authorize,
  requireVisible,
  prepare
}: ManualResearchHandlerDependencies) {
  return (event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<D4Snapshot>> =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(ManualResearchChecklistRequestSchema, raw)
      requireVisible(request.sessionId)
      return prepare(request)
    })
}
