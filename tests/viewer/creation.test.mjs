import test from 'node:test';
import assert from 'node:assert/strict';
import { createCreationController } from '../../viewer/creation-controller.mjs';
import { createViewerController } from '../../viewer/controller.mjs';

test('creation captures project identity, retains failed draft and blocks duplicate or uncertain submissions', async () => {
  let resolve, reject, calls = 0, payload, submitted;
  const context = { projectId: 'A' };
  const creator = createCreationController({
    api: { write: (route, body) => { calls++; payload = body; return new Promise((yes, no) => { resolve = yes; reject = no; }); } },
    getContext: () => context, onCreated: async (result, identity) => { submitted = identity; },
  });
  creator.open('memory'); creator.change('name', 'Draft'); creator.change('summary', 'Keep me');
  const first = creator.submit(); context.projectId = 'B';
  assert.equal(await creator.submit(), false); assert.equal(calls, 1); assert.equal(payload.projectId, 'A');
  reject(new Error('Validation failed')); await first;
  assert.equal(creator.state.draft.summary, 'Keep me');
  const second = creator.submit(); resolve({ affectedMemories: [{ id: 'M' }] }); await second;
  assert.equal(submitted.projectId, 'A'); assert.equal(creator.state.open, false);
  creator.open('memory'); creator.change('name', 'Unknown'); creator.change('summary', 'Unknown outcome');
  const third = creator.submit(); reject(Object.assign(new Error('Response lost'), { uncertain: true })); await third;
  assert.equal(creator.state.uncertain, true); assert.equal(await creator.submit(), false); assert.equal(calls, 3);
  assert.equal(creator.close(), false); assert.equal(creator.state.draft.name, 'Unknown');
});

test('late creation project refresh cannot replace a user-selected project', async () => {
  let resolve;
  const api = {
    projects: () => new Promise((yes) => { resolve = yes; }),
    memories: async () => ({ items: [], total: 0 }), graph: async () => ({ nodes: [], edges: [] }),
  };
  const graph = { setGraph() {}, clearSelection() {}, select() {}, highlight() {} };
  const viewer = createViewerController({ api, graph });
  viewer.state.projectId = 'A';
  const refresh = viewer.refreshProjects('Created');
  await viewer.setProject('B');
  resolve([{ id: 'A' }, { id: 'B' }, { id: 'Created' }]);
  assert.equal(await refresh, false);
  assert.equal(viewer.state.projectId, 'B');
});
