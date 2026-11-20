// 本地外观偏好：只影响当前浏览器的观感，不进入服务端，也不影响生成出来的游戏产物。
// 存 localStorage（几行文本），图片/视频将来走 IndexedDB，不塞这里。

import { useEffect, useState } from 'react';

export interface Prefs {
  /** 背景图地址；null 表示关闭背景层 */
  backdrop: string | null;
  /** 背景图不透明度 0.05–0.6 */
  backdropOpacity: number;
  /** 背景图模糊半径 0–12px */
  backdropBlur: number;
  /** 全局动效倍率 0–1.5，写进 --site-motion */
  motion: number;
}

export const DEFAULT_BACKDROP = '/backdrops/anime-sisters.jpg';

const STORAGE_KEY = 'myol.prefs';

const DEFAULTS: Prefs = {
  backdrop: DEFAULT_BACKDROP,
  backdropOpacity: 0.28,
  backdropBlur: 0,
  motion: 1,
};

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function normalize(raw: unknown): Prefs {
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const backdrop = typeof input.backdrop === 'string' && input.backdrop.trim() ? input.backdrop : input.backdrop === null ? null : DEFAULTS.backdrop;
  return {
    backdrop,
    backdropOpacity: clamp(Number(input.backdropOpacity), 0.05, 0.6, DEFAULTS.backdropOpacity),
    backdropBlur: clamp(Number(input.backdropBlur), 0, 12, DEFAULTS.backdropBlur),
    motion: clamp(Number(input.motion), 0, 1.5, DEFAULTS.motion),
  };
}

let current: Prefs = loadPrefs();
const listeners = new Set<(prefs: Prefs) => void>();

export function loadPrefs(): Prefs {
  try {
    return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return { ...DEFAULTS };
  }
}

export function getPrefs(): Prefs {
  return current;
}

/** 把偏好写进 CSS 变量；styles.css 里的动效都用 var(--site-motion) 乘时长。 */
export function applyPrefs(prefs: Prefs): void {
  const root = document.documentElement;
  root.style.setProperty('--backdrop-opacity', String(prefs.backdropOpacity));
  root.style.setProperty('--backdrop-blur', prefs.backdropBlur + 'px');
  root.style.setProperty('--site-motion', String(prefs.motion));
}

export function setPrefs(patch: Partial<Prefs>): Prefs {
  current = normalize({ ...current, ...patch });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // 隐私模式或配额满：偏好只在本页有效，不阻断使用
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
