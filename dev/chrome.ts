// 统一的浏览器路径解析：优先管理员指定的 MYOLGAME_CHROME_PATH，再按平台查找常见安装位置。
// 本地服务、Worker 与测试都复用这一逻辑，避免写死 POSIX 路径。

import { existsSync } from 'node:fs';

export interface ChromeEnv {
  MYOLGAME_CHROME_PATH?: string;
}

const CANDIDATES: Record<string, string[]> = {
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ],
};

export function chromeCandidates(platform: NodeJS.Platform = process.platform, env: ChromeEnv = process.env): string[] {
  const configured = env.MYOLGAME_CHROME_PATH?.trim();
  if (configured) return [configured];
  const localAppData = process.env.LOCALAPPDATA;
  const extra = platform === 'win32' && localAppData
    ? [localAppData + '\\Google\\Chrome\\Application\\chrome.exe', localAppData + '\\Microsoft\\Edge\\Application\\msedge.exe']
    : [];
  return [...(CANDIDATES[platform] ?? CANDIDATES.linux!), ...extra];
}

export function resolveChromePath(env: ChromeEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  const candidates = chromeCandidates(platform, env);
  const configured = Boolean(env.MYOLGAME_CHROME_PATH?.trim());
  const found = candidates.find((candidate) => candidate && existsSync(candidate));
  if (found) return found;
  if (configured) {
    throw new Error('MYOLGAME_CHROME_PATH 指向的浏览器不存在：' + candidates[0]);
  }
  throw new Error('未找到 Chrome/Chromium。请安装浏览器，或用 MYOLGAME_CHROME_PATH 指定可执行文件路径');
}