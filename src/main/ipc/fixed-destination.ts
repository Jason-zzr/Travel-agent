import type { IpcMainInvokeEvent } from 'electron'
import type { IpcResult } from '../../shared/ipc-contract'
import {
  FixedDestinationConfirmRequestSchema,
  type D4Snapshot,
  type FixedDestinationConfirmRequest
} from '../../shared/schema/d4'
import { asIpcResult } from './wrap'
import { parseRequest } from './request'

interface FixedDestinationHandlerDependencies {
  authorize: (event: IpcMainInvokeEvent) => void
  requireVisible: (sessionId: string) => void
  confirm: (request: FixedDestinationConfirmRequest) => Promise<D4Snapshot>
}

export function createFixedDestinationConfirmHandler({
  authorize,
  requireVisible,
  confirm
}: FixedDestinationHandlerDependencies) {
  return (event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<D4Snapshot>> =>
    asIpcResult(async () => {
      authorize(event)
      const request = parseRequest(FixedDestinationConfirmRequestSchema, raw)
      requireVisible(request.sessionId)
      return confirm(request)
    })
}
