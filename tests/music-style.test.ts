// 参数化编曲：验证白名单钳制、OpenAI 兼容请求与失败回退、账号级配置隔离。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startLocalServer } from '../dev/local-server.ts';
import { FileStore } from '../dev/store_file.ts';
import { generateGame } from '../functions/generate.ts';
import { chatCompletionsUrl, generateMusicStyle, parseMusicStyleSettingsInput } from '../functions/shared/music-style.ts';
import { DEFAULT_MUSIC_STYLE, defaultSpec, sanitizeMusicStyle } from '../functions/shared/spec.ts';

type ChatReply = { status?: number; content?: string; raw?: string };

async function startChatServer(reply: (body: Record<string, unknown>) => ChatReply = () => ({ content: '{}' })): Promise<{
  url: string;
  requests: () => number;
  bodies: Record<string, unknown>[];
  headers: Record<string, string>[];
  close: () => Promise<void>;
}> {
  let requests = 0;
  const bodies: Record<string, unknown>[] = [];
  const headers: Record<string, string>[] = [];
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    requests += 1;
    headers.push(req.headers.authorization ? { authorization: req.headers.authorization } : {});
    let raw = '';
    for await (const chunk of req) raw += chunk;
    try {
      bodies.push(JSON.parse(raw) as Record<string, unknown>);
    } catch {
      bodies.push({});
    }
    const result = reply(bodies[bodies.length - 1] ?? {});
    res.statusCode = result.status ?? 200;
    res.setHeader('content-type', 'application/json');
    if (result.raw !== undefined) {
      res.end(result.raw);
      return;
    }
    res.end(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: result.content ?? '{}' } }],
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: 'http://127.0.0.1:' + port,
    requests: () => requests,
    bodies,
    headers,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('编曲风格白名单', () => {
  test('默认参数与霓虹街机原版一致', () => {
    assert.deepEqual(DEFAULT_MUSIC_STYLE, {
      bpm: 120,
      progression: 'minor',
      transpose: 0,
      leadWave: 'triangle',
      bassWave: 'triangle',
      kickWave: 'sine',
      density: 1,
      swing: 0,
      octave: 0,
      seed: 1,
    });
  });

  test('数值钳制、枚举白名单与缺省回退', () => {
    const style = sanitizeMusicStyle({
      bpm: 500,
      progression: 'phrygian',
      transpose: -99,
      leadWave: 'noise',
      bassWave: 'square',
      kickWave: 'sawtooth',
      density: 0.01,
      swing: 9,
      octave: 7,
      seed: 100000,
      extra: 'ignored',
    });
    assert.equal(style.bpm, 160);
    assert.equal(style.progression, 'minor');
    assert.equal(style.transpose, -5);
    assert.equal(style.leadWave, 'triangle');
    assert.equal(style.bassWave, 'square');
    assert.equal(style.kickWave, 'sawtooth');
    assert.equal(style.density, 0.3);
    assert.equal(style.swing, 0.3);
    assert.equal(style.octave, 1);
    assert.equal(style.seed, 9999);
    assert.ok(!('extra' in style));

    const parsed = sanitizeMusicStyle({
      bpm: 143.6,
      progression: 'dorian',
      transpose: 2,
      leadWave: 'square',
      bassWave: 'sawtooth',
      kickWave: 'triangle',
      density: 0.55,
      swing: 0.12,
      octave: -1,
      seed: 42,
    });
    assert.deepEqual(parsed, {
      bpm: 144,
      progression: 'dorian',
      transpose: 2,
      leadWave: 'square',
      bassWave: 'sawtooth',
      kickWave: 'triangle',
      density: 0.55,
      swing: 0.12,
      octave: -1,
      seed: 42,
    });

    const fallback = { ...DEFAULT_MUSIC_STYLE, bpm: 99 };
    assert.deepEqual(sanitizeMusicStyle(null, fallback), fallback);
    assert.equal(sanitizeMusicStyle('bpm:200', fallback).bpm, 99);
    assert.equal(sanitizeMusicStyle([], fallback).bpm, 99);
    assert.equal(sanitizeMusicStyle({ bpm: Number.NaN }, fallback).bpm, 99);
    assert.equal(sanitizeMusicStyle({ bpm: 'fast' }, fallback).bpm, 99);
  });
});

describe('OpenAI 兼容编曲客户端', () => {
  test('兼容基址、/v1 与完整路径', () => {
    assert.equal(chatCompletionsUrl('https://api.deepseek.com'), 'https://api.deepseek.com/chat/completions');
    assert.equal(chatCompletionsUrl('https://api.deepseek.com/'), 'https://api.deepseek.com/chat/completions');
    assert.equal(chatCompletionsUrl('https://api.openai.com/v1'), 'https://api.openai.com/v1/chat/completions');
    assert.equal(
      chatCompletionsUrl('https://api.openai.com/v1/chat/completions/'),
      'https://api.openai.com/v1/chat/completions',
    );
  });

  test('配置校验：协议、凭据、模型名与已保存密钥回退', () => {
    assert.equal(parseMusicStyleSettingsInput({ apiUrl: 'https://api.deepseek.com', apiKey: 'k', model: 'deepseek-chat' }).ok, true);
    assert.equal(parseMusicStyleSettingsInput({ apiUrl: 'http://127.0.0.1:8080/v1', apiKey: 'k', model: 'm' }).ok, true);
    assert.equal(parseMusicStyleSettingsInput({ apiUrl: 'http://localhost:8080', apiKey: 'k', model: 'm' }).ok, true);

    const cases: [Record<string, unknown>, string?][] = [
      [{ apiUrl: '', apiKey: 'k', model: 'm' }, undefined],
      [{ apiUrl: 'http://example.com', apiKey: 'k', model: 'm' }, undefined],
      [{ apiUrl: 'https://user:pass@example.com', apiKey: 'k', model: 'm' }, undefined],
      [{ apiUrl: 'https://example.com/#x', apiKey: 'k', model: 'm' }, undefined],
      [{ apiUrl: 'https://example.com', model: 'm' }, undefined],
      [{ apiUrl: 'https://example.com', apiKey: 'k' }, undefined],
      [{ apiUrl: 'https://example.com', apiKey: 'k', model: 'bad model' }, undefined],
      [{ apiUrl: 'https://example.com', model: 'deepseek-chat' }, 'saved'],
    ];
    for (const [raw, previousKey] of cases) {
      const parsed = parseMusicStyleSettingsInput(raw, previousKey);
      assert.equal(parsed.ok, previousKey === 'saved', JSON.stringify(raw));
      if (parsed.ok) assert.equal(parsed.apiKey, 'saved');
      else assert.ok(parsed.error.length > 0);
    }
  });

  test('解析代码块 JSON 并钳制未知字段', async () => {
    const server = await startChatServer(() => ({
      content: '```json\n{"bpm":300,"progression":"major","leadWave":"square","density":2,"seed":7}\n```',
    }));
    try {
      const style = await generateMusicStyle('霓虹打砖块', defaultSpec('breakout', 'neon'), {
        apiUrl: server.url,
        apiKey: 'secret',
        model: 'mock-model',
      });
      assert.ok(style);
      assert.equal(style.model, 'mock-model');
      assert.equal(style.style.bpm, 160);
      assert.equal(style.style.progression, 'major');
      assert.equal(style.style.leadWave, 'square');
      assert.equal(style.style.density, 1);
      assert.equal(style.style.seed, 7);
      assert.equal(style.style.bassWave, DEFAULT_MUSIC_STYLE.bassWave);

      assert.equal(server.bodies[0]?.model, 'mock-model');
      assert.equal(server.bodies[0]?.stream, false);
      assert.equal(server.headers[0]?.authorization, 'Bearer secret');
      const messages = server.bodies[0]?.messages as { role: string; content: string }[];
      assert.equal(messages[0]?.role, 'system');
      assert.ok(messages[0]!.content.includes('70-160'));
      assert.ok(messages[1]!.content.includes('breakout'));
    } finally {
      await server.close();
    }
  });

  test('上游错误、非 JSON、无已知字段与未配置时返回 null', async () => {
    const failing = await startChatServer(() => ({ status: 401 }));
    const junk = await startChatServer(() => ({ content: '抱歉，我无法完成。' }));
    const unrelated = await startChatServer(() => ({ content: '{"genre":"jazz"}' }));
    const badRaw = await startChatServer(() => ({ raw: '<html>oops</html>' }));
    try {
      const env = (url: string) => ({ apiUrl: url, apiKey: 'k', model: 'm' });
      for (const server of [failing, junk, unrelated, badRaw]) {
        assert.equal(await generateMusicStyle('测试', defaultSpec('breakout', 'neon'), env(server.url)), null);
      }
      assert.equal(await generateMusicStyle('测试', defaultSpec('breakout', 'neon'), { apiUrl: failing.url }), null);
    } finally {
      await failing.close();
      await junk.close();
      await unrelated.close();
      await badRaw.close();
    }
  });
});

describe('生成管线接入编曲模型', () => {
  test('霓虹街机成功使用模型参数并注入 HTML，不泄露密钥', async () => {
    const server = await startChatServer(() => ({
      content: '{"bpm":132,"progression":"dorian","transpose":2,"leadWave":"square","bassWave":"sawtooth","kickWave":"triangle","density":0.7,"swing":0.1,"octave":1,"seed":88}',
    }));
    try {
      const result = await generateGame({
        prompt: '霓虹打砖块，节奏紧凑',
        baseSpec: { ...defaultSpec('breakout', 'neon'), musicPrompt: '夜晚合成器' },
        env: {},
        styleModel: { apiUrl: server.url, apiKey: 'pipe-secret', model: 'mock-arranger' },
      });
      assert.equal(result.ok, true);
      assert.equal(result.spec.musicStyle?.bpm, 132);
      assert.equal(result.spec.musicStyle?.progression, 'dorian');
      assert.ok(result.html.includes('createArcadeAudio(null, '));
      assert.ok(result.html.includes('"bpm":132'));
      assert.ok(result.html.includes('"progression":"dorian"'));
      assert.ok(!result.html.includes('pipe-secret'));
      assert.ok(result.notes.some((note) => note.includes('mock-arranger')));
      assert.ok(result.stages.some((stage) => stage.name === '调整配乐风格（模型辅助）' && stage.ok));
    } finally {
      await server.close();
    }
  });

  test('AI 编曲预设使用模型参数，未配置时回退默认合成配乐', async () => {
    const server = await startChatServer(() => ({ content: '{"bpm":112,"progression":"major","seed":5}' }));
    try {
      const arranged = await generateGame({
        prompt: '霓虹打砖块，轻快一点',
        baseSpec: { ...defaultSpec('breakout', 'neon'), music: 'ai-arranged' },
        env: {},
        styleModel: { apiUrl: server.url, apiKey: 'k', model: 'arranger' },
      });
      assert.equal(arranged.ok, true);
      assert.equal(arranged.spec.music, 'ai-arranged');
      assert.equal(arranged.spec.musicStyle?.bpm, 112);
      assert.ok(arranged.html.includes('createArcadeAudio(null, '));
      assert.ok(arranged.html.includes('"bpm":112'));
      assert.ok(arranged.stages.some((stage) => stage.name === '调整配乐风格（模型辅助）' && stage.ok));

      const fallback = await generateGame({
        prompt: '霓虹打砖块',
        baseSpec: { ...defaultSpec('breakout', 'neon'), music: 'ai-arranged' },
        env: {},
      });
      assert.equal(fallback.ok, true);
      assert.equal(fallback.spec.music, 'ai-arranged');
      assert.equal(fallback.spec.musicStyle, undefined);
      assert.ok(fallback.html.includes('createArcadeAudio(null, null)'));
      assert.ok(fallback.notes.some((note) => note.includes('编曲模型未配置')));
      assert.ok(fallback.stages.some((stage) => stage.name === '调整配乐风格（未配置）' && stage.detail === 'style_model_not_configured'));
    } finally {
      await server.close();
    }
  });

  test('模型失败回退默认霓虹配乐；非霓虹主题不请求模型', async () => {
    const failing = await startChatServer(() => ({ status: 500 }));
    try {
      const failed = await generateGame({
        prompt: '霓虹打砖块',
        baseSpec: defaultSpec('breakout', 'neon'),
        env: {},
        styleModel: { apiUrl: failing.url, apiKey: 'k', model: 'm' },
      });
      assert.equal(failed.ok, true);
      assert.equal(failed.spec.musicStyle, undefined);
      assert.ok(failed.stages.some((stage) => stage.name === '调整配乐风格（回退默认）' && !stage.ok && stage.detail === 'style_model_failed'));
      assert.ok(failed.notes.some((note) => note.includes('回退为默认霓虹配乐')));

      const otherTheme = await generateGame({
        prompt: '森林贪吃蛇',
        baseSpec: defaultSpec('snake', 'forest'),
        env: {},
        styleModel: { apiUrl: failing.url, apiKey: 'k', model: 'm' },
      });
      assert.equal(otherTheme.ok, true);
      assert.equal(failing.requests(), 1, '仅霓虹街机需要编曲模型');
    } finally {
      await failing.close();
    }
  });
});

type StyleView = {
  account: { apiUrl: string; model: string; hasKey: boolean } | null;
  server: { model: string | null } | null;
  effective: 'account' | 'server' | 'none';
};

describe('账号级编曲模型设置', () => {
  async function fixture(serverStyle?: { apiUrl: string; apiKey: string; model: string }) {
    const dir = await mkdtemp(join(tmpdir(), 'myol-music-style-'));
    const store = new FileStore(join(dir, 'db.json'));
    const app = await startLocalServer({
      port: 0,
      store,
      seed: false,
      env: { model: {}, ...(serverStyle ? { musicStyle: serverStyle } : {}) },
    });
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
      store,
      app,
      request,
      createSession,
      cleanup: async () => {
        await app.close();
        await rm(dir, { recursive: true, force: true });
      },
    };
  }

  test('保存、掩码读取、账号隔离、生成使用账号模型并可清除', async () => {
    const f = await fixture();
    const chat = await startChatServer(() => ({ content: '{"bpm":128,"progression":"major","seed":9}' }));
    try {
      const token = await f.createSession();
      const other = await f.createSession();

      let response = await f.request('/music/style-model', 'GET', undefined, token);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), { account: null, server: null, effective: 'none' });

      response = await f.request('/music/style-model', 'PUT', { apiUrl: chat.url, model: 'deepseek-chat' }, token);
      assert.equal(response.status, 400);
      response = await f.request('/music/style-model', 'PUT', {
        apiUrl: 'http://example.com', apiKey: 'k', model: 'deepseek-chat',
      }, token);
      assert.equal(response.status, 400);
      assert.equal(((await response.json()) as { error: { code: string } }).error.code, 'invalid_music_style_settings');

      const secret = 'style-secret-key-456';
      response = await f.request('/music/style-model', 'PUT', {
        apiUrl: chat.url,
        apiKey: secret,
        model: 'deepseek-chat',
      }, token);
      assert.equal(response.status, 200);
      const savedText = await response.text();
      assert.ok(!savedText.includes(secret), '响应不能包含密钥');
      const saved = JSON.parse(savedText) as StyleView;
      assert.equal(saved.effective, 'account');
      assert.deepEqual(saved.account, { apiUrl: chat.url, model: 'deepseek-chat', hasKey: true });

      const reloaded = new FileStore(join(f.dir, 'db.json'));
      await reloaded.init();
      assert.equal((await reloaded.getMusicStyleSettings(token))?.apiKey, secret);

      response = await f.request('/music/style-model', 'GET', undefined, other);
      assert.deepEqual(await response.json(), { account: null, server: null, effective: 'none' });

      response = await f.request('/projects', 'POST', {
        prompt: '霓虹打砖块',
        spec: defaultSpec('breakout', 'neon'),
      }, token);
      assert.equal(response.status, 201);
      const created = await response.json() as { version: { id: string } };
      const version = await f.store.getVersion(created.version.id);
      assert.equal(version?.spec.musicStyle?.bpm, 128);
      assert.ok(version?.html.includes('"bpm":128'));
      assert.equal(chat.requests(), 1);
      assert.equal(chat.headers[0]?.authorization, 'Bearer ' + secret);

      // 未配置的会话不会串用他人密钥，仍生成默认霓虹配乐。
      response = await f.request('/projects', 'POST', {
        prompt: '霓虹打砖块',
        spec: defaultSpec('breakout', 'neon'),
      }, other);
      assert.equal(response.status, 201);
      const fallback = await response.json() as { version: { id: string } };
      const fallbackVersion = await f.store.getVersion(fallback.version.id);
      assert.equal(fallbackVersion?.spec.musicStyle, undefined);
      assert.equal(chat.requests(), 1);

      response = await f.request('/music/style-model', 'PUT', {
        apiUrl: chat.url,
        model: 'deepseek-reasoner',
      }, token);
      const kept = await response.json() as StyleView;
      assert.equal(kept.account?.hasKey, true);
      assert.equal(kept.account?.model, 'deepseek-reasoner');

      response = await f.request('/music/style-model', 'DELETE', undefined, token);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { account: null, server: null, effective: 'none' });
      assert.equal(await f.store.getMusicStyleSettings(token), null);
    } finally {
      await chat.close();
      await f.cleanup();
    }
  });

  test('服务端环境变量作为回退并对账号只回传模型名', async () => {
    const chat = await startChatServer(() => ({ content: '{"bpm":96,"progression":"suspended"}' }));
    const f = await fixture({ apiUrl: chat.url, apiKey: 'server-key', model: 'server-arranger' });
    try {
      const token = await f.createSession();
      const response = await f.request('/music/style-model', 'GET', undefined, token);
      assert.deepEqual(await response.json(), {
        account: null,
        server: { model: 'server-arranger' },
        effective: 'server',
      });

      const created = await f.request('/projects', 'POST', {
        prompt: '霓虹打砖块',
        spec: defaultSpec('breakout', 'neon'),
      }, token);
      assert.equal(created.status, 201);
      const body = await created.json() as { version: { id: string } };
      const version = await f.store.getVersion(body.version.id);
      assert.equal(version?.spec.musicStyle?.bpm, 96);
      assert.equal(chat.requests(), 1);
    } finally {
      await chat.close();
      await f.cleanup();
    }
  });
});
