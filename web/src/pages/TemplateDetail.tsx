// 先展示原始示例；参数只用于新项目中的 Agent 修改，不改变社区示例。
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { API_BASE, requestJson } from '../api.ts';
import { useSession } from '../session.tsx';
import SandboxFrame from '../components/SandboxFrame.tsx';
import { compileTemplatePrompt, type CreationTemplatePublic } from '@shared/creation-template.ts';
import { verificationLabel } from './Templates.tsx';
import type { ProjectSummary } from '../types.ts';

export default function TemplateDetail(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const session = useSession();
  const [template, setTemplate] = useState<CreationTemplatePublic | null>(null);
  const [agentAvailable, setAgentAvailable] = useState(false);
  const [values, setValues] = useState<Record<string, string | number>>({});
  const [extraPrompt, setExtraPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const data = await requestJson<{ template: CreationTemplatePublic; agentAvailable: boolean }>('/templates/' + id);
    setTemplate(data.template); setAgentAvailable(data.agentAvailable);
    setValues(Object.fromEntries(data.template.parameters.map((p) => [p.id, p.default])));
  }, [id]);
  useEffect(() => { void load().catch((err: unknown) => setError(err instanceof Error ? err.message : '模板加载失败')); }, [load]);
  const compiled = useMemo(() => {
    if (!template) return { prompt: '', error: '' };
    try { return { prompt: compileTemplatePrompt(template, values, extraPrompt).prompt, error: '' }; }
    catch (err) { return { prompt: '', error: (err as { message?: string }).message || '参数不合法' }; }
  }, [template, values, extraPrompt]);
  async function useTemplate(mode: 'copy' | 'customize'): Promise<void> {
    if (!id || busy) return;
    setBusy(true); setError(null);
    try {
      const data = await requestJson<{ project: ProjectSummary; warning?: string }>('/templates/' + id + '/use', {
        method: 'POST', body: mode === 'copy' ? { mode } : { mode, values, extraPrompt },
      });
      navigate('/projects/' + data.project.id, { state: { notice: data.warning } });
    } catch (err) { setError(err instanceof Error ? err.message : '套用失败'); setBusy(false); }
  }
  async function toggleVisibility(): Promise<void> {
    if (!template || busy) return;
    setBusy(true); setError(null);
    try {
      await requestJson('/templates/' + id + '/visibility', { method: 'POST', body: { published: !template.published } });
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : '操作失败'); }
    finally { setBusy(false); }
  }
  if (!template) return <div className="page empty-state"><h1>{error || '正在加载创作模板…'}</h1><Link to="/templates" className="btn">返回社区模板</Link></div>;
  return <div className="page template-detail-page">
    <div className="page-head"><Link to="/templates">← 社区创作模板</Link><h1>{template.title}</h1><p>{template.description}</p><div className="badges"><span className="badge">{template.official ? '官方示例' : '用户模板'}</span><span className="badge">v{template.versionLabel}</span><span className="badge">{verificationLabel(template.verification)}</span>{!template.published && <span className="badge">已下架，仅作者可见</span>}</div></div>
    {error && <p className="error-banner" role="alert">{error}</p>}
    <div className="template-detail-layout">
      <section className="template-example"><h2>示例试玩</h2><p className="panel-note">这是发布时的固定示例；右侧选择将在新项目开发完成后生效。</p><SandboxFrame src={API_BASE + '/templates/' + template.id + '/play'} title={template.title + ' 示例试玩'} authenticated={!template.published} />
        <div className="panel template-source"><p>作者：{template.authorName} · 模板版本：{template.versionLabel} · 示例版本：{template.sourceVersionNote}</p><p>源码许可：<a href="https://opensource.org/license/mit" target="_blank" rel="noreferrer">MIT</a>。套用会保留来源署名与许可。</p><p className="muted small">{new Date(template.createdAt).toLocaleString('zh-CN')} 发布。验证标记描述示例的已有检查，不代表所有参数组合都已验证。</p>{template.attributions.length > 0 && <details><summary>上游模板来源</summary><ul>{template.attributions.map((a, i) => <li key={i}><Link to={'/templates/' + a.templateId}>{a.title}</Link> · {a.authorName} · {a.versionLabel}</li>)}</ul></details>}{template.owned && <button className="btn" disabled={busy} type="button" onClick={() => void toggleVisibility()}>{template.published ? '下架此模板' : '重新上架模板'}</button>}<p className="panel-note">下架后停止公开浏览和新用户套用，已经创建的项目保持独立。</p></div>
      </section>
      <section className="panel template-customize"><h2>搭配你的版本</h2>
        {template.parameters.length === 0 && <p className="muted">此模板没有结构化参数，可填写补充需求。</p>}
        {template.parameters.map((p) => <label className="field" key={p.id}><span className="field-label">{p.label}</span>{p.type === 'choice' ? <select value={values[p.id]} onChange={(e) => setValues((v) => ({ ...v, [p.id]: e.target.value }))}>{p.choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}</select> : <input type="number" min={p.min} max={p.max} step={1} value={values[p.id] ?? p.default} onChange={(e) => setValues((v) => ({ ...v, [p.id]: e.target.value === '' ? '' : Number(e.target.value) }))} />}<span className="muted small">默认：{p.default}{p.type === 'number' ? ' · 范围 ' + p.min + '–' + p.max : ''}</span></label>)}
        <label className="field"><span className="field-label">补充你的创意（可选）</span><textarea rows={4} maxLength={500} value={extraPrompt} onChange={(e) => setExtraPrompt(e.target.value)} placeholder="例如：加入新的伙伴、敌人或关卡规则" /></label>
        <details className="template-requirements"><summary>查看本次创作需求</summary><p>{compiled.prompt || compiled.error}</p></details>
        {compiled.error && <p className="error-banner" role="alert">{compiled.error}</p>}
        {!agentAvailable && <p className="panel-note">当前未启用 Agent 源码开发，可以先原样套用和试玩；启用后可继续修改。</p>}
        <button type="button" className="btn primary block" disabled={busy || !session.ready || !agentAvailable || Boolean(compiled.error)} onClick={() => void useTemplate('customize')}>{busy ? '正在创建…' : '按参数创建并生成'}</button>
        <button type="button" className="btn block" disabled={busy || !session.ready} onClick={() => void useTemplate('copy')}>原样套用示例</button>
        <p className="panel-note">将创建你的私有项目并保留原版。模板作者无法访问你的草稿；再次发布由你决定。</p>
      </section>
    </div>
  </div>;
}
