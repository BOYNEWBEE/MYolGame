// M0 云端验收面板：刷新恢复只读任务，不重新提交；事件按序号去重。
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE, requestJson } from '../api.ts';
import { useSession } from '../session.tsx';
interface Stage { sequence: number; stage: string; message: string; at: string }
interface Task { id: string; prompt: string; status: string; revision: number; simulated: boolean; events: Stage[] }
interface Command { key: string; prompt: string }
const terminal = (s: string) => ['succeeded', 'cancelled', 'failed'].includes(s);
const labels: Record<string, string> = { queued: '排队中', running: '模拟执行中', checking: '模拟检查中', succeeded: '模拟完成', cancelled: '已取消' };
export default function M0() {
  const session = useSession();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selected, setSelected] = useState<Task | null>(null);
  const [prompt, setPrompt] = useState('');
  const [command, setCommand] = useState<Command | null>(null);
  const [error, setError] = useState('');
  const [stream, setStream] = useState('');
  const [busy, setBusy] = useState(false);
  const storageKey = 'myol.m0.pending:' + session.account?.username;
  useEffect(() => {
    if (!session.cloudM0 || !session.account) return;
    let disposed = false;
    try {
      const saved: Command | null = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
      if (saved && typeof saved.key === 'string' && typeof saved.prompt === 'string') { setCommand(saved); setPrompt(saved.prompt); }
    } catch { /* 无效临时标识不作为提交依据。 */ }
    void requestJson<{ items: Task[] }>('/m0/tasks').then(data => {
      if (!disposed) { setTasks(data.items); setSelected(data.items[0] ?? null); }
    }).catch(e => { if (!disposed) setError(e instanceof Error ? e.message : '任务读取失败'); });
    return () => { disposed = true; };
  }, [session.cloudM0, session.account?.username, storageKey]);
  useEffect(() => {
    if (!selected || terminal(selected.status)) return;
    const source = new EventSource(API_BASE + '/m0/tasks/' + selected.id + '/events');
    setStream('正在连接进度…');
    source.onopen = () => setStream('进度已连接');
    source.onerror = () => setStream('进度连接中断，正在按事件序号重连；不会重复提交任务');
    const receive = (message: MessageEvent<string>) => {
      const stage: Stage = JSON.parse(message.data);
      setSelected(previous => previous ? { ...previous, status: stage.stage, revision: stage.sequence, events: [...previous.events.filter(e => e.sequence !== stage.sequence), stage].sort((a, b) => a.sequence - b.sequence) } : previous);
      setTasks(previous => previous.map(task => task.id === selected.id ? { ...task, status: stage.stage, revision: stage.sequence, events: [...task.events.filter(e => e.sequence !== stage.sequence), stage].sort((a, b) => a.sequence - b.sequence) } : task));
      if (terminal(stage.stage)) { source.close(); setStream('任务已结束'); }
    };
    source.addEventListener('stage', receive as EventListener);
    return () => source.close();
  }, [selected?.id]);
  async function submit(e: FormEvent) {
    e.preventDefault(); if (busy) return;
    const next = command ?? { key: crypto.randomUUID(), prompt: prompt.trim() };
    if (command && prompt.trim() !== command.prompt) { setError('请先恢复原提交结果，再提交新的需求'); return; }
    setBusy(true); setError('');
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next)); setCommand(next);
      const result = await requestJson<{ task: Task }>('/m0/tasks', { method: 'POST', body: { prompt: next.prompt }, headers: { 'idempotency-key': next.key } });
      sessionStorage.removeItem(storageKey); setCommand(null); setPrompt('');
      setTasks(previous => [result.task, ...previous.filter(t => t.id !== result.task.id)]); setSelected(result.task);
    } catch (e) { setError((e instanceof Error ? e.message : '提交失败') + '。可使用原标识再次查询／提交恢复结果。'); }
    finally { setBusy(false); }
  }
  async function cancel() {
    if (!selected || busy) return;
    setBusy(true); setError('');
    try {
      const result = await requestJson<{ task: Task }>('/m0/tasks/' + selected.id + '/cancel', { method: 'POST', body: {} });
      setSelected(result.task); setTasks(previous => previous.map(t => t.id === result.task.id ? result.task : t));
    } catch (e) { setError(e instanceof Error ? e.message : '取消失败'); }
    finally { setBusy(false); }
  }
  if (!session.ready) return <div className="page">正在恢复会话…</div>;
  if (!session.cloudM0) return <div className="page">此页面用于云端 M0 验收；当前服务未启用。</div>;
  if (!session.account) return <div className="page"><h1>云端 M0 任务</h1><p>请先登录邮箱账号再创建任务。</p><Link to="/account">登录 / 注册</Link></div>;
  return <div className="page">
    <h1>云端 M0 模拟任务</h1>
    <p>本阶段验证账号、数据库队列和进度恢复。不会调用模型或生成游戏；关闭网页后由独立后台调度继续执行。</p>
    <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
      <label>模拟任务需求<textarea required maxLength={2000} value={prompt} onChange={e => setPrompt(e.target.value)} /></label>
      <button className="btn primary" disabled={busy || !prompt.trim()}>{busy ? '处理中…' : command ? '恢复原提交结果' : '创建模拟任务'}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    <h2>我的任务</h2>
    {!tasks.length && <p>暂无任务。</p>}
    <ul>{tasks.map(t => <li key={t.id}><button className="btn" onClick={() => setSelected(t)}>{t.prompt} · {labels[t.status] ?? t.status}</button></li>)}</ul>
    {selected && <section><h2>模拟进度：{labels[selected.status] ?? selected.status}</h2><p>{stream}</p>
      <ol>{selected.events.map(e => <li key={e.sequence}>{e.message}</li>)}</ol>
      {!terminal(selected.status) && <><button className="btn" disabled={busy} onClick={() => void cancel()}>取消模拟任务</button><p>若任务持续排队，请检查云端后台调度进程是否正在运行。</p></>}
    </section>}
  </div>;
}
