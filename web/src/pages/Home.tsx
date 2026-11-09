// 社区首页：搜索、分类、排序与公开游戏列表。

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { requestJson } from '../api.ts';
import { useMeta } from '../meta.ts';
import GameCard from '../components/GameCard.tsx';
import type { GameSummary } from '../types.ts';
import { TEMPLATES, type TemplateId } from '@shared/spec.ts';

const PAGE_SIZE = 12;

export default function Home(): ReactNode {
  const { meta } = useMeta();
  const [category, setCategory] = useState<TemplateId | 'all'>('all');
  const [sort, setSort] = useState<'new' | 'hot'>('new');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<GameSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (offset: number, replace: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          sort,
          limit: String(PAGE_SIZE),
          offset: String(offset),
        });
        if (category !== 'all') params.set('category', category);
        if (search) params.set('q', search);
        const data = await requestJson<{ items: GameSummary[]; total: number }>(
          '/games?' + params.toString(),
          { auth: false },
        );
        setItems((prev) => (replace ? data.items : [...prev, ...data.items]));
        setTotal(data.total);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败');
      } finally {
        setLoading(false);
      }
    },
    [category, sort, search],
  );

  useEffect(() => {
    void load(0, true);
  }, [load]);

  // 输入防抖后触发搜索
  useEffect(() => {
    const timer = setTimeout(() => setSearch(q.trim()), 350);
    return () => clearTimeout(timer);
  }, [q]);

  return (
    <div className="page home-page">
      <section className="hero">
        <div className="hero-text">
          <h1>
            一句话，做出<em>能玩</em>的网页小游戏
          </h1>
          <p>
            输入中文提示词选择玩法、主题、速度与难度，立即生成可试玩的 Canvas 游戏；
            在工作台持续修改、回退版本，满意后发布到社区或下载独立 HTML。
          </p>
          <div className="hero-actions">
            <Link to="/create" className="btn primary large">开始创作</Link>
            <a href="#games" className="btn large">浏览社区作品</a>
          </div>
          <p className="hero-notice">
            {meta?.generationMode === 'agent'
              ? '当前已启用 Agent 源码开发：根据需求修改游戏，浏览器检查通过后保存版本，请试玩确认玩法。'
              : meta?.generationMode === 'model'
              ? '当前已配置真实模型（' + (meta.model.name ?? '自定义') + '），模型仅可调整受限规格，仍基于内置模板生成。'
              : '当前为模板模式：初版由内置模板引擎（打砖块 / 贪吃蛇 / 太空射击 / 俄罗斯方块 / 2048）按关键词规则确定性生成，未接入任意 AI。'}
          </p>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit orbit-1" />
          <div className="orbit orbit-2" />
          <div className="orbit orbit-3" />
          <div className="hero-canvas">
            <span className="brick" /><span className="brick" /><span className="brick" />
            <span className="brick" /><span className="brick" /><span className="brick" />
            <i className="ball" />
            <u className="paddle" />
          </div>
        </div>
      </section>

      <section className="browse" id="games">
        <div className="browse-bar">
          <div className="chips" role="tablist" aria-label="玩法分类">
            <button
              type="button"
              role="tab"
              aria-selected={category === 'all'}
              className={'chip' + (category === 'all' ? ' active' : '')}
              onClick={() => setCategory('all')}
            >
              全部
            </button>
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={category === t.id}
                className={'chip' + (category === t.id ? ' active' : '')}
                onClick={() => setCategory(t.id)}
              >
                {t.name}
              </button>
            ))}
          </div>
          <div className="browse-right">
            <input
              type="search"
              className="search-input"
              placeholder="搜索游戏名称、介绍或作者…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="搜索社区游戏"
            />
            <div className="segmented" role="group" aria-label="排序">
              <button
                type="button"
                className={sort === 'new' ? 'active' : ''}
                onClick={() => setSort('new')}
              >
                最新
              </button>
              <button
                type="button"
                className={sort === 'hot' ? 'active' : ''}
                onClick={() => setSort('hot')}
              >
                最热
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="error-banner" role="alert">
            {error}（请确认本地 API 服务已启动）
          </div>
        )}

        {loading && items.length === 0 ? (
          <div className="loading-grid" aria-label="加载中">
            {Array.from({ length: 6 }, (_, i) => <div className="skeleton-card" key={i} />)}
          </div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            <h2>还没有匹配的作品</h2>
            <p>换个关键词，或成为第一个创作者。</p>
            <Link className="btn primary" to="/create">去创作游戏</Link>
          </div>
        ) : (
          <>
            <div className="game-grid">
              {items.map((game) => <GameCard key={game.id} game={game} />)}
            </div>
            {items.length < total && (
              <div className="load-more">
                <button
                  type="button"
                  className="btn"
                  disabled={loading}
                  onClick={() => void load(items.length, false)}
                >
                  {loading ? '加载中…' : '加载更多（剩余 ' + (total - items.length) + ' 个）'}
                </button>
              </div>
            )}
          </>
        )}
        <p className="browse-footnote">
          社区公开游戏保存在服务端，任何浏览器均可访问；游玩数据实时统计。所有作品当前均为模板生成。
        </p>
      </section>
    </div>
  );
}
