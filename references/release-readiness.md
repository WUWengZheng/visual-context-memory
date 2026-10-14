# Release readiness

The goal is a distributable Codex Skill and a simple, clear website; local UI improvements alone do not prove launch completion.

- [x] Local HTTP/SQLite app and explicit Memory Editor.
- [x] Application-backed SKILL.md with scoped read/write boundaries.
- [x] First-run and isolated-demo instructions; private data ignore rules.
- [x] Validate Skill frontmatter (skill-creator validator).
- [x] Produce a source-only preview excluding local databases, notes, node_modules and reports; same-machine repeated build SHA-256 regression.
- [x] Run CLI/API smoke test and 127 Node tests from an extracted preview after npm ci, on this macOS host (not a fresh-machine claim).
- [x] First-run project creation and explicitly submitted manual memories in a fresh database; sourced Revision 1 and protected drafts. Bulk import and new scoped Metric observations are not in this basic workflow.
- [x] Owner delegated license choice on 2026-10-14; MIT selected for permissive reuse. Root LICENSE, package metadata and archive inclusion are in place.
- [x] User supplied GitHub owner WUWengZheng on 2026-10-14; connected repository inventory is readable.
- [x] User approved new public repository; WUWengZheng/visual-context-memory created on 2026-10-14: https://github.com/WUWengZheng/visual-context-memory. GitHub API verifies public visibility, size 0 and no license. No project files uploaded.
- [ ] Upload reviewed source and choose website publication location.
- [ ] Build and verify a standalone public introduction site; never expose the local write API.
- [ ] Validate public install/download links and external availability after publishing.

The local application's core task is to find a Memory, inspect its meaning/evidence and explicitly edit when needed. Refinement keeps the light three-panel workspace and responsive drawers, reduces visual noise, and progressively reveals audit metadata, lifecycle controls and note composition. No capability is silently removed.

Verified on 2026-10-13: Node 122/122 in the source tree and extracted preview; real Chrome Viewer 16/16, Editor 14/14, controlled API races 4/4; progressive-action keyboard check and 900px/640px overflow checks pass. Skill frontmatter validation passes. The design detector reported no findings on the changed CSS/HTML/Inspector surfaces. Browser fault injection and controlled API mocks are not counted as full backend verification. Existing demonstration databases are not automatically rewritten: the fixed seeder applies to new isolated demo databases; use a fresh demo path for a corrected Metric fixture.

The source-only preview uses zero file timestamps and zero gzip wall time. Same-host repeated SHA-256 equality is asserted; byte identity across different operating systems/tar implementations has not been verified. Browser verification is headless macOS Chrome only, not Safari/Firefox or a clean machine. No global Codex Skill installation or public upload occurred. The preview installer test exercised the Skill's runtime; autonomous model selection/behavior of the new instructions still needs a separate evaluation.

This checklist stays incomplete until authoritative public release/install evidence exists. An active development goal is not proof of launch.

2026-10-14 first-use verification: source and extracted preview 127/127 Node tests; creation Chrome 8/8; existing Viewer 16/16, Editor 14/14 and API Mock races 4/4. New creation Node coverage is three real HTTP/SQLite cases plus two controlled Controller cases. Creation browser includes an injected 422, an actual backend commit whose response is deliberately dropped, and a gated workspace response; these are explicitly fault/timing injection, not ordinary happy-path tests. Skill validator and JavaScript syntax checks pass; UI detector reports no findings. See first-use-output.md for actual output. No migration, runtime framework, automatic extraction or public deployment was added.
