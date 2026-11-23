// 账号会话使用 Cookie；身份读取不复用缓存，登录、退出及冲突时可主动同步。
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, getNickname, getToken, requestJson, saveToken } from './api.ts';

interface AccountProfile { username: string; nickname: string }
interface SessionData {
  account?: AccountProfile | null;
  localAccounts?: boolean;
  accountKind?: 'email';
  cloudM0?: boolean;
  qcaExperiment?: boolean;
  cloudWorkerConfigured?: boolean;
  token: string | null;
  nickname: string;
  ready: boolean;
  error: string | null;
}
interface SessionState extends SessionData { refresh: () => Promise<AccountProfile | null> }
interface AccountStatus {
  enabled: boolean; kind?: 'email'; cloudM0?: boolean; workerConfigured?: boolean;
  qcaExperiment?: boolean; account: AccountProfile | null;
}
const initial: SessionData = { token: null, nickname: '匿名创作者', ready: false, error: null };
const SessionContext = createContext<SessionState>({ ...initial, refresh: async () => null });
export function useSession(): SessionState { return useContext(SessionContext); }

async function loadSession(): Promise<SessionData> {
  let status: AccountStatus | undefined;
  try {
    try {
      // POST 状态查询是只读操作，避免加载时复用某次匿名 GET 的缓存结果。
      status = await requestJson<AccountStatus>('/account/status', { method: 'POST', body: {}, auth: false });
    } catch (error) {
      // 兼容尚未更新状态端点的旧部署，不重放注册或登录写入。
      if (!(error instanceof ApiError) || ![404, 405].includes(error.status)) throw error;
      status = await requestJson<AccountStatus>('/account', { auth: false });
    }
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
  }
  const base: SessionData = {
    ...initial, ready: true, localAccounts: status?.enabled, account: status?.account,
    accountKind: status?.kind, cloudM0: status?.cloudM0,
    cloudWorkerConfigured: status?.workerConfigured, qcaExperiment: status?.qcaExperiment,
  };
  if (status?.account) return { ...base, token: 'cookie', nickname: status.account.nickname };
  if (status?.cloudM0) return { ...base, token: null, nickname: '未登录', account: null };
  const existing = getToken();
  if (existing) {
    try {
      const me = await requestJson<{ nickname: string }>('/session');
      saveToken(existing, me.nickname);
      return { ...base, token: existing, nickname: me.nickname };
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
    }
  }
  const created = await requestJson<{ token: string; nickname: string }>('/session', { method: 'POST', body: {}, auth: false });
  saveToken(created.token, created.nickname);
  return { ...base, token: created.token, nickname: created.nickname };
}

export function SessionProvider({ children }: { children: ReactNode }): ReactNode {
  const [state, setState] = useState<SessionData>(() => ({ ...initial, token: getToken(), nickname: getNickname() }));
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    try {
      const next = await loadSession();
      if (current === generation.current) setState(next);
      return next.account ?? null;
    } catch (error) {
      if (current === generation.current) setState(previous => ({ ...previous, ready: true, error: error instanceof Error ? error.message : '身份读取失败' }));
      throw error;
    }
  }, []);
  useEffect(() => {
    void refresh().catch(() => {});
    // 忽略已卸载或严格模式上一次初始化的过期响应。
    return () => { generation.current++; };
  }, [refresh]);
  return <SessionContext.Provider value={{ ...state, refresh }}>{children}</SessionContext.Provider>;
}
