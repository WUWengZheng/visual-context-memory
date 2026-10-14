import { initialViewerState, buildGraphQuery, buildLibraryQuery } from './state.mjs';

function requestSlot() {
  let sequence = 0;
  let controller;
  return {
    cancel() { sequence++; controller?.abort(); },
    start(identity) {
      this.cancel();
      controller = new AbortController();
      return { id: sequence, identity, signal: controller.signal };
    },
    current(request, identity) {
      return request.id === sequence && !request.signal.aborted && request.identity === identity;
    },
  };
}

export function createViewerController({ api, graph, render = () => {}, guardNavigation = () => true }) {
  const state = {
    ...initialViewerState(), searchResults: [], libraryPage: null, searchPage: null,
    searchLoading: false, detailLoading: false, searchError: null, detailError: null,
    neighborhoodCenterId: null,
  };
  const workspace = requestSlot();
  const search = requestSlot();
  const detail = requestSlot();
  const projects = requestSlot();
  let selectionSequence = 0;
  const queryIdentity = () => JSON.stringify([state.projectId, state.filters]);
  const workspaceIdentity = () => JSON.stringify([queryIdentity(), state.mode, state.depth,
    state.mode === 'neighborhood' ? state.neighborhoodCenterId : null]);
  const searchIdentity = () => JSON.stringify([queryIdentity(), state.search]);
  const detailIdentity = () => JSON.stringify([state.projectId, state.selectedMemoryId]);
  const notify = () => render(state);
  const aborted = (error, request) => request.signal.aborted || error?.name === 'AbortError';

  function restoreGraphState() {
    graph.clearSelection();
    if (state.selectedMemoryId) graph.select(state.selectedMemoryId);
    graph.highlight(state.search ? state.searchResults.map((item) => item.id) : []);
  }

  async function loadWorkspace() {
    const request = workspace.start(workspaceIdentity());
    state.loading = true;
    state.error = null;
    // Capture all parameters before any await.
    const libraryQuery = buildLibraryQuery(state);
    const graphQuery = buildGraphQuery({ ...state, ...state.filters, limit: 200 });
    notify();
    try {
      const [page, payload] = state.projectId
        ? await Promise.all([api.memories(libraryQuery, request.signal), api.graph(graphQuery, request.signal)])
        : [{ items: [], total: 0, truncated: false }, { nodes: [], edges: [], total: 0, truncated: false }];
      if (!workspace.current(request, workspaceIdentity())) return false;
      state.memories = page.items;
      state.libraryPage = page;
      state.graph = payload;
      graph.setGraph(payload);
      restoreGraphState();
      return true;
    } catch (error) {
      if (workspace.current(request, workspaceIdentity()) && !aborted(error, request)) state.error = error;
      return false;
    } finally {
      if (workspace.current(request, workspaceIdentity())) { state.loading = false; notify(); }
    }
  }

  async function runSearch() {
    const request = search.start(searchIdentity());
    const query = buildLibraryQuery(state, { search: true });
    state.searchLoading = Boolean(state.search && state.projectId);
    state.searchError = null;
    notify();
    try {
      const page = state.search && state.projectId
        ? await api.search(query, request.signal)
        : { items: [], total: 0, truncated: false };
      if (!search.current(request, searchIdentity())) return false;
      state.searchResults = page.items;
      state.searchPage = page;
      restoreGraphState();
      return true;
    } catch (error) {
      if (search.current(request, searchIdentity()) && !aborted(error, request)) state.searchError = error;
      return false;
    } finally {
      if (search.current(request, searchIdentity())) { state.searchLoading = false; notify(); }
    }
  }

  // Invalidate on each keystroke, before the debounce window starts.
  function setSearch(value) {
    search.cancel();
    state.search = value.trim();
    state.searchResults = [];
    state.searchPage = null;
    state.searchError = null;
    state.searchLoading = Boolean(state.search);
    restoreGraphState();
    notify();
  }

  function clearSelection() {
    if (!guardNavigation(null)) return false;
    selectionSequence++;
    detail.cancel();
    state.selectedMemoryId = null;
    state.detail = null;
    state.detailLoading = false;
    state.detailError = null;
    graph.clearSelection();
    notify();
  }

  async function selectMemory(id, { ensureGraph = false } = {}) {
    if (id !== state.selectedMemoryId && !guardNavigation(id)) return false;
    const selection = ++selectionSequence;
    detail.cancel();
    state.selectedMemoryId = id;
    state.detail = null;
    state.detailError = null;
    state.detailLoading = true;
    const request = detail.start(detailIdentity());
    notify();
    if ((ensureGraph && !graph.hasNode(id)) || state.mode === 'neighborhood') {
      if (state.mode !== 'neighborhood') state.depth = 1;
      state.mode = 'neighborhood';
      state.neighborhoodCenterId = id;
      await loadWorkspace();
      if (selection !== selectionSequence || !detail.current(request, detailIdentity())) return;
    }
    graph.select(id);
    graph.focus(id);
    try {
      const payload = await api.detail(id, request.signal);
      if (!detail.current(request, detailIdentity()) || selection !== selectionSequence) return;
      state.detail = payload;
    } catch (error) {
      if (detail.current(request, detailIdentity()) && !aborted(error, request)) state.detailError = error;
    } finally {
      if (detail.current(request, detailIdentity()) && selection === selectionSequence) {
        state.detailLoading = false;
        notify();
      }
    }
  }

  function setProject(id) {
    if (id !== state.projectId && !guardNavigation(null)) { notify(); return false; }
    workspace.cancel(); search.cancel(); detail.cancel();
    clearSelection();
    state.projectId = id;
    state.mode = 'project';
    state.neighborhoodCenterId = null;
    state.search = '';
    state.searchResults = [];
    state.searchLoading = false;
    state.searchError = null;
    state.searchPage = null;
    state.memories = [];
    state.libraryPage = null;
    state.graph = null;
    graph.setGraph({ nodes: [], edges: [] });
    return loadWorkspace();
  }

  async function setFilters(filters) {
    search.cancel();
    state.filters = { ...filters };
    state.searchResults = [];
    state.searchPage = null;
    state.memories = [];
    state.libraryPage = null;
    restoreGraphState();
    await Promise.all([loadWorkspace(), runSearch()]);
  }

  async function init() {
    const request = projects.start('projects');
    state.error = null;
    state.loading = true;
    notify();
    try {
      const payload = await api.projects(request.signal);
      if (!projects.current(request, 'projects')) return;
      state.projects = payload;
      await setProject(payload[0]?.id ?? null);
    } catch (error) {
      if (projects.current(request, 'projects') && !aborted(error, request)) {
        state.error = error; state.loading = false; notify();
      }
    }
  }

  async function retry() {
    if (!state.projects.length) return init();
    if (state.detailError && state.selectedMemoryId) await selectMemory(state.selectedMemoryId);
    await Promise.all([loadWorkspace(), runSearch()]);
  }

  async function refreshProjects(preferredProjectId = state.projectId) {
    const startedProject = state.projectId;
    const identity = JSON.stringify([startedProject, preferredProjectId]);
    const request = projects.start(identity);
    const payload = await api.projects(request.signal);
    if (!projects.current(request, identity) || state.projectId !== startedProject) return false;
    state.projects = payload;
    return setProject(payload.some((item) => item.id === preferredProjectId) ? preferredProjectId : payload[0]?.id ?? null);
  }

  function setMode(mode) {
    if (mode === 'project') {
      state.mode = 'project';
      state.neighborhoodCenterId = null;
    } else {
      const center = state.selectedMemoryId ?? state.neighborhoodCenterId;
      if (!center) return false;
      state.mode = 'neighborhood';
      state.neighborhoodCenterId = center;
      state.depth = mode === 'two' ? 2 : 1;
    }
    return loadWorkspace();
  }

  return { state, init, retry, loadWorkspace, runSearch, setSearch, setProject, setMode, refreshProjects,
    setFilters, selectMemory, clearSelection, restoreGraphState };
}
