// 来自 Qoder 随附的 Managed API 传输适配器；不向浏览器开放通用代理。
export class CloudAgentsError extends Error {
  constructor(code, status = 503, outcome = 'unknown') {
    super(code);
    this.name = 'CloudAgentsError';
    this.code = code;
    this.status = status;
    this.outcome = outcome;
  }
}
const fail = (code, status, outcome) => new CloudAgentsError(code, status, outcome);
const cancelBody = response => { void response.body?.cancel().catch(() => {}); };


export function createCloudAgentsClient({
  origin,
  getToken = () => globalThis.Deno?.env.get('QODER_PAT'),
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
  maxResponseBytes = 2 * 1024 * 1024,
  diagnostics = event => console.error(JSON.stringify(event)),
} = {}) {
  let base;
  try { base = new URL(origin); } catch { throw fail('ai_configuration_invalid', 503, 'not_sent'); }
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000
    || !Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 4 * 1024 * 1024) {
    throw fail('ai_configuration_invalid', 503, 'not_sent');
  }

  
  async function request(path, { method = 'GET', body, idempotencyKey } = {}) {
    const pathname = typeof path === 'string' ? path.split('?')[0] : '';
    if (!/^\/api\/v1\/cloud\/(agents|environments|sessions|models)(\/[A-Za-z0-9_-]+)*$/.test(pathname)
      || /[#\\\r\n]/.test(path) || !['GET', 'POST'].includes(method)) {
      throw fail('ai_request_invalid', 400, 'not_sent');
    }
    const url = new URL(path, base);
    if (url.origin !== base.origin) throw fail('ai_request_invalid', 400, 'not_sent');
    let token;
    try { token = getToken(); } catch { throw fail('ai_not_configured', 503, 'not_sent'); }
    if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token)) throw fail('ai_not_configured', 503, 'not_sent');
    let encoded;
    try { encoded = body === undefined ? undefined : JSON.stringify(body); } catch { throw fail('ai_request_invalid', 400, 'not_sent'); }
    if (encoded && new TextEncoder().encode(encoded).length > 1024 * 1024) throw fail('ai_request_too_large', 413, 'not_sent');
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    if (encoded !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotencyKey !== undefined) {
      if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{1,200}$/.test(idempotencyKey)) throw fail('ai_request_invalid', 400, 'not_sent');
      headers['Idempotency-Key'] = idempotencyKey;
    }
    const diagnosticId = crypto.randomUUID();
    const startedAt = performance.now();
    let upstreamStatus;
    let upstreamRequestId;
    let phase = 'await_headers';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url.href, { method, headers, body: encoded, redirect: 'manual', signal: controller.signal });
      upstreamStatus = response.status;
      const requestId = response.headers.get('x-request-id');
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId ?? '')) upstreamRequestId = requestId;
      phase = 'response';
      if (!response.ok) {
        cancelBody(response);
        const status = response.status;
        const code = status === 401 || status === 403 ? 'ai_access_denied'
          : status === 404 ? 'ai_resource_not_found' : status === 409 ? 'ai_conflict'
          : status === 429 ? 'ai_rate_limited' : status >= 400 && status < 500 ? 'ai_request_rejected' : 'ai_service_unavailable';
        throw fail(code, [400, 401, 403, 404, 409, 429].includes(status) ? status : 503,
          status >= 400 && status < 500 && status !== 408 ? 'rejected' : 'unknown');
      }
      if (response.status === 204) return null;
      if (!response.headers.get('content-type')?.toLowerCase().includes('application/json') || !response.body) {
        cancelBody(response);
        throw fail('ai_response_invalid');
      }
      phase = 'read_body';
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let length = 0, text = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > maxResponseBytes) {
            void reader.cancel().catch(() => {});
            throw fail('ai_response_invalid');
          }
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
      } finally { reader.releaseLock(); }
      phase = 'parse_body';
      try { return JSON.parse(text); } catch { throw fail('ai_response_invalid'); }
    } catch (error) {
      const failure = error instanceof CloudAgentsError ? error
        : fail(method === 'POST' ? 'ai_request_unknown' : 'ai_service_unavailable');
      failure.diagnosticId = diagnosticId;
      const category = controller.signal.aborted ? 'timeout'
        : upstreamStatus !== undefined && (upstreamStatus < 200 || upstreamStatus >= 300) ? 'upstream_http'
        : error instanceof CloudAgentsError ? 'invalid_response' : transportCategory(error);
      try {
        diagnostics({ event: 'sites_cloud_request_failed', diagnosticId,
          resource: pathname.split('/')[4], method, phase, category,
          durationMs: Math.round(performance.now() - startedAt),
          ...(upstreamStatus !== undefined ? { upstreamStatus } : {}),
          ...(upstreamRequestId ? { upstreamRequestId } : {}),
          errorCode: failure.code, outcome: failure.outcome });
      } catch { /* 诊断不能改变请求或恢复行为。 */ }
      throw failure;
    } finally { clearTimeout(timer); }
  }

  async function findResources(kind, metadata, maxPages = 20) {
    if (!['agents', 'environments'].includes(kind) || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) {
      throw fail('ai_configuration_invalid', 503, 'not_sent');
    }
    const found = [], cursors = new Set();
    let page;
    for (let index = 0; index < maxPages; index++) {
      const result = await request(`/api/v1/cloud/${kind}?limit=100${page ? `&page=${encodeURIComponent(page)}` : ''}`);
      if (!Array.isArray(result?.data) || typeof result.has_more !== 'boolean') throw fail('ai_response_invalid');
      for (const resource of result.data) {
        if (!resource || typeof resource !== 'object' || typeof resource.id !== 'string') throw fail('ai_response_invalid');
        if (!resource.archived_at && Object.entries(metadata).every(([key, value]) => resource.metadata?.[key] === value)) found.push(resource);
      }
      if (!result.has_more) return [...new Map(found.map(resource => [resource.id, resource])).values()];
      if (typeof result.next_page !== 'string' || !result.next_page || cursors.has(result.next_page)) throw fail('ai_response_invalid');
      cursors.add(result.next_page);
      page = result.next_page;
    }
    throw fail('ai_initialization_pending', 202);
  }
  
  async function openStream(sessionId, { lastEventId, signal } = {}) {
    if (!/^sess_[A-Za-z0-9_-]+$/.test(sessionId)
      || (lastEventId && !/^evt_[A-Za-z0-9_-]{1,200}$/.test(lastEventId))) throw fail('ai_request_invalid', 400, 'not_sent');
    let token;
    try { token = getToken(); } catch { throw fail('ai_not_configured', 503, 'not_sent'); }
    if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token)) throw fail('ai_not_configured', 503, 'not_sent');
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    try {
      const headers = { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' };
      if (lastEventId) headers['Last-Event-ID'] = lastEventId;
      const response = await fetchImpl(new URL(`/api/v1/cloud/sessions/${sessionId}/events/stream?event_deltas%5B%5D=agent.message`, base), {
        headers, redirect: 'manual', signal: controller.signal,
      });
      if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
        cancelBody(response);
        throw fail(response.status === 401 || response.status === 403 ? 'ai_access_denied'
          : response.status === 429 ? 'ai_rate_limited' : 'ai_service_unavailable');
      }
      return { body: response.body, close: () => { abort(); signal?.removeEventListener('abort', abort); } };
    } catch (error) {
      signal?.removeEventListener('abort', abort);
      throw error instanceof CloudAgentsError ? error : fail('ai_service_unavailable');
    } finally { clearTimeout(timer); }
  }
  return Object.freeze({ request, findResources, openStream });
}
