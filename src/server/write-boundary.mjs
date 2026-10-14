import { requestError } from './response.mjs';

// Origin/Fetch Metadata + non-simple JSON stop browser cross-site writes. This
// is not OS-level authentication; trusted local CLI requests may omit Origin.
export function assertLocalRequest(request) {
  const port = request.socket.localPort;
  const host = request.headers.host;
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(host)) {
    throw requestError('HOST_NOT_ALLOWED', 'Host must match the local server address', 403);
  }
  if (!['GET', 'HEAD'].includes(request.method)) {
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== `http://${host}`) {
      throw requestError('ORIGIN_NOT_ALLOWED', 'Browser writes must be same-origin', 403);
    }
    if (request.headers['sec-fetch-site'] === 'cross-site' || request.headers['sec-fetch-site'] === 'same-site') {
      throw requestError('CROSS_SITE_WRITE', 'Cross-site writes are forbidden', 403);
    }
    if (request.method === 'POST' && !/^application\/json(?:\s*;|$)/iu.test(request.headers['content-type'] ?? '')) {
      throw requestError('JSON_REQUIRED', 'Writes require application/json', 415);
    }
    if (request.headers['sec-fetch-site'] && !origin) {
      throw requestError('ORIGIN_REQUIRED', 'Browser writes require Origin', 403);
    }
  }
}
