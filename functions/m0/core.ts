// M0 公网基础设施：依赖注入仅用于测试，认证和任务状态均以数据库为准。
import type { DatabaseClient } from '../store_supabase.ts';

export class M0Error extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message); this.status = status; this.code = code;
  }
}
export const fail = (status: number, code: string, message: string): never => { throw new M0Error(status, code, message); };
export function rows<T = Record<string, any>>(result: { data: T[] | null; error?: unknown }): T[] {
  if (result.error || !Array.isArray(result.data)) return fail(503, 'database_unavailable', '数据库暂不可用，请稍后查询操作结果');
  return result.data;
}
export const json = (value: unknown, status = 200, extra: Record<string, string> = {}) => Response.json(value, {
  status, headers: { 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer', ...extra },
});
export async function input(req: Request): Promise<Record<string, unknown>> {
  if (req.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return fail(415, 'invalid_input', '请使用 JSON 请求');
  const reader = req.body?.getReader();
  if (!reader) return fail(400, 'invalid_input', '请求不能为空');
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.length;
      if (length > 8192) { await reader.cancel(); return fail(413, 'payload_too_large', '请求体过大'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(400, 'invalid_input', '请求必须为对象');
    return value as Record<string, unknown>;
  } catch (error) { if (error instanceof M0Error) throw error; return fail(400, 'invalid_input', '请求格式错误'); }
}
export function publicOrigin(origin: string): string {
  try { const u = new URL(origin); if (u.protocol === 'https:' && u.origin === origin) return origin; } catch { /* 配置错误按失败关闭。 */ }
  return fail(503, 'origin_not_configured', '请先配置站点的固定 HTTPS 来源');
}
export function trustedWrite(req: Request, origin: string): void {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.get('origin') !== origin) fail(403, 'origin_forbidden', '请求来源不允许');
}
export function pathOf(req: Request): string {
  const path = new URL(req.url).pathname;
  const matched = path.match(/^\/(?:functions\/v1\/)?(?:app|app-d[0-9a-f]{32})(\/api(?:\/.*)?)$/);
  if (!matched) return fail(404, 'not_found', '接口不存在');
  return matched[1]!;
}
export function equal(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0; for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}
export const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
export const secret = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export const sha256 = async (value: string) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
export async function derive(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 600000, hash: 'SHA-256' }, key, 256)));
}
// 原子计数持久化；只有确认未写入的 CAS 冲突才重读，网络错误不重放。
export async function quota(db: DatabaseClient, key: string, max: number, windowMs: number): Promise<void> {
  const now = Date.now();
  for (let i = 0; i < 24; i++) {
    const current = rows(await db.from('myol_m0_limits').select('*').eq('id', key).limit(1))[0];
    if (!current) {
      if (rows(await db.from('myol_m0_limits').insertIfAbsent({ id: key, count: 1, started_at: now }, { onConflict: 'id' }).select('id')).length) return;
      continue;
    }
    const expired = now - current.started_at >= windowMs;
    if (!expired && current.count >= max) return fail(429, 'rate_limited', '操作过于频繁，请稍后重试');
    const changed = rows(await db.from('myol_m0_limits').update({ count: expired ? 1 : current.count + 1, started_at: expired ? now : current.started_at })
      .eq('id', key).eq('count', current.count).eq('started_at', current.started_at).select('id'));
    if (changed.length) return;
  }
  fail(503, 'limiter_busy', '服务繁忙，请稍后重试');
}
