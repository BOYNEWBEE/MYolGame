// 音乐生成网关：调用服务端配置（或账号保存）的 HTTP 接口，把返回的音频内嵌到游戏 HTML。
// 契约：POST JSON { prompt, durationSeconds, format, loop, model? }
//   → 响应 content-type 为 audio/* 时直接读取音频字节；
//   → 响应 JSON { audioBase64, mimeType } 时解码 base64。
// 账号配置只保存于服务端，读取接口不回传密钥；失败由生成管线回退为无配乐。

import type { GameSpec, TemplateId, ThemeId } from './spec.ts';

export interface MusicEnv {
  apiUrl?: string;
  apiKey?: string;
  name?: string;
}

export interface MusicTrack {
  dataUri: string;
  mimeType: string;
  bytes: number;
}

export type MusicResult = { ok: true; track: MusicTrack } | { ok: false; error: string };

export const MUSIC_DURATION_SECONDS = 20;
export const MAX_MUSIC_API_URL = 512;
export const MAX_MUSIC_API_KEY = 512;
export const MAX_MUSIC_NAME = 40;
// 单文件 HTML 上限 512KB；音频编码后还要经过 base64 膨胀，限制原始字节留出余量。
export const MAX_MUSIC_BYTES = 240 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30000;
// 连通性测试只生成一小段并等待更短时间，避免用户点击测试时长时间占用请求。
const PROBE_DURATION_SECONDS = 5;
const PROBE_TIMEOUT_MS = 20000;
const PROBE_PROMPT = 'Short instrumental connectivity test for a browser game, calm synth pad, no vocals.';
const CACHE_LIMIT = 16;

const MIME_ALIASES: Record<string, string> = {
  'audio/mp3': 'audio/mpeg',
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/x-m4a': 'audio/mp4',
};
const ALLOWED_MIME = new Set(['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/webm']);

const THEME_MOOD: Record<ThemeId, string> = {
  neon: 'neon synthwave, bright arpeggios',
  retro: 'retro chiptune, 8-bit square waves',
  forest: 'playful acoustic, light percussion',
  ocean: 'calm ambient pads, gentle waves',
  candy: 'bubbly pop, sparkling bells',
  starfield: 'deep space ambient, slow pulse',
  ink: 'traditional Chinese instruments, meditative',
  sunset: 'warm lo-fi, mellow chords',
};

const TEMPLATE_MOOD: Record<TemplateId, string> = {
  breakout: 'classic arcade breakout',
  snake: 'lighthearted puzzle arcade',
  'space-shooter': 'energetic space shooter',
  tetris: 'steady block puzzle',
  '2048': 'relaxed number merge puzzle',
};

const cache = new Map<string, MusicTrack>();

export function musicConfigured(env: MusicEnv | undefined): boolean {
  return Boolean(env?.apiUrl && env.apiKey);
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export type MusicSettingsParse =
  | { ok: true; apiUrl: string; apiKey: string; name: string | null }
  | { ok: false; error: string };

// 账号配置会由服务端发起请求，因此限制为 HTTPS；本机调试放行回环地址的 HTTP。
export function parseMusicSettingsInput(
  raw: { apiUrl?: unknown; apiKey?: unknown; name?: unknown },
  previousKey?: string,
): MusicSettingsParse {
  const apiUrl = typeof raw.apiUrl === 'string' ? raw.apiUrl.trim() : '';
  if (!apiUrl || apiUrl.length > MAX_MUSIC_API_URL) {
    return { ok: false, error: '接口地址不能为空，且不超过 ' + MAX_MUSIC_API_URL + ' 个字符' };
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
  if (rawKey.length > MAX_MUSIC_API_KEY) return { ok: false, error: 'API 密钥过长（最多 ' + MAX_MUSIC_API_KEY + ' 个字符）' };
  if (/[\u0000-\u001f\u007f]/.test(rawKey)) return { ok: false, error: 'API 密钥包含控制字符' };
  const apiKey = rawKey || previousKey || '';
  if (!apiKey) return { ok: false, error: '请填写 API 密钥' };

  const name = typeof raw.name === 'string'
    ? raw.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_MUSIC_NAME)
    : '';
  return { ok: true, apiUrl, apiKey, name: name || null };
}

export function musicPrompt(spec: GameSpec): string {
  const difficulty = spec.difficulty === 'easy' ? -8 : spec.difficulty === 'hard' ? 10 : 0;
  const bpm = Math.max(70, Math.min(160, Math.round(84 + spec.speed * 24 + difficulty)));
  return [
    'Seamless instrumental background music loop for a',
    TEMPLATE_MOOD[spec.template] + ' game.',
    'Mood: ' + THEME_MOOD[spec.theme] + '.',
    bpm + ' BPM.',
    ...(spec.musicPrompt ? ['Additional direction: ' + spec.musicPrompt + '.'] : []),
    MUSIC_DURATION_SECONDS + ' seconds, no vocals, no long intro, loop-friendly ending.',
  ].join(' ');
}

function normalizeMime(value: string | null, fallback = ''): string {
  const raw = (value || fallback).split(';')[0].trim().toLowerCase();
  return MIME_ALIASES[raw] ?? raw;
}

function finish(bytes: Uint8Array, mime: string): MusicResult {
  if (!ALLOWED_MIME.has(mime)) return { ok: false, error: 'music_unsupported_type' };
  if (bytes.length === 0) return { ok: false, error: 'music_empty' };
  if (bytes.length > MAX_MUSIC_BYTES) return { ok: false, error: 'music_too_large' };
  return {
    ok: true,
    track: { dataUri: 'data:' + mime + ';base64,' + bytesToBase64(bytes), mimeType: mime, bytes: bytes.length },
  };
}

function base64ToBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return null;
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  // 分块避免超长参数导致调用栈溢出。
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function validGatewayUrl(value: string): boolean {
  try {
    const gateway = new URL(value);
    return ['http:', 'https:'].includes(gateway.protocol) && !gateway.username && !gateway.password;
  } catch {
    return false;
  }
}

async function requestTrack(
  env: MusicEnv,
  prompt: string,
  durationSeconds: number,
  timeoutMs: number,
): Promise<MusicResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(env.apiUrl!, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'audio/*, application/json',
        authorization: 'Bearer ' + env.apiKey,
      },
      body: JSON.stringify({
        prompt,
        durationSeconds,
        format: 'mp3',
        loop: true,
        ...(env.name ? { model: env.name } : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { ok: false, error: 'music_http_' + response.status };
    }

    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > MAX_RESPONSE_BYTES) {
      await response.body?.cancel();
      return { ok: false, error: 'music_too_large' };
    }

    const mime = normalizeMime(response.headers.get('content-type'));
    if (mime.startsWith('audio/')) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      return bytes.length > MAX_RESPONSE_BYTES ? { ok: false, error: 'music_too_large' } : finish(bytes, normalizeMime(mime));
    }
    const raw = await response.text();
    if (raw.length > MAX_RESPONSE_BYTES) return { ok: false, error: 'music_too_large' };
    return parseJsonResponse(raw, mime);
  } catch {
    return { ok: false, error: controller.signal.aborted ? 'music_timeout' : 'music_failed' };
  } finally {
    clearTimeout(timer);
  }
}

export async function generateMusicTrack(env: MusicEnv | undefined, spec: GameSpec): Promise<MusicResult> {
  if (!musicConfigured(env)) return { ok: false, error: 'music_not_configured' };
  if (!validGatewayUrl(env!.apiUrl!)) return { ok: false, error: 'music_invalid_url' };

  const prompt = musicPrompt(spec);
  // 密钥参与缓存键，避免不同账号使用同一网关时互相复用结果。
  const cacheKey = [env!.apiUrl, env!.apiKey, env!.name ?? '', prompt, MUSIC_DURATION_SECONDS, 'mp3'].join('|');
  const cached = cache.get(cacheKey);
  if (cached) return { ok: true, track: cached };

  const result = await requestTrack(env!, prompt, MUSIC_DURATION_SECONDS, REQUEST_TIMEOUT_MS);
  if (result.ok) {
    cache.set(cacheKey, result.track);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  }
  return result;
}

export type MusicProbeResult = {
  ok: true;
  mimeType: string;
  bytes: number;
} | { ok: false; error: string };

// 测试连接：真实发起一次 5 秒生成请求，校验鉴权、响应用与音频格式，不返回、不缓存音频。
export async function probeMusicGateway(env: MusicEnv | undefined): Promise<MusicProbeResult> {
  if (!musicConfigured(env)) return { ok: false, error: 'music_not_configured' };
  if (!validGatewayUrl(env!.apiUrl!)) return { ok: false, error: 'music_invalid_url' };
  const result = await requestTrack(env!, PROBE_PROMPT, PROBE_DURATION_SECONDS, PROBE_TIMEOUT_MS);
  return result.ok
    ? { ok: true, mimeType: result.track.mimeType, bytes: result.track.bytes }
    : result;
}

function parseJsonResponse(raw: string, fallbackMime: string): MusicResult {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: 'music_invalid_response' };
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return { ok: false, error: 'music_invalid_response' };
  }

  const encoded = typeof body.audioBase64 === 'string' ? body.audioBase64.trim() : '';
  if (!encoded) return { ok: false, error: 'music_invalid_response' };
  if (encoded.length > Math.ceil(MAX_MUSIC_BYTES / 3) * 4 + 4) return { ok: false, error: 'music_too_large' };

  const declared = typeof body.mimeType === 'string' ? body.mimeType : '';
  const mime = normalizeMime(declared || (fallbackMime.startsWith('audio/') ? fallbackMime : 'audio/mpeg'));
  const bytes = base64ToBytes(encoded);
  if (!bytes) return { ok: false, error: 'music_invalid_response' };
  return finish(bytes, mime);
}