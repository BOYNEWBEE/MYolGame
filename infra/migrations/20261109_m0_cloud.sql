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
