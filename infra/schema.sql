-- MYolGame 云端数据库 schema（Qoder Sites 部署阶段通过官方迁移流程审核后执行）
-- 列名使用带引号的 camelCase，与函数代码直接映射（原型阶段简化，避免映射层）。
-- 部署时按 sites-management 技能的迁移工作流创建，不通过 HTTP 处理器执行。

create table if not exists myol_sessions (
  "token" text primary key,
  "nickname" text not null,
  "official" boolean not null default false,
  "createdAt" timestamptz not null default now()
);

create table if not exists myol_projects (
  "id" text primary key,
  "ownerToken" text not null references myol_sessions("token"),
  "title" text not null,
  "spec" jsonb not null,
  "currentVersionId" text not null default '',
  "visibility" text not null default 'private',
  "gameId" text,
  "allowDownload" boolean not null default true,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);
create index if not exists myol_projects_owner_idx on myol_projects ("ownerToken", "updatedAt" desc);

create table if not exists myol_versions (
  "id" text primary key,
  "projectId" text not null references myol_projects("id") on delete cascade,
  "parentId" text,
  "prompt" text not null,
  "spec" jsonb not null,
  "html" text not null,
  "note" text not null default '',
  "generationMode" text not null default 'template',
  "createdAt" timestamptz not null default now()
);
create index if not exists myol_versions_project_idx on myol_versions ("projectId", "createdAt");

create table if not exists myol_messages (
  "id" text primary key,
  "projectId" text not null references myol_projects("id") on delete cascade,
  "role" text not null,
  "content" text not null,
  "taskId" text,
  "createdAt" timestamptz not null default now()
);
create index if not exists myol_messages_project_idx on myol_messages ("projectId", "createdAt");

create table if not exists myol_tasks (
  "id" text primary key,
  "projectId" text not null references myol_projects("id") on delete cascade,
  "prompt" text not null,
  "status" text not null,
  "stages" jsonb not null default '[]',
  "versionId" text,
  "error" text,
  "generationMode" text not null default 'template',
  "createdAt" timestamptz not null default now(),
  "finishedAt" timestamptz
);
create index if not exists myol_tasks_project_idx on myol_tasks ("projectId", "createdAt" desc);

create table if not exists myol_games (
  "id" text primary key,
  "projectId" text not null,
  "versionId" text not null,
  "title" text not null,
  "description" text not null default '',
  "spec" jsonb not null,
  "template" text not null,
  "theme" text not null,
  "difficulty" text not null,
  "authorName" text not null,
  "official" boolean not null default false,
  "allowDownload" boolean not null default true,
  "plays" integer not null default 0,
  "favorites" integer not null default 0,
  "generationMode" text not null default 'template',
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);
create index if not exists myol_games_created_idx on myol_games ("createdAt" desc);
create index if not exists myol_games_template_idx on myol_games ("template");

create table if not exists myol_favorites (
  "token" text not null,
  "gameId" text not null,
  "createdAt" timestamptz not null default now(),
  primary key ("token", "gameId")
);
create index if not exists myol_favorites_game_idx on myol_favorites ("gameId");

-- 访问策略：function_backend 模式下由平台生成固定私有策略（仅函数可访问），
-- 浏览器不直接访问数据库；业务权限在函数代码中按创作者令牌校验。
