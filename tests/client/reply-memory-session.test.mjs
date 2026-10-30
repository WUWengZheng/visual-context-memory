import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLocalServer } from '../../src/server/server.mjs';
import { createReplyMemorySession } from '../../src/client/reply-memory-session.mjs';

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-reply-usage-'));
  const app = createLocalServer({ dbPath: path.join(directory, 'demo.db'), port: 0 });
  const { url } = await app.start();
  t.after(async () => { await app.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  const post = async (route, body) => {
    const response = await fetch(url + route, { method: 'POST',
      headers: { origin: url, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.ok(response.ok, await response.clone().text());
    return response.json();
  };
  const project = await post('/api/projects', { name: 'DEMO reply attribution' });
  const create = async (name, summary = 'sharedtoken', projectId = project.id) =>
    (await post('/api/memories', { projectId, name, summary, type: 'fact' })).affectedMemories[0];
  const get = async (route) => (await fetch(url + route)).json();
  const session = () => createReplyMemorySession({ baseUrl: url, projectId: project.id });
  return { app, url, post, get, create, project, session };
}

test('reply report distinguishes actual retrieval/detail returns from declared references, citations and exclusions', async (t) => {
  const c = await fixture(t);
  const first = await c.create('DEMO <script>first</script>');
  const second = await c.create('DEMO second');
  const before = await c.get(`/api/memories/${first.id}/events`);
  const usage = c.session();
  await usage.recall({ queries: ['sharedtoken'], limit: 2 });
  await usage.read(first.id, first.currentRevisionId);
  const ref = { memoryId: first.id, revisionId: first.currentRevisionId };
  usage.reference(ref, '用于本次背景说明');
  usage.cite(ref, '本回答的明确结论');
  usage.exclude({ memoryId: second.id, revisionId: second.currentRevisionId }, '与本次问题无关');
  const report = usage.report();
  assert.deepEqual(report.counts, { visible: 2, retrieved: 2, detailReceived: 1, referenced: 1, cited: 1, notCited: 1 });
  assert.equal(report.items.find((item) => item.memoryId === first.id).sources[0].sourceType, 'manual_input');
  assert.equal(report.items.find((item) => item.memoryId === second.id).excludedReason, '与本次问题无关');
  assert.equal(report.useBasis, 'caller-declared, not model-internal causality');
  const text = usage.render();
  assert.match(text, /本次记忆使用说明/);
  assert.match(text, /检索返回 2/);
  assert.match(text, /明确引用 1/);
  assert.match(text, /与本次问题无关/);
  assert.ok(text.includes(first.currentRevisionId));
  assert.ok(!text.includes('<script>'));
  assert.deepEqual(await c.get(`/api/memories/${first.id}/events`), before);
});

test('compact retrieval discloses preview omissions and still requires exact full detail before citing', async (t) => {
  const c = await fixture(t);
  const memory = await c.create('DEMO ' + 'x'.repeat(150));
  const usage = c.session();
  const results = await usage.recall({ queries: ['sharedtoken'], view: 'compact' });
  assert.equal(results.view, 'compact');
  const ref = { memoryId: memory.id, revisionId: memory.currentRevisionId };
  assert.throws(() => usage.cite(ref, '未读详情不引用'), { code: 'DETAIL_REQUIRED' });
  assert.equal(usage.report().items[0].nameTruncated, true);
  assert.equal(usage.report().items[0].sourceCoverage.metadata, 'identity-only');
  assert.match(usage.render(), /仅提供来源标识/);
  assert.match(usage.render(), /名称已截断/);
  await usage.read(memory.id, memory.currentRevisionId);
  usage.cite(ref, '已核对真实详情');
  // A later compact recall cannot replace already acquired full name/provenance.
  await usage.recall({ queries: ['sharedtoken'], view: 'compact' });
  const item = usage.report().items[0];
  assert.equal(item.name, 'DEMO ' + 'x'.repeat(150));
  assert.equal(item.nameTruncated, false);
  assert.equal(item.sourceCoverage.metadata, 'detail');
  assert.equal(item.sources[0].author, 'Local Viewer user');
  assert.doesNotMatch(usage.render(), /仅提供来源标识/);
});

test('a compact preview cannot be promoted to a citation after another client changes Current', async (t) => {
  const c = await fixture(t);
  const memory = await c.create('DEMO compact freshness');
  const usage = c.session();
  await usage.recall({ queries: ['sharedtoken'], view: 'compact' });
  const changed = await c.post(`/api/memories/${memory.id}/edit`, {
    expectedRevisionId: memory.currentRevisionId, changes: { summary: 'A new independently saved assertion' },
  });
  await assert.rejects(usage.read(memory.id, memory.currentRevisionId), { code: 'REVISION_CHANGED' });
  assert.equal(usage.report().counts.detailReceived, 0);
  assert.throws(() => usage.cite({ memoryId: memory.id, revisionId: memory.currentRevisionId }, 'Stale preview'),
    { code: 'DETAIL_REQUIRED' });
  await usage.read(memory.id, changed.createdRevision.id);
  usage.cite({ memoryId: memory.id, revisionId: changed.createdRevision.id }, 'Reviewed new Revision');
  assert.equal(usage.report().counts.visible, 2);
  assert.equal(usage.report().items.find((item) => item.revisionId === memory.currentRevisionId).cited, false);
  assert.equal(usage.report().items.find((item) => item.revisionId === changed.createdRevision.id).cited, true);
  assert.equal(usage.report().requests[1].error.code, 'REVISION_CHANGED');
});

test('empty, unqueried and failed recall are different outcomes, never a claim that the database is empty', async (t) => {
  const c = await fixture(t);
  const unused = c.session();
  assert.equal(unused.report().requests.length, 0);
  assert.match(unused.render(), /未检索或读取/);
  const empty = c.session();
  await empty.recall({ queries: ['no-match'] });
  assert.equal(empty.report().requests[0].status, 'success');
  assert.equal(empty.report().counts.visible, 0);
  assert.match(empty.render(), /不代表/);
  const failed = c.session();
  await assert.rejects(failed.recall({ queries: ['sharedtoken'], limit: 51 }));
  assert.equal(failed.report().requests[0].status, 'failed');
  assert.match(failed.render(), /请求失败/);
  assert.match(failed.render(), /未据此判断记忆不存在/);
});

test('cross-project detail is rejected before its content is downloaded or registered', async (t) => {
  const c = await fixture(t);
  const other = await c.post('/api/projects', { name: 'DEMO unrelated project' });
  const foreign = await c.create('Foreign private evidence', 'secret-demo', other.id);
  const requested = [];
  const usage = createReplyMemorySession({ baseUrl: c.url, projectId: c.project.id,
    fetcher: (url, options) => { requested.push(url.pathname); return fetch(url, options); } });
  await assert.rejects(usage.read(foreign.id, foreign.currentRevisionId), { code: 'PROJECT_MISMATCH' });
  assert.equal(usage.report().counts.visible, 0);
  assert.equal(requested.includes(`/api/memories/${foreign.id}`), false);
  assert.equal(requested.includes(`/api/memories/${foreign.id}/matches`), true);
});

test('unseen, unread and excluded revisions cannot be declared cited; direct reads remain distinct from retrieval', async (t) => {
  const c = await fixture(t);
  const memory = await c.create('DEMO explicit read');
  const ref = { memoryId: memory.id, revisionId: memory.currentRevisionId };
  const usage = c.session();
  assert.throws(() => usage.cite(ref, 'A conclusion'), { code: 'UNKNOWN_MEMORY_REVISION' });
  await usage.recall({ queries: ['sharedtoken'] });
  assert.throws(() => usage.cite(ref, 'A conclusion'), { code: 'DETAIL_REQUIRED' });
  await usage.read(memory.id, memory.currentRevisionId);
  usage.exclude(ref, 'Not relevant to this reply');
  assert.throws(() => usage.cite(ref, 'A conclusion'), { code: 'CLASSIFICATION_CONFLICT' });
  const direct = c.session();
  await direct.read(memory.id, memory.currentRevisionId);
  direct.cite(ref, 'Reviewed direct evidence');
  assert.equal(direct.report().counts.retrieved, 0);
  assert.equal(direct.report().counts.detailReceived, 1);
  assert.equal(direct.report().counts.cited, 1);
  assert.throws(() => direct.exclude(ref, 'Contradictory label'), { code: 'CLASSIFICATION_CONFLICT' });
});

test('a changed Current never turns a retrieved old Revision into a silently cited new Revision', async (t) => {
  const c = await fixture(t);
  const memory = await c.create('DEMO versioned assertion');
  const usage = c.session();
  await usage.recall({ queries: ['sharedtoken'] });
  const edit = await c.post(`/api/memories/${memory.id}/edit`, {
    expectedRevisionId: memory.currentRevisionId, changes: { summary: 'Changed DEMO assertion' },
  });
  await assert.rejects(usage.read(memory.id, memory.currentRevisionId), { code: 'REVISION_CHANGED' });
  assert.throws(() => usage.cite({ memoryId: memory.id, revisionId: memory.currentRevisionId }, 'Old claim'), { code: 'DETAIL_REQUIRED' });
  await usage.read(memory.id, edit.createdRevision.id);
  usage.cite({ memoryId: memory.id, revisionId: edit.createdRevision.id }, 'Reviewed new claim');
  assert.equal(usage.report().counts.visible, 2);
  assert.equal(usage.report().items.find((item) => item.cited).revisionId, edit.createdRevision.id);
  assert.equal(usage.report().items.find((item) => item.retrieved).revisionId, memory.currentRevisionId);
  assert.equal((await c.get(`/api/memories/${memory.id}/revisions`)).length, 2);
});

test('report declares query/display truncation without inventing unreturned or filtered memory identities', async (t) => {
  const c = await fixture(t);
  await c.create('DEMO first');
  await c.create('DEMO second');
  await c.create('DEMO third');
  const rejected = await c.create('DEMO rejected');
  await c.post(`/api/memories/${rejected.id}/reject`, {});
  const bounded = c.session();
  await bounded.recall({ queries: ['sharedtoken'], limit: 2 });
  assert.equal(bounded.report().counts.visible, 2);
  assert.equal(bounded.report().items.some((item) => item.memoryId === rejected.id), false);
  assert.match(bounded.render({ limit: 1 }), /检索范围被截断/);
  assert.match(bounded.render({ limit: 1 }), /另有 1 条/);
  assert.equal(bounded.report().items.every((item) => item.excludedReason === null), true);
  const history = c.session();
  await history.recall({ queries: ['sharedtoken'], filters: { status: 'rejected' } });
  await history.read(rejected.id, rejected.currentRevisionId);
  assert.equal(history.report().items[0].lifecycleStatus, 'rejected');
  assert.equal(history.report().counts.cited, 0);
});

test('source metadata remains real, private paths are hidden by default, and notes/original text never enter the report', async (t) => {
  const c = await fixture(t);
  const memory = await c.create('DEMO sourced');
  const store = c.app.services.readService.store;
  const source = store.createSource({ projectId: c.project.id, sourceType: 'manual_input',
    filePath: '/Users/private-location/evidence.md', locator: 'line 12', originalText: 'PRIVATE_DEMO_SOURCE_TEXT' });
  store.attachSourceToRevision(memory.currentRevisionId, { sourceId: source.id, evidenceRole: 'supporting' });
  await c.post(`/api/memories/${memory.id}/notes`, { content: 'PRIVATE_DEMO_NOTE' });
  const usage = c.session();
  const detail = await usage.read(memory.id, memory.currentRevisionId);
  detail.sources.length = 0; // Caller mutation cannot rewrite the captured origin metadata.
  const safe = JSON.stringify(usage.report());
  assert.ok(safe.includes(source.id));
  assert.ok(safe.includes('evidence.md'));
  assert.ok(!safe.includes('private-location'));
  assert.ok(!safe.includes('PRIVATE_DEMO_SOURCE_TEXT'));
  assert.ok(!safe.includes('PRIVATE_DEMO_NOTE'));
  assert.ok(JSON.stringify(usage.report({ revealPaths: true })).includes('private-location'));
  assert.throws(() => usage.report({ revealPaths: 'false' }), TypeError);
  const actorId = c.app.services.actorService.getOrCreateUserActor().id;
  const unsourced = store.createMemory({ projectId: c.project.id, actorId, revision: {
    name: 'DEMO no source', type: 'fact', contextRole: 'reference', summary: 'Unverified source', confidence: 1, valueKind: 'none',
  } });
  const unknown = c.session();
  await unknown.read(unsourced.id, unsourced.currentRevisionId);
  assert.match(unknown.render(), /来源：未记录/);
});

test('pending and cancelled reads cannot produce a completed report or a fake server-disconnected result', async (t) => {
  const c = await fixture(t);
  await c.create('DEMO pending');
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const usage = createReplyMemorySession({ baseUrl: c.url, projectId: c.project.id,
    fetcher: async (url, options) => { await gate; return fetch(url, options); } });
  const pending = usage.recall({ queries: ['sharedtoken'] });
  assert.throws(() => usage.report(), { code: 'SESSION_INCOMPLETE' });
  release();
  await pending;
  assert.equal(usage.report().counts.retrieved, 1);
  const cancelled = c.session();
  const cancellation = new AbortController();
  cancellation.abort();
  await assert.rejects(cancelled.recall({ queries: ['sharedtoken'] }, cancellation.signal), { name: 'AbortError' });
  assert.equal(cancelled.report().requests[0].status, 'cancelled');
  assert.match(cancelled.render(), /请求已取消/);
  assert.ok(!cancelled.render().includes('Server disconnected'));
});

test('each new reply session starts empty and only permits loopback origins without redirects or credentials', async (t) => {
  const c = await fixture(t);
  const memory = await c.create('DEMO session isolation');
  const first = c.session();
  await first.read(memory.id, memory.currentRevisionId);
  assert.equal(first.report().counts.visible, 1);
  assert.equal(c.session().report().counts.visible, 0);
  for (const baseUrl of ['https://127.0.0.1', 'http://example.com', 'http://user:secret@127.0.0.1', `${c.url}/extra`, `${c.url}/?token=x`]) {
    assert.throws(() => createReplyMemorySession({ baseUrl, projectId: c.project.id }), TypeError);
  }
  const observed = [];
  const safe = createReplyMemorySession({ baseUrl: c.url, projectId: c.project.id,
    fetcher: (url, options) => { observed.push(options.redirect); return fetch(url, options); } });
  await safe.recall({ queries: ['sharedtoken'] });
  assert.deepEqual(observed, ['error']);
});

test('recorded query scope excludes unsupported input fields and retains the actual backend defaults', async (t) => {
  const c = await fixture(t);
  await c.create('DEMO actual scope');
  const usage = c.session();
  await usage.recall({ queries: ['sharedtoken'], filters: { ignored: 'PRIVATE_IGNORED_FIELD' } });
  const report = usage.report();
  assert.ok(!JSON.stringify(report).includes('PRIVATE_IGNORED_FIELD'));
  assert.equal(report.requests[0].coverage.filters.status, 'active');
  assert.deepEqual(report.requests[0].coverage.queries, ['sharedtoken']);
});

test('injected network failure is reported as failure, not successful empty retrieval', async (t) => {
  const c = await fixture(t);
  const usage = createReplyMemorySession({ baseUrl: c.url, projectId: c.project.id,
    fetcher: async () => { throw new TypeError('DEMO transport failure'); } });
  await assert.rejects(usage.recall({ queries: ['sharedtoken'] }), { kind: 'network' });
  assert.equal(usage.report().requests[0].status, 'failed');
  assert.equal(usage.report().requests[0].error.kind, 'network');
  assert.match(usage.render(), /请求失败/);
  assert.ok(!usage.render().includes('查询成功返回零条'));
});
