// 设置页：背景图片与液态玻璃参数全部本地生效（localStorage），不进服务端、不影响游戏产物。

import { useRef, useState, type ReactNode } from 'react';
import {
  DEFAULT_BACKDROP,
  DEFAULT_GLASS,
  resetPrefs,
  setGlass,
  setPrefs,
  usePrefs,
  type GlassSettings,
} from '../prefs.ts';

const MAX_LOCAL_IMAGE = 1.5 * 1024 * 1024;

interface SliderProps {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}

function Slider({ label, hint, value, min, max, step, format, onChange }: SliderProps): ReactNode {
  return (
    <label className="setting-row">
      <span className="row-head">
        <span>{label}</span>
        <b>{format(value)}</b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {hint && <span className="setting-hint">{hint}</span>}
    </label>
  );
}

export default function Settings(): ReactNode {
  const prefs = usePrefs();
  const [urlDraft, setUrlDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  function upload(file: File | undefined): void {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setNotice('只能选图片文件（PNG / JPEG / WebP）');
      return;
    }
    if (file.size > MAX_LOCAL_IMAGE) {
      setNotice('图片超过 1.5 MB：浏览器本地存储放不下，请先压缩再上传');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setPrefs({ backdrop: String(reader.result) });
      setNotice('已换成你的图片（只保存在当前浏览器）');
    };
    reader.onerror = () => setNotice('读取文件失败');
    reader.readAsDataURL(file);
  }

  function applyUrl(): void {
    const value = urlDraft.trim();
    if (!value) {
      setNotice('先填一个图片地址');
      return;
    }
    setPrefs({ backdrop: value });
    setNotice('已应用该地址作为背景');
  }

  const glass = prefs.glass;
  const glassSetter = (key: keyof GlassSettings) => (value: number) => setGlass({ [key]: value });

  return (
    <div className="page settings-page">
      <div className="page-head">
        <h1>设置</h1>
        <p>外观只保存在当前浏览器（localStorage），换设备或清缓存会回到默认；不影响生成出来的游戏。</p>
      </div>

      <div className="settings-grid">
        <section className="panel">
          <h2>背景图片</h2>
          <p className="setting-hint">当前：{prefs.backdrop ? (prefs.backdrop.startsWith('data:') ? '本地图片' : prefs.backdrop) : '已关闭'}</p>

          <div className="setting-actions">
            <button type="button" className="chip" onClick={() => { setPrefs({ backdrop: DEFAULT_BACKDROP }); setNotice('已切换到「我的图片」背景'); }}>我的图片</button>
            <button type="button" className="chip" onClick={() => { setPrefs({ backdrop: null }); setNotice('已切换到初版背景（无图片）'); }}>初版（无图）</button>
            <button type="button" className="chip" onClick={() => fileRef.current?.click()}>上传本地图片</button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(event) => { upload(event.target.files?.[0]); event.target.value = ''; }}
            />
          </div>

          <div className="setting-inline">
            <input
              type="url"
              placeholder="或填图片 URL，例如 https://…/bg.jpg"
              value={urlDraft}
              onChange={(event) => setUrlDraft(event.target.value)}
            />
            <button type="button" className="btn small" onClick={applyUrl}>应用地址</button>
          </div>

          <Slider
            label="背景不透明度"
            value={prefs.backdropOpacity}
            min={0.05}
            max={1}
            step={0.01}
            format={(value) => Math.round(value * 100) + '%'}
            onChange={(value) => setPrefs({ backdropOpacity: value })}
          />
          <p className="setting-hint">上传的图片会转成 dataURL 存进 localStorage，上限约 1.5 MB。</p>
        </section>

        <section className="panel">
          <h2>液态玻璃</h2>

          <Slider
            label="背景模糊"
            hint="0 = 玻璃完全透明锐利；越大越糊"
            value={glass.blur}
            min={0}
            max={40}
            step={1}
            format={(value) => value + ' px'}
            onChange={glassSetter('blur')}
          />
          <Slider
            label="饱和度"
            value={glass.saturate}
            min={100}
            max={250}
            step={5}
            format={(value) => value + '%'}
            onChange={glassSetter('saturate')}
          />
          <Slider
            label="明暗"
            hint="1.00 = 不压暗（原始亮度）；越低玻璃越暗、白字越好读"
            value={glass.brightness}
            min={0.4}
            max={1.8}
            step={0.01}
            format={(value) => value.toFixed(2)}
            onChange={glassSetter('brightness')}
          />
          <Slider
            label="玻璃厚度"
            hint="越大越不透光（更实）"
            value={glass.body}
            min={0.3}
            max={0.95}
            step={0.01}
            format={(value) => Math.round(value * 100) + '%'}
            onChange={glassSetter('body')}
          />
          <Slider
            label="亮边强度"
            value={glass.edge}
            min={0.05}
            max={0.8}
            step={0.01}
            format={(value) => Math.round(value * 100) + '%'}
            onChange={glassSetter('edge')}
          />
        </section>

        <section className="panel">
          <h2>动效</h2>
          <Slider
            label="动效倍率"
            hint="0 = 关闭全部过渡与入场动画"
            value={prefs.motion}
            min={0}
            max={1.5}
            step={0.05}
            format={(value) => value.toFixed(2) + '×'}
            onChange={(value) => setPrefs({ motion: value })}
          />
          <p className="setting-hint">
            系统开启「减少动效」时，动画会自动关闭，这里调多少都不生效。
          </p>

          <div className="setting-actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                resetPrefs();
                setNotice('已恢复默认：我的图片 + 默认玻璃参数');
              }}
            >
              恢复默认外观
            </button>
            <button type="button" className="btn" onClick={() => { setGlass({ ...DEFAULT_GLASS }); setNotice('玻璃参数已重置'); }}>
              只重置玻璃
            </button>
          </div>
          {notice && <p className="setting-hint" role="status">{notice}</p>}
        </section>
      </div>
    </div>
  );
}
