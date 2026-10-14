import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { VisualContextMemoryStore } from '../../src/db/store.mjs';
import { MemoryService } from '../../src/services/memory-service.mjs';
import { ConflictService } from '../../src/services/conflict-service.mjs';

function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-domain-'));
  const dbPath = path.join(directory, 'memory.db');
  const store = new VisualContextMemoryStore({ dbPath });
  const user = store.createActor({ actorType: 'user', displayName: 'Local user' });
  const codex = store.createActor({ actorType: 'codex', displayName: 'Codex extraction' });
  const importer = store.createActor({ actorType: 'importer', displayName: 'Import tool' });
  const project = store.createProject({ name: 'COMP-2DPASS', slug: `comp-${path.basename(directory)}` });
  const memories = new MemoryService(store);
  const conflicts = new ConflictService(store, memories);
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { store, user, codex, importer, project, memories, conflicts, dbPath };
}

function revision(name, overrides = {}) {
  return {
    name,
    type: 'entity',
    subtype: 'experiment',
    contextRole: 'current_state',
    summary: `${name} is relevant to the project.`,
    confidence: 1,
    ...overrides,
  };
}

function active(ctx, name, overrides = {}) {
  return ctx.store.createMemory({ projectId: ctx.project.id, actorId: ctx.user.id, revision: revision(name, overrides) });
}

function candidate(ctx, name, overrides = {}) {
  return ctx.memories.createCandidate(ctx.project.id, ctx.codex.id, revision(name, overrides)).affectedMemories[0];
}

function conflict(ctx, existing, incoming, type = 'value_conflict') {
  return ctx.store.createConflict({
    projectId: ctx.project.id,
    existingMemoryId: existing.id,
    existingRevisionId: existing.currentRevisionId,
    incomingMemoryId: incoming.id,
    incomingRevisionId: incoming.currentRevisionId,
    conflictType: type,
    confidence: 1,
    rationale: 'The two records cover the same scope with incompatible content.',
    detectedByActorId: ctx.codex.id,
  });
}

function assertCode(operation, code) {
  assert.throws(operation, (error) => error?.code === code);
}

test('confirms an unreviewed candidate and makes repeated confirm idempotent', (t) => {
  const ctx = setup(t);
  const incoming = candidate(ctx, 'Extracted baseline');
  const first = ctx.memories.confirmMemory(incoming.id, ctx.user.id);
  const second = ctx.memories.confirmMemory(incoming.id, ctx.user.id);
  assert.equal(first.affectedMemories[0].lifecycleStatus, 'active');
  assert.equal(first.affectedMemories[0].verificationStatus, 'user_confirmed');
  assert.deepEqual(second.warnings, ['already_confirmed']);
  assert.equal(ctx.store.listMemoryEvents(incoming.id).filter((event) => event.eventType === 'confirmed').length, 1);
});

test('marks an active memory outdated without changing its revision or sources', (t) => {
  const ctx = setup(t);
  const memory = active(ctx, 'Old experiment');
  const source = ctx.store.createSource({ projectId: ctx.project.id, sourceType: 'manual_input', originalText: 'Old experiment completed.' });
  ctx.store.attachSourceToRevision(memory.currentRevisionId, { sourceId: source.id });
  ctx.memories.markMemoryOutdated(memory.id, ctx.user.id, { reason: 'Replaced configuration' });
  assert.equal(ctx.store.getMemory(memory.id).lifecycleStatus, 'outdated');
  assert.equal(ctx.store.getRevisionHistory(memory.id).length, 1);
  assert.equal(ctx.store.listSourcesForRevision(memory.currentRevisionId)[0].id, source.id);
  assert.equal(ctx.store.listMemoryEvents(memory.id).at(-1).eventType, 'marked_outdated');
});

test('rejects a candidate, excludes it from FTS, and reopens it as unreviewed candidate', (t) => {
  const ctx = setup(t);
  const incoming = candidate(ctx, 'Wrong extraction distincttoken');
  ctx.memories.rejectMemory(incoming.id, ctx.user.id, { reason: 'Not project knowledge' });
  assert.equal(ctx.store.getMemory(incoming.id).lifecycleStatus, 'rejected');
  assert.equal(ctx.store.searchCurrentMemories({ projectId: ctx.project.id, query: 'distincttoken' }).length, 0);
  ctx.memories.restoreMemory(incoming.id, ctx.user.id, { reason: 'More evidence arrived' });
  assert.equal(ctx.store.getMemory(incoming.id).lifecycleStatus, 'candidate');
  assert.equal(ctx.store.getMemory(incoming.id).verificationStatus, 'unreviewed');
});

test('user edit creates a new immutable revision and preserves Memory controls', (t) => {
  const ctx = setup(t);
  const memory = active(ctx, 'Stage1', { valueKind: 'number', value: 65.433 });
  ctx.memories.lockMemory(memory.id, ctx.user.id, 'Protect baseline');
  ctx.memories.pinMemory(memory.id, ctx.user.id);
  const oldRevisionId = memory.currentRevisionId;
  const result = ctx.memories.editMemory(memory.id, ctx.user.id, { name: 'Stage1 corrected', value: 65.564, changeReason: 'User correction' });
  const current = ctx.store.getMemory(memory.id);
  assert.equal(result.createdRevision.revisionNumber, 2);
  assert.notEqual(current.currentRevisionId, oldRevisionId);
  assert.equal(current.currentRevision.valueNumber, 65.564);
  assert.equal(current.isLocked, true);
  assert.equal(current.isPinned, true);
  assert.deepEqual(ctx.store.getRevisionHistory(memory.id).map((item) => item.id), [oldRevisionId, current.currentRevisionId]);
});

test('editing a previously valueless revision requires an explicit value kind', (t) => {
  const ctx = setup(t);
  const memory = active(ctx, 'Valueless memory');
  assertCode(() => ctx.memories.editMemory(memory.id, ctx.user.id, { value: 1 }), 'VALUE_KIND_REQUIRED');
});

test('a user can edit a locked memory while Codex cannot', (t) => {
  const ctx = setup(t);
  const memory = active(ctx, 'Protected memory');
  ctx.memories.lockMemory(memory.id, ctx.user.id, 'Baseline');
  ctx.memories.editMemory(memory.id, ctx.user.id, { summary: 'User-authored update.' });
  assertCode(() => ctx.memories.editMemory(memory.id, ctx.codex.id, { summary: 'Automatic overwrite.' }), 'MEMORY_LOCKED');
  assert.equal(ctx.store.getMemory(memory.id).isLocked, true);
});

test('only a user can lock and unlock a memory', (t) => {
  const ctx = setup(t);
  const memory = active(ctx, 'Lockable memory');
  assertCode(() => ctx.memories.lockMemory(memory.id, ctx.codex.id), 'USER_ACTION_REQUIRED');
  ctx.memories.lockMemory(memory.id, ctx.user.id, 'Manual protection');
  assert.equal(ctx.store.getMemory(memory.id).isLocked, true);
  assertCode(() => ctx.memories.unlockMemory(memory.id, ctx.codex.id), 'USER_ACTION_REQUIRED');
  ctx.memories.unlockMemory(memory.id, ctx.user.id);
  assert.equal(ctx.store.getMemory(memory.id).isLocked, false);
});

test('importer proposals remain unreviewed candidates', (t) => {
  const ctx = setup(t);
  const result = ctx.memories.createCandidate(ctx.project.id, ctx.importer.id, revision('Imported candidate'));
  assert.equal(result.affectedMemories[0].lifecycleStatus, 'candidate');
  assert.equal(result.affectedMemories[0].verificationStatus, 'unreviewed');
});

test('only a user can pin and unpin a memory', (t) => {
  const ctx = setup(t);
  const memory = active(ctx, 'Pinnable memory');
  assertCode(() => ctx.memories.pinMemory(memory.id, ctx.codex.id), 'USER_ACTION_REQUIRED');
  ctx.memories.pinMemory(memory.id, ctx.user.id);
  assert.equal(ctx.store.getMemory(memory.id).isPinned, true);
  ctx.memories.unpinMemory(memory.id, ctx.user.id);
  assert.equal(ctx.store.getMemory(memory.id).isPinned, false);
});

test('changes importance as control state without creating a revision', (t) => {
  const ctx = setup(t);
  const memory = active(ctx, 'Important constraint');
  ctx.memories.changeImportance(memory.id, ctx.user.id, 'critical', { reason: 'Safety boundary' });
  assert.equal(ctx.store.getMemory(memory.id).importance, 'critical');
  assert.equal(ctx.store.getRevisionHistory(memory.id).length, 1);
  assert.equal(ctx.store.listMemoryEvents(memory.id).at(-1).eventType, 'importance_changed');
});

test('notes are independently auditable and soft-deletable', (t) => {
  const ctx = setup(t);
  const memory = active(ctx, 'Epoch result');
  const added = ctx.memories.addNote(memory.id, ctx.user.id, 'Use epoch57 in the paper, not epoch58.');
  assert.equal(ctx.memories.listNotes(memory.id).length, 1);
  const deleted = ctx.memories.deleteNote(added.note.id, ctx.user.id, 'Obsolete note');
  assert.notEqual(deleted.note.deletedAt, null);
  assert.equal(ctx.memories.listNotes(memory.id).length, 0);
  assert.equal(ctx.memories.listNotes(memory.id, { includeDeleted: true }).length, 1);
  assert.deepEqual(ctx.store.listMemoryEvents(memory.id).slice(-2).map((event) => event.eventType), ['note_added', 'note_deleted']);
});

test('supersede makes the successor active and retains the superseded locked history', (t) => {
  const ctx = setup(t);
  const oldMemory = active(ctx, 'Baseline 65.433');
  const newMemory = candidate(ctx, 'Baseline 65.564');
  ctx.memories.lockMemory(oldMemory.id, ctx.user.id, 'Historic baseline');
  const result = ctx.memories.supersedeMemory(oldMemory.id, newMemory.id, ctx.user.id, 'Accepted corrected result');
  assert.equal(ctx.store.getMemory(oldMemory.id).lifecycleStatus, 'superseded');
  assert.equal(ctx.store.getMemory(oldMemory.id).isLocked, true);
  assert.equal(ctx.store.getMemory(newMemory.id).lifecycleStatus, 'active');
  assert.equal(result.createdRelations[0].relationType, 'supersedes');
  assert.equal(ctx.store.getRevisionHistory(oldMemory.id).length, 1);
});

test('Codex cannot supersede a locked memory while a user explicitly can', (t) => {
  const ctx = setup(t);
  const oldMemory = active(ctx, 'Protected old');
  const newMemory = candidate(ctx, 'Incoming replacement');
  ctx.memories.lockMemory(oldMemory.id, ctx.user.id, 'Protect it');
  assertCode(() => ctx.memories.supersedeMemory(oldMemory.id, newMemory.id, ctx.codex.id, 'Automatic'), 'MEMORY_LOCKED');
  ctx.memories.supersedeMemory(oldMemory.id, newMemory.id, ctx.user.id, 'Explicit choice');
  assert.equal(ctx.store.getMemory(oldMemory.id).lifecycleStatus, 'superseded');
});

test('merges duplicates with sources preserved and no self relations', (t) => {
  const ctx = setup(t);
  const primary = active(ctx, 'Prototype Retrieval');
  const secondary = active(ctx, 'Prototype-retrieval');
  const target = active(ctx, 'Stage2B');
  const firstSource = ctx.store.createSource({ projectId: ctx.project.id, sourceType: 'manual_input', originalText: 'Primary source' });
  const secondSource = ctx.store.createSource({ projectId: ctx.project.id, sourceType: 'manual_input', originalText: 'Secondary source' });
  ctx.store.attachSourceToRevision(primary.currentRevisionId, { sourceId: firstSource.id });
  ctx.store.attachSourceToRevision(secondary.currentRevisionId, { sourceId: secondSource.id });
  ctx.store.createRelation({ projectId: ctx.project.id, sourceMemoryId: secondary.id, targetMemoryId: target.id, relationType: 'uses', confidence: 1, actorId: ctx.user.id });
  ctx.store.createRelation({ projectId: ctx.project.id, sourceMemoryId: secondary.id, targetMemoryId: primary.id, relationType: 'related_to', confidence: 1, actorId: ctx.user.id });
  const result = ctx.memories.mergeMemories(primary.id, secondary.id, ctx.user.id, { contentStrategy: 'secondary', reason: 'Same method spelling' });
  const currentPrimary = ctx.store.getMemory(primary.id);
  assert.equal(currentPrimary.currentRevision.name, 'Prototype-retrieval');
  assert.equal(ctx.store.getMemory(secondary.id).lifecycleStatus, 'superseded');
  assert.deepEqual(ctx.store.listSourcesForRevision(currentPrimary.currentRevisionId).map((item) => item.id).sort(), [firstSource.id, secondSource.id].sort());
  assert.equal(ctx.store.listRelations({ projectId: ctx.project.id }).some((relation) => relation.sourceMemoryId === relation.targetMemoryId), false);
  assert.ok(result.createdRelations.some((relation) => relation.sourceMemoryId === primary.id && relation.targetMemoryId === target.id));
  assert.equal(ctx.store.listMemoryEvents(primary.id).some((event) => event.eventType === 'merged'), true);
});

test('merge rejects self-merge before writing', (t) => {
  const ctx = setup(t);
  const memory = active(ctx, 'Only memory');
  assertCode(() => ctx.memories.mergeMemories(memory.id, memory.id, ctx.user.id), 'MERGE_SELF');
  assert.equal(ctx.store.getRevisionHistory(memory.id).length, 1);
});

test('keep_existing resolves a conflict and rejects incoming by default', (t) => {
  const ctx = setup(t);
  const existing = active(ctx, 'Existing');
  const incoming = candidate(ctx, 'Incoming');
  const item = conflict(ctx, existing, incoming);
  ctx.conflicts.resolveMemoryConflict(item.id, 'keep_existing', ctx.user.id, { note: 'Existing evidence is authoritative' });
  assert.equal(ctx.store.getConflict(item.id).status, 'resolved');
  assert.equal(ctx.store.getMemory(existing.id).lifecycleStatus, 'active');
  assert.equal(ctx.store.getMemory(incoming.id).lifecycleStatus, 'rejected');
});

test('use_incoming resolves a conflict by superseding existing', (t) => {
  const ctx = setup(t);
  const existing = active(ctx, 'Existing value');
  const incoming = candidate(ctx, 'Incoming value');
  const item = conflict(ctx, existing, incoming);
  ctx.conflicts.resolveMemoryConflict(item.id, 'use_incoming', ctx.user.id, { reason: 'New log accepted' });
  assert.equal(ctx.store.getConflict(item.id).resolution, 'use_incoming');
  assert.equal(ctx.store.getMemory(existing.id).lifecycleStatus, 'superseded');
  assert.equal(ctx.store.getMemory(incoming.id).lifecycleStatus, 'active');
});

test('keep_both confirms the incoming candidate without a supersedes relation', (t) => {
  const ctx = setup(t);
  const existing = active(ctx, 'Run A');
  const incoming = candidate(ctx, 'Run B');
  const item = conflict(ctx, existing, incoming);
  ctx.conflicts.resolveMemoryConflict(item.id, 'keep_both', ctx.user.id, { note: 'Different runs' });
  assert.equal(ctx.store.getMemory(existing.id).lifecycleStatus, 'active');
  assert.equal(ctx.store.getMemory(incoming.id).lifecycleStatus, 'active');
  assert.equal(ctx.store.listRelations({ projectId: ctx.project.id }).some((relation) => relation.relationType === 'supersedes'), false);
});

test('mark_existing_outdated resolves a conflict with distinct outdated semantics', (t) => {
  const ctx = setup(t);
  const existing = active(ctx, 'Old configuration');
  const incoming = candidate(ctx, 'Current configuration');
  const item = conflict(ctx, existing, incoming, 'supersession_candidate');
  ctx.conflicts.resolveMemoryConflict(item.id, 'mark_existing_outdated', ctx.user.id);
  assert.equal(ctx.store.getMemory(existing.id).lifecycleStatus, 'outdated');
  assert.equal(ctx.store.getMemory(incoming.id).lifecycleStatus, 'active');
});

test('reject_incoming resolves a conflict without changing existing', (t) => {
  const ctx = setup(t);
  const existing = active(ctx, 'Established fact');
  const incoming = candidate(ctx, 'Bad fact');
  const item = conflict(ctx, existing, incoming);
  ctx.conflicts.resolveMemoryConflict(item.id, 'reject_incoming', ctx.user.id);
  assert.equal(ctx.store.getMemory(existing.id).lifecycleStatus, 'active');
  assert.equal(ctx.store.getMemory(incoming.id).lifecycleStatus, 'rejected');
});

test('merge conflict resolution reuses the unified merge flow', (t) => {
  const ctx = setup(t);
  const existing = active(ctx, 'Duplicate name');
  const incoming = candidate(ctx, 'Duplicate-name');
  const item = conflict(ctx, existing, incoming, 'duplicate');
  const result = ctx.conflicts.resolveMemoryConflict(item.id, 'merge', ctx.user.id, { contentStrategy: 'primary' });
  assert.equal(result.conflict.resolution, 'merge');
  assert.equal(ctx.store.getMemory(incoming.id).lifecycleStatus, 'superseded');
  assert.equal(ctx.store.getRevisionHistory(existing.id).length, 2);
});

test('a conflict cannot be resolved twice', (t) => {
  const ctx = setup(t);
  const item = conflict(ctx, active(ctx, 'First'), candidate(ctx, 'Second'));
  ctx.conflicts.resolveMemoryConflict(item.id, 'reject_incoming', ctx.user.id);
  assertCode(() => ctx.conflicts.resolveMemoryConflict(item.id, 'keep_existing', ctx.user.id), 'CONFLICT_ALREADY_RESOLVED');
});

test('Codex needs explicit user action to resolve a locked conflict', (t) => {
  const ctx = setup(t);
  const existing = active(ctx, 'Locked 65.433');
  const incoming = candidate(ctx, 'Candidate 65.564');
  ctx.memories.lockMemory(existing.id, ctx.user.id, 'Baseline');
  const item = conflict(ctx, existing, incoming);
  assertCode(() => ctx.conflicts.resolveMemoryConflict(item.id, 'use_incoming', ctx.codex.id), 'USER_ACTION_REQUIRED');
  assert.equal(ctx.store.getConflict(item.id).status, 'open');
});

test('invalid lifecycle transitions have a stable domain error code', (t) => {
  const ctx = setup(t);
  const incoming = candidate(ctx, 'Candidate');
  assertCode(() => ctx.memories.markMemoryOutdated(incoming.id, ctx.user.id), 'INVALID_LIFECYCLE_TRANSITION');
});

test('dry-run conflict resolution returns its proposed lifecycle changes without writes', (t) => {
  const ctx = setup(t);
  const existing = active(ctx, 'Dry existing');
  const incoming = candidate(ctx, 'Dry incoming');
  const item = conflict(ctx, existing, incoming);
  const result = ctx.conflicts.resolveMemoryConflict(item.id, 'use_incoming', ctx.codex.id, { dryRun: true });
  assert.equal(result.dryRun, true);
  assert.equal(result.userActionRequired, true);
  assert.equal(ctx.store.getConflict(item.id).status, 'open');
  assert.equal(ctx.store.getMemory(existing.id).lifecycleStatus, 'active');
});

test('failed supersede rolls back every preceding state mutation', (t) => {
  const ctx = setup(t);
  const existing = active(ctx, 'Transactional old');
  const incoming = candidate(ctx, 'Transactional new');
  assert.throws(() => ctx.memories.supersedeMemory(existing.id, incoming.id, ctx.user.id, 'Bad source', { sourceIds: ['00000000-0000-4000-8000-000000000099'] }));
  assert.equal(ctx.store.getMemory(existing.id).lifecycleStatus, 'active');
  assert.equal(ctx.store.getMemory(incoming.id).lifecycleStatus, 'candidate');
  assert.equal(ctx.store.listRelations({ projectId: ctx.project.id }).length, 0);
});

test('failed conflict resolution rolls back both lifecycle changes and final resolution', (t) => {
  const ctx = setup(t);
  const existing = active(ctx, 'Transactional existing');
  const incoming = candidate(ctx, 'Transactional incoming');
  const item = conflict(ctx, existing, incoming);
  assert.throws(() => ctx.conflicts.resolveMemoryConflict(item.id, 'use_incoming', ctx.user.id, {
    sourceIds: ['00000000-0000-4000-8000-000000000099'],
  }));
  assert.equal(ctx.store.getConflict(item.id).status, 'open');
  assert.equal(ctx.store.getMemory(existing.id).lifecycleStatus, 'active');
  assert.equal(ctx.store.getMemory(incoming.id).lifecycleStatus, 'candidate');
});

test('COMP-2DPASS locked baseline requires user choice and preserves both audited histories', (t) => {
  const ctx = setup(t);
  const existing = active(ctx, 'Stage1 Clean mIoU 65.433', { type: 'fact', subtype: 'state', contextRole: 'baseline', summary: 'Stage1 Clean mIoU is 65.433.', valueKind: 'number', value: 65.433 });
  const incoming = candidate(ctx, 'Stage1 Clean mIoU 65.564', { type: 'fact', subtype: 'state', contextRole: 'baseline', summary: 'Stage1 Clean mIoU is 65.564.', valueKind: 'number', value: 65.564 });
  const source = ctx.store.createSource({ projectId: ctx.project.id, sourceType: 'experiment_log', originalText: '65.564' });
  ctx.store.attachSourceToRevision(incoming.currentRevisionId, { sourceId: source.id });
  ctx.memories.lockMemory(existing.id, ctx.user.id, 'Protect published baseline');
  const item = conflict(ctx, existing, incoming);
  assertCode(() => ctx.conflicts.resolveMemoryConflict(item.id, 'use_incoming', ctx.codex.id), 'USER_ACTION_REQUIRED');
  ctx.conflicts.resolveMemoryConflict(item.id, 'use_incoming', ctx.user.id, { reason: 'User accepted newer log' });
  assert.equal(ctx.store.getMemory(existing.id).lifecycleStatus, 'superseded');
  assert.equal(ctx.store.getMemory(existing.id).currentRevision.valueNumber, 65.433);
  assert.equal(ctx.store.getMemory(incoming.id).currentRevision.valueNumber, 65.564);
  assert.equal(ctx.store.getConflict(item.id).status, 'resolved');
  assert.equal(ctx.store.listSourcesForRevision(incoming.currentRevisionId)[0].id, source.id);
});

test('domain mutations and Note audit persist after reopening the database', (t) => {
  const ctx = setup(t);
  const memory = active(ctx, 'Persistent domain result');
  ctx.memories.changeImportance(memory.id, ctx.user.id, 'high');
  ctx.memories.addNote(memory.id, ctx.user.id, 'Persist this note.');
  ctx.store.close();
  const reopened = new VisualContextMemoryStore({ dbPath: ctx.dbPath });
  t.after(() => reopened.close());
  assert.equal(reopened.getMemory(memory.id).importance, 'high');
  assert.equal(reopened.listMemoryNotes(memory.id)[0].content, 'Persist this note.');
});
