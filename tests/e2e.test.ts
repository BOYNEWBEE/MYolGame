import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { mkdtempSync, rmSync, existsSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalServer } from '../dev/local-server.ts';

const CHROME_PATH = '/usr/bin/google-chrome';
const rootDir = fileURLToPath(new URL('..', import.meta.url));
const distDir = join(rootDir, 'web', 'dist');

describe('浏览器端到端测试', () => {
  let server: Awaited<ReturnType<typeof startLocalServer>>;
  let dataDir: string;
  let browser: Browser;

  before(async () => {
    if (!existsSync(join(distDir, 'index.html'))) {
      throw new Error('web/dist/index.html 不存在，请先运行 npm run build');
    }
    dataDir = mkdtempSync(join(tmpdir(), 'myol-e2e-'));
    server = await startLocalServer({
      port: 0,
      dataFile: join(dataDir, 'db.json'),
      distDir,
      seed: true,
    });
    browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  });

  after(async () => {
    await browser?.close();
    await server?.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  test('首页可浏览并进入官方游戏详情', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(server.url + '/');
      await page.getByRole('heading', { name: '一句话，做出能玩的网页小游戏' }).waitFor();
      // 官方示例列表应非空
      const cards = page.locator('article.game-card');
      await cards.first().waitFor();
      const title = await cards.first().locator('h3').textContent();
      await cards.first().click();
      await page.waitForURL('**/games/**');
      await page.getByRole('heading', { name: title ?? '' }).first().waitFor();
      const iframe = page.frameLocator('iframe').first();
      await iframe.locator('canvas#game').waitFor();
    } finally {
      await context.close();
    }
  });

  test('完整创作与发布链路', async () => {
    const creator = await browser.newContext();
    const page = await creator.newPage();
    let gameId = '';
    let projectId = '';

    try {
      // 1. 创建游戏
      await page.goto(server.url + '/create');
      await page.getByRole('heading', { name: '创作新游戏' }).waitFor();
      await page.getByLabel('需求提示词').fill('《糖果快打》：糖果主题打砖块，快速，宽挡板');
      await page.getByRole('button', { name: '生成游戏并进入工作台' }).click();
      await page.waitForURL('**/projects/**');
      const projectUrl = page.url();
      projectId = projectUrl.split('/').pop() ?? '';
      await page.getByRole('heading').first().waitFor();

      // 2. 在工作台生成新版本（修改参数）
      await page.getByPlaceholder('提出修改需求').fill('把速度改成极速，加一条命');
      await page.getByRole('button', { name: '生成新版本' }).click();
      await page.getByRole('status').filter({ hasText: /已生成/ }).waitFor({ timeout: 15000 });

      // 3. 回退到 v1
      const v1Row = page.locator('ol.version-list li').filter({ hasText: 'v1' });
      await v1Row.getByRole('button', { name: '回退到此版本' }).click();
      await page.getByRole('status').filter({ hasText: /已回退/ }).waitFor();

      // 4. 下载当前版本的源码包 ZIP
      const [zipDownload] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: '下载源码包（ZIP）' }).click(),
      ]);
      const zipPath = await zipDownload.path();
      assert.ok(zipPath);
      assert.ok(statSync(zipPath).size > 100);

      // 5. 发布到社区
      await page.getByRole('button', { name: '发布到社区（绑定当前版本）' }).click();
      await page.getByRole('status').filter({ hasText: /已发布/ }).waitFor({ timeout: 15000 });

      // 6. 获取社区游戏 ID
      const communityHref = await page.getByRole('link', { name: '查看社区页面' }).getAttribute('href');
      gameId = communityHref?.split('/').pop() ?? '';
      assert.ok(gameId);
    } finally {
      await creator.close();
    }

    // 7. 第二个独立浏览器会话：浏览、试玩、收藏、下载 HTML
    const visitor = await browser.newContext();
    const vPage = await visitor.newPage();
    try {
      await vPage.goto(server.url + '/games/' + gameId);
      await vPage.getByRole('heading').first().waitFor();
      const iframe = vPage.frameLocator('iframe').first();
      await iframe.locator('canvas#game').waitFor();

      // 收藏
      await vPage.getByRole('button', { name: /收藏/ }).click();
      await vPage.getByRole('button', { name: /已收藏/ }).waitFor();

      // 下载 HTML
      const [htmlDownload] = await Promise.all([
        vPage.waitForEvent('download'),
        vPage.getByRole('link', { name: '下载 HTML' }).click(),
      ]);
      const htmlPath = await htmlDownload.path();
      assert.ok(htmlPath);
      assert.ok(statSync(htmlPath).size > 500);
      const htmlText = readFileSync(htmlPath!, 'utf8');
      assert.ok(htmlText.includes('<canvas') && htmlText.includes('const CFG ='));
    } finally {
      await visitor.close();
    }

    // 8. 第二个会话无法访问私有项目
    const intruder = await browser.newContext();
    const iPage = await intruder.newPage();
    try {
      await iPage.goto(server.url + '/projects/' + projectId);
      await iPage.getByRole('heading', { name: /无法打开工作台/ }).waitFor({ timeout: 5000 });
    } finally {
      await intruder.close();
    }
  });
});
