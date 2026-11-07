// 我的项目：私有草稿与已发布作品列表（服务端按创作者令牌归属）。

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, requestJson } from '../api.ts';
import { useSession } from '../session.tsx';
import Cover from '../components/Cover.tsx';
import { GenerationBadge, SpecBadges } from '../components/Badges.tsx';
import type { ProjectSummary } from '../types.ts';

export default function Projects(): ReactNode {
  const session = useSession();
  const [items, setItems] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session.ready) return;
    try {
      const data = await requestJson<{ items: ProjectSummary[] }>('/projects');
      setItems(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  }, [session.ready]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(project: ProjectSummary): Promise<void> {
    if (deleting) return;
    if (!window.confirm('确定删除「' + project.title + '」及其全部版本？')) return;
    setDeleting(project.id);
    try {
      await requestJson('/projects/' + project.id, { method: 'DELETE' });
      await load();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      setDeleting(null);
    }
  }

  if (!session.ready) {
    return (
      <div className="page empty-state">
        <div className="spinner" />
        <p>会话初始化中…</p>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>我的项目</h1>
        <p className="muted">
          项目按创作者令牌保存在服务端，仅本浏览器会话可管理（原型身份限制）。
        </p>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}

      {!items ? (
        <div className="loading-grid">
          {Array.from({ length: 3 }, (_, i) => <div className="skeleton-card" key={i} />)}
        </div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <h2>还没有项目</h2>
          <p>用一句提示词创建你的第一个游戏。</p>
          <Link className="btn primary" to="/create">开始创作</Link>
        </div>
      ) : (
        <div className="project-list">
          {items.map((project) => (
            <article className="project-card panel" key={project.id}>
              <Link to={'/projects/' + project.id} className="project-cover">
                <Cover spec={project.spec} className="cover" />
              </Link>
              <div className="project-info">
                <div className="card-title-row">
                  <h3><Link to={'/projects/' + project.id}>{project.title}</Link></h3>
                  <span className={'visibility ' + project.visibility}>
                    {project.visibility === 'public' ? '已发布' : '私有'}
                  </span>
                </div>
                <SpecBadges spec={project.spec} />
                <p className="muted small">
                  更新于 {new Date(project.updatedAt).toLocaleString('zh-CN')}
                  <GenerationBadge mode="template" />
                </p>
                <div className="project-actions">
                  <Link className="btn primary small" to={'/projects/' + project.id}>继续开发</Link>
                  {project.gameId && (
                    <Link className="btn small" to={'/games/' + project.gameId}>社区页面</Link>
                  )}
                  <button
                    type="button"
                    className="btn danger small"
                    disabled={deleting === project.id}
                    onClick={() => void remove(project)}
                  >
                    {deleting === project.id ? '删除中…' : '删除'}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
