import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import migration1Sql from './migrations/0001_init.sql?raw'
import migration2Sql from './migrations/0002_model_call_cost.sql?raw'
import migration3Sql from './migrations/0003_xiaohongshu_source.sql?raw'
import migration4Sql from './migrations/0004_d5_transport_candidates.sql?raw'
import migration5Sql from './migrations/0005_d7_task_links.sql?raw'
import migration6Sql from './migrations/0006_user_research_source.sql?raw'
import migration7Sql from './migrations/0007_multi_city_routes.sql?raw'
import migration8Sql from './migrations/0008_node_scoped_d4.sql?raw'
import migration9Sql from './migrations/0009_multi_segment_d5.sql?raw'
import migration10Sql from './migrations/0010_unified_route_timeline.sql?raw'
import { applyMigrations } from './migrate'

export interface OpenDatabaseResult {
  database: Database.Database
  fresh: boolean
}

export function openDatabase(databasePath: string): OpenDatabaseResult {
  mkdirSync(dirname(databasePath), { recursive: true })
  const database = new Database(databasePath)
  database.pragma('journal_mode = WAL')
  database.pragma('foreign_keys = ON')
  database.pragma('synchronous = NORMAL')

  const { fresh } = applyMigrations(database, [
    { version: 1, sql: migration1Sql },
    { version: 2, sql: migration2Sql },
    { version: 3, sql: migration3Sql },
    { version: 4, sql: migration4Sql },
    { version: 5, sql: migration5Sql },
    { version: 6, sql: migration6Sql },
    { version: 7, sql: migration7Sql },
    { version: 8, sql: migration8Sql },
    { version: 9, sql: migration9Sql },
    { version: 10, sql: migration10Sql }
  ])

  return { database, fresh }
}
