# Visual Context Memory — Local HTTP API

Status: Phase 7 Memory Editor and local write boundary

## Boundary

The local server is a same-origin boundary for a future Viewer:

`Browser → Local HTTP API → Domain/Read/Graph Services → Store → SQLite`.

Routes never query SQLite directly. The composition root creates the Store and services; Router code only validates HTTP input, selects the local Viewer user Actor, calls a service, and serializes the result.

## Runtime and safety

- Node 24 native `node:http`, ESM, no third-party HTTP framework.
- Default address: `http://127.0.0.1:4173`; non-loopback binding is rejected.
- `VCM_DB_PATH` overrides the default database path; `VCM_PORT` overrides the port.
- Browser write operations always use the stable local Viewer user Actor. Client `actorId` and `actorKind` fields are ignored.
- No wildcard CORS header is sent.
- JSON bodies are limited to 64 KiB; search text to 200 characters; graph `limit` to 1–200; graph `depth` to 1–2; Notes to 4,000 characters; descriptions to 16,000 characters.

## Read routes

| Route | Purpose |
|---|---|
| `GET /api/health` | Local server readiness |
| `GET /api/projects` | Projects |
| `GET /api/memories?project=` | Memory library |
| `GET /api/memories/:id` | Viewer Memory aggregate |
| `GET /api/memories/:id/revisions`, `/events`, `/notes`, `/relations` | Memory audit/read facets |
| `GET /api/search?project=&q=` | Current-memory FTS search |
| `GET /api/recall?project=&q=&q=&neighbors=&limit=&view=` | Explainable multi-query keyword rank fusion; optional bounded one-hop and compact previews |
| `GET /api/memories/:id/export?project=` | Read-only single-Memory Markdown document in a JSON envelope |
| `GET /api/conflicts?project=` | Conflicts |
| `GET /api/context-sessions?project=`, `/:id` | Context-session history |
| `GET /api/graph?project=&memoryId=&type=&status=&locked=&pinned=&limit=&depth=` | Lightweight graph/subgraph |

Memory detail includes the current revision/control state, current-revision sources, active relations, Notes, current MetricObservation, and revision count. Graph nodes contain only visualization fields; edges contain `id`, `source`, `target`, and `relationType`.

Recall/export are additive, read-only endpoints. Existing search arrays, pagination and Viewer behavior are unchanged. Recall accepts 1–5 repeated `q` parameters (200 characters each), limit 1–50, neighbors 0–1, and all four existing filters. Default lifecycle is active. Export requires matching project identity and caps the rendered document at 2 MiB (422 EXPORT_TOO_LARGE). See [recall/export contracts, ranking and coverage limits](./recall-and-export.md).

Recall `view` defaults to `full` (old format unchanged). Opt-in `compact` returns bounded name/summary previews and up to eight source identities, with explicit preview/source omissions and exact Memory/Revision IDs. It does not return full description/value/Metric/evidence/Notes. Unknown values return INVALID_QUERY; clipping does not alter ranking or counts. Fetch exact Current detail before citation/editing. This is the only server API addition in the progressive-recall optimization; no new route or write behavior.

Per-reply memory transparency is a client/Skill contract, not a new server route. The optional `src/client/reply-memory-session.mjs` collector uses existing GET recall/matches/detail endpoints only. The client SDK adds `recall` and an optional cancellation signal to `matches`, preserving existing calls. No usage-log write, Context Builder, automatic response hook or authenticated audit API is introduced. See [reply reporting scope and limitations](./reply-memory-report.md).

### Phase 6.1 compatible read-query additions

`/api/memories`, `/api/search`, and `/api/graph` accept `type`, `status`, `locked`, and `pinned` together. Boolean values must be `true` or `false`; omission applies no flag restriction. Default library/search/graph queries exclude `deleted` and `rejected`. Explicit `status=rejected` permits inspecting and searching rejected memories. Existing response arrays for `/api/memories` and `/api/search` remain arrays unless `page=true` is requested.

With `page=true`, the library and search return:

```json
{"items":[],"total":0,"limit":100,"offset":0,"truncated":false}
```

`offset` defaults to zero and accepts integers from 0 to 1,000,000. `limit` accepts 1–200. `total` counts memories matching the project and every filter (plus the FTS query for search), not all memories in the project. `truncated` means additional matching items exist after the returned range. Paginated library queries require `project`; search continues to require `project` and `q`.

The graph retains `nodes`, `edges`, `limit`, and `depth`, and adds `total`, `truncated`, and `centerExcluded`. The count is for the matching project graph or requested neighborhood. SQLite applies filters before the node limit; only bounded rows and relations whose two endpoints are present are returned. One/two-hop traversal occurs in SQLite through active relations, including filtered intermediate nodes, before filtering the resulting node set. If the selected center itself does not match, the response is an empty graph with `total:0` and `centerExcluded:true`; the Viewer explains why rather than silently rendering another center. Invalid type/status/boolean/depth/limit input is rejected.

The Viewer requests at most 100 Library/search items and 200 Graph nodes. It displays loaded/matching counts and a partial-results notice whenever truncated. Project-wide totals are not inferred from loaded items.

## Write routes

### First-use creation

- `POST /api/projects` with `{name}` (non-empty, at most 120 characters) returns the created Project, HTTP 201. UUID/unique slug/status are server-generated; duplicate human names do not overwrite projects. Client Actor, slug and control fields are ignored.
- `POST /api/memories` with `{projectId,name,type,summary,description?,contextRole?}` returns a create_manual_memory audit result, HTTP 201. Name is capped at 200 characters, summary at 4,000 and description at 16,000. Type uses the existing seven-type vocabulary; role defaults to reference. Only active existing projects accept creation; missing project returns 404 PROJECT_NOT_FOUND. Memory starts active/user_confirmed, unlocked/unpinned with importance normal. Client Actor, lifecycle and control flags cannot override these defaults.
- Creation is a Domain Service transaction: immutable Revision 1/Current, manual_input source, primary provenance link and audit are stored together. The source records exactly the submitted name/summary/description, not fabricated conversation identifiers. Confidence 1 denotes explicit authorship, not objective truth. This basic flow does not create MetricObservation or accept metric_observation subtype; attempting it returns METRIC_STRUCTURE_REQUIRED. Existing Metric editing stays unchanged.
- Both endpoints use the existing Host/Origin/Fetch Metadata/JSON/body-limit boundary. Neither is idempotent: interrupted POST may have committed, so inspect returned project/search records before starting a new creation. The UI retains drafts/errors, blocks duplicate/uncertain submission and offers read-only reconciliation; no blind retry is issued.

The local user can invoke Phase 4 operations through `POST /api/memories/:id/confirm`, `/edit`, `/lock`, `/unlock`, `/pin`, `/unpin`, `/outdated`, `/reject`, `/notes`, `/supersede`, plus `POST /api/memories/merge` and `POST /api/conflicts/:id/resolve`.

Domain errors retain their code in `{ "error": { "code", "message", "details" } }`. The server maps malformed requests to 400, missing records/routes to 404, final-state conflicts/locks to 409, domain-invalid operations to 422, and unexpected failures to 500.

## Viewer and Memory Editor

`GET /` and `/viewer/*` serve the saved native-JavaScript Cytoscape Viewer. Inspector defaults to read-only; explicit Edit and operation controls use HTTP writes into the existing Domain Services. The three-column layout, narrow-screen drawers, search, filters and Retry remain. See the [Phase 7 write contract and security boundary](./memory-editor.md) for the added routes, version conditions, real dry-run previews and interrupted-write handling. Mapping a request to the local user Actor does not authenticate its caller.
