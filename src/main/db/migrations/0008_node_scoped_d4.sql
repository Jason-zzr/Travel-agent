CREATE TABLE route_node_research_states (
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  route_id TEXT NOT NULL REFERENCES itinerary_route_candidates(route_id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES itinerary_route_nodes(node_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  required INTEGER NOT NULL CHECK (required IN (0,1)),
  status TEXT NOT NULL CHECK (status IN
    ('NOT_STARTED','REVIEW_REQUIRED','BLOCKED','CONFIRMED','SKIPPED')),
  blocker_count INTEGER NOT NULL CHECK (blocker_count >= 0),
  entity_count INTEGER NOT NULL CHECK (entity_count >= 0),
  confirmed_at TEXT,
  skip_reason TEXT,
  detail_json TEXT NOT NULL,
  PRIMARY KEY (session_id, route_id, node_id)
);

CREATE TABLE route_node_research_entities (
  session_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  destination_city TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ATTRACTION','EXPERIENCE','FOOD')),
  disposition TEXT NOT NULL CHECK (disposition IN ('MUST_GO','WANT','NEUTRAL','EXCLUDE')),
  detail_json TEXT NOT NULL,
  PRIMARY KEY (session_id, route_id, node_id, entity_id),
  FOREIGN KEY (session_id, route_id, node_id)
    REFERENCES route_node_research_states(session_id, route_id, node_id) ON DELETE CASCADE
);

CREATE TABLE route_node_research_claim_links (
  session_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  claim_id TEXT NOT NULL REFERENCES evidence_claims(claim_id) ON DELETE CASCADE,
  PRIMARY KEY (session_id, route_id, node_id, entity_id, claim_id),
  FOREIGN KEY (session_id, route_id, node_id, entity_id)
    REFERENCES route_node_research_entities(session_id, route_id, node_id, entity_id)
    ON DELETE CASCADE
);

CREATE TABLE route_node_research_conflicts (
  session_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  PRIMARY KEY (session_id, route_id, node_id, subject, predicate),
  FOREIGN KEY (session_id, route_id, node_id)
    REFERENCES route_node_research_states(session_id, route_id, node_id) ON DELETE CASCADE
);

CREATE TABLE route_node_research_outcomes (
  session_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  outcome_key TEXT NOT NULL,
  source_id TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  PRIMARY KEY (session_id, route_id, node_id, outcome_key),
  FOREIGN KEY (session_id, route_id, node_id)
    REFERENCES route_node_research_states(session_id, route_id, node_id) ON DELETE CASCADE
);

CREATE TABLE evidence_claim_scopes (
  claim_id TEXT PRIMARY KEY REFERENCES evidence_claims(claim_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  scope_kind TEXT NOT NULL CHECK (scope_kind = 'ROUTE_NODE'),
  FOREIGN KEY (session_id, route_id, node_id)
    REFERENCES route_node_research_states(session_id, route_id, node_id) ON DELETE CASCADE
);

CREATE INDEX idx_route_node_research_status
  ON route_node_research_states(session_id, route_id, sequence, status);
CREATE INDEX idx_route_node_research_entities_node
  ON route_node_research_entities(session_id, route_id, node_id, disposition);
CREATE INDEX idx_evidence_claim_scopes_node
  ON evidence_claim_scopes(session_id, route_id, node_id);
