// 官方示例由受信任的本地初始化创建；公开 API 不接受 official 字段。
import type { Store } from '../functions/store.ts';
import { defaultSpec } from '../functions/shared/spec.ts';
import { renderGame } from '../functions/shared/templates/index.ts';
import { embedGamePolicy } from '../functions/shared/artifact.ts';
import type { CreationTemplate } from '../functions/shared/creation-template.ts';

export async function runTemplateSeed(store: Store): Promise<void> {
  const entries = [
    { id: '930dff10-6e09-4000-8000-000000000001', kind: 'breakout' as const,
      title: '霓虹打砖块 · 节奏挑战', description: '从可玩的打砖块示例开始，搭配不同节奏与配色，创作自己的街机挑战。',
      prompt: '保留打砖块的挡板反弹、清空砖块过关和生命耗尽结束规则。将游戏节奏调整为{{pace}}，画面配色调整为{{palette}}。保留操作说明和重新开始。' },
    { id: '930dff10-6e09-4000-8000-000000000002', kind: 'snake' as const,
      title: '贪吃蛇 · 森林漫游', description: '以经典贪吃蛇为基础，选择移动节奏和画面风格，再补充你自己的创意。',
      prompt: '保留方向键控制、吃食物增长和碰撞结束的贪吃蛇规则。将游戏节奏调整为{{pace}}，画面配色调整为{{palette}}。保留分数、操作说明和重新开始。' },
  ];
  for (const entry of entries) {
    if (await store.getCreationTemplate(entry.id)) continue;
    const spec = defaultSpec(entry.kind, entry.kind === 'snake' ? 'forest' : 'neon');
    const template: CreationTemplate = {
      id: entry.id, ownerToken: crypto.randomUUID(), title: entry.title, description: entry.description,
      prompt: entry.prompt, parameters: [
        { id: 'pace', label: '游戏节奏', type: 'choice', choices: ['轻松', '标准', '挑战'], default: '标准' },
        { id: 'palette', label: '画面配色', type: 'choice', choices: ['霓虹', '森林', '深海'], default: entry.kind === 'snake' ? '森林' : '霓虹' },
      ], license: 'MIT', versionLabel: '1.0', authorName: 'MYolGame 官方示例', official: true, published: true,
      sourceVersionNote: '示例 v1', spec, html: embedGamePolicy(renderGame(spec)), generationMode: 'template',
      verification: 'template-render', attributions: [], createdAt: new Date().toISOString(),
    };
    await store.createCreationTemplate(template);
  }
}
