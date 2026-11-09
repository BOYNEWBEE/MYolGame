// 作者显式选择发布内容与授权；每次发布都创建独立的不可变快照。
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { requestJson } from '../api.ts';
import type { CreationTemplatePublic, TemplateParameter } from '@shared/creation-template.ts';
import type { VersionSummary } from '../types.ts';

interface ParameterDraft {
  id: string; label: string; type: 'number' | 'choice';
  min: string; max: string; value: string; choices: string;
}

export default function PublishTemplateForm({ projectId, version }: { projectId: string; version?: VersionSummary }): ReactNode {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [prompt, setPrompt] = useState('');
  const [versionLabel, setVersionLabel] = useState('1.0');
  const [parameters, setParameters] = useState<ParameterDraft[]>([]);
  const [license, setLicense] = useState('');
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publishedId, setPublishedId] = useState<string | null>(null);

  useEffect(() => { setRights(false); setPublishedId(null); }, [version?.id]);

  function add(type: ParameterDraft['type']): void {
    setParameters((items) => [...items, { id: 'p' + crypto.randomUUID().slice(0, 8),
      label: type === 'number' ? '单局时长（秒）' : '游戏难度', type,
      min: '30', max: '600', value: type === 'number' ? '120' : '普通', choices: '简单\n普通\n困难' }]);
  }
  function update(id: string, patch: Partial<ParameterDraft>): void {
    setParameters((items) => items.map((p) => p.id === id ? { ...p, ...patch } : p));
  }
  async function publish(): Promise<void> {
    if (!version || busy) return;
    setBusy(true); setError(null); setPublishedId(null);
    try {
      const parsed: TemplateParameter[] = parameters.map((p) => p.type === 'number'
        ? { id: p.id, label: p.label, type: 'number', min: Number(p.min), max: Number(p.max), default: Number(p.value) }
        : { id: p.id, label: p.label, type: 'choice', choices: p.choices.split('\n').map((c) => c.trim()).filter(Boolean), default: p.value.trim() });
      const result = await requestJson<{ template: CreationTemplatePublic }>('/projects/' + projectId + '/templates', {
        method: 'POST', body: { versionId: version.id, title, description, prompt, parameters: parsed,
          license, versionLabel, rightsConfirmed: rights },
      });
      setPublishedId(result.template.id);
    } catch (err) { setError(err instanceof Error ? err.message : '发布模板失败'); }
    finally { setBusy(false); }
  }
  return <section className="panel template-publisher">
    <h2>发布创作模板</h2>
    <p className="panel-note">绑定当前预览的 {version?.note || '版本'}，公开示例源码与创作需求，其他人可创建自己的私有副本。每次发布均为独立快照。</p>
    <details>
      <summary>填写模板介绍与可调参数</summary>
      <div className="template-form">
        <label className="field"><span className="field-label">模板标题</span><input value={title} maxLength={48} onChange={(e) => setTitle(e.target.value)} placeholder="例如：怪兽伙伴 · 森林肉鸽" /></label>
        <label className="field"><span className="field-label">模板介绍</span><textarea rows={3} value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} placeholder="介绍玩法、适合的创作方向，以及示例已经实现的内容" /></label>
        <label className="field"><span className="field-label">创作需求模板</span><textarea rows={4} value={prompt} maxLength={1200} onChange={(e) => setPrompt(e.target.value)} placeholder="说明哪些规则需要保留、哪些效果可以调整；不要填写密钥或私人信息" /></label>
        <div className="template-parameter-editor">
          <span className="field-label">可调参数（最多 6 个）</span>
          {parameters.map((p, index) => <fieldset key={p.id} className="parameter-editor">
            <legend>参数 {index + 1} · {p.type === 'number' ? '整数范围' : '下拉选项'}</legend>
            <label className="field"><span>参数名称</span><input value={p.label} maxLength={24} onChange={(e) => update(p.id, { label: e.target.value })} /></label>
            {p.type === 'number' ? <div className="parameter-range">
              <label>最小值<input type="number" value={p.min} min={0} max={10000} step={1} onChange={(e) => update(p.id, { min: e.target.value })} /></label>
              <label>最大值<input type="number" value={p.max} min={0} max={10000} step={1} onChange={(e) => update(p.id, { max: e.target.value })} /></label>
            </div> : <label className="field"><span>选项（每行一个，2–8 个）</span><textarea rows={3} value={p.choices} onChange={(e) => update(p.id, { choices: e.target.value })} /></label>}
            <label className="field"><span>默认值</span><input type={p.type === 'number' ? 'number' : 'text'} value={p.value} onChange={(e) => update(p.id, { value: e.target.value })} /></label>
            <p className="panel-note">选择结果会自动追加到需求；也可在需求中填写 <code>{'{{' + p.id + '}}'}</code>。</p>
            <button className="btn tiny" type="button" onClick={() => setParameters((items) => items.filter((item) => item.id !== p.id))}>移除此参数</button>
          </fieldset>)}
          <div className="template-actions">
            <button className="btn small" type="button" disabled={parameters.length >= 6} onClick={() => add('number')}>添加数字参数</button>
            <button className="btn small" type="button" disabled={parameters.length >= 6} onClick={() => add('choice')}>添加下拉参数</button>
          </div>
        </div>
        <label className="field"><span className="field-label">模板版本</span><input value={versionLabel} maxLength={20} onChange={(e) => setVersionLabel(e.target.value)} /></label>
        <label className="field"><span className="field-label">源码使用许可</span><select value={license} onChange={(e) => setLicense(e.target.value)}><option value="">请选择许可</option><option value="MIT">MIT（允许修改和再分享，保留许可与署名）</option></select></label>
        <label className="toggle"><input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} /><span>我有权以所选许可公开示例源码与其中的素材，并已试玩确认介绍与示例相符。</span></label>
        {error && <p className="error-banner" role="alert">{error}</p>}
        {publishedId && <p className="notice-banner" role="status">模板已发布。<Link to={'/templates/' + publishedId}>查看创作模板</Link></p>}
        <button className="btn primary block" type="button" disabled={busy || !version || !rights || !license || !title.trim() || !description.trim() || !prompt.trim()} onClick={() => void publish()}>{busy ? '发布中…' : '发布到模板社区'}</button>
      </div>
    </details>
  </section>;
}
