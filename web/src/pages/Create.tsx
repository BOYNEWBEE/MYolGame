// 创作入口：提示词 + 结构化选择，本地实时预览解析结果（与服务器同一套规则），
// 提交后由服务端真正生成并进入工作台。

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, requestJson } from '../api.ts';
import { useSession } from '../session.tsx';
import { useMeta } from '../meta.ts';
import { fetchMusicStyleSettings } from '../music-style-settings.ts';
import Cover from '../components/Cover.tsx';
import { GenerationBadge, SpecBadges } from '../components/Badges.tsx';
import { musicPreviewHtml } from '@shared/audio.ts';
import { parsePrompt } from '@shared/prompt.ts';
import {
  TEMPLATES,
  THEMES,
  DIFFICULTIES,
  MUSIC_NAMES,
  MAX_MUSIC_PROMPT,
  DEFAULT_MUSIC_STYLE,
  MUSIC_INSTRUMENT_NAMES,
  MUSIC_PAD_NAMES,
  applyPromptTuning,
  defaultSpec,
  getMusicPreset,
  type GameSpec,
  type MusicStyle,
  type TemplateId,
  type ThemeId,
  type Difficulty,
  type MusicPreset,
} from '@shared/spec.ts';
import type { ProjectSummary, VersionSummary } from '../types.ts';

type MusicPreview = { kind: 'style'; style: MusicStyle; model: string; signature: string };

function previewErrorText(code?: string): string {
  if (!code) return '试听生成失败，请稍后重试';
  const messages: Record<string, string> = {
    style_not_configured: '编曲模型未配置，请先到账号管理填写',
    style_model_failed: '编曲模型调用失败或输出不合规，请先在账号管理测试连接',
  };
  return messages[code] ?? '试听生成失败（' + code + '）';
}

const SPEEDS = [
  { value: 0.7, label: '慢速 0.7x' },
  { value: 1, label: '正常 1x' },
  { value: 1.4, label: '快速 1.4x' },
  { value: 1.8, label: '极速 1.8x' },
];

const MUSIC_CHOICES: { value?: MusicPreset; label: string; needsStyleModel?: boolean }[] = [
  { label: '随玩法与主题' },
  { value: 'none', label: MUSIC_NAMES.none },
  { value: 'neon-arcade', label: MUSIC_NAMES['neon-arcade'] },
  { value: 'ai-arranged', label: MUSIC_NAMES['ai-arranged'], needsStyleModel: true },
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
  const [styleModelSource, setStyleModelSource] = useState<'account' | 'server' | 'none' | null>(null);
  const [speed, setSpeed] = useState(1.4);
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [options, setOptions] = useState<Record<string, boolean>>({ widePaddle: true });
  const [submitting, setSubmitting] = useState(false);
  const [musicPreview, setMusicPreview] = useState<MusicPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session.ready) return;
    let cancelled = false;
    fetchMusicStyleSettings()
      .then((view) => {
        if (!cancelled) setStyleModelSource(view.effective);
      })
      .catch(() => {
        if (!cancelled) setStyleModelSource(null);
      });
    return () => { cancelled = true; };
  }, [session.ready, session.account?.username]);

  const styleModelReady = styleModelSource ? styleModelSource !== 'none' : false;

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
  const synthMusic = resolvedMusic === 'neon-arcade' || resolvedMusic === 'ai-arranged';
  const hasPrompt = Boolean(prompt.trim());
  const activeTemplate = TEMPLATES.find((t) => t.id === template)!;
  const sourceMode = Boolean(meta?.agent?.configured);
  const agentName = meta?.agent?.name || '源码开发模型';
  const agentModel = meta?.agent?.model;
  const agentProvider = meta?.agent?.provider;
  const agentModelHint = agentModel
    ? '（' + (agentProvider === 'openai' ? 'OpenAI 兼容' : agentProvider) + ' · ' + agentModel + '）'
    : meta?.agent?.accountModelConfig ? '（模型由账号管理配置）' : '';
  const promptOverridesSettings = hasPrompt && (
    parsed.spec.template !== template ||
    parsed.spec.theme !== theme ||
    parsed.spec.speed !== speed ||
    parsed.spec.difficulty !== difficulty ||
    Object.entries(parsed.spec.options).some(([key, enabled]) => enabled && !options[key])
  );
  const previewSignature = useMemo(
    () => JSON.stringify({ prompt: prompt.trim(), spec: parsed.spec }),
    [prompt, parsed.spec],
  );
  const previewFresh = musicPreview?.signature === previewSignature;
  // 未配置编曲模型时，乐器与情绪关键词直接决定音色、调性、和弦进行与旋律种子。
  const baseLocalStyle = parsed.spec.musicStyle ?? DEFAULT_MUSIC_STYLE;
  const localStyle = useMemo(
    () => applyPromptTuning(baseLocalStyle, prompt, musicPrompt),
    [baseLocalStyle, prompt, musicPrompt],
  );
  const keywordTuned = localStyle !== baseLocalStyle;

  // 试听必须用提示词真实生成一次：合成配乐向编曲模型取参数。
  // 结果带签名，参数变化后提示重新生成，且生成游戏时不会误用旧参数。
  async function generateMusicPreview(): Promise<void> {
    if (previewBusy) return;
    setPreviewBusy(true);
    setPreviewError('');
    try {
      // 未配置编曲模型时不必请求服务端：提示词关键词已能决定音色、调性与旋律。
      if (!styleModelReady) {
        if (!keywordTuned) {
          setPreviewError('提示词里还没识别到乐器或情绪；可以写钢琴、弦乐，或悬疑、悲伤、明亮、梦幻、复古、科幻等情绪。');
          return;
        }
        setMusicPreview({ kind: 'style', style: localStyle, model: '关键词识别', signature: previewSignature });
        return;
      }
      const result = await requestJson<{
        ok: boolean;
        style?: MusicStyle;
        model?: string;
        error?: string;
      }>('/music/style/preview', { method: 'POST', body: { prompt: prompt.trim(), spec: parsed.spec } });
      if (!result.ok || !result.style) {
        if (keywordTuned) {
          setMusicPreview({ kind: 'style', style: localStyle, model: '关键词回退', signature: previewSignature });
          setPreviewError('编曲模型不可用，已按提示词关键词生成试听。');
          return;
        }
        setPreviewError(previewErrorText(result.error));
        return;
      }
      setMusicPreview({ kind: 'style', style: result.style, model: result.model ?? '', signature: previewSignature });
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : '试听生成失败');
    } finally {
      setPreviewBusy(false);
    }
  }

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
    const usePreview = Boolean(previewFresh && synthMusic && musicPreview?.kind === 'style');
    const spec: GameSpec = usePreview && musicPreview?.kind === 'style'
      ? { ...parsed.spec, musicStyle: musicPreview.style }
      : parsed.spec;
    const body: Record<string, unknown> = {
      prompt: prompt.trim() || '使用当前配置生成',
      spec,
    };
    // 明确告知服务端复用试听参数，避免生成时再次随机调用模型。
    if (usePreview) body.musicStylePreviewed = true;
    try {
      const result = await requestJson<{ project: ProjectSummary; version: VersionSummary }>(
        '/projects',
        { method: 'POST', body },
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
      </div>

      <div className={'mode-banner ' + (sourceMode ? 'agent' : 'template')} role="status">
        <strong>{sourceMode ? 'AI 源码开发模式' : '模板模式'}</strong>
        <span>
          {sourceMode
            ? '由 ' + agentName + agentModelHint +
              ' 直接修改 HTML/JavaScript。首次以所选模板源码为基底，后续继续在上一有效版本上修改；完成后先做浏览器烟测，再保存为新版本。账号可登录后在「账号管理」配置自己的模型密钥。'
            : '未启用源码开发服务：当前只能调整速度、难度、主题、玩法选项和配乐等受支持参数，不能新增第二关、追踪敌人的敌人等源码级玩法。需要这些能力时请由管理员配置游戏开发模型后重启服务。'}
        </span>
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
              placeholder={sourceMode
                ? '例如：打砖块增加第二关，第一关清空后进入第二关，第二关砖块耐久为两次，重新开始恢复第一关'
                : '例如：复古像素贪吃蛇，简单上手，可以穿墙'}
              aria-describedby="create-prompt-help"
            />
          </label>
          <div className="prompt-help">
            <p id="create-prompt-help" className="panel-note" role="status">
              {sourceMode
                ? '需求会交给模型修改完整源码；未要求删除的原有玩法会保留。'
                : promptOverridesSettings
                  ? '提示词覆盖了部分手动设置，实际采用的参数见生成预览。'
                  : '模板模式只解析速度、难度、主题、玩法选项等关键词。'}
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
              {MUSIC_CHOICES.map(({ value, label, needsStyleModel }) => {
                const missingStyleModel = Boolean(needsStyleModel && !styleModelReady);
                return (
                  <button
                    key={label}
                    type="button"
                    className={music === value ? 'active' : ''}
                    aria-pressed={music === value}
                    disabled={missingStyleModel}
                    title={missingStyleModel
                      ? '需在账号管理中填写 OpenAI 兼容编曲模型，或由服务端统一配置'
                      : undefined}
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
                : resolvedMusic === 'ai-arranged'
                  ? styleModelReady
                    ? '先用提示词生成编曲试听：模型会返回调性、BPM、和弦与音色参数，浏览器按这些参数实时合成；生成游戏时复用试听参数，参数修改后需重新生成试听。'
                    : <>AI 编曲未启用：请先到 <Link to="/account">账号管理</Link> 填写 OpenAI 兼容编曲模型，或由服务端统一配置。</>
                  : styleModelReady
                    ? '当前配乐为「霓虹街机」。可先用提示词生成编曲试听，再生成游戏；未生成试听时下方为默认风格。'
                    : <>当前配乐为「霓虹街机」。提示词里写钢琴、弦乐、长笛、八音盒、管风琴或吉他会直接切换音色，下方试听会同步变化；到 <Link to="/account">账号管理</Link> 配置编曲模型后可进一步调整 BPM、调性与铺底。</>}
            </p>
            {synthMusic && (
              <label className="field" style={{ marginTop: 10 }}>
                <span className="field-label">配乐提示词（可选）</span>
                <textarea
                  rows={2}
                  maxLength={MAX_MUSIC_PROMPT}
                  value={musicPrompt}
                  onChange={(e) => setMusicPrompt(e.target.value)}
                  placeholder="例如：更慢、更悬疑，少一点鼓点"
                />
                <span className="panel-note" style={{ margin: 0 }}>
                  写钢琴、弦乐、长笛、八音盒、管风琴、吉他等乐器会切换音色；写悬疑、悲伤、明亮、梦幻、复古、科幻等情绪会改变调性与和弦进行，并换用新的旋律。配置编曲模型后，还会由模型进一步调整 BPM 与铺底。
                </span>
              </label>
            )}
            {synthMusic && (styleModelReady || keywordTuned) && (
              <div className="music-preview-actions">
                <button
                  type="button"
                  className="btn small"
                  disabled={previewBusy || submitting}
                  onClick={() => void generateMusicPreview()}
                >
                  {previewBusy
                    ? '正在生成试听…'
                    : styleModelReady
                      ? '用提示词生成编曲试听'
                      : '按提示词识别风格试听'}
                </button>
                {previewFresh && (
                  <span className="panel-note" role="status" style={{ margin: 0 }}>
                    已应用 {musicPreview.model || '编曲模型'}：{musicPreview.style.bpm} BPM · {musicPreview.style.progression}
                  </span>
                )}
                {previewFresh
                  && (musicPreview.style.instrument !== 'chip' || musicPreview.style.pad !== 'none') && (
                  <span className="panel-note" role="status" style={{ margin: 0 }}>
                    音色：{MUSIC_INSTRUMENT_NAMES[musicPreview.style.instrument]} · {MUSIC_PAD_NAMES[musicPreview.style.pad]}
                  </span>
                )}
                {previewFresh
                  && (musicPreview.style.progression !== 'minor' || musicPreview.style.transpose !== 0) && (
                  <span className="panel-note" role="status" style={{ margin: 0 }}>
                    调性：{musicPreview.style.progression} · 移调 {musicPreview.style.transpose > 0 ? '+' : ''}{musicPreview.style.transpose}
                  </span>
                )}
                {!previewFresh && (
                  <span className="panel-note warn" role="status" style={{ margin: 0 }}>
                    设置或提示词已修改，试听仍是旧结果；请重新生成试听。
                  </span>
                )}
              </div>
            )}
            {previewError && <p className="panel-note warn" role="alert" style={{ margin: 0 }}>{previewError}</p>}
            {synthMusic && !submitting && (
              <iframe
                className="music-preview"
                title="配乐试听"
                sandbox="allow-scripts"
                srcDoc={musicPreview?.kind === 'style'
                  ? musicPreviewHtml(musicPreview.style)
                  : musicPreviewHtml(keywordTuned ? localStyle : null)}
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
            disabled={submitting || previewBusy || !session.ready}
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
            {sourceMode
              ? '以下为起始模板参考；最终玩法以模型修改后的源码和工作台试玩结果为准。'
              : '以下为浏览器端用与服务器相同的规则实时解析的结果；模板模式只覆盖受支持参数。'}
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
          <p className="panel-note">
            {sourceMode
              ? '源码开发：' + agentName + (agentModel ? ' · ' + agentModel : meta?.agent?.accountModelConfig ? ' · 账号配置模型' : '')
              : '模板模式：只能调整受支持参数'}
          </p>
        </aside>
      </div>
    </div>
  );
}
