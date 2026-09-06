CREATE TABLE evidence_claims_next (
  claim_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  value_json TEXT NOT NULL,
  source_id TEXT NOT NULL CHECK (source_id IN
    ('SRC_RAIL','SRC_HOTEL','SRC_MAP','SRC_SEARCH','SRC_XHS','USER_PASTE')),
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

INSERT INTO evidence_claims_next
SELECT * FROM evidence_claims;

CREATE TABLE stay_candidates_next (
  candidate_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  segment_id TEXT NOT NULL REFERENCES stay_segments(segment_id) ON DELETE CASCADE,
  source_id TEXT NOT NULL CHECK (source_id IN ('SRC_HOTEL','SRC_SEARCH','USER_PASTE')),
  name TEXT NOT NULL,
  total_cost_cents INTEGER,
  free_cancel_until TEXT,
  room_fits_party INTEGER CHECK (room_fits_party IN (0,1)),
  detail_json TEXT NOT NULL,
  claim_id TEXT REFERENCES evidence_claims_next(claim_id)
);

INSERT INTO stay_candidates_next
SELECT * FROM stay_candidates;

DROP TABLE stay_candidates;
DROP TABLE evidence_claims;
ALTER TABLE evidence_claims_next RENAME TO evidence_claims;
ALTER TABLE stay_candidates_next RENAME TO stay_candidates;

CREATE INDEX idx_claims_session ON evidence_claims(session_id);
CREATE INDEX idx_claims_subject ON evidence_claims(session_id, subject);
CREATE INDEX idx_claims_expiry ON evidence_claims(valid_until);
CREATE INDEX idx_stay_cand ON stay_candidates(session_id, segment_id);
