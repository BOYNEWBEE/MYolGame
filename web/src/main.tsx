import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { HASH_ROUTING } from './routing.ts';
import App from './App.tsx';
import { SessionProvider } from './session.tsx';
import { applyPrefs, loadPrefs } from './prefs.ts';
import './styles.css';

// 首帧之前就把本地外观偏好写进 CSS 变量，避免先闪一下默认观感
applyPrefs(loadPrefs());

const Router = HASH_ROUTING ? HashRouter : BrowserRouter;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Router>
      <SessionProvider>
        <App />
      </SessionProvider>
    </Router>
  </React.StrictMode>,
);
