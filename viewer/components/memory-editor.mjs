import { renderInspector } from './memory-inspector.mjs';
import { revisionDiff } from '../editor-controller.mjs';
import { errorMessage } from '../api.mjs';

function node(tag, text, attributes = {}) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}
function button(text, action) {
  const element = node('button', text, { type: 'button' });
  element.addEventListener('click', action);
  return element;
}
function select(values, value) {
  const input = node('select');
  input.append(...values.map((item) => new Option(item || 'None', item)));
  input.value = value;
  return input;
}
function field(form, label, input) {
  input.setAttribute('aria-label', label);
  const wrapper = node('label', label);
  wrapper.append(input); form.append(wrapper); return input;
}

function draftForm(container, detail, editor) {
  const s = editor.state, d = s.draft;
  const form = node('form', undefined, { id: 'memory-editor', class: 'editor-form', 'aria-label': 'Edit Memory' });
  form.append(node('h3', 'Edit Memory'), node('p', `Based on Revision ${s.initialRevisionId}. Save creates a new immutable Revision.`));
  for (const key of ['name', 'type', 'subtype', 'contextRole', 'summary', 'description', 'confidence', 'valueKind', 'value', 'unit', 'metricValueRaw', 'changeReason']) {
    if (key === 'metricValueRaw' && !detail?.metricObservation) continue;
    if (detail?.metricObservation && ['value', 'valueKind', 'type', 'subtype'].includes(key)) continue;
    let input;
    if (key === 'type') input = select(['entity', 'fact', 'decision', 'constraint', 'requirement', 'issue', 'resolution'], d[key]);
    else if (key === 'contextRole') input = select(['background', 'current_state', 'current_plan', 'constraint', 'requirement', 'baseline', 'result', 'decision', 'known_issue', 'open_question', 'reference'], d[key]);
    else if (key === 'valueKind') input = select(['none', 'text', 'number', 'boolean', 'json'], d[key]);
    else {
      input = node(['summary', 'description', 'value'].includes(key) ? 'textarea' : 'input');
      input.value = d[key];
    }
    input.name = key;
    if (key === 'confidence') { input.type = 'number'; input.min = '0'; input.max = '1'; input.step = '0.01'; }
    if (key === 'description') input.maxLength = 16000;
    field(form, key === 'metricValueRaw' ? 'Metric value (numeric correction, same scope)' : key, input);
    input.addEventListener('input', () => editor.change(key, input.value));
  }
  if (detail?.metricObservation) {
    const o = detail.metricObservation;
    form.append(node('p', 'Dataset / Split / Protocol / Run / Checkpoint are preserved. A different run or checkpoint is a separate observation, not a correction.'));
    for (const key of ['subjectMemoryId', 'metricName', 'datasetMemoryId', 'split', 'protocol', 'runLabel', 'checkpoint']) {
      form.append(node('p', `${key}: ${o[key] ?? 'Unknown'}`));
    }
  }
  const save = node('button', 'Save new Revision', { type: 'submit', id: 'save-memory' });
  form.addEventListener('submit', (event) => { event.preventDefault(); editor.save(); });
  form.append(save, button('Exit edit', () => editor.canLeave()));
  container.append(form);
}

function appendHistory(container, auxiliary) {
  if (!auxiliary) return;
  const history = node('details', undefined, { id: 'revision-history' });
  history.append(node('summary', 'Revision history & field Diff'));
  auxiliary.revisions.forEach((revision, index, revisions) => {
    const entry = node('details');
    entry.append(node('summary', `Revision ${revision.revisionNumber} · ${revision.createdAt}`));
    entry.append(node('p', `Actor: ${revision.createdByActorId} · Reason: ${revision.changeReason ?? 'None'}`));
    entry.append(node('pre', JSON.stringify(revision, null, 2), { tabindex: '0' }));
    const changes = revisionDiff(revisions[index - 1], revision);
    for (const change of changes) entry.append(node('p', `${change.field}: ${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}`));
    history.append(entry);
  });
  container.append(history);
}

function operations(container, detail, editor) {
  const m = detail.memory;
  const controls = node('div', undefined, { class: 'editor-actions' });
  const edit = button('Edit', () => editor.begin(detail));
  edit.className = 'primary-action';
  controls.append(edit,
    button(m.isLocked ? 'Unlock' : 'Lock', () => editor.action(m.isLocked ? 'unlock' : 'lock')),
    button(m.isPinned ? 'Unpin' : 'Pin', () => editor.action(m.isPinned ? 'unpin' : 'pin')));
  const more = node('details', undefined, { class: 'secondary-actions' });
  more.append(node('summary', 'More actions'));
  const lifecycle = node('div', undefined, { class: 'editor-actions' });
  for (const [label, action] of [['Confirm', 'confirm'], ['Reject', 'reject'], ['Mark Outdated', 'outdated']]) {
    lifecycle.append(button(label, () => editor.action(action)));
  }
  if (['deleted', 'rejected', 'superseded'].includes(m.lifecycleStatus)) controls.append(button('Restore', () => editor.action('restore')));
  else lifecycle.append(button('Preview soft delete', () => editor.preview({ operation: 'delete', memoryId: m.id })));
  more.append(lifecycle, node('p', 'Lock protects against automatic mutation; explicit editing keeps the Lock. Pin is a separate priority hint, not protection.', { class: 'muted' }));
  const importance = select(['low', 'normal', 'high', 'critical'], m.importance);
  field(more, 'Importance', importance);
  importance.addEventListener('change', () => editor.action('importance', { importance: importance.value }));
  container.append(controls, more);
  const addNote = node('details', undefined, { class: 'note-composer' });
  addNote.append(node('summary', 'Add a note'));
  const noteForm = node('form');
  const note = node('textarea', undefined, { name: 'note', maxlength: '4000', required: '' });
  field(noteForm, 'New Note', note);
  noteForm.append(node('button', 'Add Note', { type: 'submit' }));
  noteForm.addEventListener('submit', (event) => { event.preventDefault(); editor.addNote(note.value); });
  addNote.append(noteForm);
  container.append(addNote);
  for (const note of detail.notes) container.append(button(`Soft delete Note: ${note.content}`, () => editor.deleteNote(note.id)));
  const aux = editor.state.auxiliary;
  if (aux?.projectId !== m.projectId || aux?.id !== m.id) return;
  appendHistory(container, aux);
  const highRisk = node('details');
  highRisk.append(node('summary', 'Merge / Supersede (preview required)'));
  const targets = select([], '');
  targets.append(new Option('Choose a Memory from this project', ''));
  for (const memory of aux.candidates.items.filter((item) => item.id !== m.id)) {
    targets.append(new Option(memory.currentRevision.name, memory.id));
  }
  field(highRisk, 'Target Memory', targets);
  highRisk.append(node('p', `Candidates ${aux.offset + 1}–${aux.offset + aux.candidates.items.length} of ${aux.candidates.total}. Only this project; bounded pages.`));
  if (aux.offset > 0) highRisk.append(button('Previous candidates', () => editor.loadAuxiliary({ offset: Math.max(0, aux.offset - 100) })));
  if (aux.candidates.truncated) highRisk.append(button('Next candidates', () => editor.loadAuxiliary({ offset: aux.offset + 100 })));
  const reason = node('input', undefined, { maxlength: '2000' });
  field(highRisk, 'Reason', reason);
  for (const [label, operation] of [['Preview Merge (keep current content)', 'merge'], ['Preview Supersede (target replaces current)', 'supersede']]) {
    highRisk.append(button(label, () => {
      if (!targets.value || !reason.value.trim()) { reason.setCustomValidity('Choose target and enter reason'); reason.reportValidity(); reason.setCustomValidity(''); return; }
      editor.preview({ operation, memoryId: m.id, targetId: targets.value, reason: reason.value });
    }));
  }
  container.append(highRisk);
}

export function renderEditor(container, detail, editor, onNavigate) {
  const s = editor.state;
  const key = s.memoryId ? `${s.memoryId}:${s.initialRevisionId}` : '';
  // An ordinary render must never recreate a live form or lose focus/caret.
  if (!key || container.dataset.editKey !== key) {
    container.replaceChildren();
    container.dataset.editKey = key;
    if (key) draftForm(container, detail, editor);
    else {
      renderInspector(container, detail, { onNavigate });
      if (detail) operations(container, detail, editor);
    }
    container.append(node('p', '', { id: 'editor-feedback', role: 'status', 'aria-live': 'polite', tabindex: '0' }));
    container.append(node('div', undefined, { id: 'operation-preview', role: 'region', 'aria-label': 'Backend operation preview', tabindex: '0' }));
  }
  const feedback = container.querySelector('#editor-feedback');
  feedback.textContent = s.saveError ? (s.uncertain ? s.saveError.message : errorMessage(s.saveError))
    : s.saving ? 'Saving…' : s.dirty ? 'Unsaved changes. Save a new Revision or continue editing.' : s.message;
  let reconcile = container.querySelector('#reconcile-write');
  if (s.uncertain && !reconcile) {
    reconcile = button('Refresh Current & history (no write retry)', () => editor.reconcile());
    reconcile.id = 'reconcile-write'; container.append(reconcile);
  }
  for (const input of container.querySelectorAll('button, input, select, textarea')) input.disabled = s.saving;
  const save = container.querySelector('#save-memory');
  if (save) save.disabled = s.saving || !s.dirty || s.uncertain;
  const preview = container.querySelector('#operation-preview');
  preview.replaceChildren();
  if (s.preview) {
    preview.append(node('h3', 'Backend impact preview — provisional new IDs'),
      node('p', s.preview.historyPolicy), node('pre', JSON.stringify(s.preview, null, 2)),
      button('Execute reviewed operation', () => editor.execute()),
      button('Cancel preview', () => { s.preview = null; renderEditor(container, detail, editor, onNavigate); }));
  }
}

export function renderConflicts(container, editor, projectId, onOpenInspector = () => {}) {
  const s = editor.state, aux = s.auxiliary;
  container.replaceChildren();
  if (s.auxiliaryError) {
    container.append(node('p', errorMessage(s.auxiliaryError)), button('Retry history / conflicts', () => editor.loadAuxiliary())); return;
  }
  if (!aux || aux.projectId !== projectId) return;
  const open = aux.conflicts.filter((conflict) => conflict.status === 'open');
  const list = node('details');
  list.append(node('summary', `${open.length} open Conflicts · ${aux.conflicts.length} total`));
  for (const conflict of aux.conflicts) {
    const entry = node('details');
    entry.append(node('summary', `${conflict.conflictType} · ${conflict.status}`), node('p', conflict.rationale));
    entry.append(node('p', `Existing ${conflict.existingMemoryId} / Incoming ${conflict.incomingMemoryId}`));
    if (conflict.status === 'open') {
      const resolution = select(['keep_existing', 'use_incoming', 'keep_both', 'merge', 'mark_existing_outdated', 'reject_incoming'], 'keep_existing');
      field(entry, 'Manual resolution', resolution);
      entry.append(button('Preview Conflict resolution', () => {
        onOpenInspector();
        editor.preview({ operation: 'resolve', conflictId: conflict.id, resolution: resolution.value, reason: 'Explicit Viewer review' });
      }));
    }
    list.append(entry);
  }
  container.append(list);
}
