// 账号级音乐网关设置：密钥只保存在服务端，浏览器仅能读取配置状态。

import { requestJson } from './api.ts';

export interface MusicSettingsView {
  account: { apiUrl: string; name: string | null; hasKey: boolean } | null;
  server: { name: string | null } | null;
  effective: 'account' | 'server' | 'none';
}

export function fetchMusicSettings(): Promise<MusicSettingsView> {
  return requestJson<MusicSettingsView>('/music/settings');
}