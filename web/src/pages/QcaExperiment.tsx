// 实验入口不替换 M0；仅在服务端明确启用时显示，不自动重放结果未知的操作。
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { requestJson } from '../api.ts';
import { useSession } from '../session.tsx';
import { embedGamePolicy } from '@shared/artifact.ts';
interface Job { id: string; prompt: string; state: string; revision: number; output: string; execution: 'fixture' | 'cloud' }
const steps = new Set(['new', 'agent_ready', 'environment_ready', 'session_ready']);
const labels: Record<string, string> = { new: '待初始化', creating_agent: 'Agent 创建结果待确认', agent_ready: 'Agent 已准备', creating_environment: '独立环境创建结果待确认', environment_ready: '环境已准备', creating_session: '会话创建结果待确认', session_ready: '会话已准备', dispatching: '需求派发结果待确认', submitted: '云端运行中', completed: '结果已保存', failed: '云端执行失败', cancelling: '取消结果待确认', cancel_requested: '已请求取消，等待确认', cancelled: '已取消' };
export default function QcaExperiment() {
  const session = useSession();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [prompt, setPrompt] = useState('生成一个可用空格开始、方向键操作、R 重启的 Canvas 贪吃蛇小游戏。');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [execution, setExecution] = useState('cloud');
  const [preview, setPreview] = useState(false);
  const inFlight = useRef(false);
  const owner = session.account?.username;
  const storageKey = 'myol.qca.pending:' + owner;
  function save(value: Job) { setJob(value); setJobs(previous => [value, ...previous.filter(j => j.id !== value.id)]); }
  useEffect(() => {
    if (!session.qcaExperiment || !session.account) return;
    let cancelled = false;
    void Promise.all([requestJson<{ items: Job[] }>('/qca/jobs'), requestJson<{ configured: boolean; execution: string }>('/qca/config')])
      .then(([list, config]) => {
        if (cancelled) return;
        setJobs(list.items); setJob(list.items[0] ?? null); setConfigured(config.configured); setExecution(config.execution);
        try {
          const command = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
          if (command?.prompt) { setPrompt(command.prompt); setError('存在待确认的提交，点击开始将使用原标识恢复，不创建重复任务。'); }
        } catch { /* 无效本地提交标识不能作为新请求。 */ }
      }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : '读取失败'); });
    return () => { cancelled = true; };
  }, [session.qcaExperiment, owner, storageKey]);
  // 只在已确认被云端受理后轮询读取和归档，不派发消息；关闭网页不会终止云端任务。
  useEffect(() => {
    if (!job || !['submitted', 'cancel_requested'].includes(job.state)) return;
    let cancelled = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await requestJson<{ job: Job }>('/qca/jobs/' + job.id + '/refresh', { method: 'POST', body: {} });
        if (!cancelled) save(result.job);
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : '进度读取失败'); }
      if (!cancelled) timer = setTimeout(() => void poll(), 4000);
    };
    void poll(); return () => { cancelled = true; clearTimeout(timer); };
  }, [job?.id, job?.state]);
  async function advance(value: Job) {
    let current = value;
    // 每一步是已知成功后的下一条新命令；状态不变或结果未知时立即停止。
    for (let i = 0; i < 4 && steps.has(current.state); i++) {
      const result = await requestJson<{ job: Job; error?: { message: string } }>('/qca/jobs/' + current.id + '/advance', { method: 'POST', body: { revision: current.revision } });
      save(result.job);
      if (result.error) setError(result.error.message);
      if (result.job.revision === current.revision || !steps.has(result.job.state)) return;
      current = result.job;
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault(); if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(''); setPreview(false);
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
      const command = saved ?? { key: crypto.randomUUID(), prompt: prompt.trim() };
      if (saved && saved.prompt !== prompt.trim()) throw new Error('请先恢复原提交，避免结果未知时创建另一任务');
      sessionStorage.setItem(storageKey, JSON.stringify(command));
      const result = await requestJson<{ job: Job }>('/qca/jobs', { method: 'POST', body: { prompt: command.prompt }, headers: { 'idempotency-key': command.key } });
      save(result.job); sessionStorage.removeItem(storageKey);
      await advance(result.job);
    } catch (e) { setError(e instanceof Error ? e.message : '提交失败，请查看原任务状态'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function action(name: 'reconcile' | 'cancel' | 'advance') {
    if (!job || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      if (name === 'advance') await advance(job);
      else {
        const result = await requestJson<{ job: Job; pending?: boolean }>('/qca/jobs/' + job.id + '/' + name, { method: 'POST', body: {} });
        save(result.job);
        if (result.pending) setError('结果仍未确认，保留原意图，不会自动重新创建或派发。');
      }
    } catch (e) { setError(e instanceof Error ? e.message : '操作失败'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  if (!session.ready) return <div className="page">正在恢复身份…</div>;
  if (!session.qcaExperiment) return <div className="page">当前部署未启用新路线实验。</div>;
  if (!session.account) return <div className="page"><Link to="/account">请先登录邮箱账号</Link></div>;
  return <div className="page">
    <h1>Cloud Agents 新路线实验</h1>
    <p>{execution === 'fixture' ? '本地受控接口演示，不调用真实模型。' : '此实验调用真实 Cloud Agents，可能消耗额度。'}仅验证单轮 HTML 生成与恢复，不代表游戏玩法、构建或浏览器检查通过。</p>
    {!configured && <p role="status">Cloud Agents 尚未配置，真实执行未启用。</p>}
    <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
      <label>实验需求<textarea required maxLength={2000} value={prompt} onChange={e => setPrompt(e.target.value)} /></label>
      <button className="btn primary" disabled={!configured || busy || !prompt.trim()}>开始实验</button>
    </form>
    {error && <p role="alert">{error}</p>}
    <h2>我的实验任务</h2>
    <ul>{jobs.map(j => <li key={j.id}><button className="btn" onClick={() => { setJob(j); setPreview(false); }}>{j.prompt} · {labels[j.state] ?? j.state}</button></li>)}</ul>
    {job && <section><h2>状态：{labels[job.state] ?? job.state}</h2>
      {steps.has(job.state) && <button className="btn" disabled={busy} onClick={() => void action('advance')}>继续初始化</button>}
      {!steps.has(job.state) && !['submitted', 'completed', 'failed', 'cancelled', 'cancel_requested'].includes(job.state) && <button className="btn" disabled={busy} onClick={() => void action('reconcile')}>核对原操作结果</button>}
      {!['completed', 'failed', 'cancelled', 'cancel_requested'].includes(job.state) && <button className="btn" disabled={busy} onClick={() => void action('cancel')}>取消实验任务</button>}
      {job.output && <><h3>保存的候选源码／回复</h3><textarea aria-label="候选结果" readOnly value={job.output} style={{ width: '100%', minHeight: 220 }} />
        <button className="btn" onClick={() => { const url = URL.createObjectURL(new Blob([job.output], { type: 'text/plain' })); const a = document.createElement('a'); a.href = url; a.download = 'qca-candidate.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>下载候选源码</button>
        {job.state === 'completed' && /<html[\s>]/i.test(job.output) && <button className="btn" onClick={() => setPreview(!preview)}>试玩候选 HTML（未验收）</button>}
        {preview && <iframe title="实验候选试玩" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={embedGamePolicy(job.output)} style={{ width: '100%', height: 480, border: 0 }} />}
      </>}
      <p>云端受理后可以关闭页面；重新进入时读取同一任务。结果在后续查询时归档到数据库，尚未接回调。创建或派发结果未知时需核对，不会自动重发。</p>
    </section>}
  </div>;
}
