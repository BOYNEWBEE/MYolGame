import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { NavLink, Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { createPillSpring } from './pill-spring.ts';
import { getRefractFilter } from './glass-refract.ts';
import { useSession } from './session.tsx';
import Backdrop from './components/Backdrop.tsx';
import QcaExperiment from './pages/QcaExperiment.tsx';
import M0 from './pages/M0.tsx';
import Account from './pages/Account.tsx';
import Home from './pages/Home.tsx';
import GameDetail from './pages/GameDetail.tsx';
import Create from './pages/Create.tsx';
import Projects from './pages/Projects.tsx';
import Workbench from './pages/Workbench.tsx';
import Favorites from './pages/Favorites.tsx';
import Templates from './pages/Templates.tsx';
import TemplateDetail from './pages/TemplateDetail.tsx';
import Settings from './pages/Settings.tsx';

function Logo(): ReactNode {
  return (
    <Link to="/" className="logo" aria-label="MYolGame 首页">
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
        <defs>
          <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#818cf8" />
            <stop offset="100%" stopColor="#c084fc" />
          </linearGradient>
        </defs>
        <rect x="1" y="1" width="24" height="24" rx="7" fill="url(#lg)" opacity="0.2" />
        <rect x="1" y="1" width="24" height="24" rx="7" fill="none" stroke="url(#lg)" strokeWidth="1.5" />
        <circle cx="9" cy="11" r="1.8" fill="#a5b4fc" />
        <circle cx="17" cy="11" r="1.8" fill="#e879f9" />
        <path d="M8 16.5 Q13 20 18 16.5" stroke="url(#lg)" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      </svg>
      <span>MYolGame</span>
    </Link>
  );
}

export default function App(): ReactNode {
  const session = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  // 路由切换：旧页面先淡出 110ms（只到 35%，不会空白），换页后新页面淡入，
  // 随后玻璃材质化接管（模糊 0 → 设定值）。

  // 路由切换：不做整页淡入淡出，改为让玻璃"材质化"——
  // 模糊从 0 长到设定值、压暗从透明长到设定值（动画作用在 --glass-* 变量上）。
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('glass-warming');
    void root.offsetWidth;
    root.classList.add('glass-warming');
    const timer = window.setTimeout(() => root.classList.remove('glass-warming'), 480);
    return () => window.clearTimeout(timer);
  }, [location.pathname]);
  const navRef = useRef<HTMLElement | null>(null);
  const pillRef = useRef<HTMLSpanElement | null>(null);
  const springRef = useRef<ReturnType<typeof createPillSpring> | null>(null);
  const placeRef = useRef<() => void>(() => {});
  const suppressClickRef = useRef(false);
  const dragRef = useRef<{ startX: number; startLeft: number; moved: boolean; lastX: number; lastT: number } | null>(null);

  useEffect(() => {
    springRef.current = createPillSpring(
      (left, width) => {
        const pill = pillRef.current;
        if (!pill) return;
        // 用 left/width 做布局动画，避免 transform 动画时合成器把胶囊画两份（残影）
        pill.style.left = left + 'px';
        pill.style.width = width + 'px';
      },
      () => {
        pillRef.current?.classList.remove('is-settling');
      },
    );
    return () => {
      springRef.current?.cancel();
      springRef.current = null;
    };
  }, []);

  // 让顶部胶囊玻璃跟随当前路由的位置
  useLayoutEffect(() => {
    const place = (): void => {
      const nav = navRef.current;
      const pill = pillRef.current;
      if (!nav || !pill) return;
      const active = nav.querySelector<HTMLAnchorElement>('a.active');
      if (!active) { pill.style.opacity = '0'; return; }
      const navBox = nav.getBoundingClientRect();
      const box = active.getBoundingClientRect();
      pill.style.opacity = '1';
      // 苹果式折射：动画期间先用普通模糊，落位后再按胶囊实际位置生成 SDF 位移贴图
      // （独立 <svg> 的 userSpaceOnUse 以视口为原点，必须把元素位置一起传进去）
      const applyRefract = (): void => {
        const rect = pill.getBoundingClientRect();
        const refract = getRefractFilter(rect.width, rect.height, 1.45, rect.left, rect.top);
        const chain = refract
          ? refract + ' blur(0.25px) contrast(1.2) brightness(1.05) saturate(1.15)'
          : 'blur(6px) saturate(1.4)';
        pill.style.backdropFilter = chain;
        pill.style.setProperty('-webkit-backdrop-filter', chain);
      };
      applyRefract();
      window.setTimeout(applyRefract, 620);

      const spring = springRef.current;
      if (!spring) {
        pill.style.left = (box.left - navBox.left) + 'px';
        pill.style.width = box.width + 'px';
        return;
      }
      spring.setBounds(nav.clientWidth - box.width);
      spring.animateTo({ left: box.left - navBox.left, width: box.width });
    };
    placeRef.current = place;
    place();
    const timer = window.setTimeout(place, 80);
    window.addEventListener('resize', place);
    // 自愈：如果胶囊和当前项没对齐（动画被打断、布局变化等），每 600ms 校正一次
    const heal = window.setInterval(() => {
      if (dragRef.current) return;
      const pill = pillRef.current;
      if (!pill) return;
      const active = navRef.current?.querySelector<HTMLAnchorElement>('a.active');
      if (!active) return;
      const box = active.getBoundingClientRect();
      const rect = pill.getBoundingClientRect();
      if (Math.abs(rect.left - box.left) > 2 || Math.abs(rect.width - box.width) > 2) place();
    }, 600);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(heal);
      window.removeEventListener('resize', place);
    };
  }, [location.pathname, session.cloudM0, session.qcaExperiment]);

  // 拖动挂在导航容器上：指针移动超过 8px 才算拖，否则让链接正常响应点击。
  // 这样胶囊永远不会吞掉导航点击，也不会出现“点了没反应 / 停在半路”。
  function navPointerDown(event: ReactPointerEvent<HTMLElement>): void {
    const nav = navRef.current;
    const pill = pillRef.current;
    if (!nav || !pill || event.button !== 0) return;
    const navBox = nav.getBoundingClientRect();
    const pillBox = pill.getBoundingClientRect();
    dragRef.current = {
      startX: event.clientX,
      startLeft: pillBox.left - navBox.left,
      moved: false,
      lastX: event.clientX,
      lastT: performance.now(),
    };
  }

  function navPointerMove(event: ReactPointerEvent<HTMLElement>): void {
    const drag = dragRef.current;
    const nav = navRef.current;
    const pill = pillRef.current;
    if (!drag || !nav || !pill) return;
    const dx = event.clientX - drag.startX;
    if (!drag.moved) {
      if (Math.abs(dx) < 8) return;
      drag.moved = true;
      pill.classList.add('is-dragging');
      springRef.current?.cancel();
      pill.style.width = pill.getBoundingClientRect().width + 'px';
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    const width = pill.getBoundingClientRect().width;
    const maxLeft = Math.max(0, nav.clientWidth - width);
    const left = Math.min(Math.max(0, drag.startLeft + dx), maxLeft);

    // 按拖动速度做液态形变：越快越拉长，同时略微压扁
    const now = performance.now();
    const dt = Math.max(16, now - drag.lastT);
    const speed = Math.min(2.4, Math.abs(event.clientX - drag.lastX) / dt);
    const stretch = Math.min(0.5, speed * 0.9);
    drag.lastX = event.clientX;
    drag.lastT = now;

    pill.style.left = left + 'px';
    pill.style.transform = 'translate(0, -50%) scaleX(' + (1 + stretch).toFixed(3) + ') scaleY(' + (1 - stretch * 0.6).toFixed(3) + ')';
    const pillRect = pill.getBoundingClientRect();
    pill.style.setProperty('--lens-x', (-pillRect.left) + 'px');
    pill.style.setProperty('--lens-y', (-pillRect.top) + 'px');
  }

  function releaseCapture(target: EventTarget | null, pointerId: number): void {
    const el = target as (HTMLElement & { hasPointerCapture?: (id: number) => boolean }) | null;
    if (el?.hasPointerCapture?.(pointerId)) el.releasePointerCapture(pointerId);
  }

  function pillCancel(event?: ReactPointerEvent<HTMLElement>): void {
    if (event) releaseCapture(event.currentTarget, event.pointerId);
    dragRef.current = null;
    pillRef.current?.classList.remove('is-dragging');
    placeRef.current();
  }

  function navPointerUp(event: ReactPointerEvent<HTMLElement>): void {
    releaseCapture(event.currentTarget, event.pointerId);
    const drag = dragRef.current;
    const nav = navRef.current;
    const pill = pillRef.current;
    dragRef.current = null;
    if (!drag || !nav || !pill) return;
    pill.classList.remove('is-dragging');
    if (!drag.moved) return; // 没拖动：交给链接自己的 click 导航

    const pillBox = pill.getBoundingClientRect();
    const center = pillBox.left + pillBox.width / 2;
    let best: HTMLAnchorElement | undefined;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const link of nav.querySelectorAll<HTMLAnchorElement>('a')) {
      const box = link.getBoundingClientRect();
      const dist = Math.abs(box.left + box.width / 2 - center);
      if (dist < bestDist) {
        bestDist = dist;
        best = link;
      }
    }
    if (!best) {
      placeRef.current();
      return;
    }
    event.preventDefault();
    suppressClickRef.current = true; // 吞掉拖动结束后浏览器补发的那次 click
    const navBox = nav.getBoundingClientRect();
    const box = best.getBoundingClientRect();
    springRef.current?.jumpTo(pillBox.left - navBox.left, pillBox.width);
    springRef.current?.setBounds(nav.clientWidth - box.width);
    springRef.current?.animateTo({ left: box.left - navBox.left, width: box.width });
    const href = best.getAttribute('href');
    if (href) navigate(href);
  }

  return (
    <div className="app">
      <svg className="svg-defs" aria-hidden="true" focusable="false">
        <filter id="liquid-warp" x="-25%" y="-25%" width="150%" height="150%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.006 0.011" numOctaves="2" seed="9" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="14" xChannelSelector="R" yChannelSelector="G" result="bent" />
          <feColorMatrix in="bent" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="chR" />
          <feColorMatrix in="bent" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="chG" />
          <feColorMatrix in="bent" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="chB" />
          <feOffset in="chR" dx="3.6" dy="0" result="rShift" />
          <feOffset in="chB" dx="-3.6" dy="0" result="bShift" />
          <feBlend in="rShift" in2="chG" mode="screen" result="rg" />
          <feBlend in="rg" in2="bShift" mode="screen" result="dispersion" />
        </filter>
      </svg>
      <Backdrop />
      <header className="nav">
        <div className="nav-inner">
          <Logo />
          <nav
            className="nav-links"
            aria-label="主导航"
            ref={navRef}
            onPointerDown={navPointerDown}
            onPointerMove={navPointerMove}
            onPointerUp={navPointerUp}
            onPointerCancel={pillCancel}
            onClickCapture={(event) => {
              if (!suppressClickRef.current) return;
              suppressClickRef.current = false;
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <span
              className="nav-pill"
              ref={pillRef}
              aria-hidden="true"
              onDragStart={(event) => event.preventDefault()}
            >
            </span>
            <NavLink to="/" end>社区首页</NavLink>
            <NavLink to="/templates">社区模板</NavLink>
            <NavLink to="/create">创作游戏</NavLink>
            {session.cloudM0 && <NavLink to="/m0">云端任务</NavLink>}
            <NavLink to="/projects">我的项目</NavLink>
            <NavLink to="/favorites">我的收藏</NavLink>
            <NavLink to="/settings">设置</NavLink>
            {session.qcaExperiment && <NavLink to="/experiments/qca">新路线实验</NavLink>}
          </nav>
          <div className="nav-user">
            <span className="dot" aria-hidden="true" />
            {session.ready ? session.nickname : '连接中…'}
            {session.localAccounts && <Link to="/account">{session.account ? '账号管理' : '登录 / 注册'}</Link>}
          </div>
        </div>
      </header>

      <main className="main">
        {session.cloudM0 && <div className="page" role="status">{session.qcaExperiment ? '当前部署提供新路线实验；M0 任务仍为模拟，实验执行方式以实验页标记为准。' : '当前为云端 M0：任务仅模拟基础设施执行，不调用 AI、不生成游戏。'}<Link to="/m0">进入云端任务</Link></div>}
        <Routes>
          <Route path="/experiments/qca" element={<QcaExperiment />} />
          <Route path="/m0" element={<M0 />} />
          <Route path="/account" element={<Account />} />
          <Route path="/" element={<Home />} />
          <Route path="/games/:id" element={<GameDetail />} />
          <Route path="/templates" element={<Templates />} />
          <Route path="/templates/:id" element={<TemplateDetail />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/create" element={session.cloudM0 ? <M0 /> : <Create />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:id" element={<Workbench />} />
          <Route path="/favorites" element={<Favorites />} />
          <Route
            path="*"
            element={
              <div className="empty-state">
                <h2>页面不存在</h2>
                <p>请从顶部导航返回首页或创作页。</p>
                <Link className="btn primary" to="/">回到首页</Link>
              </div>
            }
          />
        </Routes>
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <p>
            <strong>初版原型说明：</strong>
            游戏支持模板生成、模型辅助规格调整或 Agent 源码开发，具体方式见作品标记；
            生成结果需试玩确认后再发布。
          </p>
          <p>
            {session.cloudM0 ? '云端 M0 支持邮箱账号与模拟任务；' : '本地支持账号注册与登录，游客身份保存在本浏览器；'}
            社区公开游戏与收藏保存在服务端，草稿项目私有，仅创建者可见。
          </p>
        </div>
      </footer>
    </div>
  );
}
