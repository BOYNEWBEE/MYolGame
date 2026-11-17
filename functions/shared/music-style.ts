// OpenAI 兼容的编曲模型：只输出受限的音乐风格参数，不生成或执行任何浏览器代码。
// 模型失败、超时或输出不合法时返回 null，由调用方回退到默认合成配乐。

import { sanitizeMusicStyle, type GameSpec, type MusicStyle } from './spec.ts';

export interface MusicStyleEnv {
  apiUrl?: string;
  apiKey?: string;
  model?: string;
}

const MAX_API_URL = 512;
const MAX_API_KEY = 512;
const MAX_MODEL = 64;
const REQUEST_TIMEOUT_MS = 20000;
const MAX_RESPONSE_CHARS = 64 * 1024;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

const STYLE_KEYS = ['bpm', 'progression', 'transpose', 'leadWave', 'bassWave', 'kickWave', 'density', 'swing', 'octave', 'seed'];

const SYSTEM_PROMPT = [
  '你是 2D 游戏配乐编曲助手，为浏览器实时合成的芯片音乐选择参数。',
  '只输出一个 JSON 对象，不要 Markdown 或解释。',
  '字段：bpm(70-160 整数)、progression(minor|major|dorian|phrygian|lydian|mixolydian|harmonic-minor|suspended)、',
  'transpose(-7 到 7 整数，半音移调，用来改变调性)、',
  'leadWave/bassWave/kickWave(sine|square|sawtooth|triangle)、density(0.3-1)、swing(0-0.3)、',
  'octave(-1|0|1)、seed(1-9999 整数)。',
  '音乐用于 20 秒循环背景，不要人声，避免长前奏。',
  '不要总是返回默认值：除非用户明确要求原版霓虹风格，transpose 尽量避开 0，并选择与默认 minor 不同的和弦进行；',
  'seed 请随机选择，它会改变旋律型和低频节奏。',
].join('');

export function musicStyleConfigured(env: MusicStyleEnv | undefined): boolean {
  return Boolean(env?.apiUrl && env.apiKey && env.model);
}

// 兼容填基址、/v1 基址或完整 /chat/completions 地址；DeepSeek 基址为 https://api.deepseek.com。
export function chatCompletionsUrl(apiUrl: string): string {
  const trimmed = apiUrl.trim().replace(/\/+$/, '');
  return /\/chat\/completions$/.test(trimmed) ? trimmed : trimmed + '/chat/completions';
}

export type MusicStyleSettingsParse =
  | { ok: true; apiUrl: string; apiKey: string; model: string }
  | { ok: false; error: string };

// 账号配置由服务端发起请求，限制 HTTPS；本机调试放行回环地址的 HTTP。
export function parseMusicStyleSettingsInput(
  raw: { apiUrl?: unknown; apiKey?: unknown; model?: unknown },
  previousKey?: string,
): MusicStyleSettingsParse {
  const apiUrl = typeof raw.apiUrl === 'string' ? raw.apiUrl.trim() : '';
  if (!apiUrl || apiUrl.length > MAX_API_URL) {
    return { ok: false, error: '接口地址不能为空，且不超过 ' + MAX_API_URL + ' 个字符' };
  }
  let url: URL;
  try {
    url = new URL(apiUrl);
  } catch {
    return { ok: false, error: '接口地址不是合法的 URL' };
  }
  if (url.username || url.password) return { ok: false, error: '接口地址不能包含账号密码' };
  if (url.hash) return { ok: false, error: '接口地址不能包含 # 片段' };
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))) {
    return { ok: false, error: '接口地址须使用 HTTPS；本机调试可用 http://127.0.0.1 或 http://localhost' };
  }

  const rawKey = typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '';
  if (rawKey.length > MAX_API_KEY) return { ok: false, error: 'API 密钥过长（最多 ' + MAX_API_KEY + ' 个字符）' };
  if (/[\u0000-\u001f\u007f]/.test(rawKey)) return { ok: false, error: 'API 密钥包含控制字符' };
  const apiKey = rawKey || previousKey || '';
  if (!apiKey) return { ok: false, error: '请填写 API 密钥' };

  const model = typeof raw.model === 'string' ? raw.model.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
  if (!model || model.length > MAX_MODEL) {
    return { ok: false, error: '模型名不能为空，且不超过 ' + MAX_MODEL + ' 个字符' };
  }
  if (!/^[A-Za-z0-9._:/-]+$/.test(model)) return { ok: false, error: '模型名只能包含字母、数字和 . _ : / -' };

  return { ok: true, apiUrl, apiKey, model };
}

function stylePrompt(prompt: string, spec: GameSpec): string {
  return [
    '为下面这款浏览器小游戏选择背景音乐风格参数。',
    '玩法：' + spec.template,
    '主题：' + spec.theme,
    '难度：' + spec.difficulty,
    '速度：' + spec.speed + 'x',
    spec.musicPrompt ? '用户附加风格：' + spec.musicPrompt : '',
    '用户需求：' + prompt,
    '只返回 JSON。',
  ].filter(Boolean).join('\n');
}

function extractStyle(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function generateMusicStyle(
  prompt: string,
  spec: GameSpec,
  env: MusicStyleEnv,
): Promise<{ style: MusicStyle; model: string } | null> {
  if (!musicStyleConfigured(env)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(chatCompletionsUrl(env.apiUrl!), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: 'Bearer ' + env.apiKey,
      },
      body: JSON.stringify({
        model: env.model,
        temperature: 1,
        max_tokens: 200,
        stream: false,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: stylePrompt(prompt, spec) },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    const text = await response.text();
    if (text.length > MAX_RESPONSE_CHARS) return null;
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return null;
    }
    const content = (body as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return null;
    const parsed = extractStyle(content);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    // 至少包含一个已知字段，避免把无关 JSON 当成有效风格。
    if (!STYLE_KEYS.some((key) => key in (parsed as Record<string, unknown>))) return null;
    return { style: sanitizeMusicStyle(parsed), model: env.model! };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
