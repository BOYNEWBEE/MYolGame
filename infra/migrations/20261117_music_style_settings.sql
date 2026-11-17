-- 账号级 OpenAI 兼容编曲模型；仅云函数访问，密钥不返回浏览器。
CREATE TABLE app.myol_music_style_settings (
  owner_token text PRIMARY KEY,
  api_url text NOT NULL,
  api_key text NOT NULL,
  model text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
