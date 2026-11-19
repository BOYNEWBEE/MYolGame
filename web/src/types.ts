// 与后端 API 响应形状对应的前端类型。

import type { TemplateOrigin } from '@shared/creation-template.ts';
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
  templateOrigin?: TemplateOrigin;
  // 从零生成的项目没有模板基底，首次由模型编写完整源码。
  fromScratch?: boolean;
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
  artifactHash?: string;
  checks?: { browser: 'passed'; canvas: boolean; input: boolean; restart: boolean };
  agentName?: string;
  templateOrigin?: TemplateOrigin;
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
  status: 'queued' | 'running' | 'checking' | 'repairing' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out';
  stages: TaskStage[];
  versionId: string | null;
  error: string | null;
  errorCode?: string;
  generationMode: GenerationMode;
  createdAt: string;
  finishedAt: string | null;
}
