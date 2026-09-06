import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { AppError } from '../shared/errors'
import {
  ProviderConfigFileSchema,
  ProviderConfigSchema,
  ProviderConfigSummarySchema,
  ModelRoleSchema,
  resolveModelRoute,
  type ProviderConfig,
  type ProviderConfigFile,
  type ProviderConfigSummary,
  type StoredProviderConfig
} from '../shared/schema/provider'

const EMPTY_FILE: ProviderConfigFile = { version: 2, active: null }

export class ProviderConfigStore {
  constructor(private readonly filePath: string) {}

  async get(): Promise<StoredProviderConfig | undefined> {
    return (await this.load()).active ?? undefined
  }

  async summary(): Promise<ProviderConfigSummary> {
    const active = await this.get()
    const routes = active
      ? Object.fromEntries(
          ModelRoleSchema.options.map((role) => [role, resolveModelRoute(active, role)])
        )
      : null
    return ProviderConfigSummarySchema.parse(
      active
        ? {
            configured: true,
            version: active.version,
            provider: active.version === 1 ? active.provider : null,
            baseUrl: active.version === 1 ? active.baseUrl : null,
            models: Object.fromEntries(
              ModelRoleSchema.options.map((role) => [role, active.roles[role].model])
            ),
            routes
          }
        : {
            configured: false,
            version: null,
            provider: null,
            baseUrl: null,
            models: null,
            routes: null
          }
    )
  }

  async save(input: ProviderConfig): Promise<ProviderConfigSummary> {
    const active = ProviderConfigSchema.parse(input)
    await this.persist({ version: 2, active })
    return this.summary()
  }

  async clear(): Promise<ProviderConfigSummary> {
    await this.persist(EMPTY_FILE)
    return this.summary()
  }

  private async load(): Promise<ProviderConfigFile> {
    try {
      return ProviderConfigFileSchema.parse(JSON.parse(await readFile(this.filePath, 'utf8')))
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return structuredClone(EMPTY_FILE)
      }
      throw new AppError('INTERNAL_SCHEMA_MISMATCH', 'Provider 配置文件损坏，未发起外部请求。', {
        cause: error,
        userHint: 'Provider 配置不可读取，请清除后重新配置。'
      })
    }
  }

  private async persist(file: ProviderConfigFile): Promise<void> {
    const validated = ProviderConfigFileSchema.parse(file)
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
