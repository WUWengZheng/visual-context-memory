export function revisionDiff(before, after) {
  const fields = ['name', 'type', 'subtype', 'contextRole', 'summary', 'description', 'confidence',
    'valueKind', 'valueText', 'valueNumber', 'valueBoolean', 'valueJson', 'unit'];
  const changes = fields.filter((field) => before?.[field] !== after?.[field])
    .map((field) => ({ field, before: before?.[field] ?? null, after: after?.[field] ?? null }));
  for (const field of ['valueNumber', 'valueRaw', 'unit', 'datasetMemoryId', 'split', 'protocol', 'runLabel', 'checkpoint']) {
    const oldValue = before?.metricObservation?.[field] ?? null;
    const newValue = after?.metricObservation?.[field] ?? null;
    if (oldValue !== newValue) changes.push({ field: `metricObservation.${field}`, before: oldValue, after: newValue });
  }
  return changes;
}

export function createEditorController({ api, getContext, onChange = () => {}, onSaved = async () => {}, confirmDiscard = () => false }) {
  const empty = () => ({ memoryId: null, initialRevisionId: null, draft: null, dirty: false,
    saving: false, saveError: null, uncertain: false });
  const state = { ...empty(), message: '', preview: null, auxiliary: null, auxiliaryError: null, auxiliaryLoading: false };
  let original = '', auxiliarySequence = 0, actionSequence = 0;
  const notify = () => onChange(state);

  function canLeave() {
    if (state.saving) { state.message = 'Wait for the current write to finish.'; notify(); return false; }
    if ((state.dirty || state.uncertain) && !confirmDiscard()) return false;
    Object.assign(state, empty()); state.preview = null; notify(); return true;
  }

  function begin(detail) {
    if (!detail || !canLeave()) return false;
    const r = detail.currentRevision;
    const draft = Object.fromEntries(['name', 'type', 'subtype', 'contextRole', 'summary', 'description', 'confidence', 'valueKind', 'unit']
      .map((field) => [field, r[field] ?? '']));
    const values = { text: r.valueText, number: r.valueNumber, boolean: r.valueBoolean, json: r.valueJson };
    draft.value = r.valueKind === 'json' ? values.json : String(values[r.valueKind] ?? '');
    draft.metricValueRaw = detail.metricObservation?.valueRaw ?? '';
    if (detail.metricObservation) draft.unit = detail.metricObservation.unit ?? '';
    draft.changeReason = '';
    Object.assign(state, empty(), { memoryId: detail.memory.id, initialRevisionId: r.id, draft, message: '', preview: null });
    original = JSON.stringify(draft); notify(); return true;
  }

  function change(field, value) {
    if (!state.draft || state.saving) return;
    state.draft[field] = value;
    state.dirty = JSON.stringify(state.draft) !== original;
    state.saveError = null; notify();
  }

  async function write(path, body, message, { closeDraft = false } = {}) {
    if (state.saving || state.uncertain) return false;
    const action = ++actionSequence;
    state.saving = true; state.saveError = null; state.message = ''; notify();
    try {
      const result = await api.write(path, body);
      if (closeDraft) Object.assign(state, empty(), { saving: true });
      state.preview = null;
      state.message = message;
      // A refresh failure is not a failed write: it must not invite resubmission.
      try { await onSaved(result); } catch (error) { state.message += ` Saved, but refresh failed: ${error.message}`; }
      return result;
    } catch (error) {
      state.saveError = error;
      state.uncertain = Boolean(error.uncertain);
      if (error.code === 'PREVIEW_STALE') state.preview = null;
      return false;
    } finally { if (action === actionSequence) { state.saving = false; notify(); } }
  }

  async function save() {
    if (!state.draft || !state.dirty || state.saving || state.uncertain) return false;
    const d = state.draft;
    let value;
    try {
      if (d.valueKind === 'number') { value = Number(d.value); if (!d.value.trim() || !Number.isFinite(value)) throw new Error('Value must be a finite number'); }
      if (d.valueKind === 'boolean') { if (!['true', 'false'].includes(d.value)) throw new Error('Boolean value must be true or false'); value = d.value === 'true'; }
      if (d.valueKind === 'json') value = JSON.parse(d.value);
      if (d.valueKind === 'text') value = d.value;
    } catch (error) { state.saveError = error; notify(); return false; }
    const changes = Object.fromEntries(['name', 'type', 'subtype', 'contextRole', 'summary', 'description', 'unit', 'changeReason']
      .map((field) => [field, d[field] === '' && ['subtype', 'description', 'unit', 'changeReason'].includes(field) ? null : d[field]]));
    Object.assign(changes, { confidence: Number(d.confidence), valueKind: d.valueKind });
    if (d.valueKind !== 'none') changes.value = value;
    const body = { changes, expectedRevisionId: state.initialRevisionId };
    if (getContext().detail?.metricObservation) {
      changes.unit = null;
      body.metricObservation = { valueRaw: d.metricValueRaw, unit: d.unit || null };
    }
    return write(`/api/memories/${encodeURIComponent(state.memoryId)}/edit`, body,
      'New Revision created. Old revisions and sources preserved.', { closeDraft: true });
  }

  async function loadAuxiliary({ offset = 0 } = {}) {
    const context = getContext();
    const projectId = context.projectId, id = context.selectedMemoryId;
    const sequence = ++auxiliarySequence;
    state.auxiliaryLoading = true; state.auxiliaryError = null;
    try {
      const [revisions, conflicts, candidates] = await Promise.all([
        id ? api.revisions(id) : [], api.conflicts(projectId),
        api.memories(new URLSearchParams({ project: projectId, page: 'true', limit: '100', offset: String(offset) }).toString()),
      ]);
      if (sequence !== auxiliarySequence || getContext().projectId !== projectId || getContext().selectedMemoryId !== id) return;
      state.auxiliary = { id, projectId, revisions, conflicts, candidates, offset };
    } catch (error) { if (sequence === auxiliarySequence) state.auxiliaryError = error; }
    finally { if (sequence === auxiliarySequence) { state.auxiliaryLoading = false; notify(); } }
  }

  async function preview(plan) {
    if (state.saving || state.uncertain || !canLeave()) return false;
    state.saving = true; state.saveError = null; state.preview = null; notify();
    try { state.preview = await api.write('/api/editor/preview', { ...plan, projectId: getContext().projectId }); return state.preview; }
    catch (error) { state.saveError = error; return false; }
    finally { state.saving = false; notify(); }
  }

  async function execute() {
    if (!state.preview) return false;
    return write('/api/editor/execute', { previewId: state.preview.previewId }, 'Operation completed. History and sources preserved.');
  }

  function action(operation, body = {}) {
    if (state.uncertain) { state.message = 'Refresh Current and history before discarding the uncertain write state and starting a new operation.'; notify(); return false; }
    if (!canLeave()) return false;
    const id = getContext().selectedMemoryId;
    if (!id) return false;
    return write(`/api/memories/${encodeURIComponent(id)}/${operation}`, body,
      operation === 'outdated' ? 'Memory marked outdated.' : `Memory ${operation} completed.`);
  }

  function addNote(content) { return action('notes', { content }); }
  function deleteNote(id) {
    if (state.uncertain) return false;
    if (!canLeave()) return false;
    return write(`/api/notes/${encodeURIComponent(id)}/delete`, {}, 'Note soft-deleted. Audit preserved.');
  }

  async function reconcile() {
    // Reads only. Never repeats an interrupted POST.
    try {
      await onSaved(null);
      await loadAuxiliary();
      state.message = 'Refreshed after uncertain write. Review Current Revision, history and notes. Discard the old draft and begin a new edit if needed.';
    } catch (error) { state.saveError = error; }
    notify();
  }

  return { state, begin, change, save, canLeave, action, addNote, deleteNote, loadAuxiliary, preview, execute, reconcile };
}
