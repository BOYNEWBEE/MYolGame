// 创作入口：提示词 + 结构化选择，本地实时预览解析结果（与服务器同一套规则），
// 提交后由服务端真正生成并进入工作台。

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, requestJson } from '../api.ts';
import { useSession } from '../session.tsx';
import { useMeta } from '../meta.ts';
import { fetchMusicSettings } from '../music-settings.ts';
import Cover from '../components/Cover.tsx';
import { GenerationBadge, SpecBadges } from '../components/Badges.tsx';
import { MUSIC_PREVIEW_HTML } from '@shared/audio.ts';
import { parsePrompt } from '@shared/prompt.ts';
import {
  TEMPLATES,
  THEMES,
  DIFFICULTIES,
  MUSIC_NAMES,
  MAX_MUSIC_PROMPT,
  defaultSpec,
  getMusicPreset,
  type GameSpec,
  type TemplateId,
  type ThemeId,
  type Difficulty,
  type MusicPreset,
} from '@shared/spec.ts';
import type { ProjectSummary, VersionSummary } from '../types.ts';

const SPEEDS = [
  { value: 0.7, label: '慢速 0.7x' },
  { value: 1, label: '正常 1x' },
  { value: 1.4, label: '快速 1.4x' },
  { value: 1.8, label: '极速 1.8x' },
];

const MUSIC_CHOICES: { value?: MusicPreset; label: string; needsMusicApi?: boolean }[] = [
  { label: '随玩法与主题' },
  { value: 'none', label: MUSIC_NAMES.none },
  { value: 'neon-arcade', label: MUSIC_NAMES['neon-arcade'] },
  { value: 'ai-generated', label: MUSIC_NAMES['ai-generated'], needsMusicApi: true },
];

export default function Create(): ReactNode {
  const navigate = useNavigate();
  const session = useSession();
  const { meta } = useMeta();
  const [prompt, setPrompt] = useState('');
  const [template, setTemplate] = useState<TemplateId>('breakout');
  const [theme, setTheme] = useState<ThemeId>('neon');
  const [music, setMusic] = useState<MusicPreset>();
  const [musicPrompt, setMusicPrompt] = useState('');
  const [musicSource, setMusicSource] = useState<'account' | 'server' | 'none' | null>(null);
  const [speed, setSpeed] = useState(1.4);
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [options, setOptions] = useState<Record<string, boolean>>({ widePaddle: true });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session.ready) return;
    let cancelled = false;
    fetchMusicSettings()
      .then((view) => {
        if (!cancelled) setMusicSource(view.effective);
      })
      .catch(() => {
        // 未登录或接口不可用时沿用平台元信息中的服务端配置状态。
        if (!cancelled) setMusicSource(null);
      });
    return () => { cancelled = true; };
  }, [session.ready, session.account?.username]);

  const musicApiReady = musicSource ? musicSource !== 'none' : Boolean(meta?.music.configured);

  // 结构化选择作为基底，提示词关键词覆盖其上（服务器生成时使用相同规则）
  const baseSpec = useMemo<GameSpec>(
    () => ({
      ...defaultSpec(template, theme),
      music,
      musicPrompt: musicPrompt.trim() || undefined,
      speed,
      difficulty,
      options,
    }),
    [template, theme, music, musicPrompt, speed, difficulty, options],
  );

  const parsed = useMemo(() => parsePrompt(prompt, baseSpec), [prompt, baseSpec]);
  const resolvedMusic = getMusicPreset(parsed.spec);
  const hasPrompt = Boolean(prompt.trim());
  const activeTemplate = TEMPLATES.find((t) => t.id === template)!;
  const promptOverridesSettings = hasPrompt && (
    parsed.spec.template !== template ||
    parsed.spec.theme !== theme ||
    parsed.spec.speed !== speed ||
    parsed.spec.difficulty !== difficulty ||
    Object.entries(parsed.spec.options).some(([key, enabled]) => enabled && !options[key])
  );

  function applyTemplate(id: TemplateId): void {
    if (id === template) return;
    setTemplate(id);
    setOptions({});
  }

  function toggleOption(key: string): void {
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function submit(): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await requestJson<{ project: ProjectSummary; version: VersionSummary }>(
        '/projects',
        { method: 'POST', body: { prompt: prompt.trim() || '使用当前配置生成', spec: baseSpec } },
      );
      navigate('/projects/' + result.project.id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('会话未就绪或已失效，请刷新页面后重试');
      } else {
        setError(err instanceof Error ? err.message : '创建失败');
      }
      setSubmitting(false);
    }
  }

  return (
    <div className="page create-page">
      <div className="page-head">
        <h1>创作新游戏</h1>
        <p><Link to="/templates">也可以从社区模板开始 →</Link></p>
        <p className="muted">
          选择玩法与参数，也可以填写提示词补充需求。
          {meta?.generationMode === 'agent'
            ? 'Agent 将根据需求开发源码，完成后请试玩确认。'
            : meta?.generationMode === 'model'
            ? '当前已配置真实模型辅助调整规格。'
            : '当前使用内置模板生成。'}
        </p>
      </div>

      <div className="create-layout">
        <section className="panel create-form">
          <label className="field">
            <span className="field-label">需求提示词（可选）</span>
            <textarea
              rows={4}
              maxLength={meta?.limits.promptMaxLength ?? 2000}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="例如：复古像素贪吃蛇，简单上手，可以穿墙"
              aria-describedby="create-prompt-help"
            />
          </label>
          <div className="prompt-help">
            <p id="create-prompt-help" className="panel-note" role="status">
              {promptOverridesSettings
                ? '提示词覆盖了部分手动设置，实际采用的参数见生成预览。'
                : '提示词中识别出的参数优先。留空时按手动设置生成。'}
            </p>
            {hasPrompt && (
              <button type="button" className="btn small" onClick={() => setPrompt('')}>
                清空提示词
              </button>
            )}
          </div>

          <div className="sample-prompts">
            <span className="field-label">示例提示词</span>
            <div className="sample-list">
              {TEMPLATES.flatMap((t) => t.samplePrompts).map((sample) => (
                <button key={sample} type="button" className="chip" onClick={() => setPrompt(sample)}>
                  {sample}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="field-label">{meta?.generationMode === 'agent' ? '起始玩法（Agent 可修改源码）' : '玩法模板'}</span>
            <div className="template-cards">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={'template-card' + (template === t.id ? ' active' : '')}
                  aria-pressed={template === t.id}
                  onClick={() => applyTemplate(t.id)}
                >
                  <strong>{t.name}</strong>
                  <span>{t.description}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="field-label">主题配色</span>
            <div className="theme-swatches">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={'swatch' + (theme === t.id ? ' active' : '')}
                  aria-pressed={theme === t.id}
                  onClick={() => setTheme(t.id)}
                  title={t.name}
                >
                  <span
                    className="swatch-colors"
                    style={{
                      background:
                        'linear-gradient(135deg,' + t.palette.primary + ',' + t.palette.secondary + ',' + t.palette.accent + ')',
                    }}
                  />
                  {t.name}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span id="create-music-label" className="field-label">背景音乐</span>
            <div className="segmented wrap" role="group" aria-labelledby="create-music-label">
              {MUSIC_CHOICES.map(({ value, label, needsMusicApi }) => {
                const unavailable = Boolean(needsMusicApi && !musicApiReady);
                return (
                  <button
                    key={label}
                    type="button"
                    className={music === value ? 'active' : ''}
                    aria-pressed={music === value}
                    disabled={unavailable}
                    title={unavailable ? '需在账号管理中填写音乐生成 API，或由服务端统一配置' : undefined}
                    onClick={() => setMusic(value)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <p className="panel-note music-note">
              {resolvedMusic === 'none'
                ? '当前游戏无配乐。选择「霓虹街机」即可试听。'
                : resolvedMusic === 'ai-generated'
                  ? musicApiReady
                    ? musicSource === 'account'
                      ? '生成时将使用账号里保存的音乐 API，制作 20 秒循环配乐并内嵌到游戏；失败会回退为无配乐。'
                      : '生成时调用服务端音乐 API，制作 20 秒循环配乐并内嵌到游戏；失败会回退为无配乐。'
                    : <>AI 配乐未启用：请先到 <Link to="/account">账号管理</Link> 填写音乐生成 API，或由服务端统一配置。</>
                  : '当前配乐为「霓虹街机」。点试听播放，再点一次停止。'}
            </p>
            {resolvedMusic === 'ai-generated' && (
              <label className="field" style={{ marginTop: 10 }}>
                <span className="field-label">配乐提示词（可选）</span>
                <textarea
                  rows={2}
                  maxLength={MAX_MUSIC_PROMPT}
                  value={musicPrompt}
                  onChange={(e) => setMusicPrompt(e.target.value)}
                  placeholder="例如：温柔的钢琴与雨声，节奏舒缓，不要鼓点"
                />
                <span className="panel-note" style={{ margin: 0 }}>
                  会与模板、主题和速度自动生成的描述一起发送给音乐接口；留空则只用自动描述。
                </span>
              </label>
            )}
            {resolvedMusic === 'neon-arcade' && !submitting && (
              <iframe
                className="music-preview"
                title="配乐试听"
                sandbox="allow-scripts"
                srcDoc={MUSIC_PREVIEW_HTML}
              />
            )}
          </div>

          <div className="field-row">
            <div className="field">
              <span className="field-label">速度</span>
              <div className="segmented wrap">
                {SPEEDS.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    className={speed === s.value ? 'active' : ''}
                    aria-pressed={speed === s.value}
                    onClick={() => setSpeed(s.value)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="field-label">难度</span>
              <div className="segmented">
                {DIFFICULTIES.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className={difficulty === d.id ? 'active' : ''}
                    aria-pressed={difficulty === d.id}
                    onClick={() => setDifficulty(d.id)}
                  >
                    {d.name}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="field">
            <span className="field-label">玩法选项（{activeTemplate.name}）</span>
            <div className="option-toggles">
              {activeTemplate.options.map((o) => (
                <label key={o.key} className={'toggle' + (options[o.key] ? ' on' : '')}>
                  <input
                    type="checkbox"
                    checked={Boolean(options[o.key])}
                    onChange={() => toggleOption(String(o.key))}
                  />
                  <span>
                    <strong>{o.name}</strong>
                    <em>{o.description}</em>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {error && <div className="error-banner" role="alert">{error}</div>}

          <button
            type="button"
            className="btn primary large block"
            disabled={submitting || !session.ready}
            onClick={() => void submit()}
          >
            {submitting ? '正在提交…' : '生成游戏并进入工作台'}
          </button>
          <p className="panel-note">
            生成在服务端完成并保存为独立版本；项目默认为私有草稿，发布与否由你决定。
          </p>
        </section>

        <aside className="panel preview-panel">
          <h2>生成预览</h2>
          <p className="panel-note">
            {meta?.generationMode === 'agent' ? '以下为起始模板参考，最终玩法以 Agent 开发后的试玩结果为准。' : '以下为浏览器端用与服务器相同的规则实时解析的结果，最终以服务端生成为准。'}
          </p>
          <Cover spec={parsed.spec} className="cover preview-cover" />
          <h3>{parsed.spec.title}</h3>
          <SpecBadges spec={parsed.spec} />
          {hasPrompt && (
            <div className="parse-notes">
              {parsed.matched.template && <p>识别到玩法：{parsed.matched.template}</p>}
              {parsed.matched.theme && <p>识别到主题：{parsed.matched.theme}</p>}
              {parsed.matched.speed && <p>识别到速度：{parsed.matched.speed}</p>}
              {parsed.matched.difficulty && <p>识别到难度：{parsed.matched.difficulty}</p>}
              {parsed.matched.options.length > 0 && <p>识别到选项：{parsed.matched.options.join('、')}</p>}
              {parsed.notes.map((note, i) => <p key={i} className="warn">{note}</p>)}
            </div>
          )}
          <GenerationBadge mode={meta?.generationMode ?? 'template'} />
        </aside>
      </div>
    </div>
  );
}
