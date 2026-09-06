ALTER TABLE tasks ADD COLUMN timeline_version INTEGER;
ALTER TABLE tasks ADD COLUMN item_id TEXT;
ALTER TABLE tasks ADD COLUMN claim_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE tasks ADD COLUMN updated_at TEXT;

CREATE INDEX idx_tasks_item_kind
  ON tasks(session_id, timeline_version, item_id, kind);
CREATE INDEX idx_tasks_due
  ON tasks(session_id, priority, due_at, recheck_at);
