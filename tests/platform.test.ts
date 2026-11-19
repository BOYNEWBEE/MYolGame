// Windows 启动兼容、浏览器路径解析与本地数据文件保护回归。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromeCandidates, resolveChromePath } from '../dev/chrome.ts';
import { npmSpawnSpec } from '../dev/platform.ts';
import { FileStore } from '../dev/store_file.ts';

const rootDir = fileURLToPath(new URL('..', import.meta.url));

test('浏览器路径优先环境变量，并按平台提供候选，找不到时明确报错', () => {
  assert.deepEqual(chromeCandidates('win32', { MYOLGAME_CHROME_PATH: 'C:\\custom\\chrome.exe' }), ['C:\\custom\\chrome.exe']);
  const win = chromeCandidates('win32', {});
  assert.ok(win.some((path) => path.includes('Google\\Chrome')));
  assert.ok(win.some((path) => path.includes('msedge.exe')));
  const linux = chromeCandidates('linux', {});
  assert.ok(linux.includes('/usr/bin/google-chrome'));
  assert.equal(resolveChromePath({ MYOLGAME_CHROME_PATH: process.execPath }, process.platform), process.execPath);
  assert.throws(
    () => resolveChromePath({ MYOLGAME_CHROME_PATH: join(tmpdir(), 'definitely-missing-chrome') }, process.platform),
    /MYOLGAME_CHROME_PATH 指向的浏览器不存在/,
  );
});

test('npm 启动在 Windows 使用 npm.cmd 与 shell，在 POSIX 直接启动', () => {
  assert.deepEqual(npmSpawnSpec('win32'), { command: 'npm.cmd', shell: true });
  assert.deepEqual(npmSpawnSpec('linux'), { command: 'npm', shell: false });
  assert.deepEqual(npmSpawnSpec('darwin'), { command: 'npm', shell: false });
});

test('with-env 包装器跨平台传递环境变量且不改写其他变量', () => {
  const result = spawnSync(process.execPath, [
    join(rootDir, 'dev', 'with-env.ts'),
    'MYOL_TEST_VALUE=跨平台值',
    '--',
    'node',
    '-e',
    'process.stdout.write((process.env.MYOL_TEST_VALUE ?? "missing") + "|" + (process.env.MYOL_OTHER ?? "none"))',
  ], { cwd: rootDir, encoding: 'utf8', env: { ...process.env, MYOL_OTHER: 'kept' } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '跨平台值|kept');
});

test('数据文件损坏时停止启动并保持原文件字节不变', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'myol-store-corrupt-'));
  try {
    const cases: { name: string; content: string; pattern: RegExp }[] = [
      { name: '非法 JSON', content: '{"accounts": [', pattern: /不是合法 JSON/ },
      { name: '数组根节点', content: '[]', pattern: /结构无效/ },
      { name: '字段类型错误', content: '{"projects": {}}', pattern: /字段 projects 不是数组/ },
    ];
    for (const item of cases) {
      const filePath = join(dir, item.name + '.json');
      writeFileSync(filePath, item.content, 'utf8');
      const store = new FileStore(filePath);
      await assert.rejects(store.init(), item.pattern, item.name);
      assert.equal(readFileSync(filePath, 'utf8'), item.content, item.name + ' 原文件不能被覆盖');
    }

    const missing = join(dir, 'nested', 'db.json');
    const created = new FileStore(missing);
    await created.init();
    assert.match(readFileSync(missing, 'utf8'), /"accounts":\[\]/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('成功读取的数据文件不会被重写', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'myol-store-keep-'));
  try {
    const filePath = join(dir, 'db.json');
    const content = JSON.stringify({ accounts: [], sessions: [], projects: [] });
    writeFileSync(filePath, content, 'utf8');
    const store = new FileStore(filePath);
    await store.init();
    assert.equal(readFileSync(filePath, 'utf8'), content);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});