import type Database from 'better-sqlite3'

export interface DatabaseMigration {
  version: number
  sql: string
}

export function applyMigrations(
  database: Database.Database,
  migrations: DatabaseMigration[]
): { fresh: boolean; applied: number[] } {
  const hadMigrations = Boolean(
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
      .get()
  )
  const applied: number[] = []
  const applyMigration = database.transaction((migration: DatabaseMigration) => {
    database.exec(stripRuntimePragmas(migration.sql))
    database
      .prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)')
      .run(migration.version, new Date().toISOString())
  })

  const ordered = [...migrations].sort((left, right) => left.version - right.version)
  for (const migration of ordered) {
    const exists =
      hadMigrations || migration.version !== ordered[0]?.version
        ? database
            .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
            .get()
        : undefined
    const alreadyApplied = exists
      ? database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(migration.version)
      : undefined
    if (!alreadyApplied) {
      applyMigration(migration)
      applied.push(migration.version)
    }
  }
  return { fresh: !hadMigrations, applied }
}

function stripRuntimePragmas(sql: string): string {
  return sql
    .split(/\r?\n/)
    .filter((line) => !/^\s*PRAGMA\s+/i.test(line))
    .join('\n')
}
