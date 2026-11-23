// 受控 OpenAI 兼容假模型：验证请求格式、错误分类、源码链与密钥边界，不调用真实付费模型。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { askOpenAiModel } from '../dev/agent/openai.ts';
import { extractHtml } from '../dev/agent/provider.ts';
import { validateModelEndpoint } from '../dev/agent/config.ts';
import { resolveChromePath } from '../dev/chrome.ts';
import { startLocalServer } from '../dev/local-server.ts';
import { FileStore } from '../dev/store_file.ts';
import { defaultSpec } from '../functions/shared/spec.ts';
import type { AgentConfig } from '../dev/agent/protocol.ts';
import type { TaskRecord } from '../functions/store.ts';

const SECRET = 'sk-synthetic-provider-secret';

const gameHtml = (title: string) => `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${title}</title>
<style>*{box-sizing:border-box}body{margin:0;padding:8px;background:#0b1020;color:#e9f0ff;font-family:system-ui;text-align:center}h1{font-size:22px;margin:8px 0}canvas{width:min(100%,640px);height:auto;max-height:calc(100dvh - 100px);background:#18243d;border-radius:18px}</style></head>
<body><h1>${title}</h1><p>空格开始，方向键移动，R 重启</p><canvas width="640" height="400"></canvas>
<script>let moves=0;const c=document.querySelector('canvas'),ctx=c.getContext('2d');
function draw(){ctx.fillStyle='#18243d';ctx.fillRect(0,0,640,400);ctx.fillStyle='#6ee7ff';ctx.fillRect(80+moves*8,160,50,50);ctx.fillStyle='#ffd166';ctx.fillRect(480,160,50,50);ctx.fillStyle='white';ctx.font='20px sans-serif';ctx.fillText('Moves: '+moves,30,40)}
function reset(){moves=0;draw()}addEventListener('keydown',e=>{e.preventDefault();if(e.key==='r')reset();else{moves++;draw()}});
window.__MYOLGAME_TEST__={getState:()=>({moves}),reset};draw();</script></body></html>`;

const strictHtml = gameHtml;

// 模板未提供烟测接口；用修改片段追加一个独立按键计数钩子，供检查流程使用。
const hookEdit = {
  find: '  requestAnimationFrame(frame);\n})();',
  replace: '  requestAnimationFrame(frame);\n})();\n' + `window.__MYOLGAME_TEST__ = (function () {
  var presses = 0;
  window.addEventListener('keydown', function () { presses += 1; });
  return { getState: function () { return { presses: presses }; }, reset: function () { presses = 0; } };
})();`,
};

interface Captured {
  url: string;
  authorization: string;
  body: {
    model?: string;
    max_tokens?: number;
    stream?: boolean;
    messages?: { role: string; content: string }[];
  };
}

async function startFakeOpenAi(handler: (call: number, captured: Captured, res: import('node:http').ServerResponse) => Promise<void> | void) {
  const captures: Captured[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    const captured: Captured = {
      url: req.url ?? '',
      authorization: req.headers.authorization ?? '',
      body: raw ? JSON.parse(raw) as Captured['body'] : {},
    };
    captures.push(captured);
    await handler(captures.length, captured, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  return {
    captures,
    base,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function reply(res: import('node:http').ServerResponse, content: string, finishReason = 'stop'): void {
  if (res.destroyed) return;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: finishReason }] }));
}

function config(apiUrl: string, extra: Partial<AgentConfig> = {}): AgentConfig {
  return {
    provider: 'openai', name: '假模型', apiUrl, apiKey: SECRET, model: 'fake-game-model',
    timeoutMs: 5000, maxAttempts: 1, chromePath: process.execPath, ...extra,
  };
}

function ask(url: string, prompt = '生成', extra: Partial<AgentConfig> = {}): Promise<string> {
  const value = config(url, extra);
  return askOpenAiModel(prompt, value, value.requestTimeoutMs ?? value.timeoutMs);
}

async function errorOf(action: Promise<unknown>): Promise<{ code?: string; message?: string }> {
  return action.then(() => ({}), (error: { code?: string; message?: string }) => error);
}

test('OpenAI 请求格式正确，支持 Markdown 代码块与分段文本', async () => {
  const fake = await startFakeOpenAi((_call, _captured, res) => {
    reply(res, '```html\n' + strictHtml('代码块游戏') + '\n```');
  });
  try {
    const result = await ask(fake.base + '/v1', '生成游戏', { maxOutputTokens: 4321 });
    assert.equal(fake.captures.length, 1);
    const sent = fake.captures[0]!;
    assert.equal(sent.url, '/v1/chat/completions');
    assert.equal(sent.authorization, 'Bearer ' + SECRET);
    assert.equal(sent.body.model, 'fake-game-model');
    assert.equal(sent.body.max_tokens, 4321);
    assert.equal(sent.body.stream, false);
    assert.equal(sent.body.messages?.length, 2);
    assert.equal(sent.body.messages![0]!.role, 'system');
    assert.match(sent.body.messages![1]!.content, /生成游戏/);
    assert.match(extractHtml(result), /代码块游戏/);
  } finally { await fake.close(); }

  const segmented = await startFakeOpenAi((_call, _captured, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: [
      { type: 'text', text: strictHtml('分段游戏').slice(0, 40) },
      { type: 'text', text: strictHtml('分段游戏').slice(40) },
    ] }, finish_reason: 'stop' }] }));
  });
  try {
    const output = await ask(segmented.base + '/v1');
    assert.match(output, /分段游戏/);
  } finally { await segmented.close(); }
});

test('无路径基址仅在 404 时切换到 /v1，不重复生成', async () => {
  const fake = await startFakeOpenAi((call, captured, res) => {
    if (call === 1) {
      assert.equal(captured.url, '/chat/completions');
      res.statusCode = 404;
      res.end('missing');
      return;
    }
    assert.equal(captured.url, '/v1/chat/completions');
    reply(res, strictHtml('版本前缀游戏'));
  });
  try {
    const output = await ask(fake.base);
    assert.match(output, /版本前缀游戏/);
    assert.equal(fake.captures.length, 2);
  } finally { await fake.close(); }
});

test('401、429、空输出、截断、非法响应与超限都分类失败且不重试', async () => {
  const cases: { name: string; code: string; run: (res: import('node:http').ServerResponse) => void; extra?: Partial<AgentConfig> }[] = [
    { name: '401', code: 'model_auth_failed', run: (res) => { res.statusCode = 401; res.end('denied'); } },
    { name: '429', code: 'model_rate_limited', run: (res) => { res.statusCode = 429; res.end('slow down'); } },
    { name: '空输出', code: 'model_empty_output', run: (res) => reply(res, '   ') },
    { name: '截断', code: 'model_truncated', run: (res) => reply(res, strictHtml('被截断'), 'length') },
    { name: '非法 JSON', code: 'model_invalid_response', run: (res) => { res.setHeader('content-type', 'application/json'); res.end('not json'); } },
    { name: '缺少 choices', code: 'model_invalid_response', run: (res) => { res.setHeader('content-type', 'application/json'); res.end('{}'); } },
    { name: '响应过大', code: 'model_too_large', run: (res) => reply(res, strictHtml('过大') + 'x'.repeat(4096)), extra: { maxResponseBytes: 256 } },
  ];
  for (const item of cases) {
    const fake = await startFakeOpenAi((_call, _captured, res) => item.run(res));
    try {
      const error = await errorOf(ask(fake.base + '/v1', '生成', item.extra));
      assert.equal(error.code, item.code, item.name);
      assert.equal(fake.captures.length, 1, item.name + ' 不应自动重试');
      assert.ok(!String(error.message).includes(SECRET), '错误信息不能包含密钥');
    } finally { await fake.close(); }
  }
});

test('模型请求超时会被中止并分类为 model_timeout，不进入无限等待', async () => {
  const fake = await startFakeOpenAi(() => { /* 故意不响应 */ });
  try {
    const started = Date.now();
    const error = await errorOf(ask(fake.base + '/v1', '生成', { requestTimeoutMs: 150 }));
    assert.equal(error.code, 'model_timeout');
    assert.ok(Date.now() - started < 5000);
    assert.equal(fake.captures.length, 1);
  } finally { await fake.close(); }
});

test('非完整 HTML 被拒绝，不会把片段当作游戏产物', () => {
  assert.throws(() => extractHtml('<div>片段</div>'), (error: { code?: string }) => error.code === 'invalid_html');
});

test('模型地址边界：默认 HTTPS，回环 HTTP 需显式放行', () => {
  assert.equal(validateModelEndpoint('https://api.example.com/v1', false), 'https://api.example.com/v1');
  assert.throws(() => validateModelEndpoint('http://api.example.com/v1', false), /HTTPS/);
  assert.throws(() => validateModelEndpoint('http://127.0.0.1:8080/v1', false), /MYOLGAME_AGENT_ALLOW_LOCAL/);
  assert.equal(validateModelEndpoint('http://127.0.0.1:8080/v1', true), 'http://127.0.0.1:8080/v1');
  assert.throws(() => validateModelEndpoint('https://user:pass@api.example.com/v1', false), /账号密码/);
  assert.throws(() => validateModelEndpoint('https://api.example.com/v1#x', false), /#/);
});

interface FixtureOptions {
  handler: (call: number, captured: Captured, res: import('node:http').ServerResponse) => Promise<void> | void;
  requestTimeoutMs?: number;
  maxAttempts?: number;
}

async function fixture(options: FixtureOptions) {
  const dir = await mkdtemp(join(tmpdir(), 'myol-openai-'));
  const fake = await startFakeOpenAi(options.handler);
  const configValue = config(fake.base + '/v1', {
    requestTimeoutMs: options.requestTimeoutMs ?? 20000,
    maxAttempts: options.maxAttempts ?? 2,
    timeoutMs: 60000,
    name: 'OpenAI 兼容假模型',
    chromePath: resolveChromePath(),
  });
  const store = new FileStore(join(dir, 'db.json'));
  const app = await startLocalServer({ port: 0, store, seed: false, agent: configValue, sandboxDir: join(dir, 'sandboxes') });
  let token = '';
  const request = async (path: string, method = 'GET', body?: unknown) => fetch(app.url + '/api' + path, {
    method,
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  token = ((await (await request('/session', 'POST', {})).json()) as { token: string }).token;
  const create = async (prompt = '创建一个打砖块游戏', extra: Record<string, unknown> = {}) => {
    const response = await request('/projects', 'POST', { prompt, spec: defaultSpec('breakout', 'neon'), ...extra });
    assert.equal(response.status, 202);
    return await response.json() as { project: { id: string; currentVersionId: string }; task: TaskRecord };
  };
  const submit = async (projectId: string, prompt: string) => {
    const response = await request('/projects/' + projectId + '/tasks', 'POST', { prompt });
    return { status: response.status, json: await response.json() as { task?: TaskRecord; error?: { code: string } } };
  };
  const waitTask = async (projectId: string, taskId: string): Promise<TaskRecord> => {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const { task } = await (await request('/projects/' + projectId + '/tasks/' + taskId)).json() as { task: TaskRecord };
      if (task.finishedAt) return task;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('等待任务终态超时');
  };
  const userPrompts = () => fake.captures.map((captured) =>
    captured.body.messages?.find((message) => message.role === 'user')?.content ?? '');
  return {
    dir, fake, app, store, token, request, create, submit, waitTask, userPrompts,
    cleanup: async () => {
      await app.close();
      await fake.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test('首次用模板源码、后续用上一有效版本、回退后用回退版本，且密钥不出现在响应与产物', async () => {
  const f = await fixture({
    handler: (call, _captured, res) => reply(res, strictHtml(['第一关作品', '第二关作品', '回退后作品'][call - 1] ?? '额外作品')),
  });
  try {
    const { project, task } = await f.create();
    const first = await f.waitTask(project.id, task.id);
    assert.equal(first.status, 'succeeded', first.error || '');
    const v1 = await f.store.getVersion(first.versionId!);
    assert.equal(v1?.generationMode, 'agent');
    assert.equal(v1?.checks?.browser, 'passed');
    assert.equal(f.fake.captures[0]!.authorization, 'Bearer ' + SECRET);
    assert.match(f.userPrompts()[0]!, /const CFG =/, '首次请求必须包含模板完整源码');

    const second = await f.submit(project.id, '增加第二关，第二关砖块耐久两次');
    assert.equal(second.status, 202);
    const done2 = await f.waitTask(project.id, second.json.task!.id);
    assert.equal(done2.status, 'succeeded', done2.error || '');
    assert.match(f.userPrompts()[1]!, /第一关作品/, '二次请求必须包含上一个有效版本源码');
    assert.match(f.userPrompts()[1]!, /增加第二关/);

    assert.equal((await f.request('/projects/' + project.id + '/restore', 'POST', { versionId: v1!.id })).status, 200);
    const third = await f.submit(project.id, '在回退版本上继续修改');
    assert.equal(third.status, 202);
    const done3 = await f.waitTask(project.id, third.json.task!.id);
    assert.equal(done3.status, 'succeeded', done3.error || '');
    assert.match(f.userPrompts()[2]!, /第一关作品/, '回退后的修改必须使用回退版本源码');
    assert.doesNotMatch(f.userPrompts()[2]!, /第二关作品/);
    assert.equal((await f.store.getProject(project.id))?.currentVersionId, done3.versionId);

    // 密钥只出现在服务端发往模型的 Authorization 头，不进入任何可读响应或产物。
    const projectJson = await (await f.request('/projects/' + project.id)).text();
    const tasksJson = await (await f.request('/projects/' + project.id + '/tasks/' + done3.id)).text();
    const html = await (await f.request('/projects/' + project.id + '/versions/' + done3.versionId + '/download')).text();
    const zip = Buffer.from(await (await f.request('/projects/' + project.id + '/source?versionId=' + done3.versionId)).arrayBuffer());
    for (const [label, content] of [['项目响应', projectJson], ['任务响应', tasksJson], ['游戏 HTML', html], ['源码包', zip.toString('latin1')]] as const) {
      assert.ok(!content.includes(SECRET), label + ' 不能包含模型密钥');
    }
    assert.match(html, /回退后作品/);
  } finally { await f.cleanup(); }
});

test('模型只返回修改片段：按唯一锚点应用，二次修改与回退使用对应源码', async () => {
  const f = await fixture({
    handler: (_call, captured, res) => {
      const content = captured.body.messages?.find((message) => message.role === 'user')?.content ?? '';
      const current = /<title>([^<]*)<\/title>/.exec(content)?.[1] ?? '';
      const target = content.includes('修改标题为第二版')
        ? '编辑模式二'
        : content.includes('在回退版本上继续修改') ? '回退后编辑' : '编辑模式一';
      const edits = [{ find: '<title>' + current + '</title>', replace: '<title>' + target + '</title>' }];
      if (!content.slice(content.indexOf('<source>')).includes('__MYOLGAME_TEST__')) edits.push(hookEdit);
      reply(res, JSON.stringify({ edits }));
    },
  });
  try {
    const { project, task } = await f.create();
    const first = await f.waitTask(project.id, task.id);
    assert.equal(first.status, 'succeeded', first.error || '');
    const v1 = await f.store.getVersion(first.versionId!);
    assert.match(v1!.html, /<title>编辑模式一<\/title>/);
    assert.match(f.userPrompts()[0]!, /只输出一个 JSON 修改指令对象/);
    assert.match(f.userPrompts()[0]!, /const CFG =/, '修改片段请求仍需携带当前完整源码');

    const second = await f.submit(project.id, '修改标题为第二版');
    assert.equal(second.status, 202);
    const done2 = await f.waitTask(project.id, second.json.task!.id);
    assert.equal(done2.status, 'succeeded', done2.error || '');
    const secondPrompt = f.userPrompts().find((prompt) => prompt.includes('修改标题为第二版')) ?? '';
    assert.match(secondPrompt, /<title>编辑模式一<\/title>/, '二次请求必须在上一候选源码上修改');
    assert.match((await f.store.getVersion(done2.versionId!))!.html, /<title>编辑模式二<\/title>/);

    assert.equal((await f.request('/projects/' + project.id + '/restore', 'POST', { versionId: v1!.id })).status, 200);
    const third = await f.submit(project.id, '在回退版本上继续修改');
    assert.equal(third.status, 202);
    const done3 = await f.waitTask(project.id, third.json.task!.id);
    assert.equal(done3.status, 'succeeded', done3.error || '');
    const thirdPrompt = f.userPrompts().find((prompt) => prompt.includes('在回退版本上继续修改')) ?? '';
    assert.match(thirdPrompt, /<title>编辑模式一<\/title>/);
    assert.doesNotMatch(thirdPrompt, /编辑模式二/);
    assert.match((await f.store.getVersion(done3.versionId!))!.html, /<title>回退后编辑<\/title>/);
  } finally { await f.cleanup(); }
});

test('从零生成首次整页输出，后续修改回到片段模式', async () => {
  const f = await fixture({
    handler: (_call, captured, res) => {
      const system = captured.body.messages?.find((message) => message.role === 'system')?.content ?? '';
      // 从零首次使用独立系统提示，要求整页 HTML；后续修复/修改回到片段模式。
      if (system.includes('从零实现')) {
        reply(res, strictHtml('从零作品'));
        return;
      }
      const content = captured.body.messages?.find((message) => message.role === 'user')?.content ?? '';
      const current = /<title>([^<]*)<\/title>/.exec(content)?.[1] ?? '';
      reply(res, JSON.stringify({
        edits: [{ find: '<title>' + current + '</title>', replace: '<title>从零第二版</title>' }],
      }));
    },
  });
  try {
    const { project, task } = await f.create('用《星际塔防》做一个塔防游戏，空格开始，方向键移动', { fromScratch: true });
    const detail = await (await f.request('/projects/' + project.id)).json() as { project: { fromScratch?: boolean } };
    assert.equal(detail.project.fromScratch, true);

    const first = await f.waitTask(project.id, task.id);
    assert.equal(first.status, 'succeeded', first.error || '');
    assert.match((await f.store.getVersion(first.versionId!))!.html, /从零作品/);
    const scratchSystem = f.fake.captures[0]!.body.messages![0]!.content;
    assert.match(scratchSystem, /从零实现/);
    const scratchPrompt = f.userPrompts()[0]!;
    assert.match(scratchPrompt, /只输出一个完整的 <!doctype html>/);
    assert.match(scratchPrompt, /起始骨架/);
    assert.doesNotMatch(scratchPrompt, /const CFG =/, '从零首次不应携带模板源码');

    const second = await f.submit(project.id, '把标题改成第二版');
    assert.equal(second.status, 202);
    const done2 = await f.waitTask(project.id, second.json.task!.id);
    assert.equal(done2.status, 'succeeded', done2.error || '');
    const editPrompt = f.userPrompts().find((prompt) => prompt.includes('把标题改成第二版')) ?? '';
    assert.match(editPrompt, /只输出一个 JSON 修改指令对象/);
    assert.match(editPrompt, /从零作品/, '后续修改必须基于从零生成的候选源码');
    assert.match((await f.store.getVersion(done2.versionId!))!.html, /<title>从零第二版<\/title>/);
  } finally { await f.cleanup(); }
});

test('从零生成首次被截断时精简后重试，仍不保存半截源码', async () => {
  const f = await fixture({
    handler: (call, _captured, res) => {
      if (call === 1) {
        reply(res, strictHtml('半截作品'), 'length');
        return;
      }
      reply(res, strictHtml('精简作品'));
    },
    maxAttempts: 2,
  });
  try {
    const { project, task } = await f.create('用《星际塔防》做一个塔防游戏', { fromScratch: true });
    const done = await f.waitTask(project.id, task.id);
    assert.equal(done.status, 'succeeded', done.error || '');
    assert.equal(f.fake.captures.length, 2);
    assert.match(f.userPrompts()[1]!, /长度上限/);
    assert.match(f.userPrompts()[1]!, /精简/);
    assert.ok(done.stages.some((stage) => stage.name.includes('重新生成')));
    const versions = await f.store.listVersions(project.id);
    assert.equal(versions.length, 1);
    assert.match(versions[0]!.html, /精简作品/);
    assert.doesNotMatch(versions[0]!.html, /半截作品/);
  } finally { await f.cleanup(); }
});

test('未启用源码开发时拒绝从零生成', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'myol-scratch-guard-'));
  const store = new FileStore(join(dir, 'db.json'));
  const app = await startLocalServer({ port: 0, store, seed: false, sandboxDir: join(dir, 'sandboxes') });
  try {
    const session = await fetch(app.url + '/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const token = ((await session.json()) as { token: string }).token;
    const response = await fetch(app.url + '/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify({ prompt: '从零做一个塔防', spec: defaultSpec('breakout', 'neon'), fromScratch: true }),
    });
    assert.equal(response.status, 409);
    const body = await response.json() as { error?: { code: string } };
    assert.equal(body.error?.code, 'agent_required');
    assert.equal((await store.listProjects(token)).length, 0, '拒绝后不能创建项目');
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('修改片段锚点无效时带反馈重试，连续失败不保存版本', async () => {
  const repaired = await fixture({
    handler: (call, _captured, res) => {
      if (call === 1) {
        reply(res, JSON.stringify({ edits: [{ find: '不存在的锚点-xyz', replace: 'x' }] }));
        return;
      }
      reply(res, JSON.stringify({
        edits: [
          { find: '<title>霓虹打砖块 · MYolGame</title>', replace: '<title>修复后作品</title>' },
          hookEdit,
        ],
      }));
    },
    maxAttempts: 2,
  });
  try {
    const { project, task } = await repaired.create();
    const done = await repaired.waitTask(project.id, task.id);
    assert.equal(done.status, 'succeeded', done.error || '');
    assert.equal(repaired.fake.captures.length, 2);
    assert.match(repaired.userPrompts()[1]!, /未在源码中找到/);
    assert.ok(done.stages.some((stage) => stage.name.includes('修复')));
    assert.match((await repaired.store.getVersion(done.versionId!))!.html, /修复后作品/);
  } finally { await repaired.cleanup(); }

  const broken = await fixture({
    handler: (_call, _captured, res) => {
      reply(res, JSON.stringify({ edits: [{ find: '始终不存在', replace: 'x' }] }));
    },
    maxAttempts: 2,
  });
  try {
    const { project, task } = await broken.create();
    const done = await broken.waitTask(project.id, task.id);
    assert.equal(done.status, 'failed');
    assert.equal(done.errorCode, 'invalid_edit');
    assert.equal((await broken.store.listVersions(project.id)).length, 0);
    assert.equal((await broken.store.getProject(project.id))?.currentVersionId, '');
  } finally { await broken.cleanup(); }
});

test('浏览器检查失败时带候选源码与错误反馈修复，超过次数保留原版本', async () => {
  const f = await fixture({
    handler: (call, _captured, res) => {
      if (call === 1) {
        reply(res, strictHtml('坏候选').replace('draw();</script>', "draw();throw new Error('坏脚本');</script>"));
        return;
      }
      reply(res, strictHtml('修复候选'));
    },
    maxAttempts: 2,
  });
  try {
    const { project, task } = await f.create();
    const done = await f.waitTask(project.id, task.id);
    assert.equal(done.status, 'succeeded', done.error || '');
    assert.equal(f.fake.captures.length, 2);
    assert.match(f.userPrompts()[1]!, /上次生成或检查未通过/);
    assert.match(f.userPrompts()[1]!, /坏候选/, '修复请求必须携带本次候选源码');
    assert.ok(done.stages.some((stage) => stage.name.includes('修复')));
    assert.equal((await f.store.listVersions(project.id)).length, 1);
  } finally { await f.cleanup(); }
});

test('模型鉴权失败的任务不保存候选；并发提交受限；取消不提交', async () => {
  const unauthorized = await fixture({
    handler: (_call, _captured, res) => { res.statusCode = 401; res.end('denied'); },
  });
  try {
    const { project, task } = await unauthorized.create();
    const done = await unauthorized.waitTask(project.id, task.id);
    assert.equal(done.status, 'failed');
    assert.equal(done.errorCode, 'model_auth_failed');
    assert.equal((await unauthorized.store.listVersions(project.id)).length, 0);
    assert.equal((await unauthorized.store.getProject(project.id))?.currentVersionId, '');
    assert.ok(!(done.error ?? '').includes(SECRET));
  } finally { await unauthorized.cleanup(); }

  const slow = await fixture({
    handler: async (_call, _captured, res) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      reply(res, strictHtml('迟到候选'));
    },
    requestTimeoutMs: 10000,
  });
  try {
    const { project, task } = await slow.create();
    const parallel = await slow.submit(project.id, '并发需求');
    assert.equal(parallel.status, 409, '同项目不能并发执行两个任务');
    assert.equal(parallel.json.error?.code, 'task_active');
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal((await slow.request('/projects/' + project.id + '/tasks/' + task.id + '/cancel', 'POST', {})).status, 200);
    const cancelled = await slow.waitTask(project.id, task.id);
    assert.equal(cancelled.status, 'cancelled');
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.equal((await slow.store.listVersions(project.id)).length, 0, '取消后不能提交候选版本');
  } finally { await slow.cleanup(); }
});

test('浏览器路径优先使用环境变量，真实 Chrome 可用', () => {
  const resolved = resolveChromePath({ MYOLGAME_CHROME_PATH: process.execPath }, process.platform);
  assert.equal(resolved, process.execPath);
  assert.throws(() => resolveChromePath({ MYOLGAME_CHROME_PATH: join(tmpdir(), 'missing-chrome-xyz') }, process.platform), /不存在/);
});