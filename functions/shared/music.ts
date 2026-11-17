// 音乐生成网关：调用服务端配置的 HTTP 接口，把返回的音频内嵌到游戏 HTML。
// 契约：POST JSON { prompt, durationSeconds, format, loop, model? }
//   → 响应 content-type 为 audio/* 时直接读取音频字节；
//   → 响应 JSON { audioBase64, mimeType } 时解码 base64。
// 服务端地址与密钥只来自运行环境，不接受用户输入；失败由生成管线回退。

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
// 单文件 HTML 上限 512KB；音频编码后还要经过 base64 膨胀，限制原始字节留出余量。
export const MAX_MUSIC_BYTES = 240 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30000;
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

export function musicPrompt(spec: GameSpec): string {
  const difficulty = spec.difficulty === 'easy' ? -8 : spec.difficulty === 'hard' ? 10 : 0;
  const bpm = Math.max(70, Math.min(160, Math.round(84 + spec.speed * 24 + difficulty)));
  return [
    'Seamless instrumental background music loop for a',
    TEMPLATE_MOOD[spec.template] + ' game.',
    'Mood: ' + THEME_MOOD[spec.theme] + '.',
    bpm + ' BPM.',
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

export async function generateMusicTrack(env: MusicEnv | undefined, spec: GameSpec): Promise<MusicResult> {
  if (!musicConfigured(env)) return { ok: false, error: 'music_not_configured' };

  const prompt = musicPrompt(spec);
  const cacheKey = [env!.apiUrl, env!.name ?? '', prompt, MUSIC_DURATION_SECONDS, 'mp3'].join('|');
  const cached = cache.get(cacheKey);
  if (cached) return { ok: true, track: cached };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(env!.apiUrl!, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'audio/*, application/json',
        authorization: 'Bearer ' + env!.apiKey,
      },
      body: JSON.stringify({
        prompt,
        durationSeconds: MUSIC_DURATION_SECONDS,
        format: 'mp3',
        loop: true,
        ...(env!.name ? { model: env!.name } : {}),
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
    let result: MusicResult;
    if (mime.startsWith('audio/')) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      result = bytes.length > MAX_RESPONSE_BYTES ? { ok: false, error: 'music_too_large' } : finish(bytes, normalizeMime(mime));
    } else {
      const raw = await response.text();
      if (raw.length > MAX_RESPONSE_BYTES) return { ok: false, error: 'music_too_large' };
      result = parseJsonResponse(raw, mime);
    }

    if (result.ok) {
      cache.set(cacheKey, result.track);
      if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
    }
    return result;
  } catch {
    return { ok: false, error: controller.signal.aborted ? 'music_timeout' : 'music_failed' };
  } finally {
    clearTimeout(timer);
  }
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