// 游戏详情页：在线试玩（沙箱 iframe）、收藏、下载与规格说明。

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { API_BASE, ApiError, requestJson } from '../api.ts';
import { useSession } from '../session.tsx';
import SandboxFrame from '../components/SandboxFrame.tsx';
import { GenerationBadge, SpecBadges, templateName } from '../components/Badges.tsx';
import type { GameSummary } from '../types.ts';
import { TEMPLATES } from '@shared/spec.ts';

export default function GameDetail(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const [game, setGame] = useState<GameSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await requestJson<{ game: GameSummary }>('/games/' + id, { auth: false });
      setGame(data.game);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleFavorite(): Promise<void> {
    if (!game || busy) return;
    setBusy(true);
    try {
      const result = await requestJson<{ favorited: boolean; favorites: number }>(
        '/games/' + game.id + '/favorite',
        { method: game.favorited ? 'DELETE' : 'PUT' },
      );
      setGame({ ...game, favorited: result.favorited, favorites: result.favorites });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('会话失效，请刷新页面后重试');
      } else {
        setError(err instanceof Error ? err.message : '操作失败');
      }
    } finally {
      setBusy(false);
    }
  }

  if (error && !game) {
    return (
      <div className="page empty-state">
        <h2>无法加载游戏</h2>
        <p>{error}</p>
        <Link className="btn primary" to="/">返回首页</Link>
      </div>
    );
  }
  if (!game) {
    return (
      <div className="page empty-state">
        <div className="spinner" />
        <p>加载中…</p>
      </div>
    );
  }

  const template = TEMPLATES.find((t) => t.id === game.spec.template);

  return (
    <div className="page game-detail">
      <div className="detail-head">
        <div>
          <div className="detail-title-row">
            <h1>{game.title}</h1>
            <GenerationBadge mode={game.generationMode} />
          </div>
          <p className="detail-author">
            作者：{game.authorName}
            {game.official && <span className="official-tag">官方示例</span>}
            <span className="muted"> · 发布于 {new Date(game.createdAt).toLocaleDateString('zh-CN')}</span>
          </p>
        </div>
        <div className="detail-actions">
          <button
            type="button"
            className={'btn' + (game.favorited ? ' fav active' : '')}
            onClick={() => void toggleFavorite()}
            disabled={busy || !session.ready}
            title={session.ready ? (game.favorited ? '取消收藏' : '收藏') : '会话初始化中'}
          >
            {game.favorited ? '♥ 已收藏' : '♡ 收藏'}
          </button>
          {game.allowDownload && (
            <a className="btn" href={API_BASE + '/games/' + game.id + '/download'} download>
              下载 HTML
            </a>
          )}
        </div>
      </div>

      <div className="detail-layout">
        <div className="detail-play">
          <SandboxFrame
            src={API_BASE + '/games/' + game.id + '/play'}
            title={game.title}
            reloadKey={reloadKey}
          />
          <p className="play-tip">
            操作：{template?.controls ?? '见游戏内说明'}。游戏在沙箱 iframe 中运行（独立源、禁止网络），
            如需重开一局可点「重新开始」。
            <button type="button" className="linklike" onClick={() => setReloadKey((k) => k + 1)}>
              重新加载画面
            </button>
          </p>
        </div>

        <aside className="detail-side">
          <section className="panel">
            <h2>游戏介绍</h2>
            <p className="description">{game.description}</p>
            <div className="stat-row">
              <span className="stat">▶ {game.plays} 次游玩</span>
              <span className="stat">♥ {game.favorites} 次收藏</span>
            </div>
          </section>
          <section className="panel">
            <h2>生成规格</h2>
            <SpecBadges spec={game.spec} />
            <dl className="spec-list">
              <dt>玩法模板</dt><dd>{templateName(game.spec.template)}</dd>
              <dt>速度倍率</dt><dd>{game.spec.speed}x</dd>
              <dt>生成方式</dt>
              <dd>{game.generationMode === 'model' ? '模型辅助（受限规格）' : '模板引擎（关键词规则）'}</dd>
            </dl>
            <p className="panel-note">
              该游戏由 MYolGame 模板引擎生成，为单文件 HTML5 游戏，下载后可独立托管游玩。
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
