import type Database from 'better-sqlite3'
import { EvidenceClaimSchema, type EvidenceClaim } from '../../shared/schema/evidence'
import {
  SourceHealthEntrySchema,
  type ExternalSourceId,
  type SourceHealthStatus
} from '../../shared/schema/source'
import {
  BlockedToolAuditSchema,
  ToolCallAuditSchema,
  type BlockedToolAudit,
  type ToolCallAudit
} from '../../shared/schema/tool-audit'

export interface StoredSourceHealth {
  sourceId: ExternalSourceId
  status: SourceHealthStatus
  lastOkAt: string | null
  lastErrorCode: string | null
  failStreak: number
  updatedAt: string
}

export class SourceRepository {
  constructor(private readonly database: Database.Database) {}

  ensureHealth(sourceId: ExternalSourceId, status: SourceHealthStatus, now: string): void {
    this.database
      .prepare(
        `INSERT INTO source_health(source_id, status, last_ok_at, last_error, fail_streak, updated_at)
         VALUES (?, ?, NULL, NULL, 0, ?)
         ON CONFLICT(source_id) DO NOTHING`
      )
      .run(sourceId, status, now)
  }

  getHealth(sourceId: ExternalSourceId): StoredSourceHealth | undefined {
    const row = this.database
      .prepare(
        `SELECT source_id, status, last_ok_at, last_error, fail_streak, updated_at
         FROM source_health WHERE source_id = ?`
      )
      .get(sourceId) as SourceHealthRow | undefined
    return row ? mapHealthRow(row) : undefined
  }

  setUnconfigured(sourceId: ExternalSourceId, now: string): StoredSourceHealth {
    this.ensureHealth(sourceId, 'UNCONFIGURED', now)
    this.database
      .prepare(
        `UPDATE source_health SET status='UNCONFIGURED', last_error=NULL,
         fail_streak=0, updated_at=? WHERE source_id=?`
      )
      .run(now, sourceId)
    return this.getHealth(sourceId)!
  }

  markSuccess(sourceId: ExternalSourceId, now: string): StoredSourceHealth {
    this.ensureHealth(sourceId, 'OK', now)
    this.database
      .prepare(
        `UPDATE source_health SET status='OK', last_ok_at=?, last_error=NULL,
         fail_streak=0, updated_at=? WHERE source_id=?`
      )
      .run(now, now, sourceId)
    return this.getHealth(sourceId)!
  }

  markNetworkFailure(
    sourceId: ExternalSourceId,
    errorCode: string,
    now: string
  ): StoredSourceHealth {
    this.ensureHealth(sourceId, 'OK', now)
    this.database
      .prepare(
        `UPDATE source_health SET
           fail_streak=fail_streak + 1,
           status=CASE WHEN fail_streak + 1 >= 2 THEN 'DEGRADED' ELSE status END,
           last_error=?, updated_at=?
         WHERE source_id=?`
      )
      .run(errorCode, now, sourceId)
    return this.getHealth(sourceId)!
  }

  markDrift(sourceId: ExternalSourceId, now: string): StoredSourceHealth {
    this.ensureHealth(sourceId, 'DEGRADED', now)
    this.database
      .prepare(
        `UPDATE source_health SET status='DEGRADED', last_error='SOURCE_DRIFT',
         fail_streak=0, updated_at=? WHERE source_id=?`
      )
      .run(now, sourceId)
    return this.getHealth(sourceId)!
  }

  recordBlocked(sourceId: string, toolName: string, reason: string, now: string): void {
    this.database
      .prepare(
        'INSERT INTO blocked_tools(source_id, tool_name, reason, created_at) VALUES (?, ?, ?, ?)'
      )
      .run(sourceId, toolName, reason, now)
  }

  recordToolCall(input: {
    callId: string
    sessionId: string
    toolName: string
    sourceId: ExternalSourceId
    argsDigest: string
    durationMs: number
    ok: boolean
    errorCode: string | null
    createdAt: string
  }): void {
    this.database
      .prepare(
        `INSERT INTO tool_calls(call_id, session_id, tool_name, source_id, args_digest,
         duration_ms, ok, error_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.callId,
        input.sessionId,
        input.toolName,
        input.sourceId,
        input.argsDigest,
        input.durationMs,
        input.ok ? 1 : 0,
        input.errorCode,
        input.createdAt
      )
  }

  listEvidence(sessionId: string, limit: number): EvidenceClaim[] {
    const scopeTableAvailable = this.hasEvidenceScopeTable()
    const rows = this.database
      .prepare(
        `SELECT ec.claim_id, ec.session_id, ec.subject, ec.predicate, ec.value_json,
         ec.source_id, ec.source_ref, ec.content_identity, ec.verification_status,
         ec.observed_at, ec.valid_until, ec.confidence, ec.conflicts_with, ec.notes,
         ${scopeTableAvailable ? 'ecs.scope_kind, ecs.route_id, ecs.node_id' : 'NULL AS scope_kind, NULL AS route_id, NULL AS node_id'}
         FROM evidence_claims ec
         ${scopeTableAvailable ? 'LEFT JOIN evidence_claim_scopes ecs ON ecs.claim_id = ec.claim_id' : ''}
         WHERE ec.session_id = ? ORDER BY ec.observed_at DESC, ec.claim_id LIMIT ?`
      )
      .all(sessionId, limit) as EvidenceRow[]
    return rows.map(mapEvidenceRow)
  }

  listActiveEvidenceBySource(sourceId: ExternalSourceId): EvidenceClaim[] {
    const scopeTableAvailable = this.hasEvidenceScopeTable()
    const rows = this.database
      .prepare(
        `SELECT ec.claim_id, ec.session_id, ec.subject, ec.predicate, ec.value_json,
         ec.source_id, ec.source_ref, ec.content_identity, ec.verification_status,
         ec.observed_at, ec.valid_until, ec.confidence, ec.conflicts_with, ec.notes,
         ${scopeTableAvailable ? 'ecs.scope_kind, ecs.route_id, ecs.node_id' : 'NULL AS scope_kind, NULL AS route_id, NULL AS node_id'}
         FROM evidence_claims ec
         ${scopeTableAvailable ? 'LEFT JOIN evidence_claim_scopes ecs ON ecs.claim_id = ec.claim_id' : ''}
         WHERE ec.source_id = ? AND ec.verification_status <> 'STALE'
         ORDER BY ec.session_id, ec.claim_id`
      )
      .all(sourceId) as EvidenceRow[]
    return rows.map(mapEvidenceRow)
  }

  private hasEvidenceScopeTable(): boolean {
    return Boolean(
      this.database
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='evidence_claim_scopes'")
        .get()
    )
  }

  listToolCalls(sessionId: string | undefined, limit: number): ToolCallAudit[] {
    const rows = (
      sessionId
        ? this.database
            .prepare(
              `SELECT call_id, session_id, tool_name, source_id, args_digest, duration_ms,
             ok, error_code, created_at FROM tool_calls
             WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`
            )
            .all(sessionId, limit)
        : this.database
            .prepare(
              `SELECT call_id, session_id, tool_name, source_id, args_digest, duration_ms,
             ok, error_code, created_at FROM tool_calls ORDER BY created_at DESC LIMIT ?`
            )
            .all(limit)
    ) as ToolCallRow[]
    return rows.map((row) =>
      ToolCallAuditSchema.parse({
        callId: row.call_id,
        sessionId: row.session_id,
        toolName: row.tool_name,
        sourceId: row.source_id,
        argsDigest: row.args_digest,
        durationMs: row.duration_ms,
        ok: row.ok === 1,
        errorCode: row.error_code,
        createdAt: row.created_at
      })
    )
  }

  listBlockedTools(limit: number): BlockedToolAudit[] {
    const rows = this.database
      .prepare(
        `SELECT id, source_id, tool_name, reason, created_at
         FROM blocked_tools ORDER BY created_at DESC, id DESC LIMIT ?`
      )
      .all(limit) as BlockedToolRow[]
    return rows.map((row) =>
      BlockedToolAuditSchema.parse({
        id: row.id,
        sourceId: row.source_id,
        toolName: row.tool_name,
        reason: row.reason,
        createdAt: row.created_at
      })
    )
  }
}

interface SourceHealthRow {
  source_id: string
  status: string
  last_ok_at: string | null
  last_error: string | null
  fail_streak: number
  updated_at: string
}

function mapHealthRow(row: SourceHealthRow): StoredSourceHealth {
  const parsed = SourceHealthEntrySchema.pick({
    sourceId: true,
    status: true,
    lastOkAt: true,
    lastErrorCode: true,
    failStreak: true,
    updatedAt: true
  }).parse({
    sourceId: row.source_id,
    status: row.status,
    lastOkAt: row.last_ok_at,
    lastErrorCode: row.last_error,
    failStreak: row.fail_streak,
    updatedAt: row.updated_at
  })
  return parsed
}

interface EvidenceRow {
  claim_id: string
  session_id: string
  subject: string
  predicate: string
  value_json: string
  source_id: string
  source_ref: string
  content_identity: string
  verification_status: string
  observed_at: string
  valid_until: string
  confidence: number | null
  conflicts_with: string | null
  notes: string | null
  scope_kind: string | null
  route_id: string | null
  node_id: string | null
}

function mapEvidenceRow(row: EvidenceRow): EvidenceClaim {
  const value = JSON.parse(row.value_json) as unknown
  const inferredRouteGoalLegScope =
    row.scope_kind === null &&
    row.source_id === 'USER_RESEARCH' &&
    row.predicate === 'routeLeg' &&
    isRecord(value) &&
    typeof value.fromCity === 'string' &&
    typeof value.toCity === 'string' &&
    typeof value.travelDate === 'string'
      ? {
          kind: 'ROUTE_GOAL_LEG' as const,
          fromCity: value.fromCity,
          toCity: value.toCity,
          travelDate: value.travelDate
        }
      : null
  return EvidenceClaimSchema.parse({
    claimId: row.claim_id,
    sessionId: row.session_id,
    subject: row.subject,
    predicate: row.predicate,
    value,
    sourceId: row.source_id,
    sourceRef: row.source_ref,
    contentIdentity: row.content_identity,
    verificationStatus: row.verification_status,
    observedAt: row.observed_at,
    validUntil: row.valid_until,
    scope:
      row.scope_kind === null
        ? inferredRouteGoalLegScope
        : { kind: row.scope_kind, routeId: row.route_id, nodeId: row.node_id },
    confidence: row.confidence,
    conflictsWith: row.conflicts_with ? JSON.parse(row.conflicts_with) : [],
    notes: row.notes
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface ToolCallRow {
  call_id: string
  session_id: string
  tool_name: string
  source_id: string
  args_digest: string
  duration_ms: number
  ok: number
  error_code: string | null
  created_at: string
}

interface BlockedToolRow {
  id: number
  source_id: string
  tool_name: string
  reason: string
  created_at: string
}
