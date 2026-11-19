// 两个隔离浏览器上下文验证账号页面与 Cookie 登录流程。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { startLocalServer } from '../dev/local-server.ts';
import { resolveChromePath } from '../dev/chrome.ts';

test('浏览器注册、另一浏览器登录、密码修改和退出', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'myol-account-ui-'));
  const app = await startLocalServer({ port: 0, dataFile: join(dir, 'db.json'), seed: false, agent: false });
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ executablePath: resolveChromePath(), headless: true });
  } catch (error) {
    await app.close();
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
  try {
    const a = await browser.newContext();
    const page = await a.newPage();
    await page.goto(app.url + '/account');
    await page.getByRole('button', { name: '没有账号，去注册' }).click();
    await page.getByLabel('用户名', { exact: true }).fill('browser_user');
    await page.getByLabel('昵称', { exact: true }).fill('浏览器用户');
    await page.getByLabel('密码', { exact: true }).fill('browser-password');
    await page.getByLabel('确认密码', { exact: true }).fill('browser-password');
    await page.getByRole('button', { name: '注册并登录', exact: true }).click();
    await page.waitForURL('**/projects');
    await page.getByRole('link', { name: '账号管理' }).waitFor();
    assert.ok((await a.cookies()).some(c => c.name === 'myol_session' && c.httpOnly && c.sameSite === 'Strict'));
    assert.equal(await page.evaluate(() => localStorage.getItem('myol.token')), null);
    const b = await browser.newContext();
    const other = await b.newPage();
    await other.goto(app.url + '/account');
    await other.getByLabel('用户名', { exact: true }).fill('browser_user');
    await other.getByLabel('密码', { exact: true }).fill('browser-password');
    await other.getByRole('button', { name: '登录', exact: true }).click();
    await other.waitForURL('**/projects');
    await other.getByRole('link', { name: '账号管理' }).click();
    await other.getByLabel('当前密码').fill('browser-password');
    await other.getByLabel('新密码').fill('new-browser-password');
    await other.getByRole('button', { name: '修改密码并退出所有登录' }).click();
    await other.getByRole('heading', { name: '登录本地账号' }).waitFor();
    await page.reload();
    await page.getByRole('link', { name: '登录 / 注册' }).waitFor();
    await other.getByLabel('用户名', { exact: true }).fill('browser_user');
    await other.getByLabel('密码', { exact: true }).fill('new-browser-password');
    await other.getByRole('button', { name: '登录', exact: true }).click();
    await other.waitForURL('**/projects');
    await other.getByRole('link', { name: '账号管理' }).click();
    await other.getByRole('button', { name: '退出登录', exact: true }).click();
    await other.waitForURL('**/projects');
    await other.getByRole('link', { name: '登录 / 注册' }).waitFor();
  } finally { await browser?.close(); await app.close(); await rm(dir, { recursive: true, force: true }); }
});
