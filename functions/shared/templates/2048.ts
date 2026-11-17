// 2048 模板：固定游戏代码 + 由规格派生的配置。

import { gameShell } from '../html.ts';
import { getTheme, type GameSpec } from '../spec.ts';

function script(): string {
  return `
(function () {
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var W = canvas.width, H = canvas.height;
  var P = CFG.palette, D = CFG.difficulty, SP = CFG.speed, OP = CFG.options || {};

  var GRID = OP.fiveGrid ? 5 : 4;
  var CELL = GRID === 5 ? 90 : 112;
  var GAP = GRID === 5 ? 12 : 14;
  var BOARD = GRID * CELL + (GRID + 1) * GAP;
  var BX = (W - BOARD) / 2;
  var BY = 50;
  var BASES = P.bricks.concat([P.primary, P.secondary, P.accent]);
  var POP = 0.18 / SP;

  var board, score = 0, best = 0, moves = 0;
  var state = 'ready', won = false;
  var popT = 1, mergedCells = [], spawnedCell = null;
  var undoState = null, canUndo = false;

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

  function label(text, x, y, color, size, align) {
    ctx.fillStyle = color || P.muted;
    ctx.font = (size || 13) + 'px sans-serif';
    ctx.textAlign = align || 'left';
    ctx.fillText(text, x, y);
  }

  function emptyBoard() {
    var rows = [];
    for (var r = 0; r < GRID; r++) {
      var row = [];
      for (var c = 0; c < GRID; c++) row.push(0);
      rows.push(row);
    }
    return rows;
  }

  function spawnTile() {
    var free = [];
    for (var r = 0; r < GRID; r++) {
      for (var c = 0; c < GRID; c++) {
        if (!board[r][c]) free.push([r, c]);
      }
    }
    if (free.length === 0) return null;
    var cell = free[Math.floor(Math.random() * free.length)];
    var fourChance = D === 'hard' ? 0.28 : D === 'easy' ? 0.06 : 0.12;
    board[cell[0]][cell[1]] = Math.random() < fourChance ? 2 : 1;
    return cell;
  }

  function freshBoard() {
    board = emptyBoard();
    score = 0; moves = 0; won = false;
    undoState = null; canUndo = false;
    mergedCells = []; spawnedCell = null; popT = 1;
    spawnTile();
    spawnTile();
  }

  function reset() {
    freshBoard();
    state = 'play';
  }

  function snapshotBoard() {
    var copy = [];
    for (var r = 0; r < GRID; r++) copy.push(board[r].slice());
    return { board: copy, score: score, moves: moves, won: won };
  }

  function slide(vals) {
    var compact = [];
    for (var i = 0; i < vals.length; i++) {
      if (vals[i]) compact.push(vals[i]);
    }
    var out = [], merged = [], gained = 0;
    var i2 = 0;
    while (i2 < compact.length) {
      if (i2 + 1 < compact.length && compact[i2] === compact[i2 + 1]) {
        var mergedExp = compact[i2] + 1;
        out.push(mergedExp);
        merged.push(out.length - 1);
        gained += Math.pow(2, mergedExp);
        i2 += 2;
      } else {
        out.push(compact[i2]);
        i2++;
      }
    }
    while (out.length < GRID) out.push(0);
    return { line: out, merged: merged, gained: gained };
  }

  function linesFor(dir) {
    var lines = [];
    for (var a = 0; a < GRID; a++) {
      var cells = [];
      for (var b = 0; b < GRID; b++) {
        if (dir === 'left') cells.push([a, b]);
        else if (dir === 'right') cells.push([a, GRID - 1 - b]);
        else if (dir === 'up') cells.push([b, a]);
        else cells.push([GRID - 1 - b, a]);
      }
      lines.push(cells);
    }
    return lines;
  }

  function hasMoves() {
    for (var r = 0; r < GRID; r++) {
      for (var c = 0; c < GRID; c++) {
        if (!board[r][c]) return true;
        if (c + 1 < GRID && board[r][c] === board[r][c + 1]) return true;
        if (r + 1 < GRID && board[r][c] === board[r + 1][c]) return true;
      }
    }
    return false;
  }

  function move(dir) {
    if (state === 'ready' || state === 'won') state = 'play';
    if (state !== 'play') return;
    var lines = linesFor(dir);
    var snapshot = snapshotBoard();
    var gained = 0, moved = false, merged = [];
    for (var i = 0; i < lines.length; i++) {
      var cells = lines[i];
      var vals = [];
      for (var j = 0; j < cells.length; j++) vals.push(board[cells[j][0]][cells[j][1]]);
      var result = slide(vals);
      gained += result.gained;
      for (var k = 0; k < cells.length; k++) {
        if (board[cells[k][0]][cells[k][1]] !== result.line[k]) moved = true;
        board[cells[k][0]][cells[k][1]] = result.line[k];
      }
      for (var m = 0; m < result.merged.length; m++) merged.push(cells[result.merged[m]]);
    }
    if (!moved) return;

    undoState = snapshot;
    canUndo = Boolean(OP.undoMove);
    moves++;
    score += gained;
    mergedCells = merged;
    spawnedCell = spawnTile();
    popT = 0;
    sfx(gained > 0 ? 'brick' : 'paddle');

    var top = 0;
    for (var r2 = 0; r2 < GRID; r2++) {
      for (var c2 = 0; c2 < GRID; c2++) {
        if (board[r2][c2] > top) top = board[r2][c2];
      }
    }
    if (!won && top >= 11) {
      won = true;
      state = 'won';
      sfx('level');
    } else if (!hasMoves()) {
      state = 'over';
      if (score > best) best = score;
    }
  }

  function undo() {
    if (!OP.undoMove || !canUndo || !undoState) return;
    board = undoState.board;
    score = undoState.score;
    moves = undoState.moves;
    won = undoState.won;
    undoState = null;
    canUndo = false;
    mergedCells = [];
    spawnedCell = null;
    popT = 1;
    state = 'play';
    sfx('paddle');
  }

  function tileRgb(exp) {
    var hex = BASES[(exp - 1) % BASES.length];
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    var t = Math.min(0.55, Math.max(0, (exp - 1) * 0.05));
    return [
      Math.round(r + (255 - r) * t),
      Math.round(g + (255 - g) * t),
      Math.round(b + (255 - b) * t)
    ];
  }

  function tileText(exp) {
    var c = tileRgb(exp);
    var lum = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
    return lum > 0.6 ? P.bg : P.text;
  }

  function isMerged(r, c) {
    for (var i = 0; i < mergedCells.length; i++) {
      if (mergedCells[i][0] === r && mergedCells[i][1] === c) return true;
    }
    return false;
  }

  function cellX(c) { return BX + GAP + c * (CELL + GAP); }
  function cellY(r) { return BY + GAP + r * (CELL + GAP); }

  function drawTile(r, c, exp) {
    var scale = 1;
    if (popT < POP) {
      var p = Math.min(1, popT / POP);
      if (isMerged(r, c)) scale = 1 + 0.16 * Math.sin(Math.PI * p);
      else if (spawnedCell && spawnedCell[0] === r && spawnedCell[1] === c) {
        scale = 0.82 + 0.18 * Math.min(1, p * 1.6);
      }
    }
    var size = CELL * scale;
    var ox = cellX(c) + (CELL - size) / 2;
    var oy = cellY(r) + (CELL - size) / 2;
    var rgb = tileRgb(exp);
    ctx.fillStyle = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
    roundRect(ox, oy, size, size, 10);
    ctx.fill();

    var value = Math.pow(2, exp);
    var text = String(value);
    var font = CELL * 0.42;
    if (text.length >= 5) font *= 0.48;
    else if (text.length === 4) font *= 0.62;
    else if (text.length === 3) font *= 0.8;
    ctx.fillStyle = tileText(exp);
    ctx.font = 'bold ' + Math.round(font * scale) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, ox + size / 2, oy + size / 2 + 2);
    ctx.textBaseline = 'alphabetic';
  }

  function drawOverlay() {
    ctx.fillStyle = 'rgba(0,0,0,0.64)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    if (state === 'ready') {
      ctx.fillStyle = P.text; ctx.font = 'bold 40px sans-serif';
      ctx.fillText(CFG.title, W / 2, H / 2 - 72);
      ctx.fillStyle = P.muted; ctx.font = '17px sans-serif';
      ctx.fillText('← ↑ ↓ → / WASD 或滑动移动方块', W / 2, H / 2 - 24);
      ctx.fillText('相同数字相撞即合并，目标是 2048', W / 2, H / 2 + 6);
      ctx.fillStyle = P.secondary; ctx.font = '18px sans-serif';
      ctx.fillText('点击或按空格开始', W / 2, H / 2 + 52);
    } else if (state === 'paused') {
      ctx.fillStyle = P.text; ctx.font = 'bold 32px sans-serif';
      ctx.fillText('已暂停', W / 2, H / 2);
      ctx.fillStyle = P.muted; ctx.font = '16px sans-serif';
      ctx.fillText('按 P 继续', W / 2, H / 2 + 34);
    } else if (state === 'won') {
      ctx.fillStyle = P.accent; ctx.font = 'bold 42px sans-serif';
      ctx.fillText('达成 2048！', W / 2, H / 2 - 40);
      ctx.fillStyle = P.text; ctx.font = '20px sans-serif';
      ctx.fillText('得分 ' + score + ' · 步数 ' + moves, W / 2, H / 2 + 4);
      ctx.fillStyle = P.muted; ctx.font = '16px sans-serif';
      ctx.fillText('按空格继续挑战，按 R 重新开始', W / 2, H / 2 + 44);
    } else {
      ctx.fillStyle = P.accent; ctx.font = 'bold 40px sans-serif';
      ctx.fillText('无路可走', W / 2, H / 2 - 40);
      ctx.fillStyle = P.text; ctx.font = '20px sans-serif';
      ctx.fillText('得分 ' + score + ' · 步数 ' + moves, W / 2, H / 2 + 4);
      ctx.fillStyle = P.muted; ctx.font = '16px sans-serif';
      ctx.fillText('按 R 或点击重新开始', W / 2, H / 2 + 44);
    }
  }

  function draw() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, P.bg2); g.addColorStop(1, P.bg);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = P.text; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('得分 ' + score, BX, 28);
    ctx.textAlign = 'center';
    ctx.fillStyle = P.muted;
    ctx.fillText('步数 ' + moves, W / 2, 28);
    ctx.textAlign = 'right';
    ctx.fillStyle = P.primary;
    ctx.fillText('最高 ' + best, BX + BOARD, 28);

    ctx.fillStyle = P.panel;
    roundRect(BX - 8, BY - 8, BOARD + 16, BOARD + 16, 14);
    ctx.fill();
    ctx.strokeStyle = P.primary + '33';
    ctx.lineWidth = 1;
    ctx.stroke();

    for (var r = 0; r < GRID; r++) {
      for (var c = 0; c < GRID; c++) {
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        roundRect(cellX(c), cellY(r), CELL, CELL, 10);
        ctx.fill();
      }
    }

    for (var r2 = 0; r2 < GRID; r2++) {
      for (var c2 = 0; c2 < GRID; c2++) {
        if (board[r2][c2]) drawTile(r2, c2, board[r2][c2]);
      }
    }

    var hint = OP.undoMove
      ? '← ↑ ↓ → / WASD 移动 · U 撤销 · R 重新开始'
      : '← ↑ ↓ → / WASD 移动 · R 重新开始';
    label(hint, W / 2, H - 12, P.muted, 12, 'center');

    if (state !== 'play') drawOverlay();
  }

  var last = 0;
  function frame(t) {
    var dt = Math.min(0.05, (t - last) / 1000 || 0.016);
    last = t;
    if (popT < POP) popT = Math.min(POP, popT + dt);
    draw();
    requestAnimationFrame(frame);
  }

  document.addEventListener('keydown', function (e) {
    var k = e.key;
    if (e.target instanceof HTMLButtonElement && (k === ' ' || k === 'Enter')) return;
    if (k === 'r' || k === 'R') { reset(); return; }
    if (k === 'u' || k === 'U') { undo(); return; }
    if (k === 'p' || k === 'P') {
      if (state === 'play') state = 'paused';
      else if (state === 'paused') state = 'play';
      return;
    }
    if (state === 'over') {
      if (k === ' ' || k === 'Enter') reset();
      return;
    }
    if (k === ' ') {
      e.preventDefault();
      if (state === 'ready' || state === 'won' || state === 'paused') state = 'play';
      return;
    }
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') { e.preventDefault(); move('left'); }
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') { e.preventDefault(); move('right'); }
    else if (k === 'ArrowUp' || k === 'w' || k === 'W') { e.preventDefault(); move('up'); }
    else if (k === 'ArrowDown' || k === 's' || k === 'S') { e.preventDefault(); move('down'); }
  });

  var touchStart = null;
  canvas.addEventListener('pointerdown', function (e) {
    touchStart = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointerup', function (e) {
    if (!touchStart) return;
    var dx = e.clientX - touchStart.x, dy = e.clientY - touchStart.y;
    touchStart = null;
    if (state === 'ready') state = 'play';
    if (Math.abs(dx) < 24 && Math.abs(dy) < 24) {
      if (state === 'over') reset();
      else if (state === 'won' || state === 'paused') state = 'play';
      return;
    }
    if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 'right' : 'left');
    else move(dy > 0 ? 'down' : 'up');
  });

  var touch = document.getElementById('touch');
  function ensurePlay() {
    if (state === 'ready') state = 'play';
    else if (state === 'over') reset();
    else if (state === 'won' || state === 'paused') state = 'play';
  }
  function bindBtn(text, fn) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.addEventListener('pointerdown', function (e) { e.preventDefault(); ensurePlay(); fn(); });
    touch.appendChild(b);
  }
  bindBtn('◀', function () { move('left'); });
  bindBtn('▲', function () { move('up'); });
  bindBtn('▼', function () { move('down'); });
  bindBtn('▶', function () { move('right'); });
  if (OP.undoMove) bindBtn('撤销', undo);

  freshBoard();
  requestAnimationFrame(frame);
})();
`;
}

export function renderGame2048(spec: GameSpec, musicTrack?: string): string {
  const palette = getTheme(spec.theme).palette;
  return gameShell({
    spec,
    gameScript: script(),
    soundEffects: true,
    musicTrack,
    config: {
      title: spec.title,
      palette,
      difficulty: spec.difficulty,
      speed: spec.speed,
      options: {
        undoMove: Boolean(spec.options.undoMove),
        fiveGrid: Boolean(spec.options.fiveGrid),
      },
    },
  });
}
