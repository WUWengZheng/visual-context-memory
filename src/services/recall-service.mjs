import { fail } from '../domain/errors.mjs';

const PER_QUERY_LIMIT = 50;
const RANK_CONSTANT = 60;
const SEED_LIMIT = 5;
const NEIGHBORS_PER_SEED = 20;
const PREVIEW_NAME_LIMIT = 120;
const PREVIEW_SUMMARY_LIMIT = 320;
const PREVIEW_SOURCE_LIMIT = 8;

function previewText(value, limit) {
  const characters = [...(value ?? '')];
  return { text: characters.slice(0, limit).join(''), truncated: characters.length > limit };
}

function compactItem(item) {
  const memory = item.memory;
  const revision = memory.currentRevision;
  const name = previewText(revision.name, PREVIEW_NAME_LIMIT);
  const summary = previewText(revision.summary, PREVIEW_SUMMARY_LIMIT);
  return {
    score: item.score, reasons: item.reasons,
    memory: {
      id: memory.id, projectId: memory.projectId, currentRevisionId: memory.currentRevisionId,
      lifecycleStatus: memory.lifecycleStatus, verificationStatus: memory.verificationStatus,
      isLocked: memory.isLocked, isPinned: memory.isPinned, importance: memory.importance,
      currentRevision: { id: revision.id, revisionNumber: revision.revisionNumber,
        name: name.text, summary: summary.text, type: revision.type, subtype: revision.subtype },
    },
    sources: item.sources.slice(0, PREVIEW_SOURCE_LIMIT).map((source) => ({
      id: source.id, sourceType: source.sourceType, evidenceRole: source.evidenceRole,
    })),
    sourceCoverage: { total: item.sources.length, returned: Math.min(item.sources.length, PREVIEW_SOURCE_LIMIT),
      truncated: item.sources.length > PREVIEW_SOURCE_LIMIT, metadata: 'identity-only' },
    preview: { requiresDetail: true, nameTruncated: name.truncated, summaryTruncated: summary.truncated,
      nameLimit: PREVIEW_NAME_LIMIT, summaryLimit: PREVIEW_SUMMARY_LIMIT, sourceLimit: PREVIEW_SOURCE_LIMIT },
  };
}

function rankedItems(candidates) {
  return [...candidates.values()].sort((a, b) => b.score - a.score || a.memory.id.localeCompare(b.memory.id));
}

export class RecallService {
  constructor(store) {
    this.store = store;
  }

  recall({ projectId, queries, limit = 20, neighbors = 0, view = 'full', ...filters }) {
    if (!['full', 'compact'].includes(view)) fail('INVALID_QUERY', 'view must be full or compact');
    if (!projectId) fail('PROJECT_REQUIRED', 'Recall requires one explicit project');
    if (!this.store.getProject(projectId)) fail('PROJECT_NOT_FOUND', 'Project not found');
    const uniqueQueries = [...new Set(queries.map((query) => query.trim()))];
    const candidates = new Map();
    const queryMatches = [];
    const scope = { ...filters, projectId, lifecycleStatus: filters.lifecycleStatus ?? 'active' };
    for (const query of uniqueQueries) {
      const page = this.store.queryMemoryPage({ ...scope, query, limit: PER_QUERY_LIMIT });
      queryMatches.push({ query, total: page.total, loaded: page.items.length, truncated: page.truncated });
      page.items.forEach((memory, index) => {
        let item = candidates.get(memory.id);
        if (!item) {
          item = { memory, score: 0, reasons: [] };
          candidates.set(memory.id, item);
        }
        const rank = index + 1;
        item.score += 1 / (RANK_CONSTANT + rank);
        item.reasons.push({ kind: 'keyword', query, rank });
      });
    }
    const directIds = new Set(candidates.keys());
    const neighborhoods = [];
    if (neighbors === 1) {
      const seeds = rankedItems(candidates).slice(0, SEED_LIMIT).map((item) => ({ memory: item.memory, score: item.score }));
      for (const seed of seeds) {
        const page = this.store.queryMemoryPage({ ...scope, memoryId: seed.memory.id,
          depth: 1, limit: NEIGHBORS_PER_SEED + 1 });
        const related = page.items.filter((memory) => memory.id !== seed.memory.id);
        neighborhoods.push({ centerId: seed.memory.id, total: Math.max(0, page.total - 1),
          loaded: related.length, truncated: page.truncated });
        for (const memory of related) {
          const [relation] = this.store.listRelationsForMemoryIds({ projectId,
            memoryIds: [seed.memory.id, memory.id], withinOnly: true, limit: 1 });
          if (!relation) continue;
          let item = candidates.get(memory.id);
          if (!item) {
            item = { memory, score: seed.score * 0.5, reasons: [] };
            candidates.set(memory.id, item);
          } else if (!directIds.has(memory.id)) item.score = Math.max(item.score, seed.score * 0.5);
          item.reasons.push({ kind: 'relation', seedMemoryId: seed.memory.id,
            relationId: relation.id, relationType: relation.relationType,
            direction: relation.sourceMemoryId === seed.memory.id ? 'outgoing' : 'incoming' });
        }
      }
    }
    const ranked = rankedItems(candidates);
    const items = ranked.slice(0, limit).map((item) => ({
      ...item,
      sources: this.store.listSourcesForRevision(item.memory.currentRevisionId).map((source) => ({
        id: source.id, sourceType: source.sourceType, filePath: source.filePath,
        locator: source.locator, evidenceRole: source.evidenceRole,
      })),
    }));
    return {
      projectId, queries: uniqueQueries, strategy: 'keyword-rank-fusion',
      filters: { type: scope.type ?? null, status: scope.lifecycleStatus,
        locked: scope.locked ?? null, pinned: scope.pinned ?? null },
      scoreMeaning: 'retrieval rank, not truth or confidence',
      items: view === 'compact' ? items.map(compactItem) : items,
      ...(view === 'compact' ? { view } : {}),
      limit, returned: items.length, candidateCount: ranked.length,
      queryMatches, perQueryLimit: PER_QUERY_LIMIT, neighborhoods,
      expansion: { depth: neighbors, seedLimit: SEED_LIMIT, neighborsPerSeed: NEIGHBORS_PER_SEED,
        seedSelectionTruncated: neighbors === 1 && directIds.size > SEED_LIMIT },
      truncated: queryMatches.some((page) => page.truncated) || neighborhoods.some((page) => page.truncated)
        || (neighbors === 1 && directIds.size > SEED_LIMIT) || ranked.length > limit,
    };
  }
}
