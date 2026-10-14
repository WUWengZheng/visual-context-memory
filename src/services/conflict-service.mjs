import { requireEnum, requireObject } from '../db/validation.mjs';
import { assertCanResolveConflict, assertConflictOpen, assertSameProject } from '../domain/memory-policy.mjs';
import { fail } from '../domain/errors.mjs';

const RESOLUTIONS = ['keep_existing', 'use_incoming', 'keep_both', 'merge', 'mark_existing_outdated', 'reject_incoming'];

export class ConflictService {
  constructor(store, memoryService) {
    if (!store || !memoryService) throw new TypeError('store and memoryService are required');
    this.store = store;
    this.memoryService = memoryService;
  }

  resolveMemoryConflict(conflictId, resolution, actorId, options = {}) {
    requireObject(options, 'conflictResolution.options');
    const conflict = assertConflictOpen(this.store.getConflict(conflictId));
    const existing = this.#memory(conflict.existingMemoryId);
    const incoming = this.#memory(conflict.incomingMemoryId);
    assertSameProject(existing, incoming);
    const selectedResolution = requireEnum(resolution, RESOLUTIONS, 'conflictResolution.resolution');
    if (options.dryRun === true) {
      const actor = this.store.getActor(actorId);
      return {
        operation: 'resolve_memory_conflict', dryRun: true,
        affectedMemories: [existing, incoming], createdRevision: null, createdRelations: [], createdEvents: [], warnings: [],
        lifecycleChanges: this.#plannedTransitions(selectedResolution, existing, incoming),
        lockedMemoryIds: [existing, incoming].filter((memory) => memory.isLocked).map((memory) => memory.id),
        userActionRequired: actor?.actorType !== 'user',
      };
    }
    assertCanResolveConflict(this.store, actorId);
    let operationResult = null;
    this.store.transaction(() => {
      switch (selectedResolution) {
        case 'keep_existing':
          if (!options.keepIncomingCandidate) operationResult = this.memoryService.rejectMemory(incoming.id, actorId, { reason: options.note ?? 'Kept existing memory' });
          else operationResult = { operation: 'keep_existing', affectedMemories: [existing, incoming], createdRevision: null, createdRelations: [], createdEvents: [], warnings: ['incoming_kept_candidate'] };
          break;
        case 'use_incoming':
          operationResult = this.memoryService.supersedeMemory(existing.id, incoming.id, actorId, options.reason ?? options.note ?? 'Use incoming memory', options);
          break;
        case 'keep_both':
          operationResult = incoming.lifecycleStatus === 'candidate'
            ? this.memoryService.confirmMemory(incoming.id, actorId, { note: options.note ?? 'Both memories are valid in distinct scope' })
            : { operation: 'keep_both', affectedMemories: [existing, incoming], createdRevision: null, createdRelations: [], createdEvents: [], warnings: [] };
          break;
        case 'mark_existing_outdated':
          operationResult = this.memoryService.markMemoryOutdated(existing.id, actorId, { reason: options.reason ?? options.note ?? 'Incoming memory is current' });
          if (this.#memory(incoming.id).lifecycleStatus === 'candidate') this.memoryService.confirmMemory(incoming.id, actorId, { note: options.note ?? null });
          break;
        case 'reject_incoming':
          operationResult = this.memoryService.rejectMemory(incoming.id, actorId, { reason: options.reason ?? options.note ?? 'Rejected incoming memory' });
          break;
        case 'merge':
          operationResult = this.memoryService.mergeMemories(options.primaryMemoryId ?? existing.id, options.secondaryMemoryId ?? incoming.id, actorId, options);
          break;
        default:
          fail('INVALID_CONFLICT_RESOLUTION', 'Unsupported conflict resolution');
      }
      const resultMemoryId = selectedResolution === 'merge'
        ? (options.primaryMemoryId ?? existing.id)
        : selectedResolution === 'use_incoming' || selectedResolution === 'keep_both' || selectedResolution === 'mark_existing_outdated'
          ? incoming.id
          : existing.id;
      const resultMemory = this.#memory(resultMemoryId);
      this.store.resolveConflict(conflictId, {
        actorId, resolution: selectedResolution, note: options.note ?? null,
        resultMemoryId: resultMemory.id, resultRevisionId: resultMemory.currentRevisionId,
      });
    });
    return {
      ...operationResult,
      operation: 'resolve_memory_conflict',
      conflict: this.store.getConflict(conflictId),
      affectedMemories: [this.#memory(existing.id), this.#memory(incoming.id)],
    };
  }

  #plannedTransitions(resolution, existing, incoming) {
    if (resolution === 'use_incoming') return [{ memoryId: existing.id, to: 'superseded' }, { memoryId: incoming.id, to: 'active' }];
    if (resolution === 'mark_existing_outdated') return [{ memoryId: existing.id, to: 'outdated' }, { memoryId: incoming.id, to: 'active' }];
    if (resolution === 'keep_both') return [{ memoryId: incoming.id, to: 'active' }];
    if (resolution === 'merge') return [{ memoryId: incoming.id, to: 'superseded' }];
    if (resolution === 'keep_existing' || resolution === 'reject_incoming') return [{ memoryId: incoming.id, to: 'rejected' }];
    return [];
  }

  #memory(id) {
    const memory = this.store.getMemory(id, { includeDeleted: true });
    if (!memory) fail('MEMORY_NOT_FOUND', `Memory not found: ${id}`, { memoryId: id });
    return memory;
  }
}
