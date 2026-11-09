// API 进程独占 FileStore；Worker 仅收发 IPC，避免多个进程覆盖同一 JSON 数据库。
import { createHash } from 'node:crypto';
import { fork, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentService } from '../../functions/agent.ts';
import { taskActive } from '../../functions/agent.ts';
import type { GameSpec } from '../../functions/shared/spec.ts';
import { sanitizeTitle } from '../../functions/shared/spec.ts';
import { retainAttributions } from '../../functions/shared/creation-template.ts';
import { renderGame } from '../../functions/shared/templates/index.ts';
import type { Project, Store, TaskRecord, Version } from '../../functions/store.ts';
import type { FileStore } from '../store_file.ts';
import type { AgentConfig, WorkerInput, WorkerMessage } from './protocol.ts';

export async function recoverAgentTasks(store: Store): Promise<void> {
  // 即使重启时关闭 Agent，也应结束旧任务，避免工作台永久显示执行中。
  for (const task of await store.listPendingTasks()) {
    task.status = 'failed';
    task.error = '服务重启导致任务中断，请重新提交需求';
    task.finishedAt = new Date().toISOString();
    task.stages.push({ name: task.error, at: task.finishedAt, ok: false });
    await store.updateTask(task);
    await store.addMessage({ id: crypto.randomUUID(), projectId: task.projectId, role: 'system',
      content: task.error + '。原版本保持可用。', taskId: task.id, createdAt: task.finishedAt });
  }
}

export class LocalAgent implements AgentService {
  name: string;
  private store: FileStore;
  private config: AgentConfig;
  private directory: string;
  private queue: string[] = [];
  private locks = new Map<string, Promise<unknown>>();
  private child?: ChildProcess;
  private currentTask?: string;
  private stopped = false;
  private pumping = false;
  private idle: Promise<void> = Promise.resolve();
  private submissions = new Set<Promise<TaskRecord>>();

  constructor(store: FileStore, config: AgentConfig, directory: string) {
    this.store = store;
    this.config = config;
    this.name = config.name;
    this.directory = directory;
  }

  async init(): Promise<void> {
    // 不盲目重放可能已产生副作用的任务；明确标记中断，让用户决定是否重试。
    await recoverAgentTasks(this.store);
  }

  async exclusive<T>(projectId: string, action: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(projectId) || Promise.resolve();
    const pending = previous.catch(() => {}).then(action);
    this.locks.set(projectId, pending);
    try { return await pending; }
    finally { if (this.locks.get(projectId) === pending) this.locks.delete(projectId); }
  }

  async submit(project: Project, prompt: string, spec: GameSpec): Promise<TaskRecord> {
    if (this.stopped || this.queue.length + this.submissions.size >= 20) {
      throw { status: 503, code: 'agent_busy', message: 'Agent 队列已满或正在停止，请稍后重试' };
    }
    const pending = this.enqueue(project, prompt, spec);
    this.submissions.add(pending);
    try { return await pending; }
    finally { this.submissions.delete(pending); }
  }

  private async enqueue(project: Project, prompt: string, spec: GameSpec): Promise<TaskRecord> {
    if ((await this.store.listTasks(project.id)).some(taskActive)) {
      throw { status: 409, code: 'task_active', message: '此项目已有任务执行中，请等待完成或先取消' };
    }
    const task: TaskRecord = {
      id: crypto.randomUUID(), projectId: project.id, prompt, status: 'queued',
      stages: [{ name: '任务已进入队列', at: new Date().toISOString(), ok: true }],
      versionId: null, error: null, generationMode: 'agent', createdAt: new Date().toISOString(), finishedAt: null,
      baseVersionId: project.currentVersionId, baseUpdatedAt: project.updatedAt, baseSpec: spec,
    };
    await this.store.addTask(task);
    await this.store.addMessage({ id: crypto.randomUUID(), projectId: project.id, role: 'user',
      content: prompt, taskId: task.id, createdAt: task.createdAt });
    this.queue.push(task.id);
    setImmediate(() => this.startPump());
    return task;
  }

  private startPump(): void {
    if (this.pumping || this.stopped) return;
    this.pumping = true;
    this.idle = this.pump().catch((error: unknown) => {
      console.error('Agent 调度失败：', error instanceof Error ? error.message : '存储错误');
    }).finally(() => {
      this.pumping = false;
      if (this.queue.length && !this.stopped) this.startPump();
    });
  }

  private async pump(): Promise<void> {
    while (this.queue.length && !this.stopped) {
      const id = this.queue.shift()!;
      const task = await this.store.getTask(id);
      if (!task || !taskActive(task)) continue;
      const project = await this.store.getProject(task.projectId);
      if (!project) continue;
      this.currentTask = id;
      try {
        const base = task.baseVersionId ? await this.store.getVersion(task.baseVersionId) : null;
        const input: WorkerInput = {
          prompt: task.prompt, spec: task.baseSpec || project.spec,
          html: base?.html || renderGame(task.baseSpec || project.spec),
          directory: join(this.directory, task.id), config: this.config, templateOrigin: project.templateOrigin,
        };
        await this.execute(task, input);
      } catch {
        if (taskActive(task)) await this.finish(task, 'failed', 'Worker 启动或执行失败，请检查本地 Agent 配置');
      } finally {
        this.killWorker();
        this.child = undefined;
        this.currentTask = undefined;
      }
    }
  }

  private async execute(task: TaskRecord, input: WorkerInput): Promise<void> {
    // 只继承 CLI 登录、系统运行与网络所需环境；业务令牌和数据库配置不会继承。
    const env: NodeJS.ProcessEnv = {};
    for (const key of ['HOME', 'PATH', 'LANG', 'LC_ALL', 'TMPDIR', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME',
      'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
      'SSL_CERT_FILE', 'NODE_EXTRA_CA_CERTS']) {
      if (process.env[key]) env[key] = process.env[key];
    }
    const child = fork(fileURLToPath(new URL('./worker.ts', import.meta.url)), [], {
      env, detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      execArgv: ['--experimental-strip-types', '--max-old-space-size=256'],
    });
    this.child = child;
    await new Promise<void>((resolve) => {
      let messages: Promise<void> = Promise.resolve();
      const timer = setTimeout(() => {
        messages = messages.then(async () => {
          await this.exclusive(task.projectId, async () => {
            if (taskActive(task)) await this.finish(task, 'timed_out', '任务超过执行时间预算');
          });
          this.killWorker();
        });
      }, this.config.timeoutMs);
      child.on('message', (message: WorkerMessage) => {
        messages = messages.then(() => this.exclusive(task.projectId, async () => {
          if (!taskActive(task)) return;
          if (message.type === 'stage') {
            task.status = message.status;
            task.stages.push({ name: message.name, at: new Date().toISOString(), ok: true });
            await this.store.updateTask(task);
          } else if (message.type === 'error') {
            await this.finish(task, 'failed', message.error);
          } else {
            await this.commit(task, message);
          }
        })).catch(async () => {
          this.killWorker();
        });
      });
      const ended = () => {
        clearTimeout(timer);
        void messages.then(() => this.exclusive(task.projectId, async () => {
          if (taskActive(task)) await this.finish(task, 'failed', 'Worker 异常退出，已保留原版本');
        })).finally(resolve);
      };
      child.once('exit', ended);
      child.once('error', ended);
      child.send(input);
    });
  }

  private async commit(task: TaskRecord, result: Extract<WorkerMessage, { type: 'result' }>): Promise<void> {
    const current = await this.store.getProject(task.projectId);
    if (!current) return;
    if (current.currentVersionId !== task.baseVersionId || current.updatedAt !== task.baseUpdatedAt) {
      await this.finish(task, 'failed', '项目版本在执行期间发生变化，结果未提交；请基于当前版本重新生成');
      return;
    }
    const spec = { ...(task.baseSpec || current.spec) };
    const title = result.html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
    if (title) spec.title = sanitizeTitle(title, spec.title);
    const now = new Date().toISOString();
    const version: Version = {
      id: crypto.randomUUID(), projectId: current.id, parentId: task.baseVersionId || null,
      prompt: task.prompt, spec, html: retainAttributions(result.html, current.templateOrigin),
      note: 'v' + ((await this.store.listVersions(current.id)).length + 1),
      generationMode: 'agent', createdAt: now, artifactHash: createHash('sha256').update(retainAttributions(result.html, current.templateOrigin)).digest('hex'),
      checks: result.checks, agentName: this.name, templateOrigin: current.templateOrigin,
    };
    const updated = { ...current, currentVersionId: version.id, spec, title: spec.title, updatedAt: now };
    const done: TaskRecord = { ...task, status: 'succeeded', versionId: version.id, finishedAt: now,
      stages: [...task.stages, { name: '源码与检查结果已保存为独立版本', at: now, ok: true }] };
    await this.store.commitAgentResult(updated, version, done, {
      id: crypto.randomUUID(), projectId: current.id, role: 'system', taskId: task.id, createdAt: now,
      content: '【Agent 源码开发】' + version.note + ' 已生成。画布、按键与重启烟测通过，请试玩确认需求。',
    });
    Object.assign(task, done);
  }

  private async finish(task: TaskRecord, status: 'failed' | 'cancelled' | 'timed_out', error: string): Promise<void> {
    task.status = status;
    task.error = error;
    task.finishedAt = new Date().toISOString();
    task.stages.push({ name: error, at: task.finishedAt, ok: false });
    await this.store.updateTask(task);
    await this.store.addMessage({ id: crypto.randomUUID(), projectId: task.projectId, role: 'system',
      taskId: task.id, createdAt: task.finishedAt, content: error + '。原版本保持可用。' });
  }

  private killWorker(): void {
    if (this.child?.pid) {
      // 整组终止 Qoder 与 Chrome 后代，取消和超时均不留下后台任务。
      try { process.kill(-this.child.pid, 'SIGKILL'); } catch { /* 进程组已退出 */ }
    }
  }

  async cancel(task: TaskRecord): Promise<void> {
    if (!taskActive(task)) return;
    await this.finish(task, 'cancelled', '任务已取消');
    this.queue = this.queue.filter((id) => id !== task.id);
    if (this.currentTask === task.id) this.killWorker();
  }

  async close(): Promise<void> {
    this.stopped = true;
    await Promise.allSettled([...this.submissions]);
    for (const task of await this.store.listPendingTasks()) {
      await this.exclusive(task.projectId, () => this.cancel(task));
    }
    await this.idle;
  }
}
