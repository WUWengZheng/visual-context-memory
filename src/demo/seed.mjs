import { VisualContextMemoryStore } from '../db/store.mjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectSlug = 'visual-context-memory-demo';
const actorExternalId = 'visual-context-memory:demo-user';

function revision(name, type, contextRole, summary, extra = {}) {
  return { name, type, contextRole, summary, confidence: 0.95, ...extra };
}

export function seedDemo({ dbPath = process.env.VCM_DB_PATH } = {}) {
  const store = new VisualContextMemoryStore({ dbPath });
  try {
    const existing = store.findProjectBySlug(projectSlug);
    if (existing) return { created: false, project: existing };
    const project = store.createProject({ name: 'Visual Context Memory — Demo', slug: projectSlug, description: 'Read-only graph viewer demonstration data.' });
    const actor = store.findActorByExternalId(actorExternalId) ?? store.createActor({ actorType: 'user', displayName: 'Demo architect', externalId: actorExternalId });
    const memories = {};
    const add = (key, name, type, contextRole, summary, options = {}) => {
      const memory = store.createMemory({ projectId: project.id, actorId: actor.id, importance: options.importance ?? 'normal', lifecycleStatus: options.lifecycleStatus ?? 'active', isLocked: options.locked ?? false, isPinned: options.pinned ?? false, lockReason: options.lockReason, revision: revision(name, type, contextRole, summary, options.revision) });
      memories[key] = memory;
      return memory;
    };
    add('comp2dpass', 'COMP-2DPASS', 'entity', 'reference', 'A component used in the perception pipeline.');
    add('semanticKitti', 'SemanticKITTI', 'entity', 'reference', 'The semantic segmentation benchmark dataset.');
    add('stage1', 'Stage1', 'decision', 'current_plan', 'Establish a clean 2D baseline.');
    add('stage2a', 'Stage2A', 'decision', 'current_plan', 'Add prototype retrieval before prompt fusion.');
    add('stage2b', 'Stage2B', 'decision', 'current_plan', 'Fuse retrieved prototypes with pseudo prompts.', { pinned: true, importance: 'high' });
    add('prototype', 'Prototype Retrieval', 'entity', 'current_state', 'Retrieve visual prototypes from the embedding bank.');
    add('pseudoPrompt', 'Pseudo Prompt', 'entity', 'current_state', 'A generated prompt used to guide fusion.');
    add('cameraMissing', 'Camera Missing', 'issue', 'known_issue', 'Camera inputs are unavailable in one evaluation setting.', { lifecycleStatus: 'outdated' });
    const metric = add('metric', 'Stage1 Clean mIoU 65.433', 'fact', 'result', 'Fictional demo: Stage1 achieved 65.433 Clean mIoU on validation.', { locked: true, importance: 'high', lockReason: 'Demonstration baseline retained for comparison.', revision: { subtype: 'metric_observation', valueKind: 'none' } });
    add('fusionConstraint', 'Fusion classifier constraint', 'constraint', 'constraint', 'The fusion classifier must retain class calibration.', { locked: true, lockReason: 'Architecture safeguard.' });
    add('missingCameraExperiment', 'Missing Camera Experiment', 'fact', 'result', 'Experiment isolates behavior when the camera modality is missing.', { lifecycleStatus: 'candidate' });
    const source = store.createSource({ projectId: project.id, sourceType: 'experiment_log', originalText: 'Stage1 clean validation: mIoU = 65.433 at epoch 57.', locator: 'run/stage1-clean/epoch-57' });
    store.attachSourceToRevision(metric.currentRevisionId, { sourceId: source.id, evidenceRole: 'primary' });
    store.createMetricObservation({ revisionId: metric.currentRevisionId, subjectMemoryId: memories.stage1.id, metricName: 'Clean mIoU', valueNumber: 65.433, valueRaw: '65.433', unit: 'mIoU', datasetMemoryId: memories.semanticKitti.id, split: 'validation', protocol: 'clean', checkpoint: 'epoch-57', runLabel: 'stage1-clean', scopeKey: 'semantic-kitti:validation:clean' });
    const relate = (sourceKey, targetKey, relationType) => store.createRelation({ projectId: project.id, sourceMemoryId: memories[sourceKey].id, targetMemoryId: memories[targetKey].id, relationType, confidence: 0.92, actorId: actor.id });
    relate('stage1', 'comp2dpass', 'uses'); relate('stage1', 'semanticKitti', 'evaluated_on'); relate('stage1', 'metric', 'has_result'); relate('stage2a', 'stage1', 'depends_on'); relate('stage2b', 'stage2a', 'depends_on'); relate('stage2b', 'prototype', 'uses'); relate('stage2b', 'pseudoPrompt', 'uses'); relate('fusionConstraint', 'stage2b', 'constrains'); relate('missingCameraExperiment', 'cameraMissing', 'addresses'); relate('missingCameraExperiment', 'semanticKitti', 'evaluated_on');
    return { created: true, project, memories };
  } finally { store.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = seedDemo();
  console.log(result.created ? `Seeded demo project: ${result.project.name}` : `Demo project already exists: ${result.project.name}`);
}
