// 给每块玻璃算好“它应该显示 --backdrop-soft 的哪一块”。
// 不用 background-attachment: fixed（在 isolation / transform 祖先里会失效），
// 而是用 getBoundingClientRect 把每个元素的视口坐标写进 --gx/--gy，配合 --gw/--gh 做 cover 对齐。

const GLASS_SELECTOR = [
  '.nav',
  '.nav-user',
  '.nav-backdrop',
  '.btn',
  '.chip',
  '.segmented',
  '.search-input',
  '.hero-text',
  '.game-card',
  '.panel',
  '.creation-template-card',
  '.page-head',
  '.footer-inner',
  '.empty-state',
  '.mode-banner',
].join(',');

let frame = 0;
let imageWidth = 0;
let imageHeight = 0;

function measureImage(): boolean {
  const img = document.querySelector<HTMLImageElement>('.backdrop-image');
  if (!img || !img.naturalWidth) return false;
  imageWidth = img.naturalWidth;
  imageHeight = img.naturalHeight;
  return true;
}

function paint(): void {
  frame = 0;
  if (!imageWidth && !measureImage()) return;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  // 背景图在 .backdrop 里是 object-fit: cover，这里按同样的算法还原
  const scale = Math.max(viewportWidth / imageWidth, viewportHeight / imageHeight);
  const coverWidth = imageWidth * scale;
  const coverHeight = imageHeight * scale;
  const offsetX = (viewportWidth - coverWidth) / 2;
  const offsetY = (viewportHeight - coverHeight) / 2;

  for (const element of document.querySelectorAll<HTMLElement>(GLASS_SELECTOR)) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    element.style.setProperty('--gw', coverWidth.toFixed(1) + 'px');
    element.style.setProperty('--gh', coverHeight.toFixed(1) + 'px');
    element.style.setProperty('--gx', (offsetX - rect.left).toFixed(1) + 'px');
    element.style.setProperty('--gy', (offsetY - rect.top).toFixed(1) + 'px');
  }
}

function schedule(): void {
  if (frame) return;
  frame = window.requestAnimationFrame(paint);
}

let started = false;

export function startGlassLayer(): void {
  if (started) return;
  started = true;
  schedule();
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  window.addEventListener('load', schedule);
  // 路由切换、列表加载、图片换背景都会改动 DOM
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  // 兜底：图片解码完成、字体回流等不触发上面事件的情况
  const timer = window.setInterval(() => {
    if (document.visibilityState === 'visible') schedule();
  }, 1200);
  window.addEventListener('pagehide', () => window.clearInterval(timer));
}