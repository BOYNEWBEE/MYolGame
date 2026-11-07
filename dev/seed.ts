// 首次启动种子数据：社区为空时，由官方会话走完整生成/发布流程创建示例游戏。
// 示例与用户作品同样标记 generationMode，界面显示「模板生成」徽标。

import { generateGame } from '../functions/generate.ts';
import { OFFICIAL_AUTHOR, SEED_ITEMS } from '../functions/shared/seed.ts';
import { defaultSpec, sanitizeSpec } from '../functions/shared/spec.ts';
import type { Game, Project, Session, Store, Version } from '../functions/store.ts';

export async function runSeed(store: Store): Promise<number> {
  const existing = await store.listGames({ sort: 'new', limit: 1, offset: 0 });
  if (existing.total > 0) return 0;

  const officialToken = 'official-seed-session';
  const official: Session = {
    token: officialToken,
    nickname: OFFICIAL_AUTHOR,
    official: true,
    createdAt: new Date().toISOString(),
  };
  await store.createSession(official);

  let seeded = 0;
  for (const item of SEED_ITEMS) {
    const baseSpec = sanitizeSpec({
      ...defaultSpec(item.template, item.theme),
      speed: item.speed,
      difficulty: item.difficulty,
      options: item.options,
      title: item.title,
    });
    const result = await generateGame({ prompt: item.prompt, baseSpec, env: {} });
    if (!result.ok) {
      console.error('[seed] 示例生成失败：' + item.title);
      continue;
    }
    const now = new Date().toISOString();
    const project: Project = {
      id: crypto.randomUUID(),
      ownerToken: officialToken,
      title: item.title,
      spec: result.spec,
      currentVersionId: '',
      visibility: 'public',
      gameId: null,
      allowDownload: true,
      createdAt: now,
      updatedAt: now,
    };
    await store.createProject(project);

    const version: Version = {
      id: crypto.randomUUID(),
      projectId: project.id,
      parentId: null,
      prompt: item.prompt,
      spec: result.spec,
      html: result.html,
      note: 'v1',
      generationMode: result.mode,
      createdAt: now,
    };
    await store.createVersion(version);
    project.currentVersionId = version.id;
    await store.updateProject(project);

    const game: Game = {
      id: crypto.randomUUID(),
      projectId: project.id,
      versionId: version.id,
      title: item.title,
      description: item.description,
      spec: result.spec,
      template: result.spec.template,
      theme: result.spec.theme,
      difficulty: result.spec.difficulty,
      authorName: OFFICIAL_AUTHOR,
      official: true,
      allowDownload: true,
      plays: 0,
      favorites: 0,
      generationMode: result.mode,
      createdAt: now,
      updatedAt: now,
    };
    project.gameId = game.id;
    await store.updateProject(project);
    await store.upsertGame(game);
    seeded += 1;
  }
  if (seeded > 0) console.log('[seed] 已创建 ' + seeded + ' 个官方示例游戏');
  return seeded;
}
