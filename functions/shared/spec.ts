// 游戏规格与主题/模板元数据：服务端生成与前端展示共用，保证两侧一致。

export type TemplateId = 'breakout' | 'snake' | 'space-shooter' | 'tetris' | '2048';
export type ThemeId =
  | 'neon'
  | 'retro'
  | 'forest'
  | 'ocean'
  | 'candy'
  | 'starfield'
  | 'ink'
  | 'sunset';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type GenerationMode = 'template' | 'model' | 'agent';

export const MUSIC_NAMES = {
  'neon-arcade': '霓虹街机',
  'ai-generated': 'AI 配乐（音乐模型）',
  'ai-arranged': 'AI 编曲（实时合成）',
  none: '无配乐',
} as const;
export type MusicPreset = keyof typeof MUSIC_NAMES;

// 每种模板支持的可选玩法开关（由提示词或结构化选择控制）
export interface GameOptions {
  widePaddle?: boolean; // 打砖块：加宽挡板
  extraLife?: boolean; // 打砖块：额外生命
  wrapWalls?: boolean; // 贪吃蛇：穿墙
  goldenFood?: boolean; // 贪吃蛇：金苹果奖励
  spreadShot?: boolean; // 太空射击：散射弹
  shield?: boolean; // 太空射击：能量护盾
  ghostPiece?: boolean; // 俄罗斯方块：落点预览
  holdPiece?: boolean; // 俄罗斯方块：暂存换块
  undoMove?: boolean; // 2048：撤销一步
  fiveGrid?: boolean; // 2048：5×5 棋盘
}

export type SynthWave = 'sine' | 'square' | 'sawtooth' | 'triangle';
export type ChordProgression =
  | 'minor'
  | 'major'
  | 'dorian'
  | 'phrygian'
  | 'lydian'
  | 'mixolydian'
  | 'harmonic-minor'
  | 'suspended';

export type MusicInstrument = 'chip' | 'piano' | 'music-box' | 'strings' | 'flute' | 'organ' | 'guitar';
export type MusicPad = 'none' | 'warm' | 'strings';

// 浏览器内置合成配乐的可调参数；只允许这组受限字段，模型不能注入代码。
export interface MusicStyle {
  bpm: number; // 70 ~ 160
  progression: ChordProgression;
  transpose: number; // -7 ~ 7 半音，用于改变调性
  leadWave: SynthWave;
  bassWave: SynthWave;
  kickWave: SynthWave;
  instrument: MusicInstrument; // 主旋律音色，chip 为原版振荡器音色
  pad: MusicPad; // 和弦铺底，none 表示不铺底
  density: number; // 0.3 ~ 1，旋律音符出现概率
  swing: number; // 0 ~ 0.3，奇数步延迟比例
  octave: number; // -1 ~ 1，旋律八度
  seed: number; // 1 ~ 9999，决定旋律型与低频节奏并保证可复现
}

export const DEFAULT_MUSIC_STYLE: MusicStyle = {
  bpm: 120,
  progression: 'minor',
  transpose: 0,
  leadWave: 'triangle',
  bassWave: 'triangle',
  kickWave: 'sine',
  instrument: 'chip',
  pad: 'none',
  density: 1,
  swing: 0,
  octave: 0,
  seed: 1,
};

const SYNTH_WAVES: SynthWave[] = ['sine', 'square', 'sawtooth', 'triangle'];
const INSTRUMENTS: MusicInstrument[] = ['chip', 'piano', 'music-box', 'strings', 'flute', 'organ', 'guitar'];
const PADS: MusicPad[] = ['none', 'warm', 'strings'];
const PROGRESSIONS: ChordProgression[] = [
  'minor',
  'major',
  'dorian',
  'phrygian',
  'lydian',
  'mixolydian',
  'harmonic-minor',
  'suspended',
];

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clampFloat(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value * 100) / 100));
}

// 模型输出与外部输入一律先钳制；缺省字段回退到当前风格或默认霓虹参数。
export function sanitizeMusicStyle(raw: unknown, fallback: MusicStyle = DEFAULT_MUSIC_STYLE): MusicStyle {
  const base = fallback ?? DEFAULT_MUSIC_STYLE;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...base };
  const value = raw as Record<string, unknown>;
  return {
    bpm: clampInt(value.bpm, 70, 160, base.bpm),
    progression: PROGRESSIONS.includes(value.progression as ChordProgression)
      ? (value.progression as ChordProgression)
      : base.progression,
    transpose: clampInt(value.transpose, -7, 7, base.transpose),
    leadWave: SYNTH_WAVES.includes(value.leadWave as SynthWave) ? (value.leadWave as SynthWave) : base.leadWave,
    bassWave: SYNTH_WAVES.includes(value.bassWave as SynthWave) ? (value.bassWave as SynthWave) : base.bassWave,
    kickWave: SYNTH_WAVES.includes(value.kickWave as SynthWave) ? (value.kickWave as SynthWave) : base.kickWave,
    instrument: INSTRUMENTS.includes(value.instrument as MusicInstrument)
      ? (value.instrument as MusicInstrument)
      : base.instrument,
    pad: PADS.includes(value.pad as MusicPad) ? (value.pad as MusicPad) : base.pad,
    density: clampFloat(value.density, 0.3, 1, base.density),
    swing: clampFloat(value.swing, 0, 0.3, base.swing),
    octave: clampInt(value.octave, -1, 1, base.octave),
    seed: clampInt(value.seed, 1, 9999, base.seed),
  };
}

// 提示词里的乐器/铺底关键词作为模型输出的兜底：模型未指定音色时按关键词切换，
// 客户端试听、试听接口与生成管线共用同一套规则。
const INSTRUMENT_KEYWORDS: [MusicInstrument, RegExp][] = [
  ['piano', /钢琴|piano/i],
  ['music-box', /八音盒|音乐盒|music\s*box/i],
  ['strings', /弦乐|小提琴|大提琴|violin|cello|strings?/i],
  ['flute', /长笛|笛子|flute/i],
  ['organ', /管风琴|风琴|organ/i],
  ['guitar', /吉他|guitar/i],
];
const PAD_KEYWORDS: [MusicPad, RegExp][] = [
  ['strings', /弦乐铺底|铺底弦乐|string\s*pad/i],
  ['warm', /铺底|垫音|氛围|pad|ambient/i],
];

export function applyPromptStyle(style: MusicStyle, prompt: string, musicPrompt?: string): MusicStyle {
  const text = (prompt + ' ' + (musicPrompt ?? '')).trim();
  if (!text) return style;
  let instrument = style.instrument;
  if (instrument === 'chip') {
    const hit = INSTRUMENT_KEYWORDS.find(([, pattern]) => pattern.test(text));
    if (hit) instrument = hit[0];
  }
  let pad = style.pad;
  if (pad === 'none') {
    if (instrument === 'strings') {
      pad = 'strings';
    } else {
      const hit = PAD_KEYWORDS.find(([, pattern]) => pattern.test(text));
      if (hit) pad = hit[0];
    }
  }
  return instrument === style.instrument && pad === style.pad ? style : { ...style, instrument, pad };
}

export interface GameSpec {
  music?: MusicPreset;
  // 用户附加的配乐风格描述，仅用于 AI 配乐提示词。
  musicPrompt?: string;
  // 内置合成配乐的风格参数；未设置时使用默认霓虹参数。
  musicStyle?: MusicStyle;
  template: TemplateId;
  title: string;
  theme: ThemeId;
  speed: number; // 0.5 ~ 2.0 倍速
  difficulty: Difficulty;
  options: GameOptions;
}

export const MAX_MUSIC_PROMPT = 200;

export function getMusicPreset(spec: GameSpec): MusicPreset {
  return spec.music ?? (spec.template === 'breakout' && spec.theme === 'neon' ? 'neon-arcade' : 'none');
}

export interface Palette {
  bg: string;
  bg2: string;
  panel: string;
  text: string;
  muted: string;
  primary: string;
  secondary: string;
  accent: string;
  bricks: string[];
}

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  keywords: string[];
  palette: Palette;
}

export interface TemplateMeta {
  id: TemplateId;
  name: string;
  description: string;
  controls: string;
  options: { key: keyof GameOptions; name: string; description: string }[];
  samplePrompts: string[];
}

export const THEMES: ThemeMeta[] = [
  {
    id: 'starfield',
    name: '星空',
    keywords: ['星空', '宇宙', '银河', '星际'],
    palette: {
      bg: '#050514', bg2: '#12103a', panel: '#101030', text: '#eceaff', muted: '#7d7aa8',
      primary: '#b8a1ff', secondary: '#6ee7ff', accent: '#ffd166',
      bricks: ['#6ee7ff', '#b8a1ff', '#ffd166', '#ff9de2', '#8affc1'],
    },
  },
  {
    id: 'neon',
    name: '霓虹',
    keywords: ['霓虹', 'neon', '赛博', '灯光'],
    palette: {
      bg: '#07071c', bg2: '#1b0736', panel: '#14143a', text: '#eaf6ff', muted: '#7c7fb3',
      primary: '#00f0ff', secondary: '#ff2fd6', accent: '#ffe600',
      bricks: ['#ff2fd6', '#00f0ff', '#ffe600', '#7cff5b', '#ff6b3d'],
    },
  },
  {
    id: 'retro',
    name: '复古像素',
    keywords: ['复古', '像素', 'retro', '街机', '怀旧'],
    palette: {
      bg: '#181423', bg2: '#2b2140', panel: '#2a2139', text: '#f4f4f4', muted: '#9c8aa5',
      primary: '#ffcd75', secondary: '#a7f070', accent: '#ff6b35',
      bricks: ['#ff6b35', '#ffcd75', '#a7f070', '#4be3e3', '#ef476f'],
    },
  },
  {
    id: 'forest',
    name: '森林',
    keywords: ['森林', '绿意', '自然', '丛林'],
    palette: {
      bg: '#0c1a12', bg2: '#16301f', panel: '#14291c', text: '#eafff0', muted: '#7fae8b',
      primary: '#7ee787', secondary: '#d4f76a', accent: '#f2cc60',
      bricks: ['#3e8948', '#7ee787', '#d4f76a', '#f2cc60', '#a3e635'],
    },
  },
  {
    id: 'ocean',
    name: '深海',
    keywords: ['海洋', '深海', '蓝色', '水'],
    palette: {
      bg: '#061423', bg2: '#0b2540', panel: '#0c2238', text: '#e6f7ff', muted: '#6f93ad',
      primary: '#4cc9f0', secondary: '#4361ee', accent: '#f72585',
      bricks: ['#4361ee', '#4cc9f0', '#90e0ef', '#f72585', '#4895ef'],
    },
  },
  {
    id: 'candy',
    name: '糖果',
    keywords: ['糖果', '粉', '甜', '可爱'],
    palette: {
      bg: '#1d1024', bg2: '#33183f', panel: '#2c1a35', text: '#fff0f5', muted: '#b390a0',
      primary: '#ff8fab', secondary: '#ffc2d1', accent: '#a0e7e5',
      bricks: ['#ff8fab', '#ffc2d1', '#a0e7e5', '#b8a1ff', '#ffe5a0'],
    },
  },
  {
    id: 'ink',
    name: '水墨',
    keywords: ['水墨', '国风', '墨', '素雅'],
    palette: {
      bg: '#101014', bg2: '#1f1f26', panel: '#1c1c22', text: '#f2f0ec', muted: '#8f8d89',
      primary: '#e8e6e3', secondary: '#9a9a9a', accent: '#c8442c',
      bricks: ['#c8442c', '#e8e6e3', '#9a9a9a', '#5c5c5c', '#d9b382'],
    },
  },
  {
    id: 'sunset',
    name: '日落',
    keywords: ['日落', '黄昏', '橙', '晚霞'],
    palette: {
      bg: '#1a0f1e', bg2: '#38143a', panel: '#2a1730', text: '#fff3e6', muted: '#b08a99',
      primary: '#ff9e64', secondary: '#ff5e78', accent: '#ffd479',
      bricks: ['#ff5e78', '#ff9e64', '#ffd479', '#c86bfa', '#ff8fab'],
    },
  },
];

export const TEMPLATES: TemplateMeta[] = [
  {
    id: 'breakout',
    name: '打砖块',
    description: '经典弹球打砖块：移动挡板反弹小球，清空砖块进入下一关，越往后球速越快。',
    controls: '← → 或 A D 或鼠标/触屏拖动移动挡板，空格发射小球，R 重新开始',
    options: [
      { key: 'widePaddle', name: '宽挡板', description: '挡板加宽 60%，更容易接球' },
      { key: 'extraLife', name: '额外生命', description: '初始生命 +2' },
    ],
    samplePrompts: [
      '做一个霓虹风格的打砖块，节奏快一点，困难难度，挡板加宽',
      '水墨风打砖块，简单休闲，多给几条命',
    ],
  },
  {
    id: 'snake',
    name: '贪吃蛇',
    description: '方向键控制蛇吃食物变长，撞到自己或障碍即结束，支持穿墙与金苹果玩法。',
    controls: '↑ ↓ ← → 或 W A S D 或滑动/触屏按钮转向，空格暂停，R 重新开始',
    options: [
      { key: 'wrapWalls', name: '穿墙', description: '撞墙不死，从对面穿出' },
      { key: 'goldenFood', name: '金苹果', description: '限时出现的高分金苹果' },
    ],
    samplePrompts: [
      '复古像素贪吃蛇，简单上手，可以穿墙',
      '森林主题贪吃蛇，速度稍慢，带金苹果奖励',
    ],
  },
  {
    id: 'space-shooter',
    name: '太空射击',
    description: '驾驶战机拦截敌舰：躲避与射击，随波次难度提升，可选散射弹与能量护盾。',
    controls: '← → ↑ ↓ 或 W A S D 移动，空格射击（触屏自动射击），R 重新开始',
    options: [
      { key: 'spreadShot', name: '散射弹', description: '一次发射三向子弹' },
      { key: 'shield', name: '能量护盾', description: '周期性获得一次免伤护盾' },
    ],
    samplePrompts: [
      '星空太空射击，散射弹加护盾，挑战难度',
      '深海配色太空射击，简单难度，慢慢来',
    ],
  },
  {
    id: 'tetris',
    name: '俄罗斯方块',
    description: '经典方块消除：旋转下落方块填满整行，消行得分并逐级加速，可选落点预览与暂存换块。',
    controls: '← → 移动，↑ 顺时针旋转，Z 逆时针，↓ 软降，空格直落，C 暂存，P 暂停，R 重新开始',
    options: [
      { key: 'ghostPiece', name: '落点预览', description: '在底部显示当前方块的落点虚影' },
      { key: 'holdPiece', name: '暂存换块', description: '按 C 暂存当前方块，稍后换回' },
    ],
    samplePrompts: [
      '霓虹俄罗斯方块，困难难度，带落点预览和暂存',
      '复古像素俄罗斯方块，简单一点，慢速',
    ],
  },
  {
    id: '2048',
    name: '2048',
    description: '数字合并益智：滑动让相同数字合并，目标是拼出 2048，可选 5×5 大棋盘与撤销一步。',
    controls: '← ↑ ↓ → 或 W A S D 或滑动移动，U 撤销，P 暂停，R 重新开始',
    options: [
      { key: 'undoMove', name: '撤销一步', description: '按 U 回退上一步移动' },
      { key: 'fiveGrid', name: '5×5 棋盘', description: '更大的棋盘，更多腾挪空间' },
    ],
    samplePrompts: [
      '糖果风 2048，普通难度，可以撤销一步',
      '星空 2048，5x5 大棋盘',
    ],
  },
];

export const DIFFICULTIES: { id: Difficulty; name: string }[] = [
  { id: 'easy', name: '简单' },
  { id: 'normal', name: '普通' },
  { id: 'hard', name: '困难' },
];

export const TEMPLATE_IDS: TemplateId[] = TEMPLATES.map((t) => t.id);
export const THEME_IDS: ThemeId[] = THEMES.map((t) => t.id);

// 模板与选项的兼容关系：不兼容的选项在解析时忽略并给出说明
export const TEMPLATE_OPTION_KEYS: Record<TemplateId, (keyof GameOptions)[]> = {
  breakout: ['widePaddle', 'extraLife'],
  snake: ['wrapWalls', 'goldenFood'],
  'space-shooter': ['spreadShot', 'shield'],
  tetris: ['ghostPiece', 'holdPiece'],
  '2048': ['undoMove', 'fiveGrid'],
};

export function getTemplate(id: TemplateId): TemplateMeta {
  const found = TEMPLATES.find((t) => t.id === id);
  if (!found) throw new Error('unknown_template');
  return found;
}

export function getTheme(id: ThemeId): ThemeMeta {
  const found = THEMES.find((t) => t.id === id);
  if (!found) throw new Error('unknown_theme');
  return found;
}

// 标题只允许纯文本：去除尖括号、控制字符并截断，防止注入
export function sanitizeTitle(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw
    .replace(/[<>{}$`\\]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 24);
  return cleaned.length > 0 ? cleaned : fallback;
}

// 配乐提示词只作为文本传给音乐接口：去控制字符、压缩空白并截断。
export function sanitizeMusicPrompt(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_MUSIC_PROMPT);
  return cleaned.length > 0 ? cleaned : undefined;
}

export function defaultTitle(template: TemplateId, theme: ThemeId): string {
  return getTheme(theme).name + getTemplate(template).name;
}

export function defaultSpec(template: TemplateId = 'breakout', theme: ThemeId = 'starfield'): GameSpec {
  return {
    template,
    title: defaultTitle(template, theme),
    theme,
    speed: 1,
    difficulty: 'normal',
    options: {},
  };
}

// 对任意输入（结构化选择、模型返回等）做白名单校验与钳制，绝不信任外部数据
export function sanitizeSpec(input: unknown, fallback?: GameSpec): GameSpec {
  const base = fallback ?? defaultSpec();
  if (typeof input !== 'object' || input === null) return base;
  const raw = input as Record<string, unknown>;
  const music =
    raw.music === 'neon-arcade' ||
    raw.music === 'ai-generated' ||
    raw.music === 'ai-arranged' ||
    raw.music === 'none'
      ? raw.music
      : base.music;
  const musicPrompt = 'musicPrompt' in raw ? sanitizeMusicPrompt(raw.musicPrompt) : base.musicPrompt;
  const styleInput = 'musicStyle' in raw ? raw.musicStyle : base.musicStyle;
  const musicStyle = styleInput === undefined || styleInput === null
    ? base.musicStyle
    : sanitizeMusicStyle(styleInput, base.musicStyle ?? DEFAULT_MUSIC_STYLE);

  const template = TEMPLATE_IDS.includes(raw.template as TemplateId)
    ? (raw.template as TemplateId)
    : base.template;
  const theme = THEME_IDS.includes(raw.theme as ThemeId) ? (raw.theme as ThemeId) : base.theme;
  const difficulty: Difficulty =
    raw.difficulty === 'easy' || raw.difficulty === 'normal' || raw.difficulty === 'hard'
      ? raw.difficulty
      : base.difficulty;
  let speed = typeof raw.speed === 'number' ? raw.speed : base.speed;
  if (!Number.isFinite(speed)) speed = base.speed;
  speed = Math.min(2, Math.max(0.5, Math.round(speed * 100) / 100));

  const options: GameOptions = {};
  const rawOptions =
    typeof raw.options === 'object' && raw.options !== null
      ? (raw.options as Record<string, unknown>)
      : {};
  for (const key of TEMPLATE_OPTION_KEYS[template]) {
    if (typeof rawOptions[key] === 'boolean') options[key] = rawOptions[key] as boolean;
    else if (typeof base.options[key] === 'boolean') options[key] = base.options[key];
  }

  return {
    template,
    ...(music ? { music } : {}),
    ...(musicPrompt ? { musicPrompt } : {}),
    ...(musicStyle ? { musicStyle } : {}),
    title: sanitizeTitle(raw.title, defaultTitle(template, theme)),
    theme,
    speed,
    difficulty,
    options,
  };
}
