import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { initializeDatabase, SYSTEM_ACTOR_ID } from '../../src/db/database.mjs';
import { VisualContextMemoryStore } from '../../src/db/store.mjs';

function createTestStore(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-store-'));
  const dbPath = path.join(directory, 'memory.db');
  const store = new VisualContextMemoryStore({ dbPath });
  t.after(() => {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { store, dbPath };
}

function createUserAndProject(store) {
  const user = store.createActor({ actorType: 'user', displayName: 'Test user' });
  const project = store.createProject({ name: 'COMP-2DPASS', slug: 'comp-2dpass' });
  return { user, project };
}

function entityRevision(name, subtype = 'experiment') {
  return {
    name,
    type: 'entity',
    subtype,
    contextRole: 'current_state',
    summary: `${name} is part of the test project.`,
    confidence: 1,
  };
}

function metricRevision(name, value) {
  return {
    name,
    type: 'fact',
    subtype: 'metric_observation',
    contextRole: 'baseline',
    summary: `Stage1 achieved Clean mIoU ${value}.`,
    confidence: 1,
  };
}

test('database initialization applies the initial schema and enables foreign keys', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-db-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const database = initializeDatabase({ dbPath: path.join(directory, 'memory.db') });
  t.after(() => database.close());

  assert.equal(database.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.deepEqual(
    database.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => row.version),
    ['001-initial', '002-domain-events-and-notes'],
  );
  assert.equal(
    database.prepare('SELECT actor_type FROM actors WHERE id = ?').get(SYSTEM_ACTOR_ID).actor_type,
    'system',
  );
});

test('the Phase 4 migration upgrades a Phase 3 database forward without modifying 001', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-forward-migration-'));
  const dbPath = path.join(directory, 'memory.db');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const phase3 = new DatabaseSync(dbPath);
  phase3.exec('PRAGMA foreign_keys = ON');
  phase3.exec(fs.readFileSync(path.join(process.cwd(), 'src/db/migrations/001-initial.sql'), 'utf8'));
  phase3.exec(`
    CREATE TABLE schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL CHECK(length(applied_at) = 24 AND applied_at GLOB '????-??-??T??:??:??.???Z')
    ) STRICT;
  `);
  phase3.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)')
    .run('001-initial', new Date().toISOString());
  phase3.close();

  const upgraded = initializeDatabase({ dbPath });
  t.after(() => upgraded.close());
  assert.deepEqual(
    upgraded.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => row.version),
    ['001-initial', '002-domain-events-and-notes'],
  );
  assert.equal(upgraded.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_notes'").get().name, 'memory_notes');
  assert.equal(upgraded.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memory_events'").get().sql.includes("'note_added'"), true);
});

test('project creation returns a durable project', (t) => {
  const { store } = createTestStore(t);
  const project = store.createProject({ name: 'COMP-2DPASS', slug: 'comp-2dpass' });
  assert.equal(project.name, 'COMP-2DPASS');
  assert.equal(project.status, 'active');
  assert.equal(store.getProject(project.id).slug, 'comp-2dpass');
});

test('memory creation atomically creates revision 1 and makes it current', (t) => {
  const { store } = createTestStore(t);
  const { user, project } = createUserAndProject(store);
  const memory = store.createMemory({
    projectId: project.id,
    actorId: user.id,
    revision: entityRevision('Stage1'),
  });

  assert.equal(memory.lifecycleStatus, 'active');
  assert.equal(memory.verificationStatus, 'user_confirmed');
  assert.equal(memory.currentRevision.revisionNumber, 1);
  assert.equal(memory.currentRevision.name, 'Stage1');
});

test('revision semantic rows cannot be updated or deleted', (t) => {
  const { store } = createTestStore(t);
  const { user, project } = createUserAndProject(store);
  const memory = store.createMemory({ projectId: project.id, actorId: user.id, revision: entityRevision('Stage1') });

  assert.throws(
    () => store.database.prepare('UPDATE memory_revisions SET name = ? WHERE id = ?').run('Overwritten', memory.currentRevisionId),
    /immutable/,
  );
  assert.throws(
    () => store.database.prepare('DELETE FROM memory_revisions WHERE id = ?').run(memory.currentRevisionId),
    /cannot be deleted/,
  );
});

test('creating revision 2 switches current revision and preserves revision 1', (t) => {
  const { store } = createTestStore(t);
  const { user, project } = createUserAndProject(store);
  const memory = store.createMemory({ projectId: project.id, actorId: user.id, revision: entityRevision('Stage1') });
  const firstRevisionId = memory.currentRevisionId;
  const second = store.createRevision(memory.id, {
    actorId: user.id,
    ...entityRevision('Stage1 revised'),
    changeReason: 'Clarify the baseline name',
  });

  assert.equal(second.revisionNumber, 2);
  assert.equal(store.getMemory(memory.id).currentRevisionId, second.id);
  assert.deepEqual(
    store.getRevisionHistory(memory.id).map((revision) => revision.id),
    [firstRevisionId, second.id],
  );
});

test('database rejects a current revision owned by another memory', (t) => {
  const { store } = createTestStore(t);
  const { user, project } = createUserAndProject(store);
  const first = store.createMemory({ projectId: project.id, actorId: user.id, revision: entityRevision('Stage1') });
  const second = store.createMemory({ projectId: project.id, actorId: user.id, revision: entityRevision('Stage2A') });

  assert.throws(
    () => store.database.prepare('UPDATE memories SET current_revision_id = ? WHERE id = ?').run(second.currentRevisionId, first.id),
    /FOREIGN KEY constraint failed|current revision/,
  );
});

test('lock and pin operations persist state and append events', (t) => {
  const { store } = createTestStore(t);
  const { user, project } = createUserAndProject(store);
  const memory = store.createMemory({ projectId: project.id, actorId: user.id, revision: entityRevision('Fusion classifier', 'module') });

  store.lockMemory(memory.id, { actorId: user.id, reason: 'Protect classifier' });
  store.pinMemory(memory.id, { actorId: user.id });
  let current = store.getMemory(memory.id);
  assert.equal(current.isLocked, true);
  assert.equal(current.isPinned, true);

  store.unlockMemory(memory.id, { actorId: user.id });
  store.unpinMemory(memory.id, { actorId: user.id });
  current = store.getMemory(memory.id);
  assert.equal(current.isLocked, false);
  assert.equal(current.isPinned, false);
  assert.deepEqual(
    store.listMemoryEvents(memory.id).map((event) => event.eventType),
    ['created', 'revision_created', 'confirmed', 'locked', 'pinned', 'unlocked', 'unpinned'],
  );
});

test('soft-deleted memories are hidden by default and available for audit', (t) => {
  const { store } = createTestStore(t);
  const { user, project } = createUserAndProject(store);
  const memory = store.createMemory({ projectId: project.id, actorId: user.id, revision: entityRevision('Stage1') });

  store.softDeleteMemory(memory.id, { actorId: user.id });
  assert.equal(store.getMemory(memory.id), null);
  assert.equal(store.listMemories({ projectId: project.id }).length, 0);
  assert.equal(store.getMemory(memory.id, { includeDeleted: true }).lifecycleStatus, 'deleted');

  store.restoreMemory(memory.id, { actorId: user.id, lifecycleStatus: 'active' });
  assert.equal(store.getMemory(memory.id).lifecycleStatus, 'active');
});

test('provenance supports many sources per revision and one source across revisions', (t) => {
  const { store } = createTestStore(t);
  const { user, project } = createUserAndProject(store);
  const stage1 = store.createMemory({ projectId: project.id, actorId: user.id, revision: entityRevision('Stage1') });
  const dataset = store.createMemory({ projectId: project.id, actorId: user.id, revision: entityRevision('SemanticKITTI', 'dataset') });
  const conversation = store.createSource({
    projectId: project.id,
    sourceType: 'codex_conversation',
    originalText: 'Stage1 uses SemanticKITTI.',
  });
  const log = store.createSource({
    projectId: project.id,
    sourceType: 'experiment_log',
    filePath: 'runs/stage1/metrics.json',
    originalText: '65.433',
  });

  store.attachSourceToRevision(stage1.currentRevisionId, { sourceId: conversation.id, evidenceRole: 'primary' });
  store.attachSourceToRevision(stage1.currentRevisionId, { sourceId: log.id, evidenceRole: 'supporting' });
  store.attachSourceToRevision(dataset.currentRevisionId, { sourceId: conversation.id, evidenceRole: 'supporting' });

  assert.deepEqual(
    store.listSourcesForRevision(stage1.currentRevisionId).map((source) => source.id).sort(),
    [conversation.id, log.id].sort(),
  );
  assert.deepEqual(
    store.listSourcesForRevision(dataset.currentRevisionId).map((source) => source.id),
    [conversation.id],
  );
});

test('relations are sourced, directed, and cannot point to themselves', (t) => {
  const { store } = createTestStore(t);
  const { user, project } = createUserAndProject(store);
  const stage1 = store.createMemory({ projectId: project.id, actorId: user.id, revision: entityRevision('Stage1') });
  const dataset = store.createMemory({ projectId: project.id, actorId: user.id, revision: entityRevision('SemanticKITTI', 'dataset') });
  const source = store.createSource({ projectId: project.id, sourceType: 'manual_input', originalText: 'Stage1 evaluated on SemanticKITTI.' });
  const relation = store.createRelation({
    projectId: project.id,
    sourceMemoryId: stage1.id,
    targetMemoryId: dataset.id,
    relationType: 'evaluated_on',
    confidence: 1,
    actorId: user.id,
    sourceIds: [source.id],
  });

  assert.equal(store.listRelations({ projectId: project.id, sourceMemoryId: stage1.id })[0].id, relation.id);
  assert.throws(() => store.createRelation({
    projectId: project.id,
    sourceMemoryId: stage1.id,
    targetMemoryId: stage1.id,
    relationType: 'related_to',
    confidence: 1,
    actorId: user.id,
  }), /self|different/);

  store.softDeleteRelation(relation.id, { actorId: user.id, reason: 'Replace relation' });
  assert.equal(store.listRelations({ projectId: project.id }).length, 0);
  assert.equal(store.listRelations({ projectId: project.id, includeDeleted: true })[0].status, 'deleted');
});

test('metric observations preserve different values under the same scope', (t) => {
  const { store } = createTestStore(t);
  const { user, project } = createUserAndProject(store);
  const stage1 = store.createMemory({ projectId: project.id, actorId: user.id, revision: entityRevision('Stage1') });
  const dataset = store.createMemory({ projectId: project.id, actorId: user.id, revision: entityRevision('SemanticKITTI', 'dataset') });
  const firstFact = store.createMemory({ projectId: project.id, actorId: user.id, revision: metricRevision('Stage1 Clean mIoU 65.433', '65.433') });
  const secondFact = store.createMemory({ projectId: project.id, actorId: user.id, revision: metricRevision('Stage1 Clean mIoU 65.564', '65.564') });
  const scopeKey = 'stage1|clean-miou|semantickitti|validation|clean|epoch57|stage1-baseline';

  store.createMetricObservation({
    revisionId: firstFact.currentRevisionId,
    subjectMemoryId: stage1.id,
    metricName: 'Clean mIoU',
    valueNumber: 65.433,
    valueRaw: '65.433',
    datasetMemoryId: dataset.id,
    split: 'validation',
    protocol: 'clean',
    checkpoint: 'epoch57',
    runLabel: 'stage1-baseline',
    scopeKey,
  });
  store.createMetricObservation({
    revisionId: secondFact.currentRevisionId,
    subjectMemoryId: stage1.id,
    metricName: 'Clean mIoU',
    valueNumber: 65.564,
    valueRaw: '65.564',
    datasetMemoryId: dataset.id,
    split: 'validation',
    protocol: 'clean',
    checkpoint: 'epoch57',
    runLabel: 'stage1-baseline',
    scopeKey,
  });

  assert.deepEqual(
    store.listMetricObservations({ subjectMemoryId: stage1.id, metricName: 'Clean mIoU', datasetMemoryId: dataset.id, scopeKey })
      .map((observation) => observation.valueNumber).sort((a, b) => a - b),
    [65.433, 65.564],
  );
});

test('conflicts reference exact revisions and resolve transactionally', (t) => {
  const { store } = createTestStore(t);
  const { user, project } = createUserAndProject(store);
  const codex = store.createActor({ actorType: 'codex', displayName: 'Codex extraction' });
  const existing = store.createMemory({ projectId: project.id, actorId: user.id, revision: metricRevision('Stage1 Clean mIoU 65.433', '65.433') });
  const incoming = store.createMemory({ projectId: project.id, actorId: codex.id, revision: metricRevision('Stage1 Clean mIoU 65.564', '65.564') });
  const conflict = store.createConflict({
    projectId: project.id,
    existingMemoryId: existing.id,
    existingRevisionId: existing.currentRevisionId,
    incomingMemoryId: incoming.id,
    incomingRevisionId: incoming.currentRevisionId,
    conflictType: 'value_conflict',
    confidence: 1,
    rationale: 'The same metric scope has different values.',
    detectedByActorId: codex.id,
  });

  assert.equal(store.getConflict(conflict.id).existingRevisionId, existing.currentRevisionId);
  const resolved = store.resolveConflict(conflict.id, {
    actorId: user.id,
    resolution: 'keep_existing',
    note: 'The incoming log was stale.',
  });
  assert.equal(resolved.status, 'resolved');
  assert.equal(store.listConflicts({ projectId: project.id, status: 'resolved' }).length, 1);
});

test('context snapshot freezes an old revision after the memory advances', (t) => {
  const { store } = createTestStore(t);
  const { user, project } = createUserAndProject(store);
  const memory = store.createMemory({ projectId: project.id, actorId: user.id, revision: metricRevision('Stage1 Clean mIoU', '65.433') });
  const oldRevisionId = memory.currentRevisionId;
  const session = store.createContextSession({
    projectId: project.id,
    promptText: 'Continue Stage2B.',
    actorId: user.id,
  });
  const snapshot = store.createContextSnapshot({
    contextSessionId: session.id,
    snapshotKind: 'used',
    formatVersion: '1',
    renderedContext: 'Stage1 Clean mIoU = 65.433',
    structuredContext: { memories: [{ id: memory.id, revisionId: oldRevisionId, value: 65.433 }] },
    contentHash: 'snapshot-65.433',
    actorId: user.id,
    selections: [{
      memoryId: memory.id,
      memoryRevisionId: oldRevisionId,
      selectionState: 'included',
      selectedByActorId: user.id,
      rank: 1,
      relevanceScore: 1,
      snapshotPayload: { name: 'Stage1 Clean mIoU', value: 65.433 },
      reasons: [{ reasonType: 'user_selected' }],
    }],
  });

  store.createRevision(memory.id, {
    actorId: user.id,
    ...metricRevision('Stage1 Clean mIoU', '65.564'),
    changeReason: 'Accepted corrected result',
  });
  const historical = store.getContextSnapshot(snapshot.id);
  assert.equal(historical.renderedContext, 'Stage1 Clean mIoU = 65.433');
  assert.equal(historical.selections[0].memoryRevisionId, oldRevisionId);
  assert.equal(historical.selections[0].snapshotPayload.value, 65.433);
  assert.throws(
    () => store.database.prepare('UPDATE context_snapshots SET rendered_context = ? WHERE id = ?').run('changed', snapshot.id),
    /immutable/,
  );
});

test('failed context snapshot creation rolls back snapshot, selections, and reasons', (t) => {
  const { store } = createTestStore(t);
  const { user, project } = createUserAndProject(store);
  const first = store.createMemory({ projectId: project.id, actorId: user.id, revision: entityRevision('Stage1') });
  const second = store.createMemory({ projectId: project.id, actorId: user.id, revision: entityRevision('Stage2A') });
  const session = store.createContextSession({ projectId: project.id, promptText: 'Continue Stage2B.', actorId: user.id });

  assert.throws(() => store.createContextSnapshot({
    contextSessionId: session.id,
    snapshotKind: 'preview',
    formatVersion: '1',
    renderedContext: 'invalid aggregate',
    structuredContext: {},
    contentHash: 'will-rollback',
    actorId: user.id,
    selections: [
      {
        memoryId: first.id,
        memoryRevisionId: first.currentRevisionId,
        selectionState: 'included',
        selectedByActorId: user.id,
        snapshotPayload: { name: 'Stage1' },
        reasons: [{ reasonType: 'user_selected' }],
      },
      {
        memoryId: first.id,
        memoryRevisionId: second.currentRevisionId,
        selectionState: 'included',
        selectedByActorId: user.id,
        snapshotPayload: { name: 'mismatched revision' },
        reasons: [],
      },
    ],
  }), /FOREIGN KEY|revision|UNIQUE/);
  assert.equal(store.listContextSnapshots(session.id).length, 0);
});

test('FTS searches only the current revision and follows revision changes', (t) => {
  const { store } = createTestStore(t);
  const { user, project } = createUserAndProject(store);
  const memory = store.createMemory({ projectId: project.id, actorId: user.id, revision: entityRevision('Stage1 OldBaseline') });
  assert.equal(store.searchCurrentMemories({ projectId: project.id, query: 'OldBaseline' })[0].id, memory.id);

  store.createRevision(memory.id, { actorId: user.id, ...entityRevision('Stage1 NewBaseline') });
  assert.equal(store.searchCurrentMemories({ projectId: project.id, query: 'OldBaseline' }).length, 0);
  assert.equal(store.searchCurrentMemories({ projectId: project.id, query: 'NewBaseline' })[0].id, memory.id);
});

test('database data remains available after close and reopen', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-reopen-'));
  const dbPath = path.join(directory, 'memory.db');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let store = new VisualContextMemoryStore({ dbPath });
  const { user, project } = createUserAndProject(store);
  const memory = store.createMemory({ projectId: project.id, actorId: user.id, revision: entityRevision('Persistent Stage1') });
  store.close();

  store = new VisualContextMemoryStore({ dbPath });
  t.after(() => store.close());
  assert.equal(store.getMemory(memory.id).currentRevision.name, 'Persistent Stage1');
});

test('source records keep unavailable session and message identifiers null', (t) => {
  const { store } = createTestStore(t);
  const { project } = createUserAndProject(store);
  const source = store.createSource({
    projectId: project.id,
    sourceType: 'codex_conversation',
    originalText: 'No stable external identifiers are available.',
  });
  assert.equal(source.sessionId, null);
  assert.equal(source.messageId, null);
});

test('store validation rejects invalid enums, confidence, booleans, and timestamps', (t) => {
  const { store } = createTestStore(t);
  const { user, project } = createUserAndProject(store);
  assert.throws(() => store.createMemory({
    projectId: project.id,
    actorId: user.id,
    importance: 'urgent',
    revision: entityRevision('Invalid'),
  }), /importance/);
  assert.throws(() => store.createMemory({
    projectId: project.id,
    actorId: user.id,
    isLocked: 1,
    revision: entityRevision('Invalid'),
  }), /boolean/);
  assert.throws(() => store.createMemory({
    projectId: project.id,
    actorId: user.id,
    revision: { ...entityRevision('Invalid'), confidence: 2 },
  }), /confidence/);
  assert.throws(() => store.createSource({
    projectId: project.id,
    sourceType: 'manual_input',
    occurredAt: '2026-08-30 12:00:00',
  }), /UTC ISO/);
});

test('database enforces sequential revision numbers per memory', (t) => {
  const { store } = createTestStore(t);
  const { user, project } = createUserAndProject(store);
  const memory = store.createMemory({ projectId: project.id, actorId: user.id, revision: entityRevision('Stage1') });
  const badRevisionId = crypto.randomUUID();
  assert.throws(() => store.database.prepare(`
    INSERT INTO memory_revisions(
      id, memory_id, revision_number, name, type, subtype, context_role, summary, description,
      confidence, value_kind, value_text, value_number, value_boolean, value_json, unit,
      change_kind, change_reason, created_by_actor_id, created_at
    ) VALUES (?, ?, 3, 'Skipped revision', 'entity', 'experiment', 'current_state',
      'This revision skips number 2.', NULL, 1, 'none', NULL, NULL, NULL, NULL, NULL,
      'edit', NULL, ?, ?)
  `).run(badRevisionId, memory.id, user.id, new Date().toISOString()), /next value/);
});

test('locked active memory rejects automatic revision and keeps its current revision', (t) => {
  const { store } = createTestStore(t);
  const { user, project } = createUserAndProject(store);
  const codex = store.createActor({ actorType: 'codex', displayName: 'Codex extraction' });
  const memory = store.createMemory({ projectId: project.id, actorId: user.id, revision: entityRevision('Protected Stage1') });
  store.lockMemory(memory.id, { actorId: user.id, reason: 'Protect baseline' });
  assert.throws(() => store.createRevision(memory.id, {
    actorId: codex.id,
    ...entityRevision('Automatic overwrite'),
  }), /Locked memory/);
  assert.equal(store.getMemory(memory.id).currentRevision.name, 'Protected Stage1');
});

test('FTS includes metric value_raw for the current metric revision', (t) => {
  const { store } = createTestStore(t);
  const { user, project } = createUserAndProject(store);
  const stage1 = store.createMemory({ projectId: project.id, actorId: user.id, revision: entityRevision('Stage1') });
  const fact = store.createMemory({ projectId: project.id, actorId: user.id, revision: metricRevision('Stage1 metric', '65.433') });
  store.createMetricObservation({
    revisionId: fact.currentRevisionId,
    subjectMemoryId: stage1.id,
    metricName: 'Clean mIoU',
    valueNumber: 65.433,
    valueRaw: '65.433',
    scopeKey: 'stage1|clean-miou',
  });
  assert.equal(store.searchCurrentMemories({ projectId: project.id, query: '65.433' })[0].id, fact.id);
});

test('FTS removes a soft-deleted memory and restores its current revision', (t) => {
  const { store } = createTestStore(t);
  const { user, project } = createUserAndProject(store);
  const memory = store.createMemory({ projectId: project.id, actorId: user.id, revision: entityRevision('SearchableConstraint') });
  assert.equal(store.searchCurrentMemories({ projectId: project.id, query: 'SearchableConstraint' }).length, 1);
  store.softDeleteMemory(memory.id, { actorId: user.id });
  assert.equal(store.searchCurrentMemories({ projectId: project.id, query: 'SearchableConstraint' }).length, 0);
  store.restoreMemory(memory.id, { actorId: user.id, lifecycleStatus: 'active' });
  assert.equal(store.searchCurrentMemories({ projectId: project.id, query: 'SearchableConstraint' }).length, 1);
});

test('sealed context aggregate rejects later selections', (t) => {
  const { store } = createTestStore(t);
  const { user, project } = createUserAndProject(store);
  const memory = store.createMemory({ projectId: project.id, actorId: user.id, revision: entityRevision('Stage1') });
  const session = store.createContextSession({ projectId: project.id, promptText: 'Continue.', actorId: user.id });
  const snapshot = store.createContextSnapshot({
    contextSessionId: session.id,
    snapshotKind: 'final',
    formatVersion: '1',
    renderedContext: 'Stage1',
    structuredContext: {},
    contentHash: 'sealed-context',
    actorId: user.id,
    selections: [],
  });
  assert.throws(() => store.database.prepare(`
    INSERT INTO context_selections(
      id, context_snapshot_id, memory_id, memory_revision_id, selection_state,
      selected_by_actor_id, rank, relevance_score, snapshot_payload_json, created_at
    ) VALUES (?, ?, ?, ?, 'included', ?, 1, 1, '{}', ?)
  `).run(crypto.randomUUID(), snapshot.id, memory.id, memory.currentRevisionId, user.id, new Date().toISOString()), /sealed/);
});

test('cross-project relations are rejected at the database boundary', (t) => {
  const { store } = createTestStore(t);
  const user = store.createActor({ actorType: 'user', displayName: 'Test user' });
  const firstProject = store.createProject({ name: 'First', slug: 'first' });
  const secondProject = store.createProject({ name: 'Second', slug: 'second' });
  const first = store.createMemory({ projectId: firstProject.id, actorId: user.id, revision: entityRevision('First memory') });
  const second = store.createMemory({ projectId: secondProject.id, actorId: user.id, revision: entityRevision('Second memory') });
  assert.throws(() => store.createRelation({
    projectId: firstProject.id,
    sourceMemoryId: first.id,
    targetMemoryId: second.id,
    relationType: 'depends_on',
    confidence: 1,
    actorId: user.id,
  }), /project mismatch/);
});

test('schema exposes expected tables, indexes, triggers, and healthy PRAGMAs', (t) => {
  const { store } = createTestStore(t);
  const objects = store.database.prepare(`
    SELECT type, name FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE 'current_memory_fts_%'
  `).all();
  const names = new Set(objects.map((object) => object.name));
  for (const name of [
    'projects', 'actors', 'memories', 'memory_revisions', 'memory_events', 'source_records',
    'revision_sources', 'relations', 'relation_sources', 'metric_observations', 'conflicts',
    'context_sessions', 'context_snapshots', 'context_selections', 'context_selection_reasons',
    'schema_migrations', 'current_memory_fts', 'memory_notes', 'idx_metric_scope', 'memory_revisions_immutable_update',
  ]) {
    assert.equal(names.has(name), true, `missing schema object ${name}`);
  }
  assert.equal(store.database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(store.database.prepare('PRAGMA foreign_key_check').all(), []);
});
