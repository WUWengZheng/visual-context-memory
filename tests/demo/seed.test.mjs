import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { seedDemo } from '../../src/demo/seed.mjs';
import { VisualContextMemoryStore } from '../../src/db/store.mjs';
import { MemoryService } from '../../src/services/memory-service.mjs';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-demo-install-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, 'demo.db');
}

test('CLI demo honors explicit database path and remains idempotent', (t) => {
  const dbPath = fixture(t);
  const run = () => spawnSync(process.execPath, ['src/demo/seed.mjs'], {
    cwd: path.resolve(import.meta.dirname, '../..'), encoding: 'utf8',
    env: { ...process.env, VCM_DB_PATH: dbPath },
  });
  assert.equal(run().status, 0);
  assert.ok(fs.existsSync(dbPath));
  assert.equal(run().status, 0);
  const store = new VisualContextMemoryStore({ dbPath });
  try { assert.equal(store.listProjects().length, 1); }
  finally { store.close(); }
});

test('demo Metric supports actual versioned editing with preserved observation scope', (t) => {
  const dbPath = fixture(t), seeded = seedDemo({ dbPath });
  const store = new VisualContextMemoryStore({ dbPath });
  try {
    const metric = seeded.memories.metric;
    assert.equal(metric.currentRevision.valueKind, 'none');
    const result = new MemoryService(store).editMemory(metric.id, metric.createdByActorId, { summary: 'Corrected fictional demo' }, {
      expectedRevisionId: metric.currentRevisionId, metricObservation: { valueRaw: '65.564' },
    });
    const observation = store.getMetricObservation(result.createdRevision.id);
    assert.equal(observation.valueNumber, 65.564);
    assert.equal(observation.subjectMemoryId, seeded.memories.stage1.id);
    assert.equal(observation.runLabel, 'stage1-clean');
    assert.equal(store.getMemory(metric.id).isLocked, true);
    assert.equal(store.getRevisionHistory(metric.id).length, 2);
  } finally { store.close(); }
});
