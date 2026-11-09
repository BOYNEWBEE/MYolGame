// 账号会话使用 Cookie；未登录时保留游客创作身份。

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiError, getNickname, getToken, requestJson, saveToken } from './api.ts';

interface SessionState {
  account?: { username: string; nickname: string } | null;
  localAccounts?: boolean;
  accountKind?: 'email';
  cloudM0?: boolean;
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
        try {
          const status = await requestJson<{ enabled: boolean; kind?: 'email'; cloudM0?: boolean; account: { username: string; nickname: string } | null }>('/account', { auth: false });
          if (!cancelled) setState(prev => ({ ...prev, localAccounts: status.enabled, account: status.account, accountKind: status.kind, cloudM0: status.cloudM0 }));
          if (status.cloudM0 && !status.account) {
            if (!cancelled) setState({ token: null, nickname: '未登录', ready: true, error: null, account: null, localAccounts: true, accountKind: 'email', cloudM0: true });
            return;
          }
          if (status.account) {
            if (!cancelled) setState({ token: 'cookie', nickname: status.account.nickname, ready: true, error: null, account: status.account, localAccounts: true, accountKind: status.kind, cloudM0: status.cloudM0 });
            return;
          }
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 404) throw error;
        }
        const existing = getToken();
        if (existing) {
          try {
            const me = await requestJson<{ nickname: string }>('/session');
            if (!cancelled) {
              saveToken(existing, me.nickname);
              setState(prev => ({ ...prev, token: existing, nickname: me.nickname, ready: true, error: null }));
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
          setState(prev => ({ ...prev, token: created.token, nickname: created.nickname, ready: true, error: null }));
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
