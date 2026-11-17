// 生成管线：提示词 → 规格 → 校验 → 渲染模板 → 产物校验。
// 每一步记录真实阶段日志；未配置模型时全程为模板模式，并如实标记。

import { modelAdjustSpec, modelConfigured, type ModelEnv } from './shared/model.ts';
import { generateMusicTrack, musicConfigured, type MusicEnv } from './shared/music.ts';
import { parsePrompt, type ParseMatched } from './shared/prompt.ts';
import { renderGame } from './shared/templates/index.ts';
import { sanitizeSpec, type GameSpec, type GenerationMode } from './shared/spec.ts';
import type { TaskStage } from './store.ts';

export interface GenerateInput {
  prompt: string;
  baseSpec?: GameSpec;
  env: ModelEnv;
  music?: MusicEnv;
}

export interface GenerateOutput {
  ok: boolean;
  spec: GameSpec;
  html: string;
  notes: string[];
  matched: ParseMatched;
  mode: GenerationMode;
  modelName: string | null;
  stages: TaskStage[];
  error: string | null;
}

const MAX_HTML_BYTES = 512 * 1024;

export async function generateGame(input: GenerateInput): Promise<GenerateOutput> {
  const stages: TaskStage[] = [];
  const notes: string[] = [];
  const markStage = (name: string, ok: boolean, detail?: string): void => {
    stages.push({ name, at: new Date().toISOString(), ok, detail });
  };

  let mode: GenerationMode = 'template';
  let modelName: string | null = null;
  let spec = sanitizeSpec(input.baseSpec);
  let matched: ParseMatched = { options: [], ignoredOptions: [] };

  // 阶段一：解析需求（模板模式为关键词解析；配置模型时优先尝试模型，失败则回退）
  try {
    if (modelConfigured(input.env)) {
      const result = await modelAdjustSpec(input.prompt, spec, input.env);
      if (result) {
        mode = 'model';
        modelName = result.modelName;
        spec = sanitizeSpec({ ...result.spec, music: spec.music }, spec);
        const parsed = parsePrompt(input.prompt, spec);
        matched = parsed.matched;
        notes.push('真实模型已参与规格调整，输出仍被限制在内置模板与规格白名单内。');
        markStage('解析需求（模型辅助）', true, modelName);
      }
    } else {
      const parsed = parsePrompt(input.prompt, spec);
      spec = parsed.spec;
      matched = parsed.matched;
      notes.push(...parsed.notes);
      notes.push('当前为模板模式：由关键词规则确定性地生成规格，未调用任何 AI 模型。');
      markStage('解析需求（模板关键词）', true);
    }
  } catch (error) {
    // 模型失败时回退到模板解析，并如实说明
    const parsed = parsePrompt(input.prompt, spec);
    spec = parsed.spec;
    matched = parsed.matched;
    notes.push('模型调用失败，已回退为模板模式生成。');
    notes.push(...parsed.notes);
    markStage('解析需求（模型失败，回退模板）', false, 'model_call_failed');
  }

  // 阶段二：规格白名单校验
  spec = sanitizeSpec(spec);
  markStage('校验规格', true, spec.template + '/' + spec.theme + '/' + spec.difficulty);

  // 阶段三：按需调用服务端音乐生成 API；失败或未配置时回退为无配乐，不伪造结果。
  let musicTrack: string | undefined;
  if (spec.music === 'ai-generated') {
    if (!musicConfigured(input.music)) {
      spec = { ...spec, music: 'none' };
      notes.push('音乐生成 API 未配置，已生成无配乐版本。');
      markStage('生成 AI 配乐', false, 'music_not_configured');
    } else {
      const music = await generateMusicTrack(input.music, spec);
      if (music.ok) {
        musicTrack = music.track.dataUri;
        notes.push('背景音乐由服务端音乐生成 API 生成，并内嵌到单文件 HTML。');
        markStage('生成 AI 配乐', true, music.track.bytes + ' bytes');
      } else {
        spec = { ...spec, music: 'none' };
        notes.push('AI 配乐生成失败，已回退为无配乐版本。');
        markStage('生成 AI 配乐', false, music.error);
      }
    }
  }

  // 阶段四：渲染内置模板
  let html = '';
  try {
    html = renderGame(spec, musicTrack);
    if (musicTrack && new TextEncoder().encode(html).length > MAX_HTML_BYTES) {
      spec = { ...spec, music: 'none' };
      musicTrack = undefined;
      html = renderGame(spec);
      notes.push('AI 配乐体积超出单文件上限，已回退为无配乐版本。');
      markStage('内嵌 AI 配乐', false, 'artifact_too_large');
    }
    markStage('渲染游戏模板', true, spec.template);
  } catch (error) {
    markStage('渲染游戏模板', false, 'render_failed');
    return {
      ok: false, spec, html: '', notes, matched, mode, modelName, stages,
      error: 'render_failed',
    };
  }

  // 阶段五：产物完整性校验（必须包含画布与配置注入，且体积受限）
  const bytes = new TextEncoder().encode(html).length;
  if (!html.includes('<canvas') || !html.includes('const CFG =') || bytes > MAX_HTML_BYTES) {
    markStage('校验产物', false, 'invalid_artifact');
    return {
      ok: false, spec, html: '', notes, matched, mode, modelName, stages,
      error: 'invalid_artifact',
    };
  }
  markStage('校验产物', true, bytes + ' bytes');

  return { ok: true, spec, html, notes, matched, mode, modelName, stages, error: null };
}
