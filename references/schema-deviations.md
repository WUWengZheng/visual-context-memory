# Phase 3–4 Schema Deviations

Status: reviewed after mapping the frozen Phase 2 model to SQLite

## Result

There is no semantic deviation from the Phase 2 model. Phase 3 required three additive technical details; Phase 4 adds one explicitly approved domain table and a forward-only event-vocabulary migration:

### `schema_migrations` table

- Original design: listed as an optional technical table for Phase 3.
- Reason: migration application must be durable and idempotent.
- Change: add `schema_migrations(version, applied_at)`.
- Impact: technical only; no domain behavior changes.

### `context_snapshots.sealed_at`

- Original design: Context Snapshots are immutable immediately after aggregate creation.
- Problem: a Snapshot, its Selections, and Selection Reasons must be inserted in one transaction before the aggregate can become immutable.
- Change: insert the Snapshot unsealed inside the transaction, insert all children, then set `sealed_at` exactly once. Triggers reject later Snapshot updates and any later Selection or Reason inserts.
- Impact: strengthens the original invariant; the unsealed state is never returned by the public Store because the transaction either seals or rolls back.

### `metric_observations.created_at`

- Original design: the observation carries `observed_at`, which may be unknown.
- Problem: deterministic storage ordering and audit still need an insertion timestamp when `observed_at` is null.
- Change: add required UTC `created_at` while keeping nullable `observed_at` unchanged.
- Impact: technical audit metadata only.

### Phase 4 `002-domain-events-and-notes` migration

- Original design: `MemoryEvent` was append-only and Notes were not yet modeled as semantic content.
- Change: a forward-only `002-domain-events-and-notes.sql` rebuilds only the SQLite `memory_events` table to add the controlled events `importance_changed`, `note_added`, and `note_deleted`, preserving all existing immutable event rows and triggers. It also adds the single approved `memory_notes` table.
- Reason: Importance and Notes are control/audit behavior, not revisioned claim content. Storing a Note in `MemoryRevision.description` would create false semantic revisions; storing it only in Event metadata would make normal note listing and one-time soft deletion unnecessarily fragile.
- Impact: `MemoryNote` is a small additive domain entity with immutable content and auditable soft deletion. No Phase 2 Memory, Revision, Relation, Conflict, or Context semantics changed. `001-initial.sql` remains untouched.

## Known SQLite enforcement boundary

SQLite cannot express a deferred cross-table assertion that every `fact / metric_observation` revision has exactly one `metric_observations` row at transaction commit. The schema enforces the reverse direction—every MetricObservation must point to a matching Fact/metric revision—and enforces at most one through the primary key. Normal Store workflows create and test the observation explicitly. A future specialized create-metric transaction may tighten this public workflow without changing the schema.
