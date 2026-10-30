export class ApiError extends Error {
  constructor(message, { kind, status = null, code = null, details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    Object.assign(this, { kind, status, code, details });
  }
}

export function createApi(fetcher = (...args) => fetch(...args)) {
  async function request(path, signal, bodyInput) {
    let response;
    let text;
    try {
      response = await fetcher(path, bodyInput === undefined ? { signal } : {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(bodyInput),
      });
      text = await response.text();
    } catch (error) {
      if (error.name === 'AbortError' || signal?.aborted) throw error;
      const failure = new ApiError(bodyInput === undefined ? 'Cannot reach the local server.'
        : 'Write outcome unknown. The server may have saved it. Refresh and inspect history before any new submission.', { kind: 'network' });
      failure.uncertain = bodyInput !== undefined;
      throw failure;
    }
    let body;
    try { body = JSON.parse(text); } catch { body = null; }
    if (!response.ok) {
      const failure = new ApiError(body?.error?.message ?? (text || `HTTP ${response.status}`), {
        kind: 'http', status: response.status,
        code: body?.error?.code ?? null, details: body?.error?.details ?? null,
      });
      failure.uncertain = bodyInput !== undefined && response.status >= 500;
      if (failure.uncertain) failure.message += ' Write outcome may be unknown. Review Current and history; do not blindly retry.';
      throw failure;
    }
    if (body === null) {
      const failure = new ApiError('The server returned invalid JSON.', { kind: 'protocol', status: response.status });
      failure.uncertain = bodyInput !== undefined;
      throw failure;
    }
    return body;
  }
  return {
    projects: (signal) => request('/api/projects', signal),
    memories: (query, signal) => request(`/api/memories?${query}`, signal),
    graph: (query, signal) => request(`/api/graph?${query}`, signal),
    search: (query, signal) => request(`/api/search?${query}`, signal),
    recall: (query, signal) => request(`/api/recall?${query}`, signal),
    detail: (id, signal) => request(`/api/memories/${encodeURIComponent(id)}`, signal),
    exportMemory: (id, projectId, signal) => request(
      `/api/memories/${encodeURIComponent(id)}/export?project=${encodeURIComponent(projectId)}`, signal),
    revisions: (id, signal) => request(`/api/memories/${encodeURIComponent(id)}/revisions?includeObservation=true`, signal),
    conflicts: (projectId, signal) => request(`/api/conflicts?project=${encodeURIComponent(projectId)}`, signal),
    matches: (id, query, signal) => request(`/api/memories/${encodeURIComponent(id)}/matches?${query}`, signal),
    write: (path, body = {}) => request(path, undefined, body),
  };
}

export const api = createApi();

export function errorMessage(error) {
  if (error?.kind === 'network') return 'Server disconnected. Start the local server and retry.';
  return `${error?.code ? `${error.code}: ` : ''}${error?.message ?? 'Request failed'}`;
}
