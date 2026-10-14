# Phase 7 — Memory Editor contract

Scope: local single-user Memory Editor only. No framework, Schema/migration change, extraction, automatic conflict detection, Context Builder/Preview or SKILL integration.

## API additions and compatible extensions

All writes select the stable server-side user Actor; client Actor fields cannot grant authority. Response errors preserve HTTP status, code, message and details.

| Route | Body / result |
|---|---|
| `POST /api/memories/:id/edit` | `{changes, expectedRevisionId, metricObservation?}`; audit result with `createdRevision` |
| `POST /api/memories/:id/importance` | `{importance}`: low/normal/high/critical |
| `POST /api/notes/:id/delete` | `{reason?}`; soft-deleted Note and audit |
| `POST /api/memories/:id/delete` | Soft deletion; browser execution requires reviewed `previewId` |
| `POST /api/memories/:id/restore` | `{lifecycleStatus?, reason?}`; deleted defaults to candidate/unreviewed |
| `POST /api/editor/preview` | `{projectId, operation, memoryId?, targetId?, conflictId?, resolution?, reason?, contentStrategy?}` |
| `POST /api/editor/execute` | `{previewId}` only; executes the saved server plan |
| `GET /api/memories/:id/revisions?includeObservation=true` | Revision array with per-Revision Observation and sources; omission preserves original shape |
| `GET /api/memories/:id/matches?project=&q=&type=&status=&locked=&pinned=` | `{matches:boolean}`; evaluates this exact Memory against SQL filters/FTS without list truncation |

Existing Lock/Unlock, Pin/Unpin, Confirm, Reject, Outdated and Note-add routes are reused. Their transition/permission logic remains in Domain Service, not frontend.

Browser edit requests must supply expectedRevisionId (missing = 400). A supplied condition is checked by MemoryService **inside the same immediate transaction** as immutable Revision creation, Current update, MetricObservation, source links and audit. Stale forms return **409 REVISION_MISMATCH** with no writes. Origin-less legacy CLI edits remain compatible with an optional condition; new clients should always send one. Callers omitting it do not receive stale-form protection.

## Draft and rendering

Editor state contains Memory ID, initial Revision ID, typed draft, dirty, saving, saveError and uncertain-outcome flag. Search, filtering, workspace reload and ordinary render preserve the live form and focus. Dirty node/project changes, deselection, editor exit and drawer closure ask for explicit discard or continue editing. Browser unload also warns. Duplicate submits are blocked. Failed saves preserve the draft; stale forms are never merged, silently overwritten or auto-retried.

Writes are not aborted or automatically retried. Transport/protocol interruption and HTTP 5xx are treated as possibly committed. The draft and error remain; Save is disabled. “Refresh Current & history” reads only. Users must review Current, revisions and notes, then explicitly discard the old write/form state and begin a new operation. No idempotency key or automatic recovery is claimed.

SelectedMemoryId controls Inspector/highlight; neighborhoodCenterId controls graph scope and workspace identity. Deselect clears only selection/detail, preserving center/depth. Project mode clears center; project changes clear both. Node navigation defaults to 1-hop only when entering neighborhood from Project and otherwise retains depth. Mode rules live in Controller. Writes refresh Inspector, Library, Graph and Conflict count while retaining the project/search/filters/center/depth. A saved Memory excluded by filters/search is reported as saved, not failed.

## Metric and history

Metric editing retains fact/metric_observation, generic valueKind none, and exactly one Observation per new Revision. Editable Observation fields are valueRaw/valueNumber/unit; raw and numeric values must agree and be finite. Subject, metric name, dataset, split, protocol, checkpoint, run, observed time and scope key are preserved. Scope edits return METRIC_SCOPE_CHANGE. Another run/checkpoint is a separate observation, not a correction. Converting non-metric content or creating a new scoped observation is outside this editor.

Metric Merge copies the selected Observation transactionally and rejects different actual scope dimensions, even if supplied scope keys happen to match. All browser fixtures are explicitly DEMO data. User edits keep Lock/Pin; Lock protects against automatic mutation, whereas Pin is a separate future priority hint. Old Revisions are immutable and never restored as Current. History displays field Diff, including Metric values, and each Revision's sources.

## High-risk operations

Preview supports merge, supersede, delete and resolve (existing Conflict only). Participants must belong to the supplied project. UI targets are selected from bounded current-project pages (100/page with previous/next), not arbitrary IDs.

Preview calls the existing Domain Services within a transaction, captures their **actual** results/before/after state, then rolls back. Conflict also includes the existing service's real domainDryRun. Payloads expose current and historical Revisions, Lock/lifecycle, source links, Observations, audit, relations and Conflict state. Created IDs are provisional and may differ at final execution; this is explicitly shown. No fixed explanation substitutes for a preview.

Opaque previewId is bound to Actor and audited state, expires in 10 minutes and is limited to 100 in-memory plans. Execute rechecks affected Revision/content, controls, sources, audit, project relations and Conflicts within the write transaction before applying the same Domain Service. Expired, changed, reused or server-restart plans return **409 PREVIEW_STALE**; UI removes the execute entry and requires fresh preview. Deletion is soft; old revisions, sources, Conflicts and frozen Context Snapshots are retained.

Legacy Merge/Supersede/delete now accept dryRun:true and delegate to the rolled-back preview. Existing Conflict dryRun:true remains non-writing. Browser execution through the legacy high-risk endpoints requires previewId; Origin-less CLI execution remains compatible. Preview IDs are neither auth credentials nor URL tokens.

## Local write security boundary

Host must be exactly 127.0.0.1:actual-port or localhost:actual-port on every request. A supplied write Origin must exactly match HTTP Host; null/foreign Origins are forbidden. Cross-site/same-site Fetch Metadata and browser Fetch Metadata without Origin are rejected (403). POST must use application/json (415). JSON bodies remain capped at 64 KiB, Notes at 4,000 characters, descriptions at 16,000; no wildcard CORS/preflight permission is sent. Non-simple JSON and same-Origin checks block ordinary browser CSRF, and Host validation blocks foreign DNS-rebinding Hosts.

This is **not authentication**. Origin-less/Fetch-Metadata-less local CLI callers are trusted local processes for compatibility, not identified humans. A process with the same local privileges can spoof headers, call the API or directly change SQLite. Untrusted same-origin scripts are also outside the boundary. No account system, OAuth, cloud service or URL token is introduced. Do not expose/proxy the server to an untrusted network. Stopping the server closes active connections; an interrupted write must still be reconciled as uncertain.
