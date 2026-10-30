import { fail } from '../domain/errors.mjs';
import { memoryMarkdown } from './markdown-export.mjs';

export class ReadService {
  constructor(store) {
    this.store = store;
  }

  health() {
    return { status: 'ok' };
  }

  listProjects() {
    return this.store.listProjects();
  }

  listMemories({ projectId, page = false, ...filters } = {}) {
    if (page && !projectId) fail('PROJECT_REQUIRED', 'Paginated library requires a project');
    if (projectId) {
      const result = this.store.queryMemoryPage({ projectId, ...filters });
      return page ? result : result.items;
    }
    return this.listProjects().flatMap((project) => this.store.queryMemoryPage({ projectId: project.id, ...filters }).items);
  }

  getMemoryDetail(memoryId) {
    const memory = this.store.getMemory(memoryId, { includeDeleted: true });
    if (!memory) fail('MEMORY_NOT_FOUND', `Memory not found: ${memoryId}`, { memoryId });
    const relations = this.listRelations(memoryId);
    return {
      memory,
      currentRevision: memory.currentRevision,
      sources: this.store.listSourcesForRevision(memory.currentRevisionId),
      relations,
      notes: this.store.listMemoryNotes(memoryId, { includeDeleted: false }),
      metricObservation: this.store.getMetricObservation(memory.currentRevisionId),
      revisionCount: this.store.getRevisionHistory(memoryId).length,
    };
  }

  getRevisionHistory(memoryId, { includeObservation = false } = {}) {
    this.#memory(memoryId);
    const revisions = this.store.getRevisionHistory(memoryId);
    return includeObservation ? revisions.map((revision) => ({ ...revision,
      metricObservation: this.store.getMetricObservation(revision.id), sources: this.store.listSourcesForRevision(revision.id),
    })) : revisions;
  }

  exportMemory(memoryId, { projectId } = {}) {
    if (!projectId) fail('PROJECT_REQUIRED', 'Export requires one explicit project');
    const memory = this.#memory(memoryId);
    if (memory.projectId !== projectId) fail('PROJECT_MISMATCH', 'Memory belongs to another project');
    const detail = this.getMemoryDetail(memoryId);
    const markdown = memoryMarkdown(detail, this.store.getProject(projectId));
    if (Buffer.byteLength(markdown) > 2 * 1024 * 1024) {
      fail('EXPORT_TOO_LARGE', 'This Memory exceeds the 2 MiB export limit; no partial export was created');
    }
    return {
      filename: `memory-${memory.id}-r${detail.currentRevision.revisionNumber}.md`,
      memoryId, projectId, revisionId: detail.currentRevision.id, markdown,
    };
  }

  getEvents(memoryId) {
    this.#memory(memoryId);
    return this.store.listMemoryEvents(memoryId);
  }

  matchesMemory(memoryId, options) {
    const memory = this.#memory(memoryId);
    if (memory.projectId !== options.projectId) fail('PROJECT_MISMATCH', 'Memory belongs to another project');
    return { matches: this.store.queryMemoryPage({ ...options, onlyMemoryId: memoryId, limit: 1 }).total > 0 };
  }

  getNotes(memoryId, { includeDeleted = false } = {}) {
    this.#memory(memoryId);
    return this.store.listMemoryNotes(memoryId, { includeDeleted });
  }

  listRelations(memoryId) {
    const memory = this.#memory(memoryId);
    const relations = this.store.listRelationsForMemoryIds({ projectId: memory.projectId, memoryIds: [memoryId] });
    return relations.map((relation) => ({ ...relation, direction: relation.sourceMemoryId === memoryId ? 'outgoing' : 'incoming' }));
  }

  search({ projectId, query, limit = 50, page = false, ...filters } = {}) {
    if (!projectId) fail('PROJECT_REQUIRED', 'Search requires a project query parameter');
    const result = this.store.queryMemoryPage({ projectId, query, limit, ...filters });
    return page ? result : result.items;
  }

  listConflicts({ projectId, status = null } = {}) {
    if (projectId) return this.store.listConflicts({ projectId, status });
    return this.listProjects().flatMap((project) => this.store.listConflicts({ projectId: project.id, status }));
  }

  listContextSessions({ projectId } = {}) {
    if (projectId) return this.store.listContextSessions({ projectId });
    return this.listProjects().flatMap((project) => this.store.listContextSessions({ projectId: project.id }));
  }

  getContextSession(contextSessionId) {
    const session = this.store.getContextSession(contextSessionId);
    if (!session) fail('CONTEXT_SESSION_NOT_FOUND', `Context session not found: ${contextSessionId}`, { contextSessionId });
    return { session, snapshots: this.store.listContextSnapshots(contextSessionId) };
  }

  #memory(memoryId) {
    const memory = this.store.getMemory(memoryId, { includeDeleted: true });
    if (!memory) fail('MEMORY_NOT_FOUND', `Memory not found: ${memoryId}`, { memoryId });
    return memory;
  }
}
