-- 仅供 Cloud Agents 实验分支的新私有表；本轮不自动执行远端迁移。
CREATE TABLE app.myol_qca_jobs (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  prompt text NOT NULL,
  model text NOT NULL,
  state text NOT NULL,
  revision integer NOT NULL,
  agent_id text NOT NULL,
  agent_version integer NOT NULL,
  environment_id text NOT NULL,
  session_id text NOT NULL,
  execution text NOT NULL,
  accepted_events jsonb NOT NULL,
  output text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX myol_qca_jobs_owner_created_idx ON app.myol_qca_jobs (owner_id, created_at);
