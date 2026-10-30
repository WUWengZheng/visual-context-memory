import { requestError, sendJson } from './response.mjs';

const MAX_JSON_BODY_BYTES = 64 * 1024;
const MAX_SEARCH_LENGTH = 200;
const MAX_NOTE_LENGTH = 4000;
const MAX_DESCRIPTION_LENGTH = 16000;

function parseInteger(value, { name, min, max, fallback }) {
  if (value === null) return fallback;
  if (!/^-?\d+$/u.test(value)) throw requestError('INVALID_QUERY', `${name} must be an integer`);
  const parsed = Number(value);
  if (parsed < min || parsed > max) throw requestError('INVALID_QUERY', `${name} must be between ${min} and ${max}`);
  return parsed;
}

function parseBoolean(value, name) {
  if (value === null) return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw requestError('INVALID_QUERY', `${name} must be true or false`);
}

function readFilters(params) {
  return {
    type: params.get('type') ?? null,
    lifecycleStatus: params.get('status') ?? null,
    locked: parseBoolean(params.get('locked'), 'locked'),
    pinned: parseBoolean(params.get('pinned'), 'pinned'),
  };
}

function requireText(value, label, maxLength) {
  if (typeof value !== 'string' || value.trim().length === 0) throw requestError('INVALID_REQUEST', `${label} must be a non-empty string`);
  if (value.length > maxLength) throw requestError('REQUEST_LIMIT_EXCEEDED', `${label} is too long`, 413, { maxLength });
  return value;
}

async function readJsonBody(request) {
  const declaredLength = Number(request.headers['content-length'] ?? 0);
  if (declaredLength > MAX_JSON_BODY_BYTES) throw requestError('BODY_TOO_LARGE', 'JSON request body exceeds the 64 KiB limit', 413);
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_JSON_BODY_BYTES) throw requestError('BODY_TOO_LARGE', 'JSON request body exceeds the 64 KiB limit', 413);
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('body must be a JSON object');
    return value;
  } catch (error) {
    if (error.httpStatus) throw error;
    throw requestError('INVALID_JSON', 'Request body must be valid JSON');
  }
}

function compactOptions(body, names) {
  return Object.fromEntries(names.filter((name) => Object.hasOwn(body, name)).map((name) => [name, body[name]]));
}

export function createRouter({ readService, graphService, memoryService, conflictService, actorService, editorService, projectService, recallService }) {
  return async function route(request, response) {
    const url = new URL(request.url, 'http://127.0.0.1');
    const { pathname, searchParams } = url;
    const method = request.method;
    if (!pathname.startsWith('/api/')) throw requestError('ROUTE_NOT_FOUND', 'Route not found', 404);
    if (method === 'GET' && pathname === '/api/health') return sendJson(response, 200, readService.health());
    if (method === 'GET' && pathname === '/api/projects') return sendJson(response, 200, readService.listProjects());
    if (method === 'GET' && pathname === '/api/recall') {
      const queries = searchParams.getAll('q');
      if (queries.length < 1 || queries.length > 5) throw requestError('INVALID_QUERY', 'Recall requires 1–5 q parameters');
      queries.forEach((query) => requireText(query, 'q', MAX_SEARCH_LENGTH));
      return sendJson(response, 200, recallService.recall({
        projectId: searchParams.get('project'), queries, ...readFilters(searchParams),
        view: searchParams.get('view') ?? 'full',
        neighbors: parseInteger(searchParams.get('neighbors'), { name: 'neighbors', min: 0, max: 1, fallback: 0 }),
        limit: parseInteger(searchParams.get('limit'), { name: 'limit', min: 1, max: 50, fallback: 20 }),
      }));
    }
    if (method === 'POST' && pathname === '/api/projects') {
      const body = await readJsonBody(request);
      return sendJson(response, 201, projectService.createProject(actorService.getOrCreateUserActor().id,
        requireText(body.name, 'name', 120)));
    }
    if (method === 'GET' && pathname === '/api/memories') {
      return sendJson(response, 200, readService.listMemories({
        projectId: searchParams.get('project') ?? undefined,
        ...readFilters(searchParams),
        page: parseBoolean(searchParams.get('page'), 'page') ?? false,
        offset: parseInteger(searchParams.get('offset'), { name: 'offset', min: 0, max: 1000000, fallback: 0 }),
        limit: parseInteger(searchParams.get('limit'), { name: 'limit', min: 1, max: 200, fallback: 100 }),
      }));
    }
    if (method === 'POST' && pathname === '/api/memories') {
      const body = await readJsonBody(request);
      requireText(body.projectId, 'projectId', 100);
      requireText(body.name, 'name', 200);
      requireText(body.summary, 'summary', 4000);
      if (body.description !== undefined && body.description !== null) {
        if (typeof body.description !== 'string') throw requestError('INVALID_REQUEST', 'description must be text');
        if (body.description.length > MAX_DESCRIPTION_LENGTH) throw requestError('REQUEST_LIMIT_EXCEEDED', 'description is too long', 413);
      }
      return sendJson(response, 201, memoryService.createManualMemory(body.projectId, actorService.getOrCreateUserActor().id,
        compactOptions(body, ['name', 'type', 'contextRole', 'summary', 'description', 'subtype', 'metricObservation'])));
    }
    if (method === 'GET' && pathname === '/api/search') {
      const query = searchParams.get('q');
      return sendJson(response, 200, readService.search({
        projectId: searchParams.get('project') ?? undefined,
        query: requireText(query, 'q', MAX_SEARCH_LENGTH),
        ...readFilters(searchParams),
        page: parseBoolean(searchParams.get('page'), 'page') ?? false,
        offset: parseInteger(searchParams.get('offset'), { name: 'offset', min: 0, max: 1000000, fallback: 0 }),
        limit: parseInteger(searchParams.get('limit'), { name: 'limit', min: 1, max: 200, fallback: 50 }),
      }));
    }
    if (method === 'GET' && pathname === '/api/conflicts') {
      return sendJson(response, 200, readService.listConflicts({ projectId: searchParams.get('project') ?? undefined, status: searchParams.get('status') ?? null }));
    }
    if (method === 'GET' && pathname === '/api/context-sessions') {
      return sendJson(response, 200, readService.listContextSessions({ projectId: searchParams.get('project') ?? undefined }));
    }
    if (method === 'GET' && pathname === '/api/graph') {
      return sendJson(response, 200, graphService.getGraph({
        projectId: searchParams.get('project') ?? undefined,
        memoryId: searchParams.get('memoryId') ?? null,
        type: searchParams.get('type') ?? null,
        status: searchParams.get('status') ?? null,
        locked: parseBoolean(searchParams.get('locked'), 'locked'),
        pinned: parseBoolean(searchParams.get('pinned'), 'pinned'),
        limit: parseInteger(searchParams.get('limit'), { name: 'limit', min: 1, max: 200, fallback: 100 }),
        depth: parseInteger(searchParams.get('depth'), { name: 'depth', min: 1, max: 2, fallback: 1 }),
      }));
    }

    const segments = pathname.split('/').filter(Boolean);
    const resourceId = segments[2];
    if (method === 'POST' && segments[1] === 'editor') {
      const body = await readJsonBody(request);
      const user = actorService.getOrCreateUserActor();
      if (resourceId === 'preview') return sendJson(response, 200, editorService.preview(body, user.id));
      if (resourceId === 'execute') return sendJson(response, 200, editorService.execute(body.previewId, user.id));
    }
    if (method === 'POST' && segments[1] === 'notes' && segments[3] === 'delete') {
      const body = await readJsonBody(request);
      return sendJson(response, 200, memoryService.deleteNote(resourceId, actorService.getOrCreateUserActor().id, body.reason));
    }
    if (method === 'GET' && segments[1] === 'context-sessions' && segments.length === 3) return sendJson(response, 200, readService.getContextSession(resourceId));
    if (method === 'POST' && pathname === '/api/memories/merge') {
      const body = await readJsonBody(request);
      const user = actorService.getOrCreateUserActor();
      if (body.dryRun === true) return sendJson(response, 200, editorService.preview({
        operation: 'merge', projectId: readService.getMemoryDetail(body.primaryId).memory.projectId,
        memoryId: body.primaryId, targetId: body.secondaryId, ...compactOptions(body, ['contentStrategy', 'reason']),
      }, user.id));
      if (request.headers.origin !== undefined) return sendJson(response, 200, editorService.execute(body.previewId, user.id));
      return sendJson(response, 200, memoryService.mergeMemories(body.primaryId, body.secondaryId, user.id, compactOptions(body, ['contentStrategy', 'revision', 'reason'])));
    }
    if (segments[1] === 'memories' && resourceId) {
      if (method === 'GET' && segments.length === 3) return sendJson(response, 200, readService.getMemoryDetail(resourceId));
      if (method === 'GET' && segments.length === 4 && segments[3] === 'export') {
        return sendJson(response, 200, readService.exportMemory(resourceId, { projectId: searchParams.get('project') }));
      }
      if (method === 'GET' && segments[3] === 'matches') return sendJson(response, 200, readService.matchesMemory(resourceId, {
        projectId: searchParams.get('project'), ...readFilters(searchParams),
        query: searchParams.get('q') ? requireText(searchParams.get('q'), 'q', MAX_SEARCH_LENGTH) : null,
      }));
      if (method === 'GET' && segments[3] === 'revisions') return sendJson(response, 200, readService.getRevisionHistory(resourceId, {
        includeObservation: parseBoolean(searchParams.get('includeObservation'), 'includeObservation') ?? false,
      }));
      if (method === 'GET' && segments[3] === 'events') return sendJson(response, 200, readService.getEvents(resourceId));
      if (method === 'GET' && segments[3] === 'notes') return sendJson(response, 200, readService.getNotes(resourceId));
      if (method === 'GET' && segments[3] === 'relations') return sendJson(response, 200, readService.listRelations(resourceId));
      if (method === 'POST') {
        const body = await readJsonBody(request);
        const user = actorService.getOrCreateUserActor();
        if (segments[3] === 'confirm') return sendJson(response, 200, memoryService.confirmMemory(resourceId, user.id, compactOptions(body, ['note'])));
        if (segments[3] === 'edit') {
          if (request.headers.origin !== undefined) requireText(body.expectedRevisionId, 'expectedRevisionId', 100);
          const changes = body.changes ?? Object.fromEntries(Object.entries(body).filter(([key]) => !['actorId', 'actorKind', 'expectedRevisionId', 'metricObservation'].includes(key)));
          if (typeof changes.description === 'string' && changes.description.length > MAX_DESCRIPTION_LENGTH) throw requestError('REQUEST_LIMIT_EXCEEDED', 'description is too long', 413, { maxLength: MAX_DESCRIPTION_LENGTH });
          return sendJson(response, 200, memoryService.editMemory(resourceId, user.id, changes, compactOptions(body, ['expectedRevisionId', 'metricObservation'])));
        }
        if (segments[3] === 'importance') return sendJson(response, 200, memoryService.changeImportance(resourceId, user.id, body.importance));
        if (segments[3] === 'delete') {
          if (body.dryRun === true) return sendJson(response, 200, editorService.preview({ operation: 'delete', memoryId: resourceId,
            projectId: readService.getMemoryDetail(resourceId).memory.projectId }, user.id));
          if (request.headers.origin !== undefined) return sendJson(response, 200, editorService.execute(body.previewId, user.id));
          return sendJson(response, 200, memoryService.deleteMemory(resourceId, user.id));
        }
        if (segments[3] === 'restore') return sendJson(response, 200, memoryService.restoreMemory(resourceId, user.id, compactOptions(body, ['lifecycleStatus', 'reason'])));
        if (segments[3] === 'lock') return sendJson(response, 200, memoryService.lockMemory(resourceId, user.id, body.reason ?? null));
        if (segments[3] === 'unlock') return sendJson(response, 200, memoryService.unlockMemory(resourceId, user.id));
        if (segments[3] === 'pin') return sendJson(response, 200, memoryService.pinMemory(resourceId, user.id));
        if (segments[3] === 'unpin') return sendJson(response, 200, memoryService.unpinMemory(resourceId, user.id));
        if (segments[3] === 'outdated') return sendJson(response, 200, memoryService.markMemoryOutdated(resourceId, user.id, { reason: body.reason ?? null }));
        if (segments[3] === 'reject') return sendJson(response, 200, memoryService.rejectMemory(resourceId, user.id, { reason: body.reason ?? null }));
        if (segments[3] === 'notes') return sendJson(response, 201, memoryService.addNote(resourceId, user.id, requireText(body.content, 'content', MAX_NOTE_LENGTH)));
        if (segments[3] === 'supersede') {
          if (body.dryRun === true) return sendJson(response, 200, editorService.preview({ operation: 'supersede', memoryId: resourceId,
            projectId: readService.getMemoryDetail(resourceId).memory.projectId, targetId: body.newMemoryId, reason: body.reason }, user.id));
          if (request.headers.origin !== undefined) return sendJson(response, 200, editorService.execute(body.previewId, user.id));
          return sendJson(response, 200, memoryService.supersedeMemory(resourceId, body.newMemoryId, user.id, requireText(body.reason, 'reason', 2000), compactOptions(body, ['sourceIds'])));
        }
      }
    }
    if (method === 'POST' && segments[1] === 'conflicts' && resourceId && segments[3] === 'resolve') {
      const body = await readJsonBody(request);
      const user = actorService.getOrCreateUserActor();
      const { resolution, actorId, actorKind, ...options } = body;
      if (request.headers.origin !== undefined && body.dryRun !== true) return sendJson(response, 200, editorService.execute(body.previewId, user.id));
      return sendJson(response, 200, conflictService.resolveMemoryConflict(resourceId, resolution, user.id, options));
    }
    throw requestError('ROUTE_NOT_FOUND', 'Route not found', 404);
  };
}
