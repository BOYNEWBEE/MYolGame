// 规格与生成方式徽标。

import type { ReactNode } from 'react';
import { DIFFICULTIES, TEMPLATES, THEMES, type GameSpec, type GenerationMode } from '@shared/spec.ts';

export function templateName(id: GameSpec['template']): string {
  return TEMPLATES.find((t) => t.id === id)?.name ?? id;
}

export function themeName(id: GameSpec['theme']): string {
  return THEMES.find((t) => t.id === id)?.name ?? id;
}

export function difficultyName(id: GameSpec['difficulty']): string {
  return DIFFICULTIES.find((d) => d.id === id)?.name ?? id;
}

export function SpecBadges({ spec }: { spec: GameSpec }): ReactNode {
  const options = TEMPLATES.find((t) => t.id === spec.template)?.options
    .filter((o) => spec.options[o.key])
    .map((o) => o.name) ?? [];
  return (
    <div className="badges">
      <span className="badge template">{templateName(spec.template)}</span>
      <span className="badge">{themeName(spec.theme)}</span>
      <span className="badge">{difficultyName(spec.difficulty)}</span>
      <span className="badge">{spec.speed}x 速度</span>
      {options.map((name) => (
        <span className="badge option" key={name}>{name}</span>
      ))}
    </div>
  );
}

// 诚实标记生成方式：模板生成（默认）或模型辅助（仍限模板白名单）
export function GenerationBadge({ mode }: { mode: GenerationMode }): ReactNode {
  return mode === 'model' ? (
    <span
      className="badge model"
      title="真实模型参与了规格调整，但结果仍被限制在内置模板与规格白名单内"
    >
      模型辅助生成
    </span>
  ) : (
    <span
      className="badge template-mode"
      title="由内置模板引擎按关键词规则生成，未调用任何 AI 模型"
    >
      模板生成
    </span>
  );
}
