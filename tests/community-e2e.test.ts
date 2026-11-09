// 双会话浏览器验证发布、搭配、Agent 修改和下架后的副本独立性。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { startLocalServer } from '../dev/local-server.ts';
import { FileStore } from '../dev/store_file.ts';
import type { TaskRecord } from '../functions/store.ts';

const gameHtml = (edited: boolean) => `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${edited ? '伙伴新冒险' : '伙伴试验场'}</title>
<style>*{box-sizing:border-box}body{margin:0;padding:8px;background:#0b1020;color:white;text-align:center;font-family:system-ui}h1{font-size:20px;margin:8px}p{margin:8px}canvas{width:min(100%,640px);height:auto;max-height:calc(100dvh - 100px);border-radius:16px}</style></head>
<body><h1>${edited ? '伙伴新冒险' : '伙伴试验场'}</h1><p>空格与方向键移动 · R 重新开始 · ${edited ? '180' : '120'}秒</p><canvas width="640" height="360"></canvas>
<script>const TEMPLATE_KEEP_ME='independent-source';let moves=0;const c=document.querySelector('canvas'),ctx=c.getContext('2d');
function draw(){ctx.fillStyle='#18243d';ctx.fillRect(0,0,640,360);ctx.fillStyle='#7ee787';ctx.fillRect(80+moves*5,170,40,40);ctx.fillStyle='#ffd166';ctx.fillRect(460,170,40,40);ctx.fillStyle='white';ctx.font='20px sans-serif';ctx.fillText('Moves: '+moves,20,30)}
function reset(){moves=0;draw()}addEventListener('keydown',e=>{e.preventDefault();if(e.key==='r')reset();else{moves++;draw()}});window.__MYOLGAME_TEST__={getState:()=>({moves}),reset};draw();</script></body></html>`;

test('作者发布可调模板，另一会话搜索试玩并由 Agent 基于源码修改，原模板与发布作品独立', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'myol-community-e2e-'));
  const prompts: string[] = [];
  const gateway = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const { prompt } = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { prompt: string };
    prompts.push(prompt);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ html: gameHtml(prompt.includes('本次选择：')) }));
  });
  await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  const store = new FileStore(join(dir, 'db.json'));
  const app = await startLocalServer({ port: 0, store, seed: false, sandboxDir: join(dir, 'sandboxes'),
    agent: { provider: 'http', name: '受控模板 Agent', apiUrl: 'http://127.0.0.1:' + (gateway.address() as { port: number }).port,
      apiKey: 'synthetic-test-key', timeoutMs: 30000, maxAttempts: 1, chromePath: '/usr/bin/google-chrome' } });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
  const api = (path: string, method = 'GET', body?: unknown, token = '') => fetch(app.url + '/api' + path, {
    method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const waitTask = async (project: string, taskId: string, token: string) => {
    const deadline = Date.now() + 40000;
    while (Date.now() < deadline) {
      const { task } = await (await api('/projects/' + project + '/tasks/' + taskId, 'GET', undefined, token)).json() as { task: TaskRecord };
      if (task.finishedAt) { assert.equal(task.status, 'succeeded', task.error || ''); return; }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('等待模板 Agent 超时');
  };
  try {
    const author = await (await api('/session', 'POST', { nickname: '模板作者' })).json() as { token: string };
    const reader = await (await api('/session', 'POST', { nickname: '模板使用者' })).json() as { token: string };
    const source = await (await api('/projects', 'POST', { prompt: '创建伙伴试验场' }, author.token)).json() as { project: { id: string }; task: TaskRecord };
    await waitTask(source.project.id, source.task.id, author.token);
    const authorContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    await authorContext.addInitScript((token) => { if (window === window.top && /^https?:$/.test(location.protocol)) localStorage.setItem('myol.token', token); }, author.token);
    const authorPage = await authorContext.newPage();
    const errors: string[] = [];
    authorContext.on('weberror', (error) => errors.push(error.error().message));
    await authorPage.goto(app.url + '/projects/' + source.project.id);
    await authorPage.getByRole('heading', { name: '伙伴试验场', exact: true }).waitFor();
    await authorPage.getByText('填写模板介绍与可调参数', { exact: true }).click();
    const form = authorPage.locator('.template-publisher');
    await form.getByLabel('模板标题', { exact: true }).fill('怪兽伙伴 · 森林肉鸽');
    await form.getByLabel('模板介绍', { exact: true }).fill('从伙伴示例出发，搭配时长与难度，开发自己的森林生存挑战。');
    await form.getByLabel('创作需求模板', { exact: true }).fill('保留示例的伙伴移动操作，按选择调整单局时长与难度，增加伙伴收集玩法。');
    await form.getByRole('button', { name: '添加数字参数' }).click();
    const first = form.locator('fieldset').nth(0);
    await first.getByLabel('参数名称').fill('单局时长');
    await form.getByRole('button', { name: '添加下拉参数' }).click();
    await form.getByLabel('源码使用许可').selectOption('MIT');
    await form.getByRole('checkbox').check();
    const publishedResponse = authorPage.waitForResponse((res) => res.url().endsWith('/projects/' + source.project.id + '/templates') && res.request().method() === 'POST');
    await form.getByRole('button', { name: '发布到模板社区' }).click();
    const response = await publishedResponse;
    assert.equal(response.status(), 201, await response.text());
    const { template } = await response.json() as { template: { id: string } };
    await form.getByRole('link', { name: '查看创作模板' }).click();
    await authorPage.waitForURL('**/templates/' + template.id);
    const readerContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    readerContext.on('weberror', (error) => errors.push(error.error().message));
    await readerContext.addInitScript((token) => { if (window === window.top && /^https?:$/.test(location.protocol)) localStorage.setItem('myol.token', token); }, reader.token);
    const page = await readerContext.newPage();
    await page.goto(app.url + '/templates');
    await page.getByRole('searchbox', { name: '搜索创作模板' }).fill('森林');
    await page.getByRole('button', { name: '搜索', exact: true }).click();
    await page.getByRole('link', { name: '怪兽伙伴 · 森林肉鸽', exact: true }).waitFor();
    await page.screenshot({ path: '/tmp/myol-community-list.png', fullPage: true, animations: 'disabled' });
    await page.getByRole('link', { name: '怪兽伙伴 · 森林肉鸽', exact: true }).click();
    await page.frameLocator('.sandbox-frame iframe').locator('canvas').waitFor();
    await page.locator('.page').evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => {}))); });
    await page.getByLabel('单局时长').fill('180');
    await page.getByLabel('游戏难度').selectOption('困难');
    await page.getByLabel('补充你的创意').fill('加入森林伙伴');
    await page.screenshot({ path: '/tmp/myol-community-detail.png', fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, '窄屏模板详情不应横向溢出');
    const navigation = page.getByRole('link', { name: '社区模板', exact: true });
    const navBox = await navigation.boundingBox();
    assert.ok(navBox && navBox.width > navBox.height, '手机导航不应被挤成竖排');
    await page.screenshot({ path: '/tmp/myol-community-mobile.png', fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.getByRole('button', { name: '按参数创建并生成' }).click();
    await page.waitForURL('**/projects/*');
    const projectId = page.url().split('/').pop()!;
    await page.getByRole('heading', { name: '版本历史（2）', exact: true }).waitFor({ timeout: 40000 });
    const frame = page.frameLocator('.sandbox-frame iframe');
    await frame.getByRole('heading', { name: '伙伴新冒险' }).waitFor();
    await frame.getByText(/180秒/).waitFor();
    const versions = await store.listVersions(projectId);
    assert.equal(versions.length, 2);
    assert.equal(versions[1]!.parentId, versions[0]!.id);
    assert.ok(prompts[1]!.includes(versions[0]!.html), 'Agent 必须读取独立副本的完整基础源码');
    assert.ok(prompts[1]!.includes('单局时长：180'));
    assert.ok(prompts[1]!.includes('游戏难度：困难'));
    assert.ok(prompts[1]!.includes('加入森林伙伴'));
    assert.equal(versions[1]!.artifactHash, createHash('sha256').update(versions[1]!.html).digest('hex'));
    assert.match(versions[1]!.html, /MYOLGAME_ATTRIBUTION/);
    assert.match(versions[1]!.html, /模板作者/);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '下载源码包（当前预览版本）' }).click(),
    ]);
    assert.ok(await download.path());
    // 刷新后仍然选中已完成版本，来源与许可不依赖模板是否继续公开。
    await page.reload();
    await page.getByRole('heading', { name: '版本历史（2）', exact: true }).waitFor();
    await page.frameLocator('.sandbox-frame iframe').getByRole('heading', { name: '伙伴新冒险' }).waitFor();
    await authorPage.getByRole('button', { name: '下架此模板' }).click();
    await authorPage.getByRole('button', { name: '重新上架模板' }).waitFor();
    assert.equal((await api('/templates/' + template.id)).status, 404);
    assert.equal((await api('/projects/' + projectId, 'GET', undefined, reader.token)).status, 200);
    await authorPage.getByRole('button', { name: '重新上架模板' }).click();
    await authorPage.getByRole('button', { name: '下架此模板' }).waitFor();
    assert.equal((await api('/templates/' + template.id)).status, 200);
    await page.screenshot({ path: '/tmp/myol-community-workbench.png', fullPage: true, animations: 'disabled' });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close(); await app.close();
    gateway.closeAllConnections();
    await new Promise<void>((resolve) => gateway.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
