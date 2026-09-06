CREATE TABLE itinerary_route_candidates (
  route_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  profile TEXT NOT NULL CHECK (profile IN ('BALANCED','LOW_TRANSIT','RELAXED')),
  is_recommended INTEGER NOT NULL CHECK (is_recommended IN (0,1)),
  is_selected INTEGER NOT NULL CHECK (is_selected IN (0,1)),
  hard_constraint_pass INTEGER NOT NULL CHECK (hard_constraint_pass IN (0,1)),
  critical_evidence_complete INTEGER NOT NULL CHECK (critical_evidence_complete IN (0,1)),
  score_json TEXT NOT NULL,
  detail_json TEXT NOT NULL
);

CREATE TABLE itinerary_route_nodes (
  node_id TEXT PRIMARY KEY,
  route_id TEXT NOT NULL REFERENCES itinerary_route_candidates(route_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  city TEXT NOT NULL,
  node_kind TEXT NOT NULL CHECK (node_kind IN ('STAY','TRANSIT')),
  arrival_date TEXT NOT NULL,
  departure_date TEXT NOT NULL,
  nights INTEGER NOT NULL CHECK (nights >= 0),
  mandatory_place_ids_json TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  UNIQUE(route_id, sequence)
);

CREATE TABLE itinerary_route_legs (
  leg_id TEXT PRIMARY KEY,
  route_id TEXT NOT NULL REFERENCES itinerary_route_candidates(route_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  from_city TEXT NOT NULL,
  to_city TEXT NOT NULL,
  travel_date TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN
    ('RAIL','MANUAL_FLIGHT','MANUAL_COACH','LOCAL_TRANSFER','UNKNOWN')),
  duration_minutes INTEGER CHECK (duration_minutes >= 0),
  cost_cents INTEGER CHECK (cost_cents >= 0),
  verification_status TEXT NOT NULL,
  claim_ids_json TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  UNIQUE(route_id, sequence)
);

CREATE TABLE itinerary_route_stay_segments (
  segment_id TEXT PRIMARY KEY,
  route_id TEXT NOT NULL REFERENCES itinerary_route_candidates(route_id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES itinerary_route_nodes(node_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  city TEXT NOT NULL,
  check_in_date TEXT NOT NULL,
  check_out_date TEXT NOT NULL,
  nights INTEGER NOT NULL CHECK (nights > 0),
  detail_json TEXT NOT NULL
);

CREATE TABLE itinerary_route_selections (
  session_id TEXT PRIMARY KEY REFERENCES sessions(session_id) ON DELETE CASCADE,
  selected_route_id TEXT NOT NULL REFERENCES itinerary_route_candidates(route_id) ON DELETE CASCADE,
  selected_at TEXT NOT NULL,
  reason TEXT NOT NULL
);

CREATE INDEX idx_itinerary_route_candidates_session
  ON itinerary_route_candidates(session_id, is_selected, is_recommended);
CREATE INDEX idx_itinerary_route_nodes_route
  ON itinerary_route_nodes(route_id, sequence);
CREATE INDEX idx_itinerary_route_legs_route
  ON itinerary_route_legs(route_id, sequence);
CREATE INDEX idx_itinerary_route_stays_session
  ON itinerary_route_stay_segments(session_id, route_id);
