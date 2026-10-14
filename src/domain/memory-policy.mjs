import { DomainError, fail } from './errors.mjs';

export const LIFECYCLE_TRANSITION_MATRIX = Object.freeze({
  candidate: Object.freeze({ active: ['user'], rejected: ['user'], deleted: ['user'] }),
  active: Object.freeze({ outdated: ['user'], superseded: ['user'], rejected: ['user'], deleted: ['user'] }),
  outdated: Object.freeze({ active: ['user'], superseded: ['user'], deleted: ['user'] }),
  superseded: Object.freeze({ active: ['user'] }),
  rejected: Object.freeze({ candidate: ['user'], deleted: ['user'] }),
  deleted: Object.freeze({ candidate: ['user'], active: ['user'], outdated: ['user'] }),
});

function actorFor(store, actorId) {
  const actor = store.getActor(actorId);
  if (!actor) fail('ACTOR_NOT_FOUND', `Actor not found: ${actorId}`, { actorId });
  return actor;
}

export function assertUserActor(store, actorId, action) {
  const actor = actorFor(store, actorId);
  if (actor.actorType !== 'user') {
    fail('USER_ACTION_REQUIRED', `${action} requires an explicit user actor`, {
      action,
      actorId,
      actorType: actor.actorType,
    });
  }
  return actor;
}

export function assertCanEditMemory(store, memory, actorId) {
  const actor = actorFor(store, actorId);
  if (memory.isLocked && actor.actorType !== 'user') {
    fail('MEMORY_LOCKED', 'Locked memory can only be changed by an explicit user action', {
      memoryId: memory.id,
      actorId,
    });
  }
  if (actor.actorType !== 'user') {
    fail('USER_ACTION_REQUIRED', 'Editing an established memory requires an explicit user actor', {
      memoryId: memory.id,
      actorId,
      actorType: actor.actorType,
    });
  }
  return actor;
}

export function assertCanLockMemory(store, memory, actorId) {
  return assertUserActor(store, actorId, memory.isLocked ? 'unlocking a memory' : 'locking a memory');
}

export function assertCanPinMemory(store, memory, actorId) {
  return assertUserActor(store, actorId, memory.isPinned ? 'unpinning a memory' : 'pinning a memory');
}

export function assertCanChangeLifecycle(store, memory, actorId, toStatus) {
  const actor = assertCanEditMemory(store, memory, actorId);
  if (memory.lifecycleStatus === toStatus) return actor;
  const allowedActors = LIFECYCLE_TRANSITION_MATRIX[memory.lifecycleStatus]?.[toStatus] ?? [];
  if (!allowedActors.includes(actor.actorType)) {
    fail('INVALID_LIFECYCLE_TRANSITION', `Cannot transition ${memory.lifecycleStatus} to ${toStatus}`, {
      memoryId: memory.id,
      fromStatus: memory.lifecycleStatus,
      toStatus,
      actorType: actor.actorType,
    });
  }
  return actor;
}

export function assertCanResolveConflict(store, actorId) {
  return assertUserActor(store, actorId, 'resolving a conflict');
}

export function assertConflictOpen(conflict) {
  if (!conflict) fail('CONFLICT_NOT_FOUND', 'Conflict was not found');
  if (conflict.status !== 'open') {
    fail('CONFLICT_ALREADY_RESOLVED', 'Only open conflicts can be resolved', { conflictId: conflict.id });
  }
  return conflict;
}

export function assertSameProject(...memories) {
  if (new Set(memories.map((memory) => memory.projectId)).size !== 1) {
    fail('PROJECT_MISMATCH', 'Memory operations cannot cross project boundaries');
  }
}

export { DomainError };
