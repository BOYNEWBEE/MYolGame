// 模型只返回文本；禁用 Qoder 的全部工具和 MCP，不允许需求触发宿主机命令。
import { spawn } from 'node:child_process';
import type { AgentConfig } from './protocol.ts';

const MAX_OUTPUT = 1024 * 1024;

export async function askAgent(prompt: string, config: AgentConfig): Promise<string> {
  if (config.provider === 'http') {
    const response = await fetch(config.apiUrl!, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + config.apiKey },
      body: JSON.stringify({ prompt, response_format: 'html' }),
      signal: AbortSignal.timeout(config.timeoutMs),
      redirect: 'error',
    });
    if (!response.ok) throw new Error('Agent 服务返回 HTTP ' + response.status);
    // 流式限制响应体，避免错误网关返回无限数据。
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Agent 服务返回空响应');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_OUTPUT) throw new Error('Agent 返回内容过大');
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    let data: { html?: unknown };
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { html?: unknown }; }
    catch { throw new Error('Agent 服务未返回合法 JSON'); }
    if (typeof data.html !== 'string') throw new Error('Agent 服务必须返回 {"html":"完整游戏 HTML"}');
    return data.html;
  }
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(config.command || 'qoderclicn', [
      '-p', '--tools', '', '--permission-mode', 'dont_ask', '--no-session-persistence',
      '--output-format', 'text', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      '--setting-sources', 'user',
      '--max-model-request-retries', '1',
    ], { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    const output: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => child.kill('SIGKILL'), config.timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT) child.kill('SIGKILL');
      else output.push(chunk);
    });
    // CLI 诊断可能包含凭据或供应商详情，不进入用户日志。
    child.stderr.resume();
    child.on('error', () => { clearTimeout(timer); reject(new Error('无法启动 Qoder CLI，请检查安装与登录')); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && size <= MAX_OUTPUT) resolve(Buffer.concat(output).toString('utf8'));
      else reject(new Error('Qoder CLI 调用失败，请检查登录、网络或执行预算'));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
  });
}

export function extractHtml(output: string): string {
  const start = output.search(/<!doctype html>/i);
  const end = output.toLowerCase().lastIndexOf('</html>');
  if (start < 0 || end < start) throw new Error('Agent 未返回完整 HTML');
  return output.slice(start, end + 7);
}
