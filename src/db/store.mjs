import { randomUUID } from 'node:crypto';

import { initializeDatabase, withImmediateTransaction } from './database.mjs';
import {
  jsonText,
  optionalIsoTimestamp,
  optionalString,
  requireBoolean,
  requireEnum,
  requireNumber,
  requireObject,
  requireString,
  requireUuid,
} from './validation.mjs';

const ACTOR_TYPES = ['user', 'codex', 'system', 'importer'];
const PROJECT_STATUSES = ['active', 'archived'];
const LIFECYCLE_STATUSES = ['candidate', 'active', 'outdated', 'superseded', 'rejected', 'deleted'];
const VERIFICATION_STATUSES = ['unreviewed', 'user_confirmed'];
const IMPORTANCE_VALUES = ['critical', 'high', 'normal', 'low'];
const MEMORY_TYPES = ['entity', 'fact', 'decision', 'constraint', 'requirement', 'issue', 'resolution'];
const CONTEXT_ROLES = [
  'background', 'current_state', 'current_plan', 'constraint', 'requirement', 'baseline',
  'result', 'decision', 'known_issue', 'open_question', 'reference',
];
const VALUE_KINDS = ['none', 'text', 'number', 'boolean', 'json'];
const CHANGE_KINDS = ['create', 'edit', 'merge', 'conflict_resolution', 'restore'];
const SOURCE_TYPES = [
  'codex_conversation', 'manual_input', 'imported_file', 'generated_result',
  'experiment_log', 'code_file', 'unknown',
];
const EVIDENCE_ROLES = ['primary', 'supporting', 'contradicting'];
const RELATION_TYPES = [
  'part_of', 'uses', 'depends_on', 'evaluated_on', 'has_result', 'produces', 'addresses',
  'constrains', 'supports', 'contradicts', 'supersedes', 'derived_from', 'related_to',
];
const CONFLICT_TYPES = ['value_conflict', 'status_conflict', 'semantic_conflict', 'duplicate', 'supersession_candidate'];
const CONFLICT_STATUSES = ['open', 'resolved', 'dismissed'];
const CONFLICT_RESOLUTIONS = ['keep_existing', 'use_incoming', 'keep_both', 'merge', 'mark_existing_outdated', 'reject_incoming'];
const CONTEXT_SESSION_STATUSES = ['draft', 'finalized', 'used', 'abandoned'];
const SNAPSHOT_KINDS = ['preview', 'final', 'used'];
const SELECTION_STATES = ['included', 'excluded'];
const SELECTION_REASONS = [
  'user_selected', 'pinned', 'keyword_match', 'graph_neighbor', 'current_project', 'importance',
  'context_role', 'recent', 'locked_protected', 'potential_conflict', 'outdated_warning',
  'candidate_warning', 'user_removed',
];

const MEMORY_SELECT = `
  SELECT
    m.*,
    r.id AS revision_id,
    r.revision_number,
    r.name AS revision_name,
    r.type AS revision_type,
    r.subtype AS revision_subtype,
    r.context_role,
    r.summary,
    r.description AS revision_description,
    r.confidence AS revision_confidence,
    r.value_kind,
    r.value_text,
    r.value_number,
    r.value_boolean,
    r.value_json,
    r.unit,
    r.change_kind,
    r.change_reason,
    r.created_by_actor_id AS revision_created_by_actor_id,
    r.created_at AS revision_created_at
  FROM memories m
  JOIN memory_revisions r ON r.id = m.current_revision_id
`;

function nowIso() {
  return new Date().toISOString();
}

function mapProject(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    rootPath: row.root_path,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapActor(row) {
  if (!row) return null;
  return {
    id: row.id,
    actorType: row.actor_type,
    displayName: row.display_name,
    externalId: row.external_id,
    createdAt: row.created_at,
  };
}

function mapRevision(row, prefix = '') {
  if (!row) return null;
  const field = (name) => row[`${prefix}${name}`];
  return {
    id: field('id'),
    memoryId: field('memory_id'),
    revisionNumber: field('revision_number'),
    name: field('name'),
    type: field('type'),
    subtype: field('subtype'),
    contextRole: field('context_role'),
    summary: field('summary'),
    description: field('description'),
    confidence: field('confidence'),
    valueKind: field('value_kind'),
    valueText: field('value_text'),
    valueNumber: field('value_number'),
    valueBoolean: field('value_boolean') === null ? null : Boolean(field('value_boolean')),
    valueJson: field('value_json'),
    unit: field('unit'),
    changeKind: field('change_kind'),
    changeReason: field('change_reason'),
    createdByActorId: field('created_by_actor_id'),
    createdAt: field('created_at'),
  };
}

function mapCurrentRevision(row) {
  return {
    id: row.revision_id,
    memoryId: row.id,
    revisionNumber: row.revision_number,
    name: row.revision_name,
    type: row.revision_type,
    subtype: row.revision_subtype,
    contextRole: row.context_role,
    summary: row.summary,
    description: row.revision_description,
    confidence: row.revision_confidence,
    valueKind: row.value_kind,
    valueText: row.value_text,
    valueNumber: row.value_number,
    valueBoolean: row.value_boolean === null ? null : Boolean(row.value_boolean),
    valueJson: row.value_json,
    unit: row.unit,
    changeKind: row.change_kind,
    changeReason: row.change_reason,
    createdByActorId: row.revision_created_by_actor_id,
    createdAt: row.revision_created_at,
  };
}

function mapMemory(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    currentRevisionId: row.current_revision_id,
    lifecycleStatus: row.lifecycle_status,
    verificationStatus: row.verification_status,
    importance: row.importance,
    isLocked: Boolean(row.is_locked),
    lockedAt: row.locked_at,
    lockedByActorId: row.locked_by_actor_id,
    lockReason: row.lock_reason,
    isPinned: Boolean(row.is_pinned),
    pinnedAt: row.pinned_at,
    pinnedByActorId: row.pinned_by_actor_id,
    createdByActorId: row.created_by_actor_id,
    lastModifiedByActorId: row.last_modified_by_actor_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    currentRevision: mapCurrentRevision(row),
  };
}

function mapSource(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    sourceType: row.source_type,
    sessionId: row.session_id,
    messageId: row.message_id,
    filePath: row.file_path,
    locator: row.locator,
    originalText: row.original_text,
    author: row.author,
    occurredAt: row.occurred_at,
    capturedAt: row.captured_at,
    contentHash: row.content_hash,
    metadata: row.metadata_json === null ? null : JSON.parse(row.metadata_json),
    evidenceRole: row.evidence_role,
  };
}

function mapRelation(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    sourceMemoryId: row.source_memory_id,
    targetMemoryId: row.target_memory_id,
    relationType: row.relation_type,
    confidence: row.confidence,
    status: row.status,
    createdByActorId: row.created_by_actor_id,
    createdAt: row.created_at,
    deletedByActorId: row.deleted_by_actor_id,
    deletedAt: row.deleted_at,
    deletionReason: row.deletion_reason,
  };
}

function mapMetricObservation(row) {
  if (!row) return null;
  return {
    revisionId: row.revision_id,
    subjectMemoryId: row.subject_memory_id,
    metricName: row.metric_name,
    valueNumber: row.value_number,
    valueRaw: row.value_raw,
    unit: row.unit,
    datasetMemoryId: row.dataset_memory_id,
    split: row.split,
    protocol: row.protocol,
    checkpoint: row.checkpoint,
    runLabel: row.run_label,
    observedAt: row.observed_at,
    scopeKey: row.scope_key,
    createdAt: row.created_at,
  };
}

function mapMemoryNote(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    memoryId: row.memory_id,
    content: row.content,
    createdByActorId: row.created_by_actor_id,
    createdAt: row.created_at,
    deletedByActorId: row.deleted_by_actor_id,
    deletedAt: row.deleted_at,
    deletionReason: row.deletion_reason,
  };
}

function mapConflict(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    existingMemoryId: row.existing_memory_id,
    existingRevisionId: row.existing_revision_id,
    incomingMemoryId: row.incoming_memory_id,
    incomingRevisionId: row.incoming_revision_id,
    conflictType: row.conflict_type,
    status: row.status,
    confidence: row.confidence,
    rationale: row.rationale,
    detectedByActorId: row.detected_by_actor_id,
    createdAt: row.created_at,
    resolution: row.resolution,
    resolutionNote: row.resolution_note,
    resolvedByActorId: row.resolved_by_actor_id,
    resolvedAt: row.resolved_at,
    resultMemoryId: row.result_memory_id,
    resultRevisionId: row.result_revision_id,
  };
}

function mapContextSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    promptText: row.prompt_text,
    taskLabel: row.task_label,
    externalSessionId: row.external_session_id,
    promptMessageId: row.prompt_message_id,
    responseMessageId: row.response_message_id,
    status: row.status,
    createdByActorId: row.created_by_actor_id,
    createdAt: row.created_at,
    finalizedAt: row.finalized_at,
    usedAt: row.used_at,
  };
}

function mapContextSnapshot(row) {
  if (!row) return null;
  return {
    id: row.id,
    contextSessionId: row.context_session_id,
    snapshotNumber: row.snapshot_number,
    snapshotKind: row.snapshot_kind,
    formatVersion: row.format_version,
    renderedContext: row.rendered_context,
    structuredContext: JSON.parse(row.structured_context_json),
    missingInformation: row.missing_information_json === null ? null : JSON.parse(row.missing_information_json),
    contentHash: row.content_hash,
    createdByActorId: row.created_by_actor_id,
    createdAt: row.created_at,
    sealedAt: row.sealed_at,
  };
}

function validateRevision(input, defaultChangeKind) {
  requireObject(input, 'revision');
  const valueKind = requireEnum(input.valueKind ?? 'none', VALUE_KINDS, 'revision.valueKind');
  const result = {
    name: requireString(input.name, 'revision.name'),
    type: requireEnum(input.type, MEMORY_TYPES, 'revision.type'),
    subtype: optionalString(input.subtype, 'revision.subtype'),
    contextRole: requireEnum(input.contextRole, CONTEXT_ROLES, 'revision.contextRole'),
    summary: requireString(input.summary, 'revision.summary'),
    description: optionalString(input.description, 'revision.description'),
    confidence: requireNumber(input.confidence ?? 1, 'revision.confidence', { min: 0, max: 1 }),
    valueKind,
    valueText: null,
    valueNumber: null,
    valueBoolean: null,
    valueJson: null,
    unit: optionalString(input.unit, 'revision.unit'),
    changeKind: requireEnum(input.changeKind ?? defaultChangeKind, CHANGE_KINDS, 'revision.changeKind'),
    changeReason: optionalString(input.changeReason, 'revision.changeReason'),
  };
  if (valueKind === 'text') result.valueText = requireString(input.value, 'revision.value', { allowEmpty: true });
  if (valueKind === 'number') result.valueNumber = requireNumber(input.value, 'revision.value');
  if (valueKind === 'boolean') result.valueBoolean = requireBoolean(input.value, 'revision.value') ? 1 : 0;
  if (valueKind === 'json') result.valueJson = jsonText(input.value, 'revision.value', { nullable: false });
  return result;
}

function insertRevision(database, { id, memoryId, revisionNumber, actorId, timestamp, revision }) {
  database.prepare(`
    INSERT INTO memory_revisions(
      id, memory_id, revision_number, name, type, subtype, context_role, summary, description,
      confidence, value_kind, value_text, value_number, value_boolean, value_json, unit,
      change_kind, change_reason, created_by_actor_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, memoryId, revisionNumber, revision.name, revision.type, revision.subtype,
    revision.contextRole, revision.summary, revision.description, revision.confidence,
    revision.valueKind, revision.valueText, revision.valueNumber, revision.valueBoolean,
    revision.valueJson, revision.unit, revision.changeKind, revision.changeReason, actorId, timestamp,
  );
}

function insertEvent(database, {
  projectId, memoryId, eventType, actorId, timestamp, fromStatus = null, toStatus = null,
  fromRevisionId = null, toRevisionId = null, note = null, metadata = null,
}) {
  database.prepare(`
    INSERT INTO memory_events(
      id, project_id, memory_id, event_type, actor_id, from_status, to_status,
      from_revision_id, to_revision_id, note, metadata_json, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(), projectId, memoryId, eventType, actorId, fromStatus, toStatus,
    fromRevisionId, toRevisionId, note, metadata === null ? null : JSON.stringify(metadata), timestamp,
  );
}

export class VisualContextMemoryStore {
  constructor({ dbPath } = {}) {
    this.database = initializeDatabase({ dbPath });
    this.closed = false;
  }

  close() {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }

  transaction(operation) {
    if (typeof operation !== 'function') throw new TypeError('operation must be a function');
    return withImmediateTransaction(this.database, operation);
  }

  createProject(input) {
    requireObject(input, 'project');
    const id = input.id === undefined ? randomUUID() : requireUuid(input.id, 'project.id');
    const timestamp = nowIso();
    this.database.prepare(`
      INSERT INTO projects(id, name, slug, description, root_path, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      requireString(input.name, 'project.name'),
      requireString(input.slug, 'project.slug'),
      optionalString(input.description, 'project.description'),
      optionalString(input.rootPath, 'project.rootPath'),
      requireEnum(input.status ?? 'active', PROJECT_STATUSES, 'project.status'),
      timestamp,
      timestamp,
    );
    return this.getProject(id);
  }

  getProject(id) {
    requireUuid(id, 'projectId');
    return mapProject(this.database.prepare('SELECT * FROM projects WHERE id = ?').get(id));
  }

  findProjectBySlug(slug) {
    return mapProject(this.database.prepare('SELECT * FROM projects WHERE slug = ?').get(requireString(slug, 'project.slug')));
  }

  listProjects({ status = null } = {}) {
    const clauses = [];
    const parameters = [];
    if (status !== null) {
      clauses.push('status = ?');
      parameters.push(requireEnum(status, PROJECT_STATUSES, 'project.status'));
    }
    return this.database.prepare(`
      SELECT * FROM projects ${clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`}
      ORDER BY created_at ASC, id ASC
    `).all(...parameters).map(mapProject);
  }

  createActor(input) {
    requireObject(input, 'actor');
    const id = input.id === undefined ? randomUUID() : requireUuid(input.id, 'actor.id');
    this.database.prepare(`
      INSERT INTO actors(id, actor_type, display_name, external_id, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      id,
      requireEnum(input.actorType, ACTOR_TYPES, 'actor.actorType'),
      requireString(input.displayName, 'actor.displayName'),
      optionalString(input.externalId, 'actor.externalId'),
      nowIso(),
    );
    return this.getActor(id);
  }

  getActor(id) {
    requireUuid(id, 'actorId');
    return mapActor(this.database.prepare('SELECT * FROM actors WHERE id = ?').get(id));
  }

  findActorByExternalId(externalId) {
    return mapActor(this.database.prepare('SELECT * FROM actors WHERE external_id = ?').get(requireString(externalId, 'externalId')));
  }

  #requireActor(id) {
    const actor = this.getActor(id);
    if (!actor) throw new Error(`Actor not found: ${id}`);
    return actor;
  }

  #requireUser(id) {
    const actor = this.#requireActor(id);
    if (actor.actorType !== 'user') throw new Error('This operation requires an explicit user actor');
    return actor;
  }

  createMemory(input) {
    requireObject(input, 'memory');
    const projectId = requireUuid(input.projectId, 'memory.projectId');
    const actorId = requireUuid(input.actorId, 'memory.actorId');
    if (!this.getProject(projectId)) throw new Error(`Project not found: ${projectId}`);
    const actor = this.#requireActor(actorId);
    const revision = validateRevision(input.revision, 'create');
    const lifecycleStatus = requireEnum(
      input.lifecycleStatus ?? (actor.actorType === 'user' ? 'active' : 'candidate'),
      LIFECYCLE_STATUSES,
      'memory.lifecycleStatus',
    );
    const verificationStatus = requireEnum(
      input.verificationStatus ?? (actor.actorType === 'user' ? 'user_confirmed' : 'unreviewed'),
      VERIFICATION_STATUSES,
      'memory.verificationStatus',
    );
    if (actor.actorType !== 'user' && (lifecycleStatus !== 'candidate' || verificationStatus !== 'unreviewed')) {
      throw new Error('Automatic actors may only create unreviewed candidate memories');
    }
    const isLocked = requireBoolean(input.isLocked ?? false, 'memory.isLocked');
    const isPinned = requireBoolean(input.isPinned ?? false, 'memory.isPinned');
    if ((isLocked || isPinned) && actor.actorType !== 'user') {
      throw new Error('Only a user may create locked or pinned memory');
    }
    const importance = requireEnum(input.importance ?? 'normal', IMPORTANCE_VALUES, 'memory.importance');
    const memoryId = input.id === undefined ? randomUUID() : requireUuid(input.id, 'memory.id');
    const revisionId = input.revision.id === undefined ? randomUUID() : requireUuid(input.revision.id, 'revision.id');
    const timestamp = nowIso();

    withImmediateTransaction(this.database, () => {
      this.database.prepare(`
        INSERT INTO memories(
          id, project_id, current_revision_id, lifecycle_status, verification_status, importance,
          is_locked, locked_at, locked_by_actor_id, lock_reason, is_pinned, pinned_at, pinned_by_actor_id,
          created_by_actor_id, last_modified_by_actor_id, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `).run(
        memoryId, projectId, revisionId, lifecycleStatus, verificationStatus, importance,
        isLocked ? 1 : 0, isLocked ? timestamp : null, isLocked ? actorId : null,
        isLocked ? optionalString(input.lockReason, 'memory.lockReason') : null,
        isPinned ? 1 : 0, isPinned ? timestamp : null, isPinned ? actorId : null,
        actorId, actorId, timestamp, timestamp,
      );
      insertRevision(this.database, {
        id: revisionId,
        memoryId,
        revisionNumber: 1,
        actorId,
        timestamp,
        revision,
      });
      insertEvent(this.database, {
        projectId, memoryId, eventType: 'created', actorId, timestamp,
        toStatus: lifecycleStatus, toRevisionId: revisionId,
      });
      insertEvent(this.database, {
        projectId, memoryId, eventType: 'revision_created', actorId, timestamp,
        toRevisionId: revisionId,
      });
      if (verificationStatus === 'user_confirmed') {
        insertEvent(this.database, {
          projectId, memoryId, eventType: 'confirmed', actorId, timestamp,
          toStatus: lifecycleStatus, toRevisionId: revisionId,
        });
      }
      if (isLocked) {
        insertEvent(this.database, {
          projectId, memoryId, eventType: 'locked', actorId, timestamp,
          toRevisionId: revisionId, note: optionalString(input.lockReason, 'memory.lockReason'),
        });
      }
      if (isPinned) {
        insertEvent(this.database, {
          projectId, memoryId, eventType: 'pinned', actorId, timestamp,
          toRevisionId: revisionId,
        });
      }
    });
    return this.getMemory(memoryId, { includeDeleted: true });
  }

  getMemory(id, { includeDeleted = false } = {}) {
    requireUuid(id, 'memoryId');
    requireBoolean(includeDeleted, 'includeDeleted');
    const row = this.database.prepare(`${MEMORY_SELECT} WHERE m.id = ? ${includeDeleted ? '' : "AND m.lifecycle_status <> 'deleted'"}`).get(id);
    return mapMemory(row);
  }

  listMemories({ projectId, includeDeleted = false, sortBy = 'created_at', direction = 'asc', type = null, lifecycleStatus = null, limit = 200 } = {}) {
    requireUuid(projectId, 'projectId');
    requireBoolean(includeDeleted, 'includeDeleted');
    const sortColumns = { created_at: 'm.created_at', updated_at: 'm.updated_at', importance: 'm.importance' };
    if (!(sortBy in sortColumns)) throw new RangeError('sortBy is not allowed');
    requireEnum(direction, ['asc', 'desc'], 'direction');
    requireNumber(limit, 'limit', { min: 1, max: 1000 });
    if (!Number.isInteger(limit)) throw new TypeError('limit must be an integer');
    const clauses = ['m.project_id = ?'];
    const parameters = [projectId];
    if (type !== null) {
      clauses.push('r.type = ?');
      parameters.push(requireEnum(type, MEMORY_TYPES, 'type'));
    }
    if (lifecycleStatus !== null) {
      clauses.push('m.lifecycle_status = ?');
      parameters.push(requireEnum(lifecycleStatus, LIFECYCLE_STATUSES, 'lifecycleStatus'));
    } else if (!includeDeleted) {
      clauses.push("m.lifecycle_status <> 'deleted'");
    }
    return this.database.prepare(`
      ${MEMORY_SELECT}
      WHERE ${clauses.join(' AND ')}
      ORDER BY ${sortColumns[sortBy]} ${direction.toUpperCase()}, m.id ASC
      LIMIT ?
    `).all(...parameters, limit).map(mapMemory);
  }

  // Read-only Viewer queries: SQL filters and totals precede the bounded page.
  queryMemoryPage({ projectId, type = null, lifecycleStatus = null, locked = null,
    pinned = null, limit = 100, offset = 0, query = null, memoryId = null, depth = 1, onlyMemoryId = null } = {}) {
    requireUuid(projectId, 'projectId');
    requireNumber(limit, 'limit', { min: 1, max: 200 });
    requireNumber(offset, 'offset', { min: 0, max: 1000000 });
    if (!Number.isInteger(limit) || !Number.isInteger(offset)) throw new TypeError('limit and offset must be integers');
    const clauses = ['m.project_id = ?'];
    const parameters = [projectId];
    if (onlyMemoryId !== null) {
      clauses.push('m.id = ?');
      parameters.push(requireUuid(onlyMemoryId, 'onlyMemoryId'));
    }
    if (type !== null) { clauses.push('r.type = ?'); parameters.push(requireEnum(type, MEMORY_TYPES, 'type')); }
    if (lifecycleStatus !== null) {
      clauses.push('m.lifecycle_status = ?');
      parameters.push(requireEnum(lifecycleStatus, LIFECYCLE_STATUSES, 'lifecycleStatus'));
    } else {
      clauses.push("m.lifecycle_status NOT IN ('deleted', 'rejected')");
    }
    for (const [name, value] of [['locked', locked], ['pinned', pinned]]) {
      if (value !== null) {
        clauses.push(`m.is_${name} = ?`);
        parameters.push(requireBoolean(value, name) ? 1 : 0);
      }
    }
    let prefix = '';
    let joins = '';
    let order = 'm.created_at, m.id';
    if (query !== null) {
      requireString(query, 'query');
      const tokens = query.trim().split(/\s+/u).filter(Boolean);
      if (!tokens.length) return { items: [], total: 0, limit, offset, truncated: false };
      const expression = tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(' AND ');
      joins += ' JOIN current_memory_fts ON current_memory_fts.memory_id = m.id';
      clauses.push('current_memory_fts MATCH ?');
      parameters.push(expression);
      order = 'bm25(current_memory_fts), m.id';
    }
    if (memoryId !== null) {
      requireUuid(memoryId, 'memoryId');
      requireNumber(depth, 'depth', { min: 1, max: 2 });
      if (!Number.isInteger(depth)) throw new TypeError('depth must be an integer');
      // Traverse in SQLite, including filtered intermediates, then filter/page.
      // Only the selected page is materialized in JavaScript.
      prefix = `WITH RECURSIVE walk(id, distance) AS (
        SELECT ?, 0
        UNION
        SELECT CASE WHEN rel.source_memory_id = walk.id THEN rel.target_memory_id ELSE rel.source_memory_id END,
          walk.distance + 1
        FROM walk JOIN relations rel ON (rel.source_memory_id = walk.id OR rel.target_memory_id = walk.id)
        WHERE rel.project_id = ? AND rel.status = 'active' AND walk.distance < ?
      ), reached AS (SELECT id, MIN(distance) AS distance FROM walk GROUP BY id) `;
      parameters.unshift(memoryId, projectId, depth);
      joins += ' JOIN reached ON reached.id = m.id';
      order = 'reached.distance, m.created_at, m.id';
    }
    const where = `WHERE ${clauses.join(' AND ')}`;
    const total = this.database.prepare(`${prefix}
      SELECT COUNT(*) AS total FROM memories m JOIN memory_revisions r ON r.id = m.current_revision_id
      ${joins} ${where}
    `).get(...parameters).total;
    const items = this.database.prepare(`${prefix} ${MEMORY_SELECT} ${joins} ${where}
      ORDER BY ${order} LIMIT ? OFFSET ?
    `).all(...parameters, limit, offset).map(mapMemory);
    return { items, total, limit, offset, truncated: offset + items.length < total };
  }

  createRevision(memoryId, input) {
    requireUuid(memoryId, 'memoryId');
    requireObject(input, 'revision');
    const actorId = requireUuid(input.actorId, 'revision.actorId');
    const actor = this.#requireActor(actorId);
    const revision = validateRevision(input, 'edit');
    const revisionId = input.id === undefined ? randomUUID() : requireUuid(input.id, 'revision.id');
    const timestamp = nowIso();
    return withImmediateTransaction(this.database, () => {
      const memory = this.getMemory(memoryId, { includeDeleted: true });
      if (!memory) throw new Error(`Memory not found: ${memoryId}`);
      if (memory.lifecycleStatus === 'deleted') throw new Error('Cannot revise a deleted memory');
      if (memory.isLocked && actor.actorType !== 'user') throw new Error('Locked memory can only be revised by a user');
      const revisionNumber = this.database.prepare(`
        SELECT COALESCE(MAX(revision_number), 0) + 1 AS next_number
        FROM memory_revisions WHERE memory_id = ?
      `).get(memoryId).next_number;
      insertRevision(this.database, {
        id: revisionId, memoryId, revisionNumber, actorId, timestamp, revision,
      });
      this.database.prepare(`
        UPDATE memories
        SET current_revision_id = ?,
            verification_status = CASE WHEN ? = 'user' THEN 'user_confirmed' ELSE verification_status END,
            last_modified_by_actor_id = ?, updated_at = ?
        WHERE id = ?
      `).run(revisionId, actor.actorType, actorId, timestamp, memoryId);
      insertEvent(this.database, {
        projectId: memory.projectId,
        memoryId,
        eventType: 'revision_created',
        actorId,
        timestamp,
        fromRevisionId: memory.currentRevisionId,
        toRevisionId: revisionId,
        note: revision.changeReason,
      });
      return mapRevision(this.database.prepare('SELECT * FROM memory_revisions WHERE id = ?').get(revisionId));
    });
  }

  getRevisionHistory(memoryId) {
    requireUuid(memoryId, 'memoryId');
    return this.database.prepare(`
      SELECT * FROM memory_revisions WHERE memory_id = ? ORDER BY revision_number ASC
    `).all(memoryId).map((row) => mapRevision(row));
  }

  listMemoryEvents(memoryId) {
    requireUuid(memoryId, 'memoryId');
    return this.database.prepare(`
      SELECT * FROM memory_events WHERE memory_id = ? ORDER BY occurred_at ASC, rowid ASC
    `).all(memoryId).map((row) => ({
      id: row.id,
      projectId: row.project_id,
      memoryId: row.memory_id,
      eventType: row.event_type,
      actorId: row.actor_id,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      fromRevisionId: row.from_revision_id,
      toRevisionId: row.to_revision_id,
      note: row.note,
      metadata: row.metadata_json === null ? null : JSON.parse(row.metadata_json),
      occurredAt: row.occurred_at,
    }));
  }

  transitionMemoryState(memoryId, input) {
    requireUuid(memoryId, 'memoryId');
    requireObject(input, 'memoryTransition');
    const actorId = requireUuid(input.actorId, 'memoryTransition.actorId');
    this.#requireActor(actorId);
    const lifecycleStatus = requireEnum(input.lifecycleStatus, LIFECYCLE_STATUSES, 'memoryTransition.lifecycleStatus');
    const verificationStatus = input.verificationStatus === undefined
      ? undefined
      : requireEnum(input.verificationStatus, VERIFICATION_STATUSES, 'memoryTransition.verificationStatus');
    const eventType = requireEnum(input.eventType ?? 'status_changed', [
      'confirmed', 'marked_outdated', 'superseded', 'rejected', 'deleted', 'restored', 'status_changed', 'merged',
    ], 'memoryTransition.eventType');
    return withImmediateTransaction(this.database, () => {
      const memory = this.getMemory(memoryId, { includeDeleted: true });
      if (!memory) throw new Error(`Memory not found: ${memoryId}`);
      const timestamp = nowIso();
      const nextVerification = verificationStatus ?? memory.verificationStatus;
      const deletedAt = lifecycleStatus === 'deleted' ? timestamp : null;
      this.database.prepare(`
        UPDATE memories
        SET lifecycle_status = ?, verification_status = ?, deleted_at = ?,
            last_modified_by_actor_id = ?, updated_at = ?
        WHERE id = ?
      `).run(lifecycleStatus, nextVerification, deletedAt, actorId, timestamp, memoryId);
      insertEvent(this.database, {
        projectId: memory.projectId, memoryId, eventType, actorId, timestamp,
        fromStatus: memory.lifecycleStatus, toStatus: lifecycleStatus,
        fromRevisionId: memory.currentRevisionId, toRevisionId: memory.currentRevisionId,
        note: optionalString(input.note, 'memoryTransition.note'), metadata: input.metadata ?? null,
      });
      return this.getMemory(memoryId, { includeDeleted: true });
    });
  }

  setMemoryImportance(memoryId, input) {
    requireUuid(memoryId, 'memoryId');
    requireObject(input, 'memoryImportance');
    const actorId = requireUuid(input.actorId, 'memoryImportance.actorId');
    this.#requireActor(actorId);
    const importance = requireEnum(input.importance, IMPORTANCE_VALUES, 'memoryImportance.importance');
    return withImmediateTransaction(this.database, () => {
      const memory = this.getMemory(memoryId, { includeDeleted: true });
      if (!memory) throw new Error(`Memory not found: ${memoryId}`);
      if (memory.importance === importance) return memory;
      const timestamp = nowIso();
      this.database.prepare(`
        UPDATE memories SET importance = ?, last_modified_by_actor_id = ?, updated_at = ? WHERE id = ?
      `).run(importance, actorId, timestamp, memoryId);
      insertEvent(this.database, {
        projectId: memory.projectId, memoryId, eventType: 'importance_changed', actorId, timestamp,
        fromRevisionId: memory.currentRevisionId, toRevisionId: memory.currentRevisionId,
        note: optionalString(input.note, 'memoryImportance.note'),
        metadata: { fromImportance: memory.importance, toImportance: importance },
      });
      return this.getMemory(memoryId, { includeDeleted: true });
    });
  }

  addMemoryNote(memoryId, input) {
    requireUuid(memoryId, 'memoryId');
    requireObject(input, 'memoryNote');
    const actorId = requireUuid(input.actorId, 'memoryNote.actorId');
    this.#requireActor(actorId);
    const id = input.id === undefined ? randomUUID() : requireUuid(input.id, 'memoryNote.id');
    return withImmediateTransaction(this.database, () => {
      const memory = this.getMemory(memoryId, { includeDeleted: true });
      if (!memory) throw new Error(`Memory not found: ${memoryId}`);
      const timestamp = nowIso();
      this.database.prepare(`
        INSERT INTO memory_notes(
          id, project_id, memory_id, content, created_by_actor_id, created_at,
          deleted_by_actor_id, deleted_at, deletion_reason
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
      `).run(id, memory.projectId, memoryId, requireString(input.content, 'memoryNote.content'), actorId, timestamp);
      insertEvent(this.database, {
        projectId: memory.projectId, memoryId, eventType: 'note_added', actorId, timestamp,
        toRevisionId: memory.currentRevisionId, metadata: { noteId: id },
      });
      return mapMemoryNote(this.database.prepare('SELECT * FROM memory_notes WHERE id = ?').get(id));
    });
  }

  listMemoryNotes(memoryId, { includeDeleted = false } = {}) {
    requireUuid(memoryId, 'memoryId');
    requireBoolean(includeDeleted, 'includeDeleted');
    return this.database.prepare(`
      SELECT * FROM memory_notes WHERE memory_id = ? ${includeDeleted ? '' : 'AND deleted_at IS NULL'}
      ORDER BY created_at ASC, id ASC
    `).all(memoryId).map(mapMemoryNote);
  }

  softDeleteMemoryNote(noteId, input) {
    requireUuid(noteId, 'noteId');
    requireObject(input, 'memoryNoteDelete');
    const actorId = requireUuid(input.actorId, 'memoryNoteDelete.actorId');
    this.#requireActor(actorId);
    return withImmediateTransaction(this.database, () => {
      const note = mapMemoryNote(this.database.prepare('SELECT * FROM memory_notes WHERE id = ?').get(noteId));
      if (!note) throw new Error(`Memory note not found: ${noteId}`);
      if (note.deletedAt !== null) return note;
      const timestamp = nowIso();
      const reason = optionalString(input.reason, 'memoryNoteDelete.reason');
      this.database.prepare(`
        UPDATE memory_notes SET deleted_by_actor_id = ?, deleted_at = ?, deletion_reason = ? WHERE id = ?
      `).run(actorId, timestamp, reason, noteId);
      const memory = this.getMemory(note.memoryId, { includeDeleted: true });
      insertEvent(this.database, {
        projectId: note.projectId, memoryId: note.memoryId, eventType: 'note_deleted', actorId, timestamp,
        toRevisionId: memory.currentRevisionId, note: reason, metadata: { noteId },
      });
      return mapMemoryNote(this.database.prepare('SELECT * FROM memory_notes WHERE id = ?').get(noteId));
    });
  }

  #setLock(memoryId, { actorId, locked, reason = null }) {
    requireUuid(memoryId, 'memoryId');
    requireUuid(actorId, 'actorId');
    this.#requireUser(actorId);
    requireBoolean(locked, 'locked');
    return withImmediateTransaction(this.database, () => {
      const memory = this.getMemory(memoryId, { includeDeleted: true });
      if (!memory) throw new Error(`Memory not found: ${memoryId}`);
      if (memory.lifecycleStatus === 'deleted') throw new Error('Cannot change lock on deleted memory');
      if (memory.isLocked === locked) return memory;
      const timestamp = nowIso();
      this.database.prepare(`
        UPDATE memories SET is_locked = ?, locked_at = ?, locked_by_actor_id = ?, lock_reason = ?,
          last_modified_by_actor_id = ?, updated_at = ? WHERE id = ?
      `).run(
        locked ? 1 : 0,
        locked ? timestamp : null,
        locked ? actorId : null,
        locked ? optionalString(reason, 'lock.reason') : null,
        actorId,
        timestamp,
        memoryId,
      );
      insertEvent(this.database, {
        projectId: memory.projectId, memoryId, eventType: locked ? 'locked' : 'unlocked',
        actorId, timestamp, note: locked ? optionalString(reason, 'lock.reason') : null,
      });
      return this.getMemory(memoryId, { includeDeleted: true });
    });
  }

  lockMemory(memoryId, input) {
    return this.#setLock(memoryId, { ...requireObject(input, 'lock'), locked: true });
  }

  unlockMemory(memoryId, input) {
    return this.#setLock(memoryId, { ...requireObject(input, 'unlock'), locked: false });
  }

  #setPin(memoryId, { actorId, pinned }) {
    requireUuid(memoryId, 'memoryId');
    requireUuid(actorId, 'actorId');
    this.#requireUser(actorId);
    requireBoolean(pinned, 'pinned');
    return withImmediateTransaction(this.database, () => {
      const memory = this.getMemory(memoryId, { includeDeleted: true });
      if (!memory) throw new Error(`Memory not found: ${memoryId}`);
      if (memory.lifecycleStatus === 'deleted') throw new Error('Cannot change pin on deleted memory');
      if (memory.isPinned === pinned) return memory;
      const timestamp = nowIso();
      this.database.prepare(`
        UPDATE memories SET is_pinned = ?, pinned_at = ?, pinned_by_actor_id = ?,
          last_modified_by_actor_id = ?, updated_at = ? WHERE id = ?
      `).run(pinned ? 1 : 0, pinned ? timestamp : null, pinned ? actorId : null, actorId, timestamp, memoryId);
      insertEvent(this.database, {
        projectId: memory.projectId, memoryId, eventType: pinned ? 'pinned' : 'unpinned', actorId, timestamp,
      });
      return this.getMemory(memoryId, { includeDeleted: true });
    });
  }

  pinMemory(memoryId, input) {
    return this.#setPin(memoryId, { ...requireObject(input, 'pin'), pinned: true });
  }

  unpinMemory(memoryId, input) {
    return this.#setPin(memoryId, { ...requireObject(input, 'unpin'), pinned: false });
  }

  softDeleteMemory(memoryId, input) {
    requireUuid(memoryId, 'memoryId');
    requireObject(input, 'delete');
    const actorId = requireUuid(input.actorId, 'delete.actorId');
    this.#requireUser(actorId);
    return withImmediateTransaction(this.database, () => {
      const memory = this.getMemory(memoryId, { includeDeleted: true });
      if (!memory) throw new Error(`Memory not found: ${memoryId}`);
      if (memory.lifecycleStatus === 'deleted') return memory;
      const timestamp = nowIso();
      this.database.prepare(`
        UPDATE memories SET lifecycle_status = 'deleted', deleted_at = ?,
          last_modified_by_actor_id = ?, updated_at = ? WHERE id = ?
      `).run(timestamp, actorId, timestamp, memoryId);
      insertEvent(this.database, {
        projectId: memory.projectId, memoryId, eventType: 'deleted', actorId, timestamp,
        fromStatus: memory.lifecycleStatus, toStatus: 'deleted', metadata: { previousStatus: memory.lifecycleStatus },
      });
      return this.getMemory(memoryId, { includeDeleted: true });
    });
  }

  restoreMemory(memoryId, input) {
    requireUuid(memoryId, 'memoryId');
    requireObject(input, 'restore');
    const actorId = requireUuid(input.actorId, 'restore.actorId');
    this.#requireUser(actorId);
    const lifecycleStatus = requireEnum(input.lifecycleStatus, ['candidate', 'active', 'outdated'], 'restore.lifecycleStatus');
    return withImmediateTransaction(this.database, () => {
      const memory = this.getMemory(memoryId, { includeDeleted: true });
      if (!memory) throw new Error(`Memory not found: ${memoryId}`);
      if (memory.lifecycleStatus !== 'deleted') throw new Error('Only deleted memory can be restored');
      const verificationStatus = requireEnum(input.verificationStatus ?? memory.verificationStatus, VERIFICATION_STATUSES, 'restore.verificationStatus');
      const timestamp = nowIso();
      this.database.prepare(`
        UPDATE memories SET lifecycle_status = ?, verification_status = ?, deleted_at = NULL,
          last_modified_by_actor_id = ?, updated_at = ? WHERE id = ?
      `).run(lifecycleStatus, verificationStatus, actorId, timestamp, memoryId);
      insertEvent(this.database, {
        projectId: memory.projectId, memoryId, eventType: 'restored', actorId, timestamp,
        fromStatus: 'deleted', toStatus: lifecycleStatus,
      });
      return this.getMemory(memoryId);
    });
  }

  createSource(input) {
    requireObject(input, 'source');
    const id = input.id === undefined ? randomUUID() : requireUuid(input.id, 'source.id');
    const projectId = requireUuid(input.projectId, 'source.projectId');
    if (!this.getProject(projectId)) throw new Error(`Project not found: ${projectId}`);
    this.database.prepare(`
      INSERT INTO source_records(
        id, project_id, source_type, session_id, message_id, file_path, locator, original_text,
        author, occurred_at, captured_at, content_hash, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      projectId,
      requireEnum(input.sourceType, SOURCE_TYPES, 'source.sourceType'),
      optionalString(input.sessionId, 'source.sessionId'),
      optionalString(input.messageId, 'source.messageId'),
      optionalString(input.filePath, 'source.filePath'),
      optionalString(input.locator, 'source.locator'),
      optionalString(input.originalText, 'source.originalText'),
      optionalString(input.author, 'source.author'),
      optionalIsoTimestamp(input.occurredAt, 'source.occurredAt'),
      nowIso(),
      optionalString(input.contentHash, 'source.contentHash'),
      input.metadata === undefined ? null : jsonText(input.metadata, 'source.metadata'),
    );
    return mapSource(this.database.prepare('SELECT * FROM source_records WHERE id = ?').get(id));
  }

  attachSourceToRevision(revisionId, input) {
    requireUuid(revisionId, 'revisionId');
    requireObject(input, 'revisionSource');
    const sourceId = requireUuid(input.sourceId, 'revisionSource.sourceId');
    const evidenceRole = requireEnum(input.evidenceRole ?? 'supporting', EVIDENCE_ROLES, 'revisionSource.evidenceRole');
    withImmediateTransaction(this.database, () => {
      this.database.prepare(`
        INSERT INTO revision_sources(revision_id, source_id, evidence_role, created_at)
        VALUES (?, ?, ?, ?)
      `).run(revisionId, sourceId, evidenceRole, nowIso());
    });
  }

  listSourcesForRevision(revisionId) {
    requireUuid(revisionId, 'revisionId');
    return this.database.prepare(`
      SELECT s.*, rs.evidence_role
      FROM revision_sources rs
      JOIN source_records s ON s.id = rs.source_id
      WHERE rs.revision_id = ?
      ORDER BY rs.created_at ASC, s.id ASC
    `).all(revisionId).map(mapSource);
  }

  createRelation(input) {
    requireObject(input, 'relation');
    const projectId = requireUuid(input.projectId, 'relation.projectId');
    let sourceMemoryId = requireUuid(input.sourceMemoryId, 'relation.sourceMemoryId');
    let targetMemoryId = requireUuid(input.targetMemoryId, 'relation.targetMemoryId');
    if (sourceMemoryId === targetMemoryId) throw new Error('Relation endpoints must be different; self relations are forbidden');
    const relationType = requireEnum(input.relationType, RELATION_TYPES, 'relation.relationType');
    if (relationType === 'related_to' && sourceMemoryId > targetMemoryId) {
      [sourceMemoryId, targetMemoryId] = [targetMemoryId, sourceMemoryId];
    }
    const actorId = requireUuid(input.actorId, 'relation.actorId');
    this.#requireActor(actorId);
    const id = input.id === undefined ? randomUUID() : requireUuid(input.id, 'relation.id');
    const confidence = requireNumber(input.confidence, 'relation.confidence', { min: 0, max: 1 });
    const sourceIds = input.sourceIds ?? [];
    if (!Array.isArray(sourceIds)) throw new TypeError('relation.sourceIds must be an array');
    sourceIds.forEach((sourceId) => requireUuid(sourceId, 'relation.sourceId'));
    const timestamp = nowIso();
    withImmediateTransaction(this.database, () => {
      this.database.prepare(`
        INSERT INTO relations(
          id, project_id, source_memory_id, target_memory_id, relation_type, confidence,
          status, created_by_actor_id, created_at, deleted_by_actor_id, deleted_at, deletion_reason
        ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL, NULL, NULL)
      `).run(id, projectId, sourceMemoryId, targetMemoryId, relationType, confidence, actorId, timestamp);
      for (const sourceId of sourceIds) {
        this.database.prepare(`
          INSERT INTO relation_sources(relation_id, source_id, evidence_role, created_at)
          VALUES (?, ?, 'supporting', ?)
        `).run(id, sourceId, timestamp);
      }
    });
    return mapRelation(this.database.prepare('SELECT * FROM relations WHERE id = ?').get(id));
  }

  attachSourceToRelation(relationId, input) {
    requireUuid(relationId, 'relationId');
    requireObject(input, 'relationSource');
    this.database.prepare(`
      INSERT INTO relation_sources(relation_id, source_id, evidence_role, created_at)
      VALUES (?, ?, ?, ?)
    `).run(
      relationId,
      requireUuid(input.sourceId, 'relationSource.sourceId'),
      requireEnum(input.evidenceRole ?? 'supporting', EVIDENCE_ROLES, 'relationSource.evidenceRole'),
      nowIso(),
    );
  }

  listRelations({ projectId, sourceMemoryId = null, targetMemoryId = null, includeDeleted = false } = {}) {
    requireUuid(projectId, 'projectId');
    requireBoolean(includeDeleted, 'includeDeleted');
    const clauses = ['project_id = ?'];
    const parameters = [projectId];
    if (sourceMemoryId !== null) {
      clauses.push('source_memory_id = ?');
      parameters.push(requireUuid(sourceMemoryId, 'sourceMemoryId'));
    }
    if (targetMemoryId !== null) {
      clauses.push('target_memory_id = ?');
      parameters.push(requireUuid(targetMemoryId, 'targetMemoryId'));
    }
    if (!includeDeleted) clauses.push("status = 'active'");
    return this.database.prepare(`
      SELECT * FROM relations WHERE ${clauses.join(' AND ')} ORDER BY created_at ASC, id ASC
    `).all(...parameters).map(mapRelation);
  }

  listRelationsForMemoryIds({ projectId, memoryIds, includeDeleted = false, withinOnly = false } = {}) {
    requireUuid(projectId, 'projectId');
    requireBoolean(includeDeleted, 'includeDeleted');
    requireBoolean(withinOnly, 'withinOnly');
    if (!Array.isArray(memoryIds) || memoryIds.length === 0 || memoryIds.length > 400) {
      throw new RangeError('memoryIds must contain between 1 and 400 IDs');
    }
    const ids = memoryIds.map((id) => requireUuid(id, 'memoryId'));
    const placeholders = ids.map(() => '?').join(', ');
    return this.database.prepare(`
      SELECT * FROM relations
      WHERE project_id = ? ${includeDeleted ? '' : "AND status = 'active'"}
        AND (source_memory_id IN (${placeholders}) ${withinOnly ? 'AND' : 'OR'} target_memory_id IN (${placeholders}))
      ORDER BY created_at ASC, id ASC
    `).all(projectId, ...ids, ...ids).map(mapRelation);
  }

  listSourcesForRelation(relationId) {
    requireUuid(relationId, 'relationId');
    return this.database.prepare(`
      SELECT s.*, rs.evidence_role
      FROM relation_sources rs
      JOIN source_records s ON s.id = rs.source_id
      WHERE rs.relation_id = ?
      ORDER BY rs.created_at ASC, s.id ASC
    `).all(relationId).map(mapSource);
  }

  softDeleteRelation(relationId, input) {
    requireUuid(relationId, 'relationId');
    requireObject(input, 'relationDelete');
    const actorId = requireUuid(input.actorId, 'relationDelete.actorId');
    this.#requireUser(actorId);
    return withImmediateTransaction(this.database, () => {
      const relation = mapRelation(this.database.prepare('SELECT * FROM relations WHERE id = ?').get(relationId));
      if (!relation) throw new Error(`Relation not found: ${relationId}`);
      if (relation.status === 'deleted') return relation;
      this.database.prepare(`
        UPDATE relations SET status = 'deleted', deleted_by_actor_id = ?, deleted_at = ?, deletion_reason = ?
        WHERE id = ?
      `).run(actorId, nowIso(), optionalString(input.reason, 'relationDelete.reason'), relationId);
      return mapRelation(this.database.prepare('SELECT * FROM relations WHERE id = ?').get(relationId));
    });
  }

  createMetricObservation(input) {
    requireObject(input, 'metricObservation');
    const revisionId = requireUuid(input.revisionId, 'metricObservation.revisionId');
    const timestamp = nowIso();
    this.database.prepare(`
      INSERT INTO metric_observations(
        revision_id, subject_memory_id, metric_name, value_number, value_raw, unit,
        dataset_memory_id, split, protocol, checkpoint, run_label, observed_at, scope_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      revisionId,
      requireUuid(input.subjectMemoryId, 'metricObservation.subjectMemoryId'),
      requireString(input.metricName, 'metricObservation.metricName'),
      requireNumber(input.valueNumber, 'metricObservation.valueNumber'),
      requireString(input.valueRaw, 'metricObservation.valueRaw'),
      optionalString(input.unit, 'metricObservation.unit'),
      input.datasetMemoryId === undefined || input.datasetMemoryId === null
        ? null
        : requireUuid(input.datasetMemoryId, 'metricObservation.datasetMemoryId'),
      optionalString(input.split, 'metricObservation.split'),
      optionalString(input.protocol, 'metricObservation.protocol'),
      optionalString(input.checkpoint, 'metricObservation.checkpoint'),
      optionalString(input.runLabel, 'metricObservation.runLabel'),
      optionalIsoTimestamp(input.observedAt, 'metricObservation.observedAt'),
      requireString(input.scopeKey, 'metricObservation.scopeKey'),
      timestamp,
    );
    return mapMetricObservation(this.database.prepare('SELECT * FROM metric_observations WHERE revision_id = ?').get(revisionId));
  }

  listMetricObservations({ subjectMemoryId, metricName = null, datasetMemoryId = undefined, scopeKey = null } = {}) {
    const clauses = ['subject_memory_id = ?'];
    const parameters = [requireUuid(subjectMemoryId, 'subjectMemoryId')];
    if (metricName !== null) {
      clauses.push('metric_name = ?');
      parameters.push(requireString(metricName, 'metricName'));
    }
    if (datasetMemoryId !== undefined) {
      if (datasetMemoryId === null) clauses.push('dataset_memory_id IS NULL');
      else {
        clauses.push('dataset_memory_id = ?');
        parameters.push(requireUuid(datasetMemoryId, 'datasetMemoryId'));
      }
    }
    if (scopeKey !== null) {
      clauses.push('scope_key = ?');
      parameters.push(requireString(scopeKey, 'scopeKey'));
    }
    return this.database.prepare(`
      SELECT * FROM metric_observations WHERE ${clauses.join(' AND ')} ORDER BY created_at ASC, revision_id ASC
    `).all(...parameters).map(mapMetricObservation);
  }

  getMetricObservation(revisionId) {
    requireUuid(revisionId, 'revisionId');
    return mapMetricObservation(this.database.prepare('SELECT * FROM metric_observations WHERE revision_id = ?').get(revisionId));
  }

  createConflict(input) {
    requireObject(input, 'conflict');
    const id = input.id === undefined ? randomUUID() : requireUuid(input.id, 'conflict.id');
    const projectId = requireUuid(input.projectId, 'conflict.projectId');
    const existingMemoryId = requireUuid(input.existingMemoryId, 'conflict.existingMemoryId');
    const existingRevisionId = requireUuid(input.existingRevisionId, 'conflict.existingRevisionId');
    const incomingMemoryId = requireUuid(input.incomingMemoryId, 'conflict.incomingMemoryId');
    const incomingRevisionId = requireUuid(input.incomingRevisionId, 'conflict.incomingRevisionId');
    const actorId = requireUuid(input.detectedByActorId, 'conflict.detectedByActorId');
    this.#requireActor(actorId);
    const timestamp = nowIso();
    withImmediateTransaction(this.database, () => {
      this.database.prepare(`
        INSERT INTO conflicts(
          id, project_id, existing_memory_id, existing_revision_id, incoming_memory_id, incoming_revision_id,
          conflict_type, status, confidence, rationale, detected_by_actor_id, created_at,
          resolution, resolution_note, resolved_by_actor_id, resolved_at, result_memory_id, result_revision_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL)
      `).run(
        id, projectId, existingMemoryId, existingRevisionId, incomingMemoryId, incomingRevisionId,
        requireEnum(input.conflictType, CONFLICT_TYPES, 'conflict.conflictType'),
        requireNumber(input.confidence, 'conflict.confidence', { min: 0, max: 1 }),
        requireString(input.rationale, 'conflict.rationale'), actorId, timestamp,
      );
      for (const [memoryId, revisionId] of [[existingMemoryId, existingRevisionId], [incomingMemoryId, incomingRevisionId]]) {
        insertEvent(this.database, {
          projectId, memoryId, eventType: 'conflict_opened', actorId, timestamp,
          toRevisionId: revisionId, metadata: { conflictId: id },
        });
      }
    });
    return this.getConflict(id);
  }

  getConflict(id) {
    requireUuid(id, 'conflictId');
    return mapConflict(this.database.prepare('SELECT * FROM conflicts WHERE id = ?').get(id));
  }

  listConflicts({ projectId, status = null } = {}) {
    requireUuid(projectId, 'projectId');
    const clauses = ['project_id = ?'];
    const parameters = [projectId];
    if (status !== null) {
      clauses.push('status = ?');
      parameters.push(requireEnum(status, CONFLICT_STATUSES, 'conflict.status'));
    }
    return this.database.prepare(`
      SELECT * FROM conflicts WHERE ${clauses.join(' AND ')} ORDER BY created_at ASC, id ASC
    `).all(...parameters).map(mapConflict);
  }

  resolveConflict(conflictId, input) {
    requireUuid(conflictId, 'conflictId');
    requireObject(input, 'resolution');
    const actorId = requireUuid(input.actorId, 'resolution.actorId');
    this.#requireUser(actorId);
    const resolution = requireEnum(input.resolution, CONFLICT_RESOLUTIONS, 'resolution.resolution');
    const resultMemoryId = input.resultMemoryId === undefined || input.resultMemoryId === null
      ? null
      : requireUuid(input.resultMemoryId, 'resolution.resultMemoryId');
    const resultRevisionId = input.resultRevisionId === undefined || input.resultRevisionId === null
      ? null
      : requireUuid(input.resultRevisionId, 'resolution.resultRevisionId');
    if ((resultMemoryId === null) !== (resultRevisionId === null)) {
      throw new Error('resultMemoryId and resultRevisionId must be provided together');
    }
    return withImmediateTransaction(this.database, () => {
      const conflict = this.getConflict(conflictId);
      if (!conflict) throw new Error(`Conflict not found: ${conflictId}`);
      if (conflict.status !== 'open') throw new Error('Only open conflicts can be resolved');
      const timestamp = nowIso();
      this.database.prepare(`
        UPDATE conflicts SET status = 'resolved', resolution = ?, resolution_note = ?,
          resolved_by_actor_id = ?, resolved_at = ?, result_memory_id = ?, result_revision_id = ?
        WHERE id = ?
      `).run(
        resolution, optionalString(input.note, 'resolution.note'), actorId, timestamp,
        resultMemoryId, resultRevisionId, conflictId,
      );
      for (const [memoryId, revisionId] of [
        [conflict.existingMemoryId, conflict.existingRevisionId],
        [conflict.incomingMemoryId, conflict.incomingRevisionId],
      ]) {
        insertEvent(this.database, {
          projectId: conflict.projectId, memoryId, eventType: 'conflict_resolved', actorId, timestamp,
          toRevisionId: revisionId, metadata: { conflictId, resolution },
        });
      }
      return this.getConflict(conflictId);
    });
  }

  createContextSession(input) {
    requireObject(input, 'contextSession');
    const id = input.id === undefined ? randomUUID() : requireUuid(input.id, 'contextSession.id');
    const projectId = requireUuid(input.projectId, 'contextSession.projectId');
    const actorId = requireUuid(input.actorId, 'contextSession.actorId');
    this.#requireActor(actorId);
    this.database.prepare(`
      INSERT INTO context_sessions(
        id, project_id, prompt_text, task_label, external_session_id, prompt_message_id, response_message_id,
        status, created_by_actor_id, created_at, finalized_at, used_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
    `).run(
      id, projectId, requireString(input.promptText, 'contextSession.promptText'),
      optionalString(input.taskLabel, 'contextSession.taskLabel'),
      optionalString(input.externalSessionId, 'contextSession.externalSessionId'),
      optionalString(input.promptMessageId, 'contextSession.promptMessageId'),
      optionalString(input.responseMessageId, 'contextSession.responseMessageId'),
      requireEnum(input.status ?? 'draft', CONTEXT_SESSION_STATUSES, 'contextSession.status'),
      actorId, nowIso(),
    );
    return mapContextSession(this.database.prepare('SELECT * FROM context_sessions WHERE id = ?').get(id));
  }

  listContextSessions({ projectId } = {}) {
    requireUuid(projectId, 'projectId');
    return this.database.prepare(`
      SELECT * FROM context_sessions WHERE project_id = ? ORDER BY created_at ASC, id ASC
    `).all(projectId).map(mapContextSession);
  }

  getContextSession(contextSessionId) {
    requireUuid(contextSessionId, 'contextSessionId');
    return mapContextSession(this.database.prepare('SELECT * FROM context_sessions WHERE id = ?').get(contextSessionId));
  }

  createContextSnapshot(input) {
    requireObject(input, 'contextSnapshot');
    const contextSessionId = requireUuid(input.contextSessionId, 'contextSnapshot.contextSessionId');
    const actorId = requireUuid(input.actorId, 'contextSnapshot.actorId');
    this.#requireActor(actorId);
    const selections = input.selections ?? [];
    if (!Array.isArray(selections)) throw new TypeError('contextSnapshot.selections must be an array');
    const snapshotId = input.id === undefined ? randomUUID() : requireUuid(input.id, 'contextSnapshot.id');
    const snapshotKind = requireEnum(input.snapshotKind, SNAPSHOT_KINDS, 'contextSnapshot.snapshotKind');
    const formatVersion = requireString(input.formatVersion, 'contextSnapshot.formatVersion');
    const renderedContext = requireString(input.renderedContext, 'contextSnapshot.renderedContext', { allowEmpty: true });
    const structuredContextJson = jsonText(input.structuredContext, 'contextSnapshot.structuredContext', { nullable: false });
    const missingInformationJson = input.missingInformation === undefined
      ? null
      : jsonText(input.missingInformation, 'contextSnapshot.missingInformation');
    const contentHash = requireString(input.contentHash, 'contextSnapshot.contentHash');
    const timestamp = nowIso();

    return withImmediateTransaction(this.database, () => {
      const session = mapContextSession(this.database.prepare('SELECT * FROM context_sessions WHERE id = ?').get(contextSessionId));
      if (!session) throw new Error(`Context session not found: ${contextSessionId}`);
      const snapshotNumber = this.database.prepare(`
        SELECT COALESCE(MAX(snapshot_number), 0) + 1 AS next_number
        FROM context_snapshots WHERE context_session_id = ?
      `).get(contextSessionId).next_number;
      this.database.prepare(`
        INSERT INTO context_snapshots(
          id, context_session_id, snapshot_number, snapshot_kind, format_version, rendered_context,
          structured_context_json, missing_information_json, content_hash, created_by_actor_id, created_at, sealed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `).run(
        snapshotId, contextSessionId, snapshotNumber, snapshotKind, formatVersion, renderedContext,
        structuredContextJson, missingInformationJson, contentHash, actorId, timestamp,
      );

      for (const selectionInput of selections) {
        requireObject(selectionInput, 'contextSelection');
        const selectionId = selectionInput.id === undefined ? randomUUID() : requireUuid(selectionInput.id, 'contextSelection.id');
        const selectionState = requireEnum(selectionInput.selectionState, SELECTION_STATES, 'contextSelection.selectionState');
        const rank = selectionInput.rank === undefined || selectionInput.rank === null
          ? null
          : requireNumber(selectionInput.rank, 'contextSelection.rank', { min: 1 });
        if (rank !== null && !Number.isInteger(rank)) throw new TypeError('contextSelection.rank must be an integer');
        const score = selectionInput.relevanceScore === undefined || selectionInput.relevanceScore === null
          ? null
          : requireNumber(selectionInput.relevanceScore, 'contextSelection.relevanceScore');
        this.database.prepare(`
          INSERT INTO context_selections(
            id, context_snapshot_id, memory_id, memory_revision_id, selection_state,
            selected_by_actor_id, rank, relevance_score, snapshot_payload_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          selectionId, snapshotId,
          requireUuid(selectionInput.memoryId, 'contextSelection.memoryId'),
          requireUuid(selectionInput.memoryRevisionId, 'contextSelection.memoryRevisionId'),
          selectionState,
          requireUuid(selectionInput.selectedByActorId, 'contextSelection.selectedByActorId'),
          rank,
          score,
          jsonText(selectionInput.snapshotPayload, 'contextSelection.snapshotPayload', { nullable: false }),
          timestamp,
        );
        const reasons = selectionInput.reasons ?? [];
        if (!Array.isArray(reasons)) throw new TypeError('contextSelection.reasons must be an array');
        for (const reason of reasons) {
          requireObject(reason, 'contextSelectionReason');
          const contribution = reason.scoreContribution === undefined || reason.scoreContribution === null
            ? null
            : requireNumber(reason.scoreContribution, 'contextSelectionReason.scoreContribution');
          this.database.prepare(`
            INSERT INTO context_selection_reasons(
              id, context_selection_id, reason_type, score_contribution, related_memory_id, detail
            ) VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            reason.id === undefined ? randomUUID() : requireUuid(reason.id, 'contextSelectionReason.id'),
            selectionId,
            requireEnum(reason.reasonType, SELECTION_REASONS, 'contextSelectionReason.reasonType'),
            contribution,
            reason.relatedMemoryId === undefined || reason.relatedMemoryId === null
              ? null
              : requireUuid(reason.relatedMemoryId, 'contextSelectionReason.relatedMemoryId'),
            optionalString(reason.detail, 'contextSelectionReason.detail'),
          );
        }
      }

      this.database.prepare('UPDATE context_snapshots SET sealed_at = ? WHERE id = ?').run(timestamp, snapshotId);
      if (snapshotKind === 'final') {
        this.database.prepare(`
          UPDATE context_sessions SET status = 'finalized', finalized_at = ? WHERE id = ?
        `).run(timestamp, contextSessionId);
      } else if (snapshotKind === 'used') {
        this.database.prepare(`
          UPDATE context_sessions SET status = 'used', finalized_at = COALESCE(finalized_at, ?), used_at = ? WHERE id = ?
        `).run(timestamp, timestamp, contextSessionId);
      }
      return this.getContextSnapshot(snapshotId);
    });
  }

  getContextSnapshot(snapshotId) {
    requireUuid(snapshotId, 'snapshotId');
    const snapshot = mapContextSnapshot(this.database.prepare('SELECT * FROM context_snapshots WHERE id = ?').get(snapshotId));
    if (!snapshot) return null;
    const selections = this.database.prepare(`
      SELECT * FROM context_selections WHERE context_snapshot_id = ? ORDER BY COALESCE(rank, 2147483647), created_at, id
    `).all(snapshotId).map((row) => {
      const reasons = this.database.prepare(`
        SELECT * FROM context_selection_reasons WHERE context_selection_id = ? ORDER BY rowid
      `).all(row.id).map((reason) => ({
        id: reason.id,
        reasonType: reason.reason_type,
        scoreContribution: reason.score_contribution,
        relatedMemoryId: reason.related_memory_id,
        detail: reason.detail,
      }));
      return {
        id: row.id,
        memoryId: row.memory_id,
        memoryRevisionId: row.memory_revision_id,
        selectionState: row.selection_state,
        selectedByActorId: row.selected_by_actor_id,
        rank: row.rank,
        relevanceScore: row.relevance_score,
        snapshotPayload: JSON.parse(row.snapshot_payload_json),
        createdAt: row.created_at,
        reasons,
      };
    });
    return { ...snapshot, selections };
  }

  listContextSnapshots(contextSessionId) {
    requireUuid(contextSessionId, 'contextSessionId');
    return this.database.prepare(`
      SELECT * FROM context_snapshots WHERE context_session_id = ? ORDER BY snapshot_number ASC
    `).all(contextSessionId).map(mapContextSnapshot);
  }

  searchCurrentMemories({ projectId, query, limit = 50 } = {}) {
    requireUuid(projectId, 'projectId');
    requireString(query, 'query');
    requireNumber(limit, 'limit', { min: 1, max: 200 });
    if (!Number.isInteger(limit)) throw new TypeError('limit must be an integer');
    const tokens = query.trim().split(/\s+/u).filter(Boolean);
    if (tokens.length === 0) return [];
    const matchExpression = tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(' AND ');
    const ids = this.database.prepare(`
      SELECT f.memory_id
      FROM current_memory_fts f
      JOIN memories m ON m.id = f.memory_id
      WHERE current_memory_fts MATCH ? AND f.project_id = ? AND m.lifecycle_status NOT IN ('deleted', 'rejected')
      ORDER BY bm25(current_memory_fts), f.memory_id
      LIMIT ?
    `).all(matchExpression, projectId, limit).map((row) => row.memory_id);
    return ids.map((id) => this.getMemory(id)).filter(Boolean);
  }
}
