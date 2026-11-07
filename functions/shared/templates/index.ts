// 模板引擎入口：按规格渲染完整独立 HTML。

import { renderBreakout } from './breakout.ts';
import { renderSnake } from './snake.ts';
import { renderSpaceShooter } from './space.ts';
import { renderTetris } from './tetris.ts';
import { renderGame2048 } from './2048.ts';
import type { GameSpec } from '../spec.ts';

export function renderGame(spec: GameSpec): string {
  switch (spec.template) {
    case 'breakout':
      return renderBreakout(spec);
    case 'snake':
      return renderSnake(spec);
    case 'space-shooter':
      return renderSpaceShooter(spec);
    case 'tetris':
      return renderTetris(spec);
    case '2048':
      return renderGame2048(spec);
    default:
      throw new Error('unknown_template');
  }
}

export { renderBreakout, renderSnake, renderSpaceShooter, renderTetris, renderGame2048 };
