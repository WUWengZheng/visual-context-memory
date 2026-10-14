import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGraphQuery, clampNeighborhoodDepth, initialViewerState } from '../../viewer/state.mjs';
import { toCytoscapeElements, nodeClasses } from '../../viewer/graph.mjs';
import { formatDetail } from '../../viewer/components/memory-inspector.mjs';

test('Graph API data becomes Cytoscape nodes and directed edges', () => {
  const elements = toCytoscapeElements({
    nodes: [{ id: 'm-1', name: 'Stage2B', type: 'entity', subtype: 'experiment', contextRole: 'current_plan', importance: 'high', lifecycleStatus: 'active', verificationStatus: 'user_confirmed', locked: false, pinned: true }],
    edges: [{ id: 'r-1', source: 'm-1', target: 'm-2', relationType: 'uses' }],
  });
  assert.deepEqual(elements.nodes[0].data, { id: 'm-1', label: 'Stage2B' });
  assert.deepEqual(elements.edges[0].data, { id: 'r-1', source: 'm-1', target: 'm-2', label: 'uses' });
});

test('type, lock, pin, and lifecycle are exposed as accessible node classes', () => {
  assert.deepEqual(nodeClasses({ type: 'constraint', locked: true, pinned: true, lifecycleStatus: 'outdated' }).split(' ').sort(), ['is-locked', 'is-outdated', 'is-pinned', 'type-constraint']);
});

test('graph query keeps project filtering and bounds neighborhood depth', () => {
  assert.equal(buildGraphQuery({ projectId: 'p-1', mode: 'neighborhood', selectedMemoryId: 'm-1', depth: 4, type: 'fact', status: 'active', limit: 100 }), 'project=p-1&memoryId=m-1&depth=2&limit=100&type=fact&status=active');
  assert.equal(clampNeighborhoodDepth(0), 1);
  assert.equal(clampNeighborhoodDepth(2), 2);
});

test('initial Viewer state represents an empty, read-only project workspace', () => {
  assert.deepEqual(initialViewerState(), {
    projectId: null, projects: [], memories: [], graph: null, selectedMemoryId: null, detail: null,
    mode: 'project', depth: 1, filters: { type: '', status: '', locked: false, pinned: false }, search: '', loading: false, error: null,
  });
});

test('Inspector formatter hides absent fields and preserves source, relation, note, and metric structure', () => {
  const formatted = formatDetail({
    memory: { lifecycleStatus: 'active', verificationStatus: 'user_confirmed', importance: 'high', isLocked: true, isPinned: false, createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:00:00.000Z' },
    currentRevision: { name: 'Stage1 Clean mIoU', type: 'fact', subtype: 'metric_observation', contextRole: 'baseline', summary: 'A result.', description: null, valueKind: 'none' },
    sources: [{ sourceType: 'experiment_log', originalText: '65.433' }], relations: [{ direction: 'outgoing', relationType: 'evaluated_on', targetMemoryId: 'dataset' }], notes: [{ content: 'Epoch57.' }], metricObservation: { metricName: 'Clean mIoU', valueNumber: 65.433, split: 'validation' }, revisionCount: 1,
  });
  assert.equal(formatted.fields.some((field) => field.label === 'Description'), false);
  assert.equal(formatted.metric[0].value, 'Clean mIoU');
  assert.equal(formatted.sources[0].excerpt, '65.433');
});
