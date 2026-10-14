export const LOCAL_VIEWER_EXTERNAL_ID = 'visual-context-memory:local-viewer-user';

export class ViewerActorService {
  constructor(store) {
    this.store = store;
  }

  getOrCreateUserActor() {
    return this.store.findActorByExternalId(LOCAL_VIEWER_EXTERNAL_ID)
      ?? this.store.createActor({
        actorType: 'user',
        displayName: 'Local Viewer user',
        externalId: LOCAL_VIEWER_EXTERNAL_ID,
      });
  }
}
