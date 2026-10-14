import { requireObject, requireString } from '../db/validation.mjs';
import {
  assertCanChangeLifecycle,
  assertCanEditMemory,
  assertCanLockMemory,
  assertCanPinMemory,
  assertSameProject,
  assertUserActor,
} from '../domain/memory-policy.mjs';
import { fail } from '../domain/errors.mjs';

const EDITABLE_FIELDS = new Set([
  'name', 'type', 'subtype', 'contextRole', 'summary', 'description', 'value', 'valueKind', 'unit', 'confidence',
]);

function revisionValue(revision) {
  if (revision.valueKind === 'text') return revision.valueText;
  if (revision.valueKind === 'number') return revision.valueNumber;
  if (revision.valueKind === 'boolean') return revision.valueBoolean;
  if (revision.valueKind === 'json') return revision.valueJson === null ? null : JSON.parse(revision.valueJson);
  return undefined;
}

function revisionInput(revision, overrides = {}, changeKind = 'edit') {
  const has = (name) => Object.hasOwn(overrides, name);
  const valueKind = has('valueKind') ? overrides.valueKind : revision.valueKind;
  const value = has('value') ? overrides.value : revisionValue(revision);
  return {
    name: has('name') ? overrides.name : revision.name,
    type: has('type') ? overrides.type : revision.type,
    subtype: has('subtype') ? overrides.subtype : revision.subtype,
    contextRole: has('contextRole') ? overrides.contextRole : revision.contextRole,
    summary: has('summary') ? overrides.summary : revision.summary,
    description: has('description') ? overrides.description : revision.description,
    confidence: has('confidence') ? overrides.confidence : revision.confidence,
    valueKind,
    ...(valueKind === 'none' ? {} : { value }),
    unit: has('unit') ? overrides.unit : revision.unit,
    changeKind,
    changeReason: overrides.changeReason ?? null,
  };
}

function uniqueSources(...collections) {
  const sources = new Map();
  for (const collection of collections) {
    for (const source of collection) sources.set(source.id, source);
  }
  return [...sources.values()];
}

function activeRelationKey(relation) {
  const [source, target] = relation.relationType === 'related_to' && relation.sourceMemoryId > relation.targetMemoryId
    ? [relation.targetMemoryId, relation.sourceMemoryId]
    : [relation.sourceMemoryId, relation.targetMemoryId];
  return `${source}|${target}|${relation.relationType}`;
}

function audit(operation, affectedMemories, { createdRevision = null, createdRelations = [], warnings = [], dryRun = false } = {}) {
  return { operation, affectedMemories, createdRevision, createdRelations, createdEvents: [], warnings, dryRun };
}

export class MemoryService {
  constructor(store) {
    if (!store) throw new TypeError('store is required');
    this.store = store;
  }

  createCandidate(projectId, actorId, revision, options = {}) {
    const actor = this.store.getActor(actorId);
    if (!actor) fail('ACTOR_NOT_FOUND', `Actor not found: ${actorId}`);
    if (!['codex', 'importer', 'system'].includes(actor.actorType)) {
      fail('CANDIDATE_ACTOR_REQUIRED', 'Candidate proposals require a Codex, importer, or system actor');
    }
    const memory = this.store.createMemory({
      projectId,
      actorId,
      revision,
      importance: options.importance ?? 'normal',
      lifecycleStatus: 'candidate',
      verificationStatus: 'unreviewed',
    });
    return audit('create_candidate', [memory]);
  }

  createManualMemory(projectId, actorId, input) {
    assertUserActor(this.store, actorId, 'creating a memory');
    requireObject(input, 'memory');
    return this.store.transaction(() => {
      const project = this.store.getProject(projectId);
      if (!project) fail('PROJECT_NOT_FOUND', 'Choose an existing project');
      if (project.status !== 'active') fail('PROJECT_NOT_ACTIVE', 'Cannot create memories in an archived project');
      if (input.subtype === 'metric_observation' || input.metricObservation) {
        fail('METRIC_STRUCTURE_REQUIRED', 'Manual Metric creation needs a separately scoped observation workflow');
      }
      const memory = this.store.createMemory({ projectId, actorId,
        lifecycleStatus: 'active', verificationStatus: 'user_confirmed',
        revision: { name: input.name, type: input.type, contextRole: input.contextRole ?? 'reference',
          summary: input.summary, description: input.description ?? null,
          confidence: 1, valueKind: 'none', changeKind: 'create' },
      });
      const actor = this.store.getActor(actorId);
      const source = this.store.createSource({ projectId, sourceType: 'manual_input', author: actor.displayName,
        originalText: [input.name, input.summary, input.description].filter(Boolean).join('\n\n'),
      });
      this.store.attachSourceToRevision(memory.currentRevisionId, { sourceId: source.id, evidenceRole: 'primary' });
      return audit('create_manual_memory', [memory], { createdRevision: memory.currentRevision });
    });
  }

  confirmMemory(memoryId, actorId, options = {}) {
    const memory = this.#memory(memoryId);
    assertUserActor(this.store, actorId, 'confirming a memory');
    if (memory.lifecycleStatus === 'active' && memory.verificationStatus === 'user_confirmed') {
      return audit('confirm_memory', [memory], { warnings: ['already_confirmed'] });
    }
    if (memory.lifecycleStatus !== 'candidate') {
      fail('INVALID_LIFECYCLE_TRANSITION', 'Only a candidate can be confirmed', {
        memoryId, lifecycleStatus: memory.lifecycleStatus, verificationStatus: memory.verificationStatus,
      });
    }
    const updated = this.store.transitionMemoryState(memoryId, {
      actorId, lifecycleStatus: 'active', verificationStatus: 'user_confirmed', eventType: 'confirmed',
      note: options.note ?? null,
    });
    return audit('confirm_memory', [updated]);
  }

  markMemoryOutdated(memoryId, actorId, options = {}) {
    const memory = this.#memory(memoryId);
    if (memory.lifecycleStatus === 'outdated') return audit('mark_outdated', [memory], { warnings: ['already_outdated'] });
    assertCanChangeLifecycle(this.store, memory, actorId, 'outdated');
    const updated = this.store.transitionMemoryState(memoryId, {
      actorId, lifecycleStatus: 'outdated', eventType: 'marked_outdated', note: options.reason ?? null,
    });
    return audit('mark_outdated', [updated]);
  }

  rejectMemory(memoryId, actorId, options = {}) {
    const memory = this.#memory(memoryId);
    if (memory.lifecycleStatus === 'rejected') return audit('reject_memory', [memory], { warnings: ['already_rejected'] });
    assertCanChangeLifecycle(this.store, memory, actorId, 'rejected');
    const updated = this.store.transitionMemoryState(memoryId, {
      actorId, lifecycleStatus: 'rejected', eventType: 'rejected', note: options.reason ?? null,
    });
    return audit('reject_memory', [updated]);
  }

  restoreMemory(memoryId, actorId, options = {}) {
    const memory = this.#memory(memoryId);
    assertUserActor(this.store, actorId, 'restoring a memory');
    if (memory.lifecycleStatus === 'rejected') {
      assertCanChangeLifecycle(this.store, memory, actorId, 'candidate');
      const updated = this.store.transitionMemoryState(memoryId, {
        actorId, lifecycleStatus: 'candidate', verificationStatus: 'unreviewed', eventType: 'restored', note: options.reason ?? null,
      });
      return audit('restore_memory', [updated]);
    }
    if (memory.lifecycleStatus === 'deleted') {
      const lifecycleStatus = options.lifecycleStatus ?? 'candidate';
      assertCanChangeLifecycle(this.store, memory, actorId, lifecycleStatus);
      const updated = this.store.restoreMemory(memoryId, {
        actorId, lifecycleStatus,
        verificationStatus: lifecycleStatus === 'candidate' ? 'unreviewed' : memory.verificationStatus,
      });
      return audit('restore_memory', [updated]);
    }
    if (memory.lifecycleStatus === 'superseded') {
      assertCanChangeLifecycle(this.store, memory, actorId, 'active');
      const updated = this.store.transitionMemoryState(memoryId, {
        actorId, lifecycleStatus: 'active', eventType: 'restored', note: options.reason ?? null,
      });
      return audit('restore_memory', [updated]);
    }
    fail('INVALID_LIFECYCLE_TRANSITION', 'Only rejected, deleted, or superseded memories can be restored', { memoryId });
  }

  changeImportance(memoryId, actorId, importance, options = {}) {
    const memory = this.#memory(memoryId);
    assertCanEditMemory(this.store, memory, actorId);
    const updated = this.store.setMemoryImportance(memoryId, { actorId, importance, note: options.reason ?? null });
    return audit('change_importance', [updated]);
  }

  editMemory(memoryId, actorId, changes, options = {}) {
    return this.store.transaction(() => this.#editMemory(memoryId, actorId, changes, options));
  }

  #editMemory(memoryId, actorId, changes, options) {
    const memory = this.#memory(memoryId);
    if (memory.lifecycleStatus === 'deleted') fail('MEMORY_NOT_ACTIVE', 'Restore a deleted Memory before editing');
    if (options.expectedRevisionId !== undefined && options.expectedRevisionId !== memory.currentRevisionId) {
      fail('REVISION_MISMATCH', 'The memory changed after editing began. Reload and review; do not resubmit the old form.', {
        expectedRevisionId: options.expectedRevisionId, currentRevisionId: memory.currentRevisionId,
      });
    }
    assertCanEditMemory(this.store, memory, actorId);
    requireObject(changes, 'changes');
    for (const field of Object.keys(changes)) {
      if (!EDITABLE_FIELDS.has(field) && field !== 'changeReason') {
        fail('INVALID_EDIT_FIELD', `Cannot edit Memory control field through editMemory: ${field}`, { field });
      }
    }
    if (Object.hasOwn(changes, 'value') && !Object.hasOwn(changes, 'valueKind') && memory.currentRevision.valueKind === 'none') {
      fail('VALUE_KIND_REQUIRED', 'Editing a value on a valueless revision also requires valueKind', { memoryId });
    }
    const observation = this.store.getMetricObservation(memory.currentRevisionId);
    const input = revisionInput(memory.currentRevision, changes, 'edit');
    let metric = null;
    if (observation) {
      if (input.type !== 'fact' || input.subtype !== 'metric_observation' || input.valueKind !== 'none') {
        fail('METRIC_STRUCTURE_REQUIRED', 'Metric content must retain fact / metric_observation and valueKind none');
      }
      const patch = options.metricObservation ?? {};
      requireObject(patch, 'metricObservation');
      for (const field of Object.keys(patch)) {
        if (!['valueRaw', 'valueNumber', 'unit'].includes(field)) {
          fail('METRIC_SCOPE_CHANGE', 'Different Dataset, Split, Protocol, Run or Checkpoint is a separate observation, not a value correction', { field });
        }
      }
      const raw = patch.valueRaw ?? (patch.valueNumber !== undefined ? String(patch.valueNumber) : observation.valueRaw);
      if (typeof raw !== 'string' || !raw.trim() || !Number.isFinite(Number(raw))) fail('INVALID_METRIC_VALUE', 'Metric value must be a finite number');
      const number = Number(raw);
      if (patch.valueNumber !== undefined && patch.valueNumber !== number) fail('INVALID_METRIC_VALUE', 'Raw and numeric metric values disagree');
      metric = { ...observation, ...patch, valueRaw: raw, valueNumber: number };
    } else if (input.subtype === 'metric_observation' || options.metricObservation) {
      fail('METRIC_STRUCTURE_REQUIRED', 'This editor cannot convert a non-metric Memory into a metric');
    }
    const revision = this.store.createRevision(memoryId, {
      actorId,
      ...input,
    });
    if (metric) this.store.createMetricObservation({ ...metric, revisionId: revision.id });
    for (const source of this.store.listSourcesForRevision(memory.currentRevisionId)) {
      this.store.attachSourceToRevision(revision.id, { sourceId: source.id, evidenceRole: source.evidenceRole });
    }
    return audit('edit_memory', [this.#memory(memoryId)], { createdRevision: revision });
  }

  lockMemory(memoryId, actorId, reason = null) {
    const memory = this.#memory(memoryId);
    assertCanLockMemory(this.store, memory, actorId);
    return audit('lock_memory', [this.store.lockMemory(memoryId, { actorId, reason })]);
  }

  unlockMemory(memoryId, actorId) {
    const memory = this.#memory(memoryId);
    assertCanLockMemory(this.store, memory, actorId);
    return audit('unlock_memory', [this.store.unlockMemory(memoryId, { actorId })]);
  }

  pinMemory(memoryId, actorId) {
    const memory = this.#memory(memoryId);
    assertCanPinMemory(this.store, memory, actorId);
    return audit('pin_memory', [this.store.pinMemory(memoryId, { actorId })]);
  }

  unpinMemory(memoryId, actorId) {
    const memory = this.#memory(memoryId);
    assertCanPinMemory(this.store, memory, actorId);
    return audit('unpin_memory', [this.store.unpinMemory(memoryId, { actorId })]);
  }

  addNote(memoryId, actorId, content) {
    const memory = this.#memory(memoryId);
    assertCanEditMemory(this.store, memory, actorId);
    const note = this.store.addMemoryNote(memoryId, { actorId, content });
    return { ...audit('add_note', [this.#memory(memoryId)]), note };
  }

  listNotes(memoryId, options = {}) {
    this.#memory(memoryId);
    return this.store.listMemoryNotes(memoryId, options);
  }

  deleteNote(noteId, actorId, reason = null) {
    assertUserActor(this.store, actorId, 'deleting a note');
    const note = this.store.softDeleteMemoryNote(noteId, { actorId, reason });
    return { ...audit('delete_note', [this.#memory(note.memoryId)]), note };
  }

  deleteMemory(memoryId, actorId) {
    const memory = this.#memory(memoryId);
    assertCanChangeLifecycle(this.store, memory, actorId, 'deleted');
    return audit('delete_memory', [this.store.softDeleteMemory(memoryId, { actorId })]);
  }

  supersedeMemory(oldMemoryId, newMemoryId, actorId, reason, options = {}) {
    if (oldMemoryId === newMemoryId) fail('MERGE_SELF', 'A memory cannot supersede itself', { memoryId: oldMemoryId });
    const oldMemory = this.#memory(oldMemoryId);
    const newMemory = this.#memory(newMemoryId);
    assertSameProject(oldMemory, newMemory);
    assertCanChangeLifecycle(this.store, oldMemory, actorId, 'superseded');
    assertUserActor(this.store, actorId, 'superseding a memory');
    requireString(reason, 'reason');
    if (['deleted', 'rejected', 'superseded'].includes(newMemory.lifecycleStatus)) {
      fail('MEMORY_NOT_ACTIVE', 'The replacement memory must be a candidate, active, or outdated memory', { newMemoryId });
    }
    let relation = null;
    this.store.transaction(() => {
      this.store.transitionMemoryState(oldMemoryId, {
        actorId, lifecycleStatus: 'superseded', eventType: 'superseded', note: reason,
        metadata: { successorMemoryId: newMemoryId },
      });
      const currentNew = this.#memory(newMemoryId);
      if (currentNew.lifecycleStatus !== 'active' || currentNew.verificationStatus !== 'user_confirmed') {
        this.store.transitionMemoryState(newMemoryId, {
          actorId, lifecycleStatus: 'active', verificationStatus: 'user_confirmed', eventType: 'confirmed', note: reason,
          metadata: { replacesMemoryId: oldMemoryId },
        });
      }
      relation = this.#activeRelation(newMemory.projectId, newMemoryId, oldMemoryId, 'supersedes')
        ?? this.store.createRelation({
          projectId: newMemory.projectId,
          sourceMemoryId: newMemoryId,
          targetMemoryId: oldMemoryId,
          relationType: 'supersedes', confidence: 1, actorId, sourceIds: options.sourceIds ?? [],
        });
    });
    return audit('supersede_memory', [this.#memory(oldMemoryId), this.#memory(newMemoryId)], { createdRelations: [relation] });
  }

  mergeMemories(primaryId, secondaryId, actorId, options = {}) {
    if (primaryId === secondaryId) fail('MERGE_SELF', 'A memory cannot be merged with itself', { memoryId: primaryId });
    const primary = this.#memory(primaryId);
    const secondary = this.#memory(secondaryId);
    assertSameProject(primary, secondary);
    assertCanEditMemory(this.store, primary, actorId);
    if (secondary.lifecycleStatus === 'candidate') assertCanChangeLifecycle(this.store, secondary, actorId, 'active');
    else assertCanChangeLifecycle(this.store, secondary, actorId, 'superseded');
    assertUserActor(this.store, actorId, 'merging memories');
    const strategy = options.contentStrategy ?? 'primary';
    if (!['primary', 'secondary', 'manual'].includes(strategy)) fail('INVALID_MERGE_STRATEGY', 'Unknown merge content strategy', { strategy });
    let revisionInputForMerge;
    if (strategy === 'manual') {
      requireObject(options.revision, 'merge.revision');
      revisionInputForMerge = { ...options.revision, changeKind: 'merge', changeReason: options.reason ?? 'Merged duplicate memories' };
    } else {
      revisionInputForMerge = revisionInput(
        strategy === 'primary' ? primary.currentRevision : secondary.currentRevision,
        { changeReason: options.reason ?? 'Merged duplicate memories' },
        'merge',
      );
    }
    const sourceLinks = uniqueSources(
      this.store.listSourcesForRevision(primary.currentRevisionId),
      this.store.listSourcesForRevision(secondary.currentRevisionId),
    );
    const existingRelations = this.store.listRelations({ projectId: primary.projectId });
    const createdRelations = [];
    let createdRevision;
    this.store.transaction(() => {
      createdRevision = this.store.createRevision(primaryId, { actorId, ...revisionInputForMerge });
      if (createdRevision.subtype === 'metric_observation') {
        if (strategy === 'manual') fail('METRIC_STRUCTURE_REQUIRED', 'Manual Metric merge requires a separate observation workflow');
        const selected = strategy === 'primary' ? primary : secondary;
        const metric = this.store.getMetricObservation(selected.currentRevisionId);
        if (!metric) fail('METRIC_STRUCTURE_REQUIRED', 'Metric merge requires its Observation');
        const other = this.store.getMetricObservation((strategy === 'primary' ? secondary : primary).currentRevisionId);
        const scopeFields = ['scopeKey', 'subjectMemoryId', 'metricName', 'datasetMemoryId', 'split', 'protocol', 'runLabel', 'checkpoint'];
        if (other && scopeFields.some((field) => other[field] !== metric[field])) {
          fail('METRIC_SCOPE_CHANGE', 'Different metric scopes cannot be merged as a correction');
        }
        this.store.createMetricObservation({ ...metric, revisionId: createdRevision.id });
      }
      for (const source of sourceLinks) {
        this.store.attachSourceToRevision(createdRevision.id, { sourceId: source.id, evidenceRole: source.evidenceRole ?? 'supporting' });
      }
      const currentPrimary = this.#memory(primaryId);
      if (currentPrimary.lifecycleStatus !== 'active' || currentPrimary.verificationStatus !== 'user_confirmed') {
        this.store.transitionMemoryState(primaryId, {
          actorId, lifecycleStatus: 'active', verificationStatus: 'user_confirmed', eventType: 'confirmed',
          note: options.reason ?? null,
        });
      }
      if (this.#memory(secondaryId).lifecycleStatus === 'candidate') {
        this.store.transitionMemoryState(secondaryId, {
          actorId, lifecycleStatus: 'active', verificationStatus: 'user_confirmed', eventType: 'confirmed',
          note: options.reason ?? 'Accepted for merge',
        });
      }
      this.store.transitionMemoryState(secondaryId, {
        actorId, lifecycleStatus: 'superseded', eventType: 'superseded', note: options.reason ?? 'Merged into primary memory',
        metadata: { successorMemoryId: primaryId },
      });
      this.store.transitionMemoryState(primaryId, {
        actorId,
        lifecycleStatus: this.#memory(primaryId).lifecycleStatus,
        verificationStatus: this.#memory(primaryId).verificationStatus,
        eventType: 'merged', note: options.reason ?? 'Merged duplicate memories', metadata: { secondaryMemoryId: secondaryId },
      });
      this.store.transitionMemoryState(secondaryId, {
        actorId,
        lifecycleStatus: 'superseded',
        verificationStatus: this.#memory(secondaryId).verificationStatus,
        eventType: 'merged', note: options.reason ?? 'Merged into primary memory', metadata: { primaryMemoryId: primaryId },
      });
      const supersedes = this.#activeRelation(primary.projectId, primaryId, secondaryId, 'supersedes')
        ?? this.store.createRelation({
          projectId: primary.projectId, sourceMemoryId: primaryId, targetMemoryId: secondaryId,
          relationType: 'supersedes', confidence: 1, actorId,
        });
      createdRelations.push(supersedes);

      const keys = new Set(existingRelations.map(activeRelationKey));
      for (const relation of existingRelations.filter((item) => item.sourceMemoryId === secondaryId || item.targetMemoryId === secondaryId)) {
        const sourceMemoryId = relation.sourceMemoryId === secondaryId ? primaryId : relation.sourceMemoryId;
        const targetMemoryId = relation.targetMemoryId === secondaryId ? primaryId : relation.targetMemoryId;
        if (sourceMemoryId === targetMemoryId) continue;
        const candidate = { ...relation, sourceMemoryId, targetMemoryId };
        const key = activeRelationKey(candidate);
        if (keys.has(key)) continue;
        const relationSources = this.store.listSourcesForRelation(relation.id);
        createdRelations.push(this.store.createRelation({
          projectId: primary.projectId, sourceMemoryId, targetMemoryId, relationType: relation.relationType,
          confidence: relation.confidence, actorId, sourceIds: relationSources.map((source) => source.id),
        }));
        keys.add(key);
      }
    });
    return audit('merge_memories', [this.#memory(primaryId), this.#memory(secondaryId)], {
      createdRevision,
      createdRelations,
    });
  }

  #activeRelation(projectId, sourceMemoryId, targetMemoryId, relationType) {
    return this.store.listRelations({ projectId, sourceMemoryId, targetMemoryId })
      .find((relation) => relation.relationType === relationType) ?? null;
  }

  #memory(memoryId) {
    const memory = this.store.getMemory(memoryId, { includeDeleted: true });
    if (!memory) fail('MEMORY_NOT_FOUND', `Memory not found: ${memoryId}`, { memoryId });
    return memory;
  }
}
