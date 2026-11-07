// 中文提示词解析：把自然语言需求确定性地映射为游戏规格（模板模式的核心）。
// 解析规则是关键词匹配，不是 AI；相同输入总是得到相同规格。

import {
  DIFFICULTIES,
  TEMPLATE_IDS,
  TEMPLATE_OPTION_KEYS,
  THEMES,
  defaultSpec,
  defaultTitle,
  getTemplate,
  sanitizeTitle,
  type Difficulty,
  type GameOptions,
  type GameSpec,
  type TemplateId,
  type ThemeId,
} from './spec.ts';

export interface ParseMatched {
  template?: string;
  theme?: string;
  speed?: string;
  difficulty?: string;
  title?: string;
  options: string[];
  ignoredOptions: string[];
}

export interface ParseResult {
  spec: GameSpec;
  notes: string[];
  matched: ParseMatched;
}

const TEMPLATE_KEYWORDS: { id: TemplateId; words: string[] }[] = [
  { id: 'breakout', words: ['打砖块', '弹球', '砖块', '反弹球', 'breakout'] },
  { id: 'snake', words: ['贪吃蛇', '吃豆蛇', '蛇', 'snake'] },
  {
    id: 'space-shooter',
    words: ['太空射击', '飞机', '战机', '射击', '星际', '打飞机', '空战', 'space', 'shooter'],
  },
  { id: 'tetris', words: ['俄罗斯方块', '方块消除', '消行', 'tetris'] },
  { id: '2048', words: ['2048', '数字合并', '合并数字', '数字拼图'] },
];

const OPTION_KEYWORDS: { key: keyof GameOptions; name: string; words: string[] }[] = [
  { key: 'widePaddle', name: '宽挡板', words: ['宽挡板', '大挡板', '挡板加宽', '挡板宽'] },
  { key: 'extraLife', name: '额外生命', words: ['额外生命', '多几条命', '多一条命', '加命', '多条命'] },
  { key: 'wrapWalls', name: '穿墙', words: ['穿墙', '穿壁', '穿墙模式'] },
  { key: 'goldenFood', name: '金苹果', words: ['金苹果', '金色食物', '奖励果', '金色奖励'] },
  { key: 'spreadShot', name: '散射弹', words: ['散射', '三向', '散弹', '双枪', '三连发'] },
  { key: 'shield', name: '能量护盾', words: ['护盾', '防护罩', '护罩'] },
  { key: 'ghostPiece', name: '落点预览', words: ['落点预览', '落点提示', '幽灵方块', '影子方块', '虚影'] },
  { key: 'holdPiece', name: '暂存换块', words: ['暂存换块', '暂存', '换块', '保留方块'] },
  { key: 'undoMove', name: '撤销一步', words: ['撤销一步', '撤销', '悔棋', '回退一步', '后悔一步'] },
  { key: 'fiveGrid', name: '5×5 棋盘', words: ['5x5', '5×5', '5*5', '五乘五', '大棋盘'] },
];

function findTemplate(text: string): TemplateId | undefined {
  for (const entry of TEMPLATE_KEYWORDS) {
    for (const word of entry.words) {
      if (text.includes(word)) return entry.id;
    }
  }
  return undefined;
}

function findTheme(text: string): ThemeId | undefined {
  for (const theme of THEMES) {
    for (const word of theme.keywords) {
      if (text.toLowerCase().includes(word.toLowerCase())) return theme.id;
    }
    if (text.includes(theme.name)) return theme.id;
  }
  return undefined;
}

function findDifficulty(text: string): Difficulty | undefined {
  if (/简单|容易|新手|轻松|休闲/.test(text)) return 'easy';
  if (/地狱|极限/.test(text)) return 'hard';
  if (/困难|挑战|难一点|高难度/.test(text)) return 'hard';
  for (const d of DIFFICULTIES) {
    if (text.includes(d.name)) return d.id;
  }
  if (/标准|普通|正常/.test(text)) return 'normal';
  return undefined;
}

function findSpeed(text: string): { speed: number; label: string } | undefined {
  if (/极速|疯狂|飞快/.test(text)) return { speed: 1.8, label: '极速' };
  if (/慢一点|慢速|悠闲|缓慢/.test(text)) return { speed: 0.7, label: '慢速' };
  if (/快一点|快速|加速|节奏快|稍快/.test(text)) return { speed: 1.4, label: '快速' };
  if (/稍慢|略慢/.test(text)) return { speed: 0.85, label: '稍慢' };
  return undefined;
}

function findTitle(text: string): string | undefined {
  const bracket = text.match(/[《]([^》]{1,24})[》]/);
  if (bracket) return bracket[1].trim();
  const named = text.match(/(?:叫作|叫做|命名为|名字是|标题是)[:：]?\s*([^\s，。,；;]{1,24})/);
  if (named) return named[1].trim();
  return undefined;
}

// 以 base 为底，把提示词中识别到的字段覆盖上去；识别不到的保持原样。
export function parsePrompt(prompt: string, base?: GameSpec): ParseResult {
  const text = typeof prompt === 'string' ? prompt.slice(0, 2000) : '';
  const start = base ?? defaultSpec();
  const notes: string[] = [];
  const matched: ParseMatched = { options: [], ignoredOptions: [] };

  let spec: GameSpec = {
    ...start,
    options: { ...start.options },
  };

  const template = findTemplate(text);
  if (template) {
    if (template !== spec.template) {
      // 换玩法时清掉旧模板的专属选项
      spec.options = {};
    }
    spec.template = template;
    matched.template = getTemplate(template).name;
  }

  const theme = findTheme(text);
  if (theme) {
    spec.theme = theme;
    matched.theme = THEMES.find((t) => t.id === theme)?.name;
  }

  const difficulty = findDifficulty(text);
  if (difficulty) {
    spec.difficulty = difficulty;
    matched.difficulty = DIFFICULTIES.find((d) => d.id === difficulty)?.name;
  }

  const speed = findSpeed(text);
  if (speed) {
    spec.speed = speed.speed;
    matched.speed = speed.label;
  }

  const allowed = TEMPLATE_OPTION_KEYS[spec.template];
  for (const entry of OPTION_KEYWORDS) {
    const hit = entry.words.some((w) => text.includes(w));
    if (!hit) continue;
    if (allowed.includes(entry.key)) {
      spec.options[entry.key] = true;
      matched.options.push(entry.name);
    } else {
      matched.ignoredOptions.push(entry.name);
      notes.push(
        '选项「' + entry.name + '」不适用于「' + getTemplate(spec.template).name + '」，已忽略。',
      );
    }
  }

  const rawTitle = findTitle(text);
  if (rawTitle) {
    spec.title = sanitizeTitle(rawTitle, defaultTitle(spec.template, spec.theme));
    matched.title = spec.title;
  } else if (!base || base.title === defaultTitle(start.template, start.theme) || !base.title) {
    spec.title = defaultTitle(spec.template, spec.theme);
  } else {
    spec.title = start.title;
  }

  if (!template && !theme && !difficulty && !speed && matched.options.length === 0 && !rawTitle) {
    notes.push('未从提示词中识别到可调整的关键词，将保持当前规格。');
  }
  if (!TEMPLATE_IDS.includes(spec.template)) {
    spec.template = 'breakout';
  }

  return { spec, notes, matched };
}
