// 真实 Chrome 验证：AI 配乐被内嵌、声音开关可播放/暂停，创作页只在网关可用时启用选项。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startLocalServer } from '../dev/local-server.ts';
import { FileStore } from '../dev/store_file.ts';
import { defaultSpec } from '../functions/shared/spec.ts';

const CHROME_PATH =
  process.env.MYOLGAME_CHROME_PATH ??
  (process.platform === 'win32'
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : '/usr/bin/google-chrome');
const rootDir = fileURLToPath(new URL('..', import.meta.url));

function wavFixture(seconds = 0.3): Uint8Array {
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

test('AI 配乐在真实 Chrome 中可播放并受声音开关控制', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'myol-music-'));
  const gateway = createServer((_req, res) => {
    res.setHeader('content-type', 'audio/wav');
    res.end(wavFixture());
  });
  await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  const apiUrl = 'http://127.0.0.1:' + (gateway.address() as { port: number }).port + '/music';
  const store = new FileStore(join(dir, 'db.json'));
  const app = await startLocalServer({
    port: 0,
    store,
    seed: false,
    agent: false,
    distDir: join(rootDir, 'web', 'dist'),
    env: { model: {}, music: { apiUrl, apiKey: 'test-key', name: 'fake-music' } },
  });
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  try {
    const token = ((await (await fetch(app.url + '/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })).json()) as { token: string }).token;

    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript((value) => {
      if (window === window.top && /^https?:$/.test(location.protocol)) localStorage.setItem('myol.token', value);
    }, token);
    await page.goto(app.url + '/create');
    const aiButton = page.getByRole('button', { name: 'AI 生成配乐' });
    await aiButton.waitFor({ timeout: 15000 });
    assert.equal(await aiButton.isEnabled(), true);

    const response = await fetch(app.url + '/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify({
        prompt: '霓虹打砖块，带背景音乐',
        spec: { ...defaultSpec('breakout', 'neon'), music: 'ai-generated' },
      }),
    });
    assert.equal(response.status, 201);
    const created = await response.json() as { project: { currentVersionId: string } };
    const version = await store.getVersion(created.project.currentVersionId);
    assert.ok(version?.html.includes('data:audio/wav;base64,'));

    await page.setContent(version!.html);
    await page.waitForFunction(() => {
      const track = document.getElementById('music-track') as HTMLAudioElement | null;
      return Boolean(track && track.readyState >= 2);
    });
    await page.click('#sound-enable');
    await page.waitForFunction(() => {
      const track = document.getElementById('music-track') as HTMLAudioElement | null;
      return Boolean(track && !track.paused);
    });
    assert.equal(await page.getAttribute('#sound-music', 'aria-pressed'), 'true');
    await page.click('#sound-music');
    await page.waitForFunction(() => {
      const track = document.getElementById('music-track') as HTMLAudioElement | null;
      return Boolean(track && track.paused);
    });
    assert.equal(await page.getAttribute('#sound-music', 'aria-pressed'), 'false');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await app.close();
    gateway.closeAllConnections();
    await new Promise<void>((resolve) => gateway.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});