import { randomUUID, createHash } from 'node:crypto';
import { fail } from '../domain/errors.mjs';
import { requireObject, requireString } from '../db/validation.mjs';

// Executes the existing domain operations in a rolled-back transaction to
// preview real effects. Tokens bind plans to audited state and expire in 10 min.
export class EditorOperationService {
  constructor(store, memoryService, conflictService) {
    Object.assign(this, { store, memoryService, conflictService });
    this.previews = new Map();
  }

  #participants(plan) {
    requireObject(plan, 'plan');
    requireString(plan.projectId, 'projectId');
    let ids;
    if (plan.operation === 'resolve') {
      const conflict = this.store.getConflict(plan.conflictId);
      if (!conflict) fail('CONFLICT_NOT_FOUND', 'Conflict not found');
      if (conflict.projectId !== plan.projectId) fail('PROJECT_MISMATCH', 'Conflict belongs to another project');
      ids = [conflict.existingMemoryId, conflict.incomingMemoryId];
    } else if (['merge', 'supersede'].includes(plan.operation)) ids = [plan.memoryId, plan.targetId];
    else if (plan.operation === 'delete') ids = [plan.memoryId];
    else fail('INVALID_OPERATION', 'Unknown preview operation');
    return ids.map((id) => {
      const memory = this.store.getMemory(id, { includeDeleted: true });
      if (!memory) fail('MEMORY_NOT_FOUND', 'Memory not found');
      if (memory.projectId !== plan.projectId) fail('PROJECT_MISMATCH', 'Operation cannot cross projects');
      return memory;
    });
  }

  #snapshot(plan) {
    const memories = this.#participants(plan);
    return {
      memories: memories.map((memory) => ({ memory,
        revisions: this.store.getRevisionHistory(memory.id).map((revision) => ({
          revision, sources: this.store.listSourcesForRevision(revision.id),
          metricObservation: this.store.getMetricObservation(revision.id),
        })), events: this.store.listMemoryEvents(memory.id) })),
      // Merge may copy incident edges: any project relation change invalidates a plan.
      relations: this.store.listRelations({ projectId: plan.projectId }),
      conflicts: this.store.listConflicts({ projectId: plan.projectId }),
    };
  }

  #fingerprint(snapshot) {
    return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  }

  #apply(plan, actorId) {
    this.#participants(plan);
    const options = { reason: plan.reason, note: plan.reason, contentStrategy: plan.contentStrategy ?? 'primary' };
    if (plan.operation === 'merge') return this.memoryService.mergeMemories(plan.memoryId, plan.targetId, actorId, options);
    if (plan.operation === 'supersede') return this.memoryService.supersedeMemory(plan.memoryId, plan.targetId, actorId, plan.reason);
    if (plan.operation === 'delete') return this.memoryService.deleteMemory(plan.memoryId, actorId);
    return this.conflictService.resolveMemoryConflict(plan.conflictId, plan.resolution, actorId, options);
  }

  preview(plan, actorId) {
    const rollback = {};
    let before, after, result, domainDryRun = null;
    try {
      this.store.transaction(() => {
        before = this.#snapshot(plan);
        if (plan.operation === 'resolve') domainDryRun = this.conflictService.resolveMemoryConflict(plan.conflictId, plan.resolution, actorId, { dryRun: true });
        result = this.#apply(plan, actorId);
        after = this.#snapshot(plan);
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
    const previewId = randomUUID();
    const now = Date.now();
    for (const [id, preview] of this.previews) if (preview.expires < now) this.previews.delete(id);
    if (this.previews.size >= 100) this.previews.delete(this.previews.keys().next().value);
    this.previews.set(previewId, { plan: structuredClone(plan), fingerprint: this.#fingerprint(before), actorId, expires: now + 600000 });
    return { previewId, dryRun: true, provisionalIds: true, before, after, result, domainDryRun,
      historyPolicy: 'Old revisions, all sources, conflicts and Context Snapshots are preserved; deletion is soft.' };
  }

  execute(previewId, actorId) {
    return this.store.transaction(() => {
      const preview = this.previews.get(previewId);
      if (!preview || preview.actorId !== actorId || preview.expires < Date.now()) fail('PREVIEW_STALE', 'Preview expired. Preview again.');
      if (preview.fingerprint !== this.#fingerprint(this.#snapshot(preview.plan))) fail('PREVIEW_STALE', 'Data changed after preview. Preview again.');
      const result = this.#apply(preview.plan, actorId);
      this.previews.delete(previewId);
      return result;
    });
  }
}
