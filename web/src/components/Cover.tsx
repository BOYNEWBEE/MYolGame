// 游戏封面：按玩法与主题配色自绘 SVG，无外部图片资源。

import type { ReactNode } from 'react';
import { getTheme, type GameSpec } from '@shared/spec.ts';

interface CoverProps {
  spec: GameSpec;
  className?: string;
}

function BreakoutArt({ p, neon }: { p: ReturnType<typeof getTheme>['palette']; neon: boolean }): ReactNode {
  const rows = [0, 1, 2].map((r) =>
    Array.from({ length: 7 }, (_, c) => (
      <rect
        key={r + '-' + c}
        x={36 + c * 36}
        y={40 + r * 20}
        width={32}
        height={14}
        rx={4}
        fill={p.bricks[(r + c) % p.bricks.length]!}
        opacity={0.9 - r * 0.15}
      />
    )),
  );
  return (
    <g>
      {neon && (
        <path
          d="M0 140h320M0 151h320M0 168h320M0 192h320M86 140L0 200M123 140l-43 60M160 140v60M197 140l43 60M234 140l86 60"
          fill="none"
          stroke={p.primary}
          strokeOpacity="0.2"
        />
      )}
      {rows}
      <circle cx="196" cy="128" r="7" fill={p.accent} />
      <circle cx="196" cy="128" r="12" fill={p.accent} opacity="0.25" />
      <path
        d="M196 128 L150 168"
        stroke={neon ? p.accent : p.muted}
        strokeWidth={neon ? '3' : '1.5'}
        strokeDasharray={neon ? undefined : '4 4'}
        opacity="0.6"
      />
      <rect x="118" y="168" width="70" height="10" rx="5" fill={p.primary} />
      {neon && <rect x="126" y="170" width="54" height="2" rx="1" fill={p.text} />}
    </g>
  );
}

function SnakeArt({ p }: { p: ReturnType<typeof getTheme>['palette'] }): ReactNode {
  const cells = [
    [4, 5], [5, 5], [6, 5], [7, 5], [7, 4], [7, 3], [6, 3], [5, 3],
  ];
  return (
    <g>
      {Array.from({ length: 5 }, (_, r) =>
        Array.from({ length: 9 }, (_, c) => (
          <circle
            key={r + '-' + c}
            cx={36 + c * 32}
            cy={36 + r * 28}
            r="1.5"
            fill={p.text}
            opacity="0.12"
          />
        )),
      )}
      {cells.map(([c, r], i) => (
        <rect
          key={i}
          x={26 + c * 32}
          y={26 + r * 28}
          width={20}
          height={20}
          rx={6}
          fill={i === 0 ? p.primary : p.secondary}
          opacity={1 - i * 0.08}
        />
      ))}
      <circle cx={282} cy={166} r="8" fill={p.accent} />
      <circle cx={282} cy={166} r="13" fill={p.accent} opacity="0.2" />
    </g>
  );
}

function SpaceArt({ p }: { p: ReturnType<typeof getTheme>['palette'] }): ReactNode {
  const stars = Array.from({ length: 26 }, (_, i) => ({
    x: (i * 97) % 300 + 10,
    y: (i * 53) % 180 + 8,
    r: (i % 3) * 0.5 + 0.8,
  }));
  return (
    <g>
      {stars.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.r} fill={p.text} opacity={0.35 + (i % 4) * 0.15} />
      ))}
      <g transform="translate(150,140)">
        <path d="M0 -26 L20 16 L7 10 L0 18 L-7 10 L-20 16 Z" fill={p.primary} />
        <circle cx="0" cy="-6" r="5" fill={p.secondary} />
        <rect x="-3" y="18" width="6" height="14" rx="3" fill={p.accent} opacity="0.8" />
      </g>
      <g transform="translate(80,52)">
        <path d="M0 14 L16 -12 L-16 -12 Z" fill={p.bricks[3 % p.bricks.length]!} />
      </g>
      <g transform="translate(228,64)">
        <path d="M0 14 L16 -12 L-16 -12 Z" fill={p.bricks[1 % p.bricks.length]!} />
      </g>
      <rect x="147" y="92" width="4" height="16" rx="2" fill={p.accent} />
      <rect x="135" y="100" width="4" height="12" rx="2" fill={p.accent} opacity="0.7" transform="rotate(-14 137 106)" />
      <rect x="160" y="100" width="4" height="12" rx="2" fill={p.accent} opacity="0.7" transform="rotate(14 162 106)" />
    </g>
  );
}

export default function Cover({ spec, className }: CoverProps): ReactNode {
  const theme = getTheme(spec.theme);
  const p = theme.palette;
  return (
    <svg
      className={className}
      viewBox="0 0 320 200"
      role="img"
      aria-label={spec.title + ' 封面（' + theme.name + '主题）'}
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id={'cv-' + spec.theme} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={p.bg2} />
          <stop offset="100%" stopColor={p.bg} />
        </linearGradient>
      </defs>
      <rect width="320" height="200" fill={'url(#cv-' + spec.theme + ')'} />
      {spec.template === 'breakout' && <BreakoutArt p={p} neon={spec.theme === 'neon'} />}
      {spec.template === 'snake' && <SnakeArt p={p} />}
      {spec.template === 'space-shooter' && <SpaceArt p={p} />}
      <rect width="320" height="200" fill="none" stroke={p.primary} strokeOpacity="0.15" />
    </svg>
  );
}
