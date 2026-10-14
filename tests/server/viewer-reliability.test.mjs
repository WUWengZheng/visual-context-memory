import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VisualContextMemoryStore } from '../../src/db/store.mjs';
import { createLocalServer } from '../../src/server/server.mjs';
import { api } from '../../viewer/api.mjs';

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-reliability-'));
  const store = new VisualContextMemoryStore({ dbPath: path.join(directory, 'test.db') });
  const actor = store.createActor({ actorType: 'user', displayName: 'Test user' });
  const project = store.createProject({ name: '<img src=x onerror=alert(1)>', slug: 'reliability' });
  const add = (name, options = {}) => store.createMemory({
    projectId: project.id, actorId: actor.id, ...options,
    revision: { name, type: 'fact', contextRole: 'result', summary: name, ...options.revision },
  });
  const app = createLocalServer({ port: 0, store });
  const { url } = await app.start();
  t.after(async () => { await app.stop(); store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const get = async (route) => { const response = await fetch(`${url}${route}`); return { response, body: await response.json() }; };
  return { store, project, actor, add, get, url };
}

test('Library, Search and Graph filter the 201st locked/pinned match before limit', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 200; i++) f.add(`needle ${i}`);
  f.add('needle wrong status', { isLocked: true, isPinned: true, lifecycleStatus: 'outdated' });
  f.add('needle wrong type', { isLocked: true, isPinned: true, revision: { type: 'entity' } });
  f.add('needle wrong pin', { isLocked: true });
  f.add('needle wrong lock', { isPinned: true });
  const match = f.add('needle locked', { isLocked: true, isPinned: true });
  const query = `project=${f.project.id}&type=fact&status=active&locked=true&pinned=true&limit=1`;
  for (const route of ['/api/memories?', '/api/search?q=needle&', '/api/graph?']) {
    const { body } = await f.get(route + query);
    assert.deepEqual((body.nodes ?? body).map((item) => item.id), [match.id]);
  }
});

test('neighborhood filters before limit and retains only valid edges', async (t) => {
  const f = await fixture(t);
  const root = f.add('root', { isLocked: true });
  const link = (target) => f.store.createRelation({ projectId: f.project.id,
    actorId: f.actor.id, sourceMemoryId: root.id, targetMemoryId: target.id,
    relationType: 'related_to', confidence: 1 });
  for (let index = 0; index < 200; index++) link(f.add(`noise ${index}`));
  const last = f.add('late locked', { isLocked: true }); link(last);
  const { body } = await f.get(`/api/graph?project=${f.project.id}&memoryId=${root.id}&locked=true&limit=2`);
  assert.deepEqual(new Set(body.nodes.map((node) => node.id)), new Set([root.id, last.id]));
  assert.equal(body.total, 2);
  assert.equal(body.edges.length, 1);
  assert.ok(body.edges.every((edge) => body.nodes.some((node) => node.id === edge.source) && body.nodes.some((node) => node.id === edge.target)));
});

test('opt-in pagination reports totals without breaking existing arrays', async (t) => {
  const f = await fixture(t);
  f.add('needle one'); f.add('needle two');
  for (const route of ['/api/memories?', '/api/search?q=needle&']) {
    const base = `${route}project=${f.project.id}&limit=1`;
    const legacy = await f.get(base);
    assert.ok(Array.isArray(legacy.body));
    const { body } = await f.get(`${base}&page=true`);
    assert.equal(body.items.length, 1);
    assert.equal(body.total, 2);
    assert.equal(body.truncated, true);
  }
});

test('filtered empty graph, excluded neighborhood center, and explicit rejected are truthful', async (t) => {
  const f = await fixture(t);
  const root = f.add('root');
  const rejected = f.add('rejected needle', { lifecycleStatus: 'rejected' });
  const defaultGraph = await f.get(`/api/graph?project=${f.project.id}`);
  assert.ok(!defaultGraph.body.nodes.some((node) => node.id === rejected.id));
  const rejectedGraph = await f.get(`/api/graph?project=${f.project.id}&status=rejected`);
  assert.deepEqual(rejectedGraph.body.nodes.map((node) => node.id), [rejected.id]);
  const empty = await f.get(`/api/graph?project=${f.project.id}&memoryId=${root.id}&locked=true`);
  assert.equal(empty.body.nodes.length, 0);
  assert.equal(empty.body.total, 0);
  assert.equal(empty.body.centerExcluded, true);
});

test('invalid boolean filters are rejected and API client preserves domain error fields', async (t) => {
  const f = await fixture(t);
  const invalid = await f.get(`/api/graph?project=${f.project.id}&locked=garbage`);
  assert.equal(invalid.response.status, 400);
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = (url, options) => original(new URL(url, f.url), options);
  await assert.rejects(api.detail('11111111-1111-4111-8111-111111111111'), (error) => {
    assert.equal(error.status, 404);
    assert.equal(error.code, 'MEMORY_NOT_FOUND');
    assert.match(error.message, /Memory not found/);
    assert.equal(error.details.memoryId, '11111111-1111-4111-8111-111111111111');
    return true;
  });
});
