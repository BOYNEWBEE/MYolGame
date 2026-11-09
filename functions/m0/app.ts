// Qoder 云端 M0 入口适配：公网写入须登录且来自固定来源，后台消费单独鉴权。
import type { Session } from '../store.ts';
import type { DatabaseClient } from '../store_supabase.ts';
import { accountRoute, currentUser } from './auth.ts';
import { equal, fail, json, M0Error, pathOf, publicOrigin, trustedWrite } from './core.ts';
import { taskRoute, tick } from './tasks.ts';

export interface M0Options { db: DatabaseClient; origin: () => string; workerKey: () => string; business?: (req: Request, principal?: Session) => Promise<Response> }
export function createM0Application(options: M0Options) {
  return async (req: Request): Promise<Response> => {
    try {
      const path = pathOf(req);
      if (path === '/api/health' && req.method === 'GET') return json({ ok: true, milestone: 'M0', simulated: true, revision: 'm0-cloud-v1' });
      if (path === '/api/m0/worker') {
        if (req.method !== 'POST') return fail(405, 'method_not_allowed', '不支持的请求方法');
        const key = options.workerKey();
        if (key.length < 32) return fail(503, 'worker_not_configured', '后台任务消费尚未配置');
        if (!equal(req.headers.get('authorization') ?? '', 'Bearer ' + key)) return fail(401, 'worker_unauthorized', '后台认证失败');
        return json({ processed: await tick(options.db), simulated: true });
      }
      const origin = publicOrigin(options.origin());
      trustedWrite(req, origin);
      const user = await currentUser(options.db, req);
      const auth = await accountRoute(options.db, req, path, user);
      if (auth) return auth;
      if (path === '/api/meta' && req.method === 'GET' && options.business) {
        const response = await options.business(req);
        const meta = await response.json();
        return json({ ...meta, milestone: 'M0', simulated: true, taskEvents: true, identityNotice: '公网 M0 使用邮箱账号；任务为基础设施模拟，不调用 AI、不生成游戏。' });
      }
      if (path.startsWith('/api/m0/')) {
        if (!user) return fail(401, 'auth_required', '请先登录邮箱账号');
        const response = await taskRoute(options.db, req, path, user);
        return response ?? fail(404, 'not_found', '接口不存在');
      }
      // M0 验收只开放模拟任务，防止把模板路径伪装成已部署的真实开发服务。
      if (path === '/api/session') return fail(401, 'auth_required', '公网版本请使用邮箱账号登录');
      if (req.method !== 'GET' && req.method !== 'HEAD') return fail(409, 'm0_simulation_only', '当前为 M0，请到云端任务页验证模拟执行；游戏开发属于 M1');
      if (!options.business) return fail(404, 'not_found', '接口不存在');
      const headers = new Headers(req.headers);
      headers.delete('authorization');
      if (user) {
        const owner = 'm0-user:' + user.id;
        headers.set('authorization', 'Bearer ' + owner);
      }
      return options.business(new Request(req, { headers }), user ? { token: 'm0-user:' + user.id, nickname: user.nickname, official: false, createdAt: '' } : undefined);
    } catch (error) {
      if (error instanceof M0Error) return json({ error: { code: error.code, message: error.message } }, error.status);
      // 不把上游错误、连接信息或凭据写入响应和日志；未知写入结果由查询恢复。
      return json({ error: { code: 'service_unavailable', message: '服务暂不可用，请稍后查询操作结果' } }, 503);
    }
  };
}
