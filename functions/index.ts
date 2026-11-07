// Qoder Sites Edge Function 入口（Deno 运行时）。
// 本地开发不使用本文件（使用 dev/local-server.ts），部署时由平台打包 functions/ 目录。

import { createHandler } from './handler.ts';
import { createSupabaseStore } from './store_supabase.ts';

const store = createSupabaseStore();

const handler = createHandler({
  store,
  env: {
    model: {
      // 应用 Secret：在站点设置中配置后生效；未配置时平台运行于模板模式
      apiUrl: Deno.env.get('MYOLGAME_MODEL_API_URL') || undefined,
      apiKey: Deno.env.get('MYOLGAME_MODEL_API_KEY') || undefined,
      name: Deno.env.get('MYOLGAME_MODEL_NAME') || undefined,
    },
  },
});

Deno.serve(async (req: Request) => {
  await store.init();
  return handler(req);
});
