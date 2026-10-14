import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createLocalServer } from '../../src/server/server.mjs';
import { VisualContextMemoryStore } from '../../src/db/store.mjs';
import { MemoryService } from '../../src/services/memory-service.mjs';

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-api-'));
  const store = new VisualContextMemoryStore({ dbPath: path.join(directory, 'test.db') });
  const user = store.createActor({ actorType: 'user', displayName: 'Seed user' });
  const codex = store.createActor({ actorType: 'codex', displayName: 'Seed Codex' });
  const project = store.createProject({ name: 'COMP-2DPASS', slug: `api-${path.basename(directory)}` });
  const services = new MemoryService(store);
  const app = createLocalServer({ port: 0, store });
  const address = await app.start();
  t.after(async () => { await app.stop(); store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { store, user, codex, project, services, app, address };
}

function revision(name, overrides = {}) {
  return { name, type: 'entity', subtype: 'experiment', contextRole: 'current_state', summary: `${name} is relevant.`, confidence: 1, ...overrides };
}

function active(ctx, name, overrides = {}) {
  return ctx.store.createMemory({ projectId: ctx.project.id, actorId: ctx.user.id, revision: revision(name, overrides) });
}

function candidate(ctx, name, overrides = {}) {
  return ctx.services.createCandidate(ctx.project.id, ctx.codex.id, revision(name, overrides)).affectedMemories[0];
}

async function jsonRequest(ctx, pathName, options = {}) {
  const response = await fetch(`${ctx.address.url}${pathName}`, options);
  const text = await response.text();
  return { response, body: text.length === 0 ? null : JSON.parse(text) };
}

function post(ctx, pathName, body) {
  return jsonRequest(ctx, pathName, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

test('local server defaults to loopback and exposes a healthy HTTP boundary', async (t) => {
  const { address } = await fixture(t);
  assert.equal(address.host, '127.0.0.1');
  const response = await fetch(`${address.url}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('projects and memories APIs return isolated project data', async (t) => {
  const ctx = await fixture(t);
  const memory = active(ctx, 'Stage1');
  const projects = await jsonRequest(ctx, '/api/projects');
  const memories = await jsonRequest(ctx, `/api/memories?project=${ctx.project.id}`);
  assert.equal(projects.response.status, 200);
  assert.equal(projects.body[0].id, ctx.project.id);
  assert.equal(memories.body[0].id, memory.id);
});

test('memory detail returns the Viewer aggregate instead of a raw Memory row', async (t) => {
  const ctx = await fixture(t);
  const stage = active(ctx, 'Stage1');
  const fact = active(ctx, 'Clean mIoU', { type: 'fact', subtype: 'metric_observation', contextRole: 'baseline' });
  const source = ctx.store.createSource({ projectId: ctx.project.id, sourceType: 'experiment_log', originalText: '65.433' });
  ctx.store.attachSourceToRevision(fact.currentRevisionId, { sourceId: source.id });
  ctx.store.createMetricObservation({ revisionId: fact.currentRevisionId, subjectMemoryId: stage.id, metricName: 'Clean mIoU', valueNumber: 65.433, valueRaw: '65.433', scopeKey: 'stage1|clean' });
  ctx.services.addNote(fact.id, ctx.user.id, 'Epoch57 result.');
  ctx.store.createRelation({ projectId: ctx.project.id, sourceMemoryId: stage.id, targetMemoryId: fact.id, relationType: 'has_result', confidence: 1, actorId: ctx.user.id });
  const result = await jsonRequest(ctx, `/api/memories/${fact.id}`);
  assert.equal(result.response.status, 200);
  assert.equal(result.body.memory.id, fact.id);
  assert.equal(result.body.currentRevision.id, fact.currentRevisionId);
  assert.equal(result.body.sources[0].id, source.id);
  assert.equal(result.body.notes[0].content, 'Epoch57 result.');
  assert.equal(result.body.metricObservation.valueNumber, 65.433);
  assert.equal(result.body.revisionCount, 1);
  assert.equal(result.body.relations[0].relationType, 'has_result');
});

test('revision, event, note, relation, and search routes expose read-only service data', async (t) => {
  const ctx = await fixture(t);
  const memory = active(ctx, 'Searchable Stage1 tokenapi');
  ctx.services.editMemory(memory.id, ctx.user.id, { summary: 'Updated searchable Stage1 tokenapi.' });
  ctx.services.addNote(memory.id, ctx.user.id, 'Read API note.');
  const [revisions, events, notes, relations, search] = await Promise.all([
    jsonRequest(ctx, `/api/memories/${memory.id}/revisions`),
    jsonRequest(ctx, `/api/memories/${memory.id}/events`),
    jsonRequest(ctx, `/api/memories/${memory.id}/notes`),
    jsonRequest(ctx, `/api/memories/${memory.id}/relations`),
    jsonRequest(ctx, `/api/search?project=${ctx.project.id}&q=tokenapi`),
  ]);
  assert.equal(revisions.body.length, 2);
  assert.equal(events.body.some((event) => event.eventType === 'revision_created'), true);
  assert.equal(notes.body[0].content, 'Read API note.');
  assert.deepEqual(relations.body, []);
  assert.equal(search.body[0].id, memory.id);
});

test('graph returns lightweight nodes and directed edges with a bounded limit', async (t) => {
  const ctx = await fixture(t);
  const stage1 = active(ctx, 'Stage1');
  const stage2 = active(ctx, 'Stage2B');
  const method = active(ctx, 'Prototype Retrieval', { subtype: 'method' });
  ctx.store.createRelation({ projectId: ctx.project.id, sourceMemoryId: stage2.id, targetMemoryId: method.id, relationType: 'uses', confidence: 1, actorId: ctx.user.id });
  ctx.store.createRelation({ projectId: ctx.project.id, sourceMemoryId: stage1.id, targetMemoryId: stage2.id, relationType: 'depends_on', confidence: 1, actorId: ctx.user.id });
  const graph = await jsonRequest(ctx, `/api/graph?project=${ctx.project.id}&limit=2`);
  assert.equal(graph.response.status, 200);
  assert.equal(graph.body.nodes.length, 2);
  assert.deepEqual(Object.keys(graph.body.nodes[0]).sort(), ['contextRole', 'id', 'importance', 'lifecycleStatus', 'locked', 'name', 'pinned', 'subtype', 'type', 'verificationStatus']);
  assert.equal(graph.body.edges.every((edge) => Object.hasOwn(edge, 'source') && Object.hasOwn(edge, 'target')), true);
});

test('graph neighborhood returns one-hop edges and rejects invalid depth', async (t) => {
  const ctx = await fixture(t);
  const stage2 = active(ctx, 'Stage2B');
  const method = active(ctx, 'Prototype Retrieval');
  const issue = active(ctx, 'Camera Missing', { type: 'issue', subtype: 'problem', contextRole: 'known_issue' });
  ctx.store.createRelation({ projectId: ctx.project.id, sourceMemoryId: stage2.id, targetMemoryId: method.id, relationType: 'uses', confidence: 1, actorId: ctx.user.id });
  ctx.store.createRelation({ projectId: ctx.project.id, sourceMemoryId: stage2.id, targetMemoryId: issue.id, relationType: 'addresses', confidence: 1, actorId: ctx.user.id });
  const graph = await jsonRequest(ctx, `/api/graph?project=${ctx.project.id}&memoryId=${stage2.id}&depth=1&limit=10`);
  const invalid = await jsonRequest(ctx, `/api/graph?project=${ctx.project.id}&memoryId=${stage2.id}&depth=3`);
  assert.equal(graph.body.nodes.length, 3);
  assert.equal(graph.body.edges.length, 2);
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.body.error.code, 'INVALID_QUERY');
});

test('graph supports type and lifecycle filters without expanding large node payloads', async (t) => {
  const ctx = await fixture(t);
  active(ctx, 'Entity node');
  const fact = active(ctx, 'Outdated fact', { type: 'fact', subtype: 'state', contextRole: 'result' });
  ctx.services.markMemoryOutdated(fact.id, ctx.user.id, { reason: 'Historical result' });
  const byType = await jsonRequest(ctx, `/api/graph?project=${ctx.project.id}&type=fact`);
  const byStatus = await jsonRequest(ctx, `/api/graph?project=${ctx.project.id}&status=outdated`);
  assert.equal(byType.body.nodes.length, 1);
  assert.equal(byType.body.nodes[0].name, 'Outdated fact');
  assert.equal(byStatus.body.nodes[0].lifecycleStatus, 'outdated');
  assert.equal(Object.hasOwn(byStatus.body.nodes[0], 'description'), false);
});

test('COMP-2DPASS demo-shaped data is readable through the graph API', async (t) => {
  const ctx = await fixture(t);
  const dataset = active(ctx, 'SemanticKITTI', { subtype: 'dataset', contextRole: 'reference' });
  const stage1 = active(ctx, 'Stage1');
  const stage2A = active(ctx, 'Stage2A');
  const stage2B = active(ctx, 'Stage2B', { contextRole: 'current_plan' });
  const retrieval = active(ctx, 'Prototype Retrieval', { subtype: 'method', contextRole: 'background' });
  active(ctx, 'Pseudo Prompt', { subtype: 'method', contextRole: 'background' });
  const cameraMissing = active(ctx, 'Camera Missing', { type: 'issue', subtype: 'problem', contextRole: 'known_issue' });
  const cleanMiou = active(ctx, 'Clean mIoU', { type: 'fact', subtype: 'state', contextRole: 'baseline' });
  ctx.store.createRelation({ projectId: ctx.project.id, sourceMemoryId: stage2B.id, targetMemoryId: retrieval.id, relationType: 'uses', confidence: 1, actorId: ctx.user.id });
  ctx.store.createRelation({ projectId: ctx.project.id, sourceMemoryId: stage2B.id, targetMemoryId: cameraMissing.id, relationType: 'addresses', confidence: 1, actorId: ctx.user.id });
  ctx.store.createRelation({ projectId: ctx.project.id, sourceMemoryId: stage1.id, targetMemoryId: cleanMiou.id, relationType: 'has_result', confidence: 1, actorId: ctx.user.id });
  ctx.store.createRelation({ projectId: ctx.project.id, sourceMemoryId: stage2A.id, targetMemoryId: dataset.id, relationType: 'evaluated_on', confidence: 1, actorId: ctx.user.id });
  const graph = await jsonRequest(ctx, `/api/graph?project=${ctx.project.id}&memoryId=${stage2B.id}&depth=1&limit=10`);
  assert.deepEqual(graph.body.nodes.map((node) => node.name).sort(), ['Camera Missing', 'Prototype Retrieval', 'Stage2B']);
  assert.deepEqual(graph.body.edges.map((edge) => edge.relationType).sort(), ['addresses', 'uses']);
});

test('context session collection and detail routes preserve the stored aggregate boundary', async (t) => {
  const ctx = await fixture(t);
  const session = ctx.store.createContextSession({ projectId: ctx.project.id, promptText: 'Continue Stage2B.', actorId: ctx.user.id });
  const list = await jsonRequest(ctx, `/api/context-sessions?project=${ctx.project.id}`);
  const detail = await jsonRequest(ctx, `/api/context-sessions/${session.id}`);
  assert.equal(list.body[0].id, session.id);
  assert.equal(detail.body.session.promptText, 'Continue Stage2B.');
  assert.deepEqual(detail.body.snapshots, []);
});

test('missing Memory and unknown routes return structured 404 errors', async (t) => {
  const ctx = await fixture(t);
  const missing = await jsonRequest(ctx, '/api/memories/00000000-0000-4000-8000-000000000099');
  const unknown = await jsonRequest(ctx, '/api/unknown');
  assert.equal(missing.response.status, 404);
  assert.equal(missing.body.error.code, 'MEMORY_NOT_FOUND');
  assert.equal(unknown.response.status, 404);
  assert.equal(unknown.body.error.code, 'ROUTE_NOT_FOUND');
});

test('confirm route invokes the real service with the server-selected user Actor', async (t) => {
  const ctx = await fixture(t);
  const memory = candidate(ctx, 'Candidate');
  const result = await post(ctx, `/api/memories/${memory.id}/confirm`, { actorId: ctx.codex.id, actorKind: 'codex' });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.affectedMemories[0].lifecycleStatus, 'active');
  assert.equal(ctx.store.getMemory(memory.id).verificationStatus, 'user_confirmed');
  assert.notEqual(ctx.store.listMemoryEvents(memory.id).at(-1).actorId, ctx.codex.id);
});

test('lock, unlock, pin, and unpin routes delegate to the domain service', async (t) => {
  const ctx = await fixture(t);
  const memory = active(ctx, 'Controls');
  await post(ctx, `/api/memories/${memory.id}/lock`, { reason: 'Protect' });
  await post(ctx, `/api/memories/${memory.id}/pin`, {});
  assert.equal(ctx.store.getMemory(memory.id).isLocked, true);
  assert.equal(ctx.store.getMemory(memory.id).isPinned, true);
  await post(ctx, `/api/memories/${memory.id}/unlock`, {});
  await post(ctx, `/api/memories/${memory.id}/unpin`, {});
  assert.equal(ctx.store.getMemory(memory.id).isLocked, false);
  assert.equal(ctx.store.getMemory(memory.id).isPinned, false);
});

test('edit and note creation routes create a revision and a separate Note', async (t) => {
  const ctx = await fixture(t);
  const memory = active(ctx, 'Editable');
  const edit = await post(ctx, `/api/memories/${memory.id}/edit`, { changes: { summary: 'Edited through HTTP.' } });
  const note = await post(ctx, `/api/memories/${memory.id}/notes`, { content: 'Viewer note.' });
  assert.equal(edit.body.createdRevision.revisionNumber, 2);
  assert.equal(note.response.status, 201);
  assert.equal(note.body.note.content, 'Viewer note.');
});

test('outdated and reject routes perform lifecycle operations', async (t) => {
  const ctx = await fixture(t);
  const oldMemory = active(ctx, 'Old plan');
  const incoming = candidate(ctx, 'Bad extraction');
  await post(ctx, `/api/memories/${oldMemory.id}/outdated`, { reason: 'No longer current' });
  await post(ctx, `/api/memories/${incoming.id}/reject`, { reason: 'Incorrect' });
  assert.equal(ctx.store.getMemory(oldMemory.id).lifecycleStatus, 'outdated');
  assert.equal(ctx.store.getMemory(incoming.id).lifecycleStatus, 'rejected');
});

test('supersede and merge routes preserve the domain transaction semantics', async (t) => {
  const ctx = await fixture(t);
  const oldMemory = active(ctx, 'Old baseline');
  const replacement = candidate(ctx, 'New baseline');
  const supersede = await post(ctx, `/api/memories/${oldMemory.id}/supersede`, { newMemoryId: replacement.id, reason: 'Corrected value' });
  const duplicate = active(ctx, 'Duplicate baseline');
  const merge = await post(ctx, '/api/memories/merge', { primaryId: replacement.id, secondaryId: duplicate.id, contentStrategy: 'primary', reason: 'Duplicate' });
  assert.equal(supersede.response.status, 200);
  assert.equal(ctx.store.getMemory(oldMemory.id).lifecycleStatus, 'superseded');
  assert.equal(merge.response.status, 200);
  assert.equal(ctx.store.getMemory(duplicate.id).lifecycleStatus, 'superseded');
});

test('conflict resolution route applies the existing conflict service', async (t) => {
  const ctx = await fixture(t);
  const existing = active(ctx, 'Existing result');
  const incoming = candidate(ctx, 'Incoming result');
  const item = ctx.store.createConflict({ projectId: ctx.project.id, existingMemoryId: existing.id, existingRevisionId: existing.currentRevisionId, incomingMemoryId: incoming.id, incomingRevisionId: incoming.currentRevisionId, conflictType: 'value_conflict', confidence: 1, rationale: 'Different values', detectedByActorId: ctx.codex.id });
  const result = await post(ctx, `/api/conflicts/${item.id}/resolve`, { resolution: 'use_incoming', reason: 'Accepted log' });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.conflict.status, 'resolved');
  assert.equal(ctx.store.getMemory(existing.id).lifecycleStatus, 'superseded');
});

test('domain errors preserve codes and map to meaningful HTTP statuses', async (t) => {
  const ctx = await fixture(t);
  const candidateMemory = candidate(ctx, 'Cannot become outdated directly');
  const invalidTransition = await post(ctx, `/api/memories/${candidateMemory.id}/outdated`, {});
  const existing = active(ctx, 'First');
  const incoming = candidate(ctx, 'Second');
  const item = ctx.store.createConflict({ projectId: ctx.project.id, existingMemoryId: existing.id, existingRevisionId: existing.currentRevisionId, incomingMemoryId: incoming.id, incomingRevisionId: incoming.currentRevisionId, conflictType: 'duplicate', confidence: 1, rationale: 'Duplicate', detectedByActorId: ctx.codex.id });
  await post(ctx, `/api/conflicts/${item.id}/resolve`, { resolution: 'reject_incoming' });
  const repeated = await post(ctx, `/api/conflicts/${item.id}/resolve`, { resolution: 'reject_incoming' });
  assert.equal(invalidTransition.response.status, 422);
  assert.equal(invalidTransition.body.error.code, 'INVALID_LIFECYCLE_TRANSITION');
  assert.equal(repeated.response.status, 409);
  assert.equal(repeated.body.error.code, 'CONFLICT_ALREADY_RESOLVED');
});

test('server rejects oversized and invalid JSON without wildcard CORS', async (t) => {
  const ctx = await fixture(t);
  const memory = active(ctx, 'Input limits');
  const oversized = await fetch(`${ctx.address.url}/api/memories/${memory.id}/notes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'x'.repeat(70 * 1024) }) });
  const invalid = await fetch(`${ctx.address.url}/api/memories/${memory.id}/notes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' });
  const longDescription = await post(ctx, `/api/memories/${memory.id}/edit`, { changes: { description: 'x'.repeat(16001) } });
  assert.equal(oversized.status, 413);
  assert.equal(invalid.status, 400);
  assert.equal(longDescription.response.status, 413);
  assert.equal(oversized.headers.has('access-control-allow-origin'), false);
});

test('static shell is same-origin, reports server connection text, and test data stays isolated', async (t) => {
  const ctx = await fixture(t);
  const page = await fetch(`${ctx.address.url}/`);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.equal(html.includes('Visual Context Memory'), true);
  assert.equal(html.includes('Server connected'), true);
  assert.equal(ctx.store.database.prepare('PRAGMA database_list').get().file.endsWith('test.db'), true);
});

test('stopping a server releases its loopback port', async (t) => {
  const ctx = await fixture(t);
  const port = ctx.address.port;
  await ctx.app.stop();
  const second = createLocalServer({ port, store: ctx.store });
  t.after(async () => second.stop());
  const address = await second.start();
  assert.equal(address.port, port);
});

test('a loopback port conflict is surfaced to the local starter', async (t) => {
  const ctx = await fixture(t);
  const second = createLocalServer({ port: ctx.address.port, store: ctx.store });
  t.after(async () => second.stop());
  await assert.rejects(() => second.start(), { code: 'EADDRINUSE' });
});
