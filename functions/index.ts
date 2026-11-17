// Qoder Function 后端 SDK 在发布时注入，凭据只由 SDK 读取。
// @ts-expect-error 平台注入模块不在本地源码中
import { createDatabaseClient, createSiteContext, errorResponse } from './_qoder/backend.mjs';
import { createHandler } from './handler.ts';
import { createSupabaseStore } from './store_supabase.ts';
import { createM0Application } from './m0/app.ts';
import { createQcaExperiment } from './qca/experiment.ts';
import { QCA_DEFAULT_ENABLED, QCA_DEFAULT_MODEL } from './qca/config.ts';
import { liveClient } from './qca/client.ts';
import { PUBLIC_ORIGIN } from './site-config.ts';

const db = createDatabaseClient();
const store = createSupabaseStore(db);
const handle = createM0Application({
  db,
  experiment: (Deno.env.get('APP_QCA_EXPERIMENT_ENABLED') ?? String(QCA_DEFAULT_ENABLED)) === 'true' ? createQcaExperiment({
    db, cloud: liveClient(() => Deno.env.get('QODER_PAT')),
    model: () => Deno.env.get('APP_QCA_MODEL') ?? QCA_DEFAULT_MODEL,
    ready: () => Boolean(Deno.env.get('QODER_PAT')),
  }) : undefined,
  business: (request, principal) => createHandler({
    store: { ...store, getSession: async token => principal?.token === token ? principal : null },
    env: {
        model: {},
        music: {
          apiUrl: Deno.env.get('APP_MUSIC_API_URL') || undefined,
          apiKey: Deno.env.get('APP_MUSIC_API_KEY') || undefined,
          name: Deno.env.get('APP_MUSIC_NAME') || undefined,
        },
        musicStyle: {
          apiUrl: Deno.env.get('APP_MUSIC_STYLE_API_URL') || undefined,
          apiKey: Deno.env.get('APP_MUSIC_STYLE_API_KEY') || undefined,
          model: Deno.env.get('APP_MUSIC_STYLE_MODEL') || undefined,
        },
      },
  })(request),
  origin: () => Deno.env.get('APP_ORIGIN') ?? PUBLIC_ORIGIN,
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
