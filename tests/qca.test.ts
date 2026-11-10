// 验证真实实验路由和 SDK 传输适配器，受控响应不等于真实 Cloud Agents 验收。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQcaExperiment } from '../functions/qca/experiment.ts';
import { M0TestDatabase } from './helpers/m0-db.ts';
import { QcaFixture } from '../dev/qca-fixture.ts';
import type { CloudUser } from '../functions/m0/auth.ts';
// @ts-expect-error 平台随附 JavaScript 模块
import { createCloudAgentsClient } from '../functions/qca/transport.mjs';
const user = (id: string): CloudUser => ({ id, email: id + '@example.invalid', nickname: id, salt: '', password_hash: '', credential_version: 1 });
function setup(db = new M0TestDatabase(), cloud = new QcaFixture()) {
  let route = createQcaExperiment({ db, cloud, model: () => 'fixture-model', ready: () => true, fixture: true });
  const call = async (path: string, body?: unknown, owner: CloudUser | null = user('alice'), key?: string) => {
    const req = new Request('https://fixture.invalid/api/qca' + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    try {
      const res = await route(req, '/api/qca' + path, owner);
      return { status: res!.status, body: await res!.json() as any };
    } catch (error) { return { status: (error as any).status, body: { error: (error as any).code } }; }
  };
  const create = async (key = crypto.randomUUID()) => (await call('/jobs', { prompt: '生成可玩的 Canvas HTML' }, user('alice'), key)).body.job;
  const advance = async (job: any) => (await call('/jobs/' + job.id + '/advance', { revision: job.revision })).body.job;
  return { db, cloud, call, create, advance, restart: () => { route = createQcaExperiment({ db, cloud, model: () => 'fixture-model', ready: () => true, fixture: true }); } };
}

test('QCA 提交一次、独立资源、异步状态、刷新后保存结果且不再次派发', async () => {
  const c = setup(); let job = await c.create();
  for (let i = 0; i < 4; i++) job = await c.advance(job);
  assert.equal(job.state, 'submitted');
  assert.equal(job.execution, 'fixture');
  const stored = c.db.tables.get('myol_qca_jobs')![0];
  assert.ok(stored.agent_id && stored.environment_id && stored.session_id);
  assert.equal(c.cloud.resources.sessions[0].agent.version, 1);
  assert.deepEqual(c.cloud.resources.agents[0].tools, []);
  assert.ok(!('session_id' in job) && !('owner_id' in job));
  const pending = await c.call('/jobs/' + job.id + '/refresh', {});
  assert.equal(pending.body.job.state, 'submitted');
  c.restart(); c.cloud.completeAll();
  const completed = await c.call('/jobs/' + job.id + '/refresh', {});
  assert.equal(completed.body.job.state, 'completed');
  assert.match(completed.body.job.output, /<canvas/);
  const snapshot = c.db.snapshot();
  await c.call('/jobs/' + job.id);
  assert.deepEqual(c.db.snapshot(), snapshot);
  assert.equal(c.cloud.calls.filter(x => x.method === 'POST' && x.path.endsWith('/events')).length, 1);
});

test('QCA 并发创建与阶段推进只产生一次资源，跨账号读取和操作被拒绝', async () => {
  const c = setup(); const key = crypto.randomUUID();
  const created = await Promise.all([c.create(key), c.create(key)]);
  assert.equal(created[0].id, created[1].id);
  assert.equal(c.db.tables.get('myol_qca_jobs')!.length, 1);
  const job = created[0];
  await Promise.all([c.advance(job), c.advance(job), c.advance(job)]);
  assert.equal(c.cloud.resources.agents.length, 1);
  for (const suffix of ['', '/advance', '/refresh', '/reconcile', '/cancel']) {
    assert.equal((await c.call('/jobs/' + job.id + suffix, suffix ? {} : undefined, user('bob'))).status, 404);
  }
  assert.equal((await c.call('/jobs', undefined, null)).status, 401);
  assert.equal((await c.call('/jobs', { prompt: '另一个需求' }, user('alice'), key)).status, 409);
  const second = await c.create();
  let x = (await c.call('/jobs/' + job.id)).body.job, y = second;
  for (let i = 0; i < 3; i++) { x = await c.advance(x); y = await c.advance(y); }
  assert.equal(c.cloud.resources.environments.length, 2);
  const ids = c.db.tables.get('myol_qca_jobs')!.map(j => j.environment_id);
  assert.notEqual(ids[0], ids[1]);
});

test('QCA 创建响应丢失可按完整元数据核对；派发未知不重发也不伪装成功', async () => {
  const c = setup(); let job = await c.create();
  job = await c.advance(job); c.cloud.failAfter = 'environments';
  job = await c.advance(job); assert.equal(job.state, 'creating_environment');
  await c.advance(job);
  assert.equal(c.cloud.resources.environments.length, 1);
  c.restart();
  job = (await c.call('/jobs/' + job.id + '/reconcile', {})).body.job;
  assert.equal(job.state, 'environment_ready');
  job = await c.advance(job); c.cloud.failAfter = 'dispatch';
  job = await c.advance(job); assert.equal(job.state, 'dispatching');
  await c.advance(job); await c.call('/jobs/' + job.id + '/reconcile', {});
  assert.equal(c.cloud.calls.filter(x => x.method === 'POST' && x.path.endsWith('/events')).length, 1);
  assert.equal((await c.call('/jobs/' + job.id)).body.job.state, 'dispatching');
});

test('QCA 崩溃前已占用创建意图不会因等待时间过去而重复创建；取消须确认终态', async () => {
  const c = setup(); let job = await c.create();
  c.db.tables.get('myol_qca_jobs')![0].state = 'creating_agent';
  c.restart();
  await c.call('/jobs/' + job.id + '/reconcile', {});
  await c.advance((await c.call('/jobs/' + job.id)).body.job);
  assert.equal(c.cloud.calls.filter(x => x.method === 'POST').length, 0);
  job = await c.create();
  for (let i = 0; i < 4; i++) job = await c.advance(job);
  const cancel = await c.call('/jobs/' + job.id + '/cancel', {});
  assert.equal(cancel.body.job.state, 'cancel_requested');
  const result = await c.call('/jobs/' + job.id + '/refresh', {});
  assert.equal(result.body.job.state, 'cancelled');
});

test('QCA 传输不跟随重定向、不重试写入、不向错误输出泄露 PAT', async () => {
  let requests = 0;
  const token = 'synthetic-pat-do-not-emit';
  const client = createCloudAgentsClient({ origin: 'https://fixture.invalid', getToken: () => token, diagnostics: () => {}, fetchImpl: async (_url: URL, opts: any) => {
    requests++; assert.equal(opts.redirect, 'manual'); assert.equal(opts.headers.Authorization, 'Bearer ' + token);
    return new Response('', { status: 302, headers: { location: 'https://untrusted.invalid' } });
  } });
  await assert.rejects(client.request('/api/v1/cloud/agents', { method: 'POST', body: { name: 'fixture' } }), (e: any) => !String(e).includes(token));
  assert.equal(requests, 1);
  await assert.rejects(client.request('https://untrusted.invalid/api/v1/cloud/agents'));
  assert.equal(requests, 1);
});
