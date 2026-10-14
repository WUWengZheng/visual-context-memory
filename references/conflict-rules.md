# Visual Context Memory — Conflict Model and Rules

Status: Phase 2 design  
Canonical schema: [memory-schema.md](./memory-schema.md)

## 1. Core rule

No important knowledge is silently overwritten. An incoming disagreement is first persisted as a candidate Memory Revision with its own provenance, then linked to the exact existing revision by a Conflict.

## 2. Conflict fields

| Field | Required | Meaning |
|---|---:|---|
| `id` | yes | Internal UUID |
| `project_id` | yes | Project isolation boundary |
| `existing_memory_id` | yes | Established Memory |
| `existing_revision_id` | yes | Exact revision seen during detection |
| `incoming_memory_id` | yes | Candidate or competing Memory |
| `incoming_revision_id` | yes | Exact incoming revision |
| `conflict_type` | yes | Controlled type from section 3 |
| `status` | yes | `open`, `resolved`, or `dismissed` |
| `confidence` | yes | Detection confidence `0.0`–`1.0` |
| `rationale` | yes | Short explainable comparison |
| `detected_by_actor_id` | yes | Usually Codex or system |
| `created_at` | yes | UTC timestamp |
| `resolution` | no | Controlled resolution; null while open |
| `resolution_note` | no | User-facing explanation |
| `resolved_by_actor_id`, `resolved_at` | no | Required when resolved/dismissed |
| `result_memory_id`, `result_revision_id` | no | Revision created or selected by resolution |

The Conflict points to revisions, not only Memories, so its evidence remains stable after either Memory changes.

## 3. Conflict types

| Type | Use when |
|---|---|
| `value_conflict` | Same fact identity/scope has materially different scalar or categorical values |
| `status_conflict` | Claims about current state cannot both be active |
| `semantic_conflict` | Meanings or directives are incompatible without a simple field comparison |
| `duplicate` | Two Memories appear to represent the same knowledge without meaningful disagreement |
| `supersession_candidate` | Incoming knowledge may legitimately replace older knowledge but requires review |

Different checkpoints, runs, datasets, splits, or protocols are not value conflicts when those dimensions are known and differ. They are separate observations that may be related or compared.

## 4. Detection rules

### 4.1 Metric values

Compare normalized `MetricObservation.scope_key` values.

- Same key and equal values within the metric's declared tolerance: potential `duplicate`.
- Same key and different values: `value_conflict`.
- Partially matching key with missing scope dimensions: low-confidence `value_conflict` or `supersession_candidate`; never auto-replace.
- Different known run/checkpoint/protocol: separate facts, not a conflict by default.

### 4.2 Decisions, constraints, requirements, and state facts

Compare normalized subject, type, scope, and active time where known.

- Mutually exclusive instructions: `semantic_conflict`.
- New decision explicitly replacing an old decision: `supersession_candidate`.
- Same content and scope: `duplicate`.
- “Constraint removed” versus an active locked Constraint: `status_conflict`, with the locked Memory protected.

### 4.3 Candidate-first invariant

Detection never edits the established revision. The incoming content must have:

1. a candidate Memory and immutable revision;
2. at least one Source Record unless the source type is explicitly `unknown`;
3. an Actor showing that creation was automatic or imported;
4. an open Conflict before any replacement is considered.

## 5. Resolution vocabulary and effects

| Resolution | Effect |
|---|---|
| `keep_existing` | Existing remains active; incoming becomes rejected or remains a separate candidate if the user requests more evidence |
| `use_incoming` | User explicitly applies incoming meaning as a new revision or active successor; existing may become superseded/outdated |
| `keep_both` | Both remain valid as distinct scoped knowledge; scope must be clarified if it was previously ambiguous |
| `merge` | User creates a new merged revision or Memory; both inputs remain auditable and link to the result |
| `mark_existing_outdated` | Existing becomes outdated; incoming may be activated |
| `reject_incoming` | Incoming becomes rejected; existing is unchanged |

`dismissed` means the detector was wrong or the conflict is not actionable. It is different from `resolved / keep_both`, where a real difference was acknowledged.

## 6. Locked Memory rules

1. A locked Memory may participate in any Conflict.
2. Detection and automatic resolution cannot update, delete, reject, supersede, or replace the locked Memory.
3. `keep_existing` and `reject_incoming` are safe automatic recommendations but still require normal policy before changing the candidate.
4. A user may choose `use_incoming` or `merge` against a locked Memory. This is an explicit user modification: it creates a new revision and the Memory remains locked by default.
5. A user may explicitly change the locked Memory's lifecycle state. The lock remains unless the same user action explicitly unlocks it.
6. Every protected attempt and user resolution is recorded in `MemoryEvent`.

## 7. Resolution transaction invariants for Phase 3

Although implementation is deferred, Phase 3 must make each resolution atomic:

- write any new Memory Revision;
- update current revision and lifecycle pointers;
- create or soft-delete relations as required;
- update candidate state;
- mark the Conflict resolved;
- append Memory Events;
- preserve all Source Records and revision links.

If any part fails, no partial resolution should remain.

## 7.1 Phase 4 resolution behavior

`ConflictService.resolveMemoryConflict` applies the selected resolution and marks the Conflict resolved in one database transaction. `keep_existing` rejects the incoming candidate by default, with an explicit option to retain it as a candidate for further evidence. `use_incoming` uses the unified Supersede operation; `keep_both` activates/accepts the incoming candidate without a `supersedes` edge; `mark_existing_outdated` preserves its distinct outdated meaning; `reject_incoming` leaves the existing Memory unchanged; and `merge` delegates to the single Merge operation. An optional dry run reports proposed state changes, relations, locked records, and whether explicit user action is required without writing data.

## 8. COMP-2DPASS conflict example

Existing:

- Memory: `Stage1 Clean mIoU`
- Revision 1: value `65.433`, SemanticKITTI validation, clean protocol, epoch57, run `stage1-baseline`
- State: active, user-confirmed, locked
- Sources: conversation excerpt and experiment log

Incoming:

- Candidate Memory revision: value `65.564` with the same normalized scope
- Created by: Codex
- Verification: unreviewed
- Source: a newer experiment-log excerpt

Conflict:

```yaml
conflict_type: value_conflict
status: open
confidence: 1.0
rationale: Same subject, metric, dataset, split, protocol, checkpoint, and run; numeric values differ.
existing_revision: Stage1 Clean mIoU revision 1 (65.433)
incoming_revision: candidate revision 1 (65.564)
```

The locked 65.433 revision remains current. If the user chooses `use_incoming`, a user-authored revision 2 with value 65.564 becomes current and remains locked; revision 1 and the Conflict remain available to audit and historical Context Snapshots.

## 9. Phase 7 manual review

The [Memory Editor](./memory-editor.md) lists existing Conflicts and uses real dry-run/rolled-back Domain Service previews before manual execution. Audited state is rechecked in the execution transaction. Metric merges preserve the chosen Observation and reject differing scopes. Automatic Conflict Detection is not implemented. In the current executable Phase 4 service, use_incoming uses an active successor plus supersedes relation rather than overwriting the existing Memory's revision; both immutable histories remain.
