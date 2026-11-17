// 账号级音乐网关设置：密钥只保存在服务端，浏览器仅能读取配置状态。

import { requestJson } from './api.ts';

export interface MusicSettingsView {
  account: { apiUrl: string; name: string | null; hasKey: boolean } | null;
  server: { name: string | null } | null;
  effective: 'account' | 'server' | 'none';
}

export interface MusicTestResult {
  ok: boolean;
  mimeType?: string;
  bytes?: number;
  elapsedMs?: number;
  error?: string;
}

export function fetchMusicSettings(): Promise<MusicSettingsView> {
  return requestJson<MusicSettingsView>('/music/settings');
}

// 连通性测试会真实请求一次短配乐；未保存的新地址和密钥也可以直接测试。
export function testMusicSettings(body: { apiUrl: string; apiKey?: string; name?: string }): Promise<MusicTestResult> {
  return requestJson<MusicTestResult>('/music/settings/test', { method: 'POST', body });
}

export function musicErrorText(code: string): string {
  if (/^music_http_\d+$/.test(code)) {
    const status = Number(code.slice('music_http_'.length));
    if (status === 401 || status === 403) return '接口返回 HTTP ' + status + '（密钥可能无效或无权访问）';
    if (status >= 500) return '接口返回 HTTP ' + status + '（上游服务异常）';
    return '接口返回 HTTP ' + status;
  }
  const messages: Record<string, string> = {
    music_not_configured: '未填写接口地址或密钥',
    music_invalid_url: '接口地址不合法',
    music_timeout: '接口响应超时（最多等待 20 秒）',
    music_unsupported_type: '返回内容不是受支持的音频格式',
    music_too_large: '返回音频超过大小限制',
    music_empty: '接口返回了空音频',
    music_invalid_response: '返回内容不符合网关约定（需要音频字节或 audioBase64 JSON）',
    music_failed: '无法连接接口，请检查地址、网络与证书',
  };
  return messages[code] ?? '连接失败（' + code + '）';
}