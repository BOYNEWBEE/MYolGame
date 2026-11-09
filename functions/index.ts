// Qoder Function 后端 SDK 在发布时注入，凭据只由 SDK 读取。
// @ts-expect-error 平台注入模块不在本地源码中
import { createDatabaseClient, createSiteContext, errorResponse } from './_qoder/backend.mjs';
import { createHandler } from './handler.ts';
import { createSupabaseStore } from './store_supabase.ts';
import { createM0Application } from './m0/app.ts';

const db = createDatabaseClient();
const store = createSupabaseStore(db);
const handle = createM0Application({
  db,
  business: (request, principal) => createHandler({
    store: { ...store, getSession: async token => principal?.token === token ? principal : null },
    env: { model: {} },
  })(request),
  origin: () => Deno.env.get('APP_ORIGIN') ?? '',
  workerKey: () => Deno.env.get('APP_M0_WORKER_KEY') ?? '',
});
Deno.serve(async (request: Request) => {
  let context;
  try {
    // 当前 SDK 默认会移除应用 Cookie／Authorization，须显式保留应用凭据。
    context = createSiteContext(request, { forwardApplicationCredentials: true });
    return await handle(context.request);
  } catch (error) { return errorResponse(error, context?.requestId); }
});
