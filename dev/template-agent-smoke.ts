// 仅在明确允许发送示例源码后，使用临时数据执行真实 Qoder 模板联调。
import assert from 'node:assert/strict';
import { mkdtemp, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore } from './store_file.ts';
import { startLocalServer } from './local-server.ts';
import { resolveChromePath } from './chrome.ts';
import { runTemplateSeed } from './template-seed.ts';
import type { Project, TaskRecord } from '../functions/store.ts';

if (!process.argv.includes('--allow-external-source')) {
  throw new Error('此脚本会向 Qoder 发送内置贪吃蛇示例源码和下方固定需求；确认允许后添加 --allow-external-source。');
}
const dir = await mkdtemp(join(tmpdir(), 'myol-template-qoder-'));
const store = new FileStore(join(dir, 'db.json'));
const app = await startLocalServer({ port: 0, store, seed: false, sandboxDir: join(dir, 'sandboxes'),
  agent: { provider: 'qoder', name: 'Qoder CLI', timeoutMs: 180000, maxAttempts: 2, chromePath: resolveChromePath() } });
let token = '';
async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(app.url + '/api' + path, { method,
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error('模板联调 HTTP ' + response.status + '：' + JSON.stringify(data));
  return data as T;
}
try {
  await runTemplateSeed(store);
  token = (await api<{ token: string }>('/session', 'POST', { nickname: '模板联调' })).token;
  const result = await api<{ project: Project; task: TaskRecord }>('/templates/930dff10-6e09-4000-8000-000000000002/use', 'POST', {
    mode: 'customize', values: { pace: '轻松', palette: '深海' },
    extraPrompt: '保留示例贪吃蛇核心规则和方向键、空格、R 操作。将页面标题和可见游戏名称设为“深海慢行”。',
  });
  let count = 0;
  const deadline = Date.now() + 200000;
  while (Date.now() < deadline) {
    const { task } = await api<{ task: TaskRecord }>('/projects/' + result.project.id + '/tasks/' + result.task.id);
    for (const stage of task.stages.slice(count)) console.log(stage.name);
    count = task.stages.length;
    if (task.finishedAt) {
      assert.equal(task.status, 'succeeded', task.error || 'Agent 未完成');
      const version = (await store.getVersion(task.versionId!))!;
      assert.equal(version.templateOrigin?.templateId, '930dff10-6e09-4000-8000-000000000002');
      assert.match(version.html, /深海慢行/);
      assert.match(version.html, /MYOLGAME_ATTRIBUTION/);
      assert.equal(version.checks?.browser, 'passed');
      await copyFile(join(dir, 'sandboxes', task.id, 'preview.png'), '/tmp/myol-template-qoder-smoke.png');
      console.log('真实 Qoder 模板联调通过；检查截图：/tmp/myol-template-qoder-smoke.png');
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.equal((await store.getTask(result.task.id))?.status, 'succeeded', '真实 Qoder 模板联调超时');
} finally {
  await app.close();
  await rm(dir, { recursive: true, force: true });
}
