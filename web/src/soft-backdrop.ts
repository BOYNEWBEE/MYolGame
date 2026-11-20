// 把背景图缩小 + 模糊一次，生成 data URL 写进 --backdrop-soft。
// 玻璃元素用这个图层当“背板”，因此不需要 backdrop-filter（也就不存在首帧采不到背景的问题）。

const CACHE_MAX_WIDTH = 1280;

let pendingTimer: number | null = null;
let lastKey = '';

export interface SoftBackdropOptions {
  src: string | null;
  blur: number;
  saturate: number;
  brightness: number;
}

async function render(options: SoftBackdropOptions): Promise<void> {
  const root = document.documentElement;
  if (!options.src) {
    root.style.removeProperty('--backdrop-soft');
    return;
  }

  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = options.src;
  try {
    await image.decode();
  } catch {
    root.style.removeProperty('--backdrop-soft');
    return;
  }
  if (!image.naturalWidth) return;

  const scale = Math.min(1, CACHE_MAX_WIDTH / image.naturalWidth);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // 先铺一层不模糊的底，模糊放大时不至于露出透明边
  ctx.drawImage(image, 0, 0, width, height);
  const pad = Math.max(2, options.blur * scale);
  ctx.save();
  ctx.filter =
    'blur(' + Math.max(0.5, options.blur * scale).toFixed(2) + 'px) saturate(' +
    options.saturate + '%) brightness(' + options.brightness + ')';
  ctx.drawImage(image, -pad, -pad, width + pad * 2, height + pad * 2);
  ctx.restore();

  root.style.setProperty('--backdrop-soft', 'url("' + canvas.toDataURL('image/jpeg', 0.86) + '")');
}

export function scheduleSoftBackdrop(options: SoftBackdropOptions): void {
  const key = [options.src ?? '', options.blur, options.saturate, options.brightness].join('|');
  if (key === lastKey) return;
  const first = !lastKey;
  lastKey = key;
  if (pendingTimer !== null) window.clearTimeout(pendingTimer);
  pendingTimer = window.setTimeout(() => {
    pendingTimer = null;
    void render(options);
  }, first ? 0 : 120);
}