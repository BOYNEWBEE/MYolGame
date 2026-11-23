// 平台 get_context 于本实验确认的 API 来源，只用于服务端，不从浏览器输入选择。
// @ts-expect-error 平台随附的 JavaScript 适配器，由运行时检查请求与响应
import { createCloudAgentsClient } from './transport.mjs';
export const QCA_ORIGIN = 'https://api.qoder.com.cn';
export interface CloudClient {
  request(path: string, options?: { method?: string; body?: unknown; idempotencyKey?: string }): Promise<any>;
}
export const liveClient = (getToken: () => string | undefined): CloudClient => createCloudAgentsClient({ origin: QCA_ORIGIN, getToken, timeoutMs: 15000 });
