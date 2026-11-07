// 一键启动本地开发：API 服务 (8787) + Vite 前端 (5173，代理 /functions 到 API)。

import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const children: ChildProcess[] = [];

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

const web = spawn('npm', ['--prefix', 'web', 'run', 'dev'], { cwd: rootDir, shell: false });
pipe(web, '[web]');
children.push(web);

function shutdown(): void {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

for (const child of children) {
  child.on('exit', (code) => {
    console.error('子进程退出（code=' + code + '），停止全部服务');
    shutdown();
  });
}
