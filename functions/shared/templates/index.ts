// 模板引擎入口：按规格渲染完整独立 HTML。

import { renderBreakout } from './breakout.ts';
import { renderSnake } from './snake.ts';
import { renderSpaceShooter } from './space.ts';
import type { GameSpec } from '../spec.ts';

export function renderGame(spec: GameSpec): string {
  switch (spec.template) {
    case 'breakout':
      return renderBreakout(spec);
    case 'snake':
      return renderSnake(spec);
    case 'space-shooter':
      return renderSpaceShooter(spec);
    default:
      throw new Error('unknown_template');
  }
}

export { renderBreakout, renderSnake, renderSpaceShooter };
