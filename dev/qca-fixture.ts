// 仅供本地实验和测试的受控 Cloud Agents 替身；不进入函数包，不调用真实模型。
import type { CloudClient } from '../functions/qca/client.ts';
export const candidate = '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>受控候选</title></head><body><canvas width="320" height="180"></canvas><script>const ctx=document.querySelector("canvas").getContext("2d");ctx.fillStyle="#818cf8";ctx.fillRect(20,20,80,60);</script></body></html>';
export class QcaFixture implements CloudClient {
  calls: { path: string; method: string; body?: any }[] = [];
  resources: Record<string, any[]> = { agents: [], environments: [], sessions: [] };
  events = new Map<string, any[]>();
  failAfter = '';
  autoComplete = false;
  models: { id: string; is_enabled?: boolean; display_name?: string }[] = [{ id: 'fixture-model', is_enabled: true }];
  completeAll() {
    for (const s of this.resources.sessions) {
      s.status = 'idle';
      this.events.set(s.id, [{ id: 'evt_result_' + s.id, type: 'agent.message', content: [{ type: 'text', text: candidate }] }]);
    }
  }
  async request(path: string, options: { method?: string; body?: any; idempotencyKey?: string } = {}) {
    const method = options.method ?? 'GET';
    this.calls.push({ path, method, body: structuredClone(options.body) });
    const url = new URL(path, 'https://fixture.invalid');
    const suffix = url.pathname.slice('/api/v1/cloud/'.length).split('/');
    const kind = suffix[0]!, id = suffix[1], action = suffix[2];
    if (method === 'GET' && kind === 'models') return { data: structuredClone(this.models), has_more: false };
    if (method === 'POST' && !id) {
      const resource = { ...structuredClone(options.body), id: (kind === 'agents' ? 'agent_' : kind === 'environments' ? 'env_' : 'sess_') + crypto.randomUUID().replaceAll('-', ''), version: 1, status: 'idle' };
      this.resources[kind]!.push(resource);
      if (this.failAfter === kind) { this.failAfter = ''; throw new Error('合成响应丢失'); }
      return structuredClone(resource);
    }
    if (method === 'POST' && kind === 'sessions' && action === 'events') {
      const session = this.resources.sessions.find(s => s.id === id);
      if (!session) throw new Error('合成资源不存在');
      session.status = 'running';
      if (this.failAfter === 'dispatch') { this.failAfter = ''; throw new Error('合成派发结果丢失'); }
      if (this.autoComplete) this.completeAll();
      return { data: [{ id: 'evt_request_' + id, type: 'user.message' }] };
    }
    if (method === 'POST' && kind === 'sessions' && action === 'cancel') {
      this.resources.sessions.find(s => s.id === id).status = 'idle';
      return { ok: true };
    }
    if (method === 'GET' && kind === 'sessions' && action === 'events') return { data: structuredClone(this.events.get(id!) ?? []), has_more: false, next_page: null };
    if (method === 'GET' && id) return structuredClone(this.resources[kind]!.find(r => r.id === id));
    if (method === 'GET' && this.resources[kind]) return { data: structuredClone(this.resources[kind]), has_more: false, next_page: null };
    throw new Error('未实现的受控请求');
  }
}
