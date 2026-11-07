// 领域模型与存储接口：本地文件存储与云端 Supabase 存储实现同一接口，
// 业务路由（handler.ts）只依赖该接口，保证部署到 Qoder Sites 时行为一致。

import type { Difficulty, GameSpec, GenerationMode, TemplateId, ThemeId } from './shared/spec.ts';

export interface Session {
  token: string;
  nickname: string;
  official: boolean;
  createdAt: string;
}

export interface Project {
  id: string;
  ownerToken: string;
  title: string;
  spec: GameSpec;
  currentVersionId: string;
  visibility: 'private' | 'public';
  gameId: string | null;
  allowDownload: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Version {
  id: string;
  projectId: string;
  parentId: string | null;
  prompt: string;
  spec: GameSpec;
  html: string;
  note: string;
  generationMode: GenerationMode;
  createdAt: string;
}

export interface Message {
  id: string;
  projectId: string;
  role: 'user' | 'system';
  content: string;
  taskId: string | null;
  createdAt: string;
}

export interface TaskStage {
  name: string;
  at: string;
  ok: boolean;
  detail?: string;
}

export interface TaskRecord {
  id: string;
  projectId: string;
  prompt: string;
  status: 'succeeded' | 'failed';
  stages: TaskStage[];
  versionId: string | null;
  error: string | null;
  generationMode: GenerationMode;
  createdAt: string;
  finishedAt: string | null;
}

export interface Game {
  id: string;
  projectId: string;
  versionId: string;
  title: string;
  description: string;
  spec: GameSpec;
  // 反范式过滤列：云端数据库按列过滤，避免解析 JSON
  template: TemplateId;
  theme: ThemeId;
  difficulty: Difficulty;
  authorName: string;
  official: boolean;
  allowDownload: boolean;
  plays: number;
  favorites: number;
  generationMode: GenerationMode;
  createdAt: string;
  updatedAt: string;
}

export interface GameFilter {
  template?: TemplateId;
  theme?: ThemeId;
  difficulty?: Difficulty;
  q?: string;
  sort?: 'new' | 'hot';
  limit: number;
  offset: number;
}

export interface Store {
  init(): Promise<void>;

  createSession(session: Session): Promise<void>;
  getSession(token: string): Promise<Session | null>;

  createProject(project: Project): Promise<void>;
  getProject(id: string): Promise<Project | null>;
  updateProject(project: Project): Promise<void>;
  listProjects(ownerToken: string): Promise<Project[]>;
  deleteProject(id: string): Promise<void>;

  createVersion(version: Version): Promise<void>;
  getVersion(id: string): Promise<Version | null>;
  listVersions(projectId: string): Promise<Version[]>;

  addMessage(message: Message): Promise<void>;
  listMessages(projectId: string): Promise<Message[]>;

  addTask(task: TaskRecord): Promise<void>;
  updateTask(task: TaskRecord): Promise<void>;
  getTask(id: string): Promise<TaskRecord | null>;
  listTasks(projectId: string): Promise<TaskRecord[]>;

  upsertGame(game: Game): Promise<void>;
  getGame(id: string): Promise<Game | null>;
  getGameByProject(projectId: string): Promise<Game | null>;
  listGames(filter: GameFilter): Promise<{ items: Game[]; total: number }>;
  deleteGame(id: string): Promise<void>;
  incrementPlays(gameId: string): Promise<void>;

  setFavorite(token: string, gameId: string, favorite: boolean): Promise<void>;
  isFavorite(token: string, gameId: string): Promise<boolean>;
  listFavoriteGameIds(token: string): Promise<string[]>;
  countFavorites(gameId: string): Promise<number>;
}
