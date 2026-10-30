// Ephemeral client-side observation ledger. GET only; never a signed audit or model causality log.
import { randomUUID } from 'node:crypto';
import { createApi, ApiError } from '../../viewer/api.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
function requireId(value) {
  if (typeof value !== 'string' || !uuid.test(value)) throw new TypeError('Memory, Revision and project IDs must be UUIDs');
  return value;
}
function failure(code, message) { return new ApiError(message, { kind: 'client', code }); }
function refKey({ memoryId, revisionId }) { return `${requireId(memoryId)}:${requireId(revisionId)}`; }
function text(value) {
  return String(value ?? '').replace(/[\x00-\x1f\x7f\u2028-\u202e\u2066-\u2069]/gu,
    (character) => `\\u${character.codePointAt(0).toString(16).padStart(4, '0')}`)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replace(/[\\`*_{}\[\]()]/gu, '\\$&');
}
function declaration(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 1000) {
    throw new TypeError('A declaration must contain 1–1000 characters');
  }
  return value.trim();
}
function publicSources(sources, revealPaths) {
  return sources.map((source) => ({ ...source,
    filePath: source.filePath && !revealPaths ? source.filePath.split(/[\\/]/u).at(-1) : source.filePath,
    pathRedacted: Boolean(source.filePath && !revealPaths),
  }));
}

function sourceLabel(source) {
  const metadata = [`Source ${text(source.id)}`];
  if (source.filePath) {
    metadata.push(`文件 ${text(source.filePath)}${source.pathRedacted ? '，路径已隐藏' : ''}`);
  }
  if (source.locator) metadata.push(`定位 ${text(source.locator)}`);
  if (source.author) metadata.push(`记录作者 ${text(source.author)}`);
  return `${text(source.sourceType)}（${metadata.join('；')}）`;
}

export function createReplyMemorySession({ baseUrl, projectId, fetcher = fetch }) {
  requireId(projectId);
  const base = new URL(baseUrl);
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname)
    || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
    throw new TypeError('Use an explicit loopback HTTP server origin without credentials or a path');
  }
  const api = createApi((route, options) => fetcher(new URL(route, base), { ...options, redirect: 'error' }));
  const localSessionId = randomUUID();
  const items = new Map();
  const requests = [];
  let pending = 0;

  function normalize(memory, sources, preview = null, sourceCoverage = null) {
    if (!memory || memory.projectId !== projectId) throw failure('PROJECT_MISMATCH', 'Response belongs to another project');
    const revision = memory.currentRevision;
    if (!revision || revision.id !== memory.currentRevisionId || !Array.isArray(sources)) {
      throw failure('INVALID_USAGE_RESPONSE', 'Response does not contain consistent Revision/source data');
    }
    const entry = {
      memoryId: requireId(memory.id), revisionId: requireId(revision.id),
      revisionNumber: revision.revisionNumber, name: revision.name,
      nameTruncated: preview?.nameTruncated ?? false,
      sourceCoverage: sourceCoverage ? structuredClone(sourceCoverage)
        : { metadata: 'detail', total: sources.length, returned: sources.length, truncated: false },
      lifecycleStatus: memory.lifecycleStatus, verificationStatus: memory.verificationStatus,
      sources: sources.map((source) => {
        if (source.projectId && source.projectId !== projectId) throw failure('PROJECT_MISMATCH', 'Source belongs to another project');
        return { id: source.id, sourceType: source.sourceType,
          filePath: source.filePath ?? null, locator: source.locator ?? null, evidenceRole: source.evidenceRole ?? null,
          author: source.author ?? null, sessionId: source.sessionId ?? null, messageId: source.messageId ?? null };
      }),
    };
    refKey(entry);
    return entry;
  }

  function record(entry, kind) {
    const key = refKey(entry);
    let existing = items.get(key);
    if (!existing) {
      existing = { ...entry, retrieved: false, detailReceived: false, referenced: false,
        cited: false, useNotes: [], excludedReason: null };
      items.set(key, existing);
    }
    // Later recall must not replace provenance from the detail actually acquired.
    if (kind === 'detailReceived' || !existing.detailReceived) Object.assign(existing, entry);
    existing[kind] = true;
    return existing;
  }

  async function observe(kind, input, action, capture) {
    const request = { kind, input: structuredClone(input), status: 'pending' };
    requests.push(request);
    pending++;
    try {
      const response = await action();
      capture(response, request);
      request.status = 'success';
      return response;
    } catch (error) {
      request.status = error.name === 'AbortError' ? 'cancelled' : 'failed';
      request.error = { code: error.code ?? null, kind: error.kind ?? error.name,
        status: error.status ?? null, message: error.message };
      throw error;
    } finally { pending--; }
  }

  function known(ref, requireDetail = false) {
    const entry = items.get(refKey(ref));
    if (!entry) throw failure('UNKNOWN_MEMORY_REVISION', 'This Memory/Revision was not returned in this reply session');
    if (requireDetail && !entry.detailReceived) throw failure('DETAIL_REQUIRED', 'Acquire this exact Revision before declaring a reference or citation');
    return entry;
  }

  function declareUse(ref, note, cited) {
    const entry = known(ref, true);
    if (entry.excludedReason) throw failure('CLASSIFICATION_CONFLICT', 'An excluded Memory cannot also be declared used');
    const value = declaration(note);
    entry.referenced = true;
    if (cited) entry.cited = true;
    entry.useNotes.push({ kind: cited ? 'citation' : 'reference', text: value });
  }

  const session = {
    async recall({ queries, limit = 20, neighbors = 0, filters = {}, view = 'full' }, signal) {
      if (!Array.isArray(queries) || queries.length < 1 || queries.length > 5
        || queries.some((query) => typeof query !== 'string' || !query.trim() || query.length > 200)) {
        throw new TypeError('Recall requires 1–5 queries of 1–200 characters');
      }
      if (!['full', 'compact'].includes(view)) throw new TypeError('view must be full or compact');
      const params = new URLSearchParams({ project: projectId, limit: String(limit), neighbors: String(neighbors), view });
      queries.forEach((query) => params.append('q', query));
      const sentFilters = {};
      for (const key of ['type', 'status', 'locked', 'pinned']) {
        if (filters[key] !== undefined && filters[key] !== null) {
          params.set(key, String(filters[key]));
          sentFilters[key] = String(filters[key]);
        }
      }
      return observe('recall', { queries, limit, neighbors, view, filters: sentFilters },
        () => api.recall(params.toString(), signal), (response, request) => {
          if (response.projectId !== projectId || !Array.isArray(response.items)) throw failure('INVALID_USAGE_RESPONSE', 'Invalid recall response');
          const entries = response.items.map((item) => normalize(item.memory, item.sources,
            item.preview, item.sourceCoverage ?? { metadata: 'recall-locators',
              total: item.sources.length, returned: item.sources.length, truncated: false }));
          entries.forEach((entry) => record(entry, 'retrieved'));
          request.coverage = { returned: response.returned, truncated: response.truncated,
            queries: structuredClone(response.queries), filters: structuredClone(response.filters),
            queryMatches: structuredClone(response.queryMatches), expansion: structuredClone(response.expansion) };
        });
    },
    async read(memoryId, expectedRevisionId = null, signal) {
      requireId(memoryId);
      if (expectedRevisionId !== null) requireId(expectedRevisionId);
      return observe('detail', { memoryId, expectedRevisionId }, async () => {
        // The scoped endpoint checks membership before fetching foreign source text.
        // false is permitted: same-project historical/deleted records remain readable.
        const scope = await api.matches(memoryId, new URLSearchParams({ project: projectId }).toString(), signal);
        if (typeof scope.matches !== 'boolean') throw failure('INVALID_USAGE_RESPONSE', 'Project membership could not be checked');
        return api.detail(memoryId, signal);
      }, (response) => {
        const entry = normalize(response.memory, response.sources);
        if (entry.memoryId !== memoryId || response.currentRevision?.id !== entry.revisionId) {
          throw failure('INVALID_USAGE_RESPONSE', 'Wrong Memory detail returned');
        }
        if (expectedRevisionId !== null && expectedRevisionId !== entry.revisionId) {
          throw failure('REVISION_CHANGED', 'Current changed after retrieval. Read and review the new Revision explicitly');
        }
        record(entry, 'detailReceived');
      });
    },
    reference: (ref, purpose) => declareUse(ref, purpose, false),
    cite: (ref, claim) => declareUse(ref, claim, true),
    exclude(ref, reason) {
      const entry = known(ref);
      if (entry.referenced || entry.cited) throw failure('CLASSIFICATION_CONFLICT', 'A declared-use Memory cannot also be excluded');
      entry.excludedReason = declaration(reason);
    },
    report({ revealPaths = false } = {}) {
      if (typeof revealPaths !== 'boolean') throw new TypeError('revealPaths must be a boolean');
      if (pending) throw failure('SESSION_INCOMPLETE', 'Wait for pending requests or cancel them before reporting');
      const entries = [...items.values()].map((entry) => ({ ...structuredClone(entry), sources: publicSources(entry.sources, revealPaths) }));
      return {
        schemaVersion: 1, localSessionId, projectId, provider: 'visual-context-memory',
        observationBasis: 'successful client HTTP returns in this session',
        useBasis: 'caller-declared, not model-internal causality',
        requestBasis: 'logical operations; detail includes scope preflight',
        scope: 'only returned or explicitly acquired records; not the whole database',
        counts: { visible: entries.length, retrieved: entries.filter((entry) => entry.retrieved).length,
          detailReceived: entries.filter((entry) => entry.detailReceived).length,
          referenced: entries.filter((entry) => entry.referenced).length,
          cited: entries.filter((entry) => entry.cited).length, notCited: entries.filter((entry) => !entry.cited).length },
        requests: structuredClone(requests), items: entries,
      };
    },
    render({ limit = 20, revealPaths = false } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new RangeError('Report display limit must be 1–200');
      const report = session.report({ revealPaths });
      const counts = report.counts;
      const lines = ['本次记忆使用说明',
        `项目：${projectId}。检索返回 ${counts.retrieved}；取得详情 ${counts.detailReceived}；明确参考 ${counts.referenced}；明确引用 ${counts.cited}；未明确引用 ${counts.notCited}。`,
        '参考／引用为调用者声明，不是模型内部影响证明；各阶段计数有重叠。'];
      if (!report.requests.length) lines.push('本次未检索或读取项目记忆；这不代表记忆库为空。');
      else if (!counts.visible && report.requests.every((request) => request.status === 'success')) {
        lines.push('本次查询成功返回零条；只针对当前项目、查询和筛选，不代表记忆库为空或不存在相关知识。');
      }
      const problems = report.requests.filter((request) => request.status !== 'success');
      for (const request of report.requests.filter((request) => request.kind === 'recall' && request.status === 'success')) {
        lines.push(`查询：${text(JSON.stringify(request.coverage.queries))}；实际筛选：${text(JSON.stringify(request.coverage.filters))}。`);
      }
      for (const request of problems) lines.push(`请求${request.status === 'cancelled' ? '已取消' : '失败'}：${text(request.error?.code ?? request.error?.kind)} — ${text(request.error?.message)}。未据此判断记忆不存在。`);
      if (report.requests.some((request) => request.coverage?.truncated)) lines.push('检索范围被截断；未返回及被过滤的记忆未逐条审查。');
      const sorted = report.items.sort((a, b) => Number(b.cited) - Number(a.cited) || Number(b.referenced) - Number(a.referenced));
      if (sorted.length) lines.push('');
      for (const entry of sorted.slice(0, limit)) {
        const states = [entry.retrieved && '检索返回', entry.detailReceived && '取得详情', entry.referenced && '明确参考', entry.cited && '明确引用'].filter(Boolean);
        lines.push(`- ${text(entry.name)}｜Memory ${entry.memoryId}｜Revision ${entry.revisionId}（r${entry.revisionNumber}）｜${states.join('、')}｜读取/返回时状态 ${text(entry.lifecycleStatus)}。`);
        if (entry.nameTruncated) lines.push('  检索预览名称已截断；取得详情后才能核对完整名称。');
        if (entry.sourceCoverage.metadata === 'identity-only') {
          lines.push(`  检索仅提供来源标识 ${entry.sourceCoverage.returned}/${entry.sourceCoverage.total}；文件、定位及作者被省略，不代表未记录，需取得详情核实。`);
        }
        lines.push(entry.sources.length
          ? `  来源（数据库记录）：${entry.sources.map(sourceLabel).join('；')}`
          : '  来源：未记录；不能据此声称已核实。');
        for (const note of entry.useNotes) lines.push(`  ${note.kind === 'citation' ? '引用结论' : '参考用途'}（调用者声明）：${text(note.text)}`);
        if (!entry.cited) lines.push(`  未明确引用：${entry.excludedReason ? `调用者说明：${text(entry.excludedReason)}` : entry.referenced ? '声明作为参考，但未明确引用。' : '未声明采用；原因未记录，不能推测。'}`);
      }
      if (sorted.length > limit) lines.push(`另有 ${sorted.length - limit} 条本次可见记忆未展开；本报告不是完整逐条展示。`);
      lines.push('范围仅限本次会话可见记录；未查询整个数据库，无永久使用日志。');
      return lines.join('\n');
    },
  };
  return session;
}
