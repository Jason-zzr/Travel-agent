PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN
    ('STAGE_1','STAGE_2','STAGE_3','STAGE_4','STAGE_5','DONE')),
  linked_session_group TEXT,
  split_index INTEGER,
  last_seq INTEGER NOT NULL DEFAULT 0,
  title TEXT
);
CREATE INDEX idx_sessions_group ON sessions(linked_session_group)
  WHERE linked_session_group IS NOT NULL;

CREATE TABLE travel_states (
  session_id TEXT PRIMARY KEY REFERENCES sessions(session_id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE evidence_claims (
  claim_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  value_json TEXT NOT NULL,
  source_id TEXT NOT NULL CHECK (source_id IN
    ('SRC_RAIL','SRC_HOTEL','SRC_MAP','SRC_SEARCH','USER_PASTE')),
  source_ref TEXT NOT NULL,
  content_identity TEXT NOT NULL CHECK (content_identity IN
    ('OFFICIAL','TRANSACTION','INDEPENDENT_UGC','COMMERCIAL_OFFER','SUSPECTED_PROMOTION','UNKNOWN')),
  verification_status TEXT NOT NULL CHECK (verification_status IN
    ('VERIFIED','CORROBORATED','ESTIMATED','UNVERIFIED','CONFLICTED','STALE','VERIFIED_BY_USER')),
  observed_at TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  confidence REAL,
  conflicts_with TEXT,
  notes TEXT
);
CREATE INDEX idx_claims_session ON evidence_claims(session_id);
CREATE INDEX idx_claims_subject ON evidence_claims(session_id, subject);
CREATE INDEX idx_claims_expiry ON evidence_claims(valid_until);

CREATE TABLE day_skeletons (
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  day_type TEXT NOT NULL CHECK (day_type IN
    ('ARRIVAL_DAY','NORMAL_DAY','DEPARTURE_DAY','HOTEL_CHANGE_DAY','INTERCITY_TRANSFER_DAY')),
  intensity TEXT NOT NULL CHECK (intensity IN ('LOW','MEDIUM','HIGH')),
  morning_json TEXT,
  afternoon_json TEXT,
  evening_json TEXT,
  meal_anchors_json TEXT,
  PRIMARY KEY (session_id, date)
);

CREATE TABLE stay_segments (
  segment_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  area_hint TEXT,
  check_in_date TEXT NOT NULL,
  check_out_date TEXT NOT NULL,
  nights INTEGER NOT NULL CHECK (nights > 0),
  selected_hotel_ref TEXT
);

CREATE TABLE stay_candidates (
  candidate_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  segment_id TEXT NOT NULL REFERENCES stay_segments(segment_id) ON DELETE CASCADE,
  source_id TEXT NOT NULL CHECK (source_id IN ('SRC_HOTEL','SRC_SEARCH','USER_PASTE')),
  name TEXT NOT NULL,
  total_cost_cents INTEGER,
  free_cancel_until TEXT,
  room_fits_party INTEGER CHECK (room_fits_party IN (0,1)),
  detail_json TEXT NOT NULL,
  claim_id TEXT REFERENCES evidence_claims(claim_id)
);
CREATE INDEX idx_stay_cand ON stay_candidates(session_id, segment_id);

CREATE TABLE timeline_versions (
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  summary TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0,1)),
  PRIMARY KEY (session_id, version)
);
CREATE UNIQUE INDEX idx_timeline_current
  ON timeline_versions(session_id) WHERE is_current = 1;

CREATE TABLE timeline_items (
  item_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  title TEXT NOT NULL,
  item_class TEXT NOT NULL CHECK (item_class IN ('FIXED','RECOMMENDED','FLEXIBLE','OPTIONAL','BACKUP')),
  anchor_class TEXT NOT NULL CHECK (anchor_class IN ('HARD_LOCKED','CONFIRMED_EXTERNAL','MUST','PREFERRED','FLEXIBLE')),
  location_json TEXT,
  transport_json TEXT,
  buffer_minutes INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER,
  claim_ids TEXT,
  FOREIGN KEY (session_id, version)
    REFERENCES timeline_versions(session_id, version) ON DELETE CASCADE
);
CREATE INDEX idx_items_day ON timeline_items(session_id, version, date, start_time);

CREATE TABLE tasks (
  task_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('PREPARATION','RESERVATION_TICKET')),
  title TEXT NOT NULL,
  owner TEXT,
  due_at TEXT,
  recheck_at TEXT,
  priority TEXT NOT NULL CHECK (priority IN ('HIGH','NORMAL','LOW')),
  user_decision TEXT NOT NULL DEFAULT 'PENDING' CHECK (user_decision IN ('PENDING','ACCEPTED','SKIPPED')),
  reservation TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (reservation IN ('NOT_STARTED','IN_PROGRESS','DONE','FAILED')),
  readiness TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (readiness IN ('UNKNOWN','READY','BLOCKED')),
  payment TEXT NOT NULL DEFAULT 'NA',
  document TEXT NOT NULL DEFAULT 'NA',
  refund TEXT NOT NULL DEFAULT 'NA',
  reminder TEXT NOT NULL DEFAULT 'NA',
  handover_json TEXT
);

CREATE TABLE decision_logs (
  decision_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  topic TEXT NOT NULL,
  chosen_json TEXT NOT NULL,
  rejected_json TEXT NOT NULL,
  rationale TEXT NOT NULL,
  claim_ids TEXT
);

CREATE TABLE model_calls (
  call_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('EXTRACTION','PLANNING','REVIEW','VISION')),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  tokens_in INTEGER NOT NULL,
  tokens_out INTEGER NOT NULL,
  cost_cents INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL,
  ok INTEGER NOT NULL CHECK (ok IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_model_calls_session ON model_calls(session_id, created_at);

CREATE TABLE tool_calls (
  call_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  source_id TEXT NOT NULL,
  args_digest TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  ok INTEGER NOT NULL CHECK (ok IN (0,1)),
  error_code TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_tool_calls_session ON tool_calls(session_id, created_at);

CREATE TABLE blocked_tools (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE source_health (
  source_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('OK','DEGRADED','UNCONFIGURED')),
  last_ok_at TEXT,
  last_error TEXT,
  fail_streak INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
