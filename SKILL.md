---
name: visual-context-memory
description: Find and review project memories, provenance and revision history in local Visual Context Memory, or explicitly create/edit project knowledge when asked. Not for automatic extraction or general chat memory.
---

# Visual Context Memory

This Skill accompanies a local Node 24+ application. Resolve the application root from this file's directory, not the user's working directory. The HTTP server binds only to 127.0.0.1 and is not authenticated for public deployment.

## Connect

Read `README.md` for installation and first-run commands. Use the configured local URL, normally `http://127.0.0.1:4173`. Check `/api/health` before relying on a server; do not treat an unrelated process on this port as the user's memory database. If no server is available, explain how to start it or, when asked to launch, run the documented command from this application's root. Do not change an existing database path or seed demonstration records into real project data without the user's request.

## Read established knowledge

Fetch `/api/projects` and choose the user's project by returned ID/name. Ask when multiple projects are plausible. Never use synthetic IDs or combine unrelated projects.

For Library/search use bounded `page=true` queries; preserve project and all requested filters. Read `references/http-api.md` for exact route/parameter contracts. Totals represent matches, not necessarily every project memory. Follow pages only as needed rather than downloading the full database.

Read selected Memory detail and its sources/revisions to distinguish current verified assertions, candidates, outdated/rejected history and evidence. Explain uncertainty and provenance. Values from different Metric runs/checkpoints/protocols are different observations, not automatically conflicting corrections. Report evidence; do not invent history or claim a Context Builder exists.

## Explicit human writes only

Writes require the user's direct authorization for the specific change. Read `references/memory-editor.md` before writing. Use HTTP into Domain Services; never bypass lifecycle policies with direct SQL or edit immutable revisions. Semantic edits carry the current `expectedRevisionId`; 409 REVISION_MISMATCH requires fresh review, not automatic retry/merge.

For an explicitly requested first-use project, POST `/api/projects` with its name and use the returned ID. For an approved new assertion, POST `/api/memories` with that project ID and approved name/type/summary (optional description). This creates active, user_confirmed knowledge with a manual_input source containing the submitted text; it does not claim to preserve a verbatim conversation excerpt. Do not generate assertions just to fill an empty database. Do not retry unknown creation outcomes: read projects/current search results and inspect identity first. New Metric observations and bulk import are not supported by this basic creation flow.

Merge, Supersede, soft delete and existing Conflict resolution use `/api/editor/preview`. Show the actual backend impact and obtain approval before `/api/editor/execute`. A stale preview must be regenerated and reviewed. Keep histories/sources and preserve Lock unless the user explicitly unlocks. Network-interrupted writes may have committed: reconcile Current/history/notes before any new submission, never blindly repeat POST.

Automatic extraction, automatic conflict detection, Context Builder/Preview and cloud synchronization are not implemented. Do not pretend these workflows are available or infer write authority from this Skill being selected.
