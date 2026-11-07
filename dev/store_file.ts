// 本地开发用文件存储：单个 JSON 文档 + 原子写入，进程重启后数据保留。
// 云端部署使用 store_supabase.ts 实现同一 Store 接口。

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
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

interface DbShape {
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
      await writeFile(tmp, JSON.stringify(this.db), 'utf8');
      await rename(tmp, this.filePath);
    });
    return this.writeQueue;
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
}
