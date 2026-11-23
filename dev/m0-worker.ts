// 在独立云端调度进程中运行，不依赖浏览器在线；凭据只从服务端环境读取。
const origin = process.env.APP_ORIGIN ?? '';
const key = process.env.APP_M0_WORKER_KEY ?? '';
if (!/^https:\/\//.test(origin) || new URL(origin).origin !== origin || key.length < 32) {
  throw new Error('请通过安全环境配置 APP_ORIGIN 和至少 32 位 APP_M0_WORKER_KEY');
}
let stopped = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { stopped = true; });
while (!stopped) {
  try {
    const response = await fetch(origin + '/functions/v1/app/api/m0/worker', {
      method: 'POST', headers: { authorization: 'Bearer ' + key }, redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    await response.body?.cancel();
    if (!response.ok) console.error('M0 后台消费请求失败，HTTP', response.status);
  } catch { console.error('M0 后台消费暂不可用；队列仍在数据库中保留'); }
  await new Promise(resolve => setTimeout(resolve, 2000));
}
