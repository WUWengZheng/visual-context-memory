import { createReadStream, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../../viewer/', import.meta.url)));
const cytoscapeModule = resolve(fileURLToPath(new URL('../../node_modules/cytoscape/dist/cytoscape.esm.min.mjs', import.meta.url)));
const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' };

export function serveViewerAsset(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  const relative = pathname === '/' ? 'index.html' : pathname.startsWith('/viewer/') ? pathname.slice('/viewer/'.length) : null;
  if (relative === null) return false;
  const path = relative === 'vendor/cytoscape.esm.min.mjs' ? cytoscapeModule : resolve(root, relative);
  if (path !== cytoscapeModule && !path.startsWith(`${root}${sep}`)) return false;
  let stat;
  try { stat = statSync(path); } catch { return false; }
  if (!stat.isFile()) return false;
  const extension = path.slice(path.lastIndexOf('.'));
  response.writeHead(200, { 'content-type': contentTypes[extension] ?? 'application/octet-stream', 'content-length': stat.size, 'cache-control': 'no-store' });
  if (request.method === 'HEAD') { response.end(); return true; }
  createReadStream(path).pipe(response);
  return true;
}
