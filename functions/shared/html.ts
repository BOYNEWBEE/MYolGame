// 生成独立游戏 HTML 的公共外壳与转义工具。
// 安全约束：用户输入只进入 JSON 配置（转义后）或经过 HTML 转义，绝不拼接原始 HTML/脚本。

import { getTheme, type GameSpec } from './spec.ts';

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// JSON 注入 <script> 时必须转义 <，防止 </script> 提前闭合
export function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export interface GameShellInput {
  spec: GameSpec;
  gameScript: string; // 模板内部固定代码，不包含用户输入
  config: Record<string, unknown>; // 由规格派生的配置，经 safeJson 注入
  soundControls?: boolean;
}

// 输出可独立托管的单文件 HTML：无外部依赖、无网络请求、纯 Canvas 渲染
export function gameShell({ spec, gameScript, config, soundControls }: GameShellInput): string {
  const palette = getTheme(spec.theme).palette;
  const title = escapeHtml(spec.title);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<title>${title} · MYolGame</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    background: radial-gradient(1200px 800px at 50% -10%, ${palette.bg2}, ${palette.bg});
    color: ${palette.text};
    font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    min-height: 100vh; padding: 12px; gap: 10px;
  }
  .frame { position: relative; width: min(100%, 860px); }
  canvas {
    display: block; width: 100%; height: auto; border-radius: 12px;
    background: ${palette.bg};
    box-shadow: 0 0 0 1px ${palette.panel}, 0 18px 60px rgba(0,0,0,.55);
    touch-action: none;
  }
  .bar {
    width: min(100%, 860px); display: flex; align-items: center; justify-content: space-between;
    gap: 8px; font-size: 12px; color: ${palette.muted};
  }
  .bar b { color: ${palette.text}; font-size: 13px; }
  .badge {
    border: 1px solid ${palette.primary}55; color: ${palette.primary};
    padding: 2px 8px; border-radius: 999px; font-size: 11px; white-space: nowrap;
  }
  .sound-controls { display: flex; flex: none; align-items: center; gap: 6px; }
  .sound-controls button {
    min-height: 44px; padding: 0 10px; border-radius: 8px; cursor: pointer;
    font-family: inherit; font-size: 12px; font-weight: 600;
    border: 1px solid ${palette.primary}60; color: ${palette.text}; background: ${palette.panel};
  }
  .sound-controls button[aria-pressed="true"] { color: ${palette.bg}; background: ${palette.primary}; }
  .sound-controls button:disabled { cursor: default; opacity: 0.65; }
  .sound-controls button:focus-visible { outline: 2px solid ${palette.accent}; outline-offset: 2px; }
  .touch { display: none; gap: 8px; margin-top: 4px; }
  .touch button {
    width: 64px; height: 44px; border-radius: 10px; border: 1px solid ${palette.panel};
    background: ${palette.panel}; color: ${palette.text}; font-size: 18px;
  }
  @media (pointer: coarse) { .touch { display: flex; justify-content: center; } }
</style>
</head>
<body>
<div class="bar">
  <b>${title}</b>
  ${soundControls ? `<div class="sound-controls" role="group" aria-label="游戏声音">
    <button type="button" id="sound-enable">开启声音</button>
    <button type="button" id="sound-music" aria-pressed="false" hidden>音乐</button>
    <button type="button" id="sound-effects" aria-pressed="false" hidden>音效</button>
  </div>` : '<span class="badge">模板生成 · MYolGame</span>'}
</div>
<div class="frame"><canvas id="game" width="800" height="600"${soundControls ? ' tabindex="0" aria-label="游戏画布"' : ''}></canvas></div>
<div class="touch" id="touch"></div>
<script>const CFG = ${safeJson(config)};</script>
<script>
${gameScript}
</script>
</body>
</html>
`;
}
