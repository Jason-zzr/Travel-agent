import type { IpcMainInvokeEvent, WebContents } from 'electron'
import { AppError } from '../../shared/errors'

export function assertAuthorizedSender(event: IpcMainInvokeEvent, expected: WebContents): void {
  if (expected.isDestroyed() || event.sender.id !== expected.id) {
    throw new AppError('IPC_FORBIDDEN', '拒绝来自非主窗口的请求。')
  }
}
