// HTTPS 浏览器验收真实 M0 路由；数据库替身仅用于本机测试，证书与账号均为合成数据。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:https';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { createM0Application } from '../functions/m0/app.ts';
import { tick } from '../functions/m0/tasks.ts';
import { resolveChromePath } from '../dev/chrome.ts';
import { M0TestDatabase } from './helpers/m0-db.ts';

test('M0 HTTPS 邮箱登录、关闭页面后任务推进、刷新恢复和 SSE 进度', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'myol-m0-https-'));
  const certificate = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  assert.equal(certificate.status, 0);
  const db = new M0TestDatabase(); let origin = '';
  const application = createM0Application({ db, origin: () => origin, workerKey: () => 'synthetic-worker-test-key-at-least-32-characters' });
  const server = createServer({ key: await readFile(join(dir, 'key.pem')), cert: await readFile(join(dir, 'cert.pem')) }, async (req, res) => {
    try {
      const path = (req.url ?? '/').split('?')[0]!;
      if (path.startsWith('/functions/')) {
        const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(key, value);
        const response = await application(new Request(origin + req.url, { method: req.method, headers, ...(['GET', 'HEAD'].includes(req.method ?? 'GET') ? {} : { body: Buffer.concat(chunks) }) }));
        res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return;
      }
      const file = path.startsWith('/assets/') ? join('web/dist', path) : 'web/dist/index.html';
      res.setHeader('content-type', extname(file) === '.js' ? 'text/javascript' : extname(file) === '.css' ? 'text/css' : 'text/html');
      res.end(await readFile(file));
    } catch { res.statusCode = 500; res.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'https://127.0.0.1:' + (server.address() as { port: number }).port;
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ executablePath: resolveChromePath(), headless: true });
  } catch (error) {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await page.goto(origin + '/account');
    await page.getByRole('button', { name: '没有账号，去注册' }).click();
    await page.getByLabel('邮箱', { exact: true }).fill('browser-m0@example.com');
    await page.getByLabel('昵称', { exact: true }).fill('云端测试用户');
    await page.getByLabel('密码', { exact: true }).fill('synthetic-password');
    await page.getByLabel('确认密码', { exact: true }).fill('synthetic-password');
    await page.getByRole('button', { name: '注册并登录' }).click();
    await page.waitForURL('**/m0');
    assert.ok((await context.cookies()).some(c => c.name === '__Host-myol_session' && c.secure && c.httpOnly));
    await page.getByLabel('模拟任务需求').fill('测试刷新后恢复');
    await page.getByRole('button', { name: '创建模拟任务' }).click();
    await page.getByRole('heading', { name: '模拟进度：排队中' }).waitFor();
    await page.close();
    await tick(db);
    assert.equal(db.tables.get('myol_m0_tasks')![0].status, 'running');
    const reopened = await context.newPage();
    await reopened.goto(origin + '/m0');
    await reopened.getByRole('heading', { name: '模拟进度：模拟执行中' }).waitFor();
    for (let i = 0; i < 2; i++) { db.tables.get('myol_m0_tasks')![0].next_at = 0; await tick(db); }
    await reopened.getByRole('heading', { name: '模拟进度：模拟完成' }).waitFor();
    await reopened.getByText('M0 模拟任务完成；这不是游戏生成结果', { exact: true }).waitFor();
    await reopened.reload();
    await reopened.getByRole('heading', { name: '模拟进度：模拟完成' }).waitFor();
    assert.equal(db.tables.get('myol_m0_tasks')!.length, 1);
    const another = await browser.newContext({ ignoreHTTPSErrors: true });
    const login = await another.newPage(); await login.goto(origin + '/account');
    await login.getByLabel('邮箱', { exact: true }).fill('browser-m0@example.com');
    await login.getByLabel('密码', { exact: true }).fill('synthetic-password');
    await login.getByRole('button', { name: '登录', exact: true }).click();
    await login.waitForURL('**/m0');
    await login.getByRole('heading', { name: '模拟进度：模拟完成' }).waitFor();
  } finally {
    await browser?.close(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(dir, { recursive: true, force: true });
  }
});
