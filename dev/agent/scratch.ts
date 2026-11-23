// 从零创作没有模板源码：骨架只用于说明必需的页面结构、响应式布局和检查接口，
// 模型必须整体替换为真实玩法；检查接口故意抛错，避免原样复制骨架也被判为成功。
export const SCRATCH_BASE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>从零创作 · MYolGame</title>
<style>
* { box-sizing: border-box; }
body { margin: 0; padding: 8px; background: #0b1020; color: #e9f0ff; font-family: system-ui, sans-serif; text-align: center; }
h1 { font-size: 22px; margin: 8px 0; }
canvas { width: min(100%, 640px); height: auto; max-height: calc(100dvh - 100px); background: #18243d; border-radius: 18px; }
</style>
</head>
<body>
<h1>从零创作的游戏</h1>
<p>空格开始，方向键操作</p>
<canvas id="game" width="640" height="400"></canvas>
<script>
// 以下只是占位实现，必须替换为完整、可玩的游戏逻辑。
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
function draw() {
  ctx.fillStyle = '#18243d';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#e9f0ff';
  ctx.font = '20px sans-serif';
  ctx.fillText('等待实现真实玩法', 30, 40);
}
draw();
window.__MYOLGAME_TEST__ = {
  getState() { throw new Error('骨架未实现游戏状态'); },
  reset() { throw new Error('骨架未实现游戏状态'); },
};
</script>
</body>
</html>
`;