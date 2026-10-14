import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLocalServer } from '../../src/server/server.mjs';

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-first-use-'));
  const app = createLocalServer({ dbPath: path.join(directory, 'test.db'), port: 0 });
  const { url } = await app.start();
  t.after(async () => { await app.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  const post = async (route, body, headers = {}) => {
    const response = await fetch(url + route, { method: 'POST', headers: { origin: url, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const get = async (route) => (await fetch(url + route)).json();
  return { app, url, post, get };
}

test('fresh database creates isolated projects with server-generated identity and untrusted names', async (t) => {
  const c = await fixture(t);
  assert.deepEqual(await c.get('/api/projects'), []);
  const first = await c.post('/api/projects', { name: '<b>我的项目</b>', actorKind: 'system', slug: 'forged' });
  assert.equal(first.status, 201);
  assert.equal(first.body.name, '<b>我的项目</b>');
  assert.notEqual(first.body.slug, 'forged');
  const second = await c.post('/api/projects', { name: '<b>我的项目</b>' });
  assert.equal(second.status, 201); assert.notEqual(first.body.id, second.body.id);
  assert.equal((await c.get('/api/projects')).length, 2);
});

test('manual creation atomically stores Revision 1, human provenance and audit with server Actor', async (t) => {
  const c = await fixture(t);
  const project = (await c.post('/api/projects', { name: 'Real first-use fixture' })).body;
  const created = await c.post('/api/memories', { projectId: project.id, name: 'Keep plain <img>', type: 'constraint',
    summary: 'Do not modify calibration.', description: 'Explicit human instruction.', actorId: 'forged',
    lifecycleStatus: 'deleted', isLocked: true });
  assert.equal(created.status, 201);
  const memory = created.body.affectedMemories[0];
  const detail = await c.get(`/api/memories/${memory.id}`);
  assert.equal(detail.revisionCount, 1); assert.equal(detail.memory.lifecycleStatus, 'active');
  assert.equal(detail.memory.verificationStatus, 'user_confirmed'); assert.equal(detail.memory.isLocked, false);
  assert.equal(detail.currentRevision.name, 'Keep plain <img>');
  assert.equal(detail.currentRevision.createdByActorId, c.app.services.actorService.getOrCreateUserActor().id);
  assert.equal(detail.sources[0].sourceType, 'manual_input');
  assert.match(detail.sources[0].originalText, /Explicit human instruction/);
  assert.ok((await c.get(`/api/memories/${memory.id}/events`)).some((event) => event.eventType === 'created'));
  const other = (await c.post('/api/projects', { name: 'Other' })).body;
  assert.deepEqual(await c.get(`/api/memories?project=${other.id}`), []);
});

test('invalid/Metric creation cannot leave partial memory and creation shares write safety', async (t) => {
  const c = await fixture(t), project = (await c.post('/api/projects', { name: 'Validation' })).body;
  const input = { projectId: project.id, name: 'Invalid', type: 'fact', summary: 'Explicit instruction' };
  assert.equal((await c.post('/api/memories', { ...input, type: 'unknown' })).status, 400);
  assert.equal((await c.post('/api/memories', { ...input, subtype: 'metric_observation' })).body.error.code, 'METRIC_STRUCTURE_REQUIRED');
  assert.equal((await c.post('/api/memories', input, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await c.post('/api/projects', { name: 'Cross-site' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await c.post('/api/memories', input, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await c.post('/api/memories', { ...input, summary: 'x'.repeat(4001) })).status, 413);
  assert.equal((await c.post('/api/memories', { ...input, description: 'x'.repeat(16001) })).status, 413);
  assert.deepEqual(await c.get(`/api/memories?project=${project.id}`), []);
  assert.equal((await c.post('/api/memories', { ...input, projectId: '12345678-1234-4234-8234-123456789abc' })).status, 404);
  assert.equal((await c.get('/api/projects')).length, 1);
});
