// 业务路由：与运行时无关（Web Request/Response），本地 Node 与云端 Deno Edge Function 共用。
// 身份模型：匿名会话 + 创作者令牌（原型级，非完整账号系统，界面与文档均已注明）。
// 生成游戏通过独立沙箱页面预览；业务进程不执行生成的脚本。

import { buildCommunityRoutes } from './community.ts';
import { retainAttributions } from './shared/creation-template.ts';
import { generateGame } from './generate.ts';
import type { AgentService } from './agent.ts';
import { GAME_CSP, embedGamePolicy } from './shared/artifact.ts';
import { buildSourcePackage } from './shared/source.ts';
import {
  DIFFICULTIES,
  TEMPLATES,
  TEMPLATE_IDS,
  THEMES,
  THEME_IDS,
  defaultSpec,
  sanitizeSpec,
  type Difficulty,
  type GameSpec,
  type TemplateId,
  type ThemeId,
} from './shared/spec.ts';
import { modelConfigured, type ModelEnv } from './shared/model.ts';
import { musicConfigured, parseMusicSettingsInput, type MusicEnv } from './shared/music.ts';
import type {
  Game,
  GameFilter,
  Message,
  Project,
  Session,
  Store,
  TaskRecord,
  Version,
} from './store.ts';

export interface HandlerEnv {
  model: ModelEnv;
  music?: MusicEnv;
}

export interface HandlerDeps {
  store: Store;
  env: HandlerEnv;
  agent?: AgentService;
}

const ID_RE = /^[0-9a-fA-F-]{8,64}$/;
const MAX_BODY = 64 * 1024;
const MAX_PROMPT = 2000;
const MAX_DESCRIPTION = 500;

interface HttpError {
  status: number;
  code: string;
  message: string;
}

function httpError(status: number, code: string, message: string): HttpError {
  return { status, code, message };
}

function isHttpError(value: unknown): value is HttpError {
  return (
    typeof value === 'object' && value !== null && 'code' in value && 'status' in value &&
    typeof (value as HttpError).status === 'number'
  );
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

function fail(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

function gameHtmlResponse(html: string, downloadName?: string): Response {
  const headers: Record<string, string> = {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    // 生成的游戏是自包含单文件：禁止一切网络加载，只允许内联脚本/样式
    'content-security-policy': GAME_CSP,
  };
  if (downloadName) {
    headers['content-disposition'] =
      "attachment; filename=\"game.html\"; filename*=UTF-8''" + encodeURIComponent(downloadName) + '.html';
  }
  return new Response(html, { status: 200, headers });
}

function zipResponse(bytes: Uint8Array, name: string): Response {
  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'cache-control': 'no-store',
      'content-disposition': "attachment; filename=\"source.zip\"; filename*=UTF-8''" + encodeURIComponent(name) + '.zip',
    },
  });
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  const length = Number(req.headers.get('content-length') ?? '0');
  if (length > MAX_BODY) throw httpError(413, 'body_too_large', '请求体过大');
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw httpError(400, 'invalid_json', '请求体不是合法 JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw httpError(400, 'invalid_json', '请求体必须是 JSON 对象');
  }
  return raw as Record<string, unknown>;
}

function requireString(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw httpError(400, 'invalid_field', field + ' 必须是非空字符串');
  }
  if (value.length > max) {
    throw httpError(400, 'invalid_field', field + ' 超长（最多 ' + max + ' 字符）');
  }
  return value.trim();
}

function optionalString(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return requireString(value, field, max);
}

function sanitizeNickname(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[<>{}$`\\\u0000-\u001f\u007f]/g, '').trim().slice(0, 20);
}

async function authenticate(deps: HandlerDeps, req: Request, required: boolean): Promise<Session | null> {
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    if (required) throw httpError(401, 'auth_required', '需要创作者令牌，请先创建会话');
    return null;
  }
  const session = await deps.store.getSession(token);
  if (!session) {
    if (required) throw httpError(401, 'auth_invalid', '会话不存在或已失效，请刷新页面重建会话');
    return null;
  }
  return session;
}

// 账号保存的网关优先于服务端环境变量：显式配置失败时回退为无配乐，而不是悄悄换用运营方密钥。
async function musicForSession(deps: HandlerDeps, session: Session): Promise<MusicEnv | undefined> {
  const settings = await deps.store.getMusicSettings(session.token);
  if (settings) return { apiUrl: settings.apiUrl, apiKey: settings.apiKey, name: settings.name ?? undefined };
  return deps.env.music;
}

async function musicSettingsView(deps: HandlerDeps, session: Session): Promise<Record<string, unknown>> {
  const settings = await deps.store.getMusicSettings(session.token);
  const account = settings && settings.apiKey
    ? { apiUrl: settings.apiUrl, name: settings.name, hasKey: true }
    : null;
  const server = musicConfigured(deps.env.music);
  return {
    account,
    server: server ? { name: deps.env.music?.name ?? null } : null,
    effective: account ? 'account' : server ? 'server' : 'none',
  };
}

function publicGame(game: Game, favorited: boolean): Record<string, unknown> {
  return {
    id: game.id,
    title: game.title,
    description: game.description,
    spec: game.spec,
    authorName: game.authorName,
    official: game.official,
    allowDownload: game.allowDownload,
    plays: game.plays,
    favorites: game.favorites,
    generationMode: game.generationMode,
    createdAt: game.createdAt,
    favorited,
  };
}

function versionSummary(version: Version): Record<string, unknown> {
  return {
    id: version.id,
    projectId: version.projectId,
    parentId: version.parentId,
    prompt: version.prompt,
    spec: version.spec,
    note: version.note,
    generationMode: version.generationMode,
    artifactHash: version.artifactHash,
    checks: version.checks,
    agentName: version.agentName,
    templateOrigin: version.templateOrigin,
    createdAt: version.createdAt,
  };
}

function projectSummary(project: Project): Record<string, unknown> {
  return {
    id: project.id,
    title: project.title,
    spec: project.spec,
    currentVersionId: project.currentVersionId,
    visibility: project.visibility,
    gameId: project.gameId,
    allowDownload: project.allowDownload,
    templateOrigin: project.templateOrigin,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

async function getOwnedProject(deps: HandlerDeps, id: string, session: Session): Promise<Project> {
  if (!ID_RE.test(id)) throw httpError(400, 'invalid_id', '项目 ID 不合法');
  const project = await deps.store.getProject(id);
  if (!project) throw httpError(404, 'project_not_found', '项目不存在');
  if (project.ownerToken !== session.token) {
    throw httpError(403, 'forbidden', '无权访问他人项目');
  }
  return project;
}

// 创建任务并同步执行生成；任务记录（含阶段日志）持久化保存，供工作台展示真实历史。
async function runGenerationTask(
  deps: HandlerDeps,
  project: Project,
  prompt: string,
  specOverride: unknown,
  music?: MusicEnv,
): Promise<{ task: TaskRecord; version: Version; notes: string[] }> {
  if (project.templateOrigin) throw httpError(409, 'agent_required', '此项目基于社区源码模板，修改需要启用 Agent 源码开发');
  const baseSpec = specOverride
    ? sanitizeSpec(specOverride, project.spec)
    : project.spec;

  const now = new Date().toISOString();
  const task: TaskRecord = {
    id: crypto.randomUUID(),
    projectId: project.id,
    prompt,
    status: 'failed',
    stages: [],
    versionId: null,
    error: null,
    generationMode: 'template',
    createdAt: now,
    finishedAt: null,
  };
  await deps.store.addTask(task);
  await deps.store.addMessage({
    id: crypto.randomUUID(),
    projectId: project.id,
    role: 'user',
    content: prompt,
    taskId: task.id,
    createdAt: now,
  });

  const result = await generateGame({ prompt, baseSpec, env: deps.env.model, music });
  task.stages = result.stages;
  task.generationMode = result.mode;
  task.finishedAt = new Date().toISOString();

  if (!result.ok) {
    task.status = 'failed';
    task.error = result.error;
    await deps.store.updateTask(task);
    await deps.store.addMessage({
      id: crypto.randomUUID(),
      projectId: project.id,
      role: 'system',
      content: '生成失败：' + (result.error ?? '未知错误') + '。已保留上一个版本。',
      taskId: task.id,
      createdAt: task.finishedAt,
    });
    throw httpError(422, 'generation_failed', '生成失败：' + (result.error ?? '未知错误'));
  }

  const version: Version = {
    id: crypto.randomUUID(),
    projectId: project.id,
    parentId: project.currentVersionId,
    prompt,
    spec: result.spec,
    html: result.html,
    note: 'v' + ((await deps.store.listVersions(project.id)).length + 1),
    generationMode: result.mode,
    createdAt: task.finishedAt,
  };
  await deps.store.createVersion(version);

  task.status = 'succeeded';
  task.versionId = version.id;
  await deps.store.updateTask(task);

  project.currentVersionId = version.id;
  project.spec = result.spec;
  project.title = result.spec.title;
  project.updatedAt = version.createdAt;
  await deps.store.updateProject(project);

  const summaryParts = [
    '玩法：' + (TEMPLATES.find((t) => t.id === result.spec.template)?.name ?? result.spec.template),
    '主题：' + (THEMES.find((t) => t.id === result.spec.theme)?.name ?? result.spec.theme),
    '难度：' + (DIFFICULTIES.find((d) => d.id === result.spec.difficulty)?.name ?? result.spec.difficulty),
    '速度：' + result.spec.speed + 'x',
  ];
  if (result.matched.options.length > 0) summaryParts.push('玩法选项：' + result.matched.options.join('、'));
  await deps.store.addMessage({
    id: crypto.randomUUID(),
    projectId: project.id,
    role: 'system',
    content:
      (result.mode === 'model' ? '【模型辅助生成】' : '【模板生成】') +
      version.note + ' 已就绪。' + summaryParts.join('，') + '。' +
      (result.notes.length > 0 ? '\n' + result.notes.join('\n') : ''),
    taskId: task.id,
    createdAt: version.createdAt,
  });

  return { task, version, notes: result.notes };
}

type RouteContext = {
  deps: HandlerDeps;
  req: Request;
  params: string[];
  query: URLSearchParams;
};

export type Route = {
  method: string;
  pattern: RegExp;
  handle: (ctx: RouteContext) => Promise<Response>;
};

function buildRoutes(): Route[] {
  return [
    ...buildCommunityRoutes({ authenticate, getOwnedProject, readBody, json, gameHtmlResponse, projectSummary, versionSummary }),
    {
      method: 'GET',
      pattern: /^\/api\/meta$/,
      handle: async ({ deps }) =>
        json({
          siteName: 'MYolGame',
          generationMode: deps.agent ? 'agent' : modelConfigured(deps.env.model) ? 'model' : 'template',
          agent: { configured: Boolean(deps.agent), name: deps.agent?.name ?? null },
          model: {
            configured: modelConfigured(deps.env.model),
            name: deps.env.model.name ?? null,
          },
          music: {
            configured: musicConfigured(deps.env.music),
            name: deps.env.music?.name ?? null,
          },
          identityNotice:
            '初版使用匿名会话与创作者令牌（保存在浏览器本地），不是完整账号系统：换浏览器或清除数据后无法找回项目。',
          templates: TEMPLATES,
          themes: THEMES.map((t) => ({ id: t.id, name: t.name, palette: t.palette })),
          difficulties: DIFFICULTIES,
          templateIds: TEMPLATE_IDS,
          themeIds: THEME_IDS,
          limits: { promptMaxLength: MAX_PROMPT, descriptionMaxLength: MAX_DESCRIPTION },
        }),
    },
    {
      method: 'GET',
      pattern: /^\/api\/music\/settings$/,
      handle: async ({ deps, req }) => {
        const session = await authenticate(deps, req, true);
        return json(await musicSettingsView(deps, session!), 200, { 'cache-control': 'no-store' });
      },
    },
    {
      method: 'PUT',
      pattern: /^\/api\/music\/settings$/,
      handle: async ({ deps, req }) => {
        const session = await authenticate(deps, req, true);
        const body = await readBody(req);
        const previous = await deps.store.getMusicSettings(session!.token);
        const parsed = parseMusicSettingsInput(body, previous?.apiKey);
        if (!parsed.ok) return fail(400, 'invalid_music_settings', parsed.error);
        await deps.store.saveMusicSettings({
          ownerToken: session!.token,
          apiUrl: parsed.apiUrl,
          apiKey: parsed.apiKey,
          name: parsed.name,
          updatedAt: new Date().toISOString(),
        });
        return json(await musicSettingsView(deps, session!), 200, { 'cache-control': 'no-store' });
      },
    },
    {
      method: 'DELETE',
      pattern: /^\/api\/music\/settings$/,
      handle: async ({ deps, req }) => {
        const session = await authenticate(deps, req, true);
        await deps.store.deleteMusicSettings(session!.token);
        return json(await musicSettingsView(deps, session!), 200, { 'cache-control': 'no-store' });
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/session$/,
      handle: async ({ deps, req }) => {
        let body: Record<string, unknown> = {};
        try {
          body = await readBody(req);
        } catch {
          // 会话创建允许空请求体
        }
        const nickname = sanitizeNickname(body.nickname) || '匿名创作者-' + Math.floor(1000 + Math.random() * 9000);
        const session: Session = {
          token: crypto.randomUUID(),
          nickname,
          official: false,
          createdAt: new Date().toISOString(),
        };
        await deps.store.createSession(session);
        return json({ token: session.token, nickname: session.nickname });
      },
    },
    {
      method: 'GET',
      pattern: /^\/api\/session$/,
      handle: async ({ deps, req }) => {
        const session = await authenticate(deps, req, true);
        return json({ nickname: session!.nickname, official: session!.official });
      },
    },
    {
      method: 'GET',
      pattern: /^\/api\/games$/,
      handle: async ({ deps, query, req }) => {
        const template = query.get('category') ?? query.get('template') ?? undefined;
        const filter: GameFilter = {
          template: TEMPLATE_IDS.includes(template as TemplateId) ? (template as TemplateId) : undefined,
          q: (query.get('q') ?? '').slice(0, 60) || undefined,
          sort: query.get('sort') === 'hot' ? 'hot' : 'new',
          limit: Math.min(48, Math.max(1, Number(query.get('limit') ?? 24) || 24)),
          offset: Math.max(0, Number(query.get('offset') ?? 0) || 0),
        };
        const theme = query.get('theme') ?? undefined;
        if (THEME_IDS.includes(theme as ThemeId)) filter.theme = theme as ThemeId;
        const difficulty = query.get('difficulty') ?? undefined;
        if (difficulty === 'easy' || difficulty === 'normal' || difficulty === 'hard') {
          filter.difficulty = difficulty as Difficulty;
        }
        const { items, total } = await deps.store.listGames(filter);
        const session = await authenticate(deps, req, false);
        const favoriteIds = session
          ? new Set(await deps.store.listFavoriteGameIds(session.token))
          : new Set<string>();
        return json({
          items: items.map((g) => publicGame(g, favoriteIds.has(g.id))),
          total,
          limit: filter.limit,
          offset: filter.offset,
        });
      },
    },
    {
      method: 'GET',
      pattern: /^\/api\/games\/([^/]+)$/,
      handle: async ({ deps, params, req }) => {
        const game = await deps.store.getGame(params[0]!);
        if (!game) throw httpError(404, 'game_not_found', '游戏不存在或未公开');
        const session = await authenticate(deps, req, false);
        const favorited = session ? await deps.store.isFavorite(session.token, game.id) : false;
        return json({ game: publicGame(game, favorited) });
      },
    },
    {
      method: 'GET',
      pattern: /^\/api\/games\/([^/]+)\/play$/,
      handle: async ({ deps, params }) => {
        const game = await deps.store.getGame(params[0]!);
        if (!game) throw httpError(404, 'game_not_found', '游戏不存在或未公开');
        const version = await deps.store.getVersion(game.versionId);
        if (!version) throw httpError(404, 'version_not_found', '游戏版本数据缺失');
        await deps.store.incrementPlays(game.id);
        return gameHtmlResponse(retainAttributions(version.html, version.templateOrigin));
      },
    },
    {
      method: 'GET',
      pattern: /^\/api\/games\/([^/]+)\/download$/,
      handle: async ({ deps, params }) => {
        const game = await deps.store.getGame(params[0]!);
        if (!game) throw httpError(404, 'game_not_found', '游戏不存在或未公开');
        if (!game.allowDownload) throw httpError(403, 'download_disabled', '创作者未开放该游戏下载');
        const version = await deps.store.getVersion(game.versionId);
        if (!version) throw httpError(404, 'version_not_found', '游戏版本数据缺失');
        return gameHtmlResponse(retainAttributions(version.html, version.templateOrigin), game.title);
      },
    },
    {
      method: 'PUT',
      pattern: /^\/api\/games\/([^/]+)\/favorite$/,
      handle: async ({ deps, req, params }) => {
        const session = await authenticate(deps, req, true);
        const game = await deps.store.getGame(params[0]!);
        if (!game) throw httpError(404, 'game_not_found', '游戏不存在或未公开');
        await deps.store.setFavorite(session!.token, game.id, true);
        const count = await deps.store.countFavorites(game.id);
        return json({ favorited: true, favorites: count });
      },
    },
    {
      method: 'DELETE',
      pattern: /^\/api\/games\/([^/]+)\/favorite$/,
      handle: async ({ deps, req, params }) => {
        const session = await authenticate(deps, req, true);
        const game = await deps.store.getGame(params[0]!);
        if (!game) throw httpError(404, 'game_not_found', '游戏不存在或未公开');
        await deps.store.setFavorite(session!.token, game.id, false);
        const count = await deps.store.countFavorites(game.id);
        return json({ favorited: false, favorites: count });
      },
    },
    {
      method: 'GET',
      pattern: /^\/api\/favorites$/,
      handle: async ({ deps, req }) => {
        const session = await authenticate(deps, req, true);
        const ids = await deps.store.listFavoriteGameIds(session!.token);
        const games: Game[] = [];
        for (const id of ids) {
          const game = await deps.store.getGame(id);
          if (game) games.push(game);
        }
        return json({ items: games.map((g) => publicGame(g, true)), total: games.length });
      },
    },
    {
      method: 'GET',
      pattern: /^\/api\/projects$/,
      handle: async ({ deps, req }) => {
        const session = await authenticate(deps, req, true);
        const projects = await deps.store.listProjects(session!.token);
        return json({ items: projects.map(projectSummary) });
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/projects$/,
      handle: async ({ deps, req }) => {
        const session = await authenticate(deps, req, true);
        const body = await readBody(req);
        const prompt = requireString(body.prompt, '提示词', MAX_PROMPT);

        const now = new Date().toISOString();
        const initialSpec = body.spec ? sanitizeSpec(body.spec) : defaultSpec();
        const project: Project = {
          id: crypto.randomUUID(),
          ownerToken: session!.token,
          title: initialSpec.title,
          spec: initialSpec,
          currentVersionId: '',
          visibility: 'private',
          gameId: null,
          allowDownload: true,
          createdAt: now,
          updatedAt: now,
        };
        await deps.store.createProject(project);
        await deps.store.addMessage({
          id: crypto.randomUUID(),
          projectId: project.id,
          role: 'system',
          content: '项目已创建（私有草稿）。' + (deps.agent ? 'Agent 将在后台开发并检查游戏。' : modelConfigured(deps.env.model) ? '' : '当前平台未配置真实模型，处于模板模式。'),
          taskId: null,
          createdAt: now,
        });

        try {
          if (deps.agent) {
            const task = await deps.agent.submit(project, prompt, initialSpec);
            return json({ project: projectSummary(project), task }, 202);
          }
          const { task, version } = await runGenerationTask(deps, project, prompt, body.spec, await musicForSession(deps, session!));
          return json(
            { project: projectSummary(project), version: versionSummary(version), task },
            201,
          );
        } catch (error) {
          // 生成失败保留空项目，方便用户修改提示词重试
          if (isHttpError(error)) return fail(error.status, error.code, error.message);
          throw error;
        }
      },
    },
    {
      method: 'GET',
      pattern: /^\/api\/projects\/([^/]+)$/,
      handle: async ({ deps, req, params }) => {
        const session = await authenticate(deps, req, true);
        const project = await getOwnedProject(deps, params[0]!, session!);
        const versions = await deps.store.listVersions(project.id);
        const messages = await deps.store.listMessages(project.id);
        const tasks = await deps.store.listTasks(project.id);
        return json({
          project: projectSummary(project),
          versions: versions.map(versionSummary),
          messages,
          tasks,
        });
      },
    },
    {
      method: 'DELETE',
      pattern: /^\/api\/projects\/([^/]+)$/,
      handle: async ({ deps, req, params }) => {
        const session = await authenticate(deps, req, true);
        const project = await getOwnedProject(deps, params[0]!, session!);
        if (deps.agent) {
          for (const task of await deps.store.listTasks(project.id)) {
            if (!task.finishedAt) await deps.agent.cancel(task);
          }
        }
        if (project.gameId) await deps.store.deleteGame(project.gameId);
        await deps.store.deleteProject(project.id);
        return json({ ok: true });
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/projects\/([^/]+)\/tasks$/,
      handle: async ({ deps, req, params }) => {
        const session = await authenticate(deps, req, true);
        const project = await getOwnedProject(deps, params[0]!, session!);
        const body = await readBody(req);
        const prompt = requireString(body.prompt, '提示词', MAX_PROMPT);
        if (deps.agent) {
          const task = await deps.agent.submit(project, prompt, sanitizeSpec(body.spec, project.spec));
          return json({ project: projectSummary(project), task }, 202);
        }
        const { task, version } = await runGenerationTask(deps, project, prompt, body.spec, await musicForSession(deps, session!));
        return json(
          { project: projectSummary(project), version: versionSummary(version), task },
          201,
        );
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/projects\/([^/]+)\/restore$/,
      handle: async ({ deps, req, params }) => {
        const session = await authenticate(deps, req, true);
        const project = await getOwnedProject(deps, params[0]!, session!);
        const body = await readBody(req);
        const versionId = requireString(body.versionId, '版本 ID', 64);
        const version = await deps.store.getVersion(versionId);
        if (!version || version.projectId !== project.id) {
          throw httpError(404, 'version_not_found', '版本不存在');
        }
        const now = new Date().toISOString();
        project.currentVersionId = version.id;
        project.spec = version.spec;
        project.title = version.spec.title;
        project.updatedAt = now;
        await deps.store.updateProject(project);
        await deps.store.addMessage({
          id: crypto.randomUUID(),
          projectId: project.id,
          role: 'system',
          content: '已回退到历史版本 ' + version.note + '（' + version.createdAt + '）。回退只影响工作台当前版本，公开游戏需重新发布才会更新。',
          taskId: null,
          createdAt: now,
        });
        return json({ project: projectSummary(project) });
      },
    },
    {
      method: 'GET',
      pattern: /^\/api\/projects\/([^/]+)\/tasks\/([^/]+)$/,
      handle: async ({ deps, req, params }) => {
        const session = await authenticate(deps, req, true);
        const project = await getOwnedProject(deps, params[0]!, session!);
        const task = await deps.store.getTask(params[1]!);
        if (!task || task.projectId !== project.id) throw httpError(404, 'task_not_found', '任务不存在');
        return json({ task });
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/projects\/([^/]+)\/tasks\/([^/]+)\/cancel$/,
      handle: async ({ deps, req, params }) => {
        const session = await authenticate(deps, req, true);
        const project = await getOwnedProject(deps, params[0]!, session!);
        const task = await deps.store.getTask(params[1]!);
        if (!task || task.projectId !== project.id) throw httpError(404, 'task_not_found', '任务不存在');
        if (deps.agent) await deps.agent.cancel(task);
        return json({ task });
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/projects\/([^/]+)\/publish$/,
      handle: async ({ deps, req, params }) => {
        const session = await authenticate(deps, req, true);
        const project = await getOwnedProject(deps, params[0]!, session!);
        const body = await readBody(req).catch(() => ({}) as Record<string, unknown>);
        const description = optionalString(body.description, '介绍', MAX_DESCRIPTION) ??
          project.spec.title + '：由 MYolGame 创作的网页小游戏（基础玩法：' +
          (TEMPLATES.find((t) => t.id === project.spec.template)?.name ?? project.spec.template) +
          '），欢迎试玩。';
        const allowDownload = body.allowDownload === undefined ? project.allowDownload : body.allowDownload === true;

        const version = await deps.store.getVersion(project.currentVersionId);
        if (!version) throw httpError(422, 'no_version', '项目还没有成功的版本，无法发布');

        const now = new Date().toISOString();
        const existing = await deps.store.getGameByProject(project.id);
        const game: Game = {
          id: existing?.id ?? crypto.randomUUID(),
          projectId: project.id,
          versionId: version.id,
          title: project.title,
          description,
          spec: version.spec,
          template: version.spec.template,
          theme: version.spec.theme,
          difficulty: version.spec.difficulty,
          authorName: session!.nickname,
          official: session!.official,
          allowDownload,
          plays: existing?.plays ?? 0,
          favorites: existing ? await deps.store.countFavorites(existing.id) : 0,
          generationMode: version.generationMode,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        await deps.store.upsertGame(game);
        project.visibility = 'public';
        project.gameId = game.id;
        project.allowDownload = allowDownload;
        project.updatedAt = now;
        await deps.store.updateProject(project);
        await deps.store.addMessage({
          id: crypto.randomUUID(),
          projectId: project.id,
          role: 'system',
          content: '已将版本 ' + version.note + ' 发布到社区（公开可玩）。',
          taskId: null,
          createdAt: now,
        });
        return json({ game: publicGame(game, false) });
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/projects\/([^/]+)\/unpublish$/,
      handle: async ({ deps, req, params }) => {
        const session = await authenticate(deps, req, true);
        const project = await getOwnedProject(deps, params[0]!, session!);
        if (project.gameId) await deps.store.deleteGame(project.gameId);
        project.visibility = 'private';
        project.gameId = null;
        project.updatedAt = new Date().toISOString();
        await deps.store.updateProject(project);
        await deps.store.addMessage({
          id: crypto.randomUUID(),
          projectId: project.id,
          role: 'system',
          content: '已从社区下架，项目恢复为私有草稿。',
          taskId: null,
          createdAt: project.updatedAt,
        });
        return json({ project: projectSummary(project) });
      },
    },
    {
      method: 'GET',
      pattern: /^\/api\/projects\/([^/]+)\/versions\/([^/]+)\/preview$/,
      handle: async ({ deps, req, params }) => {
        const session = await authenticate(deps, req, true);
        const project = await getOwnedProject(deps, params[0]!, session!);
        const version = await deps.store.getVersion(params[1]!);
        if (!version || version.projectId !== project.id) {
          throw httpError(404, 'version_not_found', '版本不存在');
        }
        // srcDoc 不继承响应头；为自由生成的完整 HTML 加上前置资源限制。
        return gameHtmlResponse(embedGamePolicy(retainAttributions(version.html, version.templateOrigin)));
      },
    },
    {
      method: 'GET',
      pattern: /^\/api\/projects\/([^/]+)\/versions\/([^/]+)\/download$/,
      handle: async ({ deps, req, params }) => {
        const session = await authenticate(deps, req, true);
        const project = await getOwnedProject(deps, params[0]!, session!);
        const version = await deps.store.getVersion(params[1]!);
        if (!version || version.projectId !== project.id) {
          throw httpError(404, 'version_not_found', '版本不存在');
        }
        return gameHtmlResponse(retainAttributions(version.html, version.templateOrigin), version.spec.title + '-' + version.note);
      },
    },
    {
      method: 'GET',
      pattern: /^\/api\/projects\/([^/]+)\/source$/,
      handle: async ({ deps, req, params, query }) => {
        const session = await authenticate(deps, req, true);
        const project = await getOwnedProject(deps, params[0]!, session!);
        const versionId = query.get('versionId') ?? project.currentVersionId;
        const version = await deps.store.getVersion(versionId);
        if (!version || version.projectId !== project.id) {
          throw httpError(404, 'version_not_found', '版本不存在');
        }
        const bytes = buildSourcePackage({
          spec: version.spec,
          html: version.html,
          mode: version.generationMode,
          versionNote: version.note,
          createdAt: version.createdAt,
          templateOrigin: version.templateOrigin,
        });
        return zipResponse(bytes, project.title + '-source');
      },
    },
  ];
}

const ROUTES = buildRoutes();

export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  return async function handle(req: Request): Promise<Response> {
    let url: URL;
    try {
      url = new URL(req.url);
    } catch {
      return fail(400, 'invalid_url', '无效的请求地址');
    }

    // 兼容多种部署路径：截取 /api 之后的业务路径（网关可能剥离前缀）
    const fullPath = url.pathname;
    const apiIndex = fullPath.indexOf('/api/');
    if (apiIndex < 0 && fullPath !== '/api') {
      return fail(404, 'not_found', '接口不存在');
    }
    const path = apiIndex >= 0 ? fullPath.slice(apiIndex) : '/api';

    try {
      for (const route of ROUTES) {
        const match = route.pattern.exec(path);
        if (!match) continue;
        if (route.method !== req.method) continue;
        const context = {
          deps,
          req,
          params: match.slice(1),
          query: url.searchParams,
        };
        // 项目变更与 Worker 的最终提交共用锁，避免回退、删除和提交交错覆盖。
        if (deps.agent && req.method !== 'GET' && path.startsWith('/api/projects/')) {
          return await deps.agent.exclusive(match[1]!, () => route.handle(context));
        }
        return await route.handle(context);
      }
      // 路径匹配但方法不允许
      for (const route of ROUTES) {
        if (route.pattern.test(path)) {
          return fail(405, 'method_not_allowed', '不支持的请求方法');
        }
      }
      return fail(404, 'not_found', '接口不存在');
    } catch (error) {
      if (isHttpError(error)) return fail(error.status, error.code, error.message);
      console.error('handler_error', error instanceof Error ? error.message : String(error));
      return fail(503, 'server_error', '服务暂时不可用，请稍后重试');
    }
  };
}
