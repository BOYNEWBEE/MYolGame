-- 账号级 AI 配乐网关设置；仅云函数访问，密钥不返回浏览器。
CREATE TABLE app.myol_music_settings (
  owner_token text PRIMARY KEY,
  api_url text NOT NULL,
  api_key text NOT NULL,
  name text,
  updated_at timestamptz NOT NULL DEFAULT now()
);