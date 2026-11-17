// 本地 API + 静态服务：把 functions/handler.ts 挂载到 Node http 上，
// 使用文件存储做真实持久化（data/db.json），路径与 Qoder Sites 部署保持一致
// （浏览器同源调用 /functions/v1/app/api/...）。

import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHandler, type HandlerEnv } from '../functions/handler.ts';
import { withLocalAccounts } from './local-accounts.ts';
import { FileStore } from './store_file.ts';
import { runSeed } from './seed.ts';
import { runTemplateSeed } from './template-seed.ts';
import type { Store } from '../functions/store.ts';
import { LocalAgent, recoverAgentTasks } from './agent/controller.ts';
import { loadAgentConfig } from './agent/config.ts';
import type { AgentConfig } from './agent/protocol.ts';

export interface LocalServerOptions {
  port?: number;
  dataFile?: string;
  distDir?: string;
  store?: Store;
  env?: HandlerEnv;
  seed?: boolean;
  agent?: AgentConfig | false;
  sandboxDir?: string;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

function handlerEnvFromProcess(): HandlerEnv {
  return {
    model: {
      apiUrl: process.env.MYOLGAME_MODEL_API_URL || undefined,
      apiKey: process.env.MYOLGAME_MODEL_API_KEY || undefined,
      name: process.env.MYOLGAME_MODEL_NAME || undefined,
    },
    music: {
      apiUrl: process.env.MYOLGAME_MUSIC_API_URL || undefined,
      apiKey: process.env.MYOLGAME_MUSIC_API_KEY || undefined,
      name: process.env.MYOLGAME_MUSIC_NAME || undefined,
    },
  };
}

async function toWebRequest(req: IncomingMessage, urlOverride?: string): Promise<Request> {
  const host = req.headers.host ?? '127.0.0.1';
  const url = urlOverride ?? 'http://' + host + (req.url ?? '/');
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value);
    else if (Array.isArray(value)) for (const item of value) headers.append(key, item);
  }
  const method = req.method ?? 'GET';
  let body: Uint8Array | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks: Uint8Array[] = [];
    for await (const chunk of req) chunks.push(chunk as Uint8Array);
    body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
  }
  return new Request(url, {
    method,
    headers,
    body,
    duplex: 'half',
  } as RequestInit);
}

async function writeWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (!response.body) {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
  }
  res.end();
}

async function serveStatic(
  res: ServerResponse,
  distDir: string,
  pathname: string,
): Promise<boolean> {
  let filePath: string;
  try {
    filePath = normalize(join(distDir, pathname));
  } catch {
    return false;
  }
  if (!filePath.startsWith(normalize(distDir))) return false; // 防目录穿越

  const candidates = pathname === '/' ? [join(distDir, 'index.html')] : [filePath];
  if (!extname(pathname)) candidates.push(join(distDir, 'index.html')); // SPA 回退

  for (const candidate of candidates) {
    try {
      const data = await readFile(candidate);
      res.statusCode = 200;
      res.setHeader('content-type', MIME[extname(candidate)] ?? 'application/octet-stream');
      res.setHeader('cache-control', 'no-store');
      res.end(data);
      return true;
    } catch {
      // 尝试下一个候选
    }
  }
  return false;
}

export async function startLocalServer(options: LocalServerOptions = {}): Promise<{
  port: number;
  url: string;
  close: () => Promise<void>;
}> {
  const rootDir = fileURLToPath(new URL('..', import.meta.url));
  const dataFile = options.dataFile ?? join(rootDir, 'data', 'db.json');
  const distDir = options.distDir ?? join(rootDir, 'web', 'dist');
  const store = options.store ?? new FileStore(dataFile);
  const config = options.agent === false ? undefined : options.agent ?? loadAgentConfig();
  if (config && !(store instanceof FileStore)) throw new Error('本地 Agent 需要使用 FileStore');
  const agent = config ? new LocalAgent(store as FileStore, config, options.sandboxDir ?? join(rootDir, '.sandboxes')) : undefined;
  const businessHandler = createHandler({ store, env: options.env ?? handlerEnvFromProcess(), agent });
  const handler = store instanceof FileStore ? withLocalAccounts(store, businessHandler) : businessHandler;
  let ready = false;

  const server = createHttpServer(async (req, res) => {
    if (!ready) { res.statusCode = 503; res.end('服务初始化中'); return; }
    const pathname = (req.url ?? '/').split('?')[0]!;
    try {
      if (pathname.startsWith('/functions/')) {
        const response = await handler(await toWebRequest(req));
        await writeWebResponse(res, response);
        return;
      }
      if (pathname.startsWith('/api/')) {
        // 便捷别名：/api/* 等价于 /functions/v1/app/api/*
        const raw = req.url ?? '/';
        const query = raw.includes('?') ? raw.slice(raw.indexOf('?')) : '';
        const response = await handler(
          await toWebRequest(req, 'http://' + (req.headers.host ?? '127.0.0.1') + '/functions/v1/app' + pathname + query),
        );
        await writeWebResponse(res, response);
        return;
      }
      if (await serveStatic(res, distDir, pathname)) return;
      res.statusCode = 404;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({
        error: { code: 'not_found', message: '未找到页面。开发模式请通过 Vite (http://127.0.0.1:5173) 访问前端；API 位于 /functions/v1/app/api/...' },
      }));
    } catch (error) {
      console.error('local_server_error', error instanceof Error ? error.message : String(error));
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    }
  });

  const port = options.port ?? Number(process.env.PORT ?? 8787);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  try {
    // 先占用监听端口；重复启动失败时，不触碰正在使用的数据和任务。
    await store.init();
    if (options.seed !== false) { await runSeed(store); await runTemplateSeed(store); }
    if (agent) await agent.init();
    else await recoverAgentTasks(store);
    ready = true;
  } catch (error) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw error;
  }
  const actualPort = (server.address() as { port: number }).port;
  return {
    port: actualPort,
    url: 'http://127.0.0.1:' + actualPort,
    close: async () => {
      await agent?.close();
      return new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    },
  };
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === new URL('file://' + process.argv[1]).href;

if (isMain) {
  const started = await startLocalServer();
  console.log('[api] MYolGame 本地 API 服务已启动：' + started.url + '/functions/v1/app/api/meta');
  console.log('[api] 数据文件：data/db.json（真实持久化）');
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => { void started.close().then(() => process.exit(0)); });
  }
}
