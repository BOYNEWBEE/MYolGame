// 页面背景层：固定在最底层，只做装饰，不接收指针事件、不进无障碍树。
// 图片走 public/backdrops 下的静态资源（与产物无关）；将来接本地图片时换成 objectURL 即可。

import type { ReactNode } from 'react';
import { usePrefs } from '../prefs.ts';

export default function Backdrop(): ReactNode {
  const prefs = usePrefs();
  if (!prefs.backdrop) return null;
  return (
    <div className="backdrop" aria-hidden="true">
      <img className="backdrop-image" src={prefs.backdrop} alt="" decoding="async" />
      <div className="backdrop-aurora" />
      <div className="backdrop-scrim" />
    </div>
  );
}
