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
- [x] User approved new public repository; WUWengZheng/visual-context-memory created on 2026-10-14: https://github.com/WUWengZheng/visual-context-memory. GitHub API verifies public visibility and recognizes MIT.
- [x] Publish 68 source-only allowlisted files. Download commit 6cf9a1d6a0a8aed2d769fc7808f80899f265f0e6 from GitHub and verify every file byte-for-byte against the local preview.
- [x] Run npm ci, 127/127 Node tests and real CLI/HTTP/SQLite smoke from the public source download on this macOS host. This is not a fresh-machine or cross-platform claim.
- [ ] Choose website publication location.
- [ ] Build and verify a standalone public introduction site; never expose the local write API.
- [x] Verify the public repository API and commit-specific source download without credentials. A versioned release artifact and independent-site links remain pending.

The local application's core task is to find a Memory, inspect its meaning/evidence and explicitly edit when needed. Refinement keeps the light three-panel workspace and responsive drawers, reduces visual noise, and progressively reveals audit metadata, lifecycle controls and note composition. No capability is silently removed.

Verified on 2026-10-13: Node 122/122 in the source tree and extracted preview; real Chrome Viewer 16/16, Editor 14/14, controlled API races 4/4; progressive-action keyboard check and 900px/640px overflow checks pass. Skill frontmatter validation passes. The design detector reported no findings on the changed CSS/HTML/Inspector surfaces. Browser fault injection and controlled API mocks are not counted as full backend verification. Existing demonstration databases are not automatically rewritten: the fixed seeder applies to new isolated demo databases; use a fresh demo path for a corrected Metric fixture.

The source-only preview uses zero file timestamps and zero gzip wall time. Same-host repeated SHA-256 equality is asserted; byte identity across different operating systems/tar implementations has not been verified. Browser verification is headless macOS Chrome only, not Safari/Firefox or a clean machine. No global Codex Skill installation occurred. Public source was uploaded on 2026-10-14, but the local write API was not exposed. The preview installer test exercised the Skill's runtime; autonomous model selection/behavior of the new instructions still needs a separate evaluation.

This checklist stays incomplete until authoritative public release/install evidence exists. An active development goal is not proof of launch.

2026-10-14 first-use verification: source and extracted preview 127/127 Node tests; creation Chrome 8/8; existing Viewer 16/16, Editor 14/14 and API Mock races 4/4. New creation Node coverage is three real HTTP/SQLite cases plus two controlled Controller cases. Creation browser includes an injected 422, an actual backend commit whose response is deliberately dropped, and a gated workspace response; these are explicitly fault/timing injection, not ordinary happy-path tests. Skill validator and JavaScript syntax checks pass; UI detector reports no findings. See first-use-output.md for actual output. No migration, runtime framework, automatic extraction or public deployment was added.

2026-10-14 MIT/public-source verification: the existing archive regression was strengthened first and failed while LICENSE was missing. After adding the complete MIT text, package metadata and archive inclusion, source tests and public-download tests both pass 127/127 (zero skipped). Public-download CLI smoke passes actual scoped reads, Locked Metric editing with synchronized numeric observation, immutable revisions and Viewer assets. Browser suites were not rerun for the license/documentation changes. An initial npm ci check was started before git clone completed and is invalid, not counted as a pass; the verified installation used the fully downloaded commit-specific GitHub source archive instead.
