// 页面背景层：只显示图片本身（无遮罩、无渐变），模糊程度可切换。
// sharp=true 时不模糊（欢迎页用），切回主页面时由 CSS 过渡到 blur。

import type { ReactNode } from 'react';
import { usePrefs } from '../prefs.ts';

export interface BackdropProps {
  /** 欢迎页期间保持清晰，进入主页面时再渐变为模糊 */
  sharp?: boolean;
}

export default function Backdrop({ sharp = false }: BackdropProps): ReactNode {
  const prefs = usePrefs();
  if (!prefs.backdrop) return null;
  return (
    <div className={'backdrop' + (sharp ? ' is-sharp' : '')} aria-hidden="true">
      <img className="backdrop-image" src={prefs.backdrop} alt="" decoding="async" />
    </div>
  );
}
