// OpenAI 兼容的游戏源码开发模型：账号级配置校验与连接测试。
// 本模块只描述配置与探活，不生成游戏；真正的源码生成在 dev/agent 中执行。

import {
  ModelResponseTooLargeError,
  chatCompletionsUrls,
  parseChatCompletion,
  readResponseTextLimited,
  validateModelEndpoint,
} from './openai.ts';

export const GAME_MODEL_TIMEOUT_MS = 20000;
const MAX_API_URL = 512;
const MAX_API_KEY = 512;
const MAX_MODEL = 128;
const PROBE_RESPONSE_BYTES = 64 * 1024;
const PROBE_REPLY_MAX = 200;

export interface GameModelEnv {
  apiUrl?: string;
  apiKey?: string;
  model?: string;
}

export function gameModelConfigured(env: GameModelEnv | null | undefined): boolean {
  return Boolean(env?.apiUrl && env.apiKey && env.model);
}

export type GameModelSettingsParse =
  | { ok: true; apiUrl: string; apiKey: string; model: string }
  | { ok: false; error: string };

// 账号配置由服务端发起请求：默认 HTTPS，本机回环 HTTP 需管理员显式放行。
export function parseGameModelSettingsInput(
  raw: { apiUrl?: unknown; apiKey?: unknown; model?: unknown },
  previousKey: string | undefined,
  allowLocal: boolean,
): GameModelSettingsParse {
  const apiUrl = typeof raw.apiUrl === 'string' ? raw.apiUrl.trim() : '';
  if (!apiUrl || apiUrl.length > MAX_API_URL) {
    return { ok: false, error: '接口地址不能为空，且不超过 ' + MAX_API_URL + ' 个字符' };
  }
  try {
    validateModelEndpoint(apiUrl, allowLocal);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '接口地址不合法' };
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

function statusError(status: number): string {
  if (status === 401 || status === 403) return 'model_auth_failed';
  if (status === 429) return 'model_rate_limited';
  if (status === 408) return 'model_timeout';
  return 'model_http_' + status;
}

type ProbeOnce = { ok: true; content: string; url: string } | { ok: false; error: string; url: string };

// 只发一次最小请求验证鉴权、模型名与地址；不生成游戏，也不保存任何内容。
async function probeOnce(url: string, env: GameModelEnv, timeoutMs: number): Promise<ProbeOnce> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
        temperature: 0,
        max_tokens: 16,
        stream: false,
        messages: [
          { role: 'system', content: '这是一次连接测试。请只回复 OK，不要输出代码或解释。' },
          { role: 'user', content: '连接测试：只回复 OK。' },
        ],
      }),
      signal: controller.signal,
      // 不跟随重定向，避免把密钥带到未配置的目标。
      redirect: 'error',
    });
    if (!response.ok) {
      try {
        await response.body?.cancel();
      } catch {
        // 错误响应无需保留
      }
      return { ok: false, error: statusError(response.status), url };
    }
    let raw: string;
    try {
      raw = await readResponseTextLimited(response, PROBE_RESPONSE_BYTES);
    } catch (error) {
      if (error instanceof ModelResponseTooLargeError) return { ok: false, error: 'model_too_large', url };
      throw error;
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'model_invalid_response', url };
    }
    const parsed = parseChatCompletion(body);
    if (!parsed) return { ok: false, error: 'model_invalid_response', url };
    const content = parsed.content.trim();
    if (!content) return { ok: false, error: 'model_empty_output', url };
    return { ok: true, content, url };
  } catch {
    return { ok: false, error: controller.signal.aborted ? 'model_timeout' : 'model_unreachable', url };
  } finally {
    clearTimeout(timer);
  }
}

export type GameModelProbeResult =
  | { ok: true; model: string; reply: string; url: string }
  | { ok: false; error: string; url?: string };

export async function probeGameModel(
  env: GameModelEnv | null | undefined,
  timeoutMs = GAME_MODEL_TIMEOUT_MS,
): Promise<GameModelProbeResult> {
  if (!gameModelConfigured(env)) return { ok: false, error: 'model_not_configured' };
  const urls = chatCompletionsUrls(env!.apiUrl!);
  let last: ProbeOnce = { ok: false, error: 'model_unreachable', url: urls[urls.length - 1]! };
  for (let i = 0; i < urls.length; i += 1) {
    last = await probeOnce(urls[i]!, env!, timeoutMs);
    // 只有 404 且还有 /v1 备选时才换地址；连接测试同样不会重复发送生成请求。
    if (last.ok || last.error !== 'model_http_404') break;
  }
  if (!last.ok) {
    return { ok: false, error: last.error, url: last.url };
  }
  return { ok: true, model: env!.model!, reply: last.content.slice(0, PROBE_REPLY_MAX), url: last.url };
}
