// 打砖块模板：固定游戏代码 + 由规格派生的配置，生成可独立运行的单文件 HTML。

import { gameShell } from '../html.ts';
import { getTheme, type GameSpec } from '../spec.ts';

function script(): string {
  // 以下为固定的游戏运行时代码（不含任何用户输入）
  return `
(function () {
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var W = canvas.width, H = canvas.height;
  var P = CFG.palette, D = CFG.difficulty, SP = CFG.speed, OP = CFG.options || {};

  var rowsByDiff = { easy: 4, normal: 5, hard: 6 };
  var livesByDiff = { easy: 5, normal: 3, hard: 2 };
  var speedByDiff = { easy: 0.9, normal: 1, hard: 1.15 };

  var COLS = 10, ROWS = rowsByDiff[D] || 5;
  var BW = 68, BH = 22, BGAP = 6, BTOP = 78;
  var BLEFT = (W - (COLS * (BW + BGAP) - BGAP)) / 2;

  var state = 'ready';
  var score = 0, level = 1;
  var lives = (livesByDiff[D] || 3) + (OP.extraLife ? 2 : 0);
  var paddle = { w: OP.widePaddle ? 176 : 110, h: 14, x: 0, y: H - 48 };
  paddle.x = W / 2 - paddle.w / 2;
  var ball = { x: W / 2, y: 0, r: 8, vx: 0, vy: 0 };
  var bricks = [], particles = [], keys = {};

  function baseSpeed() {
    return 300 * SP * (speedByDiff[D] || 1) * (1 + Math.min(0.6, (level - 1) * 0.08));
  }

  function buildLevel() {
    bricks = [];
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var hp = (D === 'hard' && r < 2) ? 2 : 1;
        bricks.push({
          x: BLEFT + c * (BW + BGAP), y: BTOP + r * (BH + BGAP),
          w: BW, h: BH, hp: hp,
          color: P.bricks[r % P.bricks.length]
        });
      }
    }
  }

  function resetBall() {
    state = 'ready';
    ball.x = paddle.x + paddle.w / 2;
    ball.y = paddle.y - ball.r - 2;
    ball.vx = 0; ball.vy = 0;
  }

  function launch() {
    if (state !== 'ready') return;
    var s = baseSpeed();
    var ang = -Math.PI / 2 + (Math.random() * 0.5 - 0.25);
    ball.vx = Math.cos(ang) * s;
    ball.vy = Math.sin(ang) * s;
    state = 'play';
  }

  function restart() {
    score = 0; level = 1;
    lives = (livesByDiff[D] || 3) + (OP.extraLife ? 2 : 0);
    paddle.w = OP.widePaddle ? 176 : 110;
    paddle.x = W / 2 - paddle.w / 2;
    particles = [];
    buildLevel();
    resetBall();
  }

  function burst(x, y, color) {
    for (var i = 0; i < 10; i++) {
      var a = Math.random() * Math.PI * 2, v = 60 + Math.random() * 160;
      particles.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5, color: color });
    }
  }

  function update(dt) {
    var pv = 520 * SP;
    if (keys.left) paddle.x -= pv * dt;
    if (keys.right) paddle.x += pv * dt;
    paddle.x = Math.max(8, Math.min(W - paddle.w - 8, paddle.x));

    if (state === 'ready') {
      ball.x = paddle.x + paddle.w / 2;
      ball.y = paddle.y - ball.r - 2;
      return;
    }
    if (state !== 'play') return;

    var steps = 3, sdt = dt / steps;
    for (var s = 0; s < steps; s++) {
      ball.x += ball.vx * sdt;
      ball.y += ball.vy * sdt;
      if (ball.x < ball.r) { ball.x = ball.r; ball.vx = Math.abs(ball.vx); }
      if (ball.x > W - ball.r) { ball.x = W - ball.r; ball.vx = -Math.abs(ball.vx); }
      if (ball.y < ball.r + 44) { ball.y = ball.r + 44; ball.vy = Math.abs(ball.vy); }

      if (ball.vy > 0 &&
          ball.y + ball.r >= paddle.y && ball.y + ball.r <= paddle.y + paddle.h + 10 &&
          ball.x >= paddle.x - ball.r && ball.x <= paddle.x + paddle.w + ball.r) {
        var hit = (ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2);
        hit = Math.max(-1, Math.min(1, hit));
        var sp = baseSpeed();
        var ang = -Math.PI / 2 + hit * (Math.PI / 3);
        ball.vx = Math.cos(ang) * sp;
        ball.vy = Math.sin(ang) * sp;
        ball.y = paddle.y - ball.r - 1;
      }

      for (var i = 0; i < bricks.length; i++) {
        var b = bricks[i];
        if (ball.x + ball.r > b.x && ball.x - ball.r < b.x + b.w &&
            ball.y + ball.r > b.y && ball.y - ball.r < b.y + b.h) {
          var ox = Math.min(ball.x + ball.r - b.x, b.x + b.w - (ball.x - ball.r));
          var oy = Math.min(ball.y + ball.r - b.y, b.y + b.h - (ball.y - ball.r));
          if (ox < oy) ball.vx = -ball.vx; else ball.vy = -ball.vy;
          b.hp -= 1;
          if (b.hp <= 0) {
            bricks.splice(i, 1);
            score += D === 'hard' ? 15 : 10;
            burst(b.x + b.w / 2, b.y + b.h / 2, b.color);
          } else {
            score += 2;
          }
          break;
        }
      }

      if (ball.y > H + ball.r) {
        lives -= 1;
        if (lives <= 0) { state = 'over'; } else { resetBall(); }
        return;
      }
    }

    if (bricks.length === 0) {
      level += 1;
      score += 50;
      buildLevel();
      resetBall();
    }

    for (var p = particles.length - 1; p >= 0; p--) {
      var q = particles[p];
      q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt;
      if (q.life <= 0) particles.splice(p, 1);
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

    ctx.font = '16px sans-serif';
    ctx.fillStyle = P.text;
    ctx.textAlign = 'left';
    ctx.fillText('得分 ' + score, 20, 32);
    ctx.textAlign = 'center';
    ctx.fillText('第 ' + level + ' 关', W / 2, 32);
    ctx.textAlign = 'right';
    ctx.fillStyle = P.accent;
    ctx.fillText('生命 ' + lives, W - 20, 32);

    for (var i = 0; i < bricks.length; i++) {
      var b = bricks[i];
      ctx.fillStyle = b.color;
      ctx.globalAlpha = b.hp > 1 ? 1 : 0.85;
      roundRect(b.x, b.y, b.w, b.h, 5);
      ctx.fill();
      if (b.hp > 1) {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = P.text;
        roundRect(b.x + 4, b.y + 4, b.w - 8, b.h / 2 - 4, 3);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = P.primary;
    roundRect(paddle.x, paddle.y, paddle.w, paddle.h, 7);
    ctx.fill();

    ctx.fillStyle = P.accent;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();

    for (var p = 0; p < particles.length; p++) {
      var q = particles[p];
      ctx.globalAlpha = Math.max(0, q.life * 2);
      ctx.fillStyle = q.color;
      ctx.fillRect(q.x - 2, q.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

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
        ctx.fillText('← → / A D / 鼠标移动挡板', W / 2, H / 2 + 6);
        ctx.fillStyle = P.secondary;
        ctx.fillText('点击或按空格发射小球', W / 2, H / 2 + 40);
      } else {
        ctx.fillStyle = P.accent;
        ctx.font = 'bold 40px sans-serif';
        ctx.fillText('游戏结束', W / 2, H / 2 - 30);
        ctx.fillStyle = P.text;
        ctx.font = '20px sans-serif';
        ctx.fillText('最终得分 ' + score + ' · 到达第 ' + level + ' 关', W / 2, H / 2 + 10);
        ctx.fillStyle = P.muted;
        ctx.font = '16px sans-serif';
        ctx.fillText('按 R 或点击重新开始', W / 2, H / 2 + 46);
      }
    }
  }

  var last = 0;
  function frame(t) {
    var dt = Math.min(0.033, (t - last) / 1000 || 0.016);
    last = t;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = true;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = true;
    if (e.key === ' ') { e.preventDefault(); if (state === 'over') restart(); else launch(); }
    if (e.key === 'r' || e.key === 'R') restart();
  });
  document.addEventListener('keyup', function (e) {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = false;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = false;
  });

  canvas.addEventListener('pointermove', function (e) {
    var rect = canvas.getBoundingClientRect();
    var x = (e.clientX - rect.left) * (W / rect.width);
    paddle.x = Math.max(8, Math.min(W - paddle.w - 8, x - paddle.w / 2));
  });
  canvas.addEventListener('pointerdown', function () {
    if (state === 'over') restart(); else launch();
  });

  var touch = document.getElementById('touch');
  function bindBtn(label, on, off) {
    var b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('pointerdown', function (e) { e.preventDefault(); on(); });
    b.addEventListener('pointerup', off);
    b.addEventListener('pointerleave', off);
    touch.appendChild(b);
  }
  bindBtn('◀', function () { keys.left = true; }, function () { keys.left = false; });
  bindBtn('发射', function () { if (state === 'over') restart(); else launch(); }, function () {});
  bindBtn('▶', function () { keys.right = true; }, function () { keys.right = false; });

  buildLevel();
  resetBall();
  requestAnimationFrame(frame);
})();
`;
}

export function renderBreakout(spec: GameSpec): string {
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
        widePaddle: Boolean(spec.options.widePaddle),
        extraLife: Boolean(spec.options.extraLife),
      },
    },
  });
}
