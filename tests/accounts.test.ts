// 使用独立临时数据验证真实 HTTP、Cookie 会话和重启持久化。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startLocalServer } from '../dev/local-server.ts';

test('本地账号注册、游客迁移、隔离、会话撤销与重启', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'myol-account-'));
  const dataFile = join(dir, 'db.json');
  let server = await startLocalServer({ port: 0, dataFile, seed: false, agent: false });
  const call = async (path: string, body?: unknown, cookie?: string, token?: string, origin?: string) => {
    const response = await fetch(server.url + '/functions/v1/app/api' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}), ...(origin ? { origin } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0], body: await response.json() as any };
  };
  try {
    const guest = (await call('/session', {})).body.token;
    const project = await call('/projects', { prompt: '做一个贪吃蛇' }, undefined, guest);
    assert.equal(project.status, 201);
    const credentials = { username: 'alice', password: 'test-password-123' };
    const registered = await call('/account/register', credentials, undefined, guest);
    assert.equal(registered.status, 200);
    const first = registered.cookie!;
    assert.equal((await call('/projects', undefined, first)).body.items.length, 1);
    assert.equal((await call('/projects', undefined, undefined, guest)).status, 401);
    assert.equal((await call('/account/register', credentials)).status, 409);
    assert.equal((await call('/account/login', { ...credentials, password: 'incorrect-pass' })).status, 401);
    assert.equal((await call('/account/login', credentials, undefined, undefined, 'https://evil.example')).status, 403);
    const bob = await call('/account/register', { username: 'bob', password: 'bob-password-123' });
    assert.equal((await call('/projects/' + project.body.project.id, undefined, bob.cookie)).status, 403);
    const second = (await call('/account/login', credentials)).cookie!;
    await call('/account/logout', {}, first);
    assert.equal((await call('/account', undefined, first)).body.account, null);
    assert.equal((await call('/projects', undefined, second)).body.items.length, 1);
    await server.close();
    server = await startLocalServer({ port: 0, dataFile, seed: false, agent: false });
    assert.equal((await call('/account', undefined, second)).body.account.username, 'alice');
    assert.equal((await call('/account/password', { password: 'incorrect-pass', newPassword: 'replacement-123' }, second)).status, 401);
    assert.equal((await call('/account/password', { password: credentials.password, newPassword: 'replacement-123' }, second)).status, 200);
    assert.equal((await call('/account', undefined, second)).body.account, null);
    assert.equal((await call('/account/login', credentials)).status, 401);
    assert.equal((await call('/account/login', { ...credentials, password: 'replacement-123' })).status, 200);
    const persisted = await readFile(dataFile, 'utf8');
    assert.ok(!persisted.includes('test-password-123'));
    assert.ok(!persisted.includes(second.split('=')[1]!));
    const db = JSON.parse(persisted);
    assert.equal((await call('/projects', undefined, undefined, db.accounts[0].ownerToken)).status, 401);
    const duplicates = await Promise.all([1, 2].map(() => call('/account/register', { username: 'parallel', password: 'parallel-password' })));
    assert.deepEqual(duplicates.map(r => r.status).sort(), [200, 409]);
  } finally { await server.close(); await rm(dir, { recursive: true, force: true }); }
});
