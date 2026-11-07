// 太空射击模板：固定游戏代码 + 由规格派生的配置。

import { gameShell } from '../html.ts';
import { getTheme, type GameSpec } from '../spec.ts';

function script(): string {
  return `
(function () {
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var W = canvas.width, H = canvas.height;
  var P = CFG.palette, D = CFG.difficulty, SP = CFG.speed, OP = CFG.options || {};

  var hpByDiff = { easy: 5, normal: 3, hard: 2 };
  var spawnByDiff = { easy: 1.5, normal: 1.05, hard: 0.72 };
  var enemyShootByDiff = { easy: 0, normal: 0.006, hard: 0.014 };

  var state = 'ready';
  var score = 0, wave = 1, kills = 0, best = 0;
  var player = { x: W / 2, y: H - 80, w: 44, h: 34, hp: 3, cool: 0, inv: 0, shieldT: 0, hasShield: false };
  var bullets = [], enemyBullets = [], enemies = [], particles = [], stars = [];
  var keys = {}, spawnT = 0, touchPos = null, touching = false;

  for (var i = 0; i < 90; i++) {
    stars.push({
      x: Math.random() * W, y: Math.random() * H,
      r: Math.random() * 1.6 + 0.4, s: Math.random() * 40 + 12
    });
  }

  function reset() {
    score = 0; wave = 1; kills = 0;
    bullets = []; enemyBullets = []; enemies = []; particles = [];
    player.x = W / 2; player.y = H - 80;
    player.hp = (hpByDiff[D] || 3);
    player.cool = 0; player.inv = 2; player.shieldT = 0;
    player.hasShield = false;
    spawnT = 0.6;
    state = 'play';
  }

  function burst(x, y, color, n) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, v = 50 + Math.random() * 200;
      particles.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.6, color: color });
    }
  }

  function spawnEnemy() {
    var kind = Math.random() < (D === 'hard' ? 0.35 : 0.18) && wave > 1 ? 'heavy' : 'scout';
    var e = {
      x: 40 + Math.random() * (W - 80), y: -40,
      kind: kind,
      hp: kind === 'heavy' ? 2 + Math.floor(wave / 3) : 1,
      w: kind === 'heavy' ? 46 : 34, h: kind === 'heavy' ? 38 : 28,
      vy: (kind === 'heavy' ? 46 : 74) * SP * (1 + wave * 0.03),
      phase: Math.random() * Math.PI * 2,
      amp: 30 + Math.random() * 50,
      color: kind === 'heavy' ? P.bricks[3 % P.bricks.length] : P.bricks[Math.floor(Math.random() * P.bricks.length)]
    };
    enemies.push(e);
  }

  function fire() {
    if (player.cool > 0) return;
    player.cool = 0.17 / SP;
    var by = player.y - player.h / 2;
    bullets.push({ x: player.x, y: by, vx: 0, vy: -560 * SP });
    if (OP.spreadShot) {
      bullets.push({ x: player.x - 10, y: by + 6, vx: -140, vy: -520 * SP });
      bullets.push({ x: player.x + 10, y: by + 6, vx: 140, vy: -520 * SP });
    }
  }

  function hitPlayer() {
    if (player.inv > 0) return;
    if (OP.shield && player.hasShield) {
      player.hasShield = false;
      player.shieldT = 0;
      player.inv = 1;
      burst(player.x, player.y, P.secondary, 14);
      return;
    }
    player.hp -= 1;
    player.inv = 1.6;
    burst(player.x, player.y, P.accent, 16);
    if (player.hp <= 0) {
      state = 'over';
      if (score > best) best = score;
      burst(player.x, player.y, P.primary, 30);
    }
  }

  function update(dt) {
    for (var s = 0; s < stars.length; s++) {
      var st = stars[s];
      st.y += st.s * dt * (state === 'play' ? 1 : 0.3);
      if (st.y > H) { st.y = -2; st.x = Math.random() * W; }
    }
    for (var p = particles.length - 1; p >= 0; p--) {
      var q = particles[p];
      q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt;
      if (q.life <= 0) particles.splice(p, 1);
    }
    if (state !== 'play') return;

    var pv = 340 * SP;
    var mx = 0, my = 0;
    if (keys.left) mx -= 1;
    if (keys.right) mx += 1;
    if (keys.up) my -= 1;
    if (keys.down) my += 1;
    player.x += mx * pv * dt;
    player.y += my * pv * dt;
    if (touchPos) {
      player.x += (touchPos.x - player.x) * Math.min(1, dt * 12);
      player.y += (touchPos.y - player.y) * Math.min(1, dt * 12);
    }
    player.x = Math.max(24, Math.min(W - 24, player.x));
    player.y = Math.max(H * 0.35, Math.min(H - 30, player.y));

    if (player.inv > 0) player.inv -= dt;
    if (player.cool > 0) player.cool -= dt;
    if (OP.shield) {
      if (!player.hasShield) {
        player.shieldT += dt;
        if (player.shieldT >= 12) { player.hasShield = true; player.shieldT = 0; }
      }
    }

    if (keys.fire || touching) fire();

    spawnT -= dt;
    if (spawnT <= 0) {
      spawnEnemy();
      spawnT = (spawnByDiff[D] || 1) / (1 + wave * 0.06) / SP;
    }

    for (var b = bullets.length - 1; b >= 0; b--) {
      var bu = bullets[b];
      bu.x += bu.vx * dt; bu.y += bu.vy * dt;
      if (bu.y < -20 || bu.x < -20 || bu.x > W + 20) bullets.splice(b, 1);
    }
    for (var eb = enemyBullets.length - 1; eb >= 0; eb--) {
      var e2 = enemyBullets[eb];
      e2.x += e2.vx * dt; e2.y += e2.vy * dt;
      if (e2.y > H + 20) { enemyBullets.splice(eb, 1); continue; }
      if (Math.abs(e2.x - player.x) < 18 && Math.abs(e2.y - player.y) < 16) {
        enemyBullets.splice(eb, 1);
        hitPlayer();
      }
    }

    for (var e = enemies.length - 1; e >= 0; e--) {
      var en = enemies[e];
      en.phase += dt * 2;
      en.y += en.vy * dt;
      en.x += Math.cos(en.phase) * en.amp * dt;
      en.x = Math.max(20, Math.min(W - 20, en.x));
      if (en.y > H + 40) { enemies.splice(e, 1); continue; }

      if (Math.abs(en.x - player.x) < (en.w + player.w) / 2 - 6 &&
          Math.abs(en.y - player.y) < (en.h + player.h) / 2 - 6) {
        enemies.splice(e, 1);
        burst(en.x, en.y, en.color, 18);
        hitPlayer();
        continue;
      }

      if ((enemyShootByDiff[D] || 0) > 0 && Math.random() < (enemyShootByDiff[D] || 0) * SP) {
        var dx = player.x - en.x, dy = player.y - en.y;
        var len = Math.sqrt(dx * dx + dy * dy) || 1;
        enemyBullets.push({ x: en.x, y: en.y + en.h / 2, vx: dx / len * 220 * SP, vy: dy / len * 220 * SP });
      }

      for (var b2 = bullets.length - 1; b2 >= 0; b2--) {
        var bu2 = bullets[b2];
        if (Math.abs(bu2.x - en.x) < en.w / 2 + 3 && Math.abs(bu2.y - en.y) < en.h / 2 + 3) {
          bullets.splice(b2, 1);
          en.hp -= 1;
          if (en.hp <= 0) {
            enemies.splice(e, 1);
            kills += 1;
            score += en.kind === 'heavy' ? 30 : 10;
            if (kills % 12 === 0) wave += 1;
            burst(en.x, en.y, en.color, 16);
          }
          break;
        }
      }
    }
  }

  function drawShip(x, y) {
    ctx.fillStyle = player.inv > 0 && Math.floor(Date.now() / 100) % 2 === 0 ? P.muted : P.primary;
    ctx.beginPath();
    ctx.moveTo(x, y - 20);
    ctx.lineTo(x + 18, y + 14);
    ctx.lineTo(x + 7, y + 9);
    ctx.lineTo(x, y + 14);
    ctx.lineTo(x - 7, y + 9);
    ctx.lineTo(x - 18, y + 14);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = P.secondary;
    ctx.beginPath();
    ctx.arc(x, y - 4, 5, 0, Math.PI * 2);
    ctx.fill();
    if (OP.shield && player.hasShield) {
      ctx.strokeStyle = P.secondary;
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 30, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function draw() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, P.bg); g.addColorStop(1, P.bg2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = P.text;
    for (var s = 0; s < stars.length; s++) {
      var st = stars[s];
      ctx.globalAlpha = 0.25 + st.r / 2;
      ctx.fillRect(st.x, st.y, st.r, st.r);
    }
    ctx.globalAlpha = 1;

    ctx.font = '16px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = P.text;
    ctx.fillText('得分 ' + score, 20, 32);
    ctx.textAlign = 'center';
    ctx.fillStyle = P.muted;
    ctx.fillText('波次 ' + wave, W / 2, 32);
    ctx.textAlign = 'right';
    ctx.fillStyle = P.accent;
    var hearts = '';
    for (var h = 0; h < player.hp; h++) hearts += '♥';
    ctx.fillText(hearts || '—', W - 20, 32);
    if (OP.shield) {
      ctx.fillStyle = P.secondary;
      ctx.textAlign = 'left';
      ctx.font = '13px sans-serif';
      ctx.fillText(player.hasShield ? '护盾就绪' : '护盾充能 ' + Math.max(0, Math.ceil(12 - player.shieldT)) + 's', 20, 54);
    }

    if (state === 'play' || state === 'over') {
      for (var e = 0; e < enemies.length; e++) {
        var en = enemies[e];
        ctx.fillStyle = en.color;
        ctx.beginPath();
        ctx.moveTo(en.x, en.y + en.h / 2);
        ctx.lineTo(en.x + en.w / 2, en.y - en.h / 2);
        ctx.lineTo(en.x - en.w / 2, en.y - en.h / 2);
        ctx.closePath();
        ctx.fill();
        if (en.kind === 'heavy') {
          ctx.fillStyle = P.text;
          ctx.globalAlpha = 0.6;
          ctx.fillRect(en.x - 8, en.y - 6, 16, 5);
          ctx.globalAlpha = 1;
        }
      }
      ctx.fillStyle = P.accent;
      for (var b = 0; b < bullets.length; b++) {
        ctx.fillRect(bullets[b].x - 2, bullets[b].y - 8, 4, 12);
      }
      ctx.fillStyle = P.bricks[3 % P.bricks.length];
      for (var eb = 0; eb < enemyBullets.length; eb++) {
        ctx.beginPath();
        ctx.arc(enemyBullets[eb].x, enemyBullets[eb].y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      if (state === 'play') drawShip(player.x, player.y);
      for (var p = 0; p < particles.length; p++) {
        var q = particles[p];
        ctx.globalAlpha = Math.max(0, q.life * 1.6);
        ctx.fillStyle = q.color;
        ctx.fillRect(q.x - 2, q.y - 2, 4, 4);
      }
      ctx.globalAlpha = 1;
    }

    if (state !== 'play') {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      if (state === 'ready') {
        ctx.fillStyle = P.text;
        ctx.font = 'bold 34px sans-serif';
        ctx.fillText(CFG.title, W / 2, H / 2 - 46);
        ctx.font = '18px sans-serif';
        ctx.fillStyle = P.muted;
        ctx.fillText('方向键 / WASD 移动，空格射击', W / 2, H / 2);
        ctx.fillText('触屏：拖动移动，自动射击', W / 2, H / 2 + 28);
        ctx.fillStyle = P.secondary;
        ctx.fillText('点击或按空格开始', W / 2, H / 2 + 66);
      } else {
        ctx.fillStyle = P.accent;
        ctx.font = 'bold 40px sans-serif';
        ctx.fillText('战机坠毁', W / 2, H / 2 - 36);
        ctx.fillStyle = P.text;
        ctx.font = '20px sans-serif';
        ctx.fillText('得分 ' + score + ' · 波次 ' + wave + ' · 最高 ' + best, W / 2, H / 2 + 4);
        ctx.fillStyle = P.muted;
        ctx.font = '16px sans-serif';
        ctx.fillText('按 R 或点击重新开始', W / 2, H / 2 + 42);
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
    var k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = true;
    if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = true;
    if (k === 'ArrowUp' || k === 'w' || k === 'W') keys.up = true;
    if (k === 'ArrowDown' || k === 's' || k === 'S') keys.down = true;
    if (k === ' ') {
      e.preventDefault();
      if (state === 'ready' || state === 'over') reset();
      else keys.fire = true;
    }
    if (k === 'r' || k === 'R') reset();
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(k) >= 0) e.preventDefault();
  });
  document.addEventListener('keyup', function (e) {
    var k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = false;
    if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = false;
    if (k === 'ArrowUp' || k === 'w' || k === 'W') keys.up = false;
    if (k === 'ArrowDown' || k === 's' || k === 'S') keys.down = false;
    if (k === ' ') keys.fire = false;
  });

  function toGame(e) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (W / rect.width),
      y: (e.clientY - rect.top) * (H / rect.height)
    };
  }
  canvas.addEventListener('pointerdown', function (e) {
    if (state === 'ready' || state === 'over') { reset(); return; }
    touching = true;
    touchPos = toGame(e);
  });
  canvas.addEventListener('pointermove', function (e) {
    if (touching) touchPos = toGame(e);
  });
  canvas.addEventListener('pointerup', function () { touching = false; touchPos = null; });
  canvas.addEventListener('pointercancel', function () { touching = false; touchPos = null; });

  var touch = document.getElementById('touch');
  function bindBtn(label, on, off) {
    var b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('pointerdown', function (e) { e.preventDefault(); on(); });
    if (off) {
      b.addEventListener('pointerup', off);
      b.addEventListener('pointerleave', off);
    }
    touch.appendChild(b);
  }
  bindBtn('◀', function () { if (state !== 'play') reset(); else keys.left = true; }, function () { keys.left = false; });
  bindBtn('▲', function () { if (state !== 'play') reset(); else keys.up = true; }, function () { keys.up = false; });
  bindBtn('射击', function () { if (state !== 'play') reset(); else keys.fire = true; }, function () { keys.fire = false; });
  bindBtn('▼', function () { if (state !== 'play') reset(); else keys.down = true; }, function () { keys.down = false; });
  bindBtn('▶', function () { if (state !== 'play') reset(); else keys.right = true; }, function () { keys.right = false; });

  requestAnimationFrame(frame);
})();
`;
}

export function renderSpaceShooter(spec: GameSpec): string {
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
        spreadShot: Boolean(spec.options.spreadShot),
        shield: Boolean(spec.options.shield),
      },
    },
  });
}
