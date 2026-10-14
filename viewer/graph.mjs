import cytoscape from 'cytoscape';

export function nodeClasses(node) {
  return [
    `type-${node.type}`,
    node.locked ? 'is-locked' : '',
    node.pinned ? 'is-pinned' : '',
    node.lifecycleStatus ? `is-${node.lifecycleStatus}` : '',
  ].filter(Boolean).join(' ');
}

export function graphNodeLabel(node) {
  const markers = [
    node.locked ? '🔒 Locked' : '',
    node.pinned ? '⌖ Pinned' : '',
    ['candidate', 'outdated', 'superseded', 'rejected'].includes(node.lifecycleStatus)
      ? node.lifecycleStatus : '',
  ];
  return [node.name, markers.filter(Boolean).join(' · ')].filter(Boolean).join('\n');
}

export function toCytoscapeElements(graph) {
  return {
    nodes: graph.nodes.map((node) => ({
      data: { id: node.id, label: node.name }, classes: nodeClasses(node),
    })),
    edges: graph.edges.map((edge) => ({
      data: { id: edge.id, source: edge.source, target: edge.target, label: edge.relationType },
    })),
  };
}

const STYLE = [
  {
    selector: 'node',
    style: {
      'background-color': '#e8f0f8', 'border-color': '#40719d', 'border-width': 2,
      color: '#172637', 'font-size': 11,
      'font-family': 'ui-sans-serif, system-ui, sans-serif',
      'text-wrap': 'wrap', 'text-max-width': 100,
      'text-valign': 'center', 'text-halign': 'center', width: 100, height: 56,
      // State markers are text, independent of border/search/selection styles.
      label: (node) => graphNodeLabel({
        name: node.data('label'),
        locked: node.hasClass('is-locked'), pinned: node.hasClass('is-pinned'),
        lifecycleStatus: ['candidate', 'outdated', 'superseded', 'rejected']
          .find((status) => node.hasClass(`is-${status}`)),
      }),
    },
  },
  {
    selector: 'edge',
    style: {
      width: 1.5, 'line-color': '#a7b8c7', 'target-arrow-color': '#a7b8c7',
      'target-arrow-shape': 'triangle', 'curve-style': 'bezier', label: 'data(label)',
      color: '#627588', 'font-size': 9, 'text-background-color': '#f8fafc',
      'text-background-opacity': 1, 'text-background-padding': 2,
    },
  },
  { selector: '.type-entity', style: { shape: 'round-rectangle' } },
  { selector: '.type-fact', style: { shape: 'ellipse' } },
  { selector: '.type-decision', style: { shape: 'diamond' } },
  { selector: '.type-constraint', style: { shape: 'hexagon' } },
  { selector: '.type-requirement', style: { shape: 'rectangle' } },
  { selector: '.type-issue', style: { shape: 'triangle' } },
  { selector: '.type-resolution', style: { shape: 'tag' } },
  { selector: '.is-locked', style: { 'border-width': 5, 'border-style': 'solid' } },
  { selector: '.is-pinned', style: { 'border-width': 4, 'border-style': 'double' } },
  {
    selector: '.is-outdated, .is-superseded',
    style: { 'border-style': 'dashed', opacity: 0.68 },
  },
  { selector: '.is-candidate', style: { 'border-style': 'dotted' } },
  {
    selector: '.is-selected',
    style: { 'background-color': '#cfe5ff', 'border-color': '#155b9a', 'border-width': 5 },
  },
  { selector: '.is-neighbor', style: { 'background-color': '#eff7ff', 'border-color': '#4b89bb' } },
  { selector: '.is-faded', style: { opacity: 0.4 } },
  {
    selector: '.is-search-hit',
    style: { 'background-color': '#fff4be', 'border-color': '#8e6500', 'border-width': 4 },
  },
];

export function createGraph(container, { onNodeSelected, onBlank } = {}) {
  const cy = cytoscape({
    container, style: STYLE, elements: [],
    wheelSensitivity: 0.18, minZoom: 0.25, maxZoom: 3,
  });
  cy.on('tap', 'node', (event) => onNodeSelected?.(event.target.id()));
  cy.on('tap', (event) => { if (event.target === cy) onBlank?.(); });

  function layout() {
    cy.layout({
      name: 'cose', animate: false, padding: 36, nodeRepulsion: 7000,
      idealEdgeLength: 130, gravity: 0.18,
    }).run();
    // A small graph should not turn into oversized labels just to fill the canvas.
    if (cy.zoom() > 1.1) {
      cy.zoom(1.1);
      cy.center();
    }
  }
  return {
    setGraph(graph) {
      cy.stop(true, false);
      cy.elements().remove();
      cy.add(toCytoscapeElements(graph));
      layout();
    },
    layout,
    resize() { cy.resize(); },
    fit() { cy.stop(true, false); cy.fit(cy.elements(), 38); },
    focus(id) {
      const node = cy.getElementById(id);
      if (!node.length) return false;
      cy.stop(true, false);
      cy.animate({
        center: { eles: node }, zoom: Math.max(cy.zoom(), 1.05), duration: 140,
      });
      return true;
    },
    select(id) {
      cy.elements().removeClass('is-selected is-neighbor is-faded');
      const node = cy.getElementById(id);
      if (!node.length) return false;
      const neighborhood = node.closedNeighborhood();
      cy.elements().not(neighborhood).addClass('is-faded');
      neighborhood.nodes().addClass('is-neighbor');
      node.addClass('is-selected').removeClass('is-neighbor');
      return true;
    },
    clearSelection() { cy.elements().removeClass('is-selected is-neighbor is-faded'); },
    highlight(ids) {
      cy.nodes().removeClass('is-search-hit');
      ids.forEach((id) => cy.getElementById(id).addClass('is-search-hit'));
    },
    hasNode(id) { return cy.getElementById(id).length > 0; },
    destroy() { cy.destroy(); },
  };
}
