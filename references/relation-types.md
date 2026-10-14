# Visual Context Memory — Relation Model

Status: Phase 2 design  
Canonical schema: [memory-schema.md](./memory-schema.md)

## 1. Purpose

A Relation is a directed, explainable claim between two Memories. Project membership is not a stored relation: `project_id` is authoritative, and a viewer may render the Project as a synthetic root.

## 2. Relation fields

| Field | Required | Meaning |
|---|---:|---|
| `id` | yes | Internal UUID |
| `project_id` | yes | Project isolation boundary |
| `source_memory_id` | yes | Directed edge origin |
| `target_memory_id` | yes | Directed edge destination |
| `relation_type` | yes | Controlled type from section 3 |
| `confidence` | yes | Extraction confidence from `0.0` to `1.0`; user-created edges use `1.0` |
| `status` | yes | `active` or `deleted` |
| `created_by_actor_id` | yes | User, Codex, system, or importer |
| `created_at` | yes | UTC timestamp |
| `deleted_by_actor_id`, `deleted_at`, `deletion_reason` | no | Soft-deletion audit fields |

Provenance is many-to-many through `RelationSource(relation_id, source_id, evidence_role, created_at)`.

Relations are not updated in place when their meaning changes. The old relation is soft-deleted and a new relation is created with new provenance. This provides sufficient MVP auditability without a `RelationRevision` hierarchy.

## 3. Controlled relation vocabulary

### Structural and dependency relations

| Type | Meaning | Example |
|---|---|---|
| `part_of` | Source is a structural or conceptual component of target | Stage2B ablation `part_of` Stage2 experiment plan |
| `uses` | Source actively uses target | Stage2B `uses` Prototype Retrieval |
| `depends_on` | Source cannot proceed or remain valid without target | Stage2B `depends_on` Stage2A result |

### Evaluation, output, and intervention relations

| Type | Meaning | Example |
|---|---|---|
| `evaluated_on` | Source is evaluated against target dataset/scope | Stage1 `evaluated_on` SemanticKITTI |
| `has_result` | Source experiment/module owns a result Fact | Stage1 `has_result` Stage1 Clean mIoU |
| `produces` | Source generates target artifact, file, or non-metric Fact | training run `produces` checkpoint file |
| `addresses` | Source resolution or experiment addresses target Issue | Missing Camera experiment `addresses` Camera Missing |
| `constrains` | Source Constraint limits target | classifier constraint `constrains` Stage2B |

### Epistemic and historical relations

| Type | Meaning | Example |
|---|---|---|
| `supports` | Source provides evidence for target | ablation result `supports` conclusion |
| `contradicts` | Source provides evidence incompatible with target | new result `contradicts` old conclusion |
| `supersedes` | Source replaces target as the current valid knowledge | revised decision `supersedes` old decision |
| `derived_from` | Source was produced by transforming or interpreting target | conclusion `derived_from` result |
| `related_to` | Symmetric fallback when no stronger relation is justified | concept A `related_to` concept B |

There are thirteen relation types. New types should be added only when an existing type would materially misrepresent direction or meaning.

## 4. Deliberately excluded candidate types

- `belongs_to`: Project membership is already `project_id`; within-project hierarchy uses `part_of`.
- `has_metric`: Use `has_result` because the target is a graph-visible Fact Memory with a `MetricObservation` specialization.
- `solves`: Use `addresses`; it does not overclaim that a problem is fully solved.
- `supported_by`: Use the inverse display of `supports`; do not store both directions.
- `is_part_of`, `member_of`, `contains`: Normalize to `part_of` and derive inverse labels for the UI.

## 5. Direction and inverse display labels

Only the canonical direction is stored. The viewer may display an inverse label without creating another row:

| Stored edge | Inverse display |
|---|---|
| A `part_of` B | B `contains` A |
| A `uses` B | B `used_by` A |
| A `depends_on` B | B `required_by` A |
| A `has_result` B | B `result_of` A |
| A `constrains` B | B `constrained_by` A |
| A `supports` B | B `supported_by` A |
| A `supersedes` B | B `superseded_by` A |

`related_to` is logically symmetric. Store one row using deterministic UUID ordering to prevent duplicate reverse edges.

## 6. Relation invariants

1. Both endpoints and the relation belong to the same Project.
2. Self-relations are forbidden except when a future relation type explicitly requires one; none do in the MVP.
3. Duplicate active edges with the same endpoints and type are forbidden.
4. `confidence` reports extraction certainty, not truth probability. User confirmation should create an audit event or replacement edge rather than silently rewriting confidence.
5. `supersedes` must point from newer/current knowledge to older knowledge and should agree with lifecycle state.
6. `contradicts` does not itself resolve a Conflict.
7. A relation touching a deleted Memory remains available to historical audit but is hidden from the default graph.

## 7. COMP-2DPASS relation set

- Stage2B `depends_on` Stage2A.
- Stage2B `uses` Prototype Retrieval.
- Stage2B `uses` Pseudo Prompt.
- Stage1 `evaluated_on` SemanticKITTI.
- Stage1 `has_result` Stage1 Clean mIoU 65.433.
- Stage1 Clean mIoU 65.433 `evaluated_on` SemanticKITTI.
- Missing Camera experiment `evaluated_on` SemanticKITTI.
- Missing Camera experiment `addresses` Camera Missing.
- Fusion classifier constraint `constrains` Stage2B.
- A later 65.564 fact may `supersedes` 65.433 only after explicit conflict resolution; before that, the disagreement exists solely as an open Conflict.
