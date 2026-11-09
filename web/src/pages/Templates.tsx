// 社区模板目录：官方示例、用户发布、作者自己的上架与下架快照。
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { requestJson } from '../api.ts';
import { useSession } from '../session.tsx';
import Cover from '../components/Cover.tsx';
import type { CreationTemplatePublic } from '@shared/creation-template.ts';

const filters = [{ id: 'all', label: '全部模板' }, { id: 'official', label: '官方示例' }, { id: 'community', label: '用户发布' }, { id: 'mine', label: '我的模板' }];
export const verificationLabel = (value: CreationTemplatePublic['verification']) => value === 'browser-smoke' ? '示例通过浏览器烟测' : value === 'template-render' ? '示例由内置模板生成' : '示例待试玩确认';

export default function Templates(): ReactNode {
  const session = useSession();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<CreationTemplatePublic[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (filter === 'mine' && !session.ready) return;
    let cancelled = false;
    setLoading(true); setError(null);
    const params = new URLSearchParams({ q, limit: '12', offset: String(page * 12) });
    if (filter === 'mine') params.set('mine', 'true');
    else if (filter !== 'all') params.set('kind', filter);
    requestJson<{ items: CreationTemplatePublic[]; total: number }>('/templates?' + params)
      .then((data) => { if (!cancelled) { setItems(data.items); setTotal(data.total); } })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : '模板加载失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filter, q, page, session.ready]);
  return <div className="page templates-page">
    <div className="page-head"><h1>社区创作模板</h1><p className="muted">从可玩的示例出发，搭配参数、补充创意，创建属于自己的游戏。</p></div>
    <div className="panel template-directory-intro"><p>每个模板包含一份固定示例、创作需求与可调参数。先试玩，再原样套用或交给 Agent 修改。</p><Link className="btn" to="/projects">从我的项目发布模板</Link></div>
    <div className="browse-bar">
      <div className="chips" aria-label="模板来源">{filters.map((item) => <button className={'chip' + (filter === item.id ? ' active' : '')} type="button" key={item.id} aria-pressed={filter === item.id} onClick={() => { setFilter(item.id); setPage(0); }}>{item.label}</button>)}</div>
      <form className="template-search" onSubmit={(e) => { e.preventDefault(); setQ(search.trim()); setPage(0); }}><input type="search" className="search-input" aria-label="搜索创作模板" placeholder="搜索玩法、介绍或作者…" maxLength={60} value={search} onChange={(e) => setSearch(e.target.value)} /><button className="btn" type="submit">搜索</button></form>
    </div>
    {error && <div className="error-banner" role="alert">{error}</div>}
    {loading ? <p role="status">正在加载创作模板…</p> : items.length === 0 ? <div className="empty-state"><h2>还没有匹配的模板</h2><p>换个关键词，或从自己的可玩版本发布第一个模板。</p></div> : <div className="game-grid template-grid">{items.map((t) => <article className="panel creation-template-card" key={t.id}>
      <Link to={'/templates/' + t.id} aria-label={'查看模板：' + t.title}><Cover spec={t.spec} className="cover" /></Link>
      <p className="muted small">封面为起始玩法参考，实际效果见试玩。</p>
      <div className="badges"><span className="badge">{t.official ? '官方示例' : '用户模板'}</span><span className="badge">v{t.versionLabel}</span>{!t.published && <span className="badge">已下架</span>}</div>
      <h2><Link to={'/templates/' + t.id}>{t.title}</Link></h2><p>{t.description}</p>
      <p className="muted small">{t.authorName} · {t.parameters.length} 个可调参数 · MIT</p><p className="muted small">{verificationLabel(t.verification)}</p>
      <Link className="btn primary" to={'/templates/' + t.id}>试玩与使用模板</Link>
    </article>)}</div>}
    <div className="template-pagination"><button className="btn" type="button" disabled={loading || page === 0} onClick={() => setPage((p) => p - 1)}>上一页</button><span className="muted">共 {total} 个模板 · 第 {page + 1} 页</span><button className="btn" type="button" disabled={loading || (page + 1) * 12 >= total} onClick={() => setPage((p) => p + 1)}>下一页</button></div>
  </div>;
}
