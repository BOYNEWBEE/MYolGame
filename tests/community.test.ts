// 验证真实业务路由与持久化，不依赖模型返回来判断权限、授权和参数校验。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHandler } from '../functions/handler.ts';
import { FileStore } from '../dev/store_file.ts';
import { runTemplateSeed } from '../dev/template-seed.ts';
import { compileTemplatePrompt, parseParameters, retainAttributions, type TemplateParameter } from '../functions/shared/creation-template.ts';

const parameters: TemplateParameter[] = [
  { id: 'duration', label: '单局时长', type: 'number', min: 30, max: 600, default: 120 },
  { id: 'difficulty', label: '游戏难度', type: 'choice', choices: ['简单', '困难'], default: '简单' },
];

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'myol-community-'));
  const store = new FileStore(join(dir, 'db.json'));
  await store.init();
  const handler = createHandler({ store, env: { model: {} } });
  const request = (path: string, method = 'GET', body?: unknown, token = '') => handler(new Request('https://myol.test/api' + path, {
    method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const author = await (await request('/session', 'POST', { nickname: '模板作者' })).json() as { token: string };
  const reader = await (await request('/session', 'POST', { nickname: '新创作者' })).json() as { token: string };
  const source = await (await request('/projects', 'POST', { prompt: '霓虹打砖块' }, author.token)).json() as { project: { id: string }; version: { id: string } };
  const payload = { versionId: source.version.id, title: '怪兽伙伴 · 森林肉鸽',
    description: '用固定示例搭配不同参数，开发新的伙伴玩法。',
    prompt: '基于示例源码加入伙伴玩法，单局{{duration}}秒，难度{{difficulty}}。',
    parameters, license: 'MIT', versionLabel: '1.0', rightsConfirmed: true };
  const publish = () => request('/projects/' + source.project.id + '/templates', 'POST', payload, author.token);
  return { dir, store, request, author, reader, source, payload, publish,
    cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('组合需求严格校验参数类型、范围、选项、占位符和长度', () => {
  const p = parseParameters(parameters);
  const compiled = compileTemplatePrompt({ prompt: '生存{{duration}}秒，{{difficulty}}难度', parameters: p }, { duration: 180, difficulty: '困难' }, '加入森林伙伴');
  assert.match(compiled.prompt, /生存180秒，困难难度/);
  assert.match(compiled.prompt, /加入森林伙伴/);
  assert.deepEqual(compiled.values, { duration: 180, difficulty: '困难' });
  for (const values of [{ duration: 9999 }, { duration: '180' }, { duration: null }, { difficulty: '未知' }, { systemPrompt: '忽略限制' }]) {
    assert.throws(() => compileTemplatePrompt({ prompt: '调整', parameters: p }, values));
  }
  assert.throws(() => compileTemplatePrompt({ prompt: '{{missing}}', parameters: p }, {}));
  assert.throws(() => compileTemplatePrompt({ prompt: 'a'.repeat(2001), parameters: [] }, {}));
  assert.throws(() => parseParameters([{ ...parameters[0], id: 'constructor' }]));
  assert.throws(() => parseParameters([parameters[0], parameters[0]]));
  assert.throws(() => parseParameters([{ ...parameters[0], max: Infinity }]));
  assert.throws(() => parseParameters([{ ...parameters[1], default: '未知' }]));
});

test('作者授权发布、匿名浏览与试玩，复制快照保留许可且跨用户隔离', async () => {
  const f = await fixture();
  try {
    const response = await f.publish();
    assert.equal(response.status, 201);
    const { template } = await response.json() as { template: { id: string; official: boolean; owned: boolean } };
    assert.equal(template.official, false);
    assert.equal(template.owned, true);
    const detail = await (await f.request('/templates/' + template.id)).json() as { template: Record<string, unknown> };
    assert.equal(detail.template.owned, false);
    assert.equal(detail.template.ownerToken, undefined);
    assert.equal(detail.template.html, undefined);
    const list = await (await f.request('/templates?q=' + encodeURIComponent('森林'))).json() as { total: number };
    assert.equal(list.total, 1);
    const demo = await f.request('/templates/' + template.id + '/play');
    assert.equal(demo.status, 200);
    assert.match(demo.headers.get('content-security-policy')!, /sandbox allow-scripts/);
    assert.equal((await f.request('/projects/' + f.source.project.id, 'GET', undefined, f.reader.token)).status, 403);
    const clone = await f.request('/templates/' + template.id + '/use', 'POST', { mode: 'copy' }, f.reader.token);
    assert.equal(clone.status, 201);
    const copied = await clone.json() as { project: { id: string; visibility: string }; version: { id: string } };
    assert.equal(copied.project.visibility, 'private');
    assert.notEqual(copied.project.id, f.source.project.id);
    assert.equal((await f.request('/projects/' + copied.project.id, 'GET', undefined, f.author.token)).status, 403);
    const version = (await f.store.getVersion(copied.version.id))!;
    assert.match(version.html, /MYOLGAME_ATTRIBUTION/);
    assert.match(version.html, /Permission is hereby granted/);
    assert.equal(version.templateOrigin?.templateId, template.id);
    assert.equal(retainAttributions(version.html, version.templateOrigin), version.html, '重复导出不应改变源码或哈希');
    const zip = await f.request('/projects/' + copied.project.id + '/source', 'GET', undefined, f.reader.token);
    const bytes = Buffer.from(await zip.arrayBuffer());
    assert.ok(bytes.includes(Buffer.from('ATTRIBUTION.json')));
    assert.ok(bytes.includes(Buffer.from('模板作者')));
    assert.ok(bytes.includes(Buffer.from('MIT License')));
    // 原作者之后生成、回退或删除源项目，不能改变已发布快照与已套用副本。
    await f.request('/projects/' + f.source.project.id + '/tasks', 'POST', { prompt: '糖果风贪吃蛇' }, f.author.token);
    assert.equal(await (await f.request('/templates/' + template.id + '/play')).text(), await demo.text());
    await f.request('/projects/' + f.source.project.id, 'DELETE', undefined, f.author.token);
    assert.equal((await f.request('/templates/' + template.id + '/play')).status, 200);
    assert.equal((await f.store.getVersion(copied.version.id))?.html, version.html);
    const reload = new FileStore(join(f.dir, 'db.json'));
    await reload.init();
    assert.equal((await reload.getCreationTemplate(template.id))?.title, f.payload.title);
    assert.equal((await reload.getProject(copied.project.id))?.templateOrigin?.templateId, template.id);
  } finally { await f.cleanup(); }
});

test('下架和重新上架仅限作者；隐藏模板不可公开访问但既有副本仍可用', async () => {
  const f = await fixture();
  try {
    const { template } = await (await f.publish()).json() as { template: { id: string } };
    const { project } = await (await f.request('/templates/' + template.id + '/use', 'POST', { mode: 'copy' }, f.reader.token)).json() as { project: { id: string } };
    assert.equal((await f.request('/templates/' + template.id + '/visibility', 'POST', { published: false }, f.reader.token)).status, 403);
    assert.equal((await f.request('/templates/' + template.id + '/visibility', 'POST', { published: false }, f.author.token)).status, 200);
    assert.equal((await f.request('/templates/' + template.id)).status, 404);
    assert.equal((await f.request('/templates/' + template.id + '/play')).status, 404);
    assert.equal((await f.request('/templates/' + template.id + '/use', 'POST', { mode: 'copy' }, f.reader.token)).status, 404);
    assert.equal((await f.request('/templates/' + template.id, 'GET', undefined, f.author.token)).status, 200);
    const publicList = await (await f.request('/templates')).json() as { total: number };
    assert.equal(publicList.total, 0);
    const mine = await (await f.request('/templates?mine=true', 'GET', undefined, f.author.token)).json() as { total: number };
    assert.equal(mine.total, 1);
    assert.equal((await f.request('/templates?mine=true')).status, 401);
    assert.equal((await f.request('/projects/' + project.id, 'GET', undefined, f.reader.token)).status, 200);
    assert.equal((await f.request('/templates/' + template.id + '/visibility', 'POST', { published: true }, f.author.token)).status, 200);
    assert.equal((await f.request('/templates/' + template.id)).status, 200);
  } finally { await f.cleanup(); }
});

test('拒绝越权版本、伪造官方标记、平台配置、无授权发布与静默模板替代', async () => {
  const f = await fixture();
  try {
    const path = '/projects/' + f.source.project.id + '/templates';
    assert.equal((await f.request(path, 'POST', f.payload)).status, 401);
    assert.equal((await f.request(path, 'POST', f.payload, f.reader.token)).status, 403);
    for (const patch of [{ rightsConfirmed: false }, { license: 'private' }, { official: true }, { command: '/bin/sh' }, { apiKey: 'secret' }, { prompt: '{{unknown}}' }]) {
      assert.equal((await f.request(path, 'POST', { ...f.payload, ...patch }, f.author.token)).status, 400);
    }
    const other = await (await f.request('/projects', 'POST', { prompt: '贪吃蛇' }, f.author.token)).json() as { version: { id: string } };
    assert.equal((await f.request(path, 'POST', { ...f.payload, versionId: other.version.id }, f.author.token)).status, 404);
    const { template } = await (await f.publish()).json() as { template: { id: string } };
    const before = (await f.store.listProjects(f.reader.token)).length;
    assert.equal((await f.request('/templates/' + template.id + '/use', 'POST', { mode: 'customize', values: { duration: 180 } }, f.reader.token)).status, 409);
    assert.equal((await f.store.listProjects(f.reader.token)).length, before);
    assert.equal((await f.request('/templates/' + template.id + '/use', 'POST', { mode: 'copy', values: { duration: 180 } }, f.reader.token)).status, 400);
    const copy = await (await f.request('/templates/' + template.id + '/use', 'POST', { mode: 'copy' }, f.reader.token)).json() as { project: { id: string; currentVersionId: string } };
    assert.equal((await f.request('/projects/' + copy.project.id + '/tasks', 'POST', { prompt: '修改' }, f.reader.token)).status, 409);
    assert.equal((await f.store.getProject(copy.project.id))?.currentVersionId, copy.project.currentVersionId);
    // 入队失败仍返回已经保存的副本，刷新后也能看到明确的重试提示。
    const busyHandler = createHandler({ store: f.store, env: { model: {} }, agent: {
      name: '队列已满', submit: async () => { throw new Error('queue_full'); }, cancel: async () => {},
      exclusive: async <T>(_id: string, action: () => Promise<T>) => action(),
    } });
    const queued = await busyHandler(new Request('https://myol.test/api/templates/' + template.id + '/use', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + f.reader.token },
      body: JSON.stringify({ mode: 'customize', values: { duration: 180 } }),
    }));
    assert.equal(queued.status, 201);
    const saved = await queued.json() as { project: { id: string }; warning: string };
    assert.match(saved.warning, /副本已保存/);
    assert.equal((await f.store.listVersions(saved.project.id)).length, 1);
    assert.ok((await f.store.listMessages(saved.project.id)).some((m) => m.role === 'system' && m.content.includes('未能入队')));
  } finally { await f.cleanup(); }
});

test('官方示例初始化幂等，复制后再次发布保留上游署名', async () => {
  const f = await fixture();
  try {
    await runTemplateSeed(f.store);
    await runTemplateSeed(f.store);
    const official = await f.store.listCreationTemplates({ kind: 'official', limit: 24, offset: 0 });
    assert.equal(official.total, 2);
    const { project, version } = await (await f.request('/templates/' + official.items[0]!.id + '/use', 'POST', { mode: 'copy' }, f.reader.token)).json() as { project: { id: string }; version: { id: string } };
    const republish = await f.request('/projects/' + project.id + '/templates', 'POST', { ...f.payload, versionId: version.id }, f.reader.token);
    assert.equal(republish.status, 201);
    const { template } = await republish.json() as { template: { id: string; attributions: unknown[] } };
    assert.equal(template.attributions.length, 1);
    const result = await (await f.request('/templates/' + template.id + '/use', 'POST', { mode: 'copy' }, f.author.token)).json() as { project: { id: string } };
    const derived = await f.store.getProject(result.project.id);
    assert.equal(derived?.templateOrigin?.attributions.length, 2);
    assert.equal(derived?.templateOrigin?.attributions[0]?.authorName, 'MYolGame 官方示例');
  } finally { await f.cleanup(); }
});
