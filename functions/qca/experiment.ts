// 分支实验：每任务独立 Agent／Environment／Session；永久创建意图防止超时后重复执行。
import type { DatabaseClient } from '../store_supabase.ts';
import type { CloudUser } from '../m0/auth.ts';
import { fail, input, json, quota, rows, sha256 } from '../m0/core.ts';
import { QCA_SCOPE } from './config.ts';
import type { CloudClient } from './client.ts';

export interface QcaJob {
  id: string; owner_id: string; prompt: string; model: string; state: string; revision: number;
  agent_id: string; agent_version: number; environment_id: string; session_id: string;
  execution: 'cloud' | 'fixture'; accepted_events: string[]; output: string; created_at: string;
}
interface Options { db: DatabaseClient; cloud: CloudClient; model: () => string; ready: () => boolean; fixture?: boolean }
const SCOPE = QCA_SCOPE;
const initial = 'new';
const plan: Record<string, { pending: string; ready: string; resource: string }> = {
  new: { pending: 'creating_agent', ready: 'agent_ready', resource: 'agents' },
  agent_ready: { pending: 'creating_environment', ready: 'environment_ready', resource: 'environments' },
  environment_ready: { pending: 'creating_session', ready: 'session_ready', resource: 'sessions' },
  session_ready: { pending: 'dispatching', ready: 'submitted', resource: '' },
};
export const jobView = (job: QcaJob) => ({ id: job.id, prompt: job.prompt, state: job.state, revision: job.revision, model: job.model, output: job.output, createdAt: job.created_at, experimental: true, execution: job.execution });
const metadata = (job: QcaJob, role: string) => ({ app_scope: SCOPE, app_job: job.id, app_role: role });
const stableStates = new Set([...Object.keys(plan), 'submitted', 'completed', 'failed', 'cancelled']);

export function createQcaExperiment(options: Options) {
  const { db, cloud } = options;
  async function catalog() {
    if (!options.ready()) return fail(503, 'qca_not_configured', 'Cloud Agents 凭据尚未配置');
    const result = await cloud.request('/api/v1/cloud/models');
    if (!Array.isArray(result?.data) || result.has_more === true) return fail(503, 'qca_model_catalog_invalid', '模型目录格式与已核对的接口契约不符，未自动放行任何模型');
    // 私有目录快照仅供核对接口差异，不作为权限或模型校验缓存，且不写入日志。
    const snapshot = { id: SCOPE, models: result.data, observed_at: new Date().toISOString() };
    const inserted = rows(await db.from('myol_qca_model_catalog').insertIfAbsent(snapshot, { onConflict: 'id' }).select('id'));
    if (!inserted.length) rows(await db.from('myol_qca_model_catalog').update(snapshot).eq('id', SCOPE).select('id'));
    return result.data.filter((m: any) => typeof m?.id === 'string' && m.id.length <= 200).map((m: any) => ({
      id: m.id as string, name: typeof m.display_name === 'string' ? m.display_name : m.id as string,
      enabled: m.is_enabled === true, availability: typeof m.is_enabled === 'boolean' ? (m.is_enabled ? 'enabled' : 'disabled') : 'unknown',
    }));
  }
  async function requireModel(id: string, owner: string) {
    await quota(db, 'qca-model-check:' + owner, 60, 3600000);
    const models = await catalog();
    if (!models.some((m: any) => m.id === id && m.enabled)) return fail(503, 'qca_model_unavailable', '当前模型未通过启用校验，请读取模型目录并明确选择已启用模型，再继续原任务');
  }
  async function owned(id: string, owner: string): Promise<QcaJob> {
    const job = rows<QcaJob>(await db.from('myol_qca_jobs').select('*').eq('id', id).eq('owner_id', owner).limit(1))[0];
    if (!job) return fail(404, 'job_not_found', '实验任务不存在或无权访问');
    return job;
  }
  async function change(job: QcaJob, patch: Partial<QcaJob>): Promise<QcaJob | null> {
    const changed = rows<QcaJob>(await db.from('myol_qca_jobs').update({ ...patch, revision: job.revision + 1 })
      .eq('id', job.id).eq('owner_id', job.owner_id).eq('revision', job.revision).eq('state', job.state).select('*'));
    return changed[0] ?? null;
  }
  function body(job: QcaJob, resource: string): Record<string, unknown> {
    const meta = metadata(job, resource);
    if (resource === 'agents') return { name: 'MYolGame HTML experiment', model: job.model, tools: [], system: '你是网页游戏原型开发助手。只返回一个不依赖网络资源的完整 HTML 文档，包含内联 CSS 和脚本，不使用代码块，不解释。不得索要或输出密钥。此实验只验证源码生成，不宣称构建或玩法检查通过。', metadata: meta };
    if (resource === 'environments') return { name: 'MYolGame isolated experiment', config: { type: 'cloud' }, metadata: meta };
    return { agent: { id: job.agent_id, type: 'agent', version: job.agent_version }, environment_id: job.environment_id,
      title: 'MYolGame experimental task', metadata: meta, budget: { type: 'limit', max_credit_cost: '10.00' } };
  }
  function binding(resource: string, result: any): Partial<QcaJob> {
    const prefix = resource === 'agents' ? 'agent_' : resource === 'environments' ? 'env_' : 'sess_';
    if (!result || typeof result.id !== 'string' || !new RegExp('^' + prefix + '[A-Za-z0-9_-]+$').test(result.id)) return fail(503, 'qca_invalid_response', '云端响应无法确认，创建意图已保留');
    if (resource === 'agents') {
      if (!Number.isInteger(result.version) || result.version < 1) return fail(503, 'qca_invalid_response', 'Agent 版本无法确认');
      return { agent_id: result.id, agent_version: result.version };
    }
    return resource === 'environments' ? { environment_id: result.id } : { session_id: result.id };
  }
  async function find(job: QcaJob, resource: string): Promise<any | null> {
    const found: any[] = []; let page = ''; const cursors = new Set<string>();
    for (let n = 0; n < 10; n++) {
      const result = await cloud.request(`/api/v1/cloud/${resource}?limit=100${page ? '&page=' + encodeURIComponent(page) : ''}`);
      if (!Array.isArray(result?.data) || typeof result.has_more !== 'boolean') return fail(503, 'qca_invalid_response', '无法核对云端资源');
      for (const candidate of result.data) {
        if (!candidate.archived_at && Object.entries(metadata(job, resource)).every(([k, v]) => candidate.metadata?.[k] === v)) found.push(candidate);
      }
      if (!result.has_more) {
        const matches = [...new Map(found.map(r => [r.id, r])).values()];
        if (matches.length > 1) return fail(409, 'qca_ambiguous', '发现重复资源，需要人工核对；不会自动选择或删除');
        return matches[0] ?? null;
      }
      if (typeof result.next_page !== 'string' || !result.next_page || cursors.has(result.next_page)) break;
      page = result.next_page; cursors.add(page);
    }
    return fail(503, 'qca_scan_incomplete', '资源查询尚不完整，不能确认创建结果');
  }
  async function collect(job: QcaJob): Promise<QcaJob> {
    let page = ''; const seen = new Set<string>(); const messages = new Map<string, string>();
    // 完整有界扫描，只收集最终消息；工具输出、内部思考和原始事件不会发给浏览器。
    for (let n = 0; n < 10; n++) {
      const result = await cloud.request(`/api/v1/cloud/sessions/${job.session_id}/events?order=asc&limit=100&types=agent.message${page ? '&page=' + encodeURIComponent(page) : ''}`);
      if (!Array.isArray(result?.data) || typeof result.has_more !== 'boolean') return fail(503, 'qca_invalid_response', '云端事件读取失败');
      for (const e of result.data) {
        if (e.type === 'agent.message' && typeof e.id === 'string' && Array.isArray(e.content)) {
          const text = e.content.filter((c: any) => c.type === 'text' && typeof c.text === 'string').map((c: any) => c.text).join('');
          messages.set(e.id, text);
        }
      }
      if (!result.has_more) {
        const output = [...messages.values()].join('\n');
        if (new TextEncoder().encode(output).length > 512 * 1024) return fail(413, 'qca_output_too_large', '结果超过实验保存上限');
        const remote = await cloud.request('/api/v1/cloud/sessions/' + job.session_id);
        // idle 且存在最终消息才视为完成，不能把已受理或暂时无事件标为成功。
        const state = remote.status === 'idle' && output ? 'completed' : remote.status === 'idle' && job.state === 'cancel_requested' ? 'cancelled' : ['failed', 'cancelled', 'archived'].includes(remote.status) ? 'failed' : job.state;
        return await change(job, { output, state }) ?? await owned(job.id, job.owner_id);
      }
      if (typeof result.next_page !== 'string' || !result.next_page || seen.has(result.next_page)) break;
      page = result.next_page; seen.add(page);
    }
    return fail(503, 'qca_scan_incomplete', '事件尚未读完，未覆盖已保存结果');
  }
  return async (req: Request, path: string, user: CloudUser | null): Promise<Response | null> => {
    if (!path.startsWith('/api/qca/')) return null;
    if (!user) return fail(401, 'auth_required', '请先登录实验账号');
    if (path === '/api/qca/config' && req.method === 'GET') return json({ enabled: true, configured: Boolean(options.model()) && options.ready(), experimental: true, execution: options.fixture ? 'fixture' : 'cloud' });
    if (path === '/api/qca/models' && req.method === 'POST') {
      await quota(db, 'qca-models:' + user.id, 60, 3600000);
      return json({ models: await catalog(), configuredModel: options.model() });
    }
    const match = /^\/api\/qca\/jobs(?:\/([a-f0-9]{64})(?:\/(advance|refresh|reconcile|cancel|model))?)?$/.exec(path);
    if (!match) return fail(404, 'not_found', '实验接口不存在');
    const id = match[1], action = match[2];
    if (req.method === 'GET') {
      if (action) return fail(405, 'method_not_allowed', '操作需要 POST 请求');
      if (id) return json({ job: jobView(await owned(id, user.id)) });
      return json({ items: rows<QcaJob>(await db.from('myol_qca_jobs').select('*').eq('owner_id', user.id).order('created_at', { ascending: false }).limit(30)).map(jobView) });
    }
    if (req.method !== 'POST') return fail(405, 'method_not_allowed', '不支持的请求方法');
    if (!options.model() || !options.ready()) return fail(503, 'qca_not_configured', '实验尚未配置 Cloud Agents；不会回退为模拟成功');
    if (!id) {
      const value = await input(req);
      const prompt = typeof value.prompt === 'string' ? value.prompt.trim() : '';
      const selectedModel = typeof value.model === 'string' ? value.model : options.model();
      const key = req.headers.get('idempotency-key') ?? '';
      if (!prompt || prompt.length > 2000 || !/^[a-f0-9-]{36}$/i.test(key)) return fail(400, 'invalid_input', '需求须为 1–2000 字并提供 UUID 提交标识');
      const jobId = await sha256(SCOPE + ':' + user.id + ':' + key);
      const existing = rows<QcaJob>(await db.from('myol_qca_jobs').select('*').eq('id', jobId).eq('owner_id', user.id).limit(1))[0];
      if (existing) {
        if (existing.prompt !== prompt || existing.model !== selectedModel) return fail(409, 'idempotency_conflict', '提交标识已用于另一需求');
        return json({ job: jobView(existing) });
      }
      await requireModel(selectedModel, user.id);
      await quota(db, 'qca:' + user.id, 3, 86400000);
      const job: QcaJob = { id: jobId, owner_id: user.id, prompt, model: selectedModel, state: initial, revision: 1,
        execution: options.fixture ? 'fixture' : 'cloud', agent_id: '', agent_version: 0, environment_id: '', session_id: '', accepted_events: [], output: '', created_at: new Date().toISOString() };
      const inserted = rows(await db.from('myol_qca_jobs').insertIfAbsent(job, { onConflict: 'id' }).select('id'));
      const saved = inserted.length ? job : await owned(jobId, user.id);
      if (saved.prompt !== prompt || saved.model !== selectedModel) return fail(409, 'idempotency_conflict', '提交标识冲突');
      return json({ job: jobView(saved) }, inserted.length ? 201 : 200);
    }
    let job = await owned(id, user.id);
    if (action === 'model') {
      const value = await input(req);
      if (job.state !== 'new' || job.agent_id || job.environment_id || job.session_id) return fail(409, 'qca_model_pinned', '资源创建后不能切换模型，请继续核对原任务');
      if (value.revision !== job.revision || typeof value.model !== 'string') return fail(409, 'write_conflict', '任务状态已变化，请刷新后重试');
      await requireModel(value.model, user.id);
      const updated = await change(job, { model: value.model });
      if (!updated) return fail(409, 'write_conflict', '任务已被其他请求更新');
      return json({ job: jobView(updated) });
    }
    if (action === 'refresh') {
      if (['submitted', 'cancel_requested'].includes(job.state)) job = await collect(job);
      return json({ job: jobView(job) });
    }
    if (action === 'cancel') {
      if (['completed', 'failed', 'cancelled', 'cancel_requested'].includes(job.state)) return json({ job: jobView(job) });
      if (job.state === 'submitted') {
        const claim = await change(job, { state: 'cancelling' });
        if (!claim) return json({ job: jobView(await owned(id, user.id)) });
        try {
          await cloud.request(`/api/v1/cloud/sessions/${job.session_id}/cancel`, { method: 'POST', body: {} });
          return json({ job: jobView(await change(claim, { state: 'cancel_requested' }) ?? await owned(id, user.id)) }, 202);
        } catch { return json({ job: jobView(await owned(id, user.id)), pending: true }, 202); }
      }
      if (!plan[job.state]) return fail(409, 'qca_pending', '创建或派发结果尚未确认，请先核对');
      return json({ job: jobView(await change(job, { state: 'cancelled' }) ?? await owned(id, user.id)) });
    }
    if (action === 'reconcile') {
      if (job.state === 'cancelling') {
        const remote = await cloud.request('/api/v1/cloud/sessions/' + job.session_id);
        if (remote.status === 'idle') job = await change(job, { state: 'cancelled' }) ?? await owned(id, user.id);
      }
      const step = Object.values(plan).find(s => s.pending === job.state);
      if (step?.resource) {
        const resource = await find(job, step.resource);
        if (resource) job = await change(job, { ...binding(step.resource, resource), state: step.ready }) ?? await owned(id, user.id);
      }
      // 派发结果未知时没有可靠关联字段证明未发送：不按文本猜测，也不自动重发。
      return json({ job: jobView(job), pending: !stableStates.has(job.state) });
    }
    if (action !== 'advance') return fail(405, 'method_not_allowed', '请选择实验操作');
    const value = await input(req);
    const step = plan[job.state];
    if (value.revision !== job.revision) return json({ job: jobView(job), changed: false });
    if (!step) return json({ job: jobView(job), changed: false });
    if (job.state === 'new') await requireModel(job.model, user.id);
    await quota(db, 'qca-advance:' + user.id, 30, 3600000);
    const claim = await change(job, { state: step.pending });
    if (!claim) return json({ job: jobView(await owned(id, user.id)), changed: false });
    job = claim;
    // 不使用会过期后重入的进程锁。只有赢得持久化 CAS 的调用能发起此次副作用。
    try {
      let patch: Partial<QcaJob>;
      if (step.resource) {
        const result = await cloud.request('/api/v1/cloud/' + step.resource, { method: 'POST', body: body(job, step.resource),
          ...(step.resource === 'agents' ? { idempotencyKey: job.id + ':agent' } : {}) });
        patch = { ...binding(step.resource, result), state: step.ready };
      } else {
        const result = await cloud.request(`/api/v1/cloud/sessions/${job.session_id}/events`, { method: 'POST', body: { events: [{ type: 'user.message', content: [{ type: 'text', text: job.prompt }] }] } });
        if (!Array.isArray(result?.data) || !result.data.length || !result.data.every((e: any) => typeof e.id === 'string' && e.id.startsWith('evt_'))) return fail(503, 'qca_invalid_response', '需求受理结果无法确认，不会重复派发');
        patch = { accepted_events: result.data.map((e: any) => e.id), state: step.ready };
      }
      job = await change(job, patch) ?? await owned(id, user.id);
      return json({ job: jobView(job) }, 202);
    } catch {
      // 包括确定拒绝也不自动重试；保留创建意图，交给显式核对操作。
      return json({ job: jobView(await owned(id, user.id)), error: { code: 'qca_outcome_unconfirmed', message: '云端操作结果未确认，请核对原任务；不会自动重发' } }, 202);
    }
  };
}
