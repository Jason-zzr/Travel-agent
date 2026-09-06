import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { AppError } from '../shared/errors'
import {
  CredentialFileSchema,
  CredentialIdSchema,
  type CredentialFile,
  type CredentialId,
  type CredentialStatus,
  type CredentialStatusEntry
} from '../shared/schema/credentials'

export interface SafeStoragePort {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

const EMPTY_FILE: CredentialFile = { version: 1, entries: {}, reentryRequired: [] }
const ALL_CREDENTIAL_IDS = CredentialIdSchema.options

export class CredentialStore {
  constructor(
    private readonly filePath: string,
    private readonly encryption: SafeStoragePort
  ) {}

  async list(): Promise<CredentialStatusEntry[]> {
    const file = await this.load()
    return ALL_CREDENTIAL_IDS.map((id) => ({ id, status: this.statusOf(file, id) }))
  }

  async status(id: CredentialId): Promise<CredentialStatusEntry> {
    const file = await this.load()
    return { id, status: this.statusOf(file, id) }
  }

  async save(id: CredentialId, plaintext: string): Promise<CredentialStatusEntry> {
    if (!this.encryption.isEncryptionAvailable()) {
      throw new AppError('CRED_UNAVAILABLE', '本机凭据加密暂不可用，未保存任何明文。')
    }
    const file = await this.load()
    file.entries[id] = this.encryption.encryptString(plaintext).toString('base64')
    file.reentryRequired = file.reentryRequired.filter((item) => item !== id)
    await this.persist(file)
    return { id, status: 'CONFIGURED' }
  }

  async clear(id: CredentialId): Promise<CredentialStatusEntry> {
    const file = await this.load()
    delete file.entries[id]
    file.reentryRequired = file.reentryRequired.filter((item) => item !== id)
    await this.persist(file)
    return { id, status: 'UNCONFIGURED' }
  }

  async read(id: CredentialId): Promise<string | undefined> {
    const file = await this.load()
    const encoded = file.entries[id]
    if (!encoded) return undefined
    if (!this.encryption.isEncryptionAvailable()) {
      throw new AppError('CRED_UNAVAILABLE', '本机凭据加密暂不可用。')
    }
    try {
      return this.encryption.decryptString(Buffer.from(encoded, 'base64'))
    } catch (error) {
      delete file.entries[id]
      if (!file.reentryRequired.includes(id)) file.reentryRequired.push(id)
      await this.persist(file)
      throw new AppError('CRED_DECRYPT_FAILED', '凭据已失效，请重新录入。', { cause: error })
    }
  }

  private statusOf(file: CredentialFile, id: CredentialId): CredentialStatus {
    if (file.reentryRequired.includes(id)) return 'REENTRY_REQUIRED'
    return file.entries[id] ? 'CONFIGURED' : 'UNCONFIGURED'
  }

  private async load(): Promise<CredentialFile> {
    try {
      return CredentialFileSchema.parse(JSON.parse(await readFile(this.filePath, 'utf8')))
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return structuredClone(EMPTY_FILE)
      }
      throw new AppError('CRED_DECRYPT_FAILED', '本机凭据容器损坏，未尝试任何外部请求。', {
        cause: error
      })
    }
  }

  private async persist(file: CredentialFile): Promise<void> {
    const validated = CredentialFileSchema.parse(file)
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`
    try {
      const handle = await open(temporaryPath, 'wx', 0o600)
      try {
        await handle.writeFile(`${JSON.stringify(validated)}\n`, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(temporaryPath, this.filePath)
    } finally {
      await rm(temporaryPath, { force: true })
    }
  }
}
