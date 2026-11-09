import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { HASH_ROUTING } from './routing.ts';
import App from './App.tsx';
import { SessionProvider } from './session.tsx';
import './styles.css';

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
