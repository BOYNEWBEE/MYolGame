// 本地外观偏好：只影响当前浏览器的观感，不进入服务端，也不影响生成出来的游戏产物。
// 存 localStorage（几行文本）；背景图目前支持内置预设 / 远程 URL / 本地上传（dataURL，≤1.5 MB）。

import { useEffect, useState } from 'react';
import { computeNavTone } from './nav-tone.ts';

export interface GlassSettings {
  /** 背景模糊半径 0–40px */
  blur: number;
  /** 饱和度 100–250% */
  saturate: number;
  /** 明暗 0.4–1.8（1 = 不压暗；越小越暗，文字越好读） */
  brightness: number;
  /** 玻璃主体不透明度 0.3–0.95（越大越实，越不透背景） */
  body: number;
  /** 亮边强度 0.05–0.8 */
  edge: number;
}

export interface Prefs {
  /** 顶部导航文字配色：auto=按背景亮度自动；light/dark=固定；custom=用 navTextColor */
  navText: 'auto' | 'light' | 'dark' | 'custom';
  navTextColor: string;
  /** 标题 / 正文 / 次要信息的文字颜色 */
  titleColor: string;
  bodyColor: string;
  mutedColor: string;
  /** 液态玻璃开关；关闭后回到项目初版的纯色界面 */
  glassEnabled: boolean;
  /** 背景图地址；null 表示关闭背景层 */
  backdrop: string | null;
  /** 背景图不透明度 0.05–1 */
  backdropOpacity: number;
  glass: GlassSettings;
}

export const DEFAULT_BACKDROP = '/backdrops/anime-sisters.jpg';

export const DEFAULT_GLASS: GlassSettings = {
  blur: 7,
  saturate: 175,
  brightness: 1,
  body: 0.74,
  edge: 0.34,
};

const STORAGE_KEY = 'myol.prefs.v3';
const LEGACY_KEYS = ['myol.prefs.v2', 'myol.prefs'];

const HARD_DEFAULTS: Prefs = {
  navText: 'auto',
  navTextColor: '#e8eaff',
  titleColor: '#f2f5ff',
  bodyColor: '#dfe3f2',
  mutedColor: '#c3c9dd',
  glassEnabled: true,
  backdrop: DEFAULT_BACKDROP,
  backdropOpacity: 1,
  glass: DEFAULT_GLASS,
};

const DEFAULTS: Prefs = HARD_DEFAULTS;


function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function normalizeGlass(raw: unknown, fallback: GlassSettings): GlassSettings {
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    blur: clamp(Number(input.blur), 0, 40, fallback.blur),
    saturate: clamp(Number(input.saturate), 100, 250, fallback.saturate),
    brightness: clamp(Number(input.brightness), 0.4, 1.8, fallback.brightness),
    body: clamp(Number(input.body), 0.3, 0.95, fallback.body),
    edge: clamp(Number(input.edge), 0.05, 0.8, fallback.edge),
  };
}

function normalize(raw: unknown, fallback: Prefs = DEFAULTS): Prefs {
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const backdrop =
    typeof input.backdrop === 'string' && input.backdrop.trim()
      ? input.backdrop
      : input.backdrop === null
        ? null
        : fallback.backdrop;
  const navTextInput = input.navText;
  const navText = navTextInput === 'light' || navTextInput === 'dark' || navTextInput === 'custom' ? navTextInput : 'auto';
  const navTextColor = typeof input.navTextColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(input.navTextColor)
    ? input.navTextColor
    : DEFAULTS.navTextColor;
  const hex = (value: unknown, fallback: string): string =>
    typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
  return {
    navText,
    navTextColor,
    titleColor: hex(input.titleColor, DEFAULTS.titleColor),
    bodyColor: hex(input.bodyColor, DEFAULTS.bodyColor),
    mutedColor: hex(input.mutedColor, DEFAULTS.mutedColor),
    glassEnabled: input.glassEnabled === false ? false : true,
    backdrop,
    backdropOpacity: clamp(Number(input.backdropOpacity), 0.05, 1, fallback.backdropOpacity),
    glass: normalizeGlass(input.glass, fallback.glass ?? DEFAULT_GLASS),
  };
}

function readLegacy(): Prefs | null {
  for (const key of LEGACY_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return normalize(JSON.parse(raw));
    } catch {
      // 忽略损坏数据，继续尝试下一个
    }
  }
  return null;
}

let current: Prefs = loadPrefs();
const listeners = new Set<(prefs: Prefs) => void>();

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch {
    // 落到下面的迁移逻辑
  }
  return readLegacy() ?? { ...DEFAULTS };
}

export function getPrefs(): Prefs {
  return current;
}

/** 把偏好写进 CSS 变量；styles.css 的玻璃与动效都读这些变量。 */
export function applyPrefs(prefs: Prefs): void {
  const root = document.documentElement;
  const glass = prefs.glass;
  root.style.setProperty('--backdrop-opacity', String(prefs.backdropOpacity));
  root.classList.toggle('no-glass', !prefs.glassEnabled);

  // 顶部导航文字：auto 时按背景亮度算，其余直接写死
  if (prefs.navText === 'auto') {
    void computeNavTone(prefs.backdrop, prefs.glass.body).then((tone) => {
      root.style.setProperty('--nav-fg', tone === 'dark' ? '#14161f' : '#e8eaff');
    });
  } else if (prefs.navText === 'light') {
    root.style.setProperty('--nav-fg', '#e8eaff');
  } else if (prefs.navText === 'dark') {
    root.style.setProperty('--nav-fg', '#14161f');
  } else {
    root.style.setProperty('--nav-fg', prefs.navTextColor);
  }

  // 标题 / 正文 / 次要信息：直接用设置里的颜色
  root.style.setProperty('--title-fg', prefs.titleColor);
  root.style.setProperty('--body-fg', prefs.bodyColor);
  root.style.setProperty('--muted', prefs.mutedColor);
  root.style.setProperty('--glass-blur', glass.blur + 'px');
  root.style.setProperty('--glass-saturate', glass.saturate + '%');
  root.style.setProperty('--glass-brightness', String(glass.brightness));
  root.style.setProperty('--glass-body', String(glass.body));
  root.style.setProperty('--glass-body-strong', String(Math.min(0.97, glass.body + 0.14)));
  root.style.setProperty('--glass-sheen', String(Math.min(0.5, glass.edge * 0.47)));
  root.style.setProperty('--glass-edge-alpha', String(glass.edge));
  // 目标值：路由切换时用动画从 0/透明 过渡到这些值
  root.style.setProperty('--glass-blur-target', glass.blur + 'px');
  root.style.setProperty('--glass-body-target', String(glass.body));
  root.style.setProperty('--glass-sheen-target', String(Math.min(0.5, glass.edge * 0.47)));
}

export function setPrefs(patch: Partial<Prefs>): Prefs {
  current = normalize({ ...current, ...patch }, current);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // 隐私模式或配额满：偏好只在本页有效，不阻断使用
  }
  applyPrefs(current);
  for (const listener of listeners) listener(current);
  return current;
}

/** 只改玻璃参数，避免调用方每次拼整个 glass 对象。 */
export function setGlass(patch: Partial<GlassSettings>): Prefs {
  return setPrefs({ glass: { ...current.glass, ...patch } });
}

export function resetPrefs(): Prefs {
  current = { ...DEFAULTS, glass: { ...DEFAULT_GLASS } };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // 同上
  }
  applyPrefs(current);
  for (const listener of listeners) listener(current);
  return current;
}

export function subscribePrefs(listener: (prefs: Prefs) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 组件里读偏好并跟随变更（跨组件同步走同一个订阅）。 */
export function usePrefs(): Prefs {
  const [prefs, setLocal] = useState<Prefs>(current);
  useEffect(() => {
    setLocal(current);
    return subscribePrefs(setLocal);
  }, []);
  return prefs;
}
