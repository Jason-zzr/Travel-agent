CREATE TABLE transport_candidates (
  candidate_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('RAIL','MANUAL_FLIGHT')),
  is_recommended INTEGER NOT NULL CHECK (is_recommended IN (0,1)),
  is_selected INTEGER NOT NULL CHECK (is_selected IN (0,1)),
  total_duration_minutes INTEGER NOT NULL CHECK (total_duration_minutes >= 0),
  total_cost_cents INTEGER CHECK (total_cost_cents >= 0),
  cost_complete INTEGER NOT NULL CHECK (cost_complete IN (0,1)),
  arrival_usable_minutes INTEGER NOT NULL CHECK (arrival_usable_minutes >= 0),
  departure_usable_minutes INTEGER NOT NULL CHECK (departure_usable_minutes >= 0),
  comfort TEXT NOT NULL CHECK (comfort IN ('GOOD','FAIR','RISK','UNKNOWN')),
  outbound_json TEXT NOT NULL,
  return_json TEXT NOT NULL,
  claim_ids_json TEXT NOT NULL,
  detail_json TEXT NOT NULL
);

CREATE INDEX idx_transport_candidates_session
  ON transport_candidates(session_id, is_selected, is_recommended);
