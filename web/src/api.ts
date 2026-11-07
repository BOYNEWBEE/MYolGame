// API 客户端：同源调用 /functions/v1/app/api/...（与 Qoder Sites 部署路径一致）。

export const API_BASE = '/functions/v1/app/api';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const TOKEN_KEY = 'myol.token';
const NICK_KEY = 'myol.nickname';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function saveToken(token: string, nickname: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(NICK_KEY, nickname);
}

export function getNickname(): string {
  return localStorage.getItem(NICK_KEY) ?? '匿名创作者';
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
}

export async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.auth !== false) {
    const token = getToken();
    if (token) headers['authorization'] = 'Bearer ' + token;
  }
  const response = await fetch(API_BASE + path, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError(response.status, 'invalid_response', '服务返回了非 JSON 内容');
  }
  if (!response.ok) {
    const err = (data as { error?: { code?: string; message?: string } })?.error;
    throw new ApiError(
      response.status,
      err?.code ?? 'http_' + response.status,
      err?.message ?? '请求失败（' + response.status + '）',
    );
  }
  return data as T;
}

// 带鉴权的文件下载（源码包等）：转 Blob 后触发浏览器保存
export async function downloadAuthorized(path: string, fallbackName: string): Promise<void> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['authorization'] = 'Bearer ' + token;
  const response = await fetch(API_BASE + path, { headers });
  if (!response.ok) {
    throw new ApiError(response.status, 'download_failed', '下载失败（' + response.status + '）');
  }
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = disposition.match(/filename\*=UTF-8''([^;]+)/);
  const name = match ? decodeURIComponent(match[1]!) : fallbackName;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
