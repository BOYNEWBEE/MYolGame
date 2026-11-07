// 我的收藏：收藏记录保存在服务端，绑定当前匿名会话令牌。

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { requestJson } from '../api.ts';
import { useSession } from '../session.tsx';
import GameCard from '../components/GameCard.tsx';
import type { GameSummary } from '../types.ts';

export default function Favorites(): ReactNode {
  const session = useSession();
  const [items, setItems] = useState<GameSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session.ready) return;
    try {
      const data = await requestJson<{ items: GameSummary[] }>('/favorites');
      setItems(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  }, [session.ready]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!session.ready) {
    return (
      <div className="page empty-state">
        <div className="spinner" />
        <p>会话初始化中…</p>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>我的收藏</h1>
        <p className="muted">
          收藏保存在服务端，与当前浏览器的匿名会话令牌绑定；换浏览器后不会跟随（原型身份限制）。
        </p>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}

      {!items ? (
        <div className="loading-grid">
          {Array.from({ length: 3 }, (_, i) => <div className="skeleton-card" key={i} />)}
        </div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <h2>还没有收藏</h2>
          <p>在社区里试玩喜欢的游戏，点击「♡ 收藏」即可加入这里。</p>
          <Link className="btn primary" to="/">去逛逛社区</Link>
        </div>
      ) : (
        <div className="game-grid">
          {items.map((game) => <GameCard key={game.id} game={game} />)}
        </div>
      )}
    </div>
  );
}
