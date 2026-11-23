-- 已有 PostgreSQL 部署的社区模板迁移草案；需由部署管理员审阅后执行。
-- 本地 FileStore 自动兼容旧数据，不需要执行 SQL。
ALTER TABLE app.myol_projects ADD COLUMN IF NOT EXISTS template_origin jsonb;
ALTER TABLE app.myol_versions ADD COLUMN IF NOT EXISTS template_origin jsonb;

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
