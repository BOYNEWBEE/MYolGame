// 跨平台子进程工具：npm 启动方式与整组清理。
// Windows 的 npm 是 .cmd，需通过 shell 启动；进程树用 taskkill 结束。

import { spawn, type ChildProcess } from 'node:child_process';

export function npmSpawnSpec(platform: NodeJS.Platform = process.platform): { command: string; shell: boolean } {
  return platform === 'win32' ? { command: 'npm.cmd', shell: true } : { command: 'npm', shell: false };
}

export function killChildTree(child: ChildProcess, platform: NodeJS.Platform = process.platform, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (child.exitCode !== null || !child.pid) return;
  if (platform === 'win32') {
    try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* 进程已退出 */ }
    return;
  }
  try { child.kill(signal); } catch { /* 进程已退出 */ }
}