import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { AppError } from '../shared/errors'
import {
  SourceConfigSchema,
  type SourceConfig,
  type SourceConfigSummary
} from '../shared/schema/source'

const EMPTY_CONFIG: SourceConfig = { version: 1, searchModel: null }

export class SourceConfigStore {
  constructor(private readonly filePath: string) {}

  async get(): Promise<SourceConfig> {
    try {
      return SourceConfigSchema.parse(JSON.parse(await readFile(this.filePath, 'utf8')))
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return structuredClone(EMPTY_CONFIG)
      }
      throw new AppError('INTERNAL_SCHEMA_MISMATCH', '数据源配置文件损坏，未发起外部请求。', {
        cause: error,
        userHint: '数据源配置不可读取，请清除后重新配置。'
      })
    }
  }

  async save(input: SourceConfig): Promise<SourceConfigSummary> {
    const config = SourceConfigSchema.parse(input)
    await this.persist(config)
    return config
  }

  async clear(): Promise<SourceConfigSummary> {
    await this.persist(EMPTY_CONFIG)
    return structuredClone(EMPTY_CONFIG)
  }

  private async persist(input: SourceConfig): Promise<void> {
    const config = SourceConfigSchema.parse(input)
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`
    try {
      const handle = await open(temporaryPath, 'wx', 0o600)
      try {
        await handle.writeFile(`${JSON.stringify(config)}\n`, 'utf8')
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
