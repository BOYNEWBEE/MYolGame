// 真实 Chrome 验证 AI 编曲模型：账号保存 OpenAI 兼容配置，创作页生成时写入受限风格参数。
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

test('账号保存编曲模型后，可选用 AI 编曲并生成带模型参数的实时合成配乐', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'myol-music-style-'));
  let requests = 0;
  let authorization = '';
  let userPrompt = '';
  const chat = createServer(async (req, res) => {
    requests += 1;
    authorization = req.headers.authorization ?? '';
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        messages?: { role: string; content: string }[];
      };
      userPrompt = body.messages?.find((message) => message.role === 'user')?.content ?? '';
    } catch {
      userPrompt = '';
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      choices: [{
        message: {
          role: 'assistant',
          content: '{"bpm":138,"progression":"dorian","transpose":3,"leadWave":"square","bassWave":"sawtooth","kickWave":"triangle","density":0.65,"swing":0.08,"octave":-1,"seed":77}',
        },
      }],
    }));
  });
  await new Promise<void>((resolve) => chat.listen(0, '127.0.0.1', resolve));
  const apiUrl = 'http://127.0.0.1:' + (chat.address() as { port: number }).port;
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
    const username = 'styletest_' + Math.random().toString(36).slice(2, 8);
    const secret = 'style-e2e-' + Math.random().toString(36).slice(2, 10);
    await page.getByLabel('用户名').fill(username);
    await page.getByLabel('密码', { exact: true }).fill('test-pass-123');
    await page.getByLabel('确认密码').fill('test-pass-123');
    await page.getByRole('button', { name: '注册并登录' }).click();
    await page.waitForURL('**/projects');

    await page.goto(app.url + '/account');
    await page.getByRole('heading', { name: 'AI 编曲模型（OpenAI 兼容）' }).waitFor({ timeout: 15000 });
    await page.getByLabel('编曲接口地址').fill(apiUrl);
    await page.getByLabel('编曲模型名').fill('deepseek-chat');
    await page.getByLabel('编曲 API 密钥').fill(secret);
    await page.getByRole('button', { name: '保存编曲模型' }).click();
    await page.getByText('已保存。生成「霓虹街机」配乐时会由该模型调整风格。').waitFor({ timeout: 15000 });
    assert.ok((await page.textContent('body'))?.includes('账号配置：' + apiUrl + '（模型 deepseek-chat）'));
    assert.ok(!(await page.content()).includes(secret), '页面不应渲染已保存的密钥');

    await page.reload();
    await page.getByText('账号配置：' + apiUrl + '（模型 deepseek-chat）').waitFor({ timeout: 15000 });
    assert.equal(await page.getByLabel('编曲 API 密钥').inputValue(), '');

    await page.goto(app.url + '/create');
    const arrangedButton = page.getByRole('button', { name: 'AI 编曲（实时合成）' });
    await arrangedButton.waitFor({ timeout: 15000 });
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll('button')].find((item) => item.textContent === 'AI 编曲（实时合成）');
      return Boolean(button && !button.disabled);
    }, undefined, { timeout: 15000 });
    assert.equal(await page.getByRole('button', { name: 'AI 配乐（音乐模型）' }).isEnabled(), false);
    await arrangedButton.click();
    await page.getByText('生成时会由 OpenAI 兼容模型调整调性').waitFor({ timeout: 15000 });
    await page.getByLabel('配乐提示词（可选）').fill('更慢、更悬疑，少一点鼓点');
    await page.getByLabel('需求提示词').fill('《编曲测试》：霓虹打砖块');
    await page.getByRole('button', { name: '生成游戏并进入工作台' }).click();
    await page.waitForURL('**/projects/**', { timeout: 30000 });

    const projectId = page.url().split('/').pop() ?? '';
    const project = await store.getProject(projectId);
    const version = await store.getVersion(project!.currentVersionId);
    assert.equal(project?.ownerToken.startsWith('account:'), true);
    assert.equal(version?.spec.template, 'breakout');
    assert.equal(version?.spec.theme, 'neon');
    assert.equal(version?.spec.music, 'ai-arranged');
    assert.equal(version?.spec.musicPrompt, '更慢、更悬疑，少一点鼓点');
    assert.equal(version?.spec.musicStyle?.bpm, 138);
    assert.equal(version?.spec.musicStyle?.progression, 'dorian');
    assert.equal(version?.spec.musicStyle?.leadWave, 'square');
    assert.equal(version?.spec.musicStyle?.seed, 77);
    assert.ok(version?.html.includes('createArcadeAudio(null, '));
    assert.ok(version?.html.includes('"bpm":138'));
    assert.ok(version?.html.includes('"progression":"dorian"'));
    assert.ok(!version?.html.includes(secret), '产物不应包含密钥');

    assert.equal(requests, 1);
    assert.equal(authorization, 'Bearer ' + secret);
    assert.ok(userPrompt.includes('更慢、更悬疑，少一点鼓点'), '模型应收到配乐提示词');
    assert.ok(userPrompt.includes('breakout'));

    // 预览内确认默认合成配乐仍可开启与关闭，且没有脚本错误。
    const frame = page.frameLocator('.sandbox-frame iframe');
    await frame.getByRole('button', { name: '开启声音' }).click();
    const musicButton = frame.getByRole('button', { name: '音乐' });
    await musicButton.waitFor({ timeout: 15000 });
    assert.equal(await musicButton.getAttribute('aria-pressed'), 'true');
    await musicButton.click();
    assert.equal(await musicButton.getAttribute('aria-pressed'), 'false');
    await musicButton.click();
    assert.equal(await musicButton.getAttribute('aria-pressed'), 'true');

    // 未登录会话没有编曲配置，AI 编曲选项不可用。
    const guest = await browser.newPage();
    await guest.goto(app.url + '/create');
    const guestArranged = guest.getByRole('button', { name: 'AI 编曲（实时合成）' });
    await guestArranged.waitFor({ timeout: 15000 });
    assert.equal(await guestArranged.isEnabled(), false);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await app.close();
    chat.closeAllConnections();
    await new Promise<void>((resolve) => chat.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});