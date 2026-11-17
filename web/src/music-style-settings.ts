// 账号级 AI 编曲模型设置：OpenAI 兼容接口，密钥只保存在服务端。

import { requestJson } from './api.ts';

export interface MusicStyleSettingsView {
  account: { apiUrl: string; model: string; hasKey: boolean } | null;
  server: { model: string | null } | null;
  effective: 'account' | 'server' | 'none';
}

export interface MusicStyleTestResult {
  ok: boolean;
  model?: string;
  bpm?: number;
  progression?: string;
  transpose?: number;
  elapsedMs?: number;
  error?: string;
}

export function fetchMusicStyleSettings(): Promise<MusicStyleSettingsView> {
  return requestJson<MusicStyleSettingsView>('/music/style-model');
}

// 连通性测试会真实请求一次模型；未保存的新地址、模型名和密钥也可直接测试。
export function testMusicStyleSettings(body: { apiUrl: string; apiKey?: string; model?: string }): Promise<MusicStyleTestResult> {
  return requestJson<MusicStyleTestResult>('/music/style-model/test', { method: 'POST', body });
}

export function musicStyleErrorText(code: string): string {
  if (/^style_http_\d+$/.test(code)) {
    const status = Number(code.slice('style_http_'.length));
    if (status === 401 || status === 403) return '模型接口返回 HTTP ' + status + '（密钥可能无效或无权访问）';
    if (status === 404) return '模型接口返回 HTTP 404（请检查地址与模型名）';
    if (status === 429) return '模型接口返回 HTTP 429（请求频率或额度受限）';
    if (status >= 500) return '模型接口返回 HTTP ' + status + '（上游服务异常）';
    return '模型接口返回 HTTP ' + status;
  }
  const messages: Record<string, string> = {
    style_not_configured: '未填写接口地址、模型名或密钥',
    style_timeout: '模型响应超时（最多等待 20 秒）',
    style_invalid_response: '返回内容不符合 OpenAI 兼容格式，或缺少可识别的风格参数',
    style_failed: '无法连接模型接口，请检查地址、网络与证书',
  };
  return messages[code] ?? '连接失败（' + code + '）';
}
