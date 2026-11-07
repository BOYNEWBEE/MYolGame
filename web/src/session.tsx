// 匿名会话上下文：创作者令牌保存在浏览器 localStorage（原型身份，非完整账号系统）。

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiError, getNickname, getToken, requestJson, saveToken } from './api.ts';

interface SessionState {
  token: string | null;
  nickname: string;
  ready: boolean;
  error: string | null;
}

const SessionContext = createContext<SessionState>({
  token: null,
  nickname: '匿名创作者',
  ready: false,
  error: null,
});

export function useSession(): SessionState {
  return useContext(SessionContext);
}

export function SessionProvider({ children }: { children: ReactNode }): ReactNode {
  const [state, setState] = useState<SessionState>({
    token: getToken(),
    nickname: getNickname(),
    ready: false,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function ensure(): Promise<void> {
      try {
        const existing = getToken();
        if (existing) {
          try {
            const me = await requestJson<{ nickname: string }>('/session');
            if (!cancelled) {
              saveToken(existing, me.nickname);
              setState({ token: existing, nickname: me.nickname, ready: true, error: null });
            }
            return;
          } catch (error) {
            // 令牌失效则重建会话
            if (!(error instanceof ApiError) || error.status !== 401) throw error;
          }
        }
        const created = await requestJson<{ token: string; nickname: string }>(
          '/session',
          { method: 'POST', body: {}, auth: false },
        );
        saveToken(created.token, created.nickname);
        if (!cancelled) {
          setState({ token: created.token, nickname: created.nickname, ready: true, error: null });
        }
      } catch (error) {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            ready: true,
            error: error instanceof Error ? error.message : '会话创建失败',
          }));
        }
      }
    }

    void ensure();
    return () => {
      cancelled = true;
    };
  }, []);

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
}
