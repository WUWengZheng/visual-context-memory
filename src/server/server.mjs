import http from 'node:http';

import { VisualContextMemoryStore } from '../db/store.mjs';
import { MemoryService } from '../services/memory-service.mjs';
import { ConflictService } from '../services/conflict-service.mjs';
import { ReadService } from '../services/read-service.mjs';
import { GraphService } from '../services/graph-service.mjs';
import { ViewerActorService } from '../services/viewer-actor-service.mjs';
import { createRouter } from './router.mjs';
import { sendError } from './response.mjs';
import { serveViewerAsset } from './static-viewer.mjs';
import { assertLocalRequest } from './write-boundary.mjs';
import { EditorOperationService } from '../services/editor-operation-service.mjs';
import { ProjectService } from '../services/project-service.mjs';
import { RecallService } from '../services/recall-service.mjs';

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 4173;

export function createLocalServer({ dbPath, port = DEFAULT_PORT, host = DEFAULT_HOST, store = null } = {}) {
  if (host !== DEFAULT_HOST) throw new RangeError('Local server may bind only to 127.0.0.1');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError('port must be an integer between 0 and 65535');
  const ownedStore = store === null;
  const databaseStore = store ?? new VisualContextMemoryStore({ dbPath });
  const memoryService = new MemoryService(databaseStore);
  const conflictService = new ConflictService(databaseStore, memoryService);
  const readService = new ReadService(databaseStore);
  const graphService = new GraphService(databaseStore);
  const actorService = new ViewerActorService(databaseStore);
  const editorService = new EditorOperationService(databaseStore, memoryService, conflictService);
  const projectService = new ProjectService(databaseStore);
  const recallService = new RecallService(databaseStore);
  const router = createRouter({ readService, graphService, memoryService, conflictService, actorService, editorService, projectService, recallService });
  const server = http.createServer((request, response) => {
    try { assertLocalRequest(request); } catch (error) { sendError(response, error); return; }
    if (serveViewerAsset(request, response)) return;
    router(request, response).catch((error) => sendError(response, error));
  });
  let started = false;

  return {
    server,
    services: { memoryService, conflictService, readService, graphService, actorService, editorService, projectService, recallService },
    async start() {
      if (started) return this.address();
      actorService.getOrCreateUserActor();
      await new Promise((resolve, reject) => {
        const onError = (error) => { server.off('listening', onListening); reject(error); };
        const onListening = () => { server.off('error', onError); resolve(); };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
      });
      started = true;
      return this.address();
    },
    address() {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Local server is not listening');
      return { host: DEFAULT_HOST, port: address.port, url: `http://${DEFAULT_HOST}:${address.port}` };
    },
    async stop() {
      if (started) await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
      started = false;
      if (ownedStore) databaseStore.close();
    },
  };
}
