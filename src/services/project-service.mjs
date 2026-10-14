import { randomUUID } from 'node:crypto';
import { requireString } from '../db/validation.mjs';
import { assertUserActor } from '../domain/memory-policy.mjs';

export class ProjectService {
  constructor(store) { this.store = store; }

  createProject(actorId, name) {
    assertUserActor(this.store, actorId, 'creating a project');
    requireString(name, 'name');
    if (name.length > 120) throw new RangeError('Project name must be at most 120 characters');
    // Names may be Unicode or duplicated; stable identity never depends on name.
    return this.store.createProject({ name: name.trim(), slug: `project-${randomUUID()}` });
  }
}
