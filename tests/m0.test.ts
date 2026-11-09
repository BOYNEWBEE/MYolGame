// 测试真实云端应用模块；SDK 契约替身不代表远端数据库隔离已验收。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createM0Application } from '../functions/m0/app.ts';
import { quota } from '../functions/m0/core.ts';
import { M0TestDatabase } from './helpers/m0-db.ts';
const origin = 'https://myol.example';
const workerKey = 'synthetic-worker-key-for-tests-only-12345';
function setup(db = new M0TestDatabase()) {
  let app = createM0Application({ db, origin: () => origin, workerKey: () => workerKey });
  const request = (path: string, options: { body?: unknown; cookie?: string; key?: string; method?: string; source?: string; cursor?: string; worker?: string } = {}) => app(new Request(origin + '/functions/v1/app/api' + path, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers: { 'content-type': 'application/json', origin: options.source ?? origin,
      ...(options.cookie ? { cookie: options.cookie } : {}), ...(options.key ? { 'idempotency-key': options.key } : {}),
      ...(options.cursor ? { 'last-event-id': options.cursor } : {}), ...(options.worker ? { authorization: 'Bearer ' + options.worker } : {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }));
  const register = async (email: string) => {
    const response = await request('/auth/register', { body: { email, password: 'synthetic-password' } });
    assert.equal(response.status, 201);
    assert.match(response.headers.get('set-cookie')!, /Secure; HttpOnly; SameSite=Strict/);
    return response.headers.get('set-cookie')!.split(';')[0]!;
  };
  return { db, request, register, restart: () => { app = createM0Application({ db, origin: () => origin, workerKey: () => workerKey }); } };
}

test('M0 邮箱认证、重启、CSRF、改密撤销和双账号隔离', async () => {
  const ctx = setup(); const a = await ctx.register('Alice@Example.com'); const b = await ctx.register('bob@example.com');
  ctx.restart();
  assert.equal((await (await ctx.request('/me', { cookie: a })).json()).account.email, 'alice@example.com');
  assert.equal((await ctx.request('/account/login', { body: { email: 'alice@example.com', password: 'synthetic-password' }, source: 'https://evil.example' })).status, 403);
  assert.equal((await ctx.request('/account/login', { body: { email: 'alice@example.com', password: 'wrong-password' } })).status, 401);
  assert.equal((await ctx.request('/auth/register', { body: { email: 'alice@example.com', password: 'synthetic-password' } })).status, 409);
  const created = await ctx.request('/m0/tasks', { cookie: a, body: { prompt: '增加第二关' }, key: crypto.randomUUID() });
  assert.equal(created.status, 202);
  const task = (await created.json()).task;
  assert.equal((await ctx.request('/m0/tasks/' + task.id, { cookie: b })).status, 404);
  assert.equal((await ctx.request('/m0/tasks/' + task.id + '/events', { cookie: b })).status, 404);
  assert.equal((await ctx.request('/m0/tasks/' + task.id + '/cancel', { cookie: b, body: {} })).status, 404);
  assert.equal((await ctx.request('/m0/tasks')).status, 401);
  const login = await ctx.request('/auth/login', { body: { email: 'alice@example.com', password: 'synthetic-password' } });
  const second = login.headers.get('set-cookie')!.split(';')[0]!;
  assert.equal((await ctx.request('/account/password', { cookie: a, body: { password: 'synthetic-password', newPassword: 'replacement-password' } })).status, 200);
  assert.equal((await ctx.request('/me', { cookie: second })).status, 401);
  assert.equal((await ctx.request('/me', { cookie: a })).status, 401);
  const updated = await ctx.request('/account/login', { body: { email: 'alice@example.com', password: 'replacement-password' } });
  const updatedCookie = updated.headers.get('set-cookie')!.split(';')[0]!;
  await ctx.request('/auth/logout', { body: {}, cookie: updatedCookie });
  assert.equal((await ctx.request('/me', { cookie: updatedCookie })).status, 401);
  const stored = JSON.stringify(ctx.db.snapshot());
  assert.ok(!stored.includes('synthetic-password'));
  assert.ok(!stored.includes(a.split('=')[1]!));
});

test('M0 任务响应丢失后幂等恢复，后台断开重启后推进，SSE 按序号恢复', async () => {
  const ctx = setup(); const cookie = await ctx.register('worker@example.com'); const key = crypto.randomUUID();
  ctx.db.failAfterNextInsert = 'myol_m0_tasks';
  assert.equal((await ctx.request('/m0/tasks', { body: { prompt: '模拟任务' }, cookie, key })).status, 503);
  const restored = await ctx.request('/m0/tasks', { body: { prompt: '模拟任务' }, cookie, key });
  assert.equal(restored.status, 200);
  const task = (await restored.json()).task;
  assert.equal(ctx.db.tables.get('myol_m0_tasks')!.length, 1);
  assert.equal((await ctx.request('/m0/tasks', { body: { prompt: '不同任务' }, cookie, key })).status, 409);
  assert.equal((await ctx.request('/m0/worker', { body: {} })).status, 401);
  assert.equal((await ctx.request('/m0/worker')).status, 405);
  const results = await Promise.all([1, 2, 3].map(() => ctx.request('/m0/worker', { body: {}, worker: workerKey })));
  assert.ok(results.every(r => r.status === 200));
  assert.equal(ctx.db.tables.get('myol_m0_tasks')![0].revision, 2);
  // 用数据库快照重建进程，既不依赖原处理器也不依赖浏览器请求。
  const restarted = setup(new M0TestDatabase(ctx.db.snapshot()));
  for (let i = 0; i < 2; i++) {
    restarted.db.tables.get('myol_m0_tasks')![0].next_at = 0;
    await restarted.request('/m0/worker', { body: {}, worker: workerKey });
  }
  const events = await restarted.request('/m0/tasks/' + task.id + '/events', { cookie, cursor: '2' });
  assert.match(events.headers.get('content-type')!, /text\/event-stream/);
  const stream = await events.text();
  assert.ok(!stream.includes('id: 1\n') && !stream.includes('id: 2\n'));
  assert.match(stream, /id: 3\n/); assert.match(stream, /id: 4\n/);
  const detail = (await (await restarted.request('/m0/tasks/' + task.id, { cookie })).json()).task;
  assert.equal(detail.status, 'succeeded'); assert.equal(detail.simulated, true);
  assert.deepEqual(detail.events.map((e: any) => e.sequence), [1, 2, 3, 4]);
});

test('M0 并发限流、取消、读取不写入、物理路径与来源配置失败关闭', async () => {
  const ctx = setup(); const cookie = await ctx.register('limits@example.com');
  const outcomes = await Promise.allSettled(Array.from({ length: 16 }, () => quota(ctx.db, 'test-bucket', 5, 900000)));
  assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 5);
  const key = crypto.randomUUID();
  const outcomes2 = await Promise.all([1, 2].map(() => ctx.request('/m0/tasks', { body: { prompt: '取消测试' }, cookie, key })));
  assert.deepEqual(outcomes2.map(r => r.status).sort(), [200, 202]);
  const task = (await outcomes2[0]!.json()).task;
  assert.equal((await ctx.request('/m0/tasks/' + task.id + '/cancel', { body: {}, cookie })).status, 200);
  await ctx.request('/m0/worker', { body: {}, worker: workerKey });
  assert.equal(ctx.db.tables.get('myol_m0_tasks')![0].status, 'cancelled');
  const before = ctx.db.snapshot();
  await ctx.request('/m0/tasks', { cookie }); await ctx.request('/m0/tasks/' + task.id + '/events', { cookie });
  assert.deepEqual(ctx.db.snapshot(), before);
  const app = createM0Application({ db: ctx.db, origin: () => '', workerKey: () => '' });
  assert.equal((await app(new Request(origin + '/app/api/account'))).status, 503);
  assert.equal((await app(new Request(origin + '/unrecognized/api/health'))).status, 404);
  const physical = createM0Application({ db: ctx.db, origin: () => origin, workerKey: () => '' });
  assert.equal((await physical(new Request(origin + '/app-d' + 'a'.repeat(32) + '/api/account', { headers: { cookie } }))).status, 200);
});
