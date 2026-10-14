# Visual Context Memory — Lifecycle, Verification, Lock, and Pin

Status: Phase 2 design  
Canonical schema: [memory-schema.md](./memory-schema.md)

Implementation note: Phase 4 implements this model through `MemoryService` and one shared policy module. The transition table below is the executable source for user lifecycle actions; automated actors create candidates/proposals only.

## 1. Separate lifecycle from verification

`Confirmed` is not a lifecycle state. It answers “has a user accepted this knowledge?”, while lifecycle answers “how should this record participate now?” Keeping the axes separate avoids combinations such as treating every active record as user-verified.

Lifecycle states:

- `candidate`: proposed but not accepted as current knowledge.
- `active`: eligible as current knowledge.
- `outdated`: historically valid or useful but no longer current.
- `superseded`: explicitly replaced by newer knowledge.
- `rejected`: reviewed and judged incorrect or unsuitable.
- `deleted`: soft-deleted and hidden by default.

Verification states:

- `unreviewed`: not explicitly confirmed by a user.
- `user_confirmed`: a user created, confirmed, or explicitly edited the current revision.

## 2. Creation defaults

| Origin | Lifecycle | Verification | Confidence |
|---|---|---|---|
| Codex automatic extraction | candidate | unreviewed | extracted confidence |
| Importer extraction | candidate | unreviewed | extracted confidence |
| User manual creation | active | user_confirmed | 1.0 for authorship certainty, not objective truth |
| User-approved candidate | active | user_confirmed | original extraction confidence remains available in provenance |

Confidence belongs to extracted assertions and relations; verification records user review. User confirmation does not rewrite evidence confidence to claim objective certainty.

## 3. Allowed lifecycle transitions

| From | To | Who may perform it | Notes |
|---|---|---|---|
| candidate | active | user | Confirms current revision |
| candidate | rejected | user | Candidate remains auditable |
| candidate | deleted | user | Soft deletion |
| active | outdated | user; later rule may only propose | Still available for historical/context warning use |
| active | superseded | user through conflict resolution | Requires successor revision/Memory link |
| active | rejected | user | Used when current content is discovered to be wrong |
| active | deleted | user | Soft deletion |
| outdated | active | user | Re-activation requires explicit review |
| outdated | superseded | user | Establishes explicit successor |
| rejected | candidate | user | Reopen for reconsideration |
| deleted | candidate, active, outdated | user | Restore with explicit target state and audit event |
| superseded | active | user | Exceptional rollback; record reason |

Automation may create candidates and propose transitions, but it may not activate, reject, supersede, restore, or delete existing knowledge in the MVP.

Phase 4 behavior: confirming `active + user_confirmed` is idempotent; rejecting a candidate removes it from ordinary FTS search (and future Context eligibility) without removing its audit history; reopening a rejected record returns it to `candidate + unreviewed`.

## 4. Revision rules

1. Any semantic edit creates a new immutable Memory Revision.
2. Revision numbers increase monotonically per Memory.
3. A revision records actor, timestamp, change kind, reason, and exact provenance.
4. The previous revision is never edited or deleted.
5. A user edit makes the current verification state `user_confirmed`.
6. An automatic modification suggestion becomes a candidate and possible Conflict; it is not a revision of an active Memory until the user accepts it.
7. Merge creates a new revision or a new result Memory and records both inputs.

## 5. Lock rules

Lock protects knowledge from automatic mutation. It does not assert truth and does not force context inclusion.

1. Automation cannot update, revise, delete, reject, supersede, merge into, or change the lifecycle of a locked Memory.
2. Automation may attach new non-mutating evidence only as a proposed provenance link, create a candidate, and open a Conflict.
3. A locked Memory can be edited by an explicit user action.
4. After a user edit, merge, or conflict resolution, it remains locked by default.
5. Only an explicit user action can unlock it.
6. Lock/unlock captures actor, timestamp, optional reason, and a Memory Event.
7. Soft-deleting or marking a locked Memory outdated requires an explicit user action; the operation does not implicitly unlock first.

The same explicit-user rule is enforced for Supersede and Merge. A user action may supersede a locked Memory while leaving its Lock state intact as historical intent.

## 6. Pin rules

Pin influences Context Builder priority. It does not protect content.

1. A pinned Memory receives a deterministic context-selection boost.
2. Pin does not guarantee inclusion when the Memory is unrelated, rejected, or deleted.
3. An outdated pinned Memory is surfaced with a warning, not silently treated as current.
4. Automation may suggest Pin but cannot change user Pin state in the MVP.
5. Pin/unpin captures actor, timestamp, and a Memory Event.

Valid combinations:

| Locked | Pinned | Meaning |
|---:|---:|---|
| no | no | Normal mutable, relevance-based knowledge |
| yes | no | Protected but not context-prioritized |
| no | yes | Context-prioritized but still editable/revisable by approved workflows |
| yes | yes | Protected and context-prioritized |

## 7. Importance

The MVP uses an explainable categorical scale:

- `critical`: omission could invalidate or dangerously violate the task.
- `high`: materially affects the likely answer or plan.
- `normal`: useful project knowledge.
- `low`: optional supporting detail.

Phase 9 may map these categories to fixed numeric weights. The mapping must be visible in Context Selection Reasons. Importance is not learned automatically in the MVP.

## 8. Actor and audit rules

Every create, revision, confirmation, state transition, Lock, Pin, merge, delete, restore, and conflict resolution records an Actor and timestamp.

Trust precedence for mutation authority is:

1. explicit user action;
2. user-confirmed current state;
3. Codex/system proposal;
4. unknown/imported unreviewed content.

This precedence controls what may be changed; it is not a claim that humans are always factually correct.

Phase 4 centralizes the MVP authority checks: only a `user` Actor may edit established Memory content, change lifecycle/control state, Lock/Unlock, Pin/Unpin, merge/supersede, and resolve Conflicts. `codex`, `system`, and `importer` may establish only unreviewed candidate proposals through the public domain surface.

## 9. Soft deletion

`deleted` means hidden from normal library, graph, and retrieval results. The Memory, all revisions, provenance, relations, conflicts, and historical Context Snapshot references remain readable for audit. Restore is an explicit user action. Physical purge is outside the MVP.

## 10. Phase 7 editing

The [Memory Editor contract](./memory-editor.md) defines transaction-local version validation, new immutable Revisions, MetricObservation preservation, real operation previews and stale-plan rejection. Explicit user edits keep Lock/Pin. Deleted content must be restored before editing; restoring to candidate resets verification to unreviewed so Confirm is valid. No automatic lifecycle rules are added.

A user-edited candidate may already be user_confirmed while still awaiting explicit activation. Confirm accepts that candidate too, retains its edited Revision and transitions it to active; it does not require discarding the user Revision to become unreviewed again.
