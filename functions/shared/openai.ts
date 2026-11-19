// OpenAI 兼容聊天接口的通用工具：地址归一化、受限读取与响应文本解析。
// 本文件不读取密钥；Authorization 由服务端调用方按配置注入。

export const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

// 兼容填基址、/v1 基址或完整 /chat/completions 地址。
export function chatCompletionsUrl(apiUrl: string): string {
  const trimmed = apiUrl.trim().replace(/\/+$/, '');
  return /\/chat\/completions$/.test(trimmed) ? trimmed : trimmed + '/chat/completions';
}

export function chatCompletionsUrls(apiUrl: string): string[] {
  const trimmed = apiUrl.trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(trimmed)) return [trimmed];
  const primary = chatCompletionsUrl(trimmed);
  try {
    // 无路径基址再补一个 /v1 备选：OpenAI 等服务必须带版本前缀。
    // 仅在首个地址返回 404 时才尝试，避免正常请求产生额外调用。
    if (!new URL(trimmed).pathname.replace(/\/+$/, '')) {
      return [primary, trimmed + '/v1/chat/completions'];
    }
  } catch {
    // 非法地址交给请求阶段返回明确错误。
  }
  return [primary];
}

export interface ChatCompletionText {
  content: string;
  finishReason: string | null;
}

// 解析 choices[0].message.content；兼容字符串与分段文本数组两种常见形式。
export function parseChatCompletion(body: unknown): ChatCompletionText | null {
  if (typeof body !== 'object' || body === null) return null;
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0] as { message?: unknown; finish_reason?: unknown } | null;
  if (typeof first !== 'object' || first === null) return null;
  const message = first.message as { content?: unknown } | null | undefined;
  if (typeof message !== 'object' || message === null) return null;
  let content: unknown = message.content;
  if (Array.isArray(content)) {
    content = content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part === 'object' && part !== null) {
          const item = part as { type?: unknown; text?: unknown };
          return item.type === 'text' && typeof item.text === 'string' ? item.text : '';
        }
        return '';
      })
      .join('');
  }
  if (typeof content !== 'string') return null;
  return {
    content,
    finishReason: typeof first.finish_reason === 'string' ? first.finish_reason : null,
  };
}

export const MAX_MODEL_RESPONSE_BYTES = 1024 * 1024;

export class ModelResponseTooLargeError extends Error {
  constructor() {
    super('model_response_too_large');
    this.name = 'ModelResponseTooLargeError';
  }
}

// 流式读取响应并限制总字节数，避免在检查大小前把无限响应读入内存。
export async function readResponseTextLimited(
  response: Response,
  maxBytes = MAX_MODEL_RESPONSE_BYTES,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > maxBytes) throw new ModelResponseTooLargeError();
      chunks.push(value);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // 响应已结束时取消失败可忽略
    }
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}