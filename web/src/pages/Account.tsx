import { useState, type FormEvent } from 'react';
import { appHref } from '../routing.ts';
import { ApiError, requestJson } from '../api.ts';
import { useSession } from '../session.tsx';

export default function Account() {
  const session = useSession();
  const cloud = session.accountKind === 'email';
  const [register, setRegister] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function act(action: string, body: Record<string, unknown>) {
    setBusy(true);
    setError('');
    try {
      await requestJson('/account/' + action, { method: 'POST', body });
      // 刷新整个身份上下文，避免页面沿用上个账号的数据。
      if (action !== 'logout') {
        localStorage.removeItem('myol.token');
        localStorage.removeItem('myol.nickname');
      }
      const current = await session.refresh();
      if (['login', 'register'].includes(action) && !current) throw new Error('操作已受理，但尚未恢复登录身份，请点击刷新登录状态；不要重复注册');
      window.location.assign(appHref(action === 'password' ? '/account' : cloud ? '/m0' : '/projects'));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        try {
          const current = await session.refresh();
          if (current) { setError('已恢复当前登录状态；如需切换账号，请先退出。'); return; }
        } catch { /* 保留原操作错误，不自动重发登录请求。 */ }
      }
      setError(e instanceof Error ? e.message : '操作失败');
    } finally { setBusy(false); }
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    if (register && data.password !== data.confirmPassword) { setError('两次密码不一致'); return; }
    void act(session.account ? 'password' : register ? 'register' : 'login', data);
  }
  if (!session.ready) return <div className="page">连接中…</div>;
  if (!session.localAccounts) return <div className="page">{session.error ?? '当前运行环境未启用账号管理。'}</div>;
  return <div className="page" style={{ maxWidth: 520, margin: '0 auto' }}>
    <h1>{session.account ? '账号管理' : register ? (cloud ? '注册邮箱账号' : '注册本地账号') : (cloud ? '登录邮箱账号' : '登录本地账号')}</h1>
    <p>{session.account ? `当前账号：${session.account.username}` : cloud ? '注册或登录后可提交云端 M0 模拟任务，并在刷新或重新登录后查看进度。' : '登录后可在连接同一本地服务的浏览器中访问作品。当前游客的项目和收藏会自动合并到账号。'}</p>
    <form onSubmit={submit} style={{ display: 'grid', gap: 16 }}>
      {!session.account && <label>{cloud ? '邮箱' : '用户名'}<input name="username" type={cloud ? 'email' : 'text'} required minLength={3} maxLength={cloud ? 254 : 32} pattern={cloud ? undefined : '[A-Za-z0-9_]+'} autoComplete="username" placeholder={cloud ? '请输入邮箱' : '3–32 位字母、数字或下划线'} /></label>}
      {!session.account && register && <label>昵称<input name="nickname" maxLength={20} autoComplete="nickname" /></label>}
      <label>{session.account ? '当前密码' : '密码'}<input name="password" type="password" required minLength={8} maxLength={128} autoComplete={register ? 'new-password' : 'current-password'} /></label>
      {register && !session.account && <label>确认密码<input name="confirmPassword" type="password" required minLength={8} maxLength={128} autoComplete="new-password" /></label>}
      {session.account && <label>新密码<input name="newPassword" type="password" required minLength={8} maxLength={128} autoComplete="new-password" /></label>}
      {error && <p role="alert">{error}</p>}
      <button className="btn primary" disabled={busy}>{busy ? '处理中…' : session.account ? '修改密码并退出所有登录' : register ? '注册并登录' : '登录'}</button>
    </form>
    {session.account ? <button className="btn" disabled={busy} onClick={() => void act('logout', {})}>退出登录</button> : <button className="btn" disabled={busy} onClick={() => { setRegister(!register); setError(''); }}>{register ? '已有账号，去登录' : '没有账号，去注册'}</button>}
    <button className="btn" disabled={busy} onClick={() => {
      setBusy(true); setError('');
      void session.refresh().catch(e => setError(e instanceof Error ? e.message : '身份刷新失败')).finally(() => setBusy(false));
    }}>刷新登录状态</button>
    <p>{cloud ? '邮箱用于登录，当前尚未发送验证邮件；暂不支持邮件找回密码。' : '账号和作品保存在这台服务所在电脑。密码至少 8 位；本地版暂不提供邮件找回密码。'}</p>
  </div>;
}
