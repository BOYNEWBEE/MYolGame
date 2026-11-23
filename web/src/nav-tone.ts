// 根据导航背后的实际亮度，自动选择顶部文字用浅色还是深色。
// 采样的是背景图顶部那一条（导航所在区域），再按玻璃的压暗程度折算成“真正看到的亮度”。

export type NavTone = 'light' | 'dark';

const SAMPLE_SIZE = 48;

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** bodyAlpha：玻璃深色底的不透明度（0–1），越大说明导航越暗，文字越该用浅色 */
export async function computeNavTone(src: string | null, bodyAlpha: number): Promise<NavTone> {
  if (!src) return 'light';

  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = src;
  try {
    await image.decode();
  } catch {
    return 'light';
  }
  if (!image.naturalWidth) return 'light';

  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return 'light';

  // object-fit: cover 的取法：只画顶部一条，宽高按 cover 比例裁切
  const scale = Math.max(SAMPLE_SIZE / image.naturalWidth, SAMPLE_SIZE / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const offsetX = (SAMPLE_SIZE - drawWidth) / 2;
  const offsetY = 0; // 顶部对齐：导航在页面最上面
  ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);

  const data = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += luminance(data[i]!, data[i + 1]!, data[i + 2]!);
    count++;
  }
  const imageLum = sum / Math.max(1, count);

  // 导航自身的深色玻璃底会把背景压暗：按 alpha 折算一次
  const tintLum = 14; // 深色底 rgb(10,12,26) 的亮度
  const effective = imageLum * (1 - bodyAlpha) + tintLum * bodyAlpha;

  return effective > 135 ? 'dark' : 'light';
}