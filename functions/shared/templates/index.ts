// 模板引擎入口：按规格渲染完整独立 HTML。

import { renderBreakout } from './breakout.ts';
import { renderSnake } from './snake.ts';
import { renderSpaceShooter } from './space.ts';
import { renderTetris } from './tetris.ts';
import { renderGame2048 } from './2048.ts';
import type { GameSpec } from '../spec.ts';

export function renderGame(spec: GameSpec, musicTrack?: string): string {
  switch (spec.template) {
    case 'breakout':
      return renderBreakout(spec, musicTrack);
    case 'snake':
      return renderSnake(spec, musicTrack);
    case 'space-shooter':
      return renderSpaceShooter(spec, musicTrack);
    case 'tetris':
      return renderTetris(spec, musicTrack);
    case '2048':
      return renderGame2048(spec, musicTrack);
    default:
      throw new Error('unknown_template');
  }
}

export { renderBreakout, renderSnake, renderSpaceShooter, renderTetris, renderGame2048 };
