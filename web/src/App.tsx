import { useState, type ReactNode } from 'react';
import { NavLink, Link, Route, Routes } from 'react-router-dom';
import { useSession } from './session.tsx';
import Backdrop from './components/Backdrop.tsx';
import Welcome from './components/Welcome.tsx';
import { DEFAULT_BACKDROP, setPrefs, usePrefs } from './prefs.ts';
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
  const prefs = usePrefs();
  const [welcomeActive, setWelcomeActive] = useState(false);
  return (
    <div className={'app' + (welcomeActive ? ' is-welcoming' : '')}>
      <Backdrop sharp={welcomeActive} />
      <Welcome onActiveChange={setWelcomeActive} />
      <header className="nav">
        <div className="nav-inner">
          <Logo />
          <nav className="nav-links" aria-label="主导航">
            <NavLink to="/" end>社区首页</NavLink>
            <NavLink to="/templates">社区模板</NavLink>
            <NavLink to="/create">创作游戏</NavLink>
            {session.cloudM0 && <NavLink to="/m0">云端任务</NavLink>}
            <NavLink to="/projects">我的项目</NavLink>
            <NavLink to="/favorites">我的收藏</NavLink>
            {session.qcaExperiment && <NavLink to="/experiments/qca">新路线实验</NavLink>}
          </nav>
          <button
            type="button"
            className={'nav-backdrop' + (prefs.backdrop ? ' is-on' : '')}
            aria-pressed={Boolean(prefs.backdrop)}
            title={prefs.backdrop ? '关闭背景图' : '开启背景图'}
            onClick={() => setPrefs({ backdrop: prefs.backdrop ? null : DEFAULT_BACKDROP })}
          >
            背景
          </button>
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
