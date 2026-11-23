// 源码开发链路的可分类错误：错误码进入任务记录，供界面区分失败原因。
// 只有明确可修复的产物问题才允许再次请求模型；请求本身失败不会自动重试。

export class AgentError extends Error {
  code: string;
  retryable: boolean;
  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = 'AgentError';
    this.code = code;
    this.retryable = retryable;
  }
}

// 模型输出不是完整 HTML：属于可反馈修复的产物问题。
export class GameOutputError extends AgentError {
  constructor(message = '模型未返回完整 HTML 文档') {
    super('invalid_html', message, true);
    this.name = 'GameOutputError';
  }
}

// 浏览器无法启动等基础设施问题：重试模型没有意义。
export class BrowserUnavailableError extends AgentError {
  constructor(message: string) {
    super('browser_unavailable', message, false);
    this.name = 'BrowserUnavailableError';
  }
}

export function errorMessage(error: unknown, fallback: string, max = 600): string {
  const text = error instanceof Error ? error.message : fallback;
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').slice(0, max);
}