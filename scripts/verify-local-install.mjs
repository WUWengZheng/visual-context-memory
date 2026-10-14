// Run from an extracted Skill to verify the documented CLI + real HTTP writes.
// All data is a disposable DEMO fixture, never the user's default database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-cli-smoke-'));
const env = { ...process.env, VCM_DB_PATH: path.join(directory, 'demo.db'), VCM_PORT: '0' };
let child;
try {
  const seed = spawnSync(process.execPath, ['src/demo/seed.mjs'], { cwd: root, env, encoding: 'utf8' });
  assert.equal(seed.status, 0, seed.stderr);
  child = spawn(process.execPath, ['src/server/main.mjs'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('CLI did not become ready')), 10000);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`CLI exited early: ${code}`)); });
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      const found = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (found) { clearTimeout(timer); resolve(found[0]); }
    });
  });
  const read = async (route) => {
    const response = await fetch(url + route);
    assert.equal(response.status, 200); return response.json();
  };
  assert.equal((await read('/api/health')).status, 'ok');
  const project = (await read('/api/projects'))[0];
  const page = await read(`/api/memories?project=${project.id}&page=true`);
  const metric = page.items.find((item) => item.currentRevision.subtype === 'metric_observation');
  assert.ok(metric);
  const detail = await read(`/api/memories/${metric.id}`);
  assert.equal(detail.currentRevision.valueKind, 'none');
  const response = await fetch(`${url}/api/memories/${metric.id}/edit`, { method: 'POST',
    headers: { 'content-type': 'application/json', origin: url },
    body: JSON.stringify({ expectedRevisionId: metric.currentRevisionId, changes: { summary: 'Corrected fictional install demo' }, metricObservation: { valueRaw: '65.564' } }),
  });
  assert.equal(response.status, 200);
  const updated = await read(`/api/memories/${metric.id}`);
  assert.equal(updated.metricObservation.valueNumber, 65.564);
  assert.equal(updated.memory.isLocked, true);
  assert.equal((await read(`/api/memories/${metric.id}/revisions`)).length, 2);
  const html = await fetch(url);
  assert.equal(html.status, 200);
  assert.match(await html.text(), /Visual Context Memory/);
  console.log('PASS extracted Skill CLI, scoped reads, Metric edit, immutable history and Viewer assets');
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    const stopped = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM'); await stopped;
  }
  fs.rmSync(directory, { recursive: true, force: true });
}
