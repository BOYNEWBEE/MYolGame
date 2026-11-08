-- MYolGame 云端数据库 schema（Qoder Sites 审核迁移）。
-- 仅使用平台迁移支持的 PostgreSQL 子集：app schema、无引号 snake_case 标识符、
-- CREATE TABLE 与单列主键；云端存储层负责 camelCase 字段映射。
-- 应用权限由函数内的创作者令牌校验，浏览器不直接访问数据库。

CREATE TABLE app.myol_sessions (
  token text PRIMARY KEY,
  nickname text NOT NULL,
  official boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.myol_projects (
  id text PRIMARY KEY,
  owner_token text NOT NULL,
  title text NOT NULL,
  spec jsonb NOT NULL,
  current_version_id text NOT NULL,
  visibility text NOT NULL,
  game_id text,
  allow_download boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.myol_versions (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  parent_id text,
  prompt text NOT NULL,
  spec jsonb NOT NULL,
  html text NOT NULL,
  note text NOT NULL,
  generation_mode text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.myol_messages (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  role text NOT NULL,
  content text NOT NULL,
  task_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.myol_tasks (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  prompt text NOT NULL,
  status text NOT NULL,
  stages jsonb NOT NULL,
  version_id text,
  error text,
  generation_mode text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE app.myol_games (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  version_id text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  spec jsonb NOT NULL,
  template text NOT NULL,
  theme text NOT NULL,
  difficulty text NOT NULL,
  author_name text NOT NULL,
  official boolean NOT NULL,
  allow_download boolean NOT NULL,
  plays integer NOT NULL,
  favorites integer NOT NULL,
  generation_mode text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.myol_favorites (
  id text PRIMARY KEY,
  token text NOT NULL,
  game_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
