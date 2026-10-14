# Visual Context Memory

Local project memory for Codex, with a visual graph, evidence and immutable revision history. This is an early local preview, **not a published service**.

## Run locally

Requires Node 24+ and npm. In this application directory:

```sh
npm ci
npm start
```

Open http://127.0.0.1:4173. The default database is `.visual-context-memory/memory.db`, relative to the launch directory. Start consistently from this directory or set an explicit `VCM_DB_PATH`. `VCM_PORT` changes the local port. Do not expose or reverse-proxy the write API to the Internet: it is a single-user local trust boundary, not an authenticated cloud service.

On a fresh database, choose **Create your first project**, give it a name, then **New memory**. Enter a short name, what should be remembered, and a type. Creation preserves the submitted text as manual provenance and creates immutable Revision 1; the graph and Inspector update immediately. Additional detail is optional. No demonstration data or automatic extraction is required.

### Try a separate demo

```sh
VCM_DB_PATH=.visual-context-memory/demo.db npm run demo:seed
VCM_DB_PATH=.visual-context-memory/demo.db npm start
```

Demo records are fictional illustrations, not verified experiment results. Keep them separate from real project records. Manual creation is available for the seven basic types; new scoped Metric observations and bulk import are not part of this first-use flow.

## Install the Skill locally

Copy this **whole application directory**, excluding node_modules, private `.visual-context-memory` databases and test artifacts, into your Codex skills directory as `visual-context-memory`. Run `npm ci` in that installed directory. Keep `SKILL.md`, `src`, `viewer`, `references` and package files together: this is an application-backed Skill, not a stand-alone prompt. Do not overwrite an existing installation or database without a backup and explicit approval.

Invoke `$visual-context-memory` to find/review project knowledge. The Skill uses the local HTTP API; explicit user writes retain versions and provenance. It does not automatically extract conversation memory or build prompts/context.

## Verify

```sh
npm test
node scripts/verify-local-install.mjs
```

Browser scripts in `scripts/verify-*.mjs` use saved app code, an isolated SQLite database and headless Chrome. Set `VCM_PLAYWRIGHT_MODULE` to a local Playwright module location if the supplied runtime path is unavailable. Browser runtime portability remains release work.

## Release status

Create an unpublished source-only preview with:

```sh
node scripts/package-skill.mjs /absolute/path/to/new-preview.tar.gz
```

The archive includes LICENSE, the lockfile, runtime, Skill documentation and tests; excludes databases, node_modules and local reports; and refuses to overwrite an existing archive. It is a local preview artifact under MIT, not a hosted service. Extract it into an isolated directory and run `npm ci`, `npm test` and the demo commands before installing.

The [public repository](https://github.com/WUWengZheng/visual-context-memory) contains the local preview source, Skill entrypoint, setup instructions and preview packager. Clean-machine smoke testing and an independent public introduction site remain release work. This is not a hosted memory service. See `references/release-readiness.md` for the current checklist. Database files, evidence excerpts and user notes must never enter a public release.

## License

MIT — see [LICENSE](LICENSE). Preserve the copyright and license notices when redistributing this project's code. Dependencies retain their own notices; Cytoscape is installed separately through npm and is not copied into the source-only preview archive.
