import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewerController } from '../../viewer/controller.mjs';
import { createEditorController, revisionDiff } from '../../viewer/editor-controller.mjs';
import { createApi } from '../../viewer/api.mjs';

function fixture() {
  const queries = [];
  const graph = { hasNode: () => true, setGraph() {}, clearSelection() {}, select() {}, focus() {}, highlight() {} };
  const api = {
    memories: async () => ({ items: [], total: 0 }),
    graph: async (query) => { queries.push(new URLSearchParams(query)); return { nodes: [], edges: [] }; },
    detail: async (id) => ({ memory: { id }, currentRevision: { id: 'r1', name: 'Old', summary: 'Old' } }),
  };
  const viewer = createViewerController({ api, graph });
  viewer.state.projectId = 'A';
  return { viewer, api, queries };
}

test('2-hop node navigation preserves depth', async () => {
  const { viewer, queries } = fixture();
  viewer.state.mode = 'neighborhood'; viewer.state.depth = 2;
  await viewer.selectMemory('next');
  assert.equal(viewer.state.depth, 2);
  assert.equal(queries.at(-1).get('depth'), '2');
});

test('deselect retains real neighborhood center and subsequent request', async () => {
  const { viewer, queries } = fixture();
  viewer.state.mode = 'neighborhood'; viewer.state.depth = 2;
  await viewer.selectMemory('center');
  viewer.clearSelection(); await viewer.loadWorkspace();
  assert.equal(viewer.state.selectedMemoryId, null);
  assert.equal(viewer.state.neighborhoodCenterId, 'center');
  assert.equal(queries.at(-1).get('memoryId'), 'center');
  assert.equal(queries.at(-1).get('depth'), '2');
});

test('Project mode and project switch clear center without conflating Inspector selection', async () => {
  const { viewer } = fixture();
  await viewer.selectMemory('center'); await viewer.setMode('two');
  viewer.clearSelection();
  await viewer.setMode('one');
  assert.equal(viewer.state.neighborhoodCenterId, 'center');
  await viewer.setMode('project');
  assert.equal(viewer.state.neighborhoodCenterId, null);
  await viewer.selectMemory('next'); await viewer.setMode('two'); await viewer.setProject('B');
  assert.equal(viewer.state.neighborhoodCenterId, null); assert.equal(viewer.state.selectedMemoryId, null);
});

function editorFixture() {
  const { viewer, api } = fixture();
  let discard = false;
  const editor = createEditorController({ api, getContext: () => viewer.state, confirmDiscard: () => discard });
  const detail = { memory: { id: 'M' }, currentRevision: { id: 'r1', name: 'Original', type: 'fact', contextRole: 'reference', summary: 'Original', confidence: 1, valueKind: 'none' } };
  viewer.state.detail = detail; viewer.state.selectedMemoryId = 'M';
  editor.begin(detail); editor.change('summary', 'Draft');
  return { viewer, api, editor, detail, allowDiscard: () => { discard = true; } };
}

test('draft survives search/workspace render, and navigation requires explicit discard', async () => {
  const c = editorFixture();
  c.viewer.setSearch('needle'); await c.viewer.loadWorkspace();
  assert.equal(c.editor.state.draft.summary, 'Draft');
  assert.equal(c.editor.canLeave(), false); assert.equal(c.editor.state.dirty, true);
  c.allowDiscard(); assert.equal(c.editor.canLeave(), true); assert.equal(c.editor.state.draft, null);
});

test('failed save retains draft and expected Revision; duplicate writes blocked deterministically', async () => {
  const c = editorFixture(); let reject, resolve, submitted, count = 0;
  c.api.write = (path, body) => { submitted = body; count++; return new Promise((yes, no) => { resolve = yes; reject = no; }); };
  const first = c.editor.save();
  assert.equal(await c.editor.save(), false); assert.equal(count, 1);
  assert.equal(submitted.expectedRevisionId, 'r1');
  reject(new Error('Validation failed')); await first;
  assert.equal(c.editor.state.draft.summary, 'Draft'); assert.equal(c.editor.state.dirty, true);
  assert.equal(c.editor.state.saveError.message, 'Validation failed');
  const second = c.editor.save(); resolve({ createdRevision: { id: 'r2' } }); await second;
  assert.equal(c.editor.state.draft, null); assert.match(c.editor.state.message, /Old revisions/);
});

test('uncertain write is never blindly retried; reconciliation only reads', async () => {
  const c = editorFixture(); let calls = 0;
  c.api.write = async () => { calls++; throw Object.assign(new Error('Unknown'), { uncertain: true }); };
  await c.editor.save(); await c.editor.save();
  assert.equal(calls, 1); assert.equal(c.editor.state.uncertain, true);
  c.api.revisions = async () => []; c.api.conflicts = async () => [];
  await c.editor.reconcile(); assert.equal(calls, 1); assert.equal(c.editor.state.draft.summary, 'Draft');
});

test('write API marks transport interruption as uncertain instead of a safe retry', async () => {
  const api = createApi(async () => { throw new TypeError('lost response'); });
  await assert.rejects(api.write('/api/memories/M/edit', {}), (error) => error.uncertain === true && /may have saved/.test(error.message));
});

test('field-level diff reports semantic and Metric changes', () => {
  const changes = revisionDiff({ name: 'Old', summary: 'Same', metricObservation: { valueNumber: 1, valueRaw: '1' } },
    { name: 'New', summary: 'Same', metricObservation: { valueNumber: 2, valueRaw: '2' } });
  assert.ok(changes.some((change) => change.field === 'name' && change.before === 'Old' && change.after === 'New'));
  assert.ok(changes.some((change) => change.field === 'metricObservation.valueNumber' && change.before === 1 && change.after === 2));
  assert.ok(!changes.some((change) => change.field === 'summary'));
});
