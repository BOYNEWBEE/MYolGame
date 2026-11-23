// 完全离线的 HTTPS 实验运行器：合成账号与 SDK 替身，不读取线上凭据或真实用户数据。
import { createServer } from 'node:https';
import { readFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createM0Application } from '../functions/m0/app.ts';
import { createQcaExperiment } from '../functions/qca/experiment.ts';
import { M0TestDatabase } from '../tests/helpers/m0-db.ts';
import { QcaFixture } from './qca-fixture.ts';

export async function startQcaLab(options: { port?: number; directory?: string; autoComplete?: boolean } = {}) {
  const directory = options.directory ?? '.runtime/qca-lab';
  await mkdir(directory, { recursive: true });
  const key = join(directory, 'key.pem'), cert = join(directory, 'cert.pem');
  const generated = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  if (generated.status !== 0) throw new Error('生成本地临时证书失败，请检查 openssl');
  const db = new M0TestDatabase(), cloud = new QcaFixture(); cloud.autoComplete = options.autoComplete ?? true;
  let origin = '';
  const application = createM0Application({ db, origin: () => origin, workerKey: () => '',
    experiment: createQcaExperiment({ db, cloud, model: () => 'fixture-model', ready: () => true, fixture: true }) });
  const server = createServer({ key: await readFile(key), cert: await readFile(cert) }, async (req, res) => {
    try {
      const path = (req.url ?? '/').split('?')[0]!;
      if (path.startsWith('/functions/')) {
        const chunks: Buffer[] = []; let length = 0;
        for await (const part of req) { length += part.length; if (length > 8192) { res.writeHead(413); res.end(); return; } chunks.push(part); }
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
        const response = await application(new Request(origin + req.url, { method: req.method, headers,
          ...(['GET', 'HEAD'].includes(req.method ?? 'GET') ? {} : { body: Buffer.concat(chunks) }) }));
        res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return;
      }
      // 本实验只提供构建目录中的已知资源，应用路径统一回退首页。
      if (path.startsWith('/assets/') && !/^\/assets\/[A-Za-z0-9_.-]+$/.test(path)) { res.writeHead(404); res.end(); return; }
      const file = path.startsWith('/assets/') ? join('web/dist', path) : 'web/dist/index.html';
      res.setHeader('content-type', extname(file) === '.js' ? 'text/javascript' : extname(file) === '.css' ? 'text/css' : 'text/html');
      res.end(await readFile(file));
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise<void>(resolve => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  origin = 'https://127.0.0.1:' + (server.address() as { port: number }).port;
  return { origin, db, cloud, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const lab = await startQcaLab({ port: Number(process.env.PORT ?? 8790) });
  console.log('受控 Cloud Agents 实验（非真实模型）：' + lab.origin + '/account');
  console.log('临时自签名证书仅用于本机；账号数据仅在内存中，停止后消失。');
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void lab.close(); });
}
