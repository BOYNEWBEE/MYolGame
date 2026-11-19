// 所有配置仅由宿主机管理员设置，不接受浏览器请求覆盖。
import { LOOPBACK_HOSTS } from '../../functions/shared/openai.ts';
import { resolveChromePath } from '../chrome.ts';
import type { AgentConfig } from './protocol.ts';

const ALLOWED_PROVIDERS = ['qoder', 'http', 'openai'] as const;
type Provider = (typeof ALLOWED_PROVIDERS)[number];

function allowLocal(): boolean {
  const value = (process.env.MYOLGAME_AGENT_ALLOW_LOCAL ?? '').toLowerCase();
  return value === '1' || value === 'true';
}

// 服务端请求的目标地址：默认只允许 HTTPS；本机 HTTP 需管理员显式放行。
export function validateModelEndpoint(raw: string, localAllowed: boolean): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('模型接口地址不是合法的 URL');
  }
  if (url.username || url.password) throw new Error('模型接口地址不能包含账号密码');
  if (url.hash) throw new Error('模型接口地址不能包含 # 片段');
  if (url.protocol === 'https:') return raw;
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) {
    if (localAllowed) return raw;
    throw new Error('本机 HTTP 模型地址需显式设置 MYOLGAME_AGENT_ALLOW_LOCAL=1');
  }
  throw new Error('模型接口地址必须使用 HTTPS；本机调试需显式放行回环 HTTP');
}

function parseBoundedInt(name: string, raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(name + ' 必须为 ' + min + '–' + max + ' 的整数');
  }
  return value;
}

export function loadAgentConfig(): AgentConfig | undefined {
  const provider = process.env.MYOLGAME_AGENT_PROVIDER;
  if (!provider) return undefined;
  if (!ALLOWED_PROVIDERS.includes(provider as Provider)) {
    throw new Error('MYOLGAME_AGENT_PROVIDER 只能为 qoder、http 或 openai');
  }
  const timeoutMs = parseBoundedInt('MYOLGAME_AGENT_TIMEOUT_MS', process.env.MYOLGAME_AGENT_TIMEOUT_MS, 180000, 1000, 600000);
  const rawRequestTimeout = parseBoundedInt(
    'MYOLGAME_AGENT_REQUEST_TIMEOUT_MS',
    process.env.MYOLGAME_AGENT_REQUEST_TIMEOUT_MS,
    Math.min(timeoutMs, 120000),
    1000,
    600000,
  );
  const requestTimeoutMs = Math.min(rawRequestTimeout, timeoutMs);
  const maxRepairs = parseBoundedInt('MYOLGAME_AGENT_MAX_REPAIRS', process.env.MYOLGAME_AGENT_MAX_REPAIRS, -1, -1, 3);
  const maxAttempts = maxRepairs >= 0
    ? maxRepairs + 1
    : parseBoundedInt('MYOLGAME_AGENT_MAX_ATTEMPTS', process.env.MYOLGAME_AGENT_MAX_ATTEMPTS, 3, 1, 4);
  const maxOutputTokens = parseBoundedInt(
    'MYOLGAME_AGENT_MAX_OUTPUT_TOKENS',
    process.env.MYOLGAME_AGENT_MAX_OUTPUT_TOKENS,
    8192,
    256,
    32768,
  );
  const maxResponseBytes = parseBoundedInt(
    'MYOLGAME_AGENT_MAX_RESPONSE_BYTES',
    process.env.MYOLGAME_AGENT_MAX_RESPONSE_BYTES,
    1024 * 1024,
    64 * 1024,
    4 * 1024 * 1024,
  );

  const base = {
    provider: provider as Provider,
    timeoutMs,
    requestTimeoutMs,
    maxAttempts,
    maxOutputTokens,
    maxResponseBytes,
    command: process.env.MYOLGAME_AGENT_COMMAND || 'qoderclicn',
    chromePath: resolveChromePath(),
  };

  if (provider === 'qoder') {
    return {
      ...base,
      name: process.env.MYOLGAME_AGENT_NAME || 'Qoder CLI',
    };
  }

  const apiUrl = validateModelEndpoint(process.env.MYOLGAME_AGENT_API_URL || '', allowLocal());
  if (!process.env.MYOLGAME_AGENT_API_KEY) {
    throw new Error('请通过环境变量配置 Agent API 密钥');
  }

  if (provider === 'http') {
    return {
      ...base,
      name: process.env.MYOLGAME_AGENT_NAME || '自定义 Agent',
      apiUrl,
      apiKey: process.env.MYOLGAME_AGENT_API_KEY,
    };
  }

  const model = (process.env.MYOLGAME_AGENT_MODEL || '').trim();
  if (!model || model.length > 128 || !/^[A-Za-z0-9._:/-]+$/.test(model)) {
    throw new Error('MYOLGAME_AGENT_MODEL 必须为 1–128 位字母、数字或 . _ : / -');
  }
  return {
    ...base,
    name: process.env.MYOLGAME_AGENT_NAME || 'OpenAI 兼容（' + model + '）',
    apiUrl,
    apiKey: process.env.MYOLGAME_AGENT_API_KEY,
    model,
  };
}