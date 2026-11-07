import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePrompt } from '../functions/shared/prompt.ts';
import { buildSourcePackage } from '../functions/shared/source.ts';
import { createZip, crc32 } from '../functions/shared/zip.ts';
import { defaultSpec } from '../functions/shared/spec.ts';
import { createHandler, type HandlerEnv } from '../functions/handler.ts';
import { FileStore } from '../dev/store_file.ts';

// 在临时目录创建独立的 FileStore，避免测试间互相污染
type StoreFactory = () => Promise<{ store: FileStore; cleanup: () => void }>;
const newStore: StoreFactory = async () => {
  const dir = mkdtempSync(join(tmpdir(), 'myol-test-'));
  const filePath = join(dir, 'db.json');
  const store = new FileStore(filePath);
  await store.init();
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  return { store, cleanup };
};

const defaultEnv: HandlerEnv = { model: {} };

function newRequest(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {},
): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.token) headers['authorization'] = 'Bearer ' + options.token;
  return new Request('http://127.0.0.1/functions/v1/app/api' + path, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

describe('提示词解析', () => {
  test('识别玩法、主题、难度、速度、选项与标题', () => {
    const { spec, matched } = parsePrompt('《星际突围》：星空太空射击，困难难度，散射弹，快一点');
    assert.equal(spec.template, 'space-shooter');
    assert.equal(spec.theme, 'starfield');
    assert.equal(spec.difficulty, 'hard');
    assert.equal(spec.speed, 1.4);
    assert.equal(spec.options.spreadShot, true);
    assert.ok(matched.title);
  });

  test('不兼容选项被忽略并给出说明', () => {
    const { spec, matched, notes } = parsePrompt('做一个贪吃蛇，穿墙，挡板加宽');
    assert.equal(spec.template, 'snake');
    assert.equal(spec.options.wrapWalls, true);
    assert.deepEqual(matched.ignoredOptions, ['宽挡板']);
    assert.ok(notes.some((n) => n.includes('宽挡板') && n.includes('贪吃蛇')));
  });

  test('未识别到关键词时保持当前规格', () => {
    const base = defaultSpec('breakout', 'neon');
    const { spec, notes } = parsePrompt('随便做一下', base);
    assert.equal(spec.template, 'breakout');
    assert.equal(spec.theme, 'neon');
    assert.ok(notes.some((n) => n.includes('识别到可调整的关键词')));
  });
});

describe('ZIP 与源码包', () => {
  test('createZip 生成合法 ZIP 结构', () => {
    const bytes = createZip([
      { name: 'a.txt', content: 'hello' },
      { name: 'b/c.txt', content: 'world' },
    ]);
    assert.ok(bytes.length > 30);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(view.getUint32(0, true), 0x04034b50, '本地文件头签名');
    const end = bytes.subarray(bytes.length - 22);
    const endView = new DataView(end.buffer, end.byteOffset, end.length);
    assert.equal(endView.getUint32(0, true), 0x06054b50, '中央目录结束签名');
    assert.equal(endView.getUint16(8, true), 2, '文件数');
  });

  test('crc32 可重复计算', () => {
    const a = new TextEncoder().encode('hello');
    const b = new TextEncoder().encode('hello');
    assert.equal(crc32(a), crc32(b));
    assert.notEqual(crc32(a), crc32(new TextEncoder().encode('world')));
  });

  test('buildSourcePackage 包含所需文件与生成说明', () => {
    const spec = defaultSpec('snake', 'retro');
    spec.options.wrapWalls = true;
    const html = '<!doctype html><canvas></canvas>';
    const zip = buildSourcePackage({
      spec,
      html,
      mode: 'template',
      versionNote: 'v1',
      createdAt: new Date().toISOString(),
    });
    const text = new TextDecoder().decode(zip);
    assert.ok(text.includes('index.html'));
    assert.ok(text.includes('README.md'));
    assert.ok(text.includes('spec.json'));
    assert.ok(text.includes('LICENSE'));
    assert.ok(text.includes('模板生成'));
    assert.ok(text.includes('穿墙'));
  });
});

describe('handler 权限与路由', () => {
  test('匿名可访问公开游戏，私有项目受保护', async () => {
    const { store, cleanup } = await newStore();
    try {
      const handler = createHandler({ store, env: defaultEnv });

      // 创建会话与项目
      const sessionRes = await handler(newRequest('/session', { method: 'POST', body: {} }));
      assert.equal(sessionRes.status, 200);
      const { token } = (await sessionRes.json()) as { token: string };

      const createRes = await handler(
        newRequest('/projects', {
          method: 'POST',
          body: { prompt: '做一个贪吃蛇' },
          token,
        }),
      );
      assert.equal(createRes.status, 201);
      const { project } = (await createRes.json()) as { project: { id: string } };

      // 无令牌不能访问项目详情
      const anonProject = await handler(newRequest('/projects/' + project.id));
      assert.equal(anonProject.status, 401);

      // 伪造他人令牌不能访问
      const bad = await handler(newRequest('/projects/' + project.id, { token: 'not-owner' }));
      assert.equal(bad.status, 401);

      // 所有者可以访问
      const owner = await handler(newRequest('/projects/' + project.id, { token }));
      assert.equal(owner.status, 200);
    } finally {
      cleanup();
    }
  });

  test('发布后可被匿名浏览、收藏与取消收藏', async () => {
    const { store, cleanup } = await newStore();
    try {
      const handler = createHandler({ store, env: defaultEnv });

      const sessionRes = await handler(newRequest('/session', { method: 'POST', body: {} }));
      const { token } = (await sessionRes.json()) as { token: string };

      const createRes = await handler(
        newRequest('/projects', {
          method: 'POST',
          body: { prompt: '做一个打砖块' },
          token,
        }),
      );
      const { project } = (await createRes.json()) as { project: { id: string } };

      const publishRes = await handler(
        newRequest('/projects/' + project.id + '/publish', {
          method: 'POST',
          body: {},
          token,
        }),
      );
      assert.equal(publishRes.status, 200);
      const { game } = (await publishRes.json()) as { game: { id: string } };

      // 匿名可浏览
      const publicRes = await handler(newRequest('/games/' + game.id));
      assert.equal(publicRes.status, 200);

      // 匿名不能收藏
      const anonFav = await handler(
        newRequest('/games/' + game.id + '/favorite', { method: 'PUT' }),
      );
      assert.equal(anonFav.status, 401);

      // 登录用户可收藏
      const fav = await handler(
        newRequest('/games/' + game.id + '/favorite', { method: 'PUT', token }),
      );
      assert.equal(fav.status, 200);
      const favJson = (await fav.json()) as { favorited: boolean; favorites: number };
      assert.equal(favJson.favorited, true);
      assert.equal(favJson.favorites, 1);

      // 取消收藏
      const unfav = await handler(
        newRequest('/games/' + game.id + '/favorite', { method: 'DELETE', token }),
      );
      assert.equal(unfav.status, 200);
      const unfavJson = (await unfav.json()) as { favorited: boolean; favorites: number };
      assert.equal(unfavJson.favorited, false);
      assert.equal(unfavJson.favorites, 0);
    } finally {
      cleanup();
    }
  });
});

describe('FileStore 持久化', () => {
  test('数据在重新初始化后保留', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'myol-persist-'));
    const filePath = join(dir, 'db.json');
    try {
      const store1 = new FileStore(filePath);
      await store1.init();
      const session = {
        token: 't1',
        nickname: '测试',
        official: false,
        createdAt: new Date().toISOString(),
      };
      await store1.createSession(session);

      const store2 = new FileStore(filePath);
      await store2.init();
      const found = await store2.getSession('t1');
      assert.ok(found);
      assert.equal(found!.nickname, '测试');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
