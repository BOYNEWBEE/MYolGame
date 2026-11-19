// 跨平台的环境变量包装脚本，替代 package.json 里的 POSIX `KEY=value command` 写法。
// 用法：node dev/with-env.ts KEY=VALUE ... -- <命令> [参数...]
// 例：node dev/with-env.ts MYOLGAME_AGENT_PROVIDER=openai node dev/run-dev.ts

import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const separator = args.indexOf('--');
if (separator < 0 || separator === args.length - 1) {
  console.error('用法：node dev/with-env.ts KEY=VALUE ... -- <命令> [参数...]');
  process.exit(2);
}

const assignments = args.slice(0, separator);
const command = args.slice(separator + 1);
const vars: Record<string, string> = {};
for (const item of assignments) {
  const index = item.indexOf('=');
  if (index <= 0) {
    console.error('环境变量格式错误：' + item);
    process.exit(2);
  }
  vars[item.slice(0, index)] = item.slice(index + 1);
}

const [name, ...rest] = command;
let executable = name!;
let shell = false;
if (name === 'node') {
  executable = process.execPath;
} else if (process.platform === 'win32' && (name === 'npm' || name!.endsWith('.cmd') || name!.endsWith('.bat'))) {
  executable = name === 'npm' ? 'npm.cmd' : name!;
  shell = true;
}

const child = spawn(executable, rest, {
  stdio: 'inherit',
  shell,
  env: { ...process.env, ...vars },
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => child.kill(signal));
}
child.on('error', (error) => {
  console.error('无法启动命令：' + error.message);
  process.exit(1);
});
child.on('close', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});