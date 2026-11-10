-- 独立测试站点私有模型目录快照，仅用于核对实际上游模型，不向浏览器开放数据库。
CREATE TABLE app.myol_qca_model_catalog (
  id text PRIMARY KEY,
  models jsonb NOT NULL,
  observed_at timestamptz NOT NULL
);
