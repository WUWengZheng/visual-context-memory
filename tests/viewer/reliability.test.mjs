import assert from 'node:assert/strict';
import test from 'node:test';
import { createViewerController } from '../../viewer/controller.mjs';
import { visibleLibrary } from '../../viewer/state.mjs';
import { createApi, errorMessage } from '../../viewer/api.mjs';
import { graphNodeLabel } from '../../viewer/graph.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const calls = { memories: [], graph: [], search: [], detail: [] };
  const api = Object.fromEntries(Object.keys(calls).map((name) => [name, (query, signal) => {
    const result = deferred();
    calls[name].push({ query, signal, ...result });
    // Deliberately ignore abort to test stale-response checks independently.
    return result.promise;
  }]));
  const interactions = [];
  const graph = {
    hasNode: () => true, setGraph: (data) => interactions.push(['graph', data]),
    clearSelection() {}, select: (id) => interactions.push(['select', id]),
    focus: (id) => interactions.push(['focus', id]), highlight: (ids) => interactions.push(['highlight', ids]),
  };
  const viewer = createViewerController({ api, graph });
  viewer.state.projectId = 'A';
  return { viewer, calls, graph, interactions };
}
const page = (ids) => ({ items: ids.map((id) => ({ id })), total: ids.length, truncated: false });
const payload = (ids) => ({ nodes: ids.map((id) => ({ id })), edges: [], total: ids.length });
function resolveWorkspace(calls, index, ids) {
  calls.memories[index].resolve(page(ids)); calls.graph[index].resolve(payload(ids));
}

test('search results stay in Viewer State through selection and deselection', async () => {
  const { viewer, calls } = fixture();
  viewer.state.memories = [{ id: 'normal' }];
  viewer.setSearch('needle');
  const search = viewer.runSearch(); calls.search[0].resolve(page(['result'])); await search;
  const selected = viewer.selectMemory('result'); calls.detail[0].resolve({ memory: { id: 'result' } }); await selected;
  assert.deepEqual(visibleLibrary(viewer.state).map((item) => item.id), ['result']);
  viewer.clearSelection();
  assert.equal(viewer.state.search, 'needle');
  assert.deepEqual(visibleLibrary(viewer.state).map((item) => item.id), ['result']);
  viewer.setSearch('');
  assert.deepEqual(visibleLibrary(viewer.state).map((item) => item.id), ['normal']);
});

test('late detail cannot restore a cleared selection', async () => {
  const { viewer, calls } = fixture();
  const selected = viewer.selectMemory('old');
  viewer.clearSelection();
  assert.equal(calls.detail[0].signal.aborted, true);
  calls.detail[0].resolve({ memory: { id: 'old' } }); await selected;
  assert.equal(viewer.state.detail, null);
  assert.equal(viewer.state.selectedMemoryId, null);
  assert.equal(viewer.state.detailLoading, false);
});

test('new selection wins even when the older detail ignores cancellation', async () => {
  const { viewer, calls } = fixture();
  const old = viewer.selectMemory('old');
  const latest = viewer.selectMemory('latest');
  calls.detail[1].resolve({ memory: { id: 'latest' } }); await latest;
  calls.detail[0].resolve({ memory: { id: 'old' } }); await old;
  assert.equal(viewer.state.detail.memory.id, 'latest');
  assert.equal(viewer.state.detailLoading, false);
});

test('project switch invalidates outstanding search and detail together', async () => {
  const { viewer, calls } = fixture();
  viewer.setSearch('needle'); const oldSearch = viewer.runSearch();
  const oldDetail = viewer.selectMemory('old');
  const current = viewer.setProject('B');
  assert.ok(calls.search[0].signal.aborted);
  assert.ok(calls.detail[0].signal.aborted);
  calls.search[0].resolve(page(['old']));
  calls.detail[0].resolve({ memory: { id: 'old' } });
  await Promise.all([oldSearch, oldDetail]);
  resolveWorkspace(calls, 0, ['B']); await current;
  assert.deepEqual(viewer.state.searchResults, []);
  assert.equal(viewer.state.detail, null);
  assert.equal(viewer.state.selectedMemoryId, null);
});

test('slow project A cannot overwrite project B or finish B loading', async () => {
  const { viewer, calls } = fixture();
  const a = viewer.loadWorkspace();
  viewer.setSearch('old project');
  const b = viewer.setProject('B');
  resolveWorkspace(calls, 0, ['A']); await a;
  assert.equal(viewer.state.loading, true);
  assert.equal(viewer.state.graph, null);
  resolveWorkspace(calls, 1, ['B']); await b;
  assert.deepEqual(viewer.state.memories.map((item) => item.id), ['B']);
  assert.equal(viewer.state.search, '');
  assert.equal(viewer.state.loading, false);
});

test('old search cannot overwrite a new keyword even during debounce', async () => {
  const { viewer, calls } = fixture();
  viewer.setSearch('old'); const old = viewer.runSearch();
  viewer.setSearch('new');
  calls.search[0].resolve(page(['old'])); await old;
  assert.deepEqual(viewer.state.searchResults, []);
  assert.equal(viewer.state.searchLoading, true);
  const latest = viewer.runSearch(); calls.search[1].resolve(page(['new'])); await latest;
  assert.deepEqual(viewer.state.searchResults.map((item) => item.id), ['new']);
});

test('search identity includes every filter and graph reload restores search highlighting', async () => {
  const { viewer, calls, interactions } = fixture();
  viewer.setSearch('needle'); const old = viewer.runSearch();
  const filters = viewer.setFilters({ type: 'fact', status: 'active', locked: true, pinned: true });
  const query = new URLSearchParams(calls.search[1].query);
  for (const [key, value] of Object.entries({ project: 'A', q: 'needle', type: 'fact', status: 'active', locked: 'true', pinned: 'true' })) {
    assert.equal(query.get(key), value);
  }
  calls.search[1].resolve(page(['hit'])); resolveWorkspace(calls, 0, ['hit']); await filters;
  calls.search[0].resolve(page(['stale'])); await old;
  assert.deepEqual(viewer.state.searchResults.map((item) => item.id), ['hit']);
  assert.deepEqual(interactions.filter(([action]) => action === 'highlight').at(-1)[1], ['hit']);
});

test('quick selections requiring separate neighborhoods keep only the latest selection', async () => {
  const { viewer, calls, graph, interactions } = fixture();
  graph.hasNode = () => false;
  const a = viewer.selectMemory('a', { ensureGraph: true });
  const b = viewer.selectMemory('b', { ensureGraph: true });
  resolveWorkspace(calls, 1, ['b']);
  // Drain microtasks to reach the detail call, not an arbitrary timer.
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(calls.detail.length, 1);
  assert.equal(calls.detail[0].query, 'b');
  calls.detail[0].resolve({ memory: { id: 'b' } }); await b;
  resolveWorkspace(calls, 0, ['a']); await a;
  assert.equal(viewer.state.selectedMemoryId, 'b');
  assert.equal(viewer.state.detail.memory.id, 'b');
  assert.equal(calls.detail.length, 1);
  assert.ok(!interactions.some(([action, id]) => action === 'focus' && id === 'a'));
});

test('AbortError is silent and stale finally does not clear newer search loading', async () => {
  const { viewer, calls } = fixture();
  viewer.setSearch('a'); const a = viewer.runSearch();
  viewer.setSearch('b'); const b = viewer.runSearch();
  calls.search[0].reject(new DOMException('aborted', 'AbortError')); await a;
  assert.equal(viewer.state.searchLoading, true);
  assert.equal(viewer.state.searchError, null);
  calls.search[1].resolve(page([])); await b;
  assert.equal(viewer.state.searchLoading, false);
});

test('selecting a known node during a pending neighborhood replaces that request', async () => {
  const { viewer, calls, graph } = fixture();
  graph.hasNode = (id) => id === 'known';
  const first = viewer.selectMemory('missing', { ensureGraph: true });
  const latest = viewer.selectMemory('known');
  assert.equal(calls.graph.length, 2);
  resolveWorkspace(calls, 1, ['known']);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  calls.detail[0].resolve({ memory: { id: 'known' } }); await latest;
  resolveWorkspace(calls, 0, ['missing']); await first;
  assert.equal(viewer.state.loading, false);
  assert.equal(viewer.state.detail.memory.id, 'known');
});

test('Locked, Pinned and lifecycle remain textual graph markers together', () => {
  const label = graphNodeLabel({ name: 'needle', locked: true, pinned: true, lifecycleStatus: 'outdated' });
  assert.match(label, /Locked/); assert.match(label, /Pinned/); assert.match(label, /outdated/);
});

test('API distinguishes domain HTTP, non-JSON HTTP, network and cancellation', async () => {
  const domain = createApi(async () => new Response(JSON.stringify({ error: { code: 'PROJECT_REQUIRED', message: 'Choose project', details: { field: 'project' } } }), { status: 400 }));
  await assert.rejects(domain.projects(), (error) => error.kind === 'http' && error.status === 400 && error.code === 'PROJECT_REQUIRED' && error.details.field === 'project' && error.message === 'Choose project');
  const text = createApi(async () => new Response('Maintenance', { status: 503 }));
  await assert.rejects(text.projects(), (error) => error.status === 503 && error.message === 'Maintenance' && !errorMessage(error).includes('disconnected'));
  const network = createApi(async () => { throw new TypeError('fetch failed'); });
  await assert.rejects(network.projects(), (error) => error.kind === 'network');
  const cancelled = createApi(async () => { throw new DOMException('cancelled', 'AbortError'); });
  await assert.rejects(cancelled.projects(), { name: 'AbortError' });
});
