CREATE TABLE route_d5_leg_states (
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  route_id TEXT NOT NULL REFERENCES itinerary_route_candidates(route_id) ON DELETE CASCADE,
  leg_id TEXT NOT NULL REFERENCES itinerary_route_legs(leg_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  status TEXT NOT NULL CHECK (status IN
    ('NOT_STARTED','OPTIONS_READY','SELECTED','READY','BLOCKED')),
  source_outcome TEXT NOT NULL CHECK (source_outcome IN
    ('NOT_RUN','SUCCEEDED','FAILED','CANCELLED')),
  detail_json TEXT NOT NULL,
  PRIMARY KEY (session_id, route_id, leg_id)
);

CREATE TABLE route_d5_rail_options (
  session_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  leg_id TEXT NOT NULL,
  service_date TEXT NOT NULL,
  train_no TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('OUTBOUND','RETURN')),
  is_selected INTEGER NOT NULL CHECK (is_selected IN (0,1)),
  detail_json TEXT NOT NULL,
  PRIMARY KEY (session_id, route_id, leg_id, service_date, train_no),
  FOREIGN KEY (session_id, route_id, leg_id)
    REFERENCES route_d5_leg_states(session_id, route_id, leg_id) ON DELETE CASCADE
);

CREATE TABLE route_d5_leg_anchors (
  session_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  leg_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ARRIVAL','DEPARTURE')),
  detail_json TEXT NOT NULL,
  PRIMARY KEY (session_id, route_id, leg_id, kind),
  FOREIGN KEY (session_id, route_id, leg_id)
    REFERENCES route_d5_leg_states(session_id, route_id, leg_id) ON DELETE CASCADE
);

CREATE TABLE route_d5_stay_states (
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  route_id TEXT NOT NULL REFERENCES itinerary_route_candidates(route_id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES itinerary_route_nodes(node_id) ON DELETE CASCADE,
  segment_id TEXT NOT NULL REFERENCES itinerary_route_stay_segments(segment_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  status TEXT NOT NULL CHECK (status IN
    ('NOT_STARTED','CANDIDATES_READY','SELECTED','BLOCKED')),
  selected_candidate_id TEXT,
  detail_json TEXT NOT NULL,
  PRIMARY KEY (session_id, route_id, node_id, segment_id)
);

CREATE TABLE route_d5_stay_candidates (
  session_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  claim_id TEXT NOT NULL REFERENCES evidence_claims(claim_id) ON DELETE CASCADE,
  is_selected INTEGER NOT NULL CHECK (is_selected IN (0,1)),
  detail_json TEXT NOT NULL,
  PRIMARY KEY (session_id, route_id, node_id, segment_id, candidate_id),
  FOREIGN KEY (session_id, route_id, node_id, segment_id)
    REFERENCES route_d5_stay_states(session_id, route_id, node_id, segment_id) ON DELETE CASCADE
);

CREATE TABLE route_d5_stay_outcomes (
  session_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  PRIMARY KEY (session_id, route_id, node_id, segment_id, source_id),
  FOREIGN KEY (session_id, route_id, node_id, segment_id)
    REFERENCES route_d5_stay_states(session_id, route_id, node_id, segment_id) ON DELETE CASCADE
);

CREATE TABLE route_d5_day_skeletons (
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  route_id TEXT NOT NULL REFERENCES itinerary_route_candidates(route_id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  day_type TEXT NOT NULL CHECK (day_type IN
    ('ARRIVAL_DAY','NORMAL_DAY','DEPARTURE_DAY','INTERCITY_TRANSFER_DAY')),
  owning_node_id TEXT REFERENCES itinerary_route_nodes(node_id) ON DELETE CASCADE,
  segment_id TEXT REFERENCES itinerary_route_stay_segments(segment_id) ON DELETE CASCADE,
  route_leg_id TEXT REFERENCES itinerary_route_legs(leg_id) ON DELETE CASCADE,
  detail_json TEXT NOT NULL,
  PRIMARY KEY (session_id, route_id, date)
);

CREATE TABLE route_d5_confirmations (
  session_id TEXT PRIMARY KEY REFERENCES sessions(session_id) ON DELETE CASCADE,
  route_id TEXT NOT NULL REFERENCES itinerary_route_candidates(route_id) ON DELETE CASCADE,
  confirmed_at TEXT NOT NULL
);

CREATE INDEX idx_route_d5_leg_queue
  ON route_d5_leg_states(session_id, route_id, sequence, status);
CREATE INDEX idx_route_d5_stay_queue
  ON route_d5_stay_states(session_id, route_id, sequence, status);
CREATE INDEX idx_route_d5_days
  ON route_d5_day_skeletons(session_id, route_id, date);
