// 在独立 Chrome 沙箱与无凭据上下文中执行游戏；阻止网络、弹窗、下载与外部导航。
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import { GAME_CSP, validateArtifact } from '../../functions/shared/artifact.ts';
import type { ArtifactChecks } from '../../functions/store.ts';
import { BrowserUnavailableError, errorMessage } from './errors.ts';

export async function checkGame(html: string, chromePath: string, screenshotPath: string): Promise<ArtifactChecks> {
  // 产物问题可由模型修复；浏览器无法启动属于基础设施问题，不应继续请求模型。
  validateArtifact(html);
  let browser: Browser;
  try {
    browser = await chromium.launch({
      executablePath: chromePath, headless: true, chromiumSandbox: true,
      args: ['--disable-dev-shm-usage', '--js-flags=--max-old-space-size=128'],
    });
  } catch (error) {
    throw new BrowserUnavailableError('浏览器检查启动失败：' + errorMessage(error, '未知错误', 200));
  }
  let context: BrowserContext;
  try {
    context = await browser.newContext({
      viewport: { width: 960, height: 720 }, serviceWorkers: 'block', acceptDownloads: false,
    });
  } catch (error) {
    await browser.close();
    throw new BrowserUnavailableError('浏览器检查环境创建失败：' + errorMessage(error, '未知错误', 200));
  }
  try {
    const errors: string[] = [];
    const url = 'https://myolgame.invalid/index.html';
    let served = false;
    await context.route('**/*', async (route) => {
      if (!served && route.request().url() === url && route.request().isNavigationRequest()) {
        served = true;
        await route.fulfill({ status: 200, contentType: 'text/html',
          headers: { 'content-security-policy': GAME_CSP }, body: html });
      } else {
        errors.push('游戏尝试访问外部资源或导航');
        await route.abort();
      }
    });
    context.on('page', (popup) => { if (context.pages().length > 1) void popup.close(); });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    page.on('pageerror', () => errors.push('游戏脚本运行出错'));
    page.on('console', (message) => { if (message.type() === 'error') errors.push('游戏控制台报错'); });
    await page.goto(url, { waitUntil: 'load', timeout: 10000 });
    await page.locator('canvas').first().waitFor({ state: 'visible' });
    // 游戏提供状态与重启接口，仅用于烟测；不把模型声明当作玩法验收结论。
    const state = () => page.evaluate(() => {
      const hook = (window as unknown as { __MYOLGAME_TEST__?: { getState(): unknown } }).__MYOLGAME_TEST__;
      if (!hook || typeof hook.getState !== 'function') throw new Error('缺少游戏状态检查接口');
      return JSON.stringify(hook.getState());
    });
    await state();
    const canvas = await page.locator('canvas').first().evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      const pixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
      if (!pixels || canvas.width < 100 || canvas.height < 100) return false;
      const colors = new Set<number>();
      for (let i = 0; i < pixels.length; i += 16) colors.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
      return colors.size > 2;
    });
    if (!canvas) throw new Error('画布为空或未绘制有效画面');
    const before = await state();
    await page.keyboard.press('Space');
    for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
      await page.keyboard.press(key);
    }
    await page.waitForTimeout(200);
    const after = await state();
    if (before === after) throw new Error('按键后游戏状态未变化');
    await page.evaluate(() => {
      const hook = (window as unknown as { __MYOLGAME_TEST__: { reset(): void } }).__MYOLGAME_TEST__;
      if (typeof hook.reset !== 'function') throw new Error('缺少重启接口');
      hook.reset();
    });
    const reset = await state();
    if (reset !== before) throw new Error('重启后未恢复初始状态');
    await page.setViewportSize({ width: 400, height: 360 });
    const bounds = await page.locator('canvas').first().boundingBox();
    if (!bounds || bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > 401 || bounds.y + bounds.height > 361) {
      throw new Error('小视口中画布被裁切，请为 400×360 视口调整响应式布局');
    }
    await page.waitForTimeout(150);
    if (errors.length) throw new Error([...new Set(errors)].join('；'));
    const screenshot = await page.screenshot({ timeout: 5000 });
    await writeFile(screenshotPath, screenshot);
    return { browser: 'passed', canvas: true, input: true, restart: true,
      screenshotHash: createHash('sha256').update(screenshot).digest('hex'), checkedAt: new Date().toISOString() };
  } finally { await browser.close(); }
}
