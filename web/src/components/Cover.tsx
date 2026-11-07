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

function TetrisArt({ p }: { p: ReturnType<typeof getTheme>['palette'] }): ReactNode {
  const cols = 6;
  const rows = 7;
  const cell = 22;
  const ox = 94;
  const oy = 22;
  const stack = [
    [0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
    [0, 0, 1, 0, 0, 0],
    [0, 1, 1, 1, 0, 0],
    [2, 2, 3, 3, 0, 4],
    [5, 5, 2, 3, 4, 4],
  ];
  const falling: [number, number][] = [[2, 1], [1, 2], [2, 2], [3, 2]];
  return (
    <g>
      <rect x={ox - 5} y={oy - 5} width={cols * cell + 10} height={rows * cell + 10} rx={8} fill={p.panel} />
      {Array.from({ length: cols + 1 }, (_, i) => (
        <line
          key={'v' + i}
          x1={ox + i * cell}
          y1={oy}
          x2={ox + i * cell}
          y2={oy + rows * cell}
          stroke={p.text}
          strokeOpacity="0.07"
        />
      ))}
      {Array.from({ length: rows + 1 }, (_, i) => (
        <line
          key={'h' + i}
          x1={ox}
          y1={oy + i * cell}
          x2={ox + cols * cell}
          y2={oy + i * cell}
          stroke={p.text}
          strokeOpacity="0.07"
        />
      ))}
      {stack.map((row, r) =>
        row.map((v, c) =>
          v === 0 ? null : (
            <rect
              key={r + '-' + c}
              x={ox + c * cell + 2}
              y={oy + r * cell + 2}
              width={cell - 4}
              height={cell - 4}
              rx={4}
              fill={p.bricks[(v - 1) % p.bricks.length]!}
              opacity={0.92}
            />
          ),
        ),
      )}
      {falling.map(([c, r], i) => (
        <rect
          key={'fall-' + i}
          x={ox + c * cell + 2}
          y={oy + r * cell + 2}
          width={cell - 4}
          height={cell - 4}
          rx={4}
          fill={p.accent}
        />
      ))}
      <rect x="244" y="40" width="52" height="52" rx="8" fill={p.panel} />
      <rect x="256" y="52" width="28" height="28" rx="5" fill={p.primary} />
      <rect x="244" y="112" width="52" height="52" rx="8" fill={p.panel} />
      <rect x="258" y="124" width="8" height="8" rx="2" fill={p.secondary} />
      <rect x="258" y="134" width="8" height="8" rx="2" fill={p.secondary} />
      <rect x="268" y="134" width="8" height="8" rx="2" fill={p.secondary} />
      <rect x="274" y="124" width="8" height="8" rx="2" fill={p.secondary} />
    </g>
  );
}

function Game2048Art({ p }: { p: ReturnType<typeof getTheme>['palette'] }): ReactNode {
  const values = [
    [2, 0, 0, 4],
    [0, 8, 0, 0],
    [0, 16, 32, 0],
    [0, 0, 64, 2048],
  ];
  const cell = 36;
  const gap = 8;
  const ox = 68;
  const oy = 8;
  const colors = [...p.bricks, p.primary, p.secondary, p.accent];
  return (
    <g>
      <rect x={ox - gap} y={oy - gap} width={4 * cell + 5 * gap} height={4 * cell + 5 * gap} rx={10} fill={p.panel} />
      {values.map((row, r) =>
        row.map((v, c) => {
          const x = ox + c * (cell + gap);
          const y = oy + r * (cell + gap);
          if (!v) {
            return (
              <rect
                key={r + '-' + c}
                x={x}
                y={y}
                width={cell}
                height={cell}
                rx={6}
                fill={p.text}
                fillOpacity="0.06"
              />
            );
          }
          const exp = Math.log2(v);
          const fill = v === 2048 ? p.accent : colors[(exp - 1) % colors.length]!;
          return (
            <g key={r + '-' + c}>
              <rect x={x} y={y} width={cell} height={cell} rx={6} fill={fill} opacity="0.92" />
              <text
                x={x + cell / 2}
                y={y + cell / 2 + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={v >= 1000 ? 10 : v >= 100 ? 13 : 16}
                fontWeight="700"
                fill={p.bg}
              >
                {v}
              </text>
            </g>
          );
        }),
      )}
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
      {spec.template === 'tetris' && <TetrisArt p={p} />}
      {spec.template === '2048' && <Game2048Art p={p} />}
      <rect width="320" height="200" fill="none" stroke={p.primary} strokeOpacity="0.15" />
    </svg>
  );
}
