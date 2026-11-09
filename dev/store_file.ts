// 本地开发用文件存储：单个 JSON 文档 + 原子写入，进程重启后数据保留。
// 云端部署使用 store_supabase.ts 实现同一 Store 接口。

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { CreationTemplate, CreationTemplateFilter } from '../functions/shared/creation-template.ts';
import type {
  Game,
  GameFilter,
  Message,
  Project,
  Session,
  Store,
  TaskRecord,
  Version,
} from '../functions/store.ts';

export interface LocalAccount {
  id: string; username: string; nickname: string; passwordHash: string; salt: string; ownerToken: string;
}
export interface AccountSession { hash: string; accountId: string; expiresAt: number }

interface DbShape {
  accounts: LocalAccount[];
  accountSessions: AccountSession[];
  creationTemplates: CreationTemplate[];
  sessions: Session[];
  projects: Project[];
  versions: Version[];
  messages: Message[];
  tasks: TaskRecord[];
  games: Game[];
  favorites: { token: string; gameId: string; createdAt: string }[];
}

function emptyDb(): DbShape {
  return {
    accounts: [],
    accountSessions: [],
    creationTemplates: [],
    sessions: [],
    projects: [],
    versions: [],
    messages: [],
    tasks: [],
    games: [],
    favorites: [],
  };
}

export class FileStore implements Store {
  private db: DbShape = emptyDb();
  private loaded = false;
  private writeQueue: Promise<void> = Promise.resolve();
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async init(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<DbShape>;
      this.db = { ...emptyDb(), ...parsed };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('读取本地数据失败，使用空数据启动：', (error as Error).message);
      }
      this.db = emptyDb();
    }
    this.loaded = true;
    await this.persist();
  }

  private persist(): Promise<void> {
    // 串行化写入，tmp + rename 保证原子性
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const tmp = this.filePath + '.tmp';
      await writeFile(tmp, JSON.stringify(this.db), { encoding: 'utf8', mode: 0o600 });
      await rename(tmp, this.filePath);
    });
    return this.writeQueue;
  }

  findAccount(username: string): LocalAccount | undefined {
    return this.db.accounts.find(a => a.username === username);
  }

  accountForSession(hash: string): LocalAccount | undefined {
    const session = this.db.accountSessions.find(s => s.hash === hash && s.expiresAt > Date.now());
    return session && this.db.accounts.find(a => a.id === session.accountId);
  }

  async saveAccount(account: LocalAccount, session: AccountSession, guestToken?: string): Promise<void> {
    if (!this.db.accounts.some(a => a.id === account.id)) this.db.accounts.push(account);
    this.db.accountSessions = this.db.accountSessions.filter(s => s.expiresAt > Date.now());
    this.db.accountSessions.push(session);
    if (!this.db.sessions.some(s => s.token === account.ownerToken)) {
      this.db.sessions.push({ token: account.ownerToken, nickname: account.nickname, official: false, createdAt: new Date().toISOString() });
    }
    // 仅迁移真实游客的归属，并撤销旧令牌；账号归属标识永远不交给浏览器。
    const guest = this.db.sessions.find(s => s.token === guestToken && !s.official && !s.token.startsWith('account:'));
    if (guest) {
      for (const p of this.db.projects) if (p.ownerToken === guest.token) p.ownerToken = account.ownerToken;
      for (const t of this.db.creationTemplates) if (t.ownerToken === guest.token) t.ownerToken = account.ownerToken;
      for (const f of [...this.db.favorites]) {
        if (f.token === guest.token && !this.db.favorites.some(x => x.token === account.ownerToken && x.gameId === f.gameId)) {
          this.db.favorites.push({ ...f, token: account.ownerToken });
        }
      }
      this.db.favorites = this.db.favorites.filter(f => f.token !== guest.token);
      this.db.sessions = this.db.sessions.filter(s => s.token !== guest.token);
    }
    await this.persist();
  }

  async revokeAccountSession(hash: string): Promise<void> {
    this.db.accountSessions = this.db.accountSessions.filter(s => s.hash !== hash);
    await this.persist();
  }

  async changeAccountPassword(account: LocalAccount, passwordHash: string, salt: string): Promise<void> {
    account.passwordHash = passwordHash;
    account.salt = salt;
    this.db.accountSessions = this.db.accountSessions.filter(s => s.accountId !== account.id);
    await this.persist();
  }

  async createSession(session: Session): Promise<void> {
    this.db.sessions.push(session);
    await this.persist();
  }

  async getSession(token: string): Promise<Session | null> {
    return this.db.sessions.find((s) => s.token === token) ?? null;
  }

  async createProject(project: Project): Promise<void> {
    this.db.projects.push(project);
    await this.persist();
  }

  async createProjectFromTemplate(project: Project, version: Version, message: Message): Promise<void> {
    // 套用时一次持久化私有项目、基础版本和来源消息。
    this.db.projects.push(project);
    this.db.versions.push(version);
    this.db.messages.push(message);
    await this.persist();
  }

  async getProject(id: string): Promise<Project | null> {
    return this.db.projects.find((p) => p.id === id) ?? null;
  }

  async updateProject(project: Project): Promise<void> {
    const index = this.db.projects.findIndex((p) => p.id === project.id);
    if (index >= 0) this.db.projects[index] = project;
    await this.persist();
  }

  async listProjects(ownerToken: string): Promise<Project[]> {
    return this.db.projects
      .filter((p) => p.ownerToken === ownerToken)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async deleteProject(id: string): Promise<void> {
    this.db.projects = this.db.projects.filter((p) => p.id !== id);
    this.db.versions = this.db.versions.filter((v) => v.projectId !== id);
    this.db.messages = this.db.messages.filter((m) => m.projectId !== id);
    this.db.tasks = this.db.tasks.filter((t) => t.projectId !== id);
    await this.persist();
  }

  async createVersion(version: Version): Promise<void> {
    this.db.versions.push(version);
    await this.persist();
  }

  async getVersion(id: string): Promise<Version | null> {
    return this.db.versions.find((v) => v.id === id) ?? null;
  }

  async listVersions(projectId: string): Promise<Version[]> {
    return this.db.versions
      .filter((v) => v.projectId === projectId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async addMessage(message: Message): Promise<void> {
    this.db.messages.push(message);
    await this.persist();
  }

  async listMessages(projectId: string): Promise<Message[]> {
    return this.db.messages
      .filter((m) => m.projectId === projectId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async addTask(task: TaskRecord): Promise<void> {
    this.db.tasks.push(task);
    await this.persist();
  }

  async updateTask(task: TaskRecord): Promise<void> {
    const index = this.db.tasks.findIndex((t) => t.id === task.id);
    if (index >= 0) this.db.tasks[index] = task;
    await this.persist();
  }

  async getTask(id: string): Promise<TaskRecord | null> {
    return this.db.tasks.find((t) => t.id === id) ?? null;
  }

  async listTasks(projectId: string): Promise<TaskRecord[]> {
    return this.db.tasks
      .filter((t) => t.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listPendingTasks(): Promise<TaskRecord[]> {
    return this.db.tasks.filter((t) => !t.finishedAt && t.generationMode === 'agent');
  }

  async commitAgentResult(project: Project, version: Version, task: TaskRecord, message: Message): Promise<void> {
    // 同一次原子文件替换保存版本、项目指针与任务终态，避免重启后出现半完成提交。
    this.db.versions.push(version);
    this.db.projects = this.db.projects.map((p) => p.id === project.id ? project : p);
    this.db.tasks = this.db.tasks.map((t) => t.id === task.id ? task : t);
    this.db.messages.push(message);
    await this.persist();
  }

  async upsertGame(game: Game): Promise<void> {
    const index = this.db.games.findIndex((g) => g.id === game.id);
    if (index >= 0) this.db.games[index] = game;
    else this.db.games.push(game);
    await this.persist();
  }

  async getGame(id: string): Promise<Game | null> {
    return this.db.games.find((g) => g.id === id) ?? null;
  }

  async getGameByProject(projectId: string): Promise<Game | null> {
    return this.db.games.find((g) => g.projectId === projectId) ?? null;
  }

  async listGames(filter: GameFilter): Promise<{ items: Game[]; total: number }> {
    let items = [...this.db.games];
    if (filter.template) items = items.filter((g) => (g.template ?? g.spec.template) === filter.template);
    if (filter.theme) items = items.filter((g) => (g.theme ?? g.spec.theme) === filter.theme);
    if (filter.difficulty) {
      items = items.filter((g) => (g.difficulty ?? g.spec.difficulty) === filter.difficulty);
    }
    if (filter.q) {
      const q = filter.q.toLowerCase();
      items = items.filter(
        (g) =>
          g.title.toLowerCase().includes(q) ||
          g.description.toLowerCase().includes(q) ||
          g.authorName.toLowerCase().includes(q),
      );
    }
    if (filter.sort === 'hot') {
      items.sort((a, b) => b.plays + b.favorites * 3 - (a.plays + a.favorites * 3));
    } else {
      items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    const total = items.length;
    return { items: items.slice(filter.offset, filter.offset + filter.limit), total };
  }

  async deleteGame(id: string): Promise<void> {
    this.db.games = this.db.games.filter((g) => g.id !== id);
    this.db.favorites = this.db.favorites.filter((f) => f.gameId !== id);
    await this.persist();
  }

  async incrementPlays(gameId: string): Promise<void> {
    const game = this.db.games.find((g) => g.id === gameId);
    if (game) {
      game.plays += 1;
      await this.persist();
    }
  }

  async setFavorite(token: string, gameId: string, favorite: boolean): Promise<void> {
    const exists = this.db.favorites.some((f) => f.token === token && f.gameId === gameId);
    if (favorite && !exists) {
      this.db.favorites.push({ token, gameId, createdAt: new Date().toISOString() });
    } else if (!favorite && exists) {
      this.db.favorites = this.db.favorites.filter((f) => !(f.token === token && f.gameId === gameId));
    } else {
      return;
    }
    await this.persist();
  }

  async isFavorite(token: string, gameId: string): Promise<boolean> {
    return this.db.favorites.some((f) => f.token === token && f.gameId === gameId);
  }

  async listFavoriteGameIds(token: string): Promise<string[]> {
    return this.db.favorites.filter((f) => f.token === token).map((f) => f.gameId);
  }

  async countFavorites(gameId: string): Promise<number> {
    return this.db.favorites.filter((f) => f.gameId === gameId).length;
  }

  async createCreationTemplate(template: CreationTemplate): Promise<void> {
    this.db.creationTemplates.push(template);
    await this.persist();
  }

  async getCreationTemplate(id: string): Promise<CreationTemplate | null> {
    return this.db.creationTemplates.find((t) => t.id === id) ?? null;
  }

  async listCreationTemplates(filter: CreationTemplateFilter): Promise<{ items: CreationTemplate[]; total: number }> {
    let items = this.db.creationTemplates.filter((t) => filter.ownerToken ? t.ownerToken === filter.ownerToken : t.published);
    if (filter.kind) items = items.filter((t) => filter.kind === 'official' ? t.official : !t.official);
    if (filter.q) {
      const q = filter.q.toLowerCase();
      items = items.filter((t) => [t.title, t.description, t.authorName].some((text) => text.toLowerCase().includes(q)));
    }
    items = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    return { items: items.slice(filter.offset, filter.offset + filter.limit), total: items.length };
  }

  async setCreationTemplatePublished(id: string, published: boolean): Promise<void> {
    const template = this.db.creationTemplates.find((t) => t.id === id);
    if (template) template.published = published;
    await this.persist();
  }

}
