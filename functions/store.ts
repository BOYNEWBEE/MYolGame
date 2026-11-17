// 领域模型与存储接口：本地文件存储与云端 Supabase 存储实现同一接口，
// 业务路由（handler.ts）只依赖该接口，保证部署到 Qoder Sites 时行为一致。

import type { CreationTemplate, CreationTemplateFilter, TemplateOrigin } from './shared/creation-template.ts';
import type { Difficulty, GameSpec, GenerationMode, TemplateId, ThemeId } from './shared/spec.ts';

export interface Session {
  token: string;
  nickname: string;
  official: boolean;
  createdAt: string;
}

// 账号级 OpenAI 兼容编曲模型配置；同样只在服务端保存密钥。
export interface MusicStyleSettings {
  ownerToken: string;
  apiUrl: string;
  apiKey: string;
  model: string;
  updatedAt: string;
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
  templateOrigin?: TemplateOrigin;
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
  artifactHash?: string;
  checks?: ArtifactChecks;
  agentName?: string;
  templateOrigin?: TemplateOrigin;
}

export interface ArtifactChecks {
  browser: 'passed';
  canvas: boolean;
  input: boolean;
  restart: boolean;
  screenshotHash: string;
  checkedAt: string;
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
  status: 'queued' | 'running' | 'checking' | 'repairing' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out';
  stages: TaskStage[];
  versionId: string | null;
  error: string | null;
  generationMode: GenerationMode;
  createdAt: string;
  finishedAt: string | null;
  baseVersionId?: string;
  baseUpdatedAt?: string;
  baseSpec?: GameSpec;
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

  getMusicStyleSettings(ownerToken: string): Promise<MusicStyleSettings | null>;
  saveMusicStyleSettings(settings: MusicStyleSettings): Promise<void>;
  deleteMusicStyleSettings(ownerToken: string): Promise<void>;

  createProject(project: Project): Promise<void>;
  createProjectFromTemplate(project: Project, version: Version, message: Message): Promise<void>;
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
  listPendingTasks(): Promise<TaskRecord[]>;

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

  createCreationTemplate(template: CreationTemplate): Promise<void>;
  getCreationTemplate(id: string): Promise<CreationTemplate | null>;
  listCreationTemplates(filter: CreationTemplateFilter): Promise<{ items: CreationTemplate[]; total: number }>;
  setCreationTemplatePublished(id: string, published: boolean): Promise<void>;
}
