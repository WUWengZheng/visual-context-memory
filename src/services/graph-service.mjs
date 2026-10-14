import { fail } from '../domain/errors.mjs';

const MAX_DEPTH = 2;

function graphNode(memory) {
  return {
    id: memory.id,
    name: memory.currentRevision.name,
    type: memory.currentRevision.type,
    subtype: memory.currentRevision.subtype,
    contextRole: memory.currentRevision.contextRole,
    importance: memory.importance,
    lifecycleStatus: memory.lifecycleStatus,
    verificationStatus: memory.verificationStatus,
    locked: memory.isLocked,
    pinned: memory.isPinned,
  };
}

function graphEdge(relation) {
  return { id: relation.id, source: relation.sourceMemoryId, target: relation.targetMemoryId, relationType: relation.relationType };
}

export class GraphService {
  constructor(store) {
    this.store = store;
  }

  getGraph({ projectId, memoryId = null, type = null, status = null, locked = null, pinned = null, limit = 100, depth = 1 } = {}) {
    if (!projectId) fail('PROJECT_REQUIRED', 'Graph requires a project query parameter');
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) fail('INVALID_GRAPH_LIMIT', 'Graph limit must be an integer between 1 and 200');
    if (!Number.isInteger(depth) || depth < 1 || depth > MAX_DEPTH) fail('INVALID_GRAPH_DEPTH', `Graph depth must be an integer between 1 and ${MAX_DEPTH}`);
    const page = this.store.queryMemoryPage({ projectId, memoryId, depth, type, lifecycleStatus: status, locked, pinned, limit });
    if (memoryId) {
      const root = this.store.getMemory(memoryId, { includeDeleted: true });
      if (!root || root.projectId !== projectId) fail('MEMORY_NOT_FOUND', `Memory not found in project: ${memoryId}`, { memoryId, projectId });
      const excluded = (type !== null && root.currentRevision.type !== type)
        || (status !== null ? root.lifecycleStatus !== status : ['deleted', 'rejected'].includes(root.lifecycleStatus))
        || (locked !== null && root.isLocked !== locked) || (pinned !== null && root.isPinned !== pinned);
      if (excluded) return { nodes: [], edges: [], limit, depth, total: 0, truncated: false, centerExcluded: true };
    }
    const memories = page.items;
    const ids = memories.map((memory) => memory.id);
    const edges = ids.length === 0 ? [] : this.store.listRelationsForMemoryIds({ projectId, memoryIds: ids, withinOnly: true });
    return {
      nodes: memories.map(graphNode), edges: edges.map(graphEdge), limit,
      depth: memoryId ? depth : 0, total: page.total, truncated: page.truncated, centerExcluded: false,
    };
  }
}
