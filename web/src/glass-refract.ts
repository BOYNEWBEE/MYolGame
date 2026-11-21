// 苹果式液态玻璃折射（SDF 位移贴图 + feDisplacementMap）
// 算法移植自 xiaofangstudio/liquid-glass-web（MIT），原版为 shuding/liquid-glass。
// 做法：按元素尺寸生成一张位移贴图 → 塞进 <feImage> → feDisplacementMap 弯折 backdrop。

interface MapCacheEntry {
  url: string;
  scale: number;
}

const cache = new Map<string, MapCacheEntry>();
let svgRoot: SVGSVGElement | null = null;
let defs: SVGDefsElement | null = null;
let seq = 0;

function smoothStep(a: number, b: number, t: number): number {
  const x = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
}

function length(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

/** 内缩圆角矩形 SDF：中心平坦、靠近边缘迅速变大 */
function roundedRectSDF(x: number, y: number, width: number, height: number, radius: number): number {
  const qx = Math.abs(x) - width + radius;
  const qy = Math.abs(y) - height + radius;
  return Math.min(Math.max(qx, qy), 0) + length(Math.max(qx, 0), Math.max(qy, 0)) - radius;
}

function ensureDefs(): SVGDefsElement {
  if (defs) return defs;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'glass-refract-defs');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;pointer-events:none;';
  const d = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  svg.appendChild(d);
  document.body.appendChild(svg);
  svgRoot = svg;
  defs = d;
  return d;
}

function buildFilter(id: string, width: number, height: number, scale: number, mapUrl: string, offsetX: number, offsetY: number): void {
  const root = ensureDefs();
  const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
  filter.setAttribute('id', id);
  filter.setAttribute('filterUnits', 'userSpaceOnUse');
  filter.setAttribute('colorInterpolationFilters', 'sRGB');
  filter.setAttribute('x', String(offsetX));
  filter.setAttribute('y', String(offsetY));
  filter.setAttribute('width', String(width));
  filter.setAttribute('height', String(height));

  const image = document.createElementNS('http://www.w3.org/2000/svg', 'feImage');
  image.setAttribute('href', mapUrl);
  image.setAttribute('x', String(offsetX));
  image.setAttribute('y', String(offsetY));
  image.setAttribute('width', String(width));
  image.setAttribute('height', String(height));
  image.setAttribute('preserveAspectRatio', 'none');

  image.setAttribute('result', id + '-map');

  // 三个通道用略微不同的位移量 → 边缘出现色散（红/蓝分开）
  const makeDisplace = (suffix: string, inValue: string, scaleValue: number, result: string): SVGFEDisplacementMapElement => {
    const d = document.createElementNS('http://www.w3.org/2000/svg', 'feDisplacementMap');
    d.setAttribute('in', inValue);
    d.setAttribute('in2', id + '-map');
    d.setAttribute('xChannelSelector', 'R');
    d.setAttribute('yChannelSelector', 'G');
    d.setAttribute('scale', scaleValue.toFixed(3));
    d.setAttribute('result', result);
    d.setAttribute('data-channel', suffix);
    return d;
  };

  const base = makeDisplace('base', 'SourceGraphic', scale, id + '-base');
  const red = makeDisplace('r', 'SourceGraphic', scale * 1.22, id + '-red');
  const blue = makeDisplace('b', 'SourceGraphic', scale * 0.78, id + '-blue');

  const redOnly = document.createElementNS('http://www.w3.org/2000/svg', 'feColorMatrix');
  redOnly.setAttribute('in', id + '-red');
  redOnly.setAttribute('type', 'matrix');
  redOnly.setAttribute('values', '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0');
  redOnly.setAttribute('result', id + '-redCh');

  const blueOnly = document.createElementNS('http://www.w3.org/2000/svg', 'feColorMatrix');
  blueOnly.setAttribute('in', id + '-blue');
  blueOnly.setAttribute('type', 'matrix');
  blueOnly.setAttribute('values', '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0');
  blueOnly.setAttribute('result', id + '-blueCh');

  const blend1 = document.createElementNS('http://www.w3.org/2000/svg', 'feBlend');
  blend1.setAttribute('in', id + '-base');
  blend1.setAttribute('in2', id + '-redCh');
  blend1.setAttribute('mode', 'screen');
  blend1.setAttribute('result', id + '-blend1');

  const blend2 = document.createElementNS('http://www.w3.org/2000/svg', 'feBlend');
  blend2.setAttribute('in', id + '-blend1');
  blend2.setAttribute('in2', id + '-blueCh');
  blend2.setAttribute('mode', 'screen');

  filter.appendChild(image);
  filter.appendChild(base);
  filter.appendChild(red);
  filter.appendChild(blue);
  filter.appendChild(redOnly);
  filter.appendChild(blueOnly);
  filter.appendChild(blend1);
  filter.appendChild(blend2);
  root.appendChild(filter);
}

/** 生成（或复用）指定尺寸的折射滤镜，返回可用作 backdrop-filter 的 url(#id) */
export function getRefractFilter(width: number, height: number, strength = 1, offsetX = 0, offsetY = 0): string {
  const w = Math.max(8, Math.round(width));
  const h = Math.max(8, Math.round(height));
  const key = `${w}x${h}x${strength.toFixed(2)}@${Math.round(offsetX)},${Math.round(offsetY)}`;
  const cached = cache.get(key);
  if (cached) return `url(#${cached.url})`;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return '';

  const imageData = ctx.createImageData(w, h);
  const data = imageData.data;
  const raw = new Float32Array(w * h * 2);
  let maxScale = 0;

  // 内缩比例：0.3 / 0.2 是原版取值，中心平坦、边缘一圈强烈弯曲
  const insetW = 0.3 * strength;
  const insetH = 0.2 * strength;
  const radius = 0.6;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ux = x / (w - 1);
      const uy = y / (h - 1);
      const ix = ux - 0.5;
      const iy = uy - 0.5;
      const distanceToEdge = roundedRectSDF(ix, iy, insetW, insetH, radius);
      const displacement = smoothStep(0.8, 0, distanceToEdge - 0.15);
      const scaled = smoothStep(0, 1, displacement);
      const fx = ix * scaled + 0.5;
      const fy = iy * scaled + 0.5;
      const dx = fx - ux;
      const dy = fy - uy;
      const index = (y * w + x) * 2;
      raw[index] = dx;
      raw[index + 1] = dy;
      maxScale = Math.max(maxScale, Math.abs(dx), Math.abs(dy));
    }
  }

  maxScale *= 0.5; // 原版折半，勿删
  if (!maxScale) return '';

  for (let i = 0; i < w * h; i++) {
    data[i * 4] = Math.round((raw[i * 2] / maxScale + 0.5) * 255);
    data[i * 4 + 1] = Math.round((raw[i * 2 + 1] / maxScale + 0.5) * 255);
    data[i * 4 + 2] = 128;
    data[i * 4 + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);

  // 尺寸缓存上限，避免拖窗口时无限增长
  if (cache.size > 32) {
    for (const [oldKey, entry] of cache) {
      document.getElementById(entry.url)?.remove();
      cache.delete(oldKey);
      if (cache.size <= 16) break;
    }
  }

  const url = 'glass-refract-' + ++seq;
  buildFilter(url, w, h, maxScale, canvas.toDataURL('image/png'), offsetX, offsetY);
  cache.set(key, { url, scale: maxScale });
  return `url(#${url})`;
}

export function destroyRefractFilters(): void {
  if (svgRoot?.parentElement) svgRoot.parentElement.removeChild(svgRoot);
  svgRoot = null;
  defs = null;
  cache.clear();
}