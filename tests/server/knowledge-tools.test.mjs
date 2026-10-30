import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLocalServer } from '../../src/server/server.mjs';

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-knowledge-tools-'));
  const app = createLocalServer({ dbPath: path.join(directory, 'demo.db'), port: 0 });
  const { url } = await app.start();
  t.after(async () => {
    await app.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  async function post(route, body) {
    const response = await fetch(url + route, {
      method: 'POST', headers: { origin: url, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.ok(response.ok, await response.clone().text());
    return response.json();
  }
  const project = await post('/api/projects', { name: 'DEMO knowledge tools' });
  async function memory(name, summary, projectId = project.id) {
    const result = await post('/api/memories', { projectId, name, summary, type: 'fact' });
    return result.affectedMemories[0];
  }
  async function get(route) {
    const response = await fetch(url + route);
    return { status: response.status, body: await response.json() };
  }
  return { app, url, post, get, project, memory };
}

test('multi-query recall fuses literal keyword ranks, deduplicates and explains current evidence', async (t) => {
  const c = await fixture(t);
  const both = await c.memory('Intersection', 'alpha beta');
  await c.memory('First', 'alpha');
  await c.memory('Second', 'beta');
  const before = (await c.get(`/api/memories/${both.id}/revisions`)).body;
  const result = await c.get(`/api/recall?project=${c.project.id}&q=alpha&q=beta&q=alpha&limit=10`);
  assert.equal(result.status, 200);
  assert.equal(result.body.strategy, 'keyword-rank-fusion');
  assert.deepEqual(result.body.queries, ['alpha', 'beta']);
  assert.equal(result.body.items.length, 3);
  const first = result.body.items[0];
  assert.equal(first.memory.id, both.id);
  assert.equal(first.memory.currentRevisionId, both.currentRevisionId);
  assert.deepEqual(first.reasons.map((reason) => reason.query), ['alpha', 'beta']);
  assert.ok(first.reasons.every((reason) => reason.kind === 'keyword' && reason.rank > 0));
  assert.equal(first.sources[0].sourceType, 'manual_input');
  assert.equal(result.body.scoreMeaning, 'retrieval rank, not truth or confidence');
  assert.deepEqual((await c.get(`/api/memories/${both.id}/revisions`)).body, before);
});

test('compact recall previews retain ranking and exact identity without downloading full assertions', async (t) => {
  const c = await fixture(t);
  const result = await c.post('/api/memories', { projectId: c.project.id, type: 'fact',
    name: 'DEMO compact evidence', summary: 'compacttoken ' + '😀'.repeat(500),
    description: 'FULL_DESCRIPTION_DEMO_ONLY '.repeat(500) });
  const memory = result.affectedMemories[0];
  const route = `/api/recall?project=${c.project.id}&q=compacttoken`;
  const full = (await c.get(route)).body;
  const compact = (await c.get(route + '&view=compact')).body;
  assert.equal(compact.view, 'compact');
  assert.deepEqual(compact.items.map((item) => [item.memory.id, item.score, item.reasons]),
    full.items.map((item) => [item.memory.id, item.score, item.reasons]));
  const item = compact.items[0];
  assert.equal(item.memory.currentRevision.id, memory.currentRevisionId);
  assert.equal(item.memory.currentRevision.revisionNumber, 1);
  assert.ok([...item.memory.currentRevision.summary].length <= 320);
  assert.equal(item.preview.summaryTruncated, true);
  assert.equal(item.preview.requiresDetail, true);
  assert.equal(item.memory.currentRevision.description, undefined);
  assert.equal(item.sourceCoverage.metadata, 'identity-only');
  assert.equal(item.sourceCoverage.total, 1);
  assert.equal(item.sources[0].id, full.items[0].sources[0].id);
  assert.equal(JSON.stringify(compact).includes('FULL_DESCRIPTION_DEMO_ONLY'), false);
  assert.ok(Buffer.byteLength(JSON.stringify(compact)) < Buffer.byteLength(JSON.stringify(full)) / 3);
  const detail = (await c.get(`/api/memories/${memory.id}`)).body;
  assert.equal(detail.currentRevision.description, 'FULL_DESCRIPTION_DEMO_ONLY '.repeat(500));
});

test('compact recall bounds source previews, preserves controls/relations and rejects unsupported views', async (t) => {
  const c = await fixture(t);
  const seed = await c.memory('DEMO source preview', 'sourcepreviewtoken');
  const neighbor = await c.memory('DEMO relation-only', 'Separate result');
  const store = c.app.services.readService.store;
  const actorId = c.app.services.actorService.getOrCreateUserActor().id;
  for (let index = 0; index < 10; index++) {
    const source = store.createSource({ projectId: c.project.id, sourceType: 'manual_input',
      originalText: 'PRIVATE_DEMO_EVIDENCE', filePath: '/Users/PRIVATE_DEMO_PATH/source.md', locator: 'PRIVATE_DEMO_LOCATOR' });
    store.attachSourceToRevision(seed.currentRevisionId, { sourceId: source.id, evidenceRole: 'supporting' });
  }
  for (const memory of [seed, neighbor]) {
    await c.post(`/api/memories/${memory.id}/lock`, {});
    await c.post(`/api/memories/${memory.id}/pin`, {});
  }
  store.createRelation({ projectId: c.project.id, sourceMemoryId: seed.id,
    targetMemoryId: neighbor.id, relationType: 'depends_on', actorId, confidence: 1 });
  const route = `/api/recall?project=${c.project.id}&q=sourcepreviewtoken&locked=true&pinned=true&type=fact&neighbors=1`;
  const compact = (await c.get(route + '&view=compact')).body;
  assert.deepEqual(compact.items.map((item) => item.memory.id), [seed.id, neighbor.id]);
  assert.equal(compact.items[0].memory.isLocked, true);
  assert.equal(compact.items[0].memory.isPinned, true);
  assert.deepEqual(compact.items[0].sourceCoverage,
    { total: 11, returned: 8, truncated: true, metadata: 'identity-only' });
  assert.equal(compact.items[0].sources.length, 8);
  assert.equal(JSON.stringify(compact).includes('PRIVATE_DEMO'), false);
  assert.equal(compact.items[1].reasons[0].kind, 'relation');
  assert.equal((await c.get(route + '&view=unknown')).body.error.code, 'INVALID_QUERY');
  await c.post(`/api/memories/${seed.id}/reject`, {});
  assert.deepEqual((await c.get(route + '&view=compact')).body.items, []);
  const rejected = (await c.get(route + '&view=compact&status=rejected')).body;
  assert.equal(rejected.items[0].memory.id, seed.id);
  assert.equal(rejected.items[0].memory.lifecycleStatus, 'rejected');
});

test('opt-in recall expands only eligible one-hop records and labels relation paths rather than keyword hits', async (t) => {
  const c = await fixture(t);
  const seed = await c.memory('Anchor', 'anchor');
  const neighbor = await c.memory('Related result', 'A separate observation');
  const excluded = await c.memory('Excluded result', 'Not pinned');
  const other = await c.post('/api/projects', { name: 'DEMO unrelated project' });
  await c.memory('Foreign anchor', 'anchor', other.id);
  for (const memory of [seed, neighbor]) {
    await c.post(`/api/memories/${memory.id}/lock`, {});
    await c.post(`/api/memories/${memory.id}/pin`, {});
  }
  const store = c.app.services.readService.store;
  const actorId = c.app.services.actorService.getOrCreateUserActor().id;
  const relation = store.createRelation({ projectId: c.project.id, sourceMemoryId: seed.id,
    targetMemoryId: neighbor.id, relationType: 'depends_on', actorId, confidence: 1 });
  store.createRelation({ projectId: c.project.id, sourceMemoryId: seed.id,
    targetMemoryId: excluded.id, relationType: 'depends_on', actorId, confidence: 1 });
  const route = `/api/recall?project=${c.project.id}&q=anchor&type=fact&status=active&locked=true&pinned=true`;
  assert.deepEqual((await c.get(route)).body.items.map((item) => item.memory.id), [seed.id]);
  const result = await c.get(route + '&neighbors=1');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.items.map((item) => item.memory.id), [seed.id, neighbor.id]);
  assert.deepEqual(result.body.items[1].reasons, [{ kind: 'relation', seedMemoryId: seed.id,
    relationId: relation.id, relationType: 'depends_on', direction: 'outgoing' }]);
  assert.equal(result.body.neighborhoods[0].loaded, 1);
});

test('Markdown export preserves current identity, original evidence and notes without executing injected markup', async (t) => {
  const c = await fixture(t);
  const memory = await c.memory('<script>alert(1)</script>', 'Original DEMO text\n```\n<script>not executable</script>');
  await c.post(`/api/memories/${memory.id}/notes`, { content: 'DEMO note\n````\n<img src=x onerror=alert(1)>' });
  const edited = await c.post(`/api/memories/${memory.id}/edit`, {
    expectedRevisionId: memory.currentRevisionId, changes: { summary: 'Corrected DEMO text' },
  });
  const before = (await c.get(`/api/memories/${memory.id}/events`)).body;
  const result = await c.get(`/api/memories/${memory.id}/export?project=${c.project.id}`);
  assert.equal(result.status, 200);
  assert.equal(result.body.revisionId, edited.createdRevision.id);
  assert.equal(result.body.filename, `memory-${memory.id}-r2.md`);
  assert.match(result.body.markdown, /# &lt;script&gt;alert/);
  assert.match(result.body.markdown, /Corrected DEMO text/);
  assert.match(result.body.markdown, /Original DEMO text/);
  assert.match(result.body.markdown, /`````text\nDEMO note\n````\n<img src=x onerror=alert\(1\)>\n`````/);
  assert.match(result.body.markdown, /manual_input/);
  assert.match(result.body.markdown, /Read-only current-revision export; not a database backup/);
  assert.deepEqual((await c.get(`/api/memories/${memory.id}/events`)).body, before);
  assert.equal((await c.get(`/api/memories/${memory.id}/revisions`)).body.length, 2);
});

test('recall uses only current active revisions by default, with explicit Rejected inspection', async (t) => {
  const c = await fixture(t);
  const revised = await c.memory('Changing assertion', 'oldtoken');
  await c.post(`/api/memories/${revised.id}/edit`, {
    expectedRevisionId: revised.currentRevisionId, changes: { summary: 'newtoken' },
  });
  const rejected = await c.memory('Rejected assertion', 'oldtoken');
  await c.post(`/api/memories/${rejected.id}/reject`, {});
  const outdated = await c.memory('Outdated assertion', 'oldtoken');
  await c.post(`/api/memories/${outdated.id}/outdated`, {});
  const route = `/api/recall?project=${c.project.id}&q=oldtoken`;
  assert.deepEqual((await c.get(route)).body.items, []);
  assert.deepEqual((await c.get(route + '&status=rejected')).body.items.map((item) => item.memory.id), [rejected.id]);
  assert.deepEqual((await c.get(route + '&status=outdated')).body.items.map((item) => item.memory.id), [outdated.id]);
  assert.equal((await c.get(`/api/recall?project=${c.project.id}&q=newtoken`)).body.items[0].memory.id, revised.id);
});

test('recall filters the 201st matching control record before its bounded candidate pool', async (t) => {
  const c = await fixture(t);
  for (let index = 0; index < 200; index++) await c.memory(`DEMO ordinary ${index}`, 'boundedtoken');
  const target = await c.memory('DEMO locked pinned target', 'boundedtoken');
  await c.post(`/api/memories/${target.id}/lock`, {});
  await c.post(`/api/memories/${target.id}/pin`, {});
  const route = `/api/recall?project=${c.project.id}&q=boundedtoken&limit=1`;
  const bounded = (await c.get(route)).body;
  assert.equal(bounded.items.length, 1);
  assert.equal(bounded.queryMatches[0].total, 201);
  assert.equal(bounded.queryMatches[0].loaded, 50);
  assert.equal(bounded.truncated, true);
  const filtered = (await c.get(route + '&locked=true&pinned=true&type=fact&status=active')).body;
  assert.equal(filtered.items[0].memory.id, target.id);
  assert.equal(filtered.queryMatches[0].total, 1);
  assert.equal(filtered.truncated, false);
  const empty = (await c.get(route + '&type=decision')).body;
  assert.equal(empty.candidateCount, 0);
  assert.deepEqual(empty.items, []);
  assert.equal(empty.truncated, false);
});

test('recall and export reject invalid bounds/project identity without altering legacy search', async (t) => {
  const c = await fixture(t);
  const memory = await c.memory('DEMO validation', 'alpha beta');
  const root = `/api/recall?project=${c.project.id}`;
  for (const suffix of ['', '&q=', '&q=alpha&limit=51', '&q=alpha&neighbors=2', '&q=alpha&locked=1',
    '&q=1&q=2&q=3&q=4&q=5&q=6', '&q=' + 'x'.repeat(201)]) {
    assert.ok((await c.get(root + suffix)).status >= 400);
  }
  assert.equal((await c.get('/api/recall?q=alpha')).body.error.code, 'PROJECT_REQUIRED');
  assert.equal((await c.get('/api/recall?project=12345678-1234-4234-8234-123456789abc&q=alpha')).status, 404);
  assert.deepEqual((await c.get(root + '&q=alpha%20OR%20missing')).body.items, []);
  const other = await c.post('/api/projects', { name: 'DEMO foreign export' });
  assert.equal((await c.get(`/api/memories/${memory.id}/export?project=${other.id}`)).body.error.code, 'PROJECT_MISMATCH');
  assert.equal((await c.get(`/api/memories/${memory.id}/export`)).body.error.code, 'PROJECT_REQUIRED');
  assert.equal((await c.get(`/api/search?project=${c.project.id}&q=alpha`)).body[0].id, memory.id);
});

test('export keeps Locked Metric scope and synchronized numeric observation', async (t) => {
  const c = await fixture(t);
  const store = c.app.services.readService.store;
  const actorId = c.app.services.actorService.getOrCreateUserActor().id;
  const subject = await c.memory('DEMO subject', 'Fictional baseline');
  const memory = store.createMemory({ projectId: c.project.id, actorId,
    isLocked: true, revision: { name: 'DEMO score', type: 'fact', subtype: 'metric_observation',
      summary: 'Fictional score', contextRole: 'result', valueKind: 'none', confidence: 1 } });
  store.createMetricObservation({ revisionId: memory.currentRevisionId, subjectMemoryId: subject.id,
    metricName: 'DEMO accuracy', valueRaw: '65.433', valueNumber: 65.433,
    datasetMemoryId: subject.id, split: 'validation', protocol: 'clean', runLabel: 'run-a',
    checkpoint: 'epoch57', scopeKey: 'demo-scope' });
  const result = (await c.get(`/api/memories/${memory.id}/export?project=${c.project.id}`)).body;
  for (const text of ['locked: true', '65.433', 'validation', 'clean', 'run-a', 'epoch57', 'demo-scope']) {
    assert.ok(result.markdown.includes(text), text);
  }
  const compact = (await c.get(`/api/recall?project=${c.project.id}&q=score&view=compact`)).body.items[0];
  assert.equal(compact.memory.id, memory.id);
  assert.equal(compact.memory.currentRevisionId, memory.currentRevisionId);
  assert.equal(compact.memory.currentRevision.subtype, 'metric_observation');
  assert.equal(compact.preview.requiresDetail, true);
  assert.equal(compact.memory.currentRevision.valueRaw, undefined);
  assert.equal(compact.metricObservation, undefined);
  const detail = (await c.get(`/api/memories/${memory.id}`)).body;
  assert.equal(detail.metricObservation.valueNumber, 65.433);
  assert.equal(detail.metricObservation.protocol, 'clean');
  assert.equal(detail.metricObservation.runLabel, 'run-a');
  assert.equal(detail.metricObservation.checkpoint, 'epoch57');
});

test('export handles many embedded backticks and rejects oversized evidence without a partial document', async (t) => {
  const c = await fixture(t);
  const memory = await c.memory('DEMO large evidence', 'A saved assertion');
  const store = c.app.services.readService.store;
  const source = store.createSource({ projectId: c.project.id, sourceType: 'manual_input',
    originalText: '` x '.repeat(150000) });
  store.attachSourceToRevision(memory.currentRevisionId, { sourceId: source.id, evidenceRole: 'supporting' });
  const route = `/api/memories/${memory.id}/export?project=${c.project.id}`;
  const valid = await c.get(route);
  assert.equal(valid.status, 200);
  assert.ok(valid.body.markdown.includes('` x '.repeat(150000)));
  const oversized = store.createSource({ projectId: c.project.id, sourceType: 'manual_input',
    originalText: 'x'.repeat(2 * 1024 * 1024) });
  store.attachSourceToRevision(memory.currentRevisionId, { sourceId: oversized.id, evidenceRole: 'supporting' });
  const rejected = await c.get(route);
  assert.equal(rejected.status, 422);
  assert.equal(rejected.body.error.code, 'EXPORT_TOO_LARGE');
  assert.equal(rejected.body.markdown, undefined);
  assert.equal((await c.get(`/api/memories/${memory.id}/revisions`)).body.length, 1);
});

test('recall reports bounded one-hop coverage and never promotes a two-hop record as a direct neighbor', async (t) => {
  const c = await fixture(t);
  const seed = await c.memory('DEMO center', 'centerkeyword');
  const store = c.app.services.readService.store;
  const actorId = c.app.services.actorService.getOrCreateUserActor().id;
  let first;
  for (let index = 0; index < 25; index++) {
    const neighbor = await c.memory(`DEMO neighbor ${index}`, 'Separate result');
    first ??= neighbor;
    store.createRelation({ projectId: c.project.id, sourceMemoryId: seed.id,
      targetMemoryId: neighbor.id, relationType: 'depends_on', actorId, confidence: 1 });
  }
  const distant = await c.memory('DEMO second hop', 'Distant result');
  store.createRelation({ projectId: c.project.id, sourceMemoryId: first.id,
    targetMemoryId: distant.id, relationType: 'depends_on', actorId, confidence: 1 });
  const result = (await c.get(`/api/recall?project=${c.project.id}&q=centerkeyword&neighbors=1&limit=50`)).body;
  assert.equal(result.filters.status, 'active');
  assert.equal(result.items.length, 21);
  assert.equal(result.neighborhoods[0].total, 25);
  assert.equal(result.neighborhoods[0].loaded, 20);
  assert.equal(result.neighborhoods[0].truncated, true);
  assert.equal(result.truncated, true);
  assert.equal(result.items.some((item) => item.memory.id === distant.id), false);
});

test('export frontmatter preserves HTML names without raw tags even in a renderer that ignores YAML', async (t) => {
  const c = await fixture(t);
  const name = '<script>alert(1)</script>\u2028---';
  const memory = await c.memory(name, 'DEMO literal content');
  const result = (await c.get(`/api/memories/${memory.id}/export?project=${c.project.id}`)).body;
  const frontmatter = result.markdown.split('\n---\n')[0];
  assert.equal(frontmatter.includes('<script>'), false);
  assert.equal(frontmatter.includes('\u2028'), false);
  assert.equal(JSON.parse(frontmatter.match(/^title: (.*)$/mu)[1]), name);
});
