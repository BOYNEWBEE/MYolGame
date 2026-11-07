// 贪吃蛇模板：固定游戏代码 + 由规格派生的配置。

import { gameShell } from '../html.ts';
import { getTheme, type GameSpec } from '../spec.ts';

function script(): string {
  return `
(function () {
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var W = canvas.width, H = canvas.height;
  var P = CFG.palette, D = CFG.difficulty, SP = CFG.speed, OP = CFG.options || {};

  var CELL = 32, HUD = 56;
  var COLS = Math.floor(W / CELL);
  var ROWS = Math.floor((H - HUD) / CELL);

  var tickBase = { easy: 0.17, normal: 0.135, hard: 0.105 }[D] || 0.135;
  function tickTime() { return tickBase / SP; }

  var snake, dir, dirQueue, food, golden, obstacles, score, best = 0;
  var state = 'ready', acc = 0, goldenEaten = 0, boost = 0;

  function cellCenter(c) {
    return { x: c.x * CELL + CELL / 2, y: HUD + c.y * CELL + CELL / 2 };
  }

  function freeCells() {
    var taken = {};
    for (var i = 0; i < snake.length; i++) taken[snake[i].x + ',' + snake[i].y] = 1;
    for (var o = 0; o < obstacles.length; o++) taken[obstacles[o].x + ',' + obstacles[o].y] = 1;
    if (food) taken[food.x + ',' + food.y] = 1;
    if (golden) taken[golden.x + ',' + golden.y] = 1;
    var out = [];
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        if (!taken[x + ',' + y]) out.push({ x: x, y: y });
      }
    }
    return out;
  }

  function placeFood() {
    var free = freeCells();
    if (free.length === 0) return null;
    return free[Math.floor(Math.random() * free.length)];
  }

  function buildObstacles() {
    obstacles = [];
    if (D !== 'hard') return;
    var cx = Math.floor(COLS / 2), cy = Math.floor(ROWS / 2);
    var pts = [
      { x: cx - 4, y: cy - 2 }, { x: cx - 4, y: cy - 1 },
      { x: cx + 4, y: cy + 2 }, { x: cx + 4, y: cy + 1 },
      { x: cx - 1, y: cy - 4 }, { x: cx + 1, y: cy + 4 }
    ];
    for (var i = 0; i < pts.length; i++) obstacles.push(pts[i]);
  }

  function restart() {
    var cx = Math.floor(COLS / 2), cy = Math.floor(ROWS / 2);
    snake = [{ x: cx, y: cy }, { x: cx - 1, y: cy }, { x: cx - 2, y: cy }];
    dir = { x: 1, y: 0 };
    dirQueue = [];
    score = 0; acc = 0; goldenEaten = 0; boost = 0;
    golden = null;
    buildObstacles();
    food = placeFood();
    state = 'play';
  }

  function pushDir(nx, ny) {
    var last = dirQueue.length > 0 ? dirQueue[dirQueue.length - 1] : dir;
    if (nx === -last.x && ny === -last.y) return;
    if (nx === last.x && ny === last.y) return;
    if (dirQueue.length < 3) dirQueue.push({ x: nx, y: ny });
  }

  function step() {
    if (dirQueue.length > 0) dir = dirQueue.shift();
    var head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

    if (OP.wrapWalls) {
      head.x = (head.x + COLS) % COLS;
      head.y = (head.y + ROWS) % ROWS;
    } else if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) {
      return gameOver();
    }

    for (var i = 0; i < snake.length - 1; i++) {
      if (snake[i].x === head.x && snake[i].y === head.y) return gameOver();
    }
    for (var o = 0; o < obstacles.length; o++) {
      if (obstacles[o].x === head.x && obstacles[o].y === head.y) return gameOver();
    }

    snake.unshift(head);

    var ate = false;
    if (food && head.x === food.x && head.y === food.y) {
      score += 10; ate = true; goldenEaten += 1;
      food = placeFood();
      if (OP.goldenFood && goldenEaten % 5 === 0 && !golden) {
        golden = { cell: placeFood(), ttl: 8 };
      }
    } else if (golden && golden.cell && head.x === golden.cell.x && head.y === golden.cell.y) {
      score += 50; ate = true; boost = 3; golden = null;
    }
    if (!ate) snake.pop();
  }

  function gameOver() {
    state = 'over';
    if (score > best) best = score;
  }

  function update(dt) {
    if (state !== 'play') return;
    if (golden) {
      golden.ttl -= dt;
      if (golden.ttl <= 0) golden = null;
    }
    if (boost > 0) boost -= dt;
    acc += dt;
    var t = tickTime() * (boost > 0 ? 0.6 : 1);
    while (acc >= t && state === 'play') {
      acc -= t;
      step();
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function draw() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, P.bg2); g.addColorStop(1, P.bg);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (var x = 0; x <= COLS; x++) {
      ctx.beginPath(); ctx.moveTo(x * CELL, HUD); ctx.lineTo(x * CELL, HUD + ROWS * CELL); ctx.stroke();
    }
    for (var y = 0; y <= ROWS; y++) {
      ctx.beginPath(); ctx.moveTo(0, HUD + y * CELL); ctx.lineTo(COLS * CELL, HUD + y * CELL); ctx.stroke();
    }

    ctx.fillStyle = P.panel;
    ctx.fillRect(0, 0, W, HUD - 8);
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = P.text;
    ctx.fillText('得分 ' + score, 20, 34);
    ctx.textAlign = 'center';
    ctx.fillStyle = P.muted;
    ctx.fillText('长度 ' + snake.length + (boost > 0 ? ' · 加速中' : ''), W / 2, 34);
    ctx.textAlign = 'right';
    ctx.fillStyle = P.accent;
    ctx.fillText('最高 ' + best, W - 20, 34);

    for (var o = 0; o < obstacles.length; o++) {
      var oc = cellCenter(obstacles[o]);
      ctx.fillStyle = P.muted;
      roundRect(oc.x - CELL / 2 + 3, oc.y - CELL / 2 + 3, CELL - 6, CELL - 6, 4);
      ctx.fill();
    }

    if (food) {
      var fc = cellCenter(food);
      ctx.fillStyle = P.secondary;
      ctx.beginPath();
      ctx.arc(fc.x, fc.y, CELL / 2 - 6, 0, Math.PI * 2);
      ctx.fill();
    }
    if (golden && golden.cell) {
      var gc = cellCenter(golden.cell);
      ctx.fillStyle = P.accent;
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(Date.now() / 150);
      ctx.beginPath();
      ctx.arc(gc.x, gc.y, CELL / 2 - 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    for (var i = snake.length - 1; i >= 0; i--) {
      var sc = cellCenter(snake[i]);
      var t2 = i / Math.max(1, snake.length - 1);
      ctx.fillStyle = i === 0 ? P.primary : (i % 2 === 0 ? P.secondary : P.primary);
      ctx.globalAlpha = 1 - t2 * 0.45;
      roundRect(sc.x - CELL / 2 + 2, sc.y - CELL / 2 + 2, CELL - 4, CELL - 4, 6);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    var head = cellCenter(snake[0]);
    ctx.fillStyle = P.bg;
    var ex = dir.x * 5, ey = dir.y * 5;
    ctx.beginPath(); ctx.arc(head.x - 5 + ex, head.y - 4 + ey, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(head.x + 5 + ex, head.y - 4 + ey, 3, 0, Math.PI * 2); ctx.fill();

    if (state !== 'play') {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      if (state === 'ready') {
        ctx.fillStyle = P.text;
        ctx.font = 'bold 34px sans-serif';
        ctx.fillText(CFG.title, W / 2, H / 2 - 40);
        ctx.font = '18px sans-serif';
        ctx.fillStyle = P.muted;
        ctx.fillText('方向键 / WASD / 滑动转向，空格暂停', W / 2, H / 2 + 6);
        ctx.fillStyle = P.secondary;
        ctx.fillText('点击或按空格开始', W / 2, H / 2 + 40);
      } else if (state === 'paused') {
        ctx.fillStyle = P.text;
        ctx.font = 'bold 32px sans-serif';
        ctx.fillText('已暂停', W / 2, H / 2);
        ctx.font = '16px sans-serif';
        ctx.fillStyle = P.muted;
        ctx.fillText('按空格继续', W / 2, H / 2 + 34);
      } else {
        ctx.fillStyle = P.accent;
        ctx.font = 'bold 40px sans-serif';
        ctx.fillText('游戏结束', W / 2, H / 2 - 30);
        ctx.fillStyle = P.text;
        ctx.font = '20px sans-serif';
        ctx.fillText('得分 ' + score + ' · 长度 ' + snake.length, W / 2, H / 2 + 10);
        ctx.fillStyle = P.muted;
        ctx.font = '16px sans-serif';
        ctx.fillText('按 R 或点击重新开始', W / 2, H / 2 + 46);
      }
    }
  }

  var last = 0;
  function frame(t) {
    var dt = Math.min(0.05, (t - last) / 1000 || 0.016);
    last = t;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  document.addEventListener('keydown', function (e) {
    var k = e.key;
    var isDir = (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight' ||
                 k === 'w' || k === 'a' || k === 's' || k === 'd' ||
                 k === 'W' || k === 'A' || k === 'S' || k === 'D');
    if (isDir && state === 'ready') restart();
    if (k === 'ArrowUp' || k === 'w' || k === 'W') { e.preventDefault(); pushDir(0, -1); }
    else if (k === 'ArrowDown' || k === 's' || k === 'S') { e.preventDefault(); pushDir(0, 1); }
    else if (k === 'ArrowLeft' || k === 'a' || k === 'A') { e.preventDefault(); pushDir(-1, 0); }
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') { e.preventDefault(); pushDir(1, 0); }
    else if (k === ' ') {
      e.preventDefault();
      if (state === 'ready' || state === 'over') restart();
      else if (state === 'play') state = 'paused';
      else if (state === 'paused') state = 'play';
    } else if (k === 'r' || k === 'R') {
      restart();
    }
  });

  var touchStart = null;
  canvas.addEventListener('pointerdown', function (e) {
    touchStart = { x: e.clientX, y: e.clientY };
    if (state === 'ready') restart();
    else if (state === 'over') restart();
    else if (state === 'paused') state = 'play';
  });
  canvas.addEventListener('pointerup', function (e) {
    if (!touchStart) return;
    var dx = e.clientX - touchStart.x, dy = e.clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
    if (Math.abs(dx) > Math.abs(dy)) pushDir(dx > 0 ? 1 : -1, 0);
    else pushDir(0, dy > 0 ? 1 : -1);
  });

  var touch = document.getElementById('touch');
  function bindBtn(label, fn) {
    var b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('pointerdown', function (e) { e.preventDefault(); fn(); });
    touch.appendChild(b);
  }
  bindBtn('▲', function () { if (state !== 'play') restart(); else pushDir(0, -1); });
  bindBtn('◀', function () { if (state !== 'play') restart(); else pushDir(-1, 0); });
  bindBtn('▼', function () { if (state !== 'play') restart(); else pushDir(0, 1); });
  bindBtn('▶', function () { if (state !== 'play') restart(); else pushDir(1, 0); });

  snake = [{ x: 3, y: 3 }, { x: 2, y: 3 }, { x: 1, y: 3 }];
  dir = { x: 1, y: 0 }; dirQueue = [];
  obstacles = []; food = null; golden = null; score = 0;
  buildObstacles();
  food = placeFood();
  requestAnimationFrame(frame);
})();
`;
}

export function renderSnake(spec: GameSpec): string {
  const palette = getTheme(spec.theme).palette;
  return gameShell({
    spec,
    gameScript: script(),
    config: {
      title: spec.title,
      palette,
      difficulty: spec.difficulty,
      speed: spec.speed,
      options: {
        wrapWalls: Boolean(spec.options.wrapWalls),
        goldenFood: Boolean(spec.options.goldenFood),
      },
    },
  });
}
