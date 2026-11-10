// 在真实 Chrome 中验证实验页面；受控 Cloud API 明确标记，不消耗真实额度。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { startQcaLab } from '../dev/qca-lab.ts';

test('QCA 实验页面：一次提交、关闭页面、恢复同一任务并试玩保存的候选', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'myol-qca-'));
  const lab = await startQcaLab({ directory: dir, autoComplete: false });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await page.goto(lab.origin + '/account');
    await page.getByRole('button', { name: '没有账号，去注册' }).click();
    await page.getByLabel('邮箱', { exact: true }).fill('fixture@example.invalid');
    await page.getByLabel('密码', { exact: true }).fill('synthetic-password');
    await page.getByLabel('确认密码', { exact: true }).fill('synthetic-password');
    await page.getByRole('button', { name: '注册并登录' }).click();
    await page.waitForURL('**/m0');
    await page.getByRole('link', { name: '新路线实验', exact: true }).click();
    await page.getByText(/本地受控接口演示，不调用真实模型/).waitFor();
    await page.getByRole('button', { name: '开始实验', exact: true }).click();
    await page.getByRole('heading', { name: '状态：云端运行中', exact: true }).waitFor();
    await page.close();
    lab.cloud.completeAll();
    const reopened = await context.newPage();
    await reopened.goto(lab.origin + '/experiments/qca');
    await reopened.getByRole('heading', { name: '状态：结果已保存', exact: true }).waitFor();
    await reopened.getByRole('button', { name: '试玩候选 HTML（未验收）', exact: true }).click();
    await reopened.frameLocator('iframe[title="实验候选试玩"]').locator('canvas').waitFor();
    assert.equal(lab.cloud.calls.filter(c => c.method === 'POST' && c.path.endsWith('/events')).length, 1);
    assert.equal(lab.db.tables.get('myol_qca_jobs')!.length, 1);
    await reopened.reload();
    await reopened.getByRole('heading', { name: '状态：结果已保存', exact: true }).waitFor();
    assert.equal(lab.cloud.calls.filter(c => c.method === 'POST' && c.path.endsWith('/events')).length, 1);
  } finally { await browser.close(); await lab.close(); await rm(dir, { recursive: true, force: true }); }
});

test('已有 Cookie 但页面误判未登录时，登录冲突会同步真实身份且不重发密码', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'myol-qca-session-'));
  const lab = await startQcaLab({ directory: dir });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const registered = await context.request.post(lab.origin + '/functions/v1/app/api/auth/register', {
      headers: { origin: lab.origin }, data: { email: 'session@example.invalid', password: 'synthetic-session-password' },
    });
    assert.equal(registered.status(), 201);
    const page = await context.newPage();
    const anonymous = { enabled: true, kind: 'email', cloudM0: true, qcaExperiment: true, account: null };
    let stale = true, loginCalls = 0;
    // 模拟页面初始化读到旧匿名状态，服务端仍持有有效会话的真实故障条件。
    await page.route('**/functions/v1/app/api/account', route => route.fulfill({ json: anonymous }));
    await page.route('**/functions/v1/app/api/account/status', route => stale ? route.fulfill({ json: anonymous }) : route.continue());
    await page.route('**/functions/v1/app/api/account/login', route => { stale = false; loginCalls++; return route.continue(); });
    await page.goto(lab.origin + '/account');
    await page.getByLabel('邮箱', { exact: true }).fill('session@example.invalid');
    await page.getByLabel('密码', { exact: true }).fill('synthetic-session-password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByRole('heading', { name: '账号管理', exact: true }).waitFor();
    await page.getByText('已恢复当前登录状态；如需切换账号，请先退出。', { exact: true }).waitFor();
    assert.equal(loginCalls, 1);
    await page.getByRole('button', { name: '刷新登录状态', exact: true }).click();
    await page.getByRole('heading', { name: '账号管理', exact: true }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: '账号管理', exact: true }).waitFor();
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await page.waitForURL('**/m0');
    await page.getByText('请先登录邮箱账号再创建任务。', { exact: true }).waitFor();
    assert.equal(loginCalls, 1);
  } finally { await browser.close(); await lab.close(); await rm(dir, { recursive: true, force: true }); }
});
