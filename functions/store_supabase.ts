// 云端存储实现（仅 Deno / Qoder Sites 部署时使用；本地开发使用 dev/store_file.ts）。
// 依赖平台注入的数据库凭据：读取 QODER_DATABASE Secret 建立 Supabase 客户端。
// 部署时按 sites-building 技能官方数据库适配器核对凭据格式后再上线（见 docs/实施记录.md）。

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';
import type {
  Game,
  GameFilter,
  Message,
  Project,
  Session,
  Store,
  TaskRecord,
  Version,
} from './store.ts';

function readDbConfig(): { url: string; key: string } {
  const raw = Deno.env.get('QODER_DATABASE');
  if (!raw) throw new Error('database_not_configured');
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const url = String(parsed.url ?? parsed.supabaseUrl ?? '');
  const key = String(parsed.key ?? parsed.anonKey ?? parsed.serviceKey ?? '');
  if (!url || !key) throw new Error('database_not_configured');
  return { url, key };
}

export function createSupabaseStore(): Store {
  let client: SupabaseClient | null = null;
  let initPromise: Promise<void> | null = null;

  function db(): SupabaseClient {
    if (!client) {
      const config = readDbConfig();
      client = createClient(config.url, config.key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }
    return client;
  }

  function check<T>(result: { data: T | null; error: { message: string } | null }): T {
    if (result.error) throw new Error('database_error');
    return result.data as T;
  }

  const store: Store = {
    async init() {
      if (!initPromise) {
        initPromise = (async () => {
          db(); // 触发配置校验，失败时抛出 database_not_configured
        })();
      }
      await initPromise;
    },

    async createSession(session) {
      check(await db().from('myol_sessions').insert(session).select('token').single());
    },
    async getSession(token) {
      const rows = check(
        await db().from('myol_sessions').select('*').eq('token', token).limit(1),
      ) as Session[];
      return rows[0] ?? null;
    },

    async createProject(project) {
      check(await db().from('myol_projects').insert(project).select('id').single());
    },
    async getProject(id) {
      const rows = check(
        await db().from('myol_projects').select('*').eq('id', id).limit(1),
      ) as Project[];
      return rows[0] ?? null;
    },
    async updateProject(project) {
      check(
        await db().from('myol_projects').update(project).eq('id', project.id).select('id').single(),
      );
    },
    async listProjects(ownerToken) {
      const rows = check(
        await db()
          .from('myol_projects')
          .select('*')
          .eq('ownerToken', ownerToken)
          .order('updatedAt', { ascending: false })
          .limit(200),
      ) as Project[];
      return rows;
    },
    async deleteProject(id) {
      await db().from('myol_versions').delete().eq('projectId', id);
      await db().from('myol_messages').delete().eq('projectId', id);
      await db().from('myol_tasks').delete().eq('projectId', id);
      check(await db().from('myol_projects').delete().eq('id', id).select('id'));
    },

    async createVersion(version) {
      check(await db().from('myol_versions').insert(version).select('id').single());
    },
    async getVersion(id) {
      const rows = check(
        await db().from('myol_versions').select('*').eq('id', id).limit(1),
      ) as Version[];
      return rows[0] ?? null;
    },
    async listVersions(projectId) {
      const rows = check(
        await db()
          .from('myol_versions')
          .select('*')
          .eq('projectId', projectId)
          .order('createdAt', { ascending: true })
          .limit(500),
      ) as Version[];
      return rows;
    },

    async addMessage(message) {
      check(await db().from('myol_messages').insert(message).select('id').single());
    },
    async listMessages(projectId) {
      const rows = check(
        await db()
          .from('myol_messages')
          .select('*')
          .eq('projectId', projectId)
          .order('createdAt', { ascending: true })
          .limit(500),
      ) as Message[];
      return rows;
    },

    async addTask(task) {
      check(await db().from('myol_tasks').insert(task).select('id').single());
    },
    async updateTask(task) {
      check(await db().from('myol_tasks').update(task).eq('id', task.id).select('id').single());
    },
    async getTask(id) {
      const rows = check(
        await db().from('myol_tasks').select('*').eq('id', id).limit(1),
      ) as TaskRecord[];
      return rows[0] ?? null;
    },
    async listTasks(projectId) {
      const rows = check(
        await db()
          .from('myol_tasks')
          .select('*')
          .eq('projectId', projectId)
          .order('createdAt', { ascending: false })
          .limit(200),
      ) as TaskRecord[];
      return rows;
    },

    async upsertGame(game) {
      check(await db().from('myol_games').upsert(game, { onConflict: 'id' }).select('id').single());
    },
    async getGame(id) {
      const rows = check(
        await db().from('myol_games').select('*').eq('id', id).limit(1),
      ) as Game[];
      return rows[0] ?? null;
    },
    async getGameByProject(projectId) {
      const rows = check(
        await db().from('myol_games').select('*').eq('projectId', projectId).limit(1),
      ) as Game[];
      return rows[0] ?? null;
    },
    async listGames(filter) {
      let query = db().from('myol_games').select('*', { count: 'exact' });
      if (filter.template) query = query.eq('template', filter.template);
      if (filter.theme) query = query.eq('theme', filter.theme);
      if (filter.difficulty) query = query.eq('difficulty', filter.difficulty);
      if (filter.q) {
        const safe = filter.q.replace(/[%_,]/g, ' ').slice(0, 60);
        query = query.or('title.ilike.%' + safe + '%,description.ilike.%' + safe + '%');
      }
      query = query
        .order(filter.sort === 'hot' ? 'plays' : 'created_at', { ascending: false })
        .range(filter.offset, filter.offset + filter.limit - 1);
      const result = await query;
      if (result.error) throw new Error('database_error');
      return { items: (result.data ?? []) as Game[], total: result.count ?? 0 };
    },
    async deleteGame(id) {
      await db().from('myol_favorites').delete().eq('gameId', id);
      check(await db().from('myol_games').delete().eq('id', id).select('id'));
    },
    async incrementPlays(gameId) {
      const game = await store.getGame(gameId);
      if (!game) return;
      await db().from('myol_games').update({ plays: game.plays + 1 }).eq('id', gameId);
    },

    async setFavorite(token, gameId, favorite) {
      if (favorite) {
        await db()
          .from('myol_favorites')
          .upsert({ token, gameId, createdAt: new Date().toISOString() }, {
            onConflict: 'token,gameId',
          });
      } else {
        await db().from('myol_favorites').delete().eq('token', token).eq('gameId', gameId);
      }
      const count = await store.countFavorites(gameId);
      await db().from('myol_games').update({ favorites: count }).eq('id', gameId);
    },
    async isFavorite(token, gameId) {
      const rows = check(
        await db()
          .from('myol_favorites')
          .select('gameId')
          .eq('token', token)
          .eq('gameId', gameId)
          .limit(1),
      ) as { gameId: string }[];
      return rows.length > 0;
    },
    async listFavoriteGameIds(token) {
      const rows = check(
        await db()
          .from('myol_favorites')
          .select('gameId')
          .eq('token', token)
          .order('createdAt', { ascending: false })
          .limit(200),
      ) as { gameId: string }[];
      return rows.map((r) => r.gameId);
    },
    async countFavorites(gameId) {
      const result = await db()
        .from('myol_favorites')
        .select('gameId', { count: 'exact' })
        .eq('gameId', gameId)
        .limit(1);
      if (result.error || typeof result.count !== 'number') throw new Error('database_error');
      return result.count;
    },
  };

  return store;
}
