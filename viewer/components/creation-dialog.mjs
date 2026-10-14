function element(tag, text, attributes = {}) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

export function createCreationView(dialog, creator, feedback) {
  let key = null;
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); creator.close(); });
  function render(state) {
    feedback.textContent = state.open ? '' : state.message;
    feedback.hidden = !feedback.textContent;
    if (!state.open) {
      if (dialog.open) dialog.close();
      key = null; return;
    }
    const identity = JSON.stringify([state.kind, state.projectId]);
    if (identity !== key) {
      key = identity; dialog.replaceChildren();
      const title = state.kind === 'project' ? 'Create a project' : 'New memory';
      const form = element('form', undefined, { 'aria-label': title });
      form.append(element('h2', title, { id: 'creation-title' }),
        element('p', state.kind === 'project' ? 'Keep each project’s knowledge separate.'
          : 'Write one fact, decision or instruction worth keeping. Your original text and Revision 1 will be preserved.'));
      function field(name, label, tag = 'input', attributes = {}, parent = form) {
        const wrapper = element('label', label);
        const input = element(tag, undefined, { name, 'aria-label': label, ...attributes });
        input.value = state.draft[name] ?? '';
        input.addEventListener('input', () => creator.change(name, input.value));
        wrapper.append(input); parent.append(wrapper); return input;
      }
      field('name', state.kind === 'project' ? 'Project name' : 'Memory name', 'input', {
        required: '', maxlength: state.kind === 'project' ? '120' : '200', autofocus: '',
      });
      if (state.kind === 'memory') {
        field('summary', 'What should be remembered?', 'textarea', { required: '', maxlength: '4000' });
        const type = field('type', 'Type', 'select');
        type.append(...['entity', 'fact', 'decision', 'constraint', 'requirement', 'issue', 'resolution'].map((value) => new Option(value, value)));
        type.value = state.draft.type;
        const more = element('details'); more.append(element('summary', 'More detail (optional)'));
        field('description', 'Description', 'textarea', { maxlength: '16000' }, more); form.append(more);
      }
      const actions = element('div', undefined, { class: 'editor-actions' });
      const submit = element('button', state.kind === 'project' ? 'Create project' : 'Create memory', { type: 'submit', class: 'primary-action' });
      const cancel = element('button', 'Cancel', { type: 'button' });
      cancel.addEventListener('click', () => creator.close()); actions.append(submit, cancel);
      const status = element('p', '', { id: 'creation-status', role: 'status', 'aria-live': 'polite', tabindex: '0' });
      const reconcile = element('button', 'Check current records — read only', { type: 'button', id: 'creation-reconcile' });
      reconcile.addEventListener('click', () => creator.reconcile());
      form.append(actions, status, reconcile, element('pre', '', { id: 'creation-records', tabindex: '0' }));
      form.addEventListener('submit', (event) => { event.preventDefault(); creator.submit(); });
      dialog.append(form);
    }
    if (!dialog.open) dialog.showModal();
    for (const input of dialog.querySelectorAll('button, input, textarea, select')) input.disabled = state.saving || state.reconciling;
    dialog.querySelector('[type="submit"]').disabled = state.saving || state.reconciling || state.uncertain;
    dialog.querySelector('#creation-status').textContent = state.saving ? 'Creating…'
      : state.reconciling ? 'Reading current records…' : state.error ? `${state.error.code ? state.error.code + ': ' : ''}${state.error.message}` : state.message;
    dialog.querySelector('#creation-reconcile').hidden = !state.uncertain;
    dialog.querySelector('#creation-records').textContent = state.records ? JSON.stringify(state.records, null, 2) : '';
  }
  return { render };
}
