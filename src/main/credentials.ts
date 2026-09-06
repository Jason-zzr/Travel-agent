import { safeStorage } from 'electron'
import { CredentialStore } from './credential-store'

export function createCredentialStore(filePath: string): CredentialStore {
  return new CredentialStore(filePath, safeStorage)
}

export type { CredentialStore } from './credential-store'
