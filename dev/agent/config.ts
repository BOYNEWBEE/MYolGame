// 所有配置仅由宿主机管理员设置，不接受浏览器请求覆盖。
import type { AgentConfig } from './protocol.ts';

export function loadAgentConfig(): AgentConfig | undefined {
  const provider = process.env.MYOLGAME_AGENT_PROVIDER;
  if (!provider) return undefined;
  if (provider !== 'qoder' && provider !== 'http') throw new Error('MYOLGAME_AGENT_PROVIDER 只能为 qoder 或 http');
  const timeoutMs = Number(process.env.MYOLGAME_AGENT_TIMEOUT_MS || 180000);
  const maxAttempts = Number(process.env.MYOLGAME_AGENT_MAX_ATTEMPTS || 3);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000 ||
      !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new Error('Agent 预算无效：超时范围 1000–600000 毫秒，尝试次数 1–3');
  }
  if (provider === 'http') {
    const url = new URL(process.env.MYOLGAME_AGENT_API_URL || '');
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) {
      throw new Error('Agent API 必须为 HTTPS 或本机 HTTP 地址');
    }
    if (url.username || url.password || !process.env.MYOLGAME_AGENT_API_KEY) throw new Error('请通过环境变量配置 Agent API 密钥');
  }
  return {
    provider, timeoutMs, maxAttempts,
    name: process.env.MYOLGAME_AGENT_NAME || (provider === 'qoder' ? 'Qoder CLI' : '自定义 Agent'),
    command: process.env.MYOLGAME_AGENT_COMMAND || 'qoderclicn',
    apiUrl: process.env.MYOLGAME_AGENT_API_URL,
    apiKey: process.env.MYOLGAME_AGENT_API_KEY,
    chromePath: process.env.MYOLGAME_CHROME_PATH || '/usr/bin/google-chrome',
  };
}
