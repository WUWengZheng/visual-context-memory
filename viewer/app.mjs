import { api, errorMessage } from './api.mjs';
import { createGraph } from './graph.mjs';
import { createViewerController } from './controller.mjs';
import { debounce, visibleLibrary } from './state.mjs';
import { createEditorController } from './editor-controller.mjs';
import { renderEditor, renderConflicts } from './components/memory-editor.mjs';
import { buildLibraryQuery } from './state.mjs';
import { renderMemoryList } from './components/memory-list.mjs';
import { createCreationController } from './creation-controller.mjs';
import { createCreationView } from './components/creation-dialog.mjs';

const $ = (selector) => document.querySelector(selector);
const elements = {
  project: $('#project-select'), search: $('#search'),
  type: $('#type-filter'), status: $('#status-filter'),
  locked: $('#locked-filter'), pinned: $('#pinned-filter'),
  list: $('#memory-list'), count: $('#library-count'),
  inspector: $('#inspector-content'), message: $('#graph-message'),
  messageText: $('#graph-message-text'), statusLine: $('#status-message'),
  retry: $('#retry'), panelTools: $('#panel-tools'),
};
let controller;
let editor;
let creator;
let creationView;
let auxiliaryKey = '';
const graph = createGraph($('#cy'), {
  onNodeSelected: (id) => selectMemory(id),
  onBlank: () => controller.clearSelection(),
});

function setMessage(message = '') {
  elements.message.hidden = !message;
  elements.messageText.textContent = message;
}

function rangeText(page, count, label) {
  if (!page) return `0 ${label}`;
  const range = `${count}/${page.total} matching ${label}`;
  return page.truncated ? `${range} · showing partial results` : range;
}

function render(state) {
  const items = visibleLibrary(state);
  renderMemoryList(elements.list, items, state.selectedMemoryId,
    (id) => selectMemory(id, { ensureGraph: true }));
  if (!state.loading && !state.error && !state.search && !Object.values(state.filters).some(Boolean) && !items.length) {
    const empty = document.createElement('div'); empty.className = 'empty-state';
    const title = document.createElement('h3'); title.textContent = state.projectId ? 'Keep something worth remembering' : 'Start with a project';
    const description = document.createElement('p'); description.textContent = state.projectId
      ? 'Add a fact, decision or constraint. Its original text and history stay with it.' : 'Separate your project knowledge, then add your first memory.';
    const action = document.createElement('button'); action.type = 'button'; action.className = 'primary-action';
    action.textContent = state.projectId ? 'Add a memory' : 'Create your first project';
    action.addEventListener('click', () => beginCreation(state.projectId ? 'memory' : 'project'));
    empty.append(title, description, action); elements.list.replaceChildren(empty);
  }
  $('#new-project').hidden = false;
  $('#new-project').disabled = state.loading || Boolean(creator?.state.saving);
  $('#new-memory').disabled = !state.projectId || state.loading || Boolean(creator?.state.saving);
  elements.project.disabled = !state.projects.length;
  creationView?.render(creator.state);
  const page = state.search ? state.searchPage : state.libraryPage;
  elements.count.textContent = state.searchLoading ? 'Searching…'
    : rangeText(page, items.length, state.search ? 'search results' : 'memories');
  if (editor) {
    renderEditor(elements.inspector, state.detail, editor, (id) => selectMemory(id, { ensureGraph: true }));
    renderConflicts($('#conflicts'), editor, state.projectId, () => openPanel('inspector'));
    const key = JSON.stringify([state.projectId, state.selectedMemoryId, state.detail?.currentRevision.id]);
    if (state.projectId && key !== auxiliaryKey) {
      auxiliaryKey = key;
      editor.loadAuxiliary();
    }
  }
  if (!editor?.state.memoryId) {
    if (state.detailLoading) elements.inspector.textContent = 'Loading memory details…';
    if (state.detailError) elements.inspector.textContent = errorMessage(state.detailError);
  }
  const error = state.error ?? state.searchError ?? state.detailError;
  elements.retry.hidden = !error;
  if (state.loading) {
    setMessage('Loading memories…');
  } else if (state.error) {
    setMessage(errorMessage(state.error));
  } else if (state.graph?.centerExcluded) {
    setMessage('The neighborhood center is excluded by the current filters. Change the filters or choose Project.');
  } else {
    setMessage(!state.projectId ? 'Create a project to start your memory library.'
      : state.graph?.nodes.length ? '' : 'No memories match this graph view.');
  }
  const libraryRange = rangeText(page, items.length, state.search ? 'search results' : 'memories');
  const graphRange = rangeText(state.graph, state.graph?.nodes.length ?? 0, 'nodes');
  elements.statusLine.textContent = error ? errorMessage(error)
    : state.loading ? 'Loading workspace…'
      : `Library: ${libraryRange} · Graph: ${graphRange} · ${state.graph?.edges.length ?? 0} relations`;
  document.querySelectorAll('[data-mode]').forEach((button) => {
    const mode = state.mode === 'project' ? 'project' : state.depth === 1 ? 'one' : 'two';
    button.classList.toggle('active', button.dataset.mode === mode);
  });
  // Projects are untrusted text. Do not interpolate them into markup.
  const projectKey = JSON.stringify(state.projects);
  if (elements.project.dataset.key !== projectKey) {
    elements.project.replaceChildren(...state.projects.map((project) => new Option(project.name, project.id)));
    elements.project.dataset.key = projectKey;
  }
  if (state.projectId) elements.project.value = state.projectId;
}

controller = createViewerController({ api, graph, render, guardNavigation: () => editor?.canLeave() ?? true });
editor = createEditorController({
  api, getContext: () => controller.state, onChange: () => render(controller.state),
  confirmDiscard: () => window.confirm(editor.state.uncertain
    ? 'Write outcome is unknown. Review Current/history first. Discard this old form/write state? OK = discard (no retry); Cancel = keep it.'
    : 'Discard unsaved changes? OK = discard; Cancel = continue editing.'),
  onSaved: async (result) => {
    const state = controller.state;
    const id = state.selectedMemoryId;
    await Promise.all([controller.loadWorkspace(), controller.runSearch()]);
    if (id && state.selectedMemoryId === id) await controller.selectMemory(id);
    await editor.loadAuxiliary();
    if (result && id && state.selectedMemoryId === id) {
      try {
        const match = await api.matches(id, buildLibraryQuery(state, { search: Boolean(state.search) }));
        if (!match.matches) editor.state.message += ' Saved, but no longer matches the current filters/search.';
      } catch (error) { editor.state.message += ` Saved, but visibility check failed: ${error.message}`; }
    }
  },
});
creator = createCreationController({
  api, getContext: () => controller.state,
  onChange: () => render(controller.state),
  confirmDiscard: () => window.confirm(creator.state.uncertain
    ? 'Creation may already have succeeded. Check current records before starting over. Discard this form?'
    : 'Discard the unsaved creation form? Cancel to continue.'),
  onCreated: async (result, identity) => {
    if (controller.state.projectId !== identity.projectId) return;
    if (identity.kind === 'project') {
      await controller.refreshProjects(result.id);
      elements.search.value = controller.state.search;
    } else {
      await Promise.all([controller.loadWorkspace(), controller.runSearch()]);
      if (controller.state.projectId !== identity.projectId) return;
      const id = result.affectedMemories[0].id;
      await selectMemory(id);
      if (controller.state.projectId !== identity.projectId || controller.state.selectedMemoryId !== id) return;
      const match = await api.matches(id, buildLibraryQuery(controller.state, { search: Boolean(controller.state.search) }));
      if (!match.matches) creator.state.message += ' Created, but outside the current filters/search.';
    }
  },
  onReconcile: async ({ kind, projectId, draft }) => kind === 'project' ? api.projects()
    : api.search(new URLSearchParams({ project: projectId, q: draft.name.slice(0, 200), page: 'true', limit: '100' }).toString()),
});
creationView = createCreationView($('#creation-dialog'), creator, $('#creation-feedback'));

function beginCreation(kind) {
  if (!editor.canLeave()) return;
  creator.open(kind);
}
$('#new-project').addEventListener('click', () => beginCreation('project'));
$('#new-memory').addEventListener('click', () => beginCreation('memory'));

async function selectMemory(id, options) {
  openPanel('inspector');
  await controller.selectMemory(id, options);
}

function openPanel(name) {
  if (name !== 'inspector' && $('.inspector').classList.contains('drawer-open') && !editor.canLeave()) return;
  document.querySelectorAll('.panel.drawer-open').forEach((panel) => panel.classList.remove('drawer-open'));
  $(`.${name}`).classList.add('drawer-open');
  updatePanelButtons();
}

function updatePanelButtons() {
  document.querySelectorAll('[data-open-panel]').forEach((button) => {
    button.setAttribute('aria-expanded', String($(`.${button.dataset.openPanel}`).classList.contains('drawer-open')));
  });
  graph.resize();
}

document.querySelectorAll('[data-open-panel]').forEach((button) => {
  button.addEventListener('click', () => openPanel(button.dataset.openPanel));
});
document.querySelectorAll('[data-close-panel]').forEach((button) => {
  button.addEventListener('click', () => {
    if (button.dataset.closePanel === 'inspector' && !editor.canLeave()) return;
    $(`.${button.dataset.closePanel}`).classList.remove('drawer-open');
    updatePanelButtons();
  });
});
new ResizeObserver(() => graph.resize()).observe($('#cy'));

elements.project.addEventListener('change', () => {
  controller.setProject(elements.project.value);
  elements.search.value = controller.state.search;
});
function updateFilters() {
  controller.setFilters({
    type: elements.type.value, status: elements.status.value,
    locked: elements.locked.checked, pinned: elements.pinned.checked,
  });
}
[elements.type, elements.status, elements.locked, elements.pinned]
  .forEach((input) => input.addEventListener('change', updateFilters));

const delayedSearch = debounce(() => controller.runSearch(), 320);
elements.search.addEventListener('input', () => {
  controller.setSearch(elements.search.value);
  if (controller.state.search) delayedSearch();
  else controller.runSearch();
});

document.querySelectorAll('[data-mode]').forEach((button) => {
  button.addEventListener('click', () => {
    if (controller.setMode(button.dataset.mode) === false) {
      elements.statusLine.textContent = 'Select a memory before choosing a neighborhood';
    }
  });
});
$('#fit').addEventListener('click', () => graph.fit());
$('#reset').addEventListener('click', () => graph.layout());
$('#focus').addEventListener('click', () => {
  if (controller.state.selectedMemoryId) graph.focus(controller.state.selectedMemoryId);
  else elements.statusLine.textContent = 'Select a memory to focus';
});
elements.retry.addEventListener('click', () => controller.retry());
window.addEventListener('keydown', (event) => {
  if ($('#creation-dialog').open) return;
  if (event.key === 'Escape') {
    if (!editor.canLeave()) return;
    document.querySelectorAll('.drawer-open').forEach((panel) => panel.classList.remove('drawer-open'));
    updatePanelButtons();
    controller.clearSelection();
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    elements.search.focus();
  }
});
window.addEventListener('beforeunload', (event) => {
  if (editor.state.dirty || editor.state.saving || (creator.state.open && (creator.state.dirty || creator.state.saving || creator.state.uncertain))) {
    event.preventDefault(); event.returnValue = '';
  }
});
controller.init();
