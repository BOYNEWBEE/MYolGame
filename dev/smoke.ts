// 开发冒烟脚本：启动本地服务并走一遍核心链路（会话→创建项目→预览→社区列表）。
// 运行：node dev/smoke.ts

import { startLocalServer } from './local-server.ts';

const srv = await startLocalServer({
  port: Number(process.env.SMOKE_PORT ?? 8899),
  dataFile: new URL('../data/smoke-db.json', import.meta.url).pathname,
});
console.log('started', srv.url);

try {
  const meta = await fetch(srv.url + '/api/meta');
  console.log('meta', meta.status, (await meta.text()).slice(0, 160));

  const sessionRes = await fetch(srv.url + '/api/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const session = (await sessionRes.json()) as { token: string; nickname: string };
  console.log('session', sessionRes.status, session.nickname);

  const games = await fetch(srv.url + '/api/games');
  const gamesJson = (await games.json()) as { total: number };
  console.log('games', games.status, 'total=', gamesJson.total);

  const projRes = await fetch(srv.url + '/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + session.token },
    body: JSON.stringify({ prompt: '做一个霓虹风格的贪吃蛇，可以穿墙，速度快一点' }),
  });
  const proj = (await projRes.json()) as {
    project: { id: string; title: string };
    version: { id: string; spec: unknown };
  };
  console.log('project', projRes.status, proj.project?.title, JSON.stringify(proj.version?.spec));

  const preview = await fetch(
    srv.url + '/api/projects/' + proj.project.id + '/versions/' + proj.version.id + '/preview',
    { headers: { authorization: 'Bearer ' + session.token } },
  );
  const html = await preview.text();
  console.log('preview', preview.status, 'len=', html.length, 'canvas=', html.includes('<canvas'));

  const anonPreview = await fetch(
    srv.url + '/api/projects/' + proj.project.id + '/versions/' + proj.version.id + '/preview',
  );
  console.log('anon preview (expect 401):', anonPreview.status);
} finally {
  await srv.close();
}
process.exit(0);
