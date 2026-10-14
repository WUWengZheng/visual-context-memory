CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  slug TEXT NOT NULL UNIQUE CHECK(length(trim(slug)) > 0),
  description TEXT,
  root_path TEXT,
  status TEXT NOT NULL CHECK(status IN ('active', 'archived')),
  created_at TEXT NOT NULL CHECK(length(created_at) = 24 AND created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK(length(updated_at) = 24 AND updated_at GLOB '????-??-??T??:??:??.???Z')
) STRICT;

CREATE TABLE actors (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('user', 'codex', 'system', 'importer')),
  display_name TEXT NOT NULL CHECK(length(trim(display_name)) > 0),
  external_id TEXT,
  created_at TEXT NOT NULL CHECK(length(created_at) = 24 AND created_at GLOB '????-??-??T??:??:??.???Z')
) STRICT;

CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  current_revision_id TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL CHECK(lifecycle_status IN ('candidate', 'active', 'outdated', 'superseded', 'rejected', 'deleted')),
  verification_status TEXT NOT NULL CHECK(verification_status IN ('unreviewed', 'user_confirmed')),
  importance TEXT NOT NULL CHECK(importance IN ('critical', 'high', 'normal', 'low')),
  is_locked INTEGER NOT NULL CHECK(is_locked IN (0, 1)),
  locked_at TEXT CHECK(locked_at IS NULL OR (length(locked_at) = 24 AND locked_at GLOB '????-??-??T??:??:??.???Z')),
  locked_by_actor_id TEXT,
  lock_reason TEXT,
  is_pinned INTEGER NOT NULL CHECK(is_pinned IN (0, 1)),
  pinned_at TEXT CHECK(pinned_at IS NULL OR (length(pinned_at) = 24 AND pinned_at GLOB '????-??-??T??:??:??.???Z')),
  pinned_by_actor_id TEXT,
  created_by_actor_id TEXT NOT NULL,
  last_modified_by_actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL CHECK(length(created_at) = 24 AND created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK(length(updated_at) = 24 AND updated_at GLOB '????-??-??T??:??:??.???Z'),
  deleted_at TEXT CHECK(deleted_at IS NULL OR (length(deleted_at) = 24 AND deleted_at GLOB '????-??-??T??:??:??.???Z')),
  CHECK(
    (is_locked = 0 AND locked_at IS NULL AND locked_by_actor_id IS NULL AND lock_reason IS NULL)
    OR (is_locked = 1 AND locked_at IS NOT NULL AND locked_by_actor_id IS NOT NULL)
  ),
  CHECK(
    (is_pinned = 0 AND pinned_at IS NULL AND pinned_by_actor_id IS NULL)
    OR (is_pinned = 1 AND pinned_at IS NOT NULL AND pinned_by_actor_id IS NOT NULL)
  ),
  CHECK(
    (lifecycle_status = 'deleted' AND deleted_at IS NOT NULL)
    OR (lifecycle_status <> 'deleted' AND deleted_at IS NULL)
  ),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(locked_by_actor_id) REFERENCES actors(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(pinned_by_actor_id) REFERENCES actors(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(created_by_actor_id) REFERENCES actors(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(last_modified_by_actor_id) REFERENCES actors(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(id, current_revision_id) REFERENCES memory_revisions(memory_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE memory_revisions (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL CHECK(revision_number >= 1),
  name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  type TEXT NOT NULL CHECK(type IN ('entity', 'fact', 'decision', 'constraint', 'requirement', 'issue', 'resolution')),
  subtype TEXT,
  context_role TEXT NOT NULL CHECK(context_role IN (
    'background', 'current_state', 'current_plan', 'constraint', 'requirement', 'baseline',
    'result', 'decision', 'known_issue', 'open_question', 'reference'
  )),
  summary TEXT NOT NULL CHECK(length(trim(summary)) > 0),
  description TEXT,
  confidence REAL NOT NULL CHECK(confidence >= 0.0 AND confidence <= 1.0),
  value_kind TEXT NOT NULL CHECK(value_kind IN ('none', 'text', 'number', 'boolean', 'json')),
  value_text TEXT,
  value_number REAL,
  value_boolean INTEGER CHECK(value_boolean IS NULL OR value_boolean IN (0, 1)),
  value_json TEXT CHECK(value_json IS NULL OR json_valid(value_json)),
  unit TEXT,
  change_kind TEXT NOT NULL CHECK(change_kind IN ('create', 'edit', 'merge', 'conflict_resolution', 'restore')),
  change_reason TEXT,
  created_by_actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL CHECK(length(created_at) = 24 AND created_at GLOB '????-??-??T??:??:??.???Z'),
  CHECK(
    (value_kind = 'none' AND value_text IS NULL AND value_number IS NULL AND value_boolean IS NULL AND value_json IS NULL)
    OR (value_kind = 'text' AND value_text IS NOT NULL AND value_number IS NULL AND value_boolean IS NULL AND value_json IS NULL)
    OR (value_kind = 'number' AND value_text IS NULL AND value_number IS NOT NULL AND value_boolean IS NULL AND value_json IS NULL)
    OR (value_kind = 'boolean' AND value_text IS NULL AND value_number IS NULL AND value_boolean IS NOT NULL AND value_json IS NULL)
    OR (value_kind = 'json' AND value_text IS NULL AND value_number IS NULL AND value_boolean IS NULL AND value_json IS NOT NULL)
  ),
  UNIQUE(memory_id, revision_number),
  UNIQUE(memory_id, id),
  FOREIGN KEY(memory_id) REFERENCES memories(id)
    ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(created_by_actor_id) REFERENCES actors(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE memory_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN (
    'created', 'revision_created', 'confirmed', 'locked', 'unlocked', 'pinned', 'unpinned',
    'marked_outdated', 'superseded', 'rejected', 'deleted', 'soft_deleted', 'restored',
    'status_changed', 'conflict_opened', 'conflict_resolved', 'merged'
  )),
  actor_id TEXT NOT NULL,
  from_status TEXT CHECK(from_status IS NULL OR from_status IN ('candidate', 'active', 'outdated', 'superseded', 'rejected', 'deleted')),
  to_status TEXT CHECK(to_status IS NULL OR to_status IN ('candidate', 'active', 'outdated', 'superseded', 'rejected', 'deleted')),
  from_revision_id TEXT,
  to_revision_id TEXT,
  note TEXT,
  metadata_json TEXT CHECK(metadata_json IS NULL OR json_valid(metadata_json)),
  occurred_at TEXT NOT NULL CHECK(length(occurred_at) = 24 AND occurred_at GLOB '????-??-??T??:??:??.???Z'),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(memory_id) REFERENCES memories(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(actor_id) REFERENCES actors(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(memory_id, from_revision_id) REFERENCES memory_revisions(memory_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(memory_id, to_revision_id) REFERENCES memory_revisions(memory_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE source_records (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN (
    'codex_conversation', 'manual_input', 'imported_file', 'generated_result',
    'experiment_log', 'code_file', 'unknown'
  )),
  session_id TEXT,
  message_id TEXT,
  file_path TEXT,
  locator TEXT,
  original_text TEXT,
  author TEXT,
  occurred_at TEXT CHECK(occurred_at IS NULL OR (length(occurred_at) = 24 AND occurred_at GLOB '????-??-??T??:??:??.???Z')),
  captured_at TEXT NOT NULL CHECK(length(captured_at) = 24 AND captured_at GLOB '????-??-??T??:??:??.???Z'),
  content_hash TEXT,
  metadata_json TEXT CHECK(metadata_json IS NULL OR json_valid(metadata_json)),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE revision_sources (
  revision_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  evidence_role TEXT NOT NULL CHECK(evidence_role IN ('primary', 'supporting', 'contradicting')),
  created_at TEXT NOT NULL CHECK(length(created_at) = 24 AND created_at GLOB '????-??-??T??:??:??.???Z'),
  PRIMARY KEY(revision_id, source_id),
  FOREIGN KEY(revision_id) REFERENCES memory_revisions(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(source_id) REFERENCES source_records(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) WITHOUT ROWID, STRICT;

CREATE TABLE relations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_memory_id TEXT NOT NULL,
  target_memory_id TEXT NOT NULL,
  relation_type TEXT NOT NULL CHECK(relation_type IN (
    'part_of', 'uses', 'depends_on', 'evaluated_on', 'has_result', 'produces', 'addresses',
    'constrains', 'supports', 'contradicts', 'supersedes', 'derived_from', 'related_to'
  )),
  confidence REAL NOT NULL CHECK(confidence >= 0.0 AND confidence <= 1.0),
  status TEXT NOT NULL CHECK(status IN ('active', 'deleted')),
  created_by_actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL CHECK(length(created_at) = 24 AND created_at GLOB '????-??-??T??:??:??.???Z'),
  deleted_by_actor_id TEXT,
  deleted_at TEXT CHECK(deleted_at IS NULL OR (length(deleted_at) = 24 AND deleted_at GLOB '????-??-??T??:??:??.???Z')),
  deletion_reason TEXT,
  CHECK(source_memory_id <> target_memory_id),
  CHECK(
    (status = 'active' AND deleted_by_actor_id IS NULL AND deleted_at IS NULL AND deletion_reason IS NULL)
    OR (status = 'deleted' AND deleted_by_actor_id IS NOT NULL AND deleted_at IS NOT NULL)
  ),
  CHECK(relation_type <> 'related_to' OR source_memory_id < target_memory_id),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(source_memory_id) REFERENCES memories(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(target_memory_id) REFERENCES memories(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(created_by_actor_id) REFERENCES actors(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(deleted_by_actor_id) REFERENCES actors(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE relation_sources (
  relation_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  evidence_role TEXT NOT NULL CHECK(evidence_role IN ('primary', 'supporting', 'contradicting')),
  created_at TEXT NOT NULL CHECK(length(created_at) = 24 AND created_at GLOB '????-??-??T??:??:??.???Z'),
  PRIMARY KEY(relation_id, source_id),
  FOREIGN KEY(relation_id) REFERENCES relations(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(source_id) REFERENCES source_records(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) WITHOUT ROWID, STRICT;

CREATE TABLE metric_observations (
  revision_id TEXT PRIMARY KEY,
  subject_memory_id TEXT NOT NULL,
  metric_name TEXT NOT NULL CHECK(length(trim(metric_name)) > 0),
  value_number REAL NOT NULL,
  value_raw TEXT NOT NULL CHECK(length(trim(value_raw)) > 0),
  unit TEXT,
  dataset_memory_id TEXT,
  split TEXT,
  protocol TEXT,
  checkpoint TEXT,
  run_label TEXT,
  observed_at TEXT CHECK(observed_at IS NULL OR (length(observed_at) = 24 AND observed_at GLOB '????-??-??T??:??:??.???Z')),
  scope_key TEXT NOT NULL CHECK(length(trim(scope_key)) > 0),
  created_at TEXT NOT NULL CHECK(length(created_at) = 24 AND created_at GLOB '????-??-??T??:??:??.???Z'),
  FOREIGN KEY(revision_id) REFERENCES memory_revisions(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(subject_memory_id) REFERENCES memories(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(dataset_memory_id) REFERENCES memories(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE conflicts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  existing_memory_id TEXT NOT NULL,
  existing_revision_id TEXT NOT NULL,
  incoming_memory_id TEXT NOT NULL,
  incoming_revision_id TEXT NOT NULL,
  conflict_type TEXT NOT NULL CHECK(conflict_type IN (
    'value_conflict', 'status_conflict', 'semantic_conflict', 'duplicate', 'supersession_candidate'
  )),
  status TEXT NOT NULL CHECK(status IN ('open', 'resolved', 'dismissed')),
  confidence REAL NOT NULL CHECK(confidence >= 0.0 AND confidence <= 1.0),
  rationale TEXT NOT NULL CHECK(length(trim(rationale)) > 0),
  detected_by_actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL CHECK(length(created_at) = 24 AND created_at GLOB '????-??-??T??:??:??.???Z'),
  resolution TEXT CHECK(resolution IS NULL OR resolution IN (
    'keep_existing', 'use_incoming', 'keep_both', 'merge', 'mark_existing_outdated', 'reject_incoming'
  )),
  resolution_note TEXT,
  resolved_by_actor_id TEXT,
  resolved_at TEXT CHECK(resolved_at IS NULL OR (length(resolved_at) = 24 AND resolved_at GLOB '????-??-??T??:??:??.???Z')),
  result_memory_id TEXT,
  result_revision_id TEXT,
  CHECK(existing_revision_id <> incoming_revision_id),
  CHECK(
    (status = 'open' AND resolution IS NULL AND resolved_by_actor_id IS NULL AND resolved_at IS NULL)
    OR (status = 'resolved' AND resolution IS NOT NULL AND resolved_by_actor_id IS NOT NULL AND resolved_at IS NOT NULL)
    OR (status = 'dismissed' AND resolution IS NULL AND resolved_by_actor_id IS NOT NULL AND resolved_at IS NOT NULL)
  ),
  CHECK((result_memory_id IS NULL AND result_revision_id IS NULL) OR (result_memory_id IS NOT NULL AND result_revision_id IS NOT NULL)),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(existing_memory_id, existing_revision_id) REFERENCES memory_revisions(memory_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(incoming_memory_id, incoming_revision_id) REFERENCES memory_revisions(memory_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(detected_by_actor_id) REFERENCES actors(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(resolved_by_actor_id) REFERENCES actors(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(result_memory_id, result_revision_id) REFERENCES memory_revisions(memory_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE context_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  prompt_text TEXT NOT NULL CHECK(length(trim(prompt_text)) > 0),
  task_label TEXT,
  external_session_id TEXT,
  prompt_message_id TEXT,
  response_message_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('draft', 'finalized', 'used', 'abandoned')),
  created_by_actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL CHECK(length(created_at) = 24 AND created_at GLOB '????-??-??T??:??:??.???Z'),
  finalized_at TEXT CHECK(finalized_at IS NULL OR (length(finalized_at) = 24 AND finalized_at GLOB '????-??-??T??:??:??.???Z')),
  used_at TEXT CHECK(used_at IS NULL OR (length(used_at) = 24 AND used_at GLOB '????-??-??T??:??:??.???Z')),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(created_by_actor_id) REFERENCES actors(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE context_snapshots (
  id TEXT PRIMARY KEY,
  context_session_id TEXT NOT NULL,
  snapshot_number INTEGER NOT NULL CHECK(snapshot_number >= 1),
  snapshot_kind TEXT NOT NULL CHECK(snapshot_kind IN ('preview', 'final', 'used')),
  format_version TEXT NOT NULL CHECK(length(trim(format_version)) > 0),
  rendered_context TEXT NOT NULL,
  structured_context_json TEXT NOT NULL CHECK(json_valid(structured_context_json)),
  missing_information_json TEXT CHECK(missing_information_json IS NULL OR json_valid(missing_information_json)),
  content_hash TEXT NOT NULL CHECK(length(trim(content_hash)) > 0),
  created_by_actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL CHECK(length(created_at) = 24 AND created_at GLOB '????-??-??T??:??:??.???Z'),
  sealed_at TEXT CHECK(sealed_at IS NULL OR (length(sealed_at) = 24 AND sealed_at GLOB '????-??-??T??:??:??.???Z')),
  UNIQUE(context_session_id, snapshot_number),
  FOREIGN KEY(context_session_id) REFERENCES context_sessions(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(created_by_actor_id) REFERENCES actors(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE context_selections (
  id TEXT PRIMARY KEY,
  context_snapshot_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  memory_revision_id TEXT NOT NULL,
  selection_state TEXT NOT NULL CHECK(selection_state IN ('included', 'excluded')),
  selected_by_actor_id TEXT NOT NULL,
  rank INTEGER CHECK(rank IS NULL OR rank >= 1),
  relevance_score REAL,
  snapshot_payload_json TEXT NOT NULL CHECK(json_valid(snapshot_payload_json)),
  created_at TEXT NOT NULL CHECK(length(created_at) = 24 AND created_at GLOB '????-??-??T??:??:??.???Z'),
  UNIQUE(context_snapshot_id, memory_id),
  CHECK((selection_state = 'included') OR rank IS NULL),
  FOREIGN KEY(context_snapshot_id) REFERENCES context_snapshots(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(memory_id, memory_revision_id) REFERENCES memory_revisions(memory_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(selected_by_actor_id) REFERENCES actors(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE context_selection_reasons (
  id TEXT PRIMARY KEY,
  context_selection_id TEXT NOT NULL,
  reason_type TEXT NOT NULL CHECK(reason_type IN (
    'user_selected', 'pinned', 'keyword_match', 'graph_neighbor', 'current_project', 'importance',
    'context_role', 'recent', 'locked_protected', 'potential_conflict', 'outdated_warning',
    'candidate_warning', 'user_removed'
  )),
  score_contribution REAL,
  related_memory_id TEXT,
  detail TEXT,
  FOREIGN KEY(context_selection_id) REFERENCES context_selections(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(related_memory_id) REFERENCES memories(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE VIRTUAL TABLE current_memory_fts USING fts5(
  memory_id UNINDEXED,
  project_id UNINDEXED,
  name,
  summary,
  description,
  value_raw,
  tokenize = 'unicode61'
);

CREATE INDEX idx_memories_project_status ON memories(project_id, lifecycle_status);
CREATE INDEX idx_memories_project_verification ON memories(project_id, verification_status);
CREATE INDEX idx_memories_project_locked ON memories(project_id, is_locked) WHERE is_locked = 1;
CREATE INDEX idx_memories_project_pinned ON memories(project_id, is_pinned) WHERE is_pinned = 1;
CREATE INDEX idx_memories_current_revision ON memories(current_revision_id);
CREATE INDEX idx_memory_revisions_type_role ON memory_revisions(type, context_role);
CREATE INDEX idx_memory_revisions_created_at ON memory_revisions(created_at);
CREATE INDEX idx_memory_events_memory_time ON memory_events(memory_id, occurred_at);
CREATE INDEX idx_source_records_project_type ON source_records(project_id, source_type);
CREATE INDEX idx_source_records_content_hash ON source_records(content_hash) WHERE content_hash IS NOT NULL;
CREATE INDEX idx_revision_sources_source ON revision_sources(source_id);
CREATE INDEX idx_relations_source_status ON relations(source_memory_id, status);
CREATE INDEX idx_relations_target_status ON relations(target_memory_id, status);
CREATE UNIQUE INDEX uq_relations_active_edge ON relations(source_memory_id, target_memory_id, relation_type) WHERE status = 'active';
CREATE INDEX idx_relation_sources_source ON relation_sources(source_id);
CREATE INDEX idx_metric_scope ON metric_observations(subject_memory_id, metric_name, dataset_memory_id, scope_key);
CREATE INDEX idx_metric_observed_at ON metric_observations(observed_at) WHERE observed_at IS NOT NULL;
CREATE INDEX idx_conflicts_project_status ON conflicts(project_id, status, created_at);
CREATE INDEX idx_conflicts_existing_revision ON conflicts(existing_revision_id);
CREATE INDEX idx_conflicts_incoming_revision ON conflicts(incoming_revision_id);
CREATE INDEX idx_context_sessions_project_time ON context_sessions(project_id, created_at);
CREATE INDEX idx_context_snapshots_session ON context_snapshots(context_session_id, snapshot_number);
CREATE INDEX idx_context_selections_revision ON context_selections(memory_revision_id);
CREATE INDEX idx_context_selection_reasons_selection ON context_selection_reasons(context_selection_id);

CREATE TRIGGER memory_revisions_sequential
BEFORE INSERT ON memory_revisions
BEGIN
  SELECT CASE WHEN NEW.revision_number <> COALESCE(
    (SELECT MAX(revision_number) + 1 FROM memory_revisions WHERE memory_id = NEW.memory_id), 1
  ) THEN RAISE(ABORT, 'revision_number must be the next value for the memory') END;
END;

CREATE TRIGGER memory_revisions_immutable_update
BEFORE UPDATE ON memory_revisions
BEGIN
  SELECT RAISE(ABORT, 'memory_revisions are immutable');
END;

CREATE TRIGGER memory_revisions_immutable_delete
BEFORE DELETE ON memory_revisions
BEGIN
  SELECT RAISE(ABORT, 'memory_revisions cannot be deleted');
END;

CREATE TRIGGER memories_current_revision_must_be_latest
BEFORE UPDATE OF current_revision_id ON memories
BEGIN
  SELECT CASE WHEN (
    SELECT revision_number FROM memory_revisions
    WHERE id = NEW.current_revision_id AND memory_id = NEW.id
  ) <> (
    SELECT MAX(revision_number) FROM memory_revisions WHERE memory_id = NEW.id
  ) THEN RAISE(ABORT, 'current revision must be the latest revision for the memory') END;
END;

CREATE TRIGGER memory_events_project_guard
BEFORE INSERT ON memory_events
BEGIN
  SELECT CASE WHEN NEW.project_id <> (SELECT project_id FROM memories WHERE id = NEW.memory_id)
    THEN RAISE(ABORT, 'memory event project mismatch') END;
END;

CREATE TRIGGER memory_events_immutable_update
BEFORE UPDATE ON memory_events
BEGIN
  SELECT RAISE(ABORT, 'memory events are immutable');
END;

CREATE TRIGGER memory_events_immutable_delete
BEFORE DELETE ON memory_events
BEGIN
  SELECT RAISE(ABORT, 'memory events cannot be deleted');
END;

CREATE TRIGGER revision_sources_project_guard
BEFORE INSERT ON revision_sources
BEGIN
  SELECT CASE WHEN
    (SELECT m.project_id FROM memory_revisions r JOIN memories m ON m.id = r.memory_id WHERE r.id = NEW.revision_id)
    <> (SELECT project_id FROM source_records WHERE id = NEW.source_id)
    THEN RAISE(ABORT, 'revision source project mismatch') END;
END;

CREATE TRIGGER revision_sources_immutable_update
BEFORE UPDATE ON revision_sources
BEGIN
  SELECT RAISE(ABORT, 'revision provenance links are immutable');
END;

CREATE TRIGGER revision_sources_immutable_delete
BEFORE DELETE ON revision_sources
BEGIN
  SELECT RAISE(ABORT, 'revision provenance links cannot be deleted');
END;

CREATE TRIGGER relations_project_guard_insert
BEFORE INSERT ON relations
BEGIN
  SELECT CASE WHEN NEW.project_id <> (SELECT project_id FROM memories WHERE id = NEW.source_memory_id)
    OR NEW.project_id <> (SELECT project_id FROM memories WHERE id = NEW.target_memory_id)
    THEN RAISE(ABORT, 'relation project mismatch') END;
END;

CREATE TRIGGER relations_semantic_immutable
BEFORE UPDATE ON relations
WHEN NEW.project_id IS NOT OLD.project_id
  OR NEW.source_memory_id IS NOT OLD.source_memory_id
  OR NEW.target_memory_id IS NOT OLD.target_memory_id
  OR NEW.relation_type IS NOT OLD.relation_type
  OR NEW.confidence IS NOT OLD.confidence
  OR NEW.created_by_actor_id IS NOT OLD.created_by_actor_id
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'relation semantic fields are immutable');
END;

CREATE TRIGGER relations_delete_once
BEFORE UPDATE OF status ON relations
WHEN OLD.status <> 'active' OR NEW.status <> 'deleted'
BEGIN
  SELECT RAISE(ABORT, 'relations may only transition from active to deleted');
END;

CREATE TRIGGER relation_sources_project_guard
BEFORE INSERT ON relation_sources
BEGIN
  SELECT CASE WHEN
    (SELECT project_id FROM relations WHERE id = NEW.relation_id)
    <> (SELECT project_id FROM source_records WHERE id = NEW.source_id)
    THEN RAISE(ABORT, 'relation source project mismatch') END;
END;

CREATE TRIGGER relation_sources_immutable_update
BEFORE UPDATE ON relation_sources
BEGIN
  SELECT RAISE(ABORT, 'relation provenance links are immutable');
END;

CREATE TRIGGER relation_sources_immutable_delete
BEFORE DELETE ON relation_sources
BEGIN
  SELECT RAISE(ABORT, 'relation provenance links cannot be deleted');
END;

CREATE TRIGGER metric_observations_guard
BEFORE INSERT ON metric_observations
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM memory_revisions r
    WHERE r.id = NEW.revision_id AND r.type = 'fact' AND r.subtype = 'metric_observation'
  ) THEN RAISE(ABORT, 'metric observation requires fact/metric_observation revision') END;
  SELECT CASE WHEN
    (SELECT m.project_id FROM memory_revisions r JOIN memories m ON m.id = r.memory_id WHERE r.id = NEW.revision_id)
    <> (SELECT project_id FROM memories WHERE id = NEW.subject_memory_id)
    THEN RAISE(ABORT, 'metric subject project mismatch') END;
  SELECT CASE WHEN NEW.dataset_memory_id IS NOT NULL AND
    (SELECT m.project_id FROM memory_revisions r JOIN memories m ON m.id = r.memory_id WHERE r.id = NEW.revision_id)
    <> (SELECT project_id FROM memories WHERE id = NEW.dataset_memory_id)
    THEN RAISE(ABORT, 'metric dataset project mismatch') END;
END;

CREATE TRIGGER metric_observations_immutable_update
BEFORE UPDATE ON metric_observations
BEGIN
  SELECT RAISE(ABORT, 'metric observations are immutable');
END;

CREATE TRIGGER metric_observations_immutable_delete
BEFORE DELETE ON metric_observations
BEGIN
  SELECT RAISE(ABORT, 'metric observations cannot be deleted');
END;

CREATE TRIGGER conflicts_project_guard
BEFORE INSERT ON conflicts
BEGIN
  SELECT CASE WHEN NEW.project_id <> (SELECT project_id FROM memories WHERE id = NEW.existing_memory_id)
    OR NEW.project_id <> (SELECT project_id FROM memories WHERE id = NEW.incoming_memory_id)
    THEN RAISE(ABORT, 'conflict project mismatch') END;
END;

CREATE TRIGGER conflicts_resolution_only_update
BEFORE UPDATE ON conflicts
WHEN OLD.status <> 'open'
  OR NEW.status NOT IN ('resolved', 'dismissed')
  OR NEW.id IS NOT OLD.id
  OR NEW.project_id IS NOT OLD.project_id
  OR NEW.existing_memory_id IS NOT OLD.existing_memory_id
  OR NEW.existing_revision_id IS NOT OLD.existing_revision_id
  OR NEW.incoming_memory_id IS NOT OLD.incoming_memory_id
  OR NEW.incoming_revision_id IS NOT OLD.incoming_revision_id
  OR NEW.conflict_type IS NOT OLD.conflict_type
  OR NEW.confidence IS NOT OLD.confidence
  OR NEW.rationale IS NOT OLD.rationale
  OR NEW.detected_by_actor_id IS NOT OLD.detected_by_actor_id
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'conflict semantic fields are immutable and resolution is final');
END;

CREATE TRIGGER context_selections_guard
BEFORE INSERT ON context_selections
BEGIN
  SELECT CASE WHEN (SELECT sealed_at FROM context_snapshots WHERE id = NEW.context_snapshot_id) IS NOT NULL
    THEN RAISE(ABORT, 'context snapshot is sealed') END;
  SELECT CASE WHEN
    (SELECT cs.project_id FROM context_snapshots sn JOIN context_sessions cs ON cs.id = sn.context_session_id WHERE sn.id = NEW.context_snapshot_id)
    <> (SELECT project_id FROM memories WHERE id = NEW.memory_id)
    THEN RAISE(ABORT, 'context selection project mismatch') END;
END;

CREATE TRIGGER context_selections_immutable_update
BEFORE UPDATE ON context_selections
BEGIN
  SELECT RAISE(ABORT, 'context selections are immutable');
END;

CREATE TRIGGER context_selections_immutable_delete
BEFORE DELETE ON context_selections
BEGIN
  SELECT RAISE(ABORT, 'context selections cannot be deleted');
END;

CREATE TRIGGER context_selection_reasons_guard
BEFORE INSERT ON context_selection_reasons
BEGIN
  SELECT CASE WHEN (
    SELECT sn.sealed_at FROM context_selections sel
    JOIN context_snapshots sn ON sn.id = sel.context_snapshot_id
    WHERE sel.id = NEW.context_selection_id
  ) IS NOT NULL THEN RAISE(ABORT, 'context snapshot is sealed') END;
  SELECT CASE WHEN NEW.related_memory_id IS NOT NULL AND (
    SELECT cs.project_id FROM context_selections sel
    JOIN context_snapshots sn ON sn.id = sel.context_snapshot_id
    JOIN context_sessions cs ON cs.id = sn.context_session_id
    WHERE sel.id = NEW.context_selection_id
  ) <> (SELECT project_id FROM memories WHERE id = NEW.related_memory_id)
  THEN RAISE(ABORT, 'context reason project mismatch') END;
END;

CREATE TRIGGER context_selection_reasons_immutable_update
BEFORE UPDATE ON context_selection_reasons
BEGIN
  SELECT RAISE(ABORT, 'context selection reasons are immutable');
END;

CREATE TRIGGER context_selection_reasons_immutable_delete
BEFORE DELETE ON context_selection_reasons
BEGIN
  SELECT RAISE(ABORT, 'context selection reasons cannot be deleted');
END;

CREATE TRIGGER context_snapshots_seal_only_update
BEFORE UPDATE ON context_snapshots
WHEN OLD.sealed_at IS NOT NULL
  OR NEW.sealed_at IS NULL
  OR NEW.id IS NOT OLD.id
  OR NEW.context_session_id IS NOT OLD.context_session_id
  OR NEW.snapshot_number IS NOT OLD.snapshot_number
  OR NEW.snapshot_kind IS NOT OLD.snapshot_kind
  OR NEW.format_version IS NOT OLD.format_version
  OR NEW.rendered_context IS NOT OLD.rendered_context
  OR NEW.structured_context_json IS NOT OLD.structured_context_json
  OR NEW.missing_information_json IS NOT OLD.missing_information_json
  OR NEW.content_hash IS NOT OLD.content_hash
  OR NEW.created_by_actor_id IS NOT OLD.created_by_actor_id
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'context snapshots are immutable except for initial sealing');
END;

CREATE TRIGGER context_snapshots_immutable_delete
BEFORE DELETE ON context_snapshots
BEGIN
  SELECT RAISE(ABORT, 'context snapshots cannot be deleted');
END;

CREATE TRIGGER current_memory_fts_after_revision_insert
AFTER INSERT ON memory_revisions
BEGIN
  DELETE FROM current_memory_fts WHERE memory_id = NEW.memory_id;
  INSERT INTO current_memory_fts(memory_id, project_id, name, summary, description, value_raw)
  SELECT m.id, m.project_id, NEW.name, NEW.summary, COALESCE(NEW.description, ''),
    COALESCE(NEW.value_text, CAST(NEW.value_number AS TEXT), CAST(NEW.value_boolean AS TEXT), NEW.value_json, '')
  FROM memories m
  WHERE m.id = NEW.memory_id AND m.current_revision_id = NEW.id AND m.lifecycle_status <> 'deleted';
END;

CREATE TRIGGER current_memory_fts_after_memory_update
AFTER UPDATE OF current_revision_id, lifecycle_status ON memories
BEGIN
  DELETE FROM current_memory_fts WHERE memory_id = NEW.id;
  INSERT INTO current_memory_fts(memory_id, project_id, name, summary, description, value_raw)
  SELECT NEW.id, NEW.project_id, r.name, r.summary, COALESCE(r.description, ''),
    COALESCE(mo.value_raw, r.value_text, CAST(r.value_number AS TEXT), CAST(r.value_boolean AS TEXT), r.value_json, '')
  FROM memory_revisions r
  LEFT JOIN metric_observations mo ON mo.revision_id = r.id
  WHERE r.id = NEW.current_revision_id AND NEW.lifecycle_status <> 'deleted';
END;

CREATE TRIGGER current_memory_fts_after_metric_insert
AFTER INSERT ON metric_observations
BEGIN
  DELETE FROM current_memory_fts
  WHERE memory_id = (SELECT memory_id FROM memory_revisions WHERE id = NEW.revision_id);
  INSERT INTO current_memory_fts(memory_id, project_id, name, summary, description, value_raw)
  SELECT m.id, m.project_id, r.name, r.summary, COALESCE(r.description, ''), NEW.value_raw
  FROM memory_revisions r
  JOIN memories m ON m.id = r.memory_id
  WHERE r.id = NEW.revision_id AND m.current_revision_id = r.id AND m.lifecycle_status <> 'deleted';
END;
