// 页面背景层：只显示图片本身，不叠遮罩、不叠渐变、不加滤镜。
// 图片走 public/backdrops 下的静态资源（与产物无关）；将来接本地图片时换成 objectURL 即可。

import type { ReactNode } from 'react';
import { usePrefs } from '../prefs.ts';

export default function Backdrop(): ReactNode {
  const prefs = usePrefs();
  if (!prefs.backdrop) return null;
  return (
    <div className="backdrop" aria-hidden="true">
      <img className="backdrop-image" src={prefs.backdrop} alt="" decoding="async" />
    </div>
  );
}
