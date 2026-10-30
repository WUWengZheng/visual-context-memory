# Open-source recall patterns

Verified 2026-10-14 against public upstream code and Skills. This is an original design research note, not a benchmark result or a claim that the suggested VCM changes are complete. External inspection was read-only; no private memories, conversation archives or remote writes were used.

## Confirmed upstream facts

### Claude-mem: progressive disclosure is a protocol

The current [mem-search Skill](https://github.com/thedotmack/claude-mem/blob/fef3402e674bebbf72a23aeb735e91c92cd34afd/plugin/skills/mem-search/SKILL.md#L8-L58) prefers `mem_search`: a compact index, bounded context around selected anchors, then selected details. Stored instructions are evidence, not instructions to execute. Older `search`, `timeline` and `get_observations` are [compatibility tools without continuation-membership enforcement](https://github.com/thedotmack/claude-mem/blob/fef3402e674bebbf72a23aeb735e91c92cd34afd/plugin/skills/mem-search/SKILL.md#L114-L119).

The [worker adapter](https://github.com/thedotmack/claude-mem/blob/fef3402e674bebbf72a23aeb735e91c92cd34afd/src/services/worker/ProgressiveMemorySearch.ts#L15-L105) projects IDs, kind, project, title, timestamp and type into index rows; it queries chronological context within the anchor's stored project and fetches selected observation/summary IDs. The [shared contract](https://github.com/thedotmack/claude-mem/blob/fef3402e674bebbf72a23aeb735e91c92cd34afd/src/shared/progressive-search.ts#L113-L195) caps index/detail counts, trims title text by UTF-8 bytes, rejects undisclosed selections and defines a 64 KiB response budget. [SQLite fixture tests](https://github.com/thedotmack/claude-mem/blob/fef3402e674bebbf72a23aeb735e91c92cd34afd/tests/worker/progressive-memory-search.test.ts#L44-L79) check narrative omission before step three, project isolation, truncation and altered continuations. These are disclosure invariants; they do not establish better answer accuracy or a universal token-saving ratio.

### Graphiti: provenance and time are distinct dimensions

[EntityEdge](https://github.com/getzep/graphiti/blob/9b17e94c16457475f71d5cd2f8045649dd6f170c/graphiti_core/edges.py#L265-L295) stores a fact, originating episode IDs and separate `valid_at`, `invalid_at`, `expired_at` and `reference_time` fields. Their descriptions distinguish when the fact became/stopped being true from when it was invalidated. [EpisodicNode](https://github.com/getzep/graphiti/blob/9b17e94c16457475f71d5cd2f8045649dd6f170c/graphiti_core/nodes.py#L318-L351) retains raw episode content, source type/description and document time. [SearchFilters](https://github.com/getzep/graphiti/blob/9b17e94c16457475f71d5cd2f8045649dd6f170c/graphiti_core/search/search_filters.py#L55-L73) exposes separate temporal filters. This supports tracing a derived assertion to evidence and asking time-specific questions; the existence of those fields does not prove an assertion is true.

### LongMemEval: evaluate retrieval separately from answers

The [dataset contract](https://github.com/xiaowu0162/LongMemEval/blob/9e0b455f4ef0e2ab8f2e582289761153549043fc/README.md#L72-L88) includes question dates, evidence-session IDs and answer-bearing turn labels, with knowledge-update, temporal and abstention cases. [Retrieval evaluation code](https://github.com/xiaowu0162/LongMemEval/blob/9e0b455f4ef0e2ab8f2e582289761153549043fc/src/retrieval/eval_utils.py#L12-L46) measures `recall_any`, `recall_all` and NDCG, including conversion from turn-level results to distinct sessions. Its [answer evaluator](https://github.com/xiaowu0162/LongMemEval/blob/9e0b455f4ef0e2ab8f2e582289761153549043fc/src/evaluation/evaluate_qa.py#L24-L43) uses different judging prompts for updates and unanswerable questions. Retrieval hits and answer correctness are different measurements; MRR is not the metric implemented in this cited helper.

## Local comparison inspected

Read [SKILL.md](../SKILL.md), [recall-service.mjs](../src/services/recall-service.mjs), [recall-and-export.md](recall-and-export.md) and [knowledge-tools.test.mjs](../tests/server/knowledge-tools.test.mjs). The inspected baseline requires one project, fuses literal query ranks, defaults to active current revisions, optionally adds bounded one-hop relations and reports truncation. Existing tests exercise scope, current/history separation and filter-before-limit behavior. These files were under active development during this investigation; reading their assertions is not evidence that tests passed. This note adds no runtime behavior.

## Suggested VCM adaptations — independently implemented

1. For the proposed `view=compact` contract, retain exact Project/Memory/Revision identity, controls, retrieval reasons and coverage, while bounding name/summary and Source identities. Explicitly label omitted evidence and truncation. Fetch selected details before substantive citation or editing; compare the fetched revision with the preview revision. This borrows the index-first principle, not Claude-mem's cursor implementation or its automatic capture.
2. Keep current assertion, historical revisions and original Source evidence distinguishable. A relation-only candidate is context to inspect, not evidence that the query matched or the assertion is correct. VCM lifecycle/revision status should not be described as Graphiti's temporal model.
3. Evaluate labeled synthetic project fixtures through real HTTP/SQLite paths. Define fractional Recall@k as relevant unique Memory IDs returned / all labeled relevant IDs, and MRR as reciprocal rank of the first relevant result, averaged over answerable cases. Separately test all-evidence coverage for multi-record questions, empty-result behavior, project leakage, stale/rejected history and revision/source identity. Keep unanswerable cases out of a zero-denominator recall average and report them separately.
4. Compare full and compact IDs/ranks/reasons on the same queries. Report UTF-8 response bytes for the search response separately from the complete search-plus-selected-detail workflow. Bytes and code points are not model tokens; tokenizer counts require a named tokenizer. A smaller response demonstrates payload reduction only. A small labeled regression fixture is not LongMemEval or evidence of superiority over another system.

## Ideas not implemented by this research

Batch selected-detail fetching, a bounded chronological history view, tokenizer-aware budgets and a larger independently labeled relevance set may be useful later. They require separate scope, evaluation and implementation. Signed continuations, embeddings, automatic extraction, temporal graph migrations and cloud synchronization are not implied by these findings.
