# Visual Context Memory — MVP Memory Schema

Status: Phase 2 design, implementation independent  
Version: 1.0-draft  
Scope: local, single-user, project-scoped MVP with a path to multiple projects and sessions

This document defines the canonical domain model. It deliberately does not contain SQL, migrations, API shapes, or viewer behavior.

## 1. Modeling principles

1. A Memory is a durable claim or named domain object that can change future Codex decisions. It is not a keyword.
2. `Memory` owns stable identity and current control state. `MemoryRevision` owns immutable semantic content.
3. Provenance attaches to the exact revision or relation it supports, not merely to the current Memory.
4. Automatic extraction creates candidates. It never silently overwrites an active Memory.
5. Project scope is explicit on every root record. No account, tenant, or cloud-sync model is introduced in the MVP.
6. Historical context points to immutable revisions and also stores a frozen payload, so later edits cannot rewrite history.
7. Soft deletion preserves auditability. Physical purge is outside the MVP.

## 2. Canonical terminology

- **Project**: the local isolation boundary for memories, sources, conflicts, and context history. It is not a Memory type.
- **Memory**: stable identity plus lifecycle, verification, importance, Lock, and Pin state.
- **Memory Revision**: an immutable version of a Memory's meaning and display content.
- **Source Record**: one independently traceable evidence unit, such as a message, text excerpt, log fragment, or manual assertion.
- **Relation**: a directed, typed edge between two Memories in the same Project.
- **Candidate**: a Memory proposed by automation but not yet accepted as active knowledge.
- **Context Session**: one prompt/task for which context is prepared and later used.
- **Context Snapshot**: an immutable preview or final rendering of the context at one point in time.
- **Conflict**: a reviewable pairwise disagreement or suspected duplication between exact Memory revisions.

Avoid using “Memory version” for mutable rows; the canonical term is **Memory Revision**. Avoid using “source” for a free-form string; use **Source Record**.

## 3. Final Memory type system

The MVP uses seven first-level types. Types answer “what kind of knowledge is this?”; Context Roles answer “how should it influence a future task?”

| Type | Meaning | Typical subtypes | Consolidates or replaces |
|---|---|---|---|
| `entity` | A durable named thing that other knowledge refers to | `method`, `module`, `dataset`, `experiment`, `file`, `person`, `tool`, `concept` | Method, Module, Dataset, Experiment, File, Person, Tool, Concept |
| `fact` | An observation or assertion that can be true, false, measured, or superseded | `metric_observation`, `state`, `conclusion` | Metric, Conclusion |
| `decision` | A committed choice or current plan | `architectural`, `experimental`, `plan` | Decision |
| `constraint` | A boundary that limits allowed actions | `technical`, `experimental`, `policy` | Constraint |
| `requirement` | A desired capability or acceptance condition | `functional`, `quality`, `acceptance` | Requirement |
| `issue` | A known problem or unresolved question | `problem`, `open_question`, `risk` | Problem |
| `resolution` | A proposed or confirmed way to address an Issue | `solution`, `workaround` | Solution |

`Project` is a separate aggregate because it scopes all records and must exist even when the knowledge graph is empty. A viewer may render it as a synthetic root node, but it is not duplicated as a Memory.

`Metric` is not a first-level type. A metric result is `fact / metric_observation` with a specialized `MetricObservation` record. The metric name itself may be represented as `entity / concept` only when its definition is independently useful.

## 4. Stable Context Role vocabulary

| Context Role | Intended effect |
|---|---|
| `background` | Stable project or domain background |
| `current_state` | What is true now |
| `current_plan` | The next committed or proposed action |
| `constraint` | A boundary Codex must not violate |
| `requirement` | A condition the result must satisfy |
| `baseline` | A comparison point |
| `result` | An experiment or execution outcome |
| `decision` | A choice that should guide later work |
| `known_issue` | A known defect, blocker, or risk |
| `open_question` | Missing or unresolved information |
| `reference` | Supporting information that is not itself directive |

Role and type are orthogonal. For example, a `fact / metric_observation` may have role `baseline` or `result`; a `decision / plan` may have role `current_plan`.

## 5. Entity inventory

| Entity | Responsibility |
|---|---|
| `Project` | Isolation boundary and local project metadata |
| `Actor` | Identifies whether an action came from a user, Codex, the system, or an importer |
| `Memory` | Stable identity and current lifecycle/control state |
| `MemoryRevision` | Immutable semantic version of a Memory |
| `MemoryEvent` | Append-only audit of control and lifecycle operations |
| `MemoryNote` | A short user annotation with its own actor/time and soft-delete audit |
| `SourceRecord` | Traceable evidence with nullable external identifiers |
| `RevisionSource` | Many-to-many provenance link from a revision to sources |
| `Relation` | Directed graph edge between Memories |
| `RelationSource` | Many-to-many provenance link from a relation to sources |
| `MetricObservation` | Typed experimental measurement attached to one fact revision |
| `Conflict` | Pairwise review and resolution record between exact revisions |
| `ContextSession` | Prompt/task whose prerequisite memory is being prepared |
| `ContextSnapshot` | Immutable preview/final context artifact |
| `ContextSelection` | Frozen selected/excluded Memory Revision within a snapshot |
| `ContextSelectionReason` | One explainable reason for a selection or warning |

## 6. Core entity fields

### 6.1 Project

| Field | Required | Meaning |
|---|---:|---|
| `id` | yes | Internal application-generated UUID |
| `name` | yes | Human-facing project name |
| `slug` | yes | Stable local identifier, unique within the database |
| `description` | no | Short project purpose |
| `root_path` | no | Local path when known; never used as identity |
| `status` | yes | `active` or `archived` |
| `created_at`, `updated_at` | yes | UTC timestamps |

### 6.2 Actor

| Field | Required | Meaning |
|---|---:|---|
| `id` | yes | Internal UUID |
| `actor_type` | yes | `user`, `codex`, `system`, or `importer` |
| `display_name` | yes | Explainable label shown in audit history |
| `external_id` | no | Real provider identifier when available; never fabricated |
| `created_at` | yes | UTC timestamp |

`Actor` is not an account or authentication model. A local MVP normally has one user Actor, one Codex Actor, and one system Actor.

### 6.3 Memory

| Field | Required | Meaning |
|---|---:|---|
| `id` | yes | Stable internal UUID |
| `project_id` | yes | Owning Project |
| `current_revision_id` | yes | Current immutable semantic revision |
| `lifecycle_status` | yes | `candidate`, `active`, `outdated`, `superseded`, `rejected`, or `deleted` |
| `verification_status` | yes | `unreviewed` or `user_confirmed` |
| `importance` | yes | `critical`, `high`, `normal`, or `low` |
| `is_locked` | yes | Automatic mutation protection flag |
| `locked_at`, `locked_by_actor_id`, `lock_reason` | no | Lock audit metadata; all null when unlocked |
| `is_pinned` | yes | Context priority flag |
| `pinned_at`, `pinned_by_actor_id` | no | Pin audit metadata; all null when unpinned |
| `created_by_actor_id` | yes | Actor that established the stable identity |
| `last_modified_by_actor_id` | yes | Convenience pointer; `MemoryEvent` is authoritative audit |
| `created_at`, `updated_at` | yes | UTC timestamps |
| `deleted_at` | no | Set only when lifecycle is `deleted` |

The Memory row does not store `name`, `summary`, `description`, `type`, or value. Those fields are revisioned so edits never erase history.

### 6.4 MemoryRevision

| Field | Required | Meaning |
|---|---:|---|
| `id` | yes | Immutable revision UUID |
| `memory_id` | yes | Stable Memory identity |
| `revision_number` | yes | Monotonic integer unique per Memory, starting at 1 |
| `name` | yes | Short, user-facing label; not a sentence |
| `type` | yes | One of the seven first-level Memory types |
| `subtype` | no | Controlled subtype appropriate to the type |
| `context_role` | yes | One stable role from section 4 |
| `summary` | yes | One concise claim that can influence future work |
| `description` | no | Additional nuance that would make `summary` unwieldy |
| `confidence` | yes | `0.0`–`1.0`; certainty that the source supports this extraction/assertion, not objective truth |
| `value_kind` | yes | `none`, `text`, `number`, `boolean`, or `json` |
| `value_text`, `value_number`, `value_boolean`, `value_json` | conditional | Exactly one matches `value_kind`; all are null for `none` |
| `unit` | no | Unit for a simple non-metric value |
| `change_kind` | yes | `create`, `edit`, `merge`, `conflict_resolution`, or `restore` |
| `change_reason` | no | Human-readable reason for the revision |
| `created_by_actor_id` | yes | Actor that authored this revision |
| `created_at` | yes | UTC timestamp; revisions are never updated in place |

Field boundaries:

- `name` identifies the Memory in lists and graph labels: `Stage1 Clean mIoU`.
- `summary` states why it matters: `Stage1 achieved Clean mIoU 65.433 on SemanticKITTI validation at epoch57.`
- `description` contains optional caveats, protocol notes, or interpretation.
- `confidence` is revision-specific because a later revision may have different evidence. User-authored content uses `1.0` to mean “the user explicitly stated this,” not “the claim is infallible.”
- `value_*` is present only when a machine-comparable scalar is useful. For `metric_observation`, the specialized record is authoritative and general value fields remain null.

### 6.5 MemoryEvent

`MemoryEvent` is append-only and records `created`, `revision_created`, `confirmed`, `locked`, `unlocked`, `pinned`, `unpinned`, `marked_outdated`, `superseded`, `rejected`, `deleted`, `restored`, `importance_changed`, `note_added`, `note_deleted`, `conflict_opened`, `conflict_resolved`, and `merged`. `status_changed` remains available for compatible lower-level audit.

Fields: `id`, `project_id`, `memory_id`, `event_type`, `actor_id`, `from_status`, `to_status`, `from_revision_id`, `to_revision_id`, `note`, `metadata_json`, `occurred_at`.

### 6.5a MemoryNote (Phase 4)

`MemoryNote` is intentionally independent from `MemoryRevision`: adding a user note must not create a new semantic revision. It contains `id`, `project_id`, `memory_id`, `content`, `created_by_actor_id`, `created_at`, and nullable soft-delete audit fields `deleted_by_actor_id`, `deleted_at`, and `deletion_reason`. Note content is immutable; a note may be soft-deleted once and remains available for audit.

### 6.6 SourceRecord and provenance links

| Field | Required | Meaning |
|---|---:|---|
| `id` | yes | Internal provenance UUID |
| `project_id` | yes | Owning Project |
| `source_type` | yes | `codex_conversation`, `manual_input`, `imported_file`, `generated_result`, `experiment_log`, `code_file`, or `unknown` |
| `session_id`, `message_id` | no | Real external identifiers only |
| `file_path` | no | Source file path when applicable |
| `locator` | no | Line range, JSON pointer, log offset, URI fragment, or equivalent |
| `original_text` | no | Verbatim evidence excerpt; null only when unavailable |
| `author` | no | Human/tool/model label as observed |
| `occurred_at` | no | When the source event happened |
| `captured_at` | yes | When VCM recorded it |
| `content_hash` | no | Hash of the captured evidence for deduplication/integrity |
| `metadata_json` | no | Source-specific non-core metadata |

`RevisionSource` fields: `revision_id`, `source_id`, `evidence_role` (`primary`, `supporting`, `contradicting`), `created_at`.

`RelationSource` fields: `relation_id`, `source_id`, `evidence_role`, `created_at`.

One revision or relation may have many sources; one source may support many revisions and relations. A later edit creates a new revision and its own provenance links.

## 7. Experimental metrics

### Decision: hybrid Fact Memory plus MetricObservation

| Option | Benefit | Problem | Decision |
|---|---|---|---|
| Metric as ordinary Memory only | Graph-friendly | Numeric scope and conflict comparison become ambiguous | Reject alone |
| Separate metric-value table only | Precise comparisons | Results disappear from the graph and context model | Reject alone |
| Metric as Memory property | Simple | Cannot version, source, relate, or conflict independently | Reject |
| Fact Memory + specialized revision record | Graph-visible, revisioned, sourced, and machine-comparable | One extra entity | Adopt |

Each measurement is a `fact / metric_observation` Memory. Its current revision has exactly one `MetricObservation`.

`MetricObservation` fields:

| Field | Required | Meaning |
|---|---:|---|
| `revision_id` | yes | Primary identity; points to one immutable fact revision |
| `subject_memory_id` | yes | Experiment, module, method, or model being measured |
| `metric_name` | yes | Canonical metric label, e.g. `Clean mIoU` |
| `value_number` | yes | Numeric value used for comparison |
| `value_raw` | yes | Exact lexical value from the source, e.g. `65.433` |
| `unit` | no | `%`, `ms`, `GB`, etc.; null for unitless values |
| `dataset_memory_id` | no | Dataset Entity when applicable |
| `split` | no | `train`, `validation`, `test`, etc. |
| `protocol` | no | Compact protocol label, not a full experiment manager |
| `checkpoint` | no | Checkpoint label such as `epoch57` |
| `run_label` | no | Run identifier/label when genuinely known |
| `observed_at` | no | Time of measurement |
| `scope_key` | yes | Deterministic normalized comparison key derived from scope fields |

The comparison key uses project, subject, normalized metric name, dataset, split, protocol, checkpoint, and run label. Same key plus different numeric values yields a `value_conflict`. Missing scope dimensions lower confidence; the system creates a reviewable conflict or supersession candidate rather than assuming equivalence.

## 8. Cross-entity invariants

1. All linked Memories, Sources, Relations, Conflicts, and Context records belong to the same Project in the MVP.
2. A current revision belongs to its Memory and is the highest accepted revision number.
3. Revisions and finalized Context Snapshots are immutable.
4. A metric revision has exactly one MetricObservation; non-metric revisions have none.
5. A locked Memory may receive an incoming candidate and conflict, but automation may not alter its revision, lifecycle, verification, or deletion state.
6. A deleted Memory remains addressable by audit, conflict, provenance, and historical Context Snapshot records.
7. External session/message IDs are nullable and are never synthesized.

## 9. COMP-2DPASS worked example

The following is conceptual data, not an import format.

### Project and actors

- Project `p-comp`: `COMP-2DPASS`, slug `comp-2dpass`.
- Actor `a-user`: type `user`, display name `Local user`.
- Actor `a-codex`: type `codex`, display name `Codex extraction`.

### Source Records

- `s-msg-1`: `codex_conversation`; real session/message IDs are null because unavailable; original text says Stage1 obtained Clean mIoU 65.433 on SemanticKITTI at epoch57.
- `s-log-57`: `experiment_log`; file path `runs/stage1/epoch57/metrics.json`; locator `$.clean_miou`; original text `65.433`.
- `s-manual-constraint`: `manual_input`; original text `Do not modify the existing Fusion classifier.`; author `Local user`.

### Memories and current revisions

| Memory | Type / subtype | Role | Summary | State |
|---|---|---|---|---|
| SemanticKITTI | `entity / dataset` | `reference` | SemanticKITTI is the evaluation dataset used by the project. | active, confirmed |
| Stage1 | `entity / experiment` | `current_state` | Stage1 is the established baseline experiment. | active, confirmed |
| Stage2A | `entity / experiment` | `current_state` | Stage2A is the immediate predecessor experiment required before Stage2B. | active, confirmed |
| Stage2B | `entity / experiment` | `current_plan` | Stage2B is the next paired-ablation experiment. | active, confirmed, pinned |
| Prototype Retrieval | `entity / method` | `background` | Prototype Retrieval is used by Stage2 experiments. | active |
| Pseudo Prompt | `entity / method` | `background` | Pseudo Prompt supplies prompt information for the method. | active |
| Camera Missing | `issue / problem` | `known_issue` | Camera input may be unavailable in the missing-camera condition. | active |
| Missing Camera experiment | `entity / experiment` | `current_plan` | The missing-camera experiment evaluates behavior without camera input. | active |
| Fusion classifier constraint | `constraint / experimental` | `constraint` | The existing Fusion classifier must not be modified. | active, confirmed, locked |
| Stage1 Clean mIoU | `fact / metric_observation` | `baseline` | Stage1 achieved Clean mIoU 65.433 on SemanticKITTI at epoch57. | active, confirmed, locked |

The metric fact's `MetricObservation` is:

```yaml
subject_memory: Stage1
metric_name: Clean mIoU
value_number: 65.433
value_raw: "65.433"
unit: null
dataset_memory: SemanticKITTI
split: validation
protocol: clean
checkpoint: epoch57
run_label: stage1-baseline
```

Representative relations:

- Stage2A `part_of` Stage2B experiment program only if that hierarchy is factually intended; otherwise use `depends_on`.
- Stage2B `uses` Prototype Retrieval.
- Stage2B `uses` Pseudo Prompt.
- Missing Camera experiment `evaluated_on` SemanticKITTI.
- Missing Camera experiment `addresses` Camera Missing.
- Fusion classifier constraint `constrains` Stage2B.
- Stage1 `has_result` Stage1 Clean mIoU.
- Stage1 Clean mIoU `evaluated_on` SemanticKITTI.

If Codex extracts `Stage1 Clean mIoU = 65.564` with the same scope key, it creates a candidate fact revision backed by its own Source Record. It does not modify the locked 65.433 Memory. A `value_conflict` links the exact existing and incoming revisions.

A Context Session for `Continue designing the Stage2B experiment` can freeze selections for the current revisions of Stage2B, Stage2A, Stage1, SemanticKITTI, Prototype Retrieval, Pseudo Prompt, Camera Missing, the locked Fusion classifier constraint, and the 65.433 baseline. If the baseline later becomes 65.564, the old Context Snapshot continues to contain revision 1 and its frozen `65.433` payload.

## 10. Deliberate MVP simplifications

- No user accounts, permissions, tenants, cloud sync, or cross-project relations.
- No vector embeddings, ontology reasoner, learned importance model, or automatic truth adjudication.
- No full ML run, artifact, hyperparameter, or lineage platform; run/checkpoint/protocol remain compact scope fields.
- Conflicts are pairwise. Multi-way conflicts are represented by multiple pairwise records.
- Relations are not revisioned; editing a relation soft-deletes the old edge and creates a new sourced edge.
- `metadata_json` is an escape hatch for source-specific data, not a substitute for core fields.
- Physical purge and cryptographic audit logs are outside the MVP.

## 11. Phase 3 logical table inventory

Phase 3 should create logical tables for: `projects`, `actors`, `memories`, `memory_revisions`, `memory_events`, `source_records`, `revision_sources`, `relations`, `relation_sources`, `metric_observations`, `conflicts`, `context_sessions`, `context_snapshots`, `context_selections`, and `context_selection_reasons`.

SQLite migration syntax, indexes, FTS tables, triggers, and constraints are intentionally deferred to Phase 3.

## 12. Phase 7 implementation note

No Schema or migration change is required. Editor transactions reuse immutable Revisions, MetricObservations, Notes and Events; provenance and frozen Context Snapshots remain. Version conditions and short-lived preview plans are application-level concerns. See [Memory Editor](./memory-editor.md).
