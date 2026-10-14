-- Phase 4 is forward-only: rebuild the append-only event table only to widen
-- its controlled vocabulary, then add the single approved Note business table.
DROP TRIGGER memory_events_project_guard;
DROP TRIGGER memory_events_immutable_update;
DROP TRIGGER memory_events_immutable_delete;
DROP INDEX idx_memory_events_memory_time;

ALTER TABLE memory_events RENAME TO memory_events_phase3;

CREATE TABLE memory_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN (
    'created', 'revision_created', 'confirmed', 'locked', 'unlocked', 'pinned', 'unpinned',
    'marked_outdated', 'superseded', 'rejected', 'deleted', 'soft_deleted', 'restored',
    'status_changed', 'importance_changed', 'note_added', 'note_deleted',
    'conflict_opened', 'conflict_resolved', 'merged'
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

INSERT INTO memory_events(
  id, project_id, memory_id, event_type, actor_id, from_status, to_status,
  from_revision_id, to_revision_id, note, metadata_json, occurred_at
)
SELECT
  id, project_id, memory_id, event_type, actor_id, from_status, to_status,
  from_revision_id, to_revision_id, note, metadata_json, occurred_at
FROM memory_events_phase3;

DROP TABLE memory_events_phase3;

CREATE INDEX idx_memory_events_memory_time ON memory_events(memory_id, occurred_at);

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

CREATE TABLE memory_notes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  content TEXT NOT NULL CHECK(length(trim(content)) > 0),
  created_by_actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL CHECK(length(created_at) = 24 AND created_at GLOB '????-??-??T??:??:??.???Z'),
  deleted_by_actor_id TEXT,
  deleted_at TEXT CHECK(deleted_at IS NULL OR (length(deleted_at) = 24 AND deleted_at GLOB '????-??-??T??:??:??.???Z')),
  deletion_reason TEXT,
  CHECK(
    (deleted_at IS NULL AND deleted_by_actor_id IS NULL AND deletion_reason IS NULL)
    OR (deleted_at IS NOT NULL AND deleted_by_actor_id IS NOT NULL)
  ),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(memory_id) REFERENCES memories(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(created_by_actor_id) REFERENCES actors(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(deleted_by_actor_id) REFERENCES actors(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE INDEX idx_memory_notes_memory_time ON memory_notes(memory_id, created_at);

CREATE TRIGGER memory_notes_project_guard
BEFORE INSERT ON memory_notes
BEGIN
  SELECT CASE WHEN NEW.project_id <> (SELECT project_id FROM memories WHERE id = NEW.memory_id)
    THEN RAISE(ABORT, 'memory note project mismatch') END;
END;

CREATE TRIGGER memory_notes_immutable_except_soft_delete
BEFORE UPDATE ON memory_notes
WHEN OLD.deleted_at IS NOT NULL
  OR NEW.id IS NOT OLD.id
  OR NEW.project_id IS NOT OLD.project_id
  OR NEW.memory_id IS NOT OLD.memory_id
  OR NEW.content IS NOT OLD.content
  OR NEW.created_by_actor_id IS NOT OLD.created_by_actor_id
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.deleted_at IS NULL
  OR NEW.deleted_by_actor_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'memory notes are immutable except for one soft delete');
END;

CREATE TRIGGER memory_notes_immutable_delete
BEFORE DELETE ON memory_notes
BEGIN
  SELECT RAISE(ABORT, 'memory notes cannot be deleted');
END;
