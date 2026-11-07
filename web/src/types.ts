// 与后端 API 响应形状对应的前端类型。

import type { GameSpec, GenerationMode } from '@shared/spec.ts';

export interface GameSummary {
  id: string;
  title: string;
  description: string;
  spec: GameSpec;
  authorName: string;
  official: boolean;
  allowDownload: boolean;
  plays: number;
  favorites: number;
  generationMode: GenerationMode;
  createdAt: string;
  favorited: boolean;
}

export interface ProjectSummary {
  id: string;
  title: string;
  spec: GameSpec;
  currentVersionId: string;
  visibility: 'private' | 'public';
  gameId: string | null;
  allowDownload: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VersionSummary {
  id: string;
  projectId: string;
  parentId: string | null;
  prompt: string;
  spec: GameSpec;
  note: string;
  generationMode: GenerationMode;
  createdAt: string;
}

export interface MessageItem {
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

export interface TaskItem {
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
