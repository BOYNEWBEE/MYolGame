// 数字滚动：挂载后从 0 滚到目标值（值变化时也重播一次）。
// 只动文本内容，不碰所在玻璃容器，避免打断 backdrop-filter。

import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface CountUpProps {
  value: number;
  durationMs?: number;
}

export default function CountUp({ value, durationMs = 700 }: CountUpProps): ReactNode {
  const [shown, setShown] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(value);
      return;
    }
    const from = fromRef.current;
    const started = performance.now();
    let frame = 0;
    const tick = (now: number): void => {
      const progress = Math.min(1, (now - started) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = Math.round(from + (value - from) * eased);
      setShown(next);
      if (progress < 1) {
        frame = window.requestAnimationFrame(tick);
      } else {
        fromRef.current = value;
      }
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [value, durationMs]);

  return <span>{shown}</span>;
}