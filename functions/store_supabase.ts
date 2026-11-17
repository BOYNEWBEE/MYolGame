// 云端存储实现（Deno / Qoder Sites 边缘函数）。
// 数据库客户端由平台注入的 _qoder 模块创建，凭据由平台在运行时读取，
// 本文件不读取、不记录、不向前端暴露任何数据库连接信息。
// 表位于平台的 app schema，列名为 snake_case，这里统一映射到领域模型的 camelCase。

import type { CreationTemplate } from './shared/creation-template.ts';

import type {
  Game,
  GameFilter,
  Message,
  MusicSettings,
  Project,
  Session,
  Store,
  TaskRecord,
  Version,
} from './store.ts';

// 平台注入的 Supabase 兼容客户端；这里只声明本文件用到的最小形状。
export interface DatabaseClient {
  // 链式查询对象由平台 SDK 提供，逐表查询在运行时校验。
  from(table: string): any;
}

type Row = Record<string, unknown>;

function toSnake(key: string): string {
  return key.replace(/[A-Z]/g, (char) => '_' + char.toLowerCase());
}

function toCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
}

function toRow(record: object): Row {
  const row: Row = {};
  for (const [key, value] of Object.entries(record)) row[toSnake(key)] = value;
  return row;
}

function fromRow<T>(row: Row): T {
  const record: Row = {};
  for (const [key, value] of Object.entries(row)) record[toCamel(key)] = value;
  return record as T;
}

function fromRows<T>(rows: Row[]): T[] {
  return rows.map((row) => fromRow<T>(row));
}

export function createSupabaseStore(client: DatabaseClient): Store {
  function check<T>(result: { data: T | null; error: { code?: string; message?: string } | null }): T {
    if (result.error) throw new Error('database_error:' + (result.error.code ?? 'unknown'));
    return result.data as T;
  }

  const store: Store = {
    async init() {
      // 平台 SDK 在每次请求时读取数据库凭据，无需本地初始化。
    },

    async createSession(session) {
      check(await client.from('myol_sessions').insert(toRow(session)).select('token').single());
    },
    async getSession(token) {
      const rows = check(
        await client.from('myol_sessions').select('*').eq('token', token).limit(1),
      ) as Row[];
      return rows[0] ? fromRow<Session>(rows[0]) : null;
    },

    async getMusicSettings(ownerToken) {
      const rows = check(
        await client.from('myol_music_settings').select('*').eq('owner_token', ownerToken).limit(1),
      ) as Row[];
      return rows[0] ? fromRow<MusicSettings>(rows[0]) : null;
    },
    async saveMusicSettings(settings) {
      check(
        await client
          .from('myol_music_settings')
          .upsert(toRow(settings), { onConflict: 'owner_token' })
          .select('owner_token')
          .single(),
      );
    },
    async deleteMusicSettings(ownerToken) {
      check(await client.from('myol_music_settings').delete().eq('owner_token', ownerToken).select('owner_token'));
    },

    async createProject(project) {
      check(await client.from('myol_projects').insert(toRow(project)).select('id').single());
    },
    async createProjectFromTemplate(project, version, message) {
      await store.createProject(project);
      try {
        await store.createVersion(version);
        await store.addMessage(message);
      } catch (error) {
        await store.deleteProject(project.id);
        throw error;
      }
    },
    async getProject(id) {
      const rows = check(
        await client.from('myol_projects').select('*').eq('id', id).limit(1),
      ) as Row[];
      return rows[0] ? fromRow<Project>(rows[0]) : null;
    },
    async updateProject(project) {
      check(
        await client
          .from('myol_projects')
          .update(toRow(project))
          .eq('id', project.id)
          .select('id')
          .single(),
      );
    },
    async listProjects(ownerToken) {
      const rows = check(
        await client
          .from('myol_projects')
          .select('*')
          .eq('owner_token', ownerToken)
          .order('updated_at', { ascending: false })
          .limit(200),
      ) as Row[];
      return fromRows<Project>(rows);
    },
    async deleteProject(id) {
      await client.from('myol_versions').delete().eq('project_id', id);
      await client.from('myol_messages').delete().eq('project_id', id);
      await client.from('myol_tasks').delete().eq('project_id', id);
      check(await client.from('myol_projects').delete().eq('id', id).select('id'));
    },

    async createVersion(version) {
      check(await client.from('myol_versions').insert(toRow(version)).select('id').single());
    },
    async getVersion(id) {
      const rows = check(
        await client.from('myol_versions').select('*').eq('id', id).limit(1),
      ) as Row[];
      return rows[0] ? fromRow<Version>(rows[0]) : null;
    },
    async listVersions(projectId) {
      const rows = check(
        await client
          .from('myol_versions')
          .select('*')
          .eq('project_id', projectId)
          .order('created_at', { ascending: true })
          .limit(500),
      ) as Row[];
      return fromRows<Version>(rows);
    },

    async addMessage(message) {
      check(await client.from('myol_messages').insert(toRow(message)).select('id').single());
    },
    async listMessages(projectId) {
      const rows = check(
        await client
          .from('myol_messages')
          .select('*')
          .eq('project_id', projectId)
          .order('created_at', { ascending: true })
          .limit(500),
      ) as Row[];
      return fromRows<Message>(rows);
    },

    async addTask(task) {
      check(await client.from('myol_tasks').insert(toRow(task)).select('id').single());
    },
    async updateTask(task) {
      check(
        await client
          .from('myol_tasks')
          .update(toRow(task))
          .eq('id', task.id)
          .select('id')
          .single(),
      );
    },
    async getTask(id) {
      const rows = check(
        await client.from('myol_tasks').select('*').eq('id', id).limit(1),
      ) as Row[];
      return rows[0] ? fromRow<TaskRecord>(rows[0]) : null;
    },
    async listTasks(projectId) {
      const rows = check(
        await client
          .from('myol_tasks')
          .select('*')
          .eq('project_id', projectId)
          .order('created_at', { ascending: false })
          .limit(200),
      ) as Row[];
      return fromRows<TaskRecord>(rows);
    },

    async listPendingTasks() {
      const rows = check(await client.from('myol_tasks').select('*')
        .eq('generation_mode', 'agent').is('finished_at', null)) as Row[];
      return fromRows<TaskRecord>(rows);
    },

    async createCreationTemplate(template) {
      check(await client.from('myol_creation_templates').insert(toRow(template)).select('id').single());
    },
    async getCreationTemplate(id) {
      const rows = check(await client.from('myol_creation_templates').select('*').eq('id', id).limit(1)) as Row[];
      return rows[0] ? fromRow<CreationTemplate>(rows[0]) : null;
    },
    async listCreationTemplates(filter) {
      let query = client.from('myol_creation_templates').select('*', { count: 'exact' });
      query = filter.ownerToken ? query.eq('owner_token', filter.ownerToken) : query.eq('published', true);
      if (filter.kind) query = query.eq('official', filter.kind === 'official');
      if (filter.q) {
        const safe = filter.q.replace(/[^\p{L}\p{N} -]/gu, ' ').slice(0, 60);
        query = query.or('title.ilike.%' + safe + '%,description.ilike.%' + safe + '%,author_name.ilike.%' + safe + '%');
      }
      const result = await query.order('created_at', { ascending: false }).order('id', { ascending: true })
        .range(filter.offset, filter.offset + filter.limit - 1);
      if (result.error) throw new Error('database_error:' + (result.error.code ?? 'unknown'));
      return { items: fromRows<CreationTemplate>((result.data ?? []) as Row[]), total: result.count ?? 0 };
    },
    async setCreationTemplatePublished(id, published) {
      check(await client.from('myol_creation_templates').update({ published }).eq('id', id).select('id').single());
    },

    async upsertGame(game) {
      check(
        await client
          .from('myol_games')
          .upsert(toRow(game), { onConflict: 'id' })
          .select('id')
          .single(),
      );
    },
    async getGame(id) {
      const rows = check(
        await client.from('myol_games').select('*').eq('id', id).limit(1),
      ) as Row[];
      return rows[0] ? fromRow<Game>(rows[0]) : null;
    },
    async getGameByProject(projectId) {
      const rows = check(
        await client.from('myol_games').select('*').eq('project_id', projectId).limit(1),
      ) as Row[];
      return rows[0] ? fromRow<Game>(rows[0]) : null;
    },
    async listGames(filter) {
      let query = client.from('myol_games').select('*', { count: 'exact' });
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
      if (result.error) throw new Error('database_error:' + (result.error.code ?? 'unknown'));
      return {
        items: fromRows<Game>((result.data ?? []) as Row[]),
        total: result.count ?? 0,
      };
    },
    async deleteGame(id) {
      await client.from('myol_favorites').delete().eq('game_id', id);
      check(await client.from('myol_games').delete().eq('id', id).select('id'));
    },
    async incrementPlays(gameId) {
      const game = await store.getGame(gameId);
      if (!game) return;
      await client.from('myol_games').update({ plays: game.plays + 1 }).eq('id', gameId);
    },

    async setFavorite(token, gameId, favorite) {
      if (favorite) {
        await client.from('myol_favorites').upsert(
          {
            id: token + ':' + gameId,
            token,
            game_id: gameId,
            created_at: new Date().toISOString(),
          },
          { onConflict: 'id' },
        );
      } else {
        await client.from('myol_favorites').delete().eq('token', token).eq('game_id', gameId);
      }
      const count = await store.countFavorites(gameId);
      await client.from('myol_games').update({ favorites: count }).eq('id', gameId);
    },
    async isFavorite(token, gameId) {
      const rows = check(
        await client
          .from('myol_favorites')
          .select('id')
          .eq('token', token)
          .eq('game_id', gameId)
          .limit(1),
      ) as Row[];
      return rows.length > 0;
    },
    async listFavoriteGameIds(token) {
      const rows = check(
        await client
          .from('myol_favorites')
          .select('game_id')
          .eq('token', token)
          .order('created_at', { ascending: false })
          .limit(200),
      ) as Row[];
      return rows.map((row) => String(row.game_id));
    },
    async countFavorites(gameId) {
      const result = await client
        .from('myol_favorites')
        .select('id', { count: 'exact' })
        .eq('game_id', gameId)
        .limit(1);
      if (result.error || typeof result.count !== 'number') {
        throw new Error('database_error:count_unavailable');
      }
      return result.count;
    },
  };

  return store;
}
