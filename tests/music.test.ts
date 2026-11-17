import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { generateGame } from '../functions/generate.ts';
import { defaultSpec, sanitizeSpec, type GameSpec } from '../functions/shared/spec.ts';

// 构造一小段可被浏览器解码的 WAV，避免测试依赖外部音频文件。
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

type GatewayReply = { status?: number; type: string; body: Uint8Array | string };
type Gateway = { url: string; requests: number; close: () => Promise<void>; lastBody: () => Record<string, unknown> };

async function startGateway(reply: (body: Record<string, unknown>) => GatewayReply): Promise<Gateway> {
  let requests = 0;
  let last = '';
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    requests += 1;
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    last = Buffer.concat(chunks).toString('utf8');
    const body = JSON.parse(last || '{}') as Record<string, unknown>;
    const result = reply(body);
    res.statusCode = result.status ?? 200;
    res.setHeader('content-type', result.type);
    res.end(result.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: 'http://127.0.0.1:' + port + '/music',
    get requests() { return requests; },
    lastBody: () => JSON.parse(last || '{}') as Record<string, unknown>,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function aiSpec(): GameSpec {
  return { ...defaultSpec('breakout', 'neon'), music: 'ai-generated' };
}

describe('AI 配乐网关', () => {
  test('白名单接受 ai-generated', () => {
    assert.equal(sanitizeSpec({ ...aiSpec(), music: 'ai-generated' }).music, 'ai-generated');
    assert.equal(sanitizeSpec({ ...aiSpec(), music: 'unknown' }, aiSpec()).music, 'ai-generated');
  });

  test('音频字节响应被内嵌到单文件 HTML', async () => {
    const wav = wavFixture();
    const gateway = await startGateway(() => ({ type: 'audio/wav', body: wav }));
    try {
      const result = await generateGame({
        prompt: '霓虹打砖块',
        baseSpec: aiSpec(),
        env: {},
        music: { apiUrl: gateway.url, apiKey: 'test-key', name: 'fake-music' },
      });

      assert.equal(result.ok, true);
      assert.equal(result.spec.music, 'ai-generated');
      assert.ok(result.html.includes('id="music-track"'));
      assert.ok(result.html.includes('data:audio/wav;base64,'));
      assert.ok(result.html.includes("createArcadeAudio('music-track')"));
      assert.ok(result.notes.some((note) => note.includes('音乐生成 API')));
      assert.ok(result.stages.some((stage) => stage.name === '生成 AI 配乐' && stage.ok));
      assert.ok(!result.html.includes('test-key'));

      const sent = gateway.lastBody();
      assert.equal(sent.durationSeconds, 20);
      assert.equal(sent.format, 'mp3');
      assert.equal(sent.loop, true);
      assert.equal(sent.model, 'fake-music');
      assert.ok(typeof sent.prompt === 'string' && String(sent.prompt).includes('Seamless'));
    } finally {
      await gateway.close();
    }
  });

  test('JSON base64 响应与同参数缓存', async () => {
    const wav = wavFixture();
    const gateway = await startGateway(() => ({
      type: 'application/json',
      body: JSON.stringify({ audioBase64: Buffer.from(wav).toString('base64'), mimeType: 'audio/wav' }),
    }));
    try {
      const input = {
        prompt: '霓虹打砖块',
        baseSpec: aiSpec(),
        env: {},
        music: { apiUrl: gateway.url, apiKey: 'test-key' },
      };
      const first = await generateGame(input);
      const second = await generateGame(input);
      assert.equal(first.ok, true);
      assert.equal(second.ok, true);
      assert.ok(second.html.includes('data:audio/wav;base64,'));
      assert.equal(gateway.requests, 1);
    } finally {
      await gateway.close();
    }
  });

  test('HTTP 失败回退为无配乐并记录阶段失败', async () => {
    const gateway = await startGateway(() => ({ status: 502, type: 'application/json', body: '{}' }));
    try {
      const result = await generateGame({
        prompt: '霓虹打砖块',
        baseSpec: aiSpec(),
        env: {},
        music: { apiUrl: gateway.url, apiKey: 'test-key' },
      });
      assert.equal(result.ok, true);
      assert.equal(result.spec.music, 'none');
      assert.ok(!result.html.includes('music-track'));
      assert.ok(result.notes.some((note) => note.includes('回退为无配乐')));
      assert.ok(result.stages.some((stage) => stage.name === '生成 AI 配乐' && !stage.ok && stage.detail === 'music_http_502'));
    } finally {
      await gateway.close();
    }
  });

  test('未配置网关时不发起请求并回退', async () => {
    const result = await generateGame({ prompt: '霓虹打砖块', baseSpec: aiSpec(), env: {}, music: {} });
    assert.equal(result.ok, true);
    assert.equal(result.spec.music, 'none');
    assert.ok(result.stages.some((stage) => stage.detail === 'music_not_configured'));
  });

  test('超限或类型不符的音频被拒绝', async () => {
    const big = await startGateway(() => ({ type: 'audio/wav', body: new Uint8Array(300 * 1024) }));
    const wrong = await startGateway(() => ({ type: 'text/html', body: '<html></html>' }));
    try {
      for (const gateway of [big, wrong]) {
        const result = await generateGame({
          prompt: '霓虹打砖块',
          baseSpec: aiSpec(),
          env: {},
          music: { apiUrl: gateway.url, apiKey: 'test-key' },
        });
        assert.equal(result.ok, true);
        assert.equal(result.spec.music, 'none');
        assert.ok(result.stages.some((stage) => stage.name === '生成 AI 配乐' && !stage.ok));
      }
    } finally {
      await big.close();
      await wrong.close();
    }
  });
});