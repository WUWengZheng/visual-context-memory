export function clampNeighborhoodDepth(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(2, Math.max(1, Math.trunc(parsed))) : 1;
}

export function initialViewerState() {
  return {
    projectId: null, projects: [], memories: [], graph: null, selectedMemoryId: null, detail: null,
    mode: 'project', depth: 1, filters: { type: '', status: '', locked: false, pinned: false }, search: '', loading: false, error: null,
  };
}

export function buildGraphQuery({ projectId, mode = 'project', selectedMemoryId = null, neighborhoodCenterId = selectedMemoryId, depth = 1, type = '', status = '', locked = false, pinned = false, limit = 100 }) {
  const params = new URLSearchParams({ project: projectId });
  if (mode === 'neighborhood' && neighborhoodCenterId) {
    params.set('memoryId', neighborhoodCenterId);
    params.set('depth', String(clampNeighborhoodDepth(depth)));
  }
  const boundedLimit = Math.min(200, Math.max(1, Math.trunc(Number(limit) || 100)));
  params.set('limit', String(boundedLimit));
  if (type) params.set('type', type);
  if (status) params.set('status', status);
  if (locked) params.set('locked', 'true');
  if (pinned) params.set('pinned', 'true');
  return params.toString();
}

export function buildLibraryQuery(state, { search = false } = {}) {
  const params = new URLSearchParams({ project: state.projectId, limit: '100', page: 'true' });
  const { type, status, locked, pinned } = state.filters;
  if (type) params.set('type', type);
  if (status) params.set('status', status);
  if (locked) params.set('locked', 'true');
  if (pinned) params.set('pinned', 'true');
  if (search) params.set('q', state.search);
  return params.toString();
}

export function visibleLibrary(state) {
  return state.search ? state.searchResults : state.memories;
}

export function filterByFlags(items, { locked, pinned }) {
  return items.filter((item) => (!locked || item.locked || item.isLocked) && (!pinned || item.pinned || item.isPinned));
}

export function debounce(callback, delay = 320) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delay);
  };
}
