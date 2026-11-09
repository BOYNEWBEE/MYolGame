// 公网邮箱账号与可撤销会话；邮箱是登录标识，本阶段不声称邮箱所有权已验证。
import type { DatabaseClient } from '../store_supabase.ts';
import { derive, equal, fail, input, json, quota, rows, secret, sha256 } from './core.ts';

export interface CloudUser { id: string; email: string; nickname: string; password_hash: string; salt: string; credential_version: number }
const COOKIE = '__Host-myol_session';
const ttl = 7 * 86400;
const cookie = (token: string, age = ttl) => `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${age}`;
export const profile = (user: CloudUser) => ({ id: user.id, username: user.email, email: user.email, nickname: user.nickname });
export async function currentUser(db: DatabaseClient, req: Request): Promise<CloudUser | null> {
  const token = new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})(?:;|$)`).exec(req.headers.get('cookie') ?? '')?.[1];
  if (!token) return null;
  const session = rows(await db.from('myol_m0_sessions').select('*').eq('id', await sha256(token)).limit(1))[0];
  if (!session || session.revoked || session.expires_at <= Date.now()) return null;
  const user = rows<CloudUser>(await db.from('myol_m0_users').select('*').eq('id', session.user_id).limit(1))[0];
  return user && user.credential_version === session.credential_version ? user : null;
}
export async function accountRoute(db: DatabaseClient, req: Request, path: string, user: CloudUser | null): Promise<Response | null> {
  if (['/api/account', '/api/me'].includes(path)) {
    if (req.method !== 'GET') return fail(405, 'method_not_allowed', '不支持的请求方法');
    if (path === '/api/me' && !user) return fail(401, 'auth_required', '请先登录');
    return json({ enabled: true, kind: 'email', cloudM0: true, account: user ? profile(user) : null });
  }
  const action = /^\/api\/(?:account|auth)\/(register|login|logout|password)$/.exec(path)?.[1];
  if (!action) return null;
  if (req.method !== 'POST') return fail(405, 'method_not_allowed', '不支持的请求方法');
  if (action === 'logout') {
    const value = new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})(?:;|$)`).exec(req.headers.get('cookie') ?? '')?.[1];
    if (value) rows(await db.from('myol_m0_sessions').update({ revoked: true }).eq('id', await sha256(value)).select('id'));
    return json({ ok: true }, 200, { 'set-cookie': cookie('', 0) });
  }
  const body = await input(req);
  if (action === 'password') {
    if (!user) return fail(401, 'auth_required', '请先登录');
    await quota(db, 'password:' + user.id, 10, 900000);
    const password = typeof body.password === 'string' ? body.password : '';
    const replacement = typeof body.newPassword === 'string' ? body.newPassword : '';
    if (password.length > 128 || !equal(await derive(password, user.salt), user.password_hash)) return fail(401, 'invalid_credentials', '当前密码错误');
    if (replacement.length < 8 || replacement.length > 128) return fail(400, 'invalid_password', '新密码长度为 8–128 位');
    const salt = secret();
    const changed = rows(await db.from('myol_m0_users').update({ salt, password_hash: await derive(replacement, salt), credential_version: user.credential_version + 1 })
      .eq('id', user.id).eq('credential_version', user.credential_version).select('id'));
    if (!changed.length) return fail(409, 'write_conflict', '账号状态已变化，请重新登录');
    return json({ ok: true }, 200, { 'set-cookie': cookie('', 0) });
  }
  if (user) return fail(409, 'already_logged_in', '请先退出当前账号');
  const email = typeof (body.email ?? body.username) === 'string' ? String(body.email ?? body.username).trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(400, 'invalid_email', '请输入有效邮箱');
  if (password.length < 8 || password.length > 128) return fail(400, 'invalid_password', '密码长度为 8–128 位');
  // 固定窗口包括成功请求；跨实例共享计数，不因成功登录而清零。
  await quota(db, 'auth:' + await sha256(email), 10, 900000);
  await quota(db, 'auth-global', 300, 900000);
  let account = rows<CloudUser>(await db.from('myol_m0_users').select('*').eq('email', email).limit(1))[0];
  if (action === 'register') {
    if (account) return fail(409, 'account_exists', '该邮箱已注册');
    const salt = secret();
    account = { id: crypto.randomUUID(), email, nickname: typeof body.nickname === 'string' ? body.nickname.trim().slice(0, 20) || '创作者' : '创作者', salt, password_hash: await derive(password, salt), credential_version: 1 };
    // email 的唯一约束处理并发注册，绝不覆盖已存在的密码。
    const inserted = rows(await db.from('myol_m0_users').insertIfAbsent(account, { onConflict: 'email' }).select('id'));
    if (!inserted.length) return fail(409, 'account_exists', '该邮箱已注册');
  } else {
    const calculated = await derive(password, account?.salt ?? 'unknown-user-dummy-salt');
    if (!account || !equal(calculated, account.password_hash)) return fail(401, 'invalid_credentials', '邮箱或密码错误');
  }
  const token = secret();
  // 会话绑定口令版本，改密后并发产生的旧版本会话也无法继续使用。
  rows(await db.from('myol_m0_sessions').insert({ id: await sha256(token), user_id: account.id, credential_version: account.credential_version, expires_at: Date.now() + ttl * 1000, revoked: false }).select('id'));
  return json({ account: profile(account) }, action === 'register' ? 201 : 200, { 'set-cookie': cookie(token) });
}
