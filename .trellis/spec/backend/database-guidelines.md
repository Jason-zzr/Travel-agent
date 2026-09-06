# Database Guidelines

> Pre-implementation contract from `DATA_MODEL.md` and `MIGRATION.md`; no ORM or repository implementation exists yet.

## Storage Model

- `events.jsonl` is the authoritative append-only fact source. SQLite is a disposable read model.
- All state-changing writes follow: append JSONL line -> `fsync` -> SQLite transaction -> emit event.
- Never write business state directly to SQLite. Every user-confirmed change must be representable as an event and replayable.
- All paths come from `src/main/paths.ts` under `app.getPath('userData')`.
- Use `better-sqlite3 >=13.0.1` in `dependencies`; do not introduce an ORM.

## Scenario: JSONL Append Failure Recovery

### 1. Scope / Trigger

- Applies whenever `EventLogService` appends a durable event or planned event. It prevents a partial write from remaining ahead of the in-memory sequence cursor.

### 2. Signatures

- Public: `EventLogService.append(draft): Promise<SessionEvent>` and `ensurePlanned(event): Promise<SessionEvent>`.
- Internal: `appendLine(path, line): Promise<void>` records the pre-append byte size; `rollbackAppend(path, size): Promise<void>` truncates and fsyncs.

### 3. Contracts

- Append one UTF-8 JSON line, then fsync. Advance `nextSequence` only after `appendLine` resolves.
- On write or fsync failure, close the append handle before opening the same path as `r+`, truncate to the captured byte size, fsync the repair, and close it.
- Preserve the existing read contract: only an already-existing malformed final crash tail may be ignored; middle corruption still fails closed.

### 4. Validation & Error Matrix

- Write/fsync fails and rollback succeeds -> rethrow the original error; file bytes and sequence cursor remain unchanged.
- Write/fsync and rollback both fail -> throw `AggregateError` containing both failures; do not advance the sequence.
- Append succeeds -> return the validated event and advance the per-session sequence exactly once.

### 5. Good/Base/Bad Cases

- Good: sync fails after bytes were written; the file is byte-identical to its prior state and retry uses the same next sequence.
- Base: append and fsync succeed once; no rollback handle is opened.
- Bad: catch the sync error without truncating, or update `nextSequence` before fsync completes.

### 6. Tests Required

- Inject one append-handle sync failure; assert byte-identical rollback, successful retry at the expected sequence, and a readable continuous log.
- Existing tests must continue to reject malformed middle lines and sequence gaps while tolerating only a truncated final line.

### 7. Wrong vs Correct

```ts
// Wrong: partial bytes can survive while the caller retries the same seq.
await handle.writeFile(line, 'utf8')
await handle.sync()

// Correct: capture size, close on failure, truncate, fsync, then rethrow.
const { size } = await handle.stat()
try {
  await handle.writeFile(line, 'utf8')
  await handle.sync()
} catch (error) {
  await closeAppendHandle()
  await rollbackAppend(path, size)
  throw error
}
```

## Connection and Query Rules

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;
```

- Read back and verify `foreign_keys = ON` after opening.
- Batch replay inserts inside one transaction; do not loop over unwrapped writes on the main process.
- Stream JSONL line by line; do not `readFileSync` and split the entire file.
- Timeline queries must join `timeline_versions` and filter `is_current = 1`.
- Reducers are pure: no I/O, model calls, logging, or external calls during replay.
- Rebuild must verify final state sequence equals the final valid JSONL sequence.

## Data Conventions

- Tables: plural snake_case. Columns: snake_case. TypeScript fields: camelCase.
- Time: ISO 8601 UTC in `TEXT`; timeline local clock fields remain `HH:MM` by contract.
- Boolean: `INTEGER NOT NULL CHECK (value IN (0,1))`.
- Enum: `TEXT CHECK (...)`, byte-for-byte aligned with the Zod enum.
- Money: integer cents; `REAL` prices are forbidden.
- `source_ref` is mandatory. Expired claims become `STALE`; they are not deleted.
- Tool argument audit data stores a digest, never raw arguments.

## Migrations and Event Evolution

- Before BUILD-D2 user-data compatibility, read-model changes could update `0001_init.sql`. From BUILD-D2 onward, `0001_init.sql` is immutable and all changes use additive numbered migrations.
- After real user data exists, migrations use `NNNN_description.sql`, one transaction per file; committed migrations are immutable.
- Do not write down migrations. A migration failure raises `STORE_MIGRATION_FAILED` and aborts startup.
- Refuse startup when the database version is newer than the application.
- Published event types and field meanings are immutable. Add optional fields or a new `*-v2` event type; never rewrite history or reorder `seq`.
- Replay schemas tolerate legacy payloads and additive fields; write schemas require the current event version. When a Zod union contains a permissive legacy object, place the current-version branch first so legacy parsing cannot strip current fields.
- Runtime connection PRAGMAs are applied by `openDatabase()`. Migration execution strips top-level `PRAGMA` lines before wrapping DDL and the migration record in one transaction.
- Do not delete `quota_counters` while clearing POI cache.
- Migration `0010_unified_route_timeline.sql` only adds nullable route scope and indexes to existing timeline/task projections. Legacy rows stay null; multi-city scope is rebuilt from unchanged `timeline/published`, `task/updated`, and `gate/result` JSONL events without source/model calls.

## Forbidden Patterns

- Direct `UPDATE`/`INSERT` of business state outside the event application path.
- `foreign_keys = OFF`, floating-point money, integer timestamps, or empty `source_ref`.
- Clearing audit tables (`model_calls`, `tool_calls`, `blocked_tools`, `source_health`) during replay.
- Adding migration frameworks, down migrations, snapshot migrations, or event-log rewriting in M0.

## Open Contracts

The safeStorage ciphertext path is resolved as `<userData>/credentials.json` (version 1, base64 ciphertext only, atomic replacement, excluded from exports). `evidence_claims.subject` normalization and a transport-candidate persistence model remain unresolved in `TODO.md` §5.9.

## Sources

`DATA_MODEL.md` §§1–5; `MIGRATION.md` §§1–4, 7–8; `ARCHITECTURE.md` §§5–6.
