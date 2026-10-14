import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { VisualContextMemoryStore } from '../../src/db/store.mjs';
import { createLocalServer } from '../../src/server/server.mjs';

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-editor-'));
  const store = new VisualContextMemoryStore({ dbPath: path.join(directory, 'test.db') });
  const project = store.createProject({ name: 'DEMO editor data', slug: 'demo' });
  const user = store.createActor({ actorType: 'user', displayName: 'Test user' });
  const app = createLocalServer({ store, port: 0 });
  const { url } = await app.start();
  t.after(async () => { await app.stop(); store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const memory = (name, extra = {}) => store.createMemory({ projectId: project.id, actorId: user.id,
    revision: { name, type: 'fact', contextRole: 'reference', summary: 'Demo only', confidence: 1, ...extra } });
  const post = async (route, body = {}, headers = {}) => {
    const response = await fetch(url + route, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  return { store, project, user, app, url, memory, post };
}

test('HTTP edit creates immutable sourced revision and rejects stale form transactionally', async (t) => {
  const c = await fixture(t), m = c.memory('Original');
  const source = c.store.createSource({ projectId: c.project.id, sourceType: 'manual_input', originalText: 'Demo original' });
  c.store.attachSourceToRevision(m.currentRevisionId, { sourceId: source.id });
  const route = `/api/memories/${m.id}/edit`;
  const result = await c.post(route, { changes: { summary: 'New' }, expectedRevisionId: m.currentRevisionId });
  assert.equal(result.status, 200);
  const old = c.store.getRevisionHistory(m.id).find((r) => r.id === m.currentRevisionId);
  assert.equal(old.summary, 'Demo only');
  assert.equal(c.store.listSourcesForRevision(result.body.createdRevision.id)[0].id, source.id);
  const stale = await c.post(route, { changes: { summary: 'Stale' }, expectedRevisionId: m.currentRevisionId });
  assert.equal(stale.status, 409); assert.equal(stale.body.error.code, 'REVISION_MISMATCH');
  assert.equal(c.store.getRevisionHistory(m.id).length, 2);
});

test('Locked Metric edit synchronizes raw/number and retains full scope atomically', async (t) => {
  const c = await fixture(t), subject = c.memory('Subject', { type: 'entity', subtype: 'experiment' });
  const m = c.memory('DEMO metric', { subtype: 'metric_observation' });
  c.store.createMetricObservation({ revisionId: m.currentRevisionId, subjectMemoryId: subject.id,
    metricName: 'accuracy', valueNumber: 65.433, valueRaw: '65.433', scopeKey: 'demo',
    datasetMemoryId: subject.id, split: 'validation', protocol: 'clean', runLabel: 'demo-run', checkpoint: 'epoch57' });
  c.app.services.memoryService.lockMemory(m.id, c.user.id);
  const route = `/api/memories/${m.id}/edit`;
  const result = await c.post(route, { expectedRevisionId: m.currentRevisionId, changes: { summary: 'Corrected demo' }, metricObservation: { valueRaw: '65.564', unit: '%' } });
  assert.equal(result.status, 200);
  const o = c.store.getMetricObservation(result.body.createdRevision.id);
  assert.equal(o.valueNumber, 65.564); assert.equal(o.valueRaw, '65.564');
  assert.equal(o.unit, '%'); assert.equal(c.store.getMetricObservation(m.currentRevisionId).unit, null);
  for (const [key, value] of Object.entries({ datasetMemoryId: subject.id, split: 'validation', protocol: 'clean', runLabel: 'demo-run', checkpoint: 'epoch57' })) assert.equal(o[key], value);
  assert.equal(c.store.getMemory(m.id).isLocked, true);
  const before = c.store.getRevisionHistory(m.id).length;
  const invalid = await c.post(route, { expectedRevisionId: result.body.createdRevision.id, changes: {}, metricObservation: { valueRaw: 'bad' } });
  assert.equal(invalid.status, 422); assert.equal(c.store.getRevisionHistory(m.id).length, before);
  const scope = await c.post(route, { expectedRevisionId: result.body.createdRevision.id, changes: {}, metricObservation: { runLabel: 'different' } });
  assert.equal(scope.body.error.code, 'METRIC_SCOPE_CHANGE');
});

test('control, importance, notes and soft deletion/restoration HTTP operations', async (t) => {
  const c = await fixture(t), m = c.memory('Controls');
  for (const [action, flag, value] of [['lock', 'isLocked', true], ['pin', 'isPinned', true], ['unlock', 'isLocked', false], ['unpin', 'isPinned', false]]) {
    const result = await c.post(`/api/memories/${m.id}/${action}`);
    assert.equal(result.status, 200); assert.equal(result.body.affectedMemories[0][flag], value);
  }
  assert.equal((await c.post(`/api/memories/${m.id}/importance`, { importance: 'high' })).body.affectedMemories[0].importance, 'high');
  const note = await c.post(`/api/memories/${m.id}/notes`, { content: 'Demo note' });
  assert.equal(note.status, 201);
  assert.equal((await c.post(`/api/notes/${note.body.note.id}/delete`)).status, 200);
  assert.equal(c.store.listMemoryNotes(m.id).length, 0);
  assert.equal(c.store.listMemoryNotes(m.id, { includeDeleted: true }).length, 1);
  assert.equal((await c.post(`/api/memories/${m.id}/outdated`)).status, 200);
  assert.equal(c.store.getMemory(m.id).lifecycleStatus, 'outdated');
  assert.equal((await c.post(`/api/memories/${m.id}/delete`)).status, 200);
  assert.equal((await c.post(`/api/memories/${m.id}/restore`)).status, 200);
  assert.equal(c.store.getMemory(m.id).lifecycleStatus, 'candidate');
  assert.equal(c.store.getMemory(m.id).verificationStatus, 'unreviewed');
  assert.equal((await c.post(`/api/memories/${m.id}/confirm`)).status, 200);
  assert.equal(c.store.getMemory(m.id).verificationStatus, 'user_confirmed');
  assert.equal((await c.post(`/api/memories/${m.id}/reject`)).status, 200);
  assert.equal(c.store.getMemory(m.id).lifecycleStatus, 'rejected');
  assert.equal(c.store.getRevisionHistory(m.id).length, 1);
});

test('real merge preview rolls back and outdated preview cannot execute', async (t) => {
  const c = await fixture(t), a = c.memory('A'), b = c.memory('B');
  const body = { projectId: c.project.id, operation: 'merge', memoryId: a.id, targetId: b.id, reason: 'Demo merge' };
  const preview = await c.post('/api/editor/preview', body);
  assert.equal(preview.status, 200);
  assert.ok(preview.body.result.createdRevision);
  assert.equal(c.store.getRevisionHistory(a.id).length, 1);
  assert.equal(c.store.getMemory(b.id).lifecycleStatus, 'active');
  await c.post(`/api/memories/${b.id}/pin`);
  const stale = await c.post('/api/editor/execute', { previewId: preview.body.previewId });
  assert.equal(stale.status, 409); assert.equal(stale.body.error.code, 'PREVIEW_STALE');
  const fresh = await c.post('/api/editor/preview', body);
  assert.equal((await c.post('/api/editor/execute', { previewId: fresh.body.previewId })).status, 200);
  assert.equal(c.store.getRevisionHistory(a.id).length, 2);
  assert.equal(c.store.getRevisionHistory(b.id).length, 1);
});

test('Host, Origin, cross-site and JSON safety enforced by actual HTTP server', async (t) => {
  const c = await fixture(t), m = c.memory('Safe'), route = `/api/memories/${m.id}/pin`;
  // Node fetch rewrites Host; use a real HTTP request to transmit the hostile header.
  const hostStatus = await new Promise((resolve, reject) => {
    const request = http.request(c.url + route, { method: 'POST', headers: { host: 'evil.example', 'content-type': 'application/json' } }, (response) => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject); request.end('{}');
  });
  assert.equal(hostStatus, 403);
  assert.equal((await c.post(route, {}, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await c.post(route, {}, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await c.post(route, {}, { 'content-type': 'text/plain' })).status, 415);
  assert.equal(c.store.getMemory(m.id).isPinned, false);
  assert.equal((await c.post(route, { actorKind: 'system', actorId: 'forged' }, { origin: c.url })).status, 200);
  assert.equal(c.store.getMemory(m.id).lastModifiedByActorId, c.app.services.actorService.getOrCreateUserActor().id);
});

test('Supersede and Conflict previews do not write; execution retains history/sources and resolves once', async (t) => {
  const c = await fixture(t), a = c.memory('Existing'), b = c.memory('Incoming');
  const source = c.store.createSource({ projectId: c.project.id, sourceType: 'manual_input', originalText: 'DEMO evidence' });
  c.store.attachSourceToRevision(a.currentRevisionId, { sourceId: source.id });
  const conflict = c.store.createConflict({ projectId: c.project.id,
    existingMemoryId: a.id, existingRevisionId: a.currentRevisionId,
    incomingMemoryId: b.id, incomingRevisionId: b.currentRevisionId,
    conflictType: 'supersession_candidate', confidence: 1, rationale: 'DEMO only', detectedByActorId: c.user.id });
  const eventsBefore = c.store.listMemoryEvents(a.id).length;
  const supersede = await c.post('/api/editor/preview', { projectId: c.project.id, operation: 'supersede', memoryId: a.id, targetId: b.id, reason: 'Demo successor' });
  assert.equal(supersede.status, 200); assert.equal(supersede.body.result.createdRelations[0].relationType, 'supersedes');
  assert.equal(c.store.listMemoryEvents(a.id).length, eventsBefore);
  assert.equal(c.store.listRelations({ projectId: c.project.id }).length, 0);
  const preview = await c.post('/api/editor/preview', { projectId: c.project.id, operation: 'resolve', conflictId: conflict.id, resolution: 'use_incoming', reason: 'DEMO decision' });
  assert.equal(preview.status, 200); assert.equal(preview.body.domainDryRun.dryRun, true);
  assert.equal(c.store.getConflict(conflict.id).status, 'open');
  const applied = await c.post('/api/editor/execute', { previewId: preview.body.previewId });
  assert.equal(applied.status, 200); assert.equal(c.store.getConflict(conflict.id).status, 'resolved');
  assert.equal(c.store.getMemory(a.id).lifecycleStatus, 'superseded');
  assert.equal(c.store.getRevisionHistory(a.id)[0].id, a.currentRevisionId);
  assert.equal(c.store.listSourcesForRevision(a.currentRevisionId)[0].id, source.id);
  assert.equal((await c.post('/api/editor/execute', { previewId: preview.body.previewId })).body.error.code, 'PREVIEW_STALE');
});

test('preview rejects cross-project IDs and revision changes invalidate accepted plans', async (t) => {
  const c = await fixture(t), a = c.memory('A'), b = c.memory('B');
  const other = c.store.createProject({ name: 'Other demo', slug: 'other' });
  const foreign = c.store.createMemory({ projectId: other.id, actorId: c.user.id, revision: { name: 'Foreign', type: 'fact', contextRole: 'reference', summary: 'DEMO' } });
  const base = { projectId: c.project.id, operation: 'merge', memoryId: a.id, targetId: b.id };
  assert.equal((await c.post('/api/editor/preview', { ...base, targetId: foreign.id })).body.error.code, 'PROJECT_MISMATCH');
  const preview = await c.post('/api/editor/preview', base);
  await c.post(`/api/memories/${a.id}/edit`, { expectedRevisionId: a.currentRevisionId, changes: { summary: 'New' } });
  assert.equal((await c.post('/api/editor/execute', { previewId: preview.body.previewId })).body.error.code, 'PREVIEW_STALE');
  assert.equal(c.store.getMemory(b.id).lifecycleStatus, 'active');
});

test('matches endpoint evaluates saved Memory against search and all filters, not truncated lists', async (t) => {
  const c = await fixture(t), m = c.memory('needle');
  c.app.services.memoryService.lockMemory(m.id, c.user.id); c.app.services.memoryService.pinMemory(m.id, c.user.id);
  const query = new URLSearchParams({ project: c.project.id, q: 'needle', type: 'fact', status: 'active', locked: 'true', pinned: 'true' });
  const matches = async () => (await (await fetch(`${c.url}/api/memories/${m.id}/matches?${query}`)).json()).matches;
  assert.equal(await matches(), true);
  await c.post(`/api/memories/${m.id}/edit`, { expectedRevisionId: m.currentRevisionId, changes: { type: 'decision' } });
  assert.equal(await matches(), false);
});

test('browser edits require expectedRevisionId; revision history returns per-revision Observation and sources', async (t) => {
  const c = await fixture(t), m = c.memory('Browser contract');
  const missing = await c.post(`/api/memories/${m.id}/edit`, { changes: { summary: 'Unsafe' } }, { origin: c.url });
  assert.equal(missing.status, 400); assert.equal(c.store.getRevisionHistory(m.id).length, 1);
  const result = await c.post(`/api/memories/${m.id}/edit`, { changes: { summary: 'Safe' }, expectedRevisionId: m.currentRevisionId }, { origin: c.url });
  assert.equal(result.status, 200);
  const history = await (await fetch(`${c.url}/api/memories/${m.id}/revisions?includeObservation=true`)).json();
  assert.equal(history.length, 2); assert.deepEqual(history[0].sources, []); assert.equal(history[0].metricObservation, null);
});

test('merge and soft-delete preserve frozen Context Snapshot, original evidence and immutable histories', async (t) => {
  const c = await fixture(t), a = c.memory('A'), b = c.memory('B');
  const sources = [a, b].map((memory) => {
    const source = c.store.createSource({ projectId: c.project.id, sourceType: 'manual_input', originalText: `DEMO ${memory.currentRevision.name}` });
    c.store.attachSourceToRevision(memory.currentRevisionId, { sourceId: source.id }); return source;
  });
  const session = c.store.createContextSession({ projectId: c.project.id, promptText: 'DEMO frozen audit', actorId: c.user.id });
  const snapshot = c.store.createContextSnapshot({ contextSessionId: session.id, snapshotKind: 'used', formatVersion: '1',
    renderedContext: 'DEMO original A', structuredContext: { name: 'A' }, contentHash: 'demo-hash', actorId: c.user.id,
    selections: [{ memoryId: a.id, memoryRevisionId: a.currentRevisionId, selectionState: 'included', selectedByActorId: c.user.id,
      rank: 1, relevanceScore: 1, snapshotPayload: { name: 'A' }, reasons: [{ reasonType: 'user_selected' }] }] });
  const preview = await c.post('/api/editor/preview', { operation: 'merge', projectId: c.project.id, memoryId: a.id, targetId: b.id });
  assert.equal((await c.post('/api/editor/execute', { previewId: preview.body.previewId })).status, 200);
  const current = c.store.getMemory(a.id);
  assert.deepEqual(new Set(c.store.listSourcesForRevision(current.currentRevisionId).map((s) => s.id)), new Set(sources.map((s) => s.id)));
  assert.equal((await c.post(`/api/memories/${a.id}/delete`)).status, 200);
  const frozen = c.store.getContextSnapshot(snapshot.id);
  assert.equal(frozen.renderedContext, 'DEMO original A'); assert.equal(frozen.selections[0].memoryRevisionId, a.currentRevisionId);
  assert.equal(c.store.getRevisionHistory(a.id)[0].name, 'A'); assert.equal(c.store.getRevisionHistory(b.id)[0].name, 'B');
  assert.equal(c.store.listSourcesForRevision(b.currentRevisionId)[0].id, sources[1].id);
});

test('Metric merge retains Observation and rejects different run even with an identical supplied scope key', async (t) => {
  const c = await fixture(t), subject = c.memory('Subject', { type: 'entity' });
  const a = c.memory('A metric', { subtype: 'metric_observation' }), b = c.memory('B metric', { subtype: 'metric_observation' });
  for (const [memory, runLabel] of [[a, 'run-a'], [b, 'run-b']]) c.store.createMetricObservation({ revisionId: memory.currentRevisionId,
    subjectMemoryId: subject.id, metricName: 'DEMO score', valueNumber: 1, valueRaw: '1', runLabel, scopeKey: 'same-but-untrusted' });
  const invalid = await c.post('/api/editor/preview', { projectId: c.project.id, operation: 'merge', memoryId: a.id, targetId: b.id });
  assert.equal(invalid.body.error.code, 'METRIC_SCOPE_CHANGE'); assert.equal(c.store.getRevisionHistory(a.id).length, 1);
  const compatible = c.memory('Compatible metric', { subtype: 'metric_observation' });
  c.store.createMetricObservation({ revisionId: compatible.currentRevisionId, subjectMemoryId: subject.id, metricName: 'DEMO score',
    valueNumber: 2, valueRaw: '2', runLabel: 'run-a', scopeKey: 'same-but-untrusted' });
  const preview = await c.post('/api/editor/preview', { projectId: c.project.id, operation: 'merge', memoryId: a.id, targetId: compatible.id });
  assert.equal(preview.status, 200); assert.equal(c.store.getRevisionHistory(a.id).length, 1);
  const applied = await c.post('/api/editor/execute', { previewId: preview.body.previewId });
  assert.equal(applied.status, 200); assert.equal(c.store.getMetricObservation(applied.body.createdRevision.id).valueNumber, 1);
});

test('compatible Merge/Supersede dryRun routes truly roll back, and browser high-risk writes require preview', async (t) => {
  const c = await fixture(t), a = c.memory('A'), b = c.memory('B');
  const merge = await c.post('/api/memories/merge', { primaryId: a.id, secondaryId: b.id, dryRun: true });
  assert.equal(merge.status, 200); assert.equal(merge.body.dryRun, true);
  assert.equal(c.store.getRevisionHistory(a.id).length, 1);
  const supersede = await c.post(`/api/memories/${a.id}/supersede`, { newMemoryId: b.id, reason: 'DEMO', dryRun: true });
  assert.equal(supersede.status, 200); assert.equal(supersede.body.dryRun, true);
  assert.equal(c.store.getMemory(a.id).lifecycleStatus, 'active');
  const unsafe = await c.post('/api/memories/merge', { primaryId: a.id, secondaryId: b.id }, { origin: c.url });
  assert.equal(unsafe.status, 409); assert.equal(unsafe.body.error.code, 'PREVIEW_STALE');
  assert.equal(c.store.getRevisionHistory(a.id).length, 1);
});

test('an explicitly user-edited candidate can still be Confirmed without discarding its Revision', async (t) => {
  const c = await fixture(t), m = c.memory('Candidate edit');
  await c.post(`/api/memories/${m.id}/reject`); await c.post(`/api/memories/${m.id}/restore`);
  assert.equal(c.store.getMemory(m.id).lifecycleStatus, 'candidate');
  const edited = await c.post(`/api/memories/${m.id}/edit`, { expectedRevisionId: m.currentRevisionId, changes: { summary: 'Reviewed demo' } });
  assert.equal(edited.status, 200);
  const confirmed = await c.post(`/api/memories/${m.id}/confirm`);
  assert.equal(confirmed.status, 200); assert.equal(confirmed.body.affectedMemories[0].lifecycleStatus, 'active');
  assert.equal(confirmed.body.affectedMemories[0].currentRevisionId, edited.body.createdRevision.id);
});
