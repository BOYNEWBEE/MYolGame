// 社区初始示例内容：首次启动且社区为空时，由官方账号发布若干模板生成示例游戏。
// 这些示例与用户作品一样走完整的生成与发布流程，并明确标记为模板生成。

export interface SeedItem {
  title: string;
  description: string;
  prompt: string;
  template: 'breakout' | 'snake' | 'space-shooter';
  theme: 'neon' | 'retro' | 'forest' | 'ocean' | 'candy' | 'starfield' | 'ink' | 'sunset';
  speed: number;
  difficulty: 'easy' | 'normal' | 'hard';
  options: Record<string, boolean>;
}

export const OFFICIAL_AUTHOR = 'MYolGame 官方';

export const SEED_ITEMS: SeedItem[] = [
  {
    title: '霓虹打砖块',
    description: '赛博霓虹配色的经典打砖块，困难难度下前两排砖块需要击打两次，球速随关卡提升。',
    prompt: '做一个霓虹风格的打砖块，困难难度',
    template: 'breakout',
    theme: 'neon',
    speed: 1,
    difficulty: 'hard',
    options: {},
  },
  {
    title: '复古像素贪吃蛇',
    description: '街机复古配色的贪吃蛇，支持穿墙模式：撞墙不死，从对面穿出，适合轻松刷分。',
    prompt: '复古像素贪吃蛇，简单上手，可以穿墙',
    template: 'snake',
    theme: 'retro',
    speed: 1,
    difficulty: 'easy',
    options: { wrapWalls: true },
  },
  {
    title: '星空星际射击',
    description: '星空主题的太空射击，散射弹加能量护盾，波次越后敌舰越强，挑战你的反应极限。',
    prompt: '星空太空射击，散射弹加护盾，挑战难度',
    template: 'space-shooter',
    theme: 'starfield',
    speed: 1,
    difficulty: 'hard',
    options: { spreadShot: true, shield: true },
  },
  {
    title: '深海弹球物语',
    description: '深海配色的休闲打砖块，宽挡板加额外生命，节奏舒缓，适合放松游玩。',
    prompt: '深海打砖块，慢一点，简单难度，挡板加宽，多给几条命',
    template: 'breakout',
    theme: 'ocean',
    speed: 0.7,
    difficulty: 'easy',
    options: { widePaddle: true, extraLife: true },
  },
  {
    title: '糖果贪吃蛇',
    description: '糖果配色的贪吃蛇，每吃 5 个普通食物会出现限时金苹果，吃到可得 50 分并短暂加速。',
    prompt: '糖果主题贪吃蛇，带金苹果奖励，普通难度',
    template: 'snake',
    theme: 'candy',
    speed: 1,
    difficulty: 'normal',
    options: { goldenFood: true },
  },
  {
    title: '日落空战',
    description: '日落霞光配色的太空射击，普通难度带敌舰弹幕，护盾每 12 秒充能一次免伤。',
    prompt: '日落配色太空射击，护盾，普通难度',
    template: 'space-shooter',
    theme: 'sunset',
    speed: 1,
    difficulty: 'normal',
    options: { shield: true },
  },
];
