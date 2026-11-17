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

-- 账号级 OpenAI 兼容编曲模型；密钥仅服务端读取，接口不回传浏览器。
CREATE TABLE app.myol_music_style_settings (
  owner_token text PRIMARY KEY,
  api_url text NOT NULL,
  api_key text NOT NULL,
  model text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.myol_projects (
  id text PRIMARY KEY,
  owner_token text NOT NULL,
  title text NOT NULL,
  spec jsonb NOT NULL,
  current_version_id text NOT NULL,
  template_origin jsonb,
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
  artifact_hash text,
  checks jsonb,
  agent_name text,
  template_origin jsonb,
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
  finished_at timestamptz,
  base_version_id text,
  base_updated_at timestamptz,
  base_spec jsonb
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


-- 社区创作模板保存独立源码快照，不引用可变的项目当前版本。
CREATE TABLE app.myol_creation_templates (
  id text PRIMARY KEY,
  owner_token text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  prompt text NOT NULL,
  parameters jsonb NOT NULL,
  license text NOT NULL,
  version_label text NOT NULL,
  author_name text NOT NULL,
  official boolean NOT NULL,
  published boolean NOT NULL,
  source_version_note text NOT NULL,
  spec jsonb NOT NULL,
  html text NOT NULL,
  generation_mode text NOT NULL,
  verification text NOT NULL,
  attributions jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 新建云端 M0 表；通过 Qoder function_backend 迁移，禁止浏览器直接访问。
CREATE TABLE app.myol_m0_users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  nickname text NOT NULL,
  password_hash text NOT NULL,
  salt text NOT NULL,
  credential_version integer NOT NULL
);
CREATE TABLE app.myol_m0_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  credential_version integer NOT NULL,
  expires_at bigint NOT NULL,
  revoked boolean NOT NULL
);
CREATE TABLE app.myol_m0_limits (
  id text PRIMARY KEY,
  count integer NOT NULL,
  started_at bigint NOT NULL
);
CREATE TABLE app.myol_m0_tasks (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  prompt text NOT NULL,
  status text NOT NULL,
  revision integer NOT NULL,
  created_at timestamptz NOT NULL,
  next_at bigint NOT NULL,
  events jsonb NOT NULL,
  simulated boolean NOT NULL
);
CREATE INDEX myol_m0_tasks_owner_created_idx ON app.myol_m0_tasks (owner_id, created_at);
CREATE INDEX myol_m0_tasks_status_next_idx ON app.myol_m0_tasks (status, next_at);
