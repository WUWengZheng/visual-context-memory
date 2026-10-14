# Visual Context Memory — Context Selection and Snapshots

Status: Phase 2 design  
Canonical schema: [memory-schema.md](./memory-schema.md)

## 1. Product invariant

For any recorded Codex task, the user must be able to inspect the exact Memory revisions used, the reasons for selection, warnings that were present, missing information, and the exact rendered context. Later Memory edits must not change that historical view.

Context Preview history is therefore persisted. It is not merely transient UI state.

## 2. Context entities

### 2.1 ContextSession

One Context Session corresponds to one prompt/task being prepared.

| Field | Required | Meaning |
|---|---:|---|
| `id` | yes | Internal UUID |
| `project_id` | yes | Project boundary |
| `prompt_text` | yes | Exact prompt/task text |
| `task_label` | no | Short user-facing label |
| `external_session_id` | no | Real Codex session ID when available |
| `prompt_message_id` | no | Real prompt message ID when available |
| `response_message_id` | no | Real response message ID when available later |
| `status` | yes | `draft`, `finalized`, `used`, or `abandoned` |
| `created_by_actor_id` | yes | User or Codex |
| `created_at`, `finalized_at`, `used_at` | conditional | UTC timestamps |

Unavailable external identifiers remain null.

### 2.2 ContextSnapshot

Each generation or manual preview edit produces a new immutable snapshot. A Session may therefore retain preview 1, preview 2, and a final/used snapshot.

| Field | Required | Meaning |
|---|---:|---|
| `id` | yes | Snapshot UUID |
| `context_session_id` | yes | Parent Session |
| `snapshot_number` | yes | Monotonic integer per Session |
| `snapshot_kind` | yes | `preview`, `final`, or `used` |
| `format_version` | yes | Renderer/schema contract version |
| `rendered_context` | yes | Exact Markdown or text supplied to Codex |
| `structured_context_json` | yes | Canonical machine-readable context payload |
| `missing_information_json` | no | Explicit gaps/open questions at that moment |
| `content_hash` | yes | Integrity/deduplication hash |
| `created_by_actor_id` | yes | Actor that generated or confirmed it |
| `created_at` | yes | UTC timestamp |

Snapshots are immutable. Editing a preview creates another snapshot rather than mutating the old one.

### 2.3 ContextSelection

| Field | Required | Meaning |
|---|---:|---|
| `id` | yes | Internal UUID |
| `context_snapshot_id` | yes | Owning immutable snapshot |
| `memory_id` | yes | Stable Memory identity |
| `memory_revision_id` | yes | Exact immutable revision used or considered |
| `selection_state` | yes | `included` or `excluded` |
| `selected_by_actor_id` | yes | Codex/system for automatic selection, user for manual changes |
| `rank` | no | Display/context order for included items |
| `relevance_score` | no | Explainable deterministic score, not a learned truth score |
| `snapshot_payload_json` | yes | Frozen canonical copy of revision content plus relevant control state |
| `created_at` | yes | UTC timestamp |

`snapshot_payload_json` intentionally duplicates immutable revision content. The revision foreign key gives traceability; the frozen payload guarantees historical readability across later schema/display changes or soft deletion.

### 2.4 ContextSelectionReason

One selection may have multiple reasons.

| Field | Required | Meaning |
|---|---:|---|
| `id` | yes | Internal UUID |
| `context_selection_id` | yes | Parent selection |
| `reason_type` | yes | Controlled reason from section 3 |
| `score_contribution` | no | Numeric contribution when applicable |
| `related_memory_id` | no | Neighbor/trigger Memory when applicable |
| `detail` | no | Short user-readable explanation |

## 3. Explainable reason vocabulary

Positive selection reasons:

- `user_selected`
- `pinned`
- `keyword_match`
- `graph_neighbor`
- `current_project`
- `importance`
- `context_role`
- `recent`

Review annotations and warnings:

- `locked_protected`
- `potential_conflict`
- `outdated_warning`
- `candidate_warning`
- `user_removed`

`current_project` is a filter/eligibility reason, not enough by itself to include every Memory. `locked_protected` is an annotation, not a priority boost. Lock and Pin remain orthogonal.

## 4. Deterministic MVP selection policy

1. Limit eligible records to the current Project and non-deleted/non-rejected states.
2. Retrieve lexical matches from name, summary, description, aliases, and source excerpts.
3. Expand a bounded one-hop graph neighborhood from strong matches.
4. Add deterministic weights for `critical/high` importance, relevant Context Roles, recency, and Pin.
5. Do not include a Memory solely because it is locked.
6. Surface relevant candidates, outdated Memories, and open Conflicts as warnings rather than silently treating them as truth.
7. Let the user add, exclude, reorder, or Pin Memories before finalization.
8. Store every reason and score contribution used.

The exact numeric weights belong to Phase 9, not the Schema. The Schema only requires that every contribution be recordable and explainable.

## 5. Snapshot finalization

Finalization must conceptually perform these steps as one operation:

1. Resolve every selected Memory to its current revision at that moment.
2. Copy its canonical revision data, lifecycle, verification, importance, Lock, and Pin state into `snapshot_payload_json`.
3. Persist all included and explicitly excluded selections plus reasons.
4. Persist warnings and missing information.
5. Render and store the exact `rendered_context` and structured equivalent.
6. Hash the content and mark the snapshot `final` or `used`.
7. Never mutate that snapshot afterward.

If the user changes the preview, the system creates the next snapshot number. If Codex later returns a real response message ID, the Context Session may record it without changing any snapshot content.

## 6. Historical version example

On 2026-08-20:

- Context Session prompt: `Continue the Stage2B experiment.`
- Context Snapshot 2 includes `Stage1 Clean mIoU`, Memory Revision 1.
- Selection payload contains value `65.433`, checkpoint `epoch57`, and its source references.
- Reasons include `keyword_match`, `graph_neighbor`, `importance`, and `locked_protected`.

Later, the Memory receives Revision 2 with value `65.564`.

When Snapshot 2 is opened again, it still resolves and displays Revision 1 and its frozen `65.433` payload. A newly built Context Session may select Revision 2, but it cannot rewrite Snapshot 2.

## 7. COMP-2DPASS preview example

Prompt: `Continue designing the Stage2B paired ablation.`

Included selections:

| Memory revision | Example reasons |
|---|---|
| Stage2B current revision | keyword match, pinned, current plan |
| Stage2A current revision | graph neighbor, dependency |
| Prototype Retrieval current revision | graph neighbor, used by Stage2B |
| Pseudo Prompt current revision | graph neighbor, used by Stage2B |
| Fusion classifier constraint current revision | constraint role, graph neighbor, locked protected |
| Stage1 Clean mIoU revision 1 | baseline role, graph neighbor, high importance |
| SemanticKITTI current revision | graph neighbor, current project |
| Camera Missing issue current revision | known issue, graph neighbor |

Warnings:

- An open value Conflict exists between baseline values 65.433 and 65.564.
- The locked 65.433 revision remains protected.
- Missing information: Stage2B checkpoint/run naming and exact missing-camera protocol are not yet confirmed.

If the user removes Camera Missing, that choice appears as an excluded Context Selection with `user_removed` in the next immutable preview snapshot.

## 8. MVP boundaries

- Persist previews and final snapshots locally; no cloud history.
- Store exact prompt/context, but not the full Codex response body unless a later phase explicitly adds it.
- No token-budget optimizer or learned ranking model.
- No cross-project context selection by default.
- Snapshot payloads are schema-versioned JSON plus rendered text; they are not database backups.
