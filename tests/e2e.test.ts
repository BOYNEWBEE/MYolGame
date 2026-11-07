import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type BrowserContext, type Frame, type Page } from 'playwright-core';
import { mkdtempSync, rmSync, existsSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalServer } from '../dev/local-server.ts';

const CHROME_PATH = '/usr/bin/google-chrome';
const rootDir = fileURLToPath(new URL('..', import.meta.url));
const distDir = join(rootDir, 'web', 'dist');

// 通过浏览器上下文 addInitScript 注入 Canvas 观测脚本，不修改产品代码。
// 记录 fillText HUD、fillRect/strokeRect 画面、arc 图形与路径操作，用于断言游戏真实渲染。
const CANVAS_OBSERVER_SCRIPT = `
(() => {
  if (window.__myolObserver) return;
  const logs = [];
  const wrap = (name, type) => {
    const proto = CanvasRenderingContext2D.prototype;
    const orig = proto[name];
    proto[name] = function (...args) {
      logs.push({ type, args });
      return orig.apply(this, args);
    };
  };
  wrap('fillText', 'text');
  wrap('fillRect', 'rect');
  wrap('strokeRect', 'rect');
  wrap('arc', 'arc');
  wrap('beginPath', 'path');
  window.__myolObserver = {
    logs,
    clear: () => { logs.length = 0; },
    getTexts: () => logs.filter(l => l.type === 'text').map(l => String(l.args[0])),
    count: () => ({
      text: logs.filter(l => l.type === 'text').length,
      rect: logs.filter(l => l.type === 'rect').length,
      arc: logs.filter(l => l.type === 'arc').length,
      path: logs.filter(l => l.type === 'path').length,
    }),
  };
})();
`;

interface ErrorBucket {
  messages: string[];
}

function watchErrors(context: BrowserContext): ErrorBucket {
  const bucket: ErrorBucket = { messages: [] };
  context.on('weberror', (webError) => bucket.messages.push(webError.error().message));
  return bucket;
}

async function getGameFrame(page: Page): Promise<Frame> {
  // iframe 加载的是 /api/games/:id/play，通过 URL 片段匹配实际 Frame 对象
  await page.frameLocator('iframe').first().locator('canvas#game').waitFor();
  const frame = page.frames().find((f) => f.url().includes('/play'));
  if (!frame) throw new Error('未找到游戏 iframe 的 Frame 对象');
  // 等待 iframe 内脚本初始化一帧
  await frame.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return frame;
}

async function openGameDetail(context: BrowserContext, serverUrl: string, title: string) {
  const page = await context.newPage();
  const errors = watchErrors(context);
  await page.goto(serverUrl + '/');
  await page.getByRole('heading', { name: '一句话，做出能玩的网页小游戏' }).waitFor();
  const card = page.locator('article.game-card').filter({ hasText: title });
  await card.locator('h3 a').click();
  await page.waitForURL('**/games/**');
  await page.getByRole('heading', { name: title }).first().waitFor();
  const iframe = await getGameFrame(page);
  return { page, iframe, errors };
}

async function getObservedTexts(iframe: Frame): Promise<string[]> {
  return iframe.evaluate(() => (window as unknown as { __myolObserver: { getTexts: () => string[] } }).__myolObserver.getTexts());
}

async function clearObserver(iframe: Frame): Promise<void> {
  await iframe.evaluate(() => (window as unknown as { __myolObserver: { clear: () => void } }).__myolObserver.clear());
}

async function observedCounts(iframe: Frame): Promise<{ text: number; rect: number; arc: number; path: number }> {
  return iframe.evaluate(() => (window as unknown as { __myolObserver: { count: () => { text: number; rect: number; arc: number; path: number } } }).__myolObserver.count());
}

async function gameInput(page: Page, iframe: Frame, sequence: string[], delayMs = 80): Promise<void> {
  const canvas = iframe.locator('canvas#game');
  await canvas.focus();
  for (const key of sequence) {
    await page.keyboard.press(key);
    await new Promise((r) => setTimeout(r, delayMs));
  }
}

function assertNoErrors(errors: ErrorBucket, label: string): void {
  assert.deepEqual(errors.messages, [], label + ' 不应抛出页面错误');
}

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

  test('霓虹打砖块：空格发射、方向键移动、R 重启并渲染 HUD', async () => {
    const context = await browser.newContext();
    await context.addInitScript(CANVAS_OBSERVER_SCRIPT);
    const { page, iframe, errors } = await openGameDetail(context, server.url, '霓虹打砖块');
    try {
      // 初始准备画面应显示标题与操作提示
      const readyTexts = await getObservedTexts(iframe);
      assert.ok(readyTexts.some((t) => t.includes('霓虹打砖块')), '准备画面应绘制游戏标题');
      assert.ok(readyTexts.some((t) => t.includes('空格发射')), '准备画面应提示空格发射');

      await clearObserver(iframe);
      await gameInput(page, iframe, ['Space']);
      await new Promise((r) => setTimeout(r, 600));

      // 发射后进入游戏，应持续绘制得分、关卡、生命 HUD 以及砖块/挡板/小球
      const playTexts = await getObservedTexts(iframe);
      assert.ok(playTexts.some((t) => /^得分\s+\d+$/.test(t)), '游戏中应绘制得分 HUD');
      assert.ok(playTexts.some((t) => /^第\s+\d+\s+关$/.test(t)), '游戏中应绘制关卡 HUD');
      assert.ok(playTexts.some((t) => /^生命\s+\d+$/.test(t)), '游戏中应绘制生命 HUD');
      const playCounts = await observedCounts(iframe);
      assert.ok(playCounts.rect > 10, '游戏画面应包含大量 rect 绘制');
      assert.ok(playCounts.arc > 0, '游戏画面应包含小球 arc 绘制');

      // 方向键移动挡板不应报错
      await clearObserver(iframe);
      await gameInput(page, iframe, ['ArrowLeft', 'ArrowLeft', 'ArrowRight', 'r']);
      await new Promise((r) => setTimeout(r, 400));
      const restartCounts = await observedCounts(iframe);
      assert.ok(restartCounts.text > 0, 'R 重启后仍应继续渲染 HUD');
      assertNoErrors(errors, '打砖块试玩过程');
    } finally {
      await page.close();
      await context.close();
    }
  });

  test('复古像素贪吃蛇：空格开始、方向键转向、R 重启并渲染 HUD', async () => {
    const context = await browser.newContext();
    await context.addInitScript(CANVAS_OBSERVER_SCRIPT);
    const { page, iframe, errors } = await openGameDetail(context, server.url, '复古像素贪吃蛇');
    try {
      const readyTexts = await getObservedTexts(iframe);
      assert.ok(readyTexts.some((t) => t.includes('复古像素贪吃蛇')), '准备画面应绘制游戏标题');

      await clearObserver(iframe);
      await gameInput(page, iframe, ['Space']);
      await new Promise((r) => setTimeout(r, 600));

      const playTexts = await getObservedTexts(iframe);
      assert.ok(playTexts.some((t) => /^得分\s+\d+$/.test(t)), '游戏中应绘制得分 HUD');
      assert.ok(playTexts.some((t) => /^长度\s+\d+/.test(t)), '游戏中应绘制长度 HUD');
      assert.ok(playTexts.some((t) => /^最高\s+\d+$/.test(t)), '游戏中应绘制最高分 HUD');
      const playCounts = await observedCounts(iframe);
      assert.ok(playCounts.rect > 5, '游戏画面应包含蛇身与食物 rect/arc 绘制');

      // 转向并快速重启，不应报错
      await clearObserver(iframe);
      await gameInput(page, iframe, ['ArrowUp', 'ArrowLeft', 'ArrowRight', 'r']);
      await new Promise((r) => setTimeout(r, 400));
      const restartTexts = await getObservedTexts(iframe);
      assert.ok(restartTexts.some((t) => /^得分\s+\d+$/.test(t)), 'R 重启后应继续绘制得分 HUD');
      assertNoErrors(errors, '贪吃蛇试玩过程');
    } finally {
      await page.close();
      await context.close();
    }
  });

  test('星空星际射击：空格开始、方向键移动射击、R 重启并渲染 HUD', async () => {
    const context = await browser.newContext();
    await context.addInitScript(CANVAS_OBSERVER_SCRIPT);
    const { page, iframe, errors } = await openGameDetail(context, server.url, '星空星际射击');
    try {
      const readyTexts = await getObservedTexts(iframe);
      assert.ok(readyTexts.some((t) => t.includes('星空星际射击')), '准备画面应绘制游戏标题');

      await clearObserver(iframe);
      await gameInput(page, iframe, ['Space']);
      await new Promise((r) => setTimeout(r, 600));

      const playTexts = await getObservedTexts(iframe);
      assert.ok(playTexts.some((t) => /^得分\s+\d+$/.test(t)), '游戏中应绘制得分 HUD');
      assert.ok(playTexts.some((t) => /^波次\s+\d+$/.test(t)), '游戏中应绘制波次 HUD');
      const playCounts = await observedCounts(iframe);
      assert.ok(playCounts.rect > 5, '游戏画面应包含子弹/敌机/星星/HUD 背景 rect 绘制');

      // 移动 + 射击 + 重启
      await clearObserver(iframe);
      await gameInput(page, iframe, ['ArrowLeft', 'ArrowUp', 'Space', 'ArrowRight', 'r']);
      await new Promise((r) => setTimeout(r, 500));
      const restartTexts = await getObservedTexts(iframe);
      assert.ok(restartTexts.some((t) => /^得分\s+\d+$/.test(t)), 'R 重启后应继续绘制得分 HUD');
      assertNoErrors(errors, '太空射击试玩过程');
    } finally {
      await page.close();
      await context.close();
    }
  });

  test('完整创作与发布链路：提示词修改规格并回退恢复', async () => {
    const creator = await browser.newContext();
    const page = await creator.newPage();
    let gameId = '';
    let projectId = '';

    try {
      // 1. 创建游戏
      await page.goto(server.url + '/create');
      await page.getByRole('heading', { name: '创作新游戏' }).waitFor();
      await page.getByLabel('需求提示词').fill('《糖果快打》：糖果主题打砖块，快速，宽挡板');
      await page.getByRole('group', { name: '背景音乐' }).getByRole('button', { name: '霓虹街机' }).click();
      await page.getByRole('button', { name: '生成游戏并进入工作台' }).click();
      await page.waitForURL('**/projects/**');
      const projectUrl = page.url();
      projectId = projectUrl.split('/').pop() ?? '';
      await page.getByRole('heading').first().waitFor();
      await page.frameLocator('.sandbox-frame iframe').getByRole('button', { name: '开启声音' }).waitFor();

      // 验证 v1 实际规格值
      const v1Spec = await page.locator('.preview-spec .badges').textContent();
      assert.ok(v1Spec?.includes('打砖块'), 'v1 应为打砖块模板');
      assert.ok(v1Spec?.includes('糖果'), 'v1 应为糖果主题');
      assert.ok(v1Spec?.includes('宽挡板'), 'v1 应启用宽挡板选项');
      assert.ok(v1Spec?.includes('1.4x'), 'v1 速度应因“快速”提示词提升为 1.4x');

      // 2. 在工作台生成新版本（修改参数）
      await page.getByPlaceholder('提出修改需求').fill('把速度改成极速，加一条命');
      await page.getByRole('button', { name: '生成新版本' }).click();
      await page.getByRole('status').filter({ hasText: /已生成/ }).waitFor({ timeout: 15000 });

      // 验证 v2 实际规格值
      const v2Spec = await page.locator('.preview-spec').textContent();
      assert.ok(v2Spec?.includes('霓虹街机'), '生成新版本应保留选定的配乐');
      assert.ok(v2Spec?.includes('额外生命') || v2Spec?.includes('宽挡板'), 'v2 应保留或新增玩法选项');
      const speedMatch = v2Spec?.match(/(\d+(?:\.\d+)?)x/);
      assert.ok(speedMatch, 'v2 应显示速度倍率');
      const v2Speed = parseFloat(speedMatch![1]!);
      assert.ok(v2Speed >= 1.6, 'v2 速度应因“极速”提示词达到较高倍率');

      // 3. 回退到 v1
      const v1Row = page.locator('ol.version-list li').filter({ hasText: 'v1' });
      await v1Row.getByRole('button', { name: '回退到此版本' }).click();
      await page.getByRole('status').filter({ hasText: /已回退/ }).waitFor();

      // 验证回退后恢复 v1 规格
      const restoredSpec = await page.locator('.preview-spec').textContent();
      assert.ok(restoredSpec?.includes('打砖块'), '回退后应为打砖块模板');
      assert.ok(!restoredSpec?.includes('额外生命'), '回退后不应保留 v2 的额外生命');
      const restoredSpeedMatch = restoredSpec?.match(/(\d+(?:\.\d+)?)x/);
      assert.ok(restoredSpeedMatch, '回退后应显示速度倍率');
      const restoredSpeed = parseFloat(restoredSpeedMatch![1]!);
      assert.ok(restoredSpeed < v2Speed, '回退后速度应低于 v2 的极速');

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
