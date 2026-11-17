// 账号级 AI 配乐设置：验证保存、密钥不回传、账号隔离以及生成时优先使用账号配置。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startLocalServer } from '../dev/local-server.ts';
import { FileStore } from '../dev/store_file.ts';
import { defaultSpec } from '../functions/shared/spec.ts';
import type { TaskRecord, Version } from '../functions/store.ts';

function wavFixture(seconds = 0.2): Uint8Array {
  const sampleRate = 8000;
  const samples = Math.floor(sampleRate * seconds);
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(36 + samples * 2, 4);
  bytes.write('WAVE', 8);
  bytes.write('fmt ', 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(Math.sin(i / 8) * 4000), 44 + i * 2);
  return new Uint8Array(bytes);
}

async function startGateway(status = 200): Promise<{
  url: string;
  requests: () => number;
  bodies: Record<string, unknown>[];
  close: () => Promise<void>;
}> {
  let requests = 0;
  const bodies: Record<string, unknown>[] = [];
  const audio = wavFixture();
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    requests += 1;
    let raw = '';
    for await (const chunk of req) raw += chunk;
    try {
      bodies.push(JSON.parse(raw) as Record<string, unknown>);
    } catch {
      bodies.push({});
    }
    if (status !== 200) {
      res.statusCode = status;
      res.end('denied');
      return;
    }
    res.setHeader('content-type', 'audio/wav');
    res.end(audio);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: 'http://127.0.0.1:' + port + '/music',
    requests: () => requests,
    bodies,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

type MusicView = {
  account: { apiUrl: string; name: string | null; hasKey: boolean } | null;
  server: { name: string | null } | null;
  effective: 'account' | 'server' | 'none';
};

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'myol-music-settings-'));
  const gateway = await startGateway();
  const store = new FileStore(join(dir, 'db.json'));
  const app = await startLocalServer({ port: 0, store, seed: false, env: { model: {} } });
  const request = async (path: string, method = 'GET', body?: unknown, token = '') => {
    const headers: Record<string, string> = {};
    if (token) headers.authorization = 'Bearer ' + token;
    if (body !== undefined) headers['content-type'] = 'application/json';
    return fetch(app.url + '/api' + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };
  const createSession = async () => {
    const response = await request('/session', 'POST', {});
    return ((await response.json()) as { token: string }).token;
  };
  return {
    dir,
    gateway,
    store,
    app,
    request,
    createSession,
    cleanup: async () => {
      await app.close();
      await gateway.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

function aiSpec() {
  return { ...defaultSpec('breakout', 'neon'), music: 'ai-generated' };
}

describe('账号级 AI 配乐设置', () => {
  test('保存、掩码读取、账号隔离、生成优先使用账号配置并可清除', async () => {
    const f = await fixture();
    try {
      const token = await f.createSession();
      const other = await f.createSession();

      let response = await f.request('/music/settings', 'GET', undefined, token);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { account: null, server: null, effective: 'none' });

      // 首次保存必须提供密钥；非 HTTPS 的外部地址被拒绝。
      response = await f.request('/music/settings', 'PUT', { apiUrl: f.gateway.url }, token);
      assert.equal(response.status, 400);
      response = await f.request('/music/settings', 'PUT', { apiUrl: 'http://example.com/music', apiKey: 'k-123' }, token);
      assert.equal(response.status, 400);
      response = await f.request('/music/settings', 'PUT', { apiUrl: 'https://user:pass@example.com/music', apiKey: 'k-123' }, token);
      assert.equal(response.status, 400);

      const secret = 'account-secret-key-123';
      response = await f.request('/music/settings', 'PUT', {
        apiUrl: f.gateway.url,
        apiKey: secret,
        name: 'fake-music',
      }, token);
      assert.equal(response.status, 200);
      const savedText = await response.text();
      assert.ok(!savedText.includes(secret), '响应不能包含密钥');
      const saved = JSON.parse(savedText) as MusicView;
      assert.equal(saved.effective, 'account');
      assert.deepEqual(saved.account, { apiUrl: f.gateway.url, name: 'fake-music', hasKey: true });
      assert.equal(saved.server, null);

      // 密钥只落服务端，持久化后的数据可被新实例读取。
      const reloaded = new FileStore(join(f.dir, 'db.json'));
      await reloaded.init();
      assert.equal((await reloaded.getMusicSettings(token))?.apiKey, secret);

      // 另一个会话看不到配置，也不会误用。
      response = await f.request('/music/settings', 'GET', undefined, other);
      assert.deepEqual(await response.json(), { account: null, server: null, effective: 'none' });

      // 生成时使用账号保存的网关，配置的 model 名称随请求发送。
      response = await f.request('/projects', 'POST', {
        prompt: '霓虹打砖块',
        spec: { ...aiSpec(), musicPrompt: '  温柔\n钢琴  ' },
      }, token);
      assert.equal(response.status, 201);
      const created = await response.json() as { version: { id: string }; task: TaskRecord };
      let version = await f.store.getVersion(created.version.id);
      assert.equal(version?.spec.music, 'ai-generated');
      assert.equal(version?.spec.musicPrompt, '温柔 钢琴');
      assert.ok(version?.html.includes('data:audio/wav;base64,'));
      assert.equal(f.gateway.requests(), 1);

      // 未配置的会话生成时回退为无配乐，不会串用他人的密钥。
      response = await f.request('/projects', 'POST', {
        prompt: '霓虹打砖块',
        spec: aiSpec(),
      }, other);
      assert.equal(response.status, 201);
      const fallback = await response.json() as { version: { id: string } };
      version = await f.store.getVersion(fallback.version.id);
      assert.equal(version?.spec.music, 'none');
      assert.equal(f.gateway.requests(), 1);

      // 留空密钥表示沿用已保存的密钥。
      response = await f.request('/music/settings', 'PUT', {
        apiUrl: f.gateway.url,
        name: 'renamed-music',
      }, token);
      const kept = await response.json() as MusicView;
      assert.equal(kept.account?.hasKey, true);
      assert.equal(kept.account?.name, 'renamed-music');

      response = await f.request('/music/settings', 'DELETE', undefined, token);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { account: null, server: null, effective: 'none' });
      assert.equal(await f.store.getMusicSettings(token), null);
    } finally {
      await f.cleanup();
    }
  });

  test('测试连接：临时参数、已保存密钥回退、失败码与不落库', async () => {
    const f = await fixture();
    const failing = await startGateway(401);
    try {
      const token = await f.createSession();

      // 未保存配置时也能用表单当前值测试，且不会写入配置。
      let response = await f.request('/music/settings/test', 'POST', {
        apiUrl: f.gateway.url,
        apiKey: 'probe-secret',
        name: 'probe-music',
      }, token);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const text = await response.text();
      assert.ok(!text.includes('probe-secret'), '测试响应不能包含密钥');
      const probe = JSON.parse(text) as { ok: boolean; mimeType: string; bytes: number; elapsedMs: number };
      assert.equal(probe.ok, true);
      assert.equal(probe.mimeType, 'audio/wav');
      assert.ok(probe.bytes > 0);
      assert.ok(probe.elapsedMs >= 0);
      assert.equal(f.gateway.requests(), 1);
      const sent = f.gateway.bodies[0]!;
      assert.equal(sent.durationSeconds, 5);
      assert.equal(sent.format, 'mp3');
      assert.equal(sent.loop, true);
      assert.equal(sent.model, 'probe-music');
      assert.ok(String(sent.prompt).includes('connectivity test'));
      const saved = await (await f.request('/music/settings', 'GET', undefined, token)).json() as MusicView;
      assert.equal(saved.account, null, '测试不应保存配置');

      // 已保存密钥时，表单留空密钥沿用服务端保存的密钥。
      response = await f.request('/music/settings', 'PUT', {
        apiUrl: f.gateway.url,
        apiKey: 'saved-secret',
        name: 'saved-music',
      }, token);
      assert.equal(response.status, 200);
      response = await f.request('/music/settings/test', 'POST', {
        apiUrl: f.gateway.url,
        name: 'saved-music',
      }, token);
      assert.equal(response.status, 200);
      assert.equal((await response.json() as { ok: boolean }).ok, true);
      assert.equal(f.gateway.requests(), 2);

      // 上游错误状态原样转换为失败码，HTTP 状态仍为 200 供界面展示。
      response = await f.request('/music/settings/test', 'POST', {
        apiUrl: failing.url,
        apiKey: 'bad-key',
      }, token);
      assert.equal(response.status, 200);
      const failed = await response.json() as { ok: boolean; error: string; elapsedMs: number };
      assert.equal(failed.ok, false);
      assert.equal(failed.error, 'music_http_401');
      assert.ok(failed.elapsedMs >= 0);

      // 非法地址与非 HTTPS 地址在发请求前被拒绝。
      response = await f.request('/music/settings/test', 'POST', {
        apiUrl: 'http://example.com/music',
        apiKey: 'k-123',
      }, token);
      assert.equal(response.status, 400);
      const invalid = await response.json() as { error: { code: string } };
      assert.equal(invalid.error.code, 'invalid_music_settings');

      // 既未保存也留空密钥时直接报错，不尝试请求上游。
      const other = await f.createSession();
      response = await f.request('/music/settings/test', 'POST', { apiUrl: f.gateway.url }, other);
      assert.equal(response.status, 400);
      assert.equal(f.gateway.requests(), 2);
    } finally {
      await failing.close();
      await f.cleanup();
    }
  });

  test('服务端环境变量作为未保存账号配置时的回退', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'myol-music-server-'));
    const gateway = await startGateway();
    try {
      const store = new FileStore(join(dir, 'db.json'));
      const app = await startLocalServer({
        port: 0,
        store,
        seed: false,
        env: { model: {}, music: { apiUrl: gateway.url, apiKey: 'server-key', name: 'server-music' } },
      });
      try {
        const session = await fetch(app.url + '/api/session', { method: 'POST' });
        const { token } = await session.json() as { token: string };
        const response = await fetch(app.url + '/api/music/settings', {
          headers: { authorization: 'Bearer ' + token },
        });
        assert.deepEqual(await response.json(), {
          account: null,
          server: { name: 'server-music' },
          effective: 'server',
        });

        const created = await fetch(app.url + '/api/projects', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
          body: JSON.stringify({ prompt: '霓虹打砖块', spec: aiSpec() }),
        });
        assert.equal(created.status, 201);
        const body = await created.json() as { version: { id: string } };
        const version = await store.getVersion(body.version.id) as Version;
        assert.equal(version.spec.music, 'ai-generated');
        assert.ok(version.html.includes('data:audio/wav;base64,'));
      } finally {
        await app.close();
      }
    } finally {
      await gateway.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});