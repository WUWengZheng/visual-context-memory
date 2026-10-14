function present(value) {
  return value !== null && value !== undefined && value !== '';
}

function formattedFields(fields) {
  return fields.filter(([, value]) => present(value))
    .map(([label, value]) => ({ label, value: String(value) }));
}

export function formatDetail(detail) {
  const memory = detail.memory ?? {};
  const revision = detail.currentRevision ?? {};
  const fields = formattedFields([
    ['Name', revision.name], ['Type', revision.type], ['Subtype', revision.subtype],
    ['Context role', revision.contextRole], ['Summary', revision.summary],
    ['Description', revision.description], ['Lifecycle', memory.lifecycleStatus],
    ['Verification', memory.verificationStatus], ['Importance', memory.importance],
    ['Revision count', detail.revisionCount], ['Created', memory.createdAt],
    ['Updated', memory.updatedAt],
  ]);
  const observation = detail.metricObservation;
  const metric = observation ? formattedFields([
    ['Metric', observation.metricName],
    ['Value', observation.valueNumber ?? observation.valueText],
    ['Unit', observation.unit], ['Split', observation.split],
  ]) : [];
  return {
    fields, metric,
    sources: (detail.sources ?? []).map((source) => ({
      ...source, excerpt: source.originalText ?? source.uri ?? source.sourceType,
    })),
    relations: detail.relations ?? [], notes: detail.notes ?? [],
    locked: Boolean(memory.isLocked), pinned: Boolean(memory.isPinned),
  };
}

function element(document, tag, text, className) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
}

function appendFields(container, fields) {
  const document = container.ownerDocument;
  const list = document.createElement('dl');
  for (const { label, value } of fields) {
    list.append(element(document, 'dt', label), element(document, 'dd', value));
  }
  container.append(list);
}

export function renderInspector(container, detail, { onNavigate } = {}) {
  const document = container.ownerDocument;
  container.replaceChildren();
  if (!detail) {
    container.append(element(document, 'p',
      'Select a node to inspect its evidence, relations, notes, and metrics.', 'placeholder'));
    return;
  }
  const view = formatDetail(detail);
  const controls = [view.locked ? 'LOCKED' : '', view.pinned ? 'PINNED' : ''].filter(Boolean);
  container.append(element(document, 'div', controls.join(' · '), 'inspector-heading'));
  appendFields(container, view.fields.filter(({ label }) => ['Name', 'Type', 'Summary', 'Description', 'Lifecycle', 'Verification'].includes(label)));
  const metadata = document.createElement('details');
  metadata.append(element(document, 'summary', 'Memory details'));
  appendFields(metadata, view.fields.filter(({ label }) => !['Name', 'Type', 'Summary', 'Description', 'Lifecycle', 'Verification'].includes(label)));
  container.append(metadata);
  if (view.metric.length) {
    container.append(element(document, 'h3', 'Metric'));
    appendFields(container, view.metric);
  }
  container.append(element(document, 'h3', 'Sources'));
  if (!view.sources.length) container.append(element(document, 'p', 'No sources.', 'muted'));
  for (const source of view.sources) {
    const entry = document.createElement('details');
    entry.append(element(document, 'summary', source.sourceType ?? 'Source'));
    if (source.filePath || source.locator) {
      entry.append(element(document, 'p', [source.filePath, source.locator].filter(Boolean).join(' · ')));
    }
    const original = element(document, 'p', source.excerpt);
    original.hidden = true;
    const button = element(document, 'button', 'Show original', 'source-original');
    button.type = 'button';
    button.addEventListener('click', () => {
      original.hidden = !original.hidden;
      button.textContent = original.hidden ? 'Show original' : 'Hide original';
    });
    entry.append(button, original);
    container.append(entry);
  }
  container.append(element(document, 'h3', 'Relations'));
  if (!view.relations.length) container.append(element(document, 'p', 'No relations.', 'muted'));
  for (const relation of view.relations) {
    const target = relation.sourceMemoryId === detail.memory.id
      ? relation.targetMemoryId : relation.sourceMemoryId;
    const button = element(document, 'button',
      `${relation.direction} · ${relation.relationType}`, 'relation-link');
    button.type = 'button';
    button.dataset.memoryId = target;
    button.addEventListener('click', () => onNavigate?.(target));
    container.append(button);
  }
  container.append(element(document, 'h3', 'Notes'));
  if (!view.notes.length) container.append(element(document, 'p', 'No notes.', 'muted'));
  for (const note of view.notes) container.append(element(document, 'p', note.content, 'note'));
}
