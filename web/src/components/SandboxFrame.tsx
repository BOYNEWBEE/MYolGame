// 沙箱游戏框架：iframe sandbox 仅允许脚本执行，独立源、无网络、无表单。

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getToken } from '../api.ts';

interface SandboxFrameProps {
  src: string;
  title: string;
  authenticated?: boolean;
  reloadKey?: number; // 变化时强制重新加载 iframe
}

interface PreviewResult {
  src: string;
  frameKey: number;
  html?: string;
  error?: string;
}

export default function SandboxFrame({ src, title, authenticated = false, reloadKey = 0 }: SandboxFrameProps): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const [frameKey, setFrameKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const current = preview?.src === src && preview.frameKey === frameKey ? preview : null;

  useEffect(() => {
    setFrameKey((k) => k + 1);
    setLoading(true);
  }, [src, reloadKey]);

  useEffect(() => {
    if (!authenticated) return;
    const controller = new AbortController();
    const token = getToken();
    async function loadPreview(): Promise<void> {
      try {
        const response = await fetch(src, {
          signal: controller.signal,
          headers: token ? { authorization: 'Bearer ' + token } : undefined,
        });
        if (!response.ok) throw new Error('无法加载私有预览（' + response.status + '）');
        const html = await response.text();
        if (!controller.signal.aborted) setPreview({ src, frameKey, html });
      } catch (error) {
        if (!controller.signal.aborted) {
          setPreview({ src, frameKey, error: error instanceof Error ? error.message : '无法加载私有预览' });
        }
      }
    }
    void loadPreview();
    return () => controller.abort();
  }, [authenticated, src, frameKey]);

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
        {loading && !current?.error && (
          <div className="sandbox-loading" aria-hidden="true">
            <div className="spinner" />
            <span>游戏加载中…</span>
          </div>
        )}
        {current?.error && <div className="error-banner" role="alert">{current.error}</div>}
        {(!authenticated || current?.html) && (
          <iframe
            key={frameKey}
            src={authenticated ? undefined : src}
            srcDoc={authenticated ? current?.html : undefined}
            title={title}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            onLoad={() => setLoading(false)}
          />
        )}
      </div>
    </div>
  );
}
