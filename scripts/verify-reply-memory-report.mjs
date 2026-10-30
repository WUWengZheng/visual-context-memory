// End-to-end DEMO report. All writes prepare an isolated fixture, never user data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLocalServer } from '../src/server/server.mjs';
import { createReplyMemorySession } from '../src/client/reply-memory-session.mjs';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-reply-report-demo-'));
const app = createLocalServer({ dbPath: path.join(directory, 'demo.db'), port: 0 });
try {
  const { url } = await app.start();
  async function post(route, body) {
    const response = await fetch(url + route, { method: 'POST',
      headers: { origin: url, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.ok(response.ok, await response.clone().text());
    return response.json();
  }
  const project = await post('/api/projects', { name: 'DEMO reply transparency' });
  const create = async (name, summary) => (await post('/api/memories', {
    projectId: project.id, name, summary, type: 'constraint',
  })).affectedMemories[0];
  const baseline = await create('DEMO fixed classifier', 'Keep classifier weights fixed when comparing checkpoint runs.');
  const alternative = await create('DEMO alternative classifier', 'A different classifier belongs to a separate experiment.');
  await create('DEMO camera requirement', 'Camera inputs are an unrelated demonstration requirement.');
  const events = async () => (await fetch(`${url}/api/memories/${baseline.id}/events`)).json();
  const before = await events();
  const usage = createReplyMemorySession({ baseUrl: url, projectId: project.id });
  await usage.recall({ queries: ['classifier'], limit: 20 });
  const detail = await usage.read(baseline.id, baseline.currentRevisionId);
  assert.match(detail.sources[0].originalText, /Keep classifier weights fixed/);
  const ref = { memoryId: baseline.id, revisionId: baseline.currentRevisionId };
  usage.reference(ref, '解释演示基线的对比约束');
  usage.cite(ref, '演示项目在对比 checkpoint 时保持 classifier weights 不变');
  usage.exclude({ memoryId: alternative.id, revisionId: alternative.currentRevisionId }, '本次询问基线，不把另一个实验当作当前基线');
  assert.deepEqual(usage.report().counts, { visible: 2, retrieved: 2, detailReceived: 1, referenced: 1, cited: 1, notCited: 1 });
  assert.deepEqual(await events(), before);
  console.log('DEMO ONLY — fictional records, not real experiment findings.');
  console.log(usage.render());
  console.log('PASS real HTTP/SQLite capture, exact Revision/source attribution and non-writing report');
} finally {
  await app.stop();
  fs.rmSync(directory, { recursive: true, force: true });
}
