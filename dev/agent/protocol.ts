// 只通过 IPC 传递当前任务和游戏源码，不向 Worker 提供业务数据库或用户令牌。
import type { TemplateOrigin } from '../../functions/shared/creation-template.ts';
import type { ArtifactChecks } from '../../functions/store.ts';
import type { GameSpec } from '../../functions/shared/spec.ts';

export interface AgentConfig {
  provider: 'qoder' | 'http' | 'openai';
  command?: string;
  apiUrl?: string;
  apiKey?: string;
  // 仅 openai provider 使用：模型名、单次请求超时与输出长度上限。
  model?: string;
  requestTimeoutMs?: number;
  maxOutputTokens?: number;
  maxResponseBytes?: number;
  name: string;
  timeoutMs: number;
  maxAttempts: number;
  chromePath: string;
}

export interface WorkerInput {
  prompt: string;
  spec: GameSpec;
  html: string;
  directory: string;
  templateOrigin?: TemplateOrigin;
  config: AgentConfig;
}

export type WorkerMessage =
  | { type: 'stage'; status: 'running' | 'checking' | 'repairing'; name: string }
  | { type: 'result'; html: string; artifactHash: string; checks: ArtifactChecks }
  | { type: 'error'; error: string; code?: string };
