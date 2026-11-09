// 本地账号认证：密码使用 scrypt，浏览器仅持有可撤销的随机会话 Cookie。
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { FileStore, type LocalAccount } from './store_file.ts';

const scrypt = promisify(scryptCallback);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const passwordHash = async (password: string, salt: string) => (await scrypt(password, salt, 64) as Buffer).toString('hex');
const cookie = (value: string, age: number) => `myol_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}`;
const info = (a: LocalAccount) => ({ username: a.username, nickname: a.nickname });

export function withLocalAccounts(store: FileStore, next: (req: Request) => Promise<Response>) {
  const attempts = new Map<string, { count: number; until: number }>();
  // 账号变更串行化，防止并发注册同名账号或密码变更后旧登录重新生效。
  let queue = Promise.resolve();
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname.slice(url.pathname.indexOf('/api/') + 4);
    const raw = /(?:^|;\s*)myol_session=([^;]*)/.exec(req.headers.get('cookie') ?? '')?.[1] ?? '';
    const hash = digest(raw);
    const account = store.accountForSession(hash);
    const json = (data: unknown, status = 200, cookies?: string) => new Response(JSON.stringify(data), {
      status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...(cookies ? { 'set-cookie': cookies } : {}) },
    });
    const fail = (message: string, status = 400) => json({ error: { code: 'account_error', message } }, status);
    const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '');
    if (bearer.startsWith('account:')) return fail('无效的认证方式', 401);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.get('origin');
      if ((origin && origin !== url.origin) || req.headers.get('sec-fetch-site') === 'cross-site') return fail('不允许跨站请求', 403);
    }
    if (path === '/account' && req.method === 'GET') return json({ enabled: true, account: account ? info(account) : null });
    if (path.startsWith('/account/')) {
      if (req.method !== 'POST') return fail('不支持的请求方法', 405);
      if (!['/account/register', '/account/login', '/account/logout', '/account/password'].includes(path)) return fail('接口不存在', 404);
      if (path === '/account/logout') {
        await store.revokeAccountSession(hash);
        return json({ ok: true }, 200, cookie('', 0));
      }
      const previous = queue;
      let release!: () => void;
      queue = new Promise<void>(resolve => { release = resolve; });
      await previous;
      try {
        const text = await req.text();
        if (text.length > 4096) return fail('请求体过大', 413);
        let body: Record<string, unknown>;
        try { body = JSON.parse(text); } catch { return fail('请求格式错误'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('请求格式错误');
        const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
        const password = typeof body.password === 'string' ? body.password : '';
        const key = path === '/account/password' ? account?.id ?? 'guest' : username.slice(0, 32);
        for (const [k, v] of attempts) if (v.until < Date.now()) attempts.delete(k);
        const limit = attempts.get(key);
        if (limit && limit.count >= 10) return fail('尝试过于频繁，请在 15 分钟后重试', 429);
        attempts.set(key, { count: (limit?.count ?? 0) + 1, until: limit?.until ?? Date.now() + 900000 });
        if (path === '/account/password') {
          const current = store.accountForSession(hash);
          if (!current) return fail('请先登录', 401);
          if (password.length > 128 || await passwordHash(password, current.salt) !== current.passwordHash) return fail('当前密码错误', 401);
          const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
          if (newPassword.length < 8 || newPassword.length > 128) return fail('新密码长度为 8–128 位');
          const salt = randomBytes(16).toString('hex');
          await store.changeAccountPassword(current, await passwordHash(newPassword, salt), salt);
          attempts.delete(key);
          return json({ ok: true }, 200, cookie('', 0));
        }
        if (account) return fail('请先退出当前账号');
        if (!/^[a-z0-9_]{3,32}$/.test(username)) return fail('用户名须为 3–32 位字母、数字或下划线');
        if (password.length < 8 || password.length > 128) return fail('密码长度为 8–128 位');
        let user = store.findAccount(username);
        if (path === '/account/register') {
          if (user) return fail('该用户名已注册', 409);
          const salt = randomBytes(16).toString('hex');
          const nickname = typeof body.nickname === 'string' ? body.nickname.trim().slice(0, 20) : username;
          user = { id: crypto.randomUUID(), username, nickname: nickname || username, salt, passwordHash: await passwordHash(password, salt), ownerToken: 'account:' + crypto.randomUUID() };
        } else {
          const calculated = await passwordHash(password, user?.salt ?? 'unknown-account');
          if (!user || !timingSafeEqual(Buffer.from(calculated, 'hex'), Buffer.from(user.passwordHash, 'hex'))) return fail('用户名或密码错误', 401);
        }
        const secret = randomBytes(32).toString('hex');
        await store.saveAccount(user, { hash: digest(secret), accountId: user.id, expiresAt: Date.now() + 7 * 86400000 }, bearer);
        attempts.delete(key);
        return json({ account: info(user) }, 200, cookie(secret, 7 * 86400));
      } finally { release(); }
    }
    if (account) {
      const headers = new Headers(req.headers);
      headers.set('authorization', 'Bearer ' + account.ownerToken);
      return next(new Request(req, { headers }));
    }
    return next(req);
  };
}
