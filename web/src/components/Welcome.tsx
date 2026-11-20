// 首次进入的整页欢迎屏：背景图保持清晰，点「进入」后欢迎内容淡出、背景逐渐模糊、主页面浮现。
// 自动化测试（navigator.webdriver）直接跳过，避免遮挡端到端用例。

import { useEffect, useRef, useState, type ReactNode } from 'react';

const SEEN_KEY = 'myol.welcome.v1';

type Phase = 'show' | 'leaving' | 'done';

function initialState(): Phase {
  if (typeof navigator !== 'undefined' && navigator.webdriver) return 'done';
  try {
    return localStorage.getItem(SEEN_KEY) ? 'done' : 'show';
  } catch {
    return 'show';
  }
}

export interface WelcomeProps {
  /** 欢迎页是否还占着整页；App 用它同步背景模糊与主页面显隐 */
  onActiveChange?: (active: boolean) => void;
}

export default function Welcome({ onActiveChange }: WelcomeProps): ReactNode {
  const [phase, setPhase] = useState<Phase>(initialState);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    // 只有「还在展示欢迎屏」时才算占着整页；一按进入（leaving）就该让背景开始模糊
    onActiveChange?.(phase === 'show');
  }, [phase, onActiveChange]);

  function enter(): void {
    if (phase !== 'show') return;
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      // 隐私模式写不进去也不影响本次进入
    }
    setPhase('leaving');
    timers.current.push(window.setTimeout(() => setPhase('done'), 900));
  }

  useEffect(() => {
    if (phase !== 'show') return;
    buttonRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'Escape') enter();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  useEffect(() => () => {
    for (const id of timers.current) window.clearTimeout(id);
  }, []);

  if (phase === 'done') return null;

  return (
    <div className={'welcome' + (phase === 'leaving' ? ' is-leaving' : '')} role="dialog" aria-modal="true" aria-label="欢迎">
      <div className="welcome-inner">
        <div className="welcome-mark" aria-hidden="true">
          <svg width="64" height="64" viewBox="0 0 32 32">
            <defs>
              <linearGradient id="welcome-g" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#818cf8" />
                <stop offset="100%" stopColor="#c084fc" />
              </linearGradient>
            </defs>
            <rect x="1.75" y="1.75" width="28.5" height="28.5" rx="8.25" fill="none" stroke="url(#welcome-g)" strokeWidth="1.6" />
            <circle cx="11" cy="13" r="2.2" fill="#a5b4fc" />
            <circle cx="21" cy="13" r="2.2" fill="#e879f9" />
            <path d="M10 19.5 Q16 24.5 22 19.5" stroke="url(#welcome-g)" strokeWidth="2" fill="none" strokeLinecap="round" />
          </svg>
        </div>
        <h1>欢迎来到 <em>MYolGame</em></h1>
        <p className="welcome-lead">用一句话描述想玩的游戏，它会生成一个能在浏览器里直接玩的 2D 小游戏；不满意就继续说，版本随时可以回退。</p>
        <ul className="welcome-points">
          <li>五种内置模板，开箱即玩</li>
          <li>接入模型后可写完整源码</li>
          <li>发布到社区，别人也能试玩</li>
        </ul>
        <button ref={buttonRef} type="button" className="btn primary large welcome-enter" onClick={enter}>
          进入
        </button>
        <p className="welcome-hint">仅首次进入显示 · 按 Enter 也可进入</p>
      </div>
    </div>
  );
}
