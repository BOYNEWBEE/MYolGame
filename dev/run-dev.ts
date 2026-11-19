// 一键启动本地开发：API 服务 (8787) + Vite 前端 (5173，代理 /functions 到 API)。

import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { killChildTree, npmSpawnSpec } from './platform.ts';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const children: ChildProcess[] = [];
const npm = npmSpawnSpec();

function pipe(child: ChildProcess, prefix: string): void {
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (data: string) => {
    for (const line of data.trimEnd().split('\n')) console.log(prefix + ' ' + line);
  });
  child.stderr?.on('data', (data: string) => {
    for (const line of data.trimEnd().split('\n')) console.error(prefix + ' ' + line);
  });
}

const api = spawn(process.execPath, ['dev/local-server.ts'], { cwd: rootDir });
pipe(api, '[api]');
children.push(api);

const web = spawn(npm.command, ['--prefix', 'web', 'run', 'dev'], {
  cwd: rootDir,
  // Windows 的 npm.cmd 需要 shell；POSIX 保持原有直接启动。
  shell: npm.shell,
});
pipe(web, '[web]');
children.push(web);

let stopping = false;
function shutdown(): void {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    killChildTree(child);
  }
  // 等待 API 记录取消并清理 Worker，避免父进程提前退出留下后台任务。
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

for (const child of children) {
  child.on('exit', (code) => {
    console.error('子进程退出（code=' + code + '），停止全部服务');
    shutdown();
  });
}
