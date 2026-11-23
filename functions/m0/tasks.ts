// 模拟任务的状态和事件同存一行，以版本条件写入防止多 Worker 重复推进。
import type { DatabaseClient } from '../store_supabase.ts';
import { fail, input, json, quota, rows, sha256 } from './core.ts';
import type { CloudUser } from './auth.ts';

export interface M0Event { sequence: number; stage: string; message: string; at: string }
export interface M0Task {
  id: string; owner_id: string; prompt: string; status: string; revision: number;
  created_at: string; next_at: number; events: M0Event[]; simulated: boolean;
}
const labels: Record<string, string> = { queued: '模拟任务已入队', running: '模拟执行中，不调用 AI', checking: '模拟检查中，不产生游戏', succeeded: 'M0 模拟任务完成；这不是游戏生成结果', cancelled: '模拟任务已取消' };
export const taskView = (task: M0Task) => ({ id: task.id, prompt: task.prompt, status: task.status, revision: task.revision, createdAt: task.created_at, simulated: true, events: task.events });
const event = (sequence: number, stage: string): M0Event => ({ sequence, stage, message: labels[stage]!, at: new Date().toISOString() });
const active = ['queued', 'running', 'checking'];

export async function tick(db: DatabaseClient): Promise<number> {
  let processed = 0;
  for (const stage of ['checking', 'running', 'queued']) {
    const found = rows<M0Task>(await db.from('myol_m0_tasks').select('*').eq('status', stage).order('next_at', { ascending: true }).limit(10));
    for (const task of found) {
      if (task.next_at > Date.now()) continue;
      const next = stage === 'queued' ? 'running' : stage === 'running' ? 'checking' : 'succeeded';
      const changed = rows(await db.from('myol_m0_tasks').update({ status: next, revision: task.revision + 1, next_at: Date.now() + 1500, events: [...task.events, event(task.revision + 1, next)] })
        .eq('id', task.id).eq('revision', task.revision).eq('status', stage).select('id'));
      processed += changed.length;
    }
  }
  return processed;
}

export async function taskRoute(db: DatabaseClient, req: Request, path: string, user: CloudUser): Promise<Response | null> {
  if (path === '/api/m0/tasks') {
    if (req.method === 'GET') {
      const tasks = rows<M0Task>(await db.from('myol_m0_tasks').select('*').eq('owner_id', user.id).order('created_at', { ascending: false }).limit(50));
      return json({ items: tasks.map(taskView), simulated: true });
    }
    if (req.method !== 'POST') return fail(405, 'method_not_allowed', '不支持的请求方法');
    const body = await input(req);
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    const key = req.headers.get('idempotency-key') ?? '';
    if (!/^[0-9a-f-]{36}$/i.test(key) || !prompt || prompt.length > 2000) return fail(400, 'invalid_input', '需求须为 1–2000 字，并提供 UUID 幂等键');
    const id = await sha256(user.id + ':' + key);
    const existing = rows<M0Task>(await db.from('myol_m0_tasks').select('*').eq('id', id).eq('owner_id', user.id).limit(1))[0];
    if (existing) {
      if (existing.prompt !== prompt) return fail(409, 'idempotency_conflict', '同一提交标识不能用于不同需求');
      return json({ task: taskView(existing), recovered: true }, 200);
    }
    await quota(db, 'tasks:' + user.id, 20, 3600000);
    const task: M0Task = { id, owner_id: user.id, prompt, status: 'queued', revision: 1, created_at: new Date().toISOString(), next_at: Date.now(), events: [event(1, 'queued')], simulated: true };
    const inserted = rows(await db.from('myol_m0_tasks').insertIfAbsent(task, { onConflict: 'id' }).select('id'));
    if (inserted.length) return json({ task: taskView(task) }, 202);
    const winner = rows<M0Task>(await db.from('myol_m0_tasks').select('*').eq('id', id).eq('owner_id', user.id).limit(1))[0];
    if (!winner || winner.prompt !== prompt) return fail(409, 'idempotency_conflict', '提交标识发生冲突');
    return json({ task: taskView(winner), recovered: true });
  }
  const match = /^\/api\/m0\/tasks\/([a-f0-9]{64})(?:\/(events|cancel))?$/.exec(path);
  if (!match) return null;
  const task = rows<M0Task>(await db.from('myol_m0_tasks').select('*').eq('id', match[1]).eq('owner_id', user.id).limit(1))[0];
  if (!task) return fail(404, 'task_not_found', '任务不存在或无权访问');
  if (match[2] === 'cancel') {
    if (req.method !== 'POST') return fail(405, 'method_not_allowed', '不支持的请求方法');
    if (!active.includes(task.status)) return json({ task: taskView(task) });
    const result = rows(await db.from('myol_m0_tasks').update({ status: 'cancelled', revision: task.revision + 1, events: [...task.events, event(task.revision + 1, 'cancelled')] })
      .eq('id', task.id).eq('owner_id', user.id).eq('revision', task.revision).select('*'));
    if (!result.length) return fail(409, 'write_conflict', '任务状态已变化，请刷新后重试');
    return json({ task: taskView(result[0] as M0Task) });
  }
  if (req.method !== 'GET') return fail(405, 'method_not_allowed', '不支持的请求方法');
  if (match[2] !== 'events') return json({ task: taskView(task) });
  const cursorValue = req.headers.get('last-event-id') ?? new URL(req.url).searchParams.get('after') ?? '0';
  const cursor = Number(cursorValue);
  if (!Number.isSafeInteger(cursor) || cursor < 0) return fail(400, 'invalid_cursor', '事件序号不合法');
  // 有界 SSE 快照流：断线后按序号重连，只读持久化事件，绝不重新提交任务。
  const payload = task.events.filter(e => e.sequence > cursor).map(e => `id: ${e.sequence}\nevent: stage\ndata: ${JSON.stringify(e)}\n\n`).join('');
  return new Response('retry: 1500\n\n' + payload + ': snapshot-end\n\n', { headers: {
    'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'private, no-store', 'x-accel-buffering': 'no',
  } });
}
