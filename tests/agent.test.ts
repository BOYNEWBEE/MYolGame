// 使用受控 Agent 网关和真实 Worker/Chrome 验证完整异步链路，不消耗模型额度。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { startLocalServer } from '../dev/local-server.ts';
import { resolveChromePath } from '../dev/chrome.ts';
import { FileStore } from '../dev/store_file.ts';
import { LocalAgent } from '../dev/agent/controller.ts';
import type { TaskRecord, Version } from '../functions/store.ts';
import { defaultSpec } from '../functions/shared/spec.ts';
import type { AgentConfig } from '../dev/agent/protocol.ts';

const html = (title: string) => `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${title}</title>
<style>*{box-sizing:border-box}body{margin:0;padding:8px;background:#0b1020;color:#e9f0ff;font-family:system-ui;text-align:center}h1{font-size:22px;margin:8px 0}canvas{width:min(100%,640px);height:auto;max-height:calc(100dvh - 100px);background:#18243d;border-radius:18px}p{color:#94a7c9;margin:6px 0}</style></head>
<body><h1>${title}</h1><p>空格开始，方向键移动，R 重启</p><canvas width="640" height="400"></canvas>
<script>let moves=0;const c=document.querySelector('canvas'),ctx=c.getContext('2d');
function draw(){ctx.fillStyle='#18243d';ctx.fillRect(0,0,640,400);ctx.fillStyle='#6ee7ff';ctx.fillRect(80+moves*8,160,50,50);ctx.fillStyle='#ffd166';ctx.fillRect(480,160,50,50);ctx.fillStyle='white';ctx.font='20px sans-serif';ctx.fillText('Moves: '+moves,30,40)}
function reset(){moves=0;draw()}addEventListener('keydown',e=>{e.preventDefault();if(e.key==='r')reset();else {moves++;draw()}});
window.__MYOLGAME_TEST__={getState:()=>({moves}),reset};draw();</script></body></html>`;

async function fixture(reply: (prompt: string, call: number) => Promise<string> | string, timeoutMs = 30000, maxAttempts = 2) {
  const dir = await mkdtemp(join(tmpdir(), 'myol-agent-'));
  let calls = 0;
  const prompts: string[] = [];
  const gateway = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()) as { prompt: string };
    prompts.push(body.prompt);
    const result = await reply(body.prompt, ++calls);
    if (!res.destroyed) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ html: result }));
    }
  });
  await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  const config: AgentConfig = { provider: 'http', name: '受控测试 Agent', apiKey: 'test-key',
    apiUrl: 'http://127.0.0.1:' + (gateway.address() as { port: number }).port,
    timeoutMs, maxAttempts, chromePath: resolveChromePath() };
  const store = new FileStore(join(dir, 'db.json'));
  const app = await startLocalServer({ port: 0, store, seed: false, agent: config,
    sandboxDir: join(dir, 'sandboxes') });
  const request = async (path: string, method = 'GET', body?: unknown, tokenOverride?: string) => {
    const response = await fetch(app.url + '/api' + path, { method,
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (tokenOverride ?? token) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return response;
  };
  let token = '';
  token = ((await (await request('/session', 'POST', {})).json()) as { token: string }).token;
  const create = async () => {
    const response = await request('/projects', 'POST', { prompt: '创建一个收集方块的新玩法' });
    assert.equal(response.status, 202);
    return await response.json() as { project: { id: string }; task: TaskRecord };
  };
  const waitTask = async (project: string, id: string): Promise<TaskRecord> => {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      const response = await request('/projects/' + project + '/tasks/' + id);
      const { task } = await response.json() as { task: TaskRecord };
      if (task.finishedAt) return task;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('等待任务终态超时');
  };
  return { dir, app, config, store, request, create, waitTask, prompts, token,
    cleanup: async () => {
      await app.close();
      gateway.closeAllConnections();
      await new Promise<void>((resolve) => gateway.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    } };
}

test('异步源码开发、真实 Chrome 检查、二次修改、发布隔离、回退与重载持久化', async () => {
  const f = await fixture((_prompt, call) => html('收集方块 ' + call));
  try {
    const { project, task } = await f.create();
    assert.equal(task.status, 'queued');
    const done = await f.waitTask(project.id, task.id);
    assert.equal(done.status, 'succeeded', done.error || '');
    let version = await f.store.getVersion(done.versionId!);
    assert.equal(version?.generationMode, 'agent');
    assert.equal(version?.checks?.browser, 'passed');
    assert.ok(version!.html.includes('http-equiv="Content-Security-Policy"'));
    assert.match(version!.artifactHash!, /^[a-f0-9]{64}$/);
    assert.equal(await readFile(join(f.dir, 'sandboxes', task.id, 'index.html'), 'utf8'), version!.html);
    assert.equal((await f.request('/projects/' + project.id + '/publish', 'POST', {})).status, 200);
    const published = await f.store.getGameByProject(project.id);
    const nextResponse = await f.request('/projects/' + project.id + '/tasks', 'POST', { prompt: '新增计步机制' });
    assert.equal(nextResponse.status, 202);
    const next = await nextResponse.json() as { task: TaskRecord };
    const done2 = await f.waitTask(project.id, next.task.id);
    assert.equal(done2.status, 'succeeded', done2.error || '');
    assert.ok(f.prompts[1].includes(version!.html), '修改必须使用上一版本的完整源码');
    assert.equal((await f.store.getGameByProject(project.id))?.versionId, published?.versionId);
    const response = await f.request('/projects/' + project.id + '/restore', 'POST', { versionId: version!.id });
    assert.equal(response.status, 200);
    assert.equal((await f.store.getProject(project.id))?.currentVersionId, version!.id);
    const source = await f.request('/projects/' + project.id + '/source?versionId=' + done2.versionId);
    assert.equal(source.status, 200);
    assert.ok(Buffer.from(await source.arrayBuffer()).includes(Buffer.from('收集方块 2')));
    const other = (await (await f.request('/session', 'POST', {})).json()) as { token: string };
    assert.equal((await f.request('/projects/' + project.id + '/tasks/' + task.id, 'GET', undefined, other.token)).status, 403);
    const reloaded = new FileStore(join(f.dir, 'db.json'));
    await reloaded.init();
    version = await reloaded.getVersion(done2.versionId!);
    assert.equal(version?.checks?.restart, true);
    assert.equal((await reloaded.getTask(done2.id))?.status, 'succeeded');
  } finally { await f.cleanup(); }
});

test('工作台提交后刷新继续轮询，成功预览、修改版本与源码下载', async () => {
  const f = await fixture(async (_prompt, call) => { await new Promise((r) => setTimeout(r, 400)); return html('浏览器游戏 ' + call); });
  const browser = await chromium.launch({ executablePath: resolveChromePath(), headless: true });
  try {
    const page = await browser.newPage();
    await page.addInitScript((token) => localStorage.setItem('myol.token', token), f.token);
    await page.goto(f.app.url + '/create');
    await page.locator('.mode-banner.agent').getByText('AI 源码开发模式', { exact: true }).waitFor();
    await page.getByPlaceholder(/第二关/).waitFor();
    const { project } = await f.create();
    await page.goto(f.app.url + '/projects/' + project.id);
    await page.reload();
    await page.getByText('版本历史（1）', { exact: true }).waitFor({ timeout: 45000 }).catch(async (error: unknown) => {
      console.error(await page.locator('body').innerText());
      throw error;
    });
    await page.getByText(/浏览器烟测通过：画布、按键、重启/).waitFor();
    await page.locator('.chat-input textarea').fill('新增计步机制');
    await page.getByRole('button', { name: '提交源码修改', exact: true }).click();
    await page.getByText('版本历史（2）', { exact: true }).waitFor({ timeout: 45000 });
    await page.getByRole('status').filter({ hasText: '新版本已生成，请试玩确认需求。' }).waitFor();
    const frame = page.frameLocator('.sandbox-frame iframe');
    await frame.locator('canvas').waitFor();
    assert.equal(await frame.locator('title').textContent(), '浏览器游戏 2');
    let networkRequests = 0;
    await page.route('**/agent-policy-probe', async (route) => { networkRequests++; await route.fulfill({ body: 'unexpected' }); });
    const blocked = await frame.locator('canvas').evaluate(async () => {
      try { await fetch('https://myolgame.invalid/agent-policy-probe'); return false; }
      catch { return true; }
    });
    assert.equal(blocked, true, '私有 srcDoc 预览也必须保留资源限制');
    assert.equal(networkRequests, 0);
    await page.screenshot({ path: join(tmpdir(), 'myol-agent-workbench.png'), fullPage: true });
  } finally { await browser.close(); await f.cleanup(); }
});

test('同项目串行、取消运行任务、不保存候选版本', async () => {
  const f = await fixture(async () => { await new Promise((resolve) => setTimeout(resolve, 2000)); return html('应取消'); });
  try {
    const { project, task } = await f.create();
    const results = await Promise.all([1, 2].map(() => f.request('/projects/' + project.id + '/tasks', 'POST', { prompt: '重复任务' })));
    assert.deepEqual(results.map((r) => r.status), [409, 409]);
    await assert.rejects(startLocalServer({ port: f.app.port, store: f.store, agent: f.config }), { code: 'EADDRINUSE' });
    assert.equal((await f.store.getTask(task.id))?.finishedAt, null, '重复启动失败不能中断原服务中的任务');
    await new Promise((resolve) => setTimeout(resolve, 250));
    const cancelled = await f.request('/projects/' + project.id + '/tasks/' + task.id + '/cancel', 'POST', {});
    assert.equal(cancelled.status, 200);
    assert.equal((await f.waitTask(project.id, task.id)).status, 'cancelled');
    assert.equal((await f.store.listVersions(project.id)).length, 0);
  } finally { await f.cleanup(); }
});

test('浏览器发现脚本错误后反馈修复，再提交通过检查的版本', async () => {
  const f = await fixture((_prompt, call) => call === 1 ? html('坏游戏').replace('draw();</script>', "draw();throw new Error('坏脚本');</script>") : html('已修复'));
  try {
    const { project, task } = await f.create();
    const done = await f.waitTask(project.id, task.id);
    assert.equal(done.status, 'succeeded', done.error || '');
    assert.equal(f.prompts.length, 2);
    assert.ok(f.prompts[1].includes('上次生成或检查未通过'));
    assert.ok(done.stages.some((stage) => stage.name.includes('修复')));
  } finally { await f.cleanup(); }
});

test('失败与超时保留已有版本；禁止模板静默兜底', async () => {
  let broken = false;
  const f = await fixture(() => broken ? '不是 HTML' : html('原版'), 30000, 1);
  try {
    const { project, task } = await f.create();
    const first = await f.waitTask(project.id, task.id);
    assert.equal(first.status, 'succeeded', first.error || '');
    broken = true;
    const next = await (await f.request('/projects/' + project.id + '/tasks', 'POST', { prompt: '失败的修改' })).json() as { task: TaskRecord };
    const failed = await f.waitTask(project.id, next.task.id);
    assert.equal(failed.status, 'failed');
    assert.equal((await f.store.getProject(project.id))?.currentVersionId, first.versionId);
    assert.equal((await f.store.listVersions(project.id)).length, 1);
  } finally { await f.cleanup(); }
  const slow = await fixture(async () => { await new Promise((r) => setTimeout(r, 3000)); return html('太慢'); }, 1000, 1);
  try {
    const { project, task } = await slow.create();
    assert.equal((await slow.waitTask(project.id, task.id)).status, 'timed_out');
    assert.equal((await slow.store.listVersions(project.id)).length, 0);
  } finally { await slow.cleanup(); }
});

test('执行期间回退触发冲突检查，不覆盖用户选择', async () => {
  const f = await fixture(async (_prompt, call) => {
    if (call === 2) await new Promise((r) => setTimeout(r, 700));
    return html('版本 ' + call);
  });
  try {
    const { project, task } = await f.create();
    const first = await f.waitTask(project.id, task.id);
    assert.equal(first.status, 'succeeded', first.error || '');
    const next = await (await f.request('/projects/' + project.id + '/tasks', 'POST', { prompt: '执行中的修改' })).json() as { task: TaskRecord };
    await f.request('/projects/' + project.id + '/restore', 'POST', { versionId: first.versionId });
    const done = await f.waitTask(project.id, next.task.id);
    assert.equal(done.status, 'failed');
    assert.match(done.error!, /版本.*变化/);
    assert.equal((await f.store.getProject(project.id))?.currentVersionId, first.versionId);
    assert.equal((await f.store.listVersions(project.id)).length, 1);
  } finally { await f.cleanup(); }
});

test('重启将持久化未完成任务标记为中断', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'myol-recovery-'));
  const store = new FileStore(join(dir, 'db.json'));
  await store.init();
  const task: TaskRecord = { id: crypto.randomUUID(), projectId: crypto.randomUUID(), prompt: '恢复',
    status: 'running', stages: [], versionId: null, error: null, generationMode: 'agent',
    createdAt: new Date().toISOString(), finishedAt: null, baseSpec: defaultSpec() };
  await store.addTask(task);
  const reloaded = new FileStore(join(dir, 'db.json'));
  await reloaded.init();
  const agent = new LocalAgent(reloaded, { provider: 'qoder', name: 'test', timeoutMs: 1000,
    maxAttempts: 1, chromePath: resolveChromePath() }, join(dir, 'sandbox'));
  try {
    await agent.init();
    assert.equal((await reloaded.getTask(task.id))?.status, 'failed');
    assert.match((await reloaded.getTask(task.id))!.error!, /重启/);
    await reloaded.updateTask({ ...task, status: 'running', error: null, finishedAt: null });
    const app = await startLocalServer({ port: 0, store: reloaded, seed: false, agent: false });
    try { assert.equal((await reloaded.getTask(task.id))?.status, 'failed', '切换回模板模式也要结束旧任务'); }
    finally { await app.close(); }
  } finally { await agent.close(); await rm(dir, { recursive: true, force: true }); }
});

test('超出检查范围的外部资源被浏览器阻止，失败候选不保存为版本', async () => {
  const f = await fixture(() => html('外部资源').replace('</body>', '<img src="https://myolgame.invalid/forbidden.png"></body>'), 30000, 1);
  try {
    const { project, task } = await f.create();
    const result = await f.waitTask(project.id, task.id);
    assert.equal(result.status, 'failed');
    assert.equal((await f.store.listVersions(project.id)).length, 0);
  } finally { await f.cleanup(); }
});
