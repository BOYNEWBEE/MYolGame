// OpenAI 兼容的编曲模型：只输出受限的音乐风格参数，不生成或执行任何浏览器代码。
// 模型失败、超时或输出不合法时返回 null，由调用方回退到默认合成配乐。

import { applyPromptStyle, promptMood, promptSeed, sanitizeMusicStyle, type GameSpec, type MusicStyle } from './spec.ts';

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

const STYLE_KEYS = [
  'bpm', 'progression', 'transpose', 'leadWave', 'bassWave', 'kickWave',
  'instrument', 'pad', 'density', 'swing', 'octave', 'seed',
];

const SYSTEM_PROMPT = [
  '你是 2D 游戏配乐编曲助手，为浏览器实时合成的音乐选择参数。',
  '只输出一个 JSON 对象，不要 Markdown 或解释。',
  '字段：bpm(70-160 整数)、progression(minor|major|dorian|phrygian|lydian|mixolydian|harmonic-minor|suspended)、',
  'transpose(-7 到 7 整数，半音移调，用来改变调性)、',
  'leadWave/bassWave/kickWave(sine|square|sawtooth|triangle)、',
  'instrument(chip|piano|music-box|strings|flute|organ|guitar，主旋律音色，chip 是原版芯片音色)、',
  'pad(none|warm|strings，和弦铺底，可让织体更饱满)、',
  'density(0.3-1)、swing(0-0.3)、octave(-1|0|1)、seed(1-9999 整数)。',
  '用户提到钢琴、弦乐、长笛、八音盒、管风琴、吉他等乐器时必须选择对应的 instrument；提到铺底/氛围时选择 pad。',
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

// 无路径基址再补一个 /v1 备选：OpenAI 等服务必须带版本前缀，DeepSeek 两种都可用。
// 仅在首个地址返回 404 时才尝试，避免正常请求产生额外调用。
export function chatCompletionsUrls(apiUrl: string): string[] {
  const trimmed = apiUrl.trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(trimmed)) return [trimmed];
  const primary = trimmed + '/chat/completions';
  try {
    if (!new URL(trimmed).pathname.replace(/\/+$/, '')) {
      return [primary, trimmed + '/v1/chat/completions'];
    }
  } catch {
    // 非法地址交给请求阶段返回 style_failed。
  }
  return [primary];
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

// 只接受对象且至少包含一个已知字段，避免把无关 JSON 当成有效风格。
function parseStyleContent(content: string): Record<string, unknown> | null {
  const parsed = extractStyle(content);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  return STYLE_KEYS.some((key) => key in record) ? record : null;
}

type StyleRequest = { ok: true; content: string; url: string } | { ok: false; error: string; url: string };

async function requestStyleOnce(url: string, env: MusicStyleEnv, userPrompt: string): Promise<StyleRequest> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
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
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { ok: false, error: 'style_http_' + response.status, url };
    }
    const text = await response.text();
    if (text.length > MAX_RESPONSE_CHARS) return { ok: false, error: 'style_invalid_response', url };
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return { ok: false, error: 'style_invalid_response', url };
    }
    const content = (body as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return { ok: false, error: 'style_invalid_response', url };
    return { ok: true, content, url };
  } catch {
    return { ok: false, error: controller.signal.aborted ? 'style_timeout' : 'style_failed', url };
  } finally {
    clearTimeout(timer);
  }
}

// 真实请求一次模型；返回可区分的错误码与最终请求地址，供生成回退与连接测试共用。
async function requestStyleContent(env: MusicStyleEnv, userPrompt: string): Promise<StyleRequest> {
  const urls = chatCompletionsUrls(env.apiUrl!);
  let last: StyleRequest = { ok: false, error: 'style_failed', url: urls[urls.length - 1]! };
  for (let i = 0; i < urls.length; i += 1) {
    last = await requestStyleOnce(urls[i]!, env, userPrompt);
    if (last.ok || last.error !== 'style_http_404') return last;
  }
  return last;
}

export async function generateMusicStyle(
  prompt: string,
  spec: GameSpec,
  env: MusicStyleEnv,
): Promise<{ style: MusicStyle; model: string } | null> {
  if (!musicStyleConfigured(env)) return null;
  const result = await requestStyleContent(env, stylePrompt(prompt, spec));
  if (!result.ok) return null;
  const parsed = parseStyleContent(result.content);
  if (!parsed) return null;
  // 模型没给出的调性/种子字段才用提示词补位，避免覆盖模型已经做出的选择。
  const mood = promptMood(prompt, spec.musicPrompt);
  const style = sanitizeMusicStyle(parsed);
  const filled = mood
    ? {
        ...style,
        progression: 'progression' in parsed ? style.progression : mood.progression,
        transpose: 'transpose' in parsed ? style.transpose : mood.transpose,
        seed: 'seed' in parsed ? style.seed : promptSeed(prompt, spec.musicPrompt),
      }
    : style;
  return { style: applyPromptStyle(filled, prompt, spec.musicPrompt), model: env.model! };
}

export type MusicStyleProbeResult =
  | { ok: true; model: string; style: MusicStyle; url: string }
  | { ok: false; error: string; url?: string };

const PROBE_PROMPT = '这是一次连通性测试：请按系统提示只返回一个 JSON 风格参数对象。';

// 测试连接：真实请求一次模型并校验输出结构，不保存配置、不生成配乐。
export async function probeMusicStyle(env: MusicStyleEnv | undefined): Promise<MusicStyleProbeResult> {
  if (!musicStyleConfigured(env)) return { ok: false, error: 'style_not_configured' };
  const result = await requestStyleContent(env!, PROBE_PROMPT);
  if (!result.ok) return result;
  const parsed = parseStyleContent(result.content);
  if (!parsed) return { ok: false, error: 'style_invalid_response', url: result.url };
  return { ok: true, model: env!.model!, style: sanitizeMusicStyle(parsed), url: result.url };
}
