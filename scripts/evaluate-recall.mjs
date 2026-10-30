// Small labeled DEMO evaluation through actual HTTP/SQLite, never the user's database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLocalServer } from '../src/server/server.mjs';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-recall-eval-'));
const app = createLocalServer({ dbPath: path.join(directory, 'demo.db'), port: 0 });
try {
  const { url } = await app.start();
  async function post(route, body) {
    const response = await fetch(url + route, { method: 'POST',
      headers: { origin: url, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.ok(response.ok, await response.clone().text());
    return response.json();
  }
  async function get(route) {
    const response = await fetch(url + route);
    const raw = await response.text();
    assert.ok(response.ok, raw);
    return { body: JSON.parse(raw), bytes: Buffer.byteLength(raw) };
  }
  const project = await post('/api/projects', { name: 'DEMO labeled recall evaluation' });
  const foreign = await post('/api/projects', { name: 'DEMO separate project' });
  async function create(name, summary, projectId = project.id, type = 'fact') {
    return (await post('/api/memories', { projectId, name, summary, type,
      description: 'DEMO_ONLY_LONG_DESCRIPTION '.repeat(500) })).affectedMemories[0];
  }
  const baseline = await create('DEMO baseline', 'classifier checkpoint 分类器', project.id, 'constraint');
  await post(`/api/memories/${baseline.id}/lock`, {});
  await post(`/api/memories/${baseline.id}/pin`, {});
  await create('DEMO classifier distractor', 'classifier');
  await create('DEMO checkpoint distractor', 'checkpoint');
  const privateRecord = await create('DEMO foreign baseline', 'classifier checkpoint', foreign.id);
  const revised = await create('DEMO evolving observation', 'retiredtoken');
  const revision = await post(`/api/memories/${revised.id}/edit`, {
    expectedRevisionId: revised.currentRevisionId, changes: { summary: 'currenttoken' },
  });
  const rejected = await create('DEMO discarded proposal', 'discardedtoken');
  await post(`/api/memories/${rejected.id}/reject`, {});
  const neighbor = await create('DEMO dependency', 'Protocol is an independently stored assertion');
  const distant = await create('DEMO second hop', 'Not a direct dependency');
  const store = app.services.readService.store;
  const actorId = app.services.actorService.getOrCreateUserActor().id;
  for (const [from, to] of [[baseline, neighbor], [neighbor, distant]]) {
    store.createRelation({ projectId: project.id, sourceMemoryId: from.id, targetMemoryId: to.id,
      relationType: 'depends_on', actorId, confidence: 1 });
  }
  const contiguous = await create('DEMO Chinese token diagnostic', '保持基线分类器固定进行对照实验');

  // Labels are explicit fixture decisions, not derived from the retrieved rankings.
  const cases = [
    { name: 'multi-query intersection ranks first', queries: ['classifier', 'checkpoint'], limit: 1, relevant: [baseline.id] },
    { name: 'project and all four filters before ranking', queries: ['classifier'], limit: 5,
      filters: { type: 'constraint', status: 'active', locked: 'true', pinned: 'true' }, relevant: [baseline.id] },
    { name: 'current revision only', queries: ['currenttoken'], limit: 5, relevant: [revised.id],
      expectedRevisionId: revision.createdRevision.id },
    { name: 'explicit rejected inspection', queries: ['discardedtoken'], limit: 5,
      filters: { status: 'rejected' }, relevant: [rejected.id] },
    { name: 'one hop, not two', queries: ['classifier checkpoint'], limit: 5, neighbors: 1,
      relevant: [baseline.id, neighbor.id], forbidden: [distant.id] },
    { name: 'literal Chinese alias token', queries: ['分类器'], limit: 5, relevant: [baseline.id] },
  ];
  const results = [];
  let fullBytes = 0;
  let compactBytes = 0;
  let selectedReadBytes = 0;
  const before = (await get(`/api/memories/${baseline.id}/events`)).body;
  for (const scenario of cases) {
    const params = new URLSearchParams({ project: project.id, limit: String(scenario.limit),
      neighbors: String(scenario.neighbors ?? 0), ...scenario.filters });
    scenario.queries.forEach((query) => params.append('q', query));
    const route = '/api/recall?' + params.toString();
    const full = await get(route);
    const compact = await get(route + '&view=compact');
    const ids = compact.body.items.map((item) => item.memory.id);
    assert.deepEqual(ids, full.body.items.map((item) => item.memory.id), scenario.name);
    assert.deepEqual(compact.body.items.map((item) => [item.score, item.reasons]),
      full.body.items.map((item) => [item.score, item.reasons]), scenario.name);
    assert.ok(!ids.includes(privateRecord.id), scenario.name);
    for (const id of scenario.forbidden ?? []) assert.ok(!ids.includes(id), scenario.name);
    const relevantRanks = scenario.relevant.map((id) => ids.indexOf(id) + 1).filter((rank) => rank > 0);
    const recallAtK = relevantRanks.length / scenario.relevant.length;
    const reciprocalRank = relevantRanks.length ? 1 / Math.min(...relevantRanks) : 0;
    assert.equal(recallAtK, 1, scenario.name);
    if (scenario.expectedRevisionId) {
      assert.equal(compact.body.items[0].memory.currentRevisionId, scenario.expectedRevisionId);
    }
    // Both workflows still require selected detail; preview savings must not hide this cost.
    let scenarioDetailBytes = 0;
    for (const id of scenario.relevant) {
      const membership = await get(`/api/memories/${id}/matches?project=${project.id}`);
      const detail = await get(`/api/memories/${id}`);
      assert.equal(detail.body.memory.projectId, project.id);
      assert.equal(detail.body.currentRevision.id,
        compact.body.items.find((item) => item.memory.id === id).memory.currentRevisionId);
      scenarioDetailBytes += membership.bytes + detail.bytes;
    }
    fullBytes += full.bytes;
    compactBytes += compact.bytes;
    selectedReadBytes += scenarioDetailBytes;
    results.push({ name: scenario.name, k: scenario.limit, recallAtK, reciprocalRank,
      returned: ids.length, truncated: compact.body.truncated, fullBytes: full.bytes,
      compactBytes: compact.bytes, selectedReadBytes: scenarioDetailBytes });
  }
  for (const query of ['retiredtoken', 'discardedtoken']) {
    const response = await get(`/api/recall?project=${project.id}&q=${query}&view=compact`);
    assert.deepEqual(response.body.items, []);
  }
  const chinese = await get(`/api/recall?project=${project.id}&q=${encodeURIComponent('基线分类器')}&view=compact`);
  const chineseSubstringHit = chinese.body.items.some((item) => item.memory.id === contiguous.id);
  const detail = (await get(`/api/memories/${baseline.id}`)).body;
  assert.equal(detail.currentRevision.id, baseline.currentRevisionId);
  assert.ok(detail.currentRevision.description.includes('DEMO_ONLY_LONG_DESCRIPTION'));
  assert.deepEqual((await get(`/api/memories/${baseline.id}/events`)).body, before);
  assert.ok(compactBytes < fullBytes, 'compact preview must reduce this fixture response size');
  console.log(JSON.stringify({ dataset: 'fictional DEMO fixture, not a public or real-user benchmark',
    interface: 'actual HTTP/SQLite; fixture setup writes only; evaluated reads do not write',
    cases: results, meanRecallAtK: results.reduce((sum, item) => sum + item.recallAtK, 0) / results.length,
    meanReciprocalRank: results.reduce((sum, item) => sum + item.reciprocalRank, 0) / results.length,
    responseBytes: { full: fullBytes, compact: compactBytes,
      reductionPercent: Number(((1 - compactBytes / fullBytes) * 100).toFixed(2)),
      meaning: 'UTF-8 HTTP response bytes on long-description fixtures; not tokens, latency or general savings' },
    workflowResponseBytes: { fullThenSelectedDetail: fullBytes + selectedReadBytes,
      compactThenSelectedDetail: compactBytes + selectedReadBytes,
      reductionPercent: Number(((fullBytes - compactBytes) / (fullBytes + selectedReadBytes) * 100).toFixed(2)),
      meaning: 'six separate question flows; both include same selected detail and membership preflight; request headers excluded' },
    diagnostics: { chineseSubstringHit,
      meaning: 'unicode61 literal tokens are not general Chinese segmentation or semantic matching; not a quality gate' },
    limits: 'six labeled cases; no competitor run, public benchmark equivalence, causal model-use proof or broad accuracy claim',
  }, null, 2));
} finally {
  await app.stop();
  fs.rmSync(directory, { recursive: true, force: true });
}
