import { ipcMain } from 'electron'
import type { WebContents } from 'electron'
import {
  CredentialClearRequestSchema,
  CredentialSaveRequestSchema,
  IPC_CHANNELS
} from '../../shared/ipc-contract'
import type { CredentialStore } from '../credentials'
import { asIpcResult } from './wrap'
import { assertAuthorizedSender } from './authorize'

export function registerCredentialIpc(store: CredentialStore, sender: WebContents): () => void {
  ipcMain.handle(IPC_CHANNELS.credentialsList, (event) =>
    asIpcResult(async () => {
      assertAuthorizedSender(event, sender)
      return store.list()
    })
  )
  ipcMain.handle(IPC_CHANNELS.credentialsSave, (event, raw: unknown) =>
    asIpcResult(async () => {
      assertAuthorizedSender(event, sender)
      const request = CredentialSaveRequestSchema.parse(raw)
      return store.save(request.id, request.value)
    })
  )
  ipcMain.handle(IPC_CHANNELS.credentialsClear, (event, raw: unknown) =>
    asIpcResult(async () => {
      assertAuthorizedSender(event, sender)
      const request = CredentialClearRequestSchema.parse(raw)
      return store.clear(request.id)
    })
  )

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.credentialsList)
    ipcMain.removeHandler(IPC_CHANNELS.credentialsSave)
    ipcMain.removeHandler(IPC_CHANNELS.credentialsClear)
  }
}
