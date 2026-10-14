import { DomainError } from '../domain/errors.mjs';

const CONFLICT_CODES = new Set(['MEMORY_LOCKED', 'CONFLICT_ALREADY_RESOLVED', 'REVISION_MISMATCH', 'PREVIEW_STALE']);
const NOT_FOUND_CODES = new Set(['MEMORY_NOT_FOUND', 'CONFLICT_NOT_FOUND', 'CONTEXT_SESSION_NOT_FOUND', 'ACTOR_NOT_FOUND', 'PROJECT_NOT_FOUND']);
const UNPROCESSABLE_CODES = new Set([
  'INVALID_LIFECYCLE_TRANSITION', 'INVALID_EDIT_FIELD', 'VALUE_KIND_REQUIRED', 'MERGE_SELF',
  'MEMORY_NOT_ACTIVE', 'INVALID_GRAPH_LIMIT', 'INVALID_GRAPH_DEPTH', 'CANDIDATE_ACTOR_REQUIRED',
]);

export function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
}

export function sendHtml(response, html) {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  response.end(html);
}

export function sendError(response, error) {
  if (error?.httpStatus) {
    sendJson(response, error.httpStatus, { error: { code: error.code, message: error.message, details: error.details ?? {} } });
    return;
  }
  if (error instanceof DomainError) {
    const status = NOT_FOUND_CODES.has(error.code) ? 404
      : CONFLICT_CODES.has(error.code) ? 409
        : UNPROCESSABLE_CODES.has(error.code) ? 422
          : error.code === 'USER_ACTION_REQUIRED' ? 403
            : error.code === 'PROJECT_REQUIRED' ? 400 : 422;
    sendJson(response, status, { error: { code: error.code, message: error.message, details: error.details ?? {} } });
    return;
  }
  if (error instanceof TypeError || error instanceof RangeError) {
    sendJson(response, 400, { error: { code: 'INVALID_REQUEST', message: error.message, details: {} } });
    return;
  }
  sendJson(response, 500, { error: { code: 'INTERNAL_ERROR', message: 'Unexpected local server error', details: {} } });
}

export function requestError(code, message, httpStatus = 400, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.httpStatus = httpStatus;
  error.details = details;
  return error;
}
