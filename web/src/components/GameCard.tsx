// 社区游戏卡片。

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Cover from './Cover.tsx';
import { GenerationBadge, SpecBadges } from './Badges.tsx';
import type { GameSummary } from '../types.ts';

export default function GameCard({ game }: { game: GameSummary }): ReactNode {
  return (
    <article className="game-card">
      <Link to={'/games/' + game.id} className="cover-link" aria-label={'查看 ' + game.title}>
        <Cover spec={game.spec} className="cover" />
        <span className="play-hint" aria-hidden="true">试玩 →</span>
      </Link>
      <div className="card-body">
        <div className="card-title-row">
          <h3>
            <Link to={'/games/' + game.id}>{game.title}</Link>
          </h3>
          {game.favorited && <span className="fav-mark" title="已收藏">♥</span>}
        </div>
        <p className="card-author">
          {game.authorName}
          {game.official && <span className="official-tag">官方示例</span>}
        </p>
        <SpecBadges spec={game.spec} />
        <div className="card-footer">
          <span className="stat" title="游玩次数">▶ {game.plays}</span>
          <span className="stat" title="收藏数">♥ {game.favorites}</span>
          <GenerationBadge mode={game.generationMode} />
        </div>
      </div>
    </article>
  );
}
