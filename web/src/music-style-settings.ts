// 账号级 AI 编曲模型设置：OpenAI 兼容接口，密钥只保存在服务端。

import { requestJson } from './api.ts';

export interface MusicStyleSettingsView {
  account: { apiUrl: string; model: string; hasKey: boolean } | null;
  server: { model: string | null } | null;
  effective: 'account' | 'server' | 'none';
}

export function fetchMusicStyleSettings(): Promise<MusicStyleSettingsView> {
  return requestJson<MusicStyleSettingsView>('/music/style-model');
}
