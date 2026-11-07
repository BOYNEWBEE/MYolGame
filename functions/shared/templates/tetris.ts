// 俄罗斯方块模板：固定游戏代码 + 由规格派生的配置。

import { gameShell } from '../html.ts';
import { getTheme, type GameSpec } from '../spec.ts';

function script(): string {
  return `
(function () {
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var W = canvas.width, H = canvas.height;
  var P = CFG.palette, D = CFG.difficulty, SP = CFG.speed, OP = CFG.options || {};
  var DIFF_NAME = { easy: '简单', normal: '普通', hard: '困难' }[D] || '普通';

  var COLS = 10, ROWS = 20, CELL = 26;
  var BX = 270, BY = 48;

  var TYPES = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];
  var SHAPES = {
    I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
    J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
    L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
    O: [[1, 1], [1, 1]],
    S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
    T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
    Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]]
  };
  var COLORS = [P.bricks[0], P.bricks[1], P.bricks[2], P.bricks[3], P.bricks[4], P.primary, P.secondary];
  var GRAVITY = { easy: 0.85, normal: 0.62, hard: 0.42 }[D] || 0.62;

  var board, piece, held, canHold, bag, nextQueue;
  var score = 0, lines = 0, level = 1, best = 0;
  var state = 'ready', dropTimer = 0, keys = {};

  function sfx(name) { if (GAME_AUDIO) GAME_AUDIO.playEffect(name); }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function emptyRow() {
    var row = [];
    for (var i = 0; i < COLS; i++) row.push('');
    return row;
  }

  function emptyBoard() {
    var rows = [];
    for (var i = 0; i < ROWS; i++) rows.push(emptyRow());
    return rows;
  }

  function colorOf(kind) { return COLORS[TYPES.indexOf(kind)]; }

  function refillBag() {
    bag = TYPES.slice();
    for (var i = bag.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = bag[i]; bag[i] = bag[j]; bag[j] = t;
    }
  }

  function nextKind() {
    if (!bag || bag.length === 0) refillBag();
    return bag.pop();
  }

  function valid(m, ox, oy) {
    for (var y = 0; y < m.length; y++) {
      for (var x = 0; x < m[y].length; x++) {
        if (!m[y][x]) continue;
        var bx = ox + x, by = oy + y;
        if (bx < 0 || bx >= COLS || by >= ROWS) return false;
        if (by >= 0 && board[by][bx]) return false;
      }
    }
    return true;
  }

  function spawn(kindArg) {
    var kind = kindArg || nextQueue.shift();
    if (!kindArg) nextQueue.push(nextKind());
    var shape = SHAPES[kind];
    var m = [];
    for (var i = 0; i < shape.length; i++) m.push(shape[i].slice());
    piece = { kind: kind, m: m, x: Math.floor((COLS - m[0].length) / 2), y: 0 };
    dropTimer = 0;
    if (!valid(piece.m, piece.x, piece.y)) {
      state = 'over';
      if (score > best) best = score;
    }
  }

  function clearLines() {
    var cleared = 0;
    for (var y = ROWS - 1; y >= 0; y--) {
      var full = true;
      for (var x = 0; x < COLS; x++) {
        if (!board[y][x]) { full = false; break; }
      }
      if (full) {
        board.splice(y, 1);
        board.unshift(emptyRow());
        cleared++;
        y++;
      }
    }
    return cleared;
  }

  function lockPiece() {
    var shape = piece.m, kind = piece.kind;
    for (var y = 0; y < shape.length; y++) {
      for (var x = 0; x < shape[y].length; x++) {
        if (!shape[y][x]) continue;
        var by = piece.y + y, bx = piece.x + x;
        if (by < 0) {
          state = 'over';
          if (score > best) best = score;
          return;
        }
        board[by][bx] = kind;
      }
    }
    sfx('crack');
    var cleared = clearLines();
    if (cleared > 0) {
      lines += cleared;
      level = Math.floor(lines / 10) + 1;
      score += [0, 100, 300, 500, 800][cleared] * level;
      sfx(cleared === 4 ? 'level' : 'brick');
    }
    canHold = true;
    spawn();
  }

  function reset() {
    board = emptyBoard();
    score = 0; lines = 0; level = 1;
    held = null; canHold = true;
    bag = [];
    nextQueue = [nextKind(), nextKind(), nextKind()];
    spawn();
    state = 'play';
  }

  function move(dx) {
    if (state !== 'play') return;
    if (valid(piece.m, piece.x + dx, piece.y)) piece.x += dx;
  }

  function softStep() {
    if (state !== 'play') return;
    if (valid(piece.m, piece.x, piece.y + 1)) {
      piece.y++;
      score += 1;
      dropTimer = 0;
    } else {
      lockPiece();
    }
  }

  function hardDrop() {
    if (state !== 'play') return;
    var d = 0;
    while (valid(piece.m, piece.x, piece.y + 1)) { piece.y++; d++; }
    score += d * 2;
    sfx('drop');
    lockPiece();
  }

  function rotateMatrix(m, dir) {
    var n = m.length, out = [];
    for (var y = 0; y < n; y++) {
      out.push([]);
      for (var x = 0; x < n; x++) {
        out[y].push(dir > 0 ? m[n - 1 - x][y] : m[x][n - 1 - y]);
      }
    }
    return out;
  }

  function tryRotate(dir) {
    if (state !== 'play') return;
    var m = rotateMatrix(piece.m, dir);
    var kicks = [0, -1, 1, -2, 2];
    for (var i = 0; i < kicks.length; i++) {
      if (valid(m, piece.x + kicks[i], piece.y)) {
        piece.m = m; piece.x += kicks[i];
        sfx('paddle');
        return;
      }
    }
    for (var j = 0; j < kicks.length; j++) {
      if (valid(m, piece.x + kicks[j], piece.y - 1)) {
        piece.m = m; piece.x += kicks[j]; piece.y -= 1;
        sfx('paddle');
        return;
      }
    }
  }

  function doHold() {
    if (!OP.holdPiece || !piece || state !== 'play' || !canHold) return;
    var current = piece.kind;
    if (held) {
      var swap = held;
      held = current;
      spawn(swap);
    } else {
      held = current;
      spawn();
    }
    canHold = false;
    sfx('paddle');
  }

  function ghostY() {
    var y = piece.y;
    while (valid(piece.m, piece.x, y + 1)) y++;
    return y;
  }

  function update(dt) {
    if (state !== 'play' || !piece) return;
    var interval = GRAVITY / SP * Math.pow(0.85, level - 1);
    dropTimer += dt * (keys.down ? 10 : 1);
    while (dropTimer >= interval) {
      dropTimer -= interval;
      if (valid(piece.m, piece.x, piece.y + 1)) {
        piece.y++;
      } else {
        lockPiece();
        break;
      }
    }
  }

  function drawCell(px, py, color) {
    ctx.fillStyle = color;
    roundRect(px + 2, py + 2, CELL - 4, CELL - 4, 5);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    roundRect(px + 4, py + 4, CELL - 8, Math.max(3, CELL * 0.22), 4);
    ctx.fill();
  }

  function drawMini(kind, boxX, boxY, boxSize) {
    var m = SHAPES[kind];
    var minX = 9, maxX = -1, minY = 9, maxY = -1;
    for (var y = 0; y < m.length; y++) {
      for (var x = 0; x < m[y].length; x++) {
        if (!m[y][x]) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    var w = maxX - minX + 1, h = maxY - minY + 1, cs = 18;
    var ox = boxX + (boxSize - w * cs) / 2;
    var oy = boxY + (boxSize - h * cs) / 2;
    ctx.fillStyle = colorOf(kind);
    for (var y2 = minY; y2 <= maxY; y2++) {
      for (var x2 = minX; x2 <= maxX; x2++) {
        if (!m[y2][x2]) continue;
        roundRect(ox + (x2 - minX) * cs + 2, oy + (y2 - minY) * cs + 2, cs - 4, cs - 4, 4);
        ctx.fill();
      }
    }
  }

  function label(text, x, y, color, size, align) {
    ctx.fillStyle = color || P.muted;
    ctx.font = (size || 13) + 'px sans-serif';
    ctx.textAlign = align || 'left';
    ctx.fillText(text, x, y);
  }

  function drawSidePanels() {
    label('得分', 40, 66);
    ctx.fillStyle = P.text; ctx.font = 'bold 28px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(String(score), 40, 96);

    label('最高', 40, 134);
    ctx.fillStyle = P.primary; ctx.font = 'bold 20px sans-serif';
    ctx.fillText(String(best), 40, 160);

    label('消行', 40, 198);
    ctx.fillStyle = P.text; ctx.font = 'bold 20px sans-serif';
    ctx.fillText(String(lines), 40, 224);

    label('等级', 40, 262);
    ctx.fillStyle = P.secondary; ctx.font = 'bold 20px sans-serif';
    ctx.fillText(String(level), 40, 288);

    if (OP.holdPiece) {
      label('暂存 (C)', 40, 330);
      ctx.strokeStyle = P.primary + '44';
      ctx.lineWidth = 1;
      roundRect(40, 344, 96, 96, 10);
      ctx.stroke();
      if (held) drawMini(held, 40, 344, 96);
    }

    label('下一个', 560, 66);
    for (var i = 0; i < 3; i++) {
      var by = 80 + i * 108;
      ctx.strokeStyle = P.primary + '33';
      ctx.lineWidth = 1;
      roundRect(560, by, 96, 96, 10);
      ctx.stroke();
      if (nextQueue[i]) drawMini(nextQueue[i], 560, by, 96);
    }

    label('操作', 560, 440);
    var hints = ['← → 移动', '↑ / Z 旋转', '↓ 软降', '空格 直落', 'P 暂停 · R 重开'];
    if (OP.holdPiece) hints.splice(3, 0, 'C 暂存');
    for (var j = 0; j < hints.length; j++) {
      label(hints[j], 560, 468 + j * 24);
    }

    label('难度 ' + DIFF_NAME + ' · 速度 ' + SP + '×', 40, 474);
  }

  function drawOverlay() {
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    if (state === 'ready') {
      ctx.fillStyle = P.text; ctx.font = 'bold 36px sans-serif';
      ctx.fillText(CFG.title, W / 2, H / 2 - 70);
      ctx.fillStyle = P.muted; ctx.font = '16px sans-serif';
      ctx.fillText('← → 移动 · ↑ / Z 旋转 · ↓ 软降', W / 2, H / 2 - 24);
      ctx.fillText('空格直落' + (OP.holdPiece ? ' · C 暂存' : ''), W / 2, H / 2 + 4);
      ctx.fillStyle = P.secondary; ctx.font = '18px sans-serif';
      ctx.fillText('点击或按空格开始', W / 2, H / 2 + 50);
      if (OP.ghostPiece) {
        ctx.fillStyle = P.accent; ctx.font = '14px sans-serif';
        ctx.fillText('已开启落点预览', W / 2, H / 2 + 82);
      }
    } else if (state === 'paused') {
      ctx.fillStyle = P.text; ctx.font = 'bold 32px sans-serif';
      ctx.fillText('已暂停', W / 2, H / 2);
      ctx.fillStyle = P.muted; ctx.font = '16px sans-serif';
      ctx.fillText('按 P 继续', W / 2, H / 2 + 34);
    } else {
      ctx.fillStyle = P.accent; ctx.font = 'bold 40px sans-serif';
      ctx.fillText('游戏结束', W / 2, H / 2 - 40);
      ctx.fillStyle = P.text; ctx.font = '20px sans-serif';
      ctx.fillText('得分 ' + score + ' · 消行 ' + lines + ' · 等级 ' + level, W / 2, H / 2 + 4);
      ctx.fillStyle = P.muted; ctx.font = '16px sans-serif';
      ctx.fillText('按 R 或点击重新开始', W / 2, H / 2 + 44);
    }
  }

  function draw() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, P.bg2); g.addColorStop(1, P.bg);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = P.panel;
    roundRect(BX - 8, BY - 8, COLS * CELL + 16, ROWS * CELL + 16, 12);
    ctx.fill();
    ctx.strokeStyle = P.primary + '44';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    for (var gx = 0; gx <= COLS; gx++) {
      ctx.beginPath();
      ctx.moveTo(BX + gx * CELL, BY);
      ctx.lineTo(BX + gx * CELL, BY + ROWS * CELL);
      ctx.stroke();
    }
    for (var gy = 0; gy <= ROWS; gy++) {
      ctx.beginPath();
      ctx.moveTo(BX, BY + gy * CELL);
      ctx.lineTo(BX + COLS * CELL, BY + gy * CELL);
      ctx.stroke();
    }

    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        if (board[r][c]) drawCell(BX + c * CELL, BY + r * CELL, colorOf(board[r][c]));
      }
    }

    if (piece && OP.ghostPiece && state === 'play') {
      var gy2 = ghostY();
      if (gy2 > piece.y) {
        for (var yy = 0; yy < piece.m.length; yy++) {
          for (var xx = 0; xx < piece.m[yy].length; xx++) {
            if (!piece.m[yy][xx]) continue;
            var px = BX + (piece.x + xx) * CELL;
            var py = BY + (gy2 + yy) * CELL;
            ctx.globalAlpha = 0.2;
            ctx.fillStyle = colorOf(piece.kind);
            roundRect(px + 2, py + 2, CELL - 4, CELL - 4, 5);
            ctx.fill();
            ctx.globalAlpha = 0.55;
            ctx.strokeStyle = colorOf(piece.kind);
            ctx.lineWidth = 1.5;
            roundRect(px + 2, py + 2, CELL - 4, CELL - 4, 5);
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
        }
      }
    }

    if (piece) {
      for (var py2 = 0; py2 < piece.m.length; py2++) {
        for (var px2 = 0; px2 < piece.m[py2].length; px2++) {
          if (!piece.m[py2][px2]) continue;
          var bx2 = piece.x + px2, by2 = piece.y + py2;
          if (by2 < 0) continue;
          drawCell(BX + bx2 * CELL, BY + by2 * CELL, colorOf(piece.kind));
        }
      }
    }

    drawSidePanels();
    if (state !== 'play') drawOverlay();
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
    if (e.target instanceof HTMLButtonElement && (k === ' ' || k === 'Enter')) return;
    if (k === 'r' || k === 'R') { reset(); return; }
    if (k === 'p' || k === 'P') {
      if (state === 'play') state = 'paused';
      else if (state === 'paused') state = 'play';
      return;
    }
    if (state === 'over') {
      if (k === ' ' || k === 'Enter') reset();
      return;
    }
    if (state === 'ready') {
      var startKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'd', 'w', 's', 'A', 'D', 'W', 'S'];
      if (k === ' ' || k === 'Enter') {
        e.preventDefault();
        reset();
        return;
      }
      if (startKeys.indexOf(k) >= 0) reset();
    }
    if (state !== 'play') return;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') { e.preventDefault(); move(-1); }
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') { e.preventDefault(); move(1); }
    else if (k === 'ArrowDown' || k === 's' || k === 'S') { e.preventDefault(); keys.down = true; }
    else if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === 'x' || k === 'X') { e.preventDefault(); tryRotate(1); }
    else if (k === 'z' || k === 'Z') { tryRotate(-1); }
    else if (k === ' ') { e.preventDefault(); hardDrop(); }
    else if (k === 'c' || k === 'C' || k === 'Shift') { doHold(); }
  });

  document.addEventListener('keyup', function (e) {
    if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') keys.down = false;
  });

  canvas.addEventListener('pointerdown', function () {
    if (state === 'ready' || state === 'over') reset();
    else if (state === 'paused') state = 'play';
  });

  var touch = document.getElementById('touch');
  function ensurePlay() {
    if (state === 'ready' || state === 'over') reset();
    else if (state === 'paused') state = 'play';
  }
  function bindBtn(text, fn) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.addEventListener('pointerdown', function (e) { e.preventDefault(); ensurePlay(); fn(); });
    touch.appendChild(b);
  }
  bindBtn('◀', function () { move(-1); });
  bindBtn('▶', function () { move(1); });
  bindBtn('▼', softStep);
  bindBtn('⟳', function () { tryRotate(1); });
  bindBtn('直落', hardDrop);
  if (OP.holdPiece) bindBtn('暂存', doHold);

  board = emptyBoard();
  bag = [];
  nextQueue = [nextKind(), nextKind(), nextKind()];
  spawn();
  requestAnimationFrame(frame);
})();
`;
}

export function renderTetris(spec: GameSpec): string {
  const palette = getTheme(spec.theme).palette;
  return gameShell({
    spec,
    gameScript: script(),
    soundEffects: true,
    config: {
      title: spec.title,
      palette,
      difficulty: spec.difficulty,
      speed: spec.speed,
      options: {
        ghostPiece: Boolean(spec.options.ghostPiece),
        holdPiece: Boolean(spec.options.holdPiece),
      },
    },
  });
}
