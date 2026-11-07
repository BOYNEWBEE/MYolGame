// 沙箱游戏框架：iframe sandbox 仅允许脚本执行，独立源、无网络、无表单。

import { useEffect, useRef, useState, type ReactNode } from 'react';

interface SandboxFrameProps {
  src: string;
  title: string;
  reloadKey?: number; // 变化时强制重新加载 iframe
}

export default function SandboxFrame({ src, title, reloadKey = 0 }: SandboxFrameProps): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const [frameKey, setFrameKey] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setFrameKey((k) => k + 1);
    setLoading(true);
  }, [src, reloadKey]);

  async function fullscreen(): Promise<void> {
    if (!containerRef.current) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await containerRef.current.requestFullscreen();
    } catch {
      // 浏览器拒绝全屏时静默忽略
    }
  }

  return (
    <div className="sandbox-wrap">
      <div className="sandbox-toolbar">
        <span className="sandbox-note">沙箱隔离运行 · 禁止网络访问</span>
        <div className="sandbox-actions">
          <button
            type="button"
            className="btn small"
            onClick={() => {
              setFrameKey((k) => k + 1);
              setLoading(true);
            }}
          >
            重新开始
          </button>
          <button type="button" className="btn small" onClick={() => void fullscreen()}>
            全屏
          </button>
        </div>
      </div>
      <div className="sandbox-frame" ref={containerRef}>
        {loading && (
          <div className="sandbox-loading" aria-hidden="true">
            <div className="spinner" />
            <span>游戏加载中…</span>
          </div>
        )}
        <iframe
          key={frameKey}
          src={src}
          title={title}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          onLoad={() => setLoading(false)}
        />
      </div>
    </div>
  );
}
