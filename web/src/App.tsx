import type { ReactNode } from 'react';
import { NavLink, Link, Route, Routes } from 'react-router-dom';
import { useSession } from './session.tsx';
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
  return (
    <div className="app">
      <header className="nav">
        <div className="nav-inner">
          <Logo />
          <nav className="nav-links" aria-label="主导航">
            <NavLink to="/" end>社区首页</NavLink>
            <NavLink to="/templates">社区模板</NavLink>
            <NavLink to="/create">创作游戏</NavLink>
            <NavLink to="/projects">我的项目</NavLink>
            <NavLink to="/favorites">我的收藏</NavLink>
          </nav>
          <div className="nav-user">
            <span className="dot" aria-hidden="true" />
            {session.ready ? session.nickname : '连接中…'}
            {session.localAccounts && <Link to="/account">{session.account ? '账号管理' : '登录 / 注册'}</Link>}
          </div>
        </div>
      </header>

      <main className="main">
        <Routes>
          <Route path="/account" element={<Account />} />
          <Route path="/" element={<Home />} />
          <Route path="/games/:id" element={<GameDetail />} />
          <Route path="/templates" element={<Templates />} />
          <Route path="/templates/:id" element={<TemplateDetail />} />
          <Route path="/create" element={<Create />} />
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
            本地支持账号注册与登录，游客身份保存在本浏览器；
            社区公开游戏与收藏保存在服务端，草稿项目私有，仅创建者可见。
          </p>
        </div>
      </footer>
    </div>
  );
}
