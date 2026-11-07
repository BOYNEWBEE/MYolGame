// 创作工作台：对话修改、生成状态、试玩预览、版本回退、发布与下载。

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { API_BASE, ApiError, downloadAuthorized, requestJson } from '../api.ts';
import { useMeta } from '../meta.ts';
import SandboxFrame from '../components/SandboxFrame.tsx';
import Cover from '../components/Cover.tsx';
import { GenerationBadge, SpecBadges } from '../components/Badges.tsx';
import type {
  GameSummary,
  MessageItem,
  ProjectSummary,
  TaskItem,
  VersionSummary,
} from '../types.ts';

interface ProjectDetail {
  project: ProjectSummary;
  versions: VersionSummary[];
  messages: MessageItem[];
  tasks: TaskItem[];
}

const RUNNING_STAGES = ['解析需求', '校验规格', '渲染游戏模板', '校验产物', '保存版本'];

export default function Workbench(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const { meta } = useMeta();
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [stageIndex, setStageIndex] = useState(0);
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [description, setDescription] = useState('');
  const [allowDownload, setAllowDownload] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const stageTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await requestJson<ProjectDetail>('/projects/' + id);
      setDetail(data);
      setAllowDownload(data.project.allowDownload);
      setPreviewVersionId((prev) => prev ?? data.project.currentVersionId);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setError(err.message + '（项目仅创建者可访问）');
      } else {
        setError(err instanceof Error ? err.message : '加载失败');
      }
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [detail?.messages.length]);

  // 生成期间展示阶段进度（服务端为同步生成，阶段名称与真实任务日志一致）
  useEffect(() => {
    if (!generating) {
      if (stageTimer.current !== null) window.clearInterval(stageTimer.current);
      stageTimer.current = null;
      setStageIndex(0);
      return;
    }
    stageTimer.current = window.setInterval(() => {
      setStageIndex((i) => Math.min(i + 1, RUNNING_STAGES.length - 1));
    }, 450);
    return () => {
      if (stageTimer.current !== null) window.clearInterval(stageTimer.current);
    };
  }, [generating]);

  async function refreshAfterMutation(message?: string): Promise<void> {
    await load();
    if (message) setNotice(message);
  }

  async function generate(basePrompt: string): Promise<void> {
    if (!id || generating || !basePrompt.trim()) return;
    setGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const result = await requestJson<{ version: VersionSummary; task: TaskItem }>(
        '/projects/' + id + '/tasks',
        { method: 'POST', body: { prompt: basePrompt } },
      );
      setPreviewVersionId(result.version.id);
      setPrompt('');
      await refreshAfterMutation(
        result.version.note + ' 已生成（' +
        RUNNING_STAGES.map((s, i) => (result.task.stages[i]?.ok === false ? s + '失败' : s)).join(' → ') +
        '）。任务记录已持久保存。',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败');
      await load();
    } finally {
      setGenerating(false);
    }
  }

  async function restore(versionId: string, note: string): Promise<void> {
    if (!id || busyAction) return;
    setBusyAction('restore');
    setError(null);
    try {
      await requestJson('/projects/' + id + '/restore', {
        method: 'POST',
        body: { versionId },
      });
      setPreviewVersionId(versionId);
      await refreshAfterMutation('已回退到版本 ' + note + '。如需让社区看到该版本，请重新发布。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '回退失败');
    } finally {
      setBusyAction(null);
    }
  }

  async function publish(): Promise<void> {
    if (!id || busyAction) return;
    setBusyAction('publish');
    setError(null);
    try {
      const result = await requestJson<{ game: GameSummary }>('/projects/' + id + '/publish', {
        method: 'POST',
        body: { description: description || undefined, allowDownload },
      });
      await refreshAfterMutation('已发布到社区，其他人现在可以浏览并试玩。');
      setDescription(result.game.description);
    } catch (err) {
      setError(err instanceof Error ? err.message : '发布失败');
    } finally {
      setBusyAction(null);
    }
  }

  async function unpublish(): Promise<void> {
    if (!id || busyAction) return;
    setBusyAction('unpublish');
    setError(null);
    try {
      await requestJson('/projects/' + id + '/unpublish', { method: 'POST', body: {} });
      await refreshAfterMutation('已从社区下架。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '下架失败');
    } finally {
      setBusyAction(null);
    }
  }

  async function removeProject(): Promise<void> {
    if (!id || busyAction) return;
    if (!window.confirm('确定删除该项目及其全部版本？已发布的游戏会同时下架。')) return;
    setBusyAction('delete');
    try {
      await requestJson('/projects/' + id, { method: 'DELETE' });
      window.location.href = '/projects';
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
      setBusyAction(null);
    }
  }

  if (error && !detail) {
    return (
      <div className="page empty-state">
        <h2>无法打开工作台</h2>
        <p>{error}</p>
        <Link className="btn primary" to="/projects">返回我的项目</Link>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="page empty-state">
        <div className="spinner" />
        <p>加载项目中…</p>
      </div>
    );
  }

  const { project, versions, messages, tasks } = detail;
  const orderedVersions = [...versions].reverse();
  const previewVersion =
    versions.find((v) => v.id === previewVersionId) ??
    versions.find((v) => v.id === project.currentVersionId) ??
    versions[versions.length - 1];
  const lastTask = tasks[0];

  return (
    <div className="page workbench-page">
      <div className="page-head workbench-head">
        <div>
          <h1>{project.title}</h1>
          <div className="head-meta">
            <span className={'visibility ' + project.visibility}>
              {project.visibility === 'public' ? '已发布到社区' : '私有草稿'}
            </span>
            <GenerationBadge mode={previewVersion?.generationMode ?? 'template'} />
            {meta?.generationMode !== 'model' && (
              <span className="muted small">平台处于模板模式（未配置真实模型）</span>
            )}
          </div>
        </div>
        <div className="detail-actions">
          {project.gameId && (
            <Link className="btn" to={'/games/' + project.gameId}>查看社区页面</Link>
          )}
          <Link className="btn" to="/projects">我的项目</Link>
          <button
            type="button"
            className="btn danger"
            disabled={busyAction !== null}
            onClick={() => void removeProject()}
          >
            删除项目
          </button>
        </div>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && (
        <div className="notice-banner" role="status">
          {notice}
          <button type="button" className="linklike" onClick={() => setNotice(null)}>关闭</button>
        </div>
      )}

      <div className="workbench-layout">
        <section className="panel chat-panel">
          <h2>创作对话</h2>
          <div className="chat-log" ref={chatRef}>
            {messages.map((m) => (
              <div key={m.id} className={'msg ' + m.role}>
                <span className="msg-role">{m.role === 'user' ? '我' : '系统'}</span>
                <p>{m.content}</p>
                <time>{new Date(m.createdAt).toLocaleString('zh-CN')}</time>
              </div>
            ))}
            {generating && (
              <div className="msg system generating">
                <span className="msg-role">系统</span>
                <div className="stage-progress">
                  {RUNNING_STAGES.map((stage, i) => (
                    <span
                      key={stage}
                      className={'stage' + (i < stageIndex ? ' done' : i === stageIndex ? ' active' : '')}
                    >
                      {stage}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="chat-input">
            <textarea
              rows={3}
              value={prompt}
              maxLength={meta?.limits.promptMaxLength ?? 2000}
              placeholder="提出修改需求，例如：换成糖果主题、难度改为困难、开启穿墙、名字叫《小蛇快跑》"
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void generate(prompt);
              }}
            />
            <div className="chat-actions">
              <span className="muted small">Ctrl/Cmd + Enter 快速生成</span>
              <button
                type="button"
                className="btn primary"
                disabled={generating || !prompt.trim()}
                onClick={() => void generate(prompt)}
              >
                {generating ? '生成中…' : '生成新版本'}
              </button>
            </div>
          </div>
          {lastTask && (
            <details className="task-detail">
              <summary>
                最近任务：{lastTask.status === 'succeeded' ? '成功' : '失败'} ·{' '}
                {lastTask.generationMode === 'model' ? '模型辅助' : '模板生成'} ·{' '}
                {new Date(lastTask.createdAt).toLocaleString('zh-CN')}
              </summary>
              <ol>
                {lastTask.stages.map((stage, i) => (
                  <li key={i} className={stage.ok ? 'ok' : 'bad'}>
                    {stage.ok ? '✓' : '✗'} {stage.name}
                    {stage.detail && <span className="muted">（{stage.detail}）</span>}
                    <time>{new Date(stage.at).toLocaleTimeString('zh-CN')}</time>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </section>

        <section className="preview-panel">
          <div className="panel preview-head">
            <div>
              <h2>试玩预览</h2>
              <p className="muted small">
                {previewVersion
                  ? '当前预览：' + previewVersion.note + '（' +
                    new Date(previewVersion.createdAt).toLocaleString('zh-CN') + '）'
                  : '暂无可预览版本'}
              </p>
            </div>
            <select
              className="version-select"
              value={previewVersion?.id ?? ''}
              onChange={(e) => setPreviewVersionId(e.target.value)}
              aria-label="选择预览版本"
            >
              {orderedVersions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.note}
                  {v.id === project.currentVersionId ? '（当前）' : ''} · {v.spec.title}
                </option>
              ))}
            </select>
          </div>
          {previewVersion ? (
            <SandboxFrame
              src={API_BASE + '/projects/' + project.id + '/versions/' + previewVersion.id + '/preview'}
              title={previewVersion.spec.title + ' 预览'}
              reloadKey={reloadKey}
            />
          ) : (
            <div className="panel empty-state">
              <p>还没有生成成功的版本。</p>
            </div>
          )}
          <div className="panel preview-spec">
            <SpecBadges spec={(previewVersion ?? project).spec} />
            <button type="button" className="btn small" onClick={() => setReloadKey((k) => k + 1)}>
              重新加载
            </button>
          </div>
        </section>

        <section className="side-panels">
          <div className="panel versions-panel">
            <h2>版本历史（{versions.length}）</h2>
            <ol className="version-list">
              {orderedVersions.map((v) => (
                <li key={v.id} className={v.id === project.currentVersionId ? 'current' : ''}>
                  <div className="version-row">
                    <Cover spec={v.spec} className="version-cover" />
                    <div className="version-info">
                      <strong>
                        {v.note}
                        {v.id === project.currentVersionId && <em className="current-tag">当前版本</em>}
                      </strong>
                      <span className="muted small" title={v.prompt}>“{v.prompt}”</span>
                      <span className="muted small">
                        {new Date(v.createdAt).toLocaleString('zh-CN')} ·{' '}
                        {v.generationMode === 'model' ? '模型辅助' : '模板生成'}
                      </span>
                    </div>
                  </div>
                  <div className="version-actions">
                    <button type="button" className="btn tiny" onClick={() => setPreviewVersionId(v.id)}>
                      预览
                    </button>
                    <button
                      type="button"
                      className="btn tiny"
                      disabled={busyAction !== null || v.id === project.currentVersionId}
                      onClick={() => void restore(v.id, v.note)}
                    >
                      回退到此版本
                    </button>
                    <button
                      type="button"
                      className="btn tiny"
                      onClick={() =>
                        void downloadAuthorized(
                          '/projects/' + project.id + '/versions/' + v.id + '/download',
                          v.spec.title + '.html',
                        )
                      }
                    >
                      下载 HTML
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="panel deliver-panel">
            <h2>交付与发布</h2>
            <div className="deliver-actions">
              <button
                type="button"
                className="btn"
                onClick={() =>
                  void downloadAuthorized(
                    '/projects/' + project.id + '/versions/' + (previewVersion?.id ?? '') + '/download',
                    project.title + '.html',
                  )
                }
                disabled={!previewVersion}
              >
                下载游戏 HTML（当前预览版本）
              </button>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  void downloadAuthorized('/projects/' + project.id + '/source', project.title + '-source.zip')
                }
              >
                下载源码包（ZIP）
              </button>
            </div>
            <p className="panel-note">
              导出的 HTML 为自包含单文件（无外部依赖、无网络请求），可独立托管或直接本地打开。
            </p>

            <hr className="divider" />
            {project.visibility === 'public' && project.gameId ? (
              <div className="publish-state">
                <p>
                  已发布：<Link to={'/games/' + project.gameId}>{project.title}</Link>
                </p>
                <p className="muted small">
                  社区展示的是发布时绑定的版本；工作台的新版本不会影响公开页面，直到再次发布。
                </p>
                <div className="publish-actions">
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busyAction !== null}
                    onClick={() => void publish()}
                  >
                    {busyAction === 'publish' ? '发布中…' : '重新发布当前版本'}
                  </button>
                  <button
                    type="button"
                    className="btn danger"
                    disabled={busyAction !== null}
                    onClick={() => void unpublish()}
                  >
                    下架
                  </button>
                </div>
              </div>
            ) : (
              <div className="publish-form">
                <label className="field">
                  <span className="field-label">社区介绍（可选）</span>
                  <textarea
                    rows={3}
                    maxLength={meta?.limits.descriptionMaxLength ?? 500}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="向玩家介绍这个游戏的玩法与亮点…"
                  />
                </label>
                <label className="toggle inline">
                  <input
                    type="checkbox"
                    checked={allowDownload}
                    onChange={(e) => setAllowDownload(e.target.checked)}
                  />
                  <span>允许玩家下载游戏 HTML</span>
                </label>
                <button
                  type="button"
                  className="btn primary block"
                  disabled={busyAction !== null || !project.currentVersionId}
                  onClick={() => void publish()}
                >
                  {busyAction === 'publish' ? '发布中…' : '发布到社区（绑定当前版本）'}
                </button>
                <p className="panel-note">
                  发布后游戏保存在服务端，任何浏览器都可以访问与试玩。初版暂未实现人工审核队列，
                  发布即时可见（已在实施记录中注明）。
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
