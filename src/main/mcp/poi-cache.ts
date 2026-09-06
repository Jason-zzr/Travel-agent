import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { AppError } from '../../shared/errors'

export type AmapQuotaBucket = 'AMAP_SEARCH' | 'AMAP_LBS' | 'AMAP_WEATHER'

export interface PoiCacheEntry {
  key: string
  name: string
  city: string
  lng: number
  lat: number
  detail: unknown | null
  fetchedAt: string
}

export class PoiCacheStore {
  private readonly database: Database.Database

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true })
    this.database = new Database(path)
    this.database.pragma('journal_mode = WAL')
    this.database.pragma('synchronous = NORMAL')
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS poi_cache (
        cache_key TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        city TEXT NOT NULL,
        lng REAL NOT NULL,
        lat REAL NOT NULL,
        detail_json TEXT,
        fetched_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS quota_counters (
        bucket TEXT NOT NULL,
        month TEXT NOT NULL,
        used INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (bucket, month)
      );
    `)
  }

  getPoi(name: string, city: string, now: Date = new Date()): PoiCacheEntry | undefined {
    const key = poiCacheKey(name, city)
    const row = this.database
      .prepare(
        `SELECT cache_key, name, city, lng, lat, detail_json, fetched_at
         FROM poi_cache WHERE cache_key = ?`
      )
      .get(key) as
      | {
          cache_key: string
          name: string
          city: string
          lng: number
          lat: number
          detail_json: string | null
          fetched_at: string
        }
      | undefined
    if (!row) return undefined
    return {
      key: row.cache_key,
      name: row.name,
      city: row.city,
      lng: row.lng,
      lat: row.lat,
      detail:
        row.detail_json && now.getTime() - Date.parse(row.fetched_at) <= 30 * 24 * 60 * 60 * 1000
          ? JSON.parse(row.detail_json)
          : null,
      fetchedAt: row.fetched_at
    }
  }

  putPoi(entry: Omit<PoiCacheEntry, 'key'>): PoiCacheEntry {
    const key = poiCacheKey(entry.name, entry.city)
    this.database
      .prepare(
        `INSERT INTO poi_cache(cache_key, name, city, lng, lat, detail_json, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(cache_key) DO UPDATE SET
           name=excluded.name, city=excluded.city, lng=excluded.lng, lat=excluded.lat,
           detail_json=excluded.detail_json, fetched_at=excluded.fetched_at`
      )
      .run(
        key,
        entry.name,
        entry.city,
        entry.lng,
        entry.lat,
        entry.detail === null ? null : JSON.stringify(entry.detail),
        entry.fetchedAt
      )
    return { key, ...entry }
  }

  clearPoiDetails(): void {
    this.database.prepare('UPDATE poi_cache SET detail_json = NULL').run()
  }

  quota(bucket: AmapQuotaBucket, now: Date): number {
    const row = this.database
      .prepare('SELECT used FROM quota_counters WHERE bucket = ? AND month = ?')
      .get(bucket, quotaMonth(now)) as { used: number } | undefined
    return row?.used ?? 0
  }

  assertQuotaAvailable(bucket: AmapQuotaBucket, limit: number, now: Date): void {
    if (this.quota(bucket, now) >= Math.floor(limit * 0.95)) {
      throw new AppError('SOURCE_QUOTA_EXHAUSTED', `${bucket} 已达到本地 95% 配额熔断线。`, {
        userHint: '本月地图数据源配额已接近上限，已停止继续调用以避免额外费用。'
      })
    }
  }

  incrementQuota(bucket: AmapQuotaBucket, now: Date): number {
    const month = quotaMonth(now)
    this.database
      .prepare(
        `INSERT INTO quota_counters(bucket, month, used) VALUES (?, ?, 1)
         ON CONFLICT(bucket, month) DO UPDATE SET used = used + 1`
      )
      .run(bucket, month)
    return this.quota(bucket, now)
  }

  close(): void {
    this.database.close()
  }
}

export function poiCacheKey(name: string, city: string): string {
  return `${normalizePoi(name)}|${normalizePoi(city)}`
}

function normalizePoi(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN').replace(/\s+/g, '')
}

function quotaMonth(now: Date): string {
  return now.toISOString().slice(0, 7)
}
