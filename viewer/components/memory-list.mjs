function textElement(document, tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

export function renderMemoryList(container, memories, selectedId, onSelect) {
  const document = container.ownerDocument;
  container.replaceChildren();
  if (!memories.length) {
    container.append(textElement(document, 'p', 'No memories match this view.', 'placeholder'));
    return;
  }
  for (const memory of memories) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `memory-row${memory.id === selectedId ? ' selected' : ''}`;
    button.dataset.id = memory.id;
    const name = memory.currentRevision?.name ?? memory.name;
    button.append(textElement(document, 'span', name, 'memory-name'));
    const markers = [memory.isLocked ? 'Locked' : '', memory.isPinned ? 'Pinned' : ''];
    const metadata = [memory.currentRevision?.type ?? memory.type, memory.lifecycleStatus, ...markers].filter(Boolean);
    button.append(textElement(document, 'span', metadata.join(' · '), 'memory-meta'));
    button.addEventListener('click', () => onSelect(memory.id));
    container.append(button);
  }
}
