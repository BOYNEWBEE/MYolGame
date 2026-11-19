// Agent 提供方式：Qoder CLI、自定义 HTTP 网关，以及 OpenAI 兼容聊天模型。
// 模型只返回文本；本文件不执行任何模型输出，也不把请求失败伪装成成功。

import { spawn } from 'node:child_process';
import {
  ModelResponseTooLargeError,
  readResponseTextLimited,
} from '../../functions/shared/openai.ts';
import { AgentError, GameOutputError } from './errors.ts';
import { askOpenAiModel } from './openai.ts';
import type { AgentConfig } from './protocol.ts';

const MAX_OUTPUT = 1024 * 1024;

function abortableTimeout(timeoutMs: number): { signal: AbortSignal; controller: AbortController; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  return { signal: controller.signal, controller, done: () => clearTimeout(timer) };
}

async function askHttpAgent(prompt: string, config: AgentConfig, timeoutMs: number): Promise<string> {
  const timeout = abortableTimeout(timeoutMs);
  try {
    const response = await fetch(config.apiUrl!, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + config.apiKey },
      body: JSON.stringify({ prompt, response_format: 'html' }),
      signal: timeout.signal,
      redirect: 'error',
    });
    if (!response.ok) {
      try {
        await response.body?.cancel();
      } catch {
        // 错误响应无需保留
      }
      throw new AgentError('agent_http_' + response.status, 'Agent 服务返回 HTTP ' + response.status);
    }
    let raw: string;
    try {
      raw = await readResponseTextLimited(response, config.maxResponseBytes ?? MAX_OUTPUT);
    } catch (error) {
      if (error instanceof ModelResponseTooLargeError) {
        throw new AgentError('agent_too_large', 'Agent 返回内容过大');
      }
      throw error;
    }
    let data: { html?: unknown };
    try {
      data = JSON.parse(raw) as { html?: unknown };
    } catch {
      throw new AgentError('agent_invalid_response', 'Agent 服务未返回合法 JSON');
    }
    if (typeof data.html !== 'string') {
      throw new AgentError('agent_invalid_response', 'Agent 服务必须返回 {"html":"完整游戏 HTML"}');
    }
    return data.html;
  } catch (error) {
    if (timeout.controller.signal.aborted) {
      throw new AgentError('agent_timeout', 'Agent 请求超时，已停止本次任务（未自动重试）');
    }
    if (error instanceof AgentError) throw error;
    throw new AgentError('agent_unreachable', '无法连接 Agent 服务，请检查地址与网络');
  } finally {
    timeout.done();
  }
}

async function askQoderCli(prompt: string, config: AgentConfig, timeoutMs: number): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(config.command || 'qoderclicn', [
      '-p', '--tools', '', '--permission-mode', 'dont_ask', '--no-session-persistence',
      '--output-format', 'text', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      '--setting-sources', 'user',
      '--max-model-request-retries', '1',
    ], { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    const output: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => child.kill('SIGKILL'), Math.max(1000, timeoutMs));
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT) child.kill('SIGKILL');
      else output.push(chunk);
    });
    // CLI 诊断可能包含凭据或供应商详情，不进入用户日志。
    child.stderr.resume();
    child.on('error', () => {
      clearTimeout(timer);
      reject(new AgentError('cli_unavailable', '无法启动 Qoder CLI，请检查安装与登录'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && size <= MAX_OUTPUT) resolve(Buffer.concat(output).toString('utf8'));
      else if (size > MAX_OUTPUT) reject(new AgentError('agent_too_large', 'Qoder CLI 输出过大'));
      else reject(new AgentError('cli_failed', 'Qoder CLI 调用失败，请检查登录、网络或执行预算'));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
  });
}

export async function askAgent(
  prompt: string,
  config: AgentConfig,
  timeoutMs = config.requestTimeoutMs ?? config.timeoutMs,
): Promise<string> {
  if (config.provider === 'openai') return await askOpenAiModel(prompt, config, timeoutMs);
  if (config.provider === 'http') return await askHttpAgent(prompt, config, timeoutMs);
  return await askQoderCli(prompt, config, timeoutMs);
}

function fencedBlocks(text: string): string[] {
  const blocks: string[] = [];
  const fence = /```([^\r\n]*)\r?\n?([\s\S]*?)```/g;
  for (;;) {
    const match = fence.exec(text);
    if (!match) break;
    if (match[2]) blocks.push(match[2]);
  }
  return blocks;
}

// 从纯 HTML 或 Markdown 代码块中提取完整文档；不接受只有片段的内容。
export function extractHtml(output: string): string {
  const text = output.replace(/^\uFEFF/, '');
  const candidates = [...fencedBlocks(text), text];
  for (const candidate of candidates) {
    const start = candidate.search(/<!doctype html>/i);
    const end = candidate.toLowerCase().lastIndexOf('</html>');
    if (start >= 0 && end > start) return candidate.slice(start, end + 7);
  }
  throw new GameOutputError('模型未返回完整的 HTML 文档（需包含 <!doctype html> 与 </html>）');
}