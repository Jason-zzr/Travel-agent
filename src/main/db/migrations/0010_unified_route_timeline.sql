ALTER TABLE timeline_versions ADD COLUMN route_id TEXT;

ALTER TABLE timeline_items ADD COLUMN route_id TEXT;
ALTER TABLE timeline_items ADD COLUMN node_id TEXT;
ALTER TABLE timeline_items ADD COLUMN segment_id TEXT;
ALTER TABLE timeline_items ADD COLUMN route_leg_id TEXT;
ALTER TABLE timeline_items ADD COLUMN route_context_json TEXT;

ALTER TABLE tasks ADD COLUMN route_id TEXT;
ALTER TABLE tasks ADD COLUMN node_id TEXT;
ALTER TABLE tasks ADD COLUMN segment_id TEXT;
ALTER TABLE tasks ADD COLUMN route_leg_id TEXT;
ALTER TABLE tasks ADD COLUMN route_context_json TEXT;

CREATE INDEX idx_timeline_versions_route
  ON timeline_versions(session_id, route_id, version);
CREATE INDEX idx_timeline_items_route_scope
  ON timeline_items(session_id, route_id, node_id, segment_id, route_leg_id, date);
CREATE INDEX idx_tasks_route_scope
  ON tasks(session_id, route_id, node_id, segment_id, route_leg_id, priority);
