// 所有环境变量配置仅由宿主机管理员设置；openai provider 的账号级配置由 API 路由单独校验。

import { validateModelEndpoint } from '../../functions/shared/openai.ts';
import { resolveChromePath } from '../chrome.ts';
import type { AgentConfig } from './protocol.ts';

export { validateModelEndpoint };

const ALLOWED_PROVIDERS = ['qoder', 'http', 'openai'] as const;
type Provider = (typeof ALLOWED_PROVIDERS)[number];

export function agentAllowLocal(): boolean {
  const value = (process.env.MYOLGAME_AGENT_ALLOW_LOCAL ?? '').toLowerCase();
  return value === '1' || value === 'true';
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

  const apiUrlRaw = (process.env.MYOLGAME_AGENT_API_URL || '').trim();
  const apiKeyRaw = process.env.MYOLGAME_AGENT_API_KEY || '';
  const model = (process.env.MYOLGAME_AGENT_MODEL || '').trim();

  if (provider === 'http') {
    if (!apiUrlRaw) throw new Error('自定义 HTTP Agent 需要配置 MYOLGAME_AGENT_API_URL');
    if (!apiKeyRaw) throw new Error('请通过环境变量配置 Agent API 密钥');
    return {
      ...base,
      name: process.env.MYOLGAME_AGENT_NAME || '自定义 Agent',
      apiUrl: validateModelEndpoint(apiUrlRaw, agentAllowLocal()),
      apiKey: apiKeyRaw,
    };
  }

  if (model && (model.length > 128 || !/^[A-Za-z0-9._:/-]+$/.test(model))) {
    throw new Error('MYOLGAME_AGENT_MODEL 必须为 1–128 位字母、数字或 . _ : / -');
  }
  // openai provider 的地址、密钥与模型可由各账号在账号管理中配置；
  // 环境变量存在时作为服务端默认值，缺失时不阻止服务启动。
  return {
    ...base,
    name: process.env.MYOLGAME_AGENT_NAME || (model ? 'OpenAI 兼容（' + model + '）' : 'OpenAI 兼容（账号级配置）'),
    apiUrl: apiUrlRaw ? validateModelEndpoint(apiUrlRaw, agentAllowLocal()) : undefined,
    apiKey: apiKeyRaw || undefined,
    model: model || undefined,
  };
}