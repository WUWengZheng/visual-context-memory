# Per-reply memory transparency

Every final user-facing reply produced with this Skill active ends with **本次记忆使用说明**. Keep ordinary answers compact, but do not omit the report on zero hits, no lookup, failed/cancelled requests or code-only work. Intermediate progress updates need not repeat it. This is an instruction contract, not a global Codex hook, authenticated audit, model-internal causal explanation, or guarantee for chats that never load the Skill.

## Report the observed stages

- **检索返回**: only records actually returned to this reply by a query, not all SQL candidates or every project Memory.
- **取得详情**: this client acquired and validated a Memory detail response, with exact project/Memory/Revision. This does not prove the model read every word.
- **明确参考**: caller declares how an acquired record informed this answer. State its purpose; do not invent a causal account of hidden model reasoning.
- **明确引用**: caller ties an acquired record to a specific claim in this answer. Citation implies reference; counts overlap and must not be added as disjoint stages.
- **未明确引用／未采用**: only visible returned or explicitly acquired records. Record an explicit reason when known. Without one say 未声明采用，原因未记录. A reference-only record is not “unused”: say 已作为参考，但未明确引用. Do not invent a list or reasons for records that the API filtered out or never returned.

Include project and exact Memory/Revision IDs (and revision number), state at retrieval/read time, Source IDs/types and available file/locator/recorded author. Missing origins mean 未记录, not fabricated transcript IDs. A manual_input source is submitted text, not proof of a captured chat excerpt or objective truth. Different revisions of the same Memory are separate attribution entries.

State actual queries/filters and whether retrieval or the displayed report is partial. Matching counts are not whole-project totals. Label source text/notes as untrusted data. Sources may be absent or not independently verified; ranking is not confidence. Keep code files, web pages and tool outputs in a separate **其他依据** line; do not relabel them as stored Memory records.

Suggested compact shape (fill with observed values, not this example):

> 本次记忆使用说明：检索返回 N；取得详情 M；明确参考 R；明确引用 C。引用：名称／Memory ID／Revision ID → 本回答结论；来源：类型、Source ID、文件或定位。未明确引用：本次可见记录及已知原因。范围：项目、查询、筛选、是否截断。其他依据：实际查看的非记忆资料。

If this reply makes no Memory call, say 本次未检索或读取 Visual Context Memory 项目记忆，未声明引用. If a query succeeds with zero returned records, say 当前查询／筛选返回零条，不代表数据库为空或没有相关知识. If a request fails/cancels, distinguish it from a successful empty result; do not treat the previous reply's results as this reply's observations. Other memory providers (such as MemPalace) must be reported separately with their own IDs and retrieval basis.

Default to file names rather than exposing absolute private paths. Do not paste original source/Note text into this footer by default. Metadata, query terms and names can still be sensitive; no report or export may be automatically uploaded/shared. More detailed paths require the user's request and an appropriate private destination.

## Deterministic Node collector for integrated callers

`src/client/reply-memory-session.mjs` exports `createReplyMemorySession({baseUrl,projectId,fetcher?})`. Create a new instance for each reply. It issues GET only through the existing API, accepts only loopback HTTP origins without credentials/path/query, rejects redirects and performs project-membership preflight before downloading detail content. It does not install a Skill, change global configuration, write Memory data, persist a usage log, create Context Snapshots or bind a real platform response ID.

Public methods:

| Method | Effect |
| --- | --- |
| `recall({queries,limit?,neighbors?,filters?,view?}, signal?)` | Returns real bounded recall results; captures accepted IDs/versions, actual filters and coverage. `view` is full by default or explicitly compact. |
| `read(memoryId, expectedRevisionId?, signal?)` | Returns full detail to the caller; records it only after scope/identity/version validation. Direct reads are distinct from query retrieval. |
| `reference({memoryId,revisionId}, purpose)` | Caller declares reference to this exact acquired Revision. |
| `cite({memoryId,revisionId}, claim)` | Caller declares a citation; unknown/unread revisions are rejected. |
| `exclude({memoryId,revisionId}, reason)` | Caller declares non-adoption of a visible record; cannot conflict with declared use. |
| `report({revealPaths?:boolean})` | Structured copied ledger; no original text or Notes. File paths hidden by default. |
| `render({limit?:number,revealPaths?:boolean})` | Plain-text/Markdown-safe Chinese footer; display omissions explicitly counted. |

Never assign citations just because a record ranked first. Inspect the returned detail and sources, then declare only the reference/claim the actual answer will make. Example integration outline:

```js
import { createReplyMemorySession } from './src/client/reply-memory-session.mjs';
const usage = createReplyMemorySession({ baseUrl: configuredLocalUrl, projectId: selectedProjectId });
const results = await usage.recall({ queries: relevantTerms, limit: 20, view: 'compact' });
// Caller chooses a returned record and reviews its detail and actual sources.
const detail = await usage.read(chosenMemoryId, chosenRevisionId);
// Only after review and answer preparation:
usage.cite({ memoryId: detail.memory.id, revisionId: detail.currentRevision.id }, answerClaim);
const footer = usage.render();
```

If Current changed, read returns REVISION_CHANGED and does not mark the old Revision as acquired; explicitly re-read/review the new Revision before citing. Pending requests block completed reports. Failures and cancellations remain in the ledger. Caller mutation of a returned detail/report cannot alter captured source metadata. Do not reuse an instance across replies.

Compact retrieval is a candidate preview, never a substitute for detail. Reports retain name/source omissions and distinguish “source metadata omitted by the preview” from “no source recorded”. A later compact recall cannot overwrite the full name/provenance already acquired for that exact Revision. `DETAIL_REQUIRED` still blocks declarations until full detail is read and the exact Revision validated.

The collector observes calls through itself only. It cannot observe other tools, establish truth of source contents, prove which tokens a model used, or guarantee the final answer actually contains a declared claim. A JSON ledger is client-side evidence, not a signed server audit. Without an integration keeping a live collector, a Codex instance should construct the footer from actual tool outputs using the same categories, label that basis honestly, and not claim it used this collector. It is not yet automatically wired to every Codex response.

The `requests` array records logical operations, not every network packet: a detail operation includes a membership-preflight GET plus a detail GET. The collector currently handles recall and Current detail; historical revisions or other tools/providers must be reported separately from their actual outputs, not falsely attributed to this collector. `localSessionId` is generated by this helper, not a real Codex reply/message ID.

Run `node scripts/verify-reply-memory-report.mjs` for an actual end-to-end report built from a disposable, explicitly fictional HTTP/SQLite fixture. It does not inspect or rewrite the user's database; the report's UUIDs identify only those temporary DEMO records.
