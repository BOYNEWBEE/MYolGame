// 业务层只依赖调度接口；本地进程与浏览器能力由 dev/agent 实现。
import type { GameSpec } from './shared/spec.ts';
import type { Project, TaskRecord } from './store.ts';

export interface AgentService {
  name: string;
  submit(project: Project, prompt: string, spec: GameSpec): Promise<TaskRecord>;
  cancel(task: TaskRecord): Promise<void>;
  exclusive<T>(projectId: string, action: () => Promise<T>): Promise<T>;
}

export function taskActive(task: { status: string }): boolean {
  return ['queued', 'running', 'checking', 'repairing'].includes(task.status);
}
