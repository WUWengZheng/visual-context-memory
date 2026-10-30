import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryExportController } from '../../viewer/export-controller.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('late export cannot download an old selection or clear a newer export loading state', async () => {
  const a = deferred(), b = deferred(), downloaded = [];
  let identity = { projectId: 'p', memoryId: 'a', revisionId: 'r1' };
  const controller = createMemoryExportController({
    api: { exportMemory: (id) => id === 'a' ? a.promise : b.promise },
    getIdentity: () => identity, download: (result) => downloaded.push(result.memoryId),
  });
  const old = controller.export();
  identity = { projectId: 'p', memoryId: 'b', revisionId: 'r2' };
  controller.sync();
  const next = controller.export();
  a.resolve({ memoryId: 'a', projectId: 'p', revisionId: 'r1' });
  await old;
  assert.deepEqual(downloaded, []);
  assert.equal(controller.state.loading, true);
  b.resolve({ memoryId: 'b', projectId: 'p', revisionId: 'r2' });
  await next;
  assert.deepEqual(downloaded, ['b']);
  assert.equal(controller.state.loading, false);
});

test('export refuses a different server Revision and preserves a specific retryable read error', async () => {
  const downloaded = [];
  const identity = { projectId: 'p', memoryId: 'a', revisionId: 'r1' };
  let response = { ...identity, revisionId: 'r2' };
  const controller = createMemoryExportController({
    api: { exportMemory: async () => response }, getIdentity: () => identity,
    download: (result) => downloaded.push(result),
  });
  await controller.export();
  assert.equal(controller.state.error.code, 'REVISION_CHANGED');
  assert.deepEqual(downloaded, []);
  response = identity;
  await controller.export();
  assert.equal(controller.state.error, null);
  assert.equal(downloaded.length, 1);
});

test('export blocks duplicate requests and clears aborted project-specific feedback', async () => {
  const pending = deferred();
  let calls = 0;
  let identity = { projectId: 'p', memoryId: 'a', revisionId: 'r1' };
  const controller = createMemoryExportController({
    api: { exportMemory: () => { calls++; return pending.promise; } },
    getIdentity: () => identity, download: () => assert.fail('No old-project download'),
  });
  const first = controller.export();
  await controller.export();
  assert.equal(calls, 1);
  identity = { projectId: 'other', memoryId: 'b', revisionId: 'r2' };
  controller.sync();
  pending.reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' }));
  await first;
  assert.equal(controller.state.loading, false);
  assert.equal(controller.state.error, null);
  assert.equal(controller.state.message, '');
});
