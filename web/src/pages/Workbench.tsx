// 创作工作台：对话修改、生成状态、试玩预览、版本回退、发布与下载。

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { API_BASE, ApiError, downloadAuthorized, requestJson } from '../api.ts';
import { appHref } from '../routing.ts';
import { useMeta } from '../meta.ts';
import SandboxFrame from '../components/SandboxFrame.tsx';
import Cover from '../components/Cover.tsx';
import PublishTemplateForm from '../components/PublishTemplateForm.tsx';
import { GenerationBadge, SpecBadges } from '../components/Badges.tsx';
import type {
  GameSummary,
  MessageItem,
  ProjectSummary,
  TaskItem,
  VersionSummary,
} from '../types.ts';

const activeTask = (task: TaskItem) => ['queued', 'running', 'checking', 'repairing'].includes(task.status);
const taskLabels: Record<TaskItem['status'], string> = {
  queued: '等待', running: '生成源码', checking: '检查', repairing: '修复',
  succeeded: '成功', failed: '失败', cancelled: '取消', timed_out: '超时',
};
const errorCodeLabels: Record<string, string> = {
  model_timeout: '模型请求超时',
  model_auth_failed: '模型鉴权失败',
  model_rate_limited: '模型服务限流',
  model_empty_output: '模型返回空内容',
  model_truncated: '模型输出被截断',
  model_invalid_response: '模型响应格式异常',
  model_too_large: '模型响应过大',
  model_unreachable: '无法连接模型服务',
  model_not_configured: '模型未配置完整',
  browser_unavailable: '浏览器检查不可用',
  invalid_html: '模型未返回完整 HTML',
  invalid_edit: '模型修改片段无法应用',
  check_failed: '浏览器检查未通过',
  version_conflict: '版本冲突',
  timeout: '任务超时',
  worker_failed: 'Worker 异常',
  interrupted: '服务重启中断',
  cancelled: '任务取消',
};
const modeLabel = (mode: string) =>
  mode === 'agent' ? 'AI 源码开发' : mode === 'model' ? '模型辅助规格' : '模板生成';
const errorText = (task: TaskItem) =>
  (task.errorCode ? '[' + (errorCodeLabels[task.errorCode] ?? task.errorCode) + '] ' : '') + (task.error ?? '');
const isAgentVersion = (version?: VersionSummary | null) => version?.generationMode === 'agent';

interface ProjectDetail {
  project: ProjectSummary;
  versions: VersionSummary[];
  messages: MessageItem[];
  tasks: TaskItem[];
}

export default function Workbench(): ReactNode {
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const { meta } = useMeta();
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(typeof location.state?.notice === 'string' ? location.state.notice : null);
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [description, setDescription] = useState('');
  const [allowDownload, setAllowDownload] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const observedTask = useRef<string | null>(null);
  const requestInFlight = useRef(false);
  const [processing, setProcessing] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await requestJson<ProjectDetail>('/projects/' + id);
      setDetail(data);
      setAllowDownload(data.project.allowDownload);
      const pending = data.tasks.some(activeTask);
      pendingRef.current = pending;
      setProcessing(pending);
      const completed = data.tasks.find((task) => task.id === observedTask.current);
      if (completed && !activeTask(completed)) {
        observedTask.current = null;
        if (completed.status === 'succeeded' && completed.versionId) {
          setPreviewVersionId(completed.versionId);
          setNotice('新版本已生成，请试玩确认需求。浏览器烟测只代表基础运行正常。');
        } else {
          setError(errorText(completed));
        }
      }
      if (pending && !observedTask.current) observedTask.current = data.tasks.find(activeTask)!.id;
      setPreviewVersionId((prev) => prev || data.project.currentVersionId || null);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setError(err.message + '（项目仅创建者可访问）');
      } else {
        setError(err instanceof Error ? err.message : '加载失败');
      }
    }
  }, [id]);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await load();
      if (!disposed) timer = setTimeout(() => void poll(), pendingRef.current ? 750 : 3000);
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [load]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [detail?.messages.length, generating]);

  async function refreshAfterMutation(message?: string): Promise<void> {
    await load();
    if (message) setNotice(message);
  }

  async function generate(basePrompt: string): Promise<void> {
    if (detail?.project.templateOrigin && !meta?.agent?.configured) { setError('此项目的修改需要启用 Agent 源码开发'); return; }
    const currentVersion = detail?.versions.find((v) => v.id === detail.project.currentVersionId);
    if (isAgentVersion(currentVersion) && !meta?.agent?.configured) {
      setError('当前版本由 AI 源码开发产生，模板模式重新渲染会覆盖已有玩法；请启用源码开发服务后继续修改。');
      return;
    }
    if (!id || requestInFlight.current || processing || !basePrompt.trim()) return;
    requestInFlight.current = true;
    setGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const result = await requestJson<{ version?: VersionSummary; task: TaskItem }>(
        '/projects/' + id + '/tasks',
        { method: 'POST', body: { prompt: basePrompt } },
      );
      if (result.version) setPreviewVersionId(result.version.id);
      else observedTask.current = result.task.id;
      setPrompt((draft) => (draft === basePrompt ? '' : draft));
      await refreshAfterMutation(result.version ? result.version.note + ' 已生成，可在试玩区查看。' : '任务已提交，可离开页面，稍后回来查看。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败');
      await load();
    } finally {
      requestInFlight.current = false;
      setGenerating(false);
    }
  }

  async function cancel(): Promise<void> {
    const task = detail?.tasks.find(activeTask);
    if (!id || !task) return;
    try {
      await requestJson('/projects/' + id + '/tasks/' + task.id + '/cancel', { method: 'POST', body: {} });
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : '取消失败'); }
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
      window.location.href = appHref('/projects');
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
  const currentVersion = versions.find((v) => v.id === project.currentVersionId);
  const previewVersion =
    versions.find((v) => v.id === previewVersionId) ??
    currentVersion ??
    versions[versions.length - 1];
  const lastTask = tasks[0];
  const sourceMode = Boolean(meta?.agent?.configured);
  const agentName = meta?.agent?.name || '源码开发模型';
  const agentModelHint = meta?.agent?.model
    ? ' · ' + meta.agent.model
    : meta?.agent?.accountModelConfig ? ' · 模型由账号管理配置' : '';

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
            <span className="muted small">
              {sourceMode
                ? 'AI 源码开发模式 · ' + agentName + agentModelHint
                : '模板模式 · 只能调整受支持参数'}
            </span>
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

      {project.templateOrigin && <div className="panel template-origin"><span>来源：<Link to={'/templates/' + project.templateOrigin.templateId}>{project.templateOrigin.title}</Link> · {project.templateOrigin.versionLabel} · MIT · 独立私有副本</span>{!meta?.agent?.configured && <p className="panel-note">当前未启用源码开发，仍可试玩、下载和发布；启用后可在现有源码上继续修改。</p>}</div>}
      <div className={'mode-banner ' + (sourceMode ? 'agent' : 'template')} role="status">
        <strong>{sourceMode ? 'AI 源码开发模式' : '模板模式'}</strong>
        <span>
          {sourceMode
            ? '提交需求后由 ' + agentName + (meta?.agent?.model ? '（' + meta.agent.model + '）' : meta?.agent?.accountModelConfig ? '（模型由账号管理配置）' : '') +
              ' 修改当前有效版本的完整源码，先做隔离浏览器烟测，通过后才保存为新版本。'
            : isAgentVersion(currentVersion)
              ? '当前有效版本来自 AI 源码开发。模板模式不能安全地继续修改它：服务端会拒绝模板重渲染，避免覆盖已有玩法；请启用源码开发服务后再提交需求。'
              : '当前只能调整速度、难度、主题、玩法选项和配乐等受支持参数；新增关卡或敌人等源码级需求需要启用源码开发服务。'}
        </span>
      </div>
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
            {(generating || processing) && (
              <div className="msg system" role="status">
                <span className="msg-role">系统</span>
                <p>正在生成新版本。完成后可在「最近任务」查看处理记录。</p>
              </div>
            )}
          </div>
          <div className="chat-input">
            <textarea
              rows={3}
              value={prompt}
              maxLength={meta?.limits.promptMaxLength ?? 2000}
              placeholder={sourceMode
                ? '提出源码修改需求，例如：打砖块增加第二关，第一关清空后进入第二关，第二关砖块耐久为两次，重新开始恢复第一关'
                : '提出参数修改，例如：换成糖果主题、难度改为困难、开启穿墙、名字叫《小蛇快跑》'}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void generate(prompt);
              }}
            />
            <div className="chat-actions">
              <span className="muted small">Ctrl/Cmd + Enter 快速提交</span>
              <button
                type="button"
                className="btn primary"
                disabled={generating || processing || !prompt.trim()}
                onClick={() => void generate(prompt)}
              >
                {generating || processing ? '处理中…' : sourceMode ? '提交源码修改' : '生成新版本'}
              </button>
            </div>
          </div>
          {lastTask && (
            <details className="task-detail" open={processing || undefined}>
              <summary>
                最近任务：{taskLabels[lastTask.status]} ·{' '}
                {modeLabel(lastTask.generationMode)} ·{' '}
                {new Date(lastTask.createdAt).toLocaleString('zh-CN')}
              </summary>
              {processing && (
                <div className="stage-live" role="status">
                  <span className="spinner small" />
                  <span>
                    {taskLabels[lastTask.status]}
                    {lastTask.stages.length > 0 && ' · ' + lastTask.stages[lastTask.stages.length - 1]!.name}
                  </span>
                </div>
              )}
              {processing && <button className="btn small" type="button" onClick={() => void cancel()}>取消任务</button>}
              {!processing && lastTask.status !== 'succeeded' && lastTask.error && <p role="alert">{errorText(lastTask)}</p>}
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
              authenticated
              reloadKey={reloadKey}
            />
          ) : (
            <div className="panel empty-state">
              <p>还没有生成成功的版本。</p>
            </div>
          )}
          <div className="panel preview-spec">
            {previewVersion?.generationMode === 'agent' && <span className="muted small">起始配置参考，实际玩法见试玩。</span>}
            <SpecBadges spec={(previewVersion ?? project).spec} />
            <button type="button" className="btn small" onClick={() => setReloadKey((k) => k + 1)}>
              重新加载
            </button>
          </div>
        </section>

        <section className="side-panels">
          <PublishTemplateForm projectId={project.id} version={previewVersion} />
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
                        {modeLabel(v.generationMode)}
                      </span>
                    </div>
                  </div>
                  {v.checks && (
                    <p className="muted small">
                      浏览器烟测通过：画布、按键、重启（仅代表基础运行正常，不代表所有需求均已实现）
                    </p>
                  )}
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
                  void downloadAuthorized('/projects/' + project.id + '/source?versionId=' + (previewVersion?.id ?? ''), project.title + '-source.zip')
                }
                disabled={!previewVersion}
              >
                下载源码包（当前预览版本）
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
