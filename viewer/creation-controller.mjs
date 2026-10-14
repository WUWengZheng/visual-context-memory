export function createCreationController({ api, getContext, onChange = () => {}, onCreated = async () => {},
  onReconcile = async () => [], confirmDiscard = () => false }) {
  const state = { open: false, kind: null, projectId: null, draft: null, dirty: false,
    saving: false, error: null, uncertain: false, reconciling: false, records: null, message: '' };
  const notify = () => onChange(state);

  function close() {
    if (state.saving || state.reconciling) return false;
    if ((state.dirty || state.uncertain) && !confirmDiscard()) return false;
    state.open = false; notify(); return true;
  }
  function open(kind) {
    if (!['memory', 'project'].includes(kind)) return false;
    if (state.saving || state.reconciling) return false;
    if (state.open && !close()) return false;
    if (kind === 'memory' && !getContext().projectId) return false;
    Object.assign(state, { open: true, kind, projectId: getContext().projectId,
      draft: { name: '', summary: '', type: 'fact', description: '' }, dirty: false,
      saving: false, error: null, uncertain: false, records: null, message: '' });
    notify(); return true;
  }
  function change(field, value) {
    if (state.saving || state.reconciling) return;
    state.draft[field] = value; state.dirty = true; state.error = null; notify();
  }
  async function submit() {
    if (!state.open || state.saving || state.uncertain || state.reconciling) return false;
    const identity = { kind: state.kind, projectId: state.projectId };
    const draft = { ...state.draft };
    const body = identity.kind === 'project' ? { name: draft.name } : {
      projectId: identity.projectId, name: draft.name, summary: draft.summary, type: draft.type,
      description: draft.description || null,
    };
    state.saving = true; state.error = null; notify();
    try {
      const result = await api.write(identity.kind === 'project' ? '/api/projects' : '/api/memories', body);
      state.dirty = false; state.open = false;
      state.message = identity.kind === 'project' ? 'Project created. Add your first memory.' : 'Memory created. Revision 1 and your original text are preserved.';
      try { await onCreated(result, identity); }
      catch (error) { state.message += ` Saved, but refresh failed: ${error.message}`; }
      return result;
    } catch (error) { state.error = error; state.uncertain = Boolean(error.uncertain); return false; }
    finally { state.saving = false; notify(); }
  }
  async function reconcile() {
    if (state.saving || state.reconciling) return;
    state.reconciling = true; notify();
    try {
      state.records = await onReconcile({ kind: state.kind, projectId: state.projectId, draft: { ...state.draft } });
      state.message = 'Read current records below. Names are not unique; inspect identity before discarding this form. No write was retried.';
    } catch (error) { state.error = error; }
    finally { state.reconciling = false; notify(); }
  }
  return { state, open, close, change, submit, reconcile };
}
