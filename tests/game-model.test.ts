// 账号级游戏开发模型：配置校验、连接测试、账号隔离与密钥边界。全部使用受控假模型。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAgentConfig } from '../dev/agent/config.ts';
import { resolveChromePath } from '../dev/chrome.ts';
import { startLocalServer } from '../dev/local-server.ts';
import { FileStore } from '../dev/store_file.ts';
import { chromium, type Browser } from 'playwright-core';
import { parseGameModelSettingsInput, probeGameModel } from '../functions/shared/game-model.ts';
import { defaultSpec } from '../functions/shared/spec.ts';
import type { AgentConfig } from '../dev/agent/protocol.ts';
import type { TaskRecord, Version } from '../functions/store.ts';

const SECRET = 'sk-account-game-model-secret';
const SERVER_SECRET = 'sk-server-default-secret';

const gameHtml = (title: string) => `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${title}</title>
<style>*{box-sizing:border-box}body{margin:0;padding:8px;background:#0b1020;color:#e9f0ff;font-family:system-ui;text-align:center}h1{font-size:22px;margin:8px 0}canvas{width:min(100%,640px);height:auto;max-height:calc(100dvh - 100px);background:#18243d;border-radius:18px}</style></head>
<body><h1>${title}</h1><p>空格开始，方向键移动，R 重启</p><canvas width="640" height="400"></canvas>
<script>let moves=0;const c=document.querySelector('canvas'),ctx=c.getContext('2d');
function draw(){ctx.fillStyle='#18243d';ctx.fillRect(0,0,640,400);ctx.fillStyle='#6ee7ff';ctx.fillRect(80+moves*8,160,50,50);ctx.fillStyle='white';ctx.font='20px sans-serif';ctx.fillText('Moves: '+moves,30,40)}
function reset(){moves=0;draw()}addEventListener('keydown',e=>{e.preventDefault();if(e.key==='r')reset();else{moves++;draw()}});
window.__MYOLGAME_TEST__={getState:()=>({moves}),reset};draw();</script></body></html>`;

interface Captured {
  url: string;
  authorization: string;
  body: { model?: string; max_tokens?: number; messages?: { role: string; content: string }[] };
}

async function startFakeOpenAi(handler: (call: number, captured: Captured, res: import('node:http').ServerResponse) => void) {
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
    handler(captures.length, captured, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    captures,
    base: 'http://127.0.0.1:' + (server.address() as { port: number }).port,
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

test('账号模型配置解析：地址、密钥沿用、模型名与回环放行', () => {
  const ok = parseGameModelSettingsInput(
    { apiUrl: 'https://api.example.com/v1', apiKey: ' key ', model: 'deepseek-chat' },
    undefined,
    false,
  );
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.apiUrl, 'https://api.example.com/v1');
    assert.equal(ok.apiKey, 'key');
    assert.equal(ok.model, 'deepseek-chat');
  }

  // 留空密钥时沿用已保存的密钥。
  const reused = parseGameModelSettingsInput(
    { apiUrl: 'https://api.example.com/v1', model: 'deepseek-chat' },
    'saved-key',
    false,
  );
  assert.equal(reused.ok, true);
  if (reused.ok) assert.equal(reused.apiKey, 'saved-key');

  const cases: { input: { apiUrl?: unknown; apiKey?: unknown; model?: unknown }; previous?: string; allowLocal?: boolean; error: RegExp }[] = [
    { input: { apiUrl: '', apiKey: 'k', model: 'm' }, error: /接口地址不能为空/ },
    { input: { apiUrl: 'http://api.example.com/v1', apiKey: 'k', model: 'm' }, error: /HTTPS/ },
    { input: { apiUrl: 'http://127.0.0.1:8080/v1', apiKey: 'k', model: 'm' }, error: /MYOLGAME_AGENT_ALLOW_LOCAL/ },
    { input: { apiUrl: 'https://u:p@api.example.com/v1', apiKey: 'k', model: 'm' }, error: /账号密码/ },
    { input: { apiUrl: 'https://api.example.com/v1#x', apiKey: 'k', model: 'm' }, error: /#/ },
    { input: { apiUrl: 'https://api.example.com/v1', model: 'm' }, error: /API 密钥/ },
    { input: { apiUrl: 'https://api.example.com/v1', apiKey: 'k', model: 'bad model' }, error: /模型名/ },
  ];
  for (const item of cases) {
    const result = parseGameModelSettingsInput(item.input, item.previous, item.allowLocal ?? false);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, item.error);
  }

  const loopback = parseGameModelSettingsInput(
    { apiUrl: 'http://127.0.0.1:8080/v1', apiKey: 'k', model: 'm' },
    undefined,
    true,
  );
  assert.equal(loopback.ok, true);
});

test('连接测试只发送一次最小请求，并分类 404 回退与鉴权失败', async () => {
  const fake = await startFakeOpenAi((call, captured, res) => {
    if (call === 1) {
      assert.equal(captured.url, '/chat/completions');
      res.statusCode = 404;
      res.end('missing');
      return;
    }
    assert.equal(captured.url, '/v1/chat/completions');
    assert.equal(captured.authorization, 'Bearer ' + SECRET);
    assert.equal(captured.body.model, 'fake-game-model');
    assert.equal(captured.body.max_tokens, 16);
    assert.ok((captured.body.messages?.length ?? 0) >= 1);
    reply(res, 'OK');
  });
  try {
    const result = await probeGameModel({ apiUrl: fake.base, apiKey: SECRET, model: 'fake-game-model' });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.reply, 'OK');
      assert.equal(result.url, fake.base + '/v1/chat/completions');
    }
    assert.equal(fake.captures.length, 2, '仅 404 时切换 /v1，不重复成功请求');
  } finally { await fake.close(); }

  const unauthorized = await startFakeOpenAi((_call, _captured, res) => {
    res.statusCode = 401;
    res.end('denied');
  });
  try {
    const result = await probeGameModel({ apiUrl: unauthorized.base + '/v1', apiKey: SECRET, model: 'm' });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, 'model_auth_failed');
      assert.ok(!result.error.includes(SECRET));
    }
    assert.equal(unauthorized.captures.length, 1);
  } finally { await unauthorized.close(); }
});

test('openai provider 允许仅由账号配置提供地址、密钥与模型', () => {
  const keys = ['MYOLGAME_AGENT_PROVIDER', 'MYOLGAME_AGENT_API_URL', 'MYOLGAME_AGENT_API_KEY', 'MYOLGAME_AGENT_MODEL'] as const;
  const saved = keys.map((key) => [key, process.env[key]] as const);
  try {
    process.env.MYOLGAME_AGENT_PROVIDER = 'openai';
    delete process.env.MYOLGAME_AGENT_API_URL;
    delete process.env.MYOLGAME_AGENT_API_KEY;
    delete process.env.MYOLGAME_AGENT_MODEL;
    const config = loadAgentConfig();
    assert.equal(config?.provider, 'openai');
    assert.equal(config?.apiUrl, undefined);
    assert.equal(config?.apiKey, undefined);
    assert.equal(config?.model, undefined);

    process.env.MYOLGAME_AGENT_MODEL = 'bad model';
    assert.throws(() => loadAgentConfig(), /MYOLGAME_AGENT_MODEL/);
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

interface FixtureOptions {
  accountUrl: string;
  serverConfig?: AgentConfig;
}

async function fixture(options: FixtureOptions) {
  const dir = await mkdtemp(join(tmpdir(), 'myol-game-model-'));
  const configValue: AgentConfig = options.serverConfig ?? {
    provider: 'openai',
    name: 'OpenAI 兼容（账号级配置）',
    timeoutMs: 60000,
    maxAttempts: 1,
    chromePath: resolveChromePath(),
  };
  const store = new FileStore(join(dir, 'db.json'));
  const previousAllowLocal = process.env.MYOLGAME_AGENT_ALLOW_LOCAL;
  process.env.MYOLGAME_AGENT_ALLOW_LOCAL = '1';
  let app: Awaited<ReturnType<typeof startLocalServer>>;
  try {
    app = await startLocalServer({ port: 0, store, seed: false, agent: configValue, sandboxDir: join(dir, 'sandboxes') });
  } finally {
    if (previousAllowLocal === undefined) delete process.env.MYOLGAME_AGENT_ALLOW_LOCAL;
    else process.env.MYOLGAME_AGENT_ALLOW_LOCAL = previousAllowLocal;
  }

  const session = async () => {
    const response = await fetch(app.url + '/api/session', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    return ((await response.json()) as { token: string }).token;
  };
  const requestAs = (token: string) => async (path: string, method = 'GET', body?: unknown) => fetch(app.url + '/api' + path, {
    method,
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const waitTask = async (token: string, projectId: string, taskId: string): Promise<TaskRecord> => {
    const request = requestAs(token);
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const { task } = await (await request('/projects/' + projectId + '/tasks/' + taskId)).json() as { task: TaskRecord };
      if (task.finishedAt) return task;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('等待任务终态超时');
  };
  return {
    dir, app, store, session, requestAs, waitTask,
    cleanup: async () => {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test('账号管理接口：保存、掩码、连接测试、清除与密钥不出响应', async () => {
  const fake = await startFakeOpenAi((_call, _captured, res) => reply(res, 'OK'));
  const f = await fixture({ accountUrl: fake.base });
  try {
    const token = await f.session();
    const request = f.requestAs(token);

    const initial = await (await request('/agent/model')).json() as { available: boolean; effective: string };
    assert.equal(initial.available, true);
    assert.equal(initial.effective, 'none');

    const invalid = await request('/agent/model', 'PUT', {
      apiUrl: 'http://api.example.com/v1', apiKey: SECRET, model: 'm',
    });
    assert.equal(invalid.status, 400);

    const saved = await request('/agent/model', 'PUT', {
      apiUrl: fake.base + '/v1', apiKey: SECRET, model: 'account-model',
    });
    assert.equal(saved.status, 200);
    const savedText = await saved.text();
    assert.ok(!savedText.includes(SECRET), '保存响应不能包含密钥');
    const savedView = JSON.parse(savedText) as {
      account: { apiUrl: string; model: string; hasKey: boolean } | null;
      effective: string;
    };
    assert.equal(savedView.account?.model, 'account-model');
    assert.equal(savedView.account?.hasKey, true);
    assert.equal(savedView.effective, 'account');

    // 留空密钥再次保存：沿用已保存密钥，连接测试仍能通过。
    const again = await request('/agent/model', 'PUT', {
      apiUrl: fake.base + '/v1', model: 'account-model-v2',
    });
    assert.equal(again.status, 200);

    const tested = await request('/agent/model/test', 'POST', {});
    assert.equal(tested.status, 200);
    const testedText = await tested.text();
    assert.ok(!testedText.includes(SECRET), '测试响应不能包含密钥');
    const testResult = JSON.parse(testedText) as { ok: boolean; model: string; reply: string; source: string };
    assert.equal(testResult.ok, true);
    assert.equal(testResult.model, 'account-model-v2');
    assert.equal(testResult.reply, 'OK');
    assert.equal(testResult.source, 'account');
    assert.equal(fake.captures.length, 1);
    assert.equal(fake.captures[0]!.authorization, 'Bearer ' + SECRET);

    const cleared = await request('/agent/model', 'DELETE');
    assert.equal(cleared.status, 200);
    const clearedView = await cleared.json() as { account: unknown; effective: string };
    assert.equal(clearedView.account, null);
    assert.equal(clearedView.effective, 'none');
  } finally {
    await f.cleanup();
    await fake.close();
  }
});

test('不同账号的模型配置互相隔离，密钥失败可分类', async () => {
  const fake = await startFakeOpenAi((_call, _captured, res) => reply(res, 'OK'));
  const denied = await startFakeOpenAi((_call, _captured, res) => {
    res.statusCode = 401;
    res.end('denied');
  });
  const f = await fixture({ accountUrl: fake.base });
  try {
    const a = f.requestAs(await f.session());
    const b = f.requestAs(await f.session());
    assert.equal((await a('/agent/model', 'PUT', { apiUrl: fake.base + '/v1', apiKey: SECRET, model: 'model-a' })).status, 200);
    assert.equal((await b('/agent/model', 'PUT', { apiUrl: denied.base + '/v1', apiKey: 'bad-key', model: 'model-b' })).status, 200);

    const aView = await (await a('/agent/model')).json() as { account: { model: string } | null };
    const bView = await (await b('/agent/model')).json() as { account: { model: string } | null };
    assert.equal(aView.account?.model, 'model-a');
    assert.equal(bView.account?.model, 'model-b');

    const bTest = await (await b('/agent/model/test', 'POST', {})).json() as { ok: boolean; error: string };
    assert.equal(bTest.ok, false);
    assert.equal(bTest.error, 'model_auth_failed');
    assert.equal(fake.captures.length, 0, '账号 B 的测试不能使用账号 A 的配置');

    // 既没有账号配置也没有服务端配置时，任务明确失败且不保存版本。
    const cToken = await f.session();
    const c = f.requestAs(cToken);
    const created = await c('/projects', 'POST', {
      prompt: '未配置模型的账号创建游戏', spec: defaultSpec('snake', 'candy'),
    });
    assert.equal(created.status, 202);
    const queued = await created.json() as { project: { id: string }; task: TaskRecord };
    const failed = await f.waitTask(cToken, queued.project.id, queued.task.id);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.errorCode, 'model_not_configured');
    assert.equal((await f.store.listVersions(queued.project.id)).length, 0);
  } finally {
    await f.cleanup();
    await fake.close();
    await denied.close();
  }
});

test('任务使用项目所有者的账号模型，账号配置优先且与服务端默认互不串用', async () => {
  const accountFake = await startFakeOpenAi((_call, _captured, res) => reply(res, gameHtml('账号模型作品')));
  const serverFake = await startFakeOpenAi((_call, _captured, res) => reply(res, gameHtml('服务端默认作品')));
  const f = await fixture({
    accountUrl: accountFake.base,
    serverConfig: {
      provider: 'openai',
      name: '服务端默认',
      apiUrl: serverFake.base + '/v1',
      apiKey: SERVER_SECRET,
      model: 'server-model',
      timeoutMs: 60000,
      maxAttempts: 1,
      chromePath: resolveChromePath(),
    },
  });
  try {
    const owner = await f.session();
    const other = await f.session();
    const ownerRequest = f.requestAs(owner);
    const otherRequest = f.requestAs(other);
    assert.equal((await ownerRequest('/agent/model', 'PUT', {
      apiUrl: accountFake.base + '/v1', apiKey: SECRET, model: 'account-model',
    })).status, 200);

    const created = await ownerRequest('/projects', 'POST', {
      prompt: '创建一个打砖块游戏', spec: defaultSpec('breakout', 'neon'),
    });
    assert.equal(created.status, 202);
    const { project, task } = await created.json() as { project: { id: string }; task: TaskRecord };
    const done = await f.waitTask(owner, project.id, task.id);
    assert.equal(done.status, 'succeeded', done.error || '');
    assert.equal(accountFake.captures.length, 1);
    assert.equal(accountFake.captures[0]!.authorization, 'Bearer ' + SECRET);
    assert.equal(accountFake.captures[0]!.body.model, 'account-model');
    assert.equal(serverFake.captures.length, 0, '账号配置应优先于服务端默认配置');
    const version = await f.store.getVersion(done.versionId!) as Version | null;
    assert.ok(version);
    assert.match(version.agentName ?? '', /account-model/);

    // 没有账号配置的账号回退到服务端默认配置，不会串用其他账号的密钥。
    const fallback = await otherRequest('/projects', 'POST', {
      prompt: '另一个账号创建游戏', spec: defaultSpec('snake', 'candy'),
    });
    assert.equal(fallback.status, 202);
    const otherCreated = await fallback.json() as { project: { id: string }; task: TaskRecord };
    const otherDone = await f.waitTask(other, otherCreated.project.id, otherCreated.task.id);
    assert.equal(otherDone.status, 'succeeded', otherDone.error || '');
    assert.equal(serverFake.captures.length, 1);
    assert.equal(serverFake.captures[0]!.authorization, 'Bearer ' + SERVER_SECRET);
    assert.equal(serverFake.captures[0]!.body.model, 'server-model');

    // 密钥不出现在任务记录、项目响应或版本源码中。
    const taskJson = await (await ownerRequest('/projects/' + project.id + '/tasks/' + done.id)).text();
    const projectJson = await (await ownerRequest('/projects/' + project.id)).text();
    for (const content of [taskJson, projectJson, version.html]) {
      assert.ok(!content.includes(SECRET), '密钥不能出现在可读数据中');
      assert.ok(!content.includes(SERVER_SECRET));
    }
  } finally {
    await f.cleanup();
    await accountFake.close();
    await serverFake.close();
  }
});

test('账号管理页保存游戏模型并完成连接测试，密钥不回显', async () => {
  const fake = await startFakeOpenAi((_call, _captured, res) => reply(res, 'OK'));
  const dir = await mkdtemp(join(tmpdir(), 'myol-game-model-ui-'));
  const store = new FileStore(join(dir, 'db.json'));
  const previousAllowLocal = process.env.MYOLGAME_AGENT_ALLOW_LOCAL;
  process.env.MYOLGAME_AGENT_ALLOW_LOCAL = '1';
  let app: Awaited<ReturnType<typeof startLocalServer>>;
  try {
    app = await startLocalServer({
      port: 0, store, seed: false, sandboxDir: join(dir, 'sandboxes'),
      agent: {
        provider: 'openai', name: 'OpenAI 兼容（账号级配置）',
        timeoutMs: 60000, maxAttempts: 1, chromePath: resolveChromePath(),
      },
    });
  } finally {
    if (previousAllowLocal === undefined) delete process.env.MYOLGAME_AGENT_ALLOW_LOCAL;
    else process.env.MYOLGAME_AGENT_ALLOW_LOCAL = previousAllowLocal;
  }
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ executablePath: resolveChromePath(), headless: true });
  } catch (error) {
    await app.close();
    await fake.close();
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(app.url + '/account');
    await page.getByRole('button', { name: '没有账号，去注册' }).click();
    await page.getByLabel('用户名', { exact: true }).fill('model_ui_user');
    await page.getByLabel('昵称', { exact: true }).fill('模型界面测试');
    await page.getByLabel('密码', { exact: true }).fill('model-ui-password');
    await page.getByLabel('确认密码', { exact: true }).fill('model-ui-password');
    await page.getByRole('button', { name: '注册并登录', exact: true }).click();
    await page.waitForURL('**/projects');

    await page.goto(app.url + '/account');
    await page.getByRole('heading', { name: '账号管理' }).waitFor();
    const panel = page.locator('section', {
      has: page.getByRole('heading', { name: '游戏源码开发模型（OpenAI 兼容）' }),
    });
    await panel.getByLabel('游戏模型接口地址').fill(fake.base + '/v1');
    await panel.getByLabel('游戏模型名').fill('ui-game-model');
    await panel.getByLabel('游戏模型 API 密钥').fill(SECRET);
    await panel.getByRole('button', { name: '保存模型' }).click();
    await panel.getByText(/已保存。由本账号/).waitFor();
    assert.match(await panel.innerText(), /ui-game-model/);

    await panel.getByRole('button', { name: '测试连接' }).click();
    await panel.getByText(/连接正常/).waitFor({ timeout: 15000 });
    assert.match(await panel.innerText(), /回复「OK」/);
    assert.equal(fake.captures.length, 1);
    assert.equal(fake.captures[0]!.authorization, 'Bearer ' + SECRET);

    const bodyText = await page.evaluate(() => document.body.innerText);
    assert.ok(!bodyText.includes(SECRET), '页面正文不能回显密钥');
    assert.equal(await page.evaluate(() => (localStorage.getItem('myol.token') ?? '').includes('sk-')), false);

    // 刷新后配置仍在；密钥输入框留空，测试连接应沿用服务端保存的密钥。
    await page.reload();
    await page.getByRole('heading', { name: '账号管理' }).waitFor();
    await panel.getByRole('heading', { name: '游戏源码开发模型（OpenAI 兼容）' }).waitFor();
    await panel.getByRole('button', { name: '测试连接' }).click();
    await panel.getByText(/连接正常/).waitFor({ timeout: 15000 });
    assert.equal(fake.captures.length, 2);
    assert.equal(fake.captures[1]!.authorization, 'Bearer ' + SECRET);
  } finally {
    await browser.close();
    await app.close();
    await fake.close();
    await rm(dir, { recursive: true, force: true });
  }
});
