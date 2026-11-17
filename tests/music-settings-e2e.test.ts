// 真实 Chrome 验证账号页的 AI 配乐 API 面板：注册、保存、创作页启用并生成内嵌配乐。
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

test('账号页保存音乐 API 后创作页启用 AI 配乐并生成成功', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'myol-music-account-'));
  let requests = 0;
  let lastPrompt = '';
  const gateway = createServer(async (req, res) => {
    requests += 1;
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    try {
      lastPrompt = String((JSON.parse(Buffer.concat(chunks).toString('utf8')) as { prompt?: unknown }).prompt ?? '');
    } catch {
      lastPrompt = '';
    }
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
    env: { model: {} },
  });
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(app.url + '/account');
    await page.getByRole('button', { name: '没有账号，去注册' }).click();
    const username = 'apitest_' + Math.random().toString(36).slice(2, 8);
    const secret = 'e2e-secret-' + Math.random().toString(36).slice(2, 10);
    await page.getByLabel('用户名').fill(username);
    await page.getByLabel('密码', { exact: true }).fill('test-pass-123');
    await page.getByLabel('确认密码').fill('test-pass-123');
    await page.getByRole('button', { name: '注册并登录' }).click();
    await page.waitForURL('**/projects');

    await page.goto(app.url + '/account');
    await page.getByRole('heading', { name: 'AI 配乐 API' }).waitFor({ timeout: 15000 });
    await page.getByLabel('接口地址', { exact: true }).fill(apiUrl);
    await page.getByLabel('显示名称（可选，作为 model 传给接口）').fill('e2e-music');
    await page.getByLabel('API 密钥', { exact: true }).fill(secret);
    await page.getByRole('button', { name: '保存配乐接口' }).click();
    await page.getByText('已保存。创作页会优先使用这个接口生成 AI 配乐。').waitFor({ timeout: 15000 });
    assert.ok((await page.textContent('body'))?.includes('账号配置：' + apiUrl));
    assert.ok(!(await page.content()).includes(secret), '页面不应渲染已保存的密钥');

    // 刷新后配置仍在，且密钥输入框不再显示明文。
    await page.reload();
    await page.getByText('账号配置：' + apiUrl).waitFor({ timeout: 15000 });
    assert.equal(await page.getByLabel('API 密钥', { exact: true }).inputValue(), '');
    // 密钥留空时，测试连接沿用服务端已保存的密钥。
    await page.getByRole('button', { name: '测试连接' }).click();
    await page.getByText('连接正常：返回 audio/wav').waitFor({ timeout: 15000 });

    await page.goto(app.url + '/create');
    const aiButton = page.getByRole('button', { name: 'AI 配乐（音乐模型）' });
    await aiButton.waitFor({ timeout: 15000 });
    assert.equal(await aiButton.isEnabled(), true);
    await aiButton.click();
    await page.getByLabel('配乐提示词（可选）').fill('温柔的钢琴与雨声');
    await page.getByLabel('需求提示词').fill('《账号配乐》：霓虹打砖块');
    await page.getByRole('button', { name: '生成游戏并进入工作台' }).click();
    await page.waitForURL('**/projects/**');
    const projectId = page.url().split('/').pop() ?? '';
    const project = await store.getProject(projectId);
    const version = await store.getVersion(project!.currentVersionId);
    assert.equal(project?.ownerToken.startsWith('account:'), true);
    assert.equal(version?.spec.music, 'ai-generated');
    assert.equal(version?.spec.musicPrompt, '温柔的钢琴与雨声');
    assert.ok(version?.html.includes('data:audio/wav;base64,'));
    assert.equal(requests, 2);
    assert.ok(lastPrompt.includes('Additional direction: 温柔的钢琴与雨声'), '网关应收到配乐提示词');

    // 未登录的新会话不会继承该账号的接口配置。
    const guest = await browser.newPage();
    await guest.goto(app.url + '/create');
    const guestButton = guest.getByRole('button', { name: 'AI 配乐（音乐模型）' });
    await guestButton.waitFor({ timeout: 15000 });
    assert.equal(await guestButton.isEnabled(), false);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await app.close();
    gateway.closeAllConnections();
    await new Promise<void>((resolve) => gateway.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});