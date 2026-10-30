import { ApiError } from './api.mjs';

export function createMemoryExportController({ api, getIdentity, download, onChange = () => {} }) {
  const state = { loading: false, error: null, message: '' };
  let identityKey = '';
  let requestId = 0;
  let cancellation;
  const key = () => JSON.stringify(getIdentity() ?? null);

  function sync() {
    const current = key();
    if (current === identityKey) return;
    identityKey = current;
    requestId++;
    cancellation?.abort();
    Object.assign(state, { loading: false, error: null, message: '' });
  }

  return {
    state, sync,
    async export() {
      sync();
      const identity = getIdentity();
      if (!identity || state.loading) return;
      const expectedKey = identityKey;
      const id = ++requestId;
      cancellation = new AbortController();
      Object.assign(state, { loading: true, error: null, message: 'Preparing saved Revision export…' });
      onChange();
      const current = () => id === requestId && expectedKey === key();
      try {
        const result = await api.exportMemory(identity.memoryId, identity.projectId, cancellation.signal);
        if (!current()) return;
        if (result.memoryId !== identity.memoryId || result.projectId !== identity.projectId
          || result.revisionId !== identity.revisionId) {
          throw new ApiError('The saved Revision changed. Reload details, then export again.',
            { kind: 'client', code: 'REVISION_CHANGED' });
        }
        download(result);
        state.message = 'Markdown download started. Saved Revision only; original sources and notes included.';
      } catch (error) {
        if (current() && error.name !== 'AbortError') {
          state.error = error;
          state.message = '';
        }
      } finally {
        if (current()) {
          state.loading = false;
          onChange();
        }
      }
    },
  };
}

export function downloadMarkdown({ filename, markdown }) {
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
