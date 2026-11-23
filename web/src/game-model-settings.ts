// 账号级游戏源码开发模型设置：OpenAI 兼容接口，密钥只保存在服务端。

import { requestJson } from './api.ts';

export interface AgentModelSettingsView {
  available: boolean;
  provider: string | null;
  allowLocal: boolean;
  account: { apiUrl: string; model: string; hasKey: boolean } | null;
  server: { model: string | null } | null;
  effective: 'account' | 'server' | 'none';
}

export interface AgentModelTestResult {
  ok: boolean;
  model?: string;
  reply?: string;
  url?: string;
  elapsedMs?: number;
  source?: 'form' | 'account' | 'server';
  error?: string;
}

export function fetchAgentModelSettings(): Promise<AgentModelSettingsView> {
  return requestJson<AgentModelSettingsView>('/agent/model');
}

export function saveAgentModelSettings(body: { apiUrl: string; model: string; apiKey?: string }): Promise<AgentModelSettingsView> {
  return requestJson<AgentModelSettingsView>('/agent/model', { method: 'PUT', body });
}

// 连接测试会真实请求一次模型；未保存的新地址、模型名和密钥也可直接测试。
export function testAgentModelSettings(body: { apiUrl?: string; apiKey?: string; model?: string }): Promise<AgentModelTestResult> {
  return requestJson<AgentModelTestResult>('/agent/model/test', { method: 'POST', body });
}

export function clearAgentModelSettings(): Promise<AgentModelSettingsView> {
  return requestJson<AgentModelSettingsView>('/agent/model', { method: 'DELETE' });
}

export function agentModelErrorText(code: string): string {
  if (/^model_http_\d+$/.test(code)) {
    const status = Number(code.slice('model_http_'.length));
    if (status === 401 || status === 403) return '模型接口返回 HTTP ' + status + '（密钥可能无效或无权访问该模型）';
    if (status === 404) return '模型接口返回 HTTP 404（请检查接口地址是否需要 /v1，以及模型名是否正确）';
    if (status === 429) return '模型接口返回 HTTP 429（请求频率或额度受限）';
    if (status >= 500) return '模型接口返回 HTTP ' + status + '（上游服务异常）';
    return '模型接口返回 HTTP ' + status;
  }
  const messages: Record<string, string> = {
    model_not_configured: '未填写接口地址、模型名或密钥',
    model_timeout: '模型响应超时（最多等待 20 秒）',
    model_auth_failed: '模型鉴权失败（密钥可能无效或无权访问）',
    model_rate_limited: '模型服务限流，请稍后再试',
    model_empty_output: '模型返回空内容',
    model_invalid_response: '返回内容不符合 OpenAI 兼容格式',
    model_too_large: '模型响应超过大小限制',
    model_unreachable: '无法连接模型接口，请检查地址、网络与证书',
    agent_model_unavailable: '服务端未启用 OpenAI 兼容源码开发',
  };
  return messages[code] ?? '连接失败（' + code + '）';
}
