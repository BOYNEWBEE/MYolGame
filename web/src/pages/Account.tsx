import { useEffect, useState, type FormEvent } from 'react';
import { appHref } from '../routing.ts';
import { ApiError, requestJson } from '../api.ts';
import { fetchMusicSettings, musicErrorText, testMusicSettings, type MusicSettingsView } from '../music-settings.ts';
import { fetchMusicStyleSettings, musicStyleErrorText, testMusicStyleSettings, type MusicStyleSettingsView } from '../music-style-settings.ts';
import { useSession } from '../session.tsx';

export default function Account() {
  const session = useSession();
  const cloud = session.accountKind === 'email';
  const [register, setRegister] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [musicStatus, setMusicStatus] = useState<MusicSettingsView | null>(null);
  const [musicUrl, setMusicUrl] = useState('');
  const [musicName, setMusicName] = useState('');
  const [musicKey, setMusicKey] = useState('');
  const [musicLoading, setMusicLoading] = useState(false);
  const [musicBusy, setMusicBusy] = useState(false);
  const [musicTesting, setMusicTesting] = useState(false);
  const [musicError, setMusicError] = useState('');
  const [musicNotice, setMusicNotice] = useState('');

  const [styleStatus, setStyleStatus] = useState<MusicStyleSettingsView | null>(null);
  const [styleUrl, setStyleUrl] = useState('');
  const [styleModel, setStyleModel] = useState('');
  const [styleKey, setStyleKey] = useState('');
  const [styleLoading, setStyleLoading] = useState(false);
  const [styleBusy, setStyleBusy] = useState(false);
  const [styleTesting, setStyleTesting] = useState(false);
  const [styleError, setStyleError] = useState('');
  const [styleNotice, setStyleNotice] = useState('');

  useEffect(() => {
    if (!session.ready || !session.account || session.cloudM0) return;
    let cancelled = false;
    setMusicLoading(true);
    setMusicError('');
    fetchMusicSettings()
      .then((view) => {
        if (cancelled) return;
        setMusicStatus(view);
        setMusicUrl(view.account?.apiUrl ?? '');
        setMusicName(view.account?.name ?? '');
      })
      .catch((e) => {
        if (!cancelled) setMusicError(e instanceof Error ? e.message : '配乐接口配置读取失败');
      })
      .finally(() => {
        if (!cancelled) setMusicLoading(false);
      });
    return () => { cancelled = true; };
  }, [session.ready, session.account?.username, session.cloudM0]);

  useEffect(() => {
    if (!session.ready || !session.account || session.cloudM0) return;
    let cancelled = false;
    setStyleLoading(true);
    setStyleError('');
    fetchMusicStyleSettings()
      .then((view) => {
        if (cancelled) return;
        setStyleStatus(view);
        setStyleUrl(view.account?.apiUrl ?? '');
        setStyleModel(view.account?.model ?? '');
      })
      .catch((e) => {
        if (!cancelled) setStyleError(e instanceof Error ? e.message : '编曲模型配置读取失败');
      })
      .finally(() => {
        if (!cancelled) setStyleLoading(false);
      });
    return () => { cancelled = true; };
  }, [session.ready, session.account?.username, session.cloudM0]);

  async function saveMusic(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (musicBusy) return;
    setMusicBusy(true);
    setMusicError('');
    setMusicNotice('');
    try {
      const body: Record<string, unknown> = { apiUrl: musicUrl, name: musicName };
      if (musicKey.trim()) body.apiKey = musicKey;
      const view = await requestJson<MusicSettingsView>('/music/settings', { method: 'PUT', body });
      setMusicStatus(view);
      setMusicKey('');
      setMusicNotice('已保存。创作页会优先使用这个接口生成 AI 配乐。');
    } catch (e) {
      setMusicError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setMusicBusy(false);
    }
  }

  async function clearMusic(): Promise<void> {
    if (musicBusy) return;
    setMusicBusy(true);
    setMusicError('');
    setMusicNotice('');
    try {
      const view = await requestJson<MusicSettingsView>('/music/settings', { method: 'DELETE' });
      setMusicStatus(view);
      setMusicUrl('');
      setMusicName('');
      setMusicKey('');
      setMusicNotice(view.server ? '已清除账号配置，将改用服务端配置。' : '已清除账号配置。');
    } catch (e) {
      setMusicError(e instanceof Error ? e.message : '清除失败');
    } finally {
      setMusicBusy(false);
    }
  }

  async function testConnection(): Promise<void> {
    if (musicBusy || musicTesting) return;
    setMusicTesting(true);
    setMusicError('');
    setMusicNotice('');
    try {
      const body: { apiUrl: string; apiKey?: string; name?: string } = { apiUrl: musicUrl, name: musicName };
      if (musicKey.trim()) body.apiKey = musicKey;
      const result = await testMusicSettings(body);
      if (!result.ok) {
        setMusicError('连接失败：' + musicErrorText(result.error ?? ''));
        return;
      }
      const size = result.bytes === undefined ? '大小未知' : (result.bytes / 1024).toFixed(1) + ' KB';
      const elapsed = result.elapsedMs === undefined ? '' : '，耗时 ' + (result.elapsedMs / 1000).toFixed(1) + ' 秒';
      setMusicNotice('连接正常：返回 ' + (result.mimeType ?? '音频') + '，' + size + elapsed + '。');
    } catch (e) {
      if (e instanceof ApiError) setMusicError(e.message || musicErrorText(e.code));
      else setMusicError(e instanceof Error ? e.message : '测试失败');
    } finally {
      setMusicTesting(false);
    }
  }

  async function saveStyle(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (styleBusy) return;
    setStyleBusy(true);
    setStyleError('');
    setStyleNotice('');
    try {
      const body: Record<string, unknown> = { apiUrl: styleUrl, model: styleModel };
      if (styleKey.trim()) body.apiKey = styleKey;
      const view = await requestJson<MusicStyleSettingsView>('/music/style-model', { method: 'PUT', body });
      setStyleStatus(view);
      setStyleKey('');
      setStyleNotice('已保存。生成「霓虹街机」配乐时会由该模型调整风格。');
    } catch (e) {
      setStyleError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setStyleBusy(false);
    }
  }

  async function testStyleConnection(): Promise<void> {
    if (styleBusy || styleTesting) return;
    setStyleTesting(true);
    setStyleError('');
    setStyleNotice('');
    try {
      const body: { apiUrl: string; apiKey?: string; model?: string } = { apiUrl: styleUrl, model: styleModel };
      if (styleKey.trim()) body.apiKey = styleKey;
      const result = await testMusicStyleSettings(body);
      if (!result.ok) {
        setStyleError('连接失败：' + musicStyleErrorText(result.error ?? ''));
        return;
      }
      const elapsed = result.elapsedMs === undefined ? '' : '，耗时 ' + (result.elapsedMs / 1000).toFixed(1) + ' 秒';
      setStyleNotice('连接正常：' + (result.model ?? styleModel) + ' 返回 bpm=' + (result.bpm ?? '?') + '、progression=' + (result.progression ?? '?') + elapsed + '。');
    } catch (e) {
      if (e instanceof ApiError) setStyleError(e.message || musicStyleErrorText(e.code));
      else setStyleError(e instanceof Error ? e.message : '测试失败');
    } finally {
      setStyleTesting(false);
    }
  }

  async function clearStyle(): Promise<void> {    if (styleBusy) return;
    setStyleBusy(true);
    setStyleError('');
    setStyleNotice('');
    try {
      const view = await requestJson<MusicStyleSettingsView>('/music/style-model', { method: 'DELETE' });
      setStyleStatus(view);
      setStyleUrl('');
      setStyleModel('');
      setStyleKey('');
      setStyleNotice(view.server ? '已清除账号配置，将改用服务端配置。' : '已清除账号配置。');
    } catch (e) {
      setStyleError(e instanceof Error ? e.message : '清除失败');
    } finally {
      setStyleBusy(false);
    }
  }

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
    {session.account && (
      <>
      <section className="panel" style={{ marginTop: 20, textAlign: 'left', display: 'grid', gap: 12 }}>
        <h2>AI 配乐 API</h2>
        <p className="panel-note" style={{ margin: 0 }}>
          填写兼容的服务端网关地址与密钥。保存后，创作页的「AI 配乐（音乐模型）」会调用它生成 20 秒循环配乐；密钥只保存在服务端，不会回传浏览器。
        </p>
        {session.cloudM0 ? <p className="panel-note" style={{ margin: 0 }}>
          当前部署为云端 M0 模拟阶段，写入接口尚未开放；账号级配乐设置暂不可用，服务端统一配置仍可通过创作页使用。
        </p> : musicLoading ? <p className="muted">正在读取配置…</p> : (
          <>
            <p className="muted small" role="status" style={{ margin: 0 }}>
              {musicStatus?.account
                ? '账号配置：' + musicStatus.account.apiUrl
                : musicStatus?.server
                  ? '未保存账号配置，当前使用服务端统一配置。'
                  : '当前未配置音乐生成接口。'}
            </p>
            <form onSubmit={saveMusic} style={{ display: 'grid', gap: 12 }}>
              <label className="field">
                <span className="field-label">接口地址</span>
                <input type="text" inputMode="url" required maxLength={512} value={musicUrl} onChange={(e) => setMusicUrl(e.target.value)} placeholder="https://example.com/api/music" autoComplete="off" />
              </label>
              <label className="field">
                <span className="field-label">显示名称（可选，作为 model 传给接口）</span>
                <input type="text" maxLength={40} value={musicName} onChange={(e) => setMusicName(e.target.value)} placeholder="例如：music-v1" autoComplete="off" />
              </label>
              <label className="field">
                <span className="field-label">API 密钥</span>
                <input type="password" maxLength={512} value={musicKey} onChange={(e) => setMusicKey(e.target.value)} placeholder={musicStatus?.account?.hasKey ? '已保存；留空则保持不变' : '输入服务提供的密钥'} autoComplete="new-password" />
              </label>
              <p className="panel-note" style={{ margin: 0 }}>
                仅支持 HTTPS；本机调试可用 http://127.0.0.1 或 http://localhost。保存时不会校验上游；「测试连接」会真实请求一次约 5 秒的短配乐，可能产生调用费用。
              </p>
              {musicError && <p role="alert" style={{ margin: 0 }}>{musicError}</p>}
              {musicNotice && <p role="status" style={{ margin: 0 }}>{musicNotice}</p>}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn" disabled={musicBusy || musicTesting} onClick={() => void testConnection()}>{musicTesting ? '测试中…' : '测试连接'}</button>
                <button className="btn primary" disabled={musicBusy || musicTesting}>{musicBusy ? '处理中…' : '保存配乐接口'}</button>
                <button type="button" className="btn danger" disabled={musicBusy || musicTesting || !musicStatus?.account} onClick={() => void clearMusic()}>清除账号配置</button>
              </div>
            </form>
          </>
        )}
      </section>
      <section className="panel" style={{ marginTop: 20, textAlign: 'left', display: 'grid', gap: 12 }}>
        <h2>AI 编曲模型（OpenAI 兼容）</h2>
        <p className="panel-note" style={{ margin: 0 }}>
          用于调整浏览器内置「霓虹街机」实时合成配乐的速度、和弦、音色与节奏。填写 OpenAI 兼容的接口地址和模型名，例如 DeepSeek：https://api.deepseek.com + deepseek-chat。模型只返回受限参数，不会生成或执行浏览器代码；调用失败时回退默认配乐。密钥只保存在服务端。
        </p>
        {session.cloudM0 ? <p className="panel-note" style={{ margin: 0 }}>
          当前部署为云端 M0 模拟阶段，写入接口尚未开放；账号级编曲模型设置暂不可用。
        </p> : styleLoading ? <p className="muted">正在读取配置…</p> : (
          <>
            <p className="muted small" role="status" style={{ margin: 0 }}>
              {styleStatus?.account
                ? '账号配置：' + styleStatus.account.apiUrl + '（模型 ' + styleStatus.account.model + '）'
                : styleStatus?.server
                  ? '未保存账号配置，当前使用服务端统一配置。'
                  : '当前未配置编曲模型，将使用默认霓虹配乐。'}
            </p>
            <form onSubmit={saveStyle} style={{ display: 'grid', gap: 12 }}>
              <label className="field">
                <span className="field-label">编曲接口地址</span>
                <input type="text" inputMode="url" required maxLength={512} value={styleUrl} onChange={(e) => setStyleUrl(e.target.value)} placeholder="https://api.deepseek.com" autoComplete="off" />
              </label>
              <label className="field">
                <span className="field-label">编曲模型名</span>
                <input type="text" required maxLength={64} value={styleModel} onChange={(e) => setStyleModel(e.target.value)} placeholder="deepseek-chat" autoComplete="off" />
              </label>
              <label className="field">
                <span className="field-label">编曲 API 密钥</span>
                <input type="password" maxLength={512} value={styleKey} onChange={(e) => setStyleKey(e.target.value)} placeholder={styleStatus?.account?.hasKey ? '已保存；留空则保持不变' : '输入服务提供的密钥'} autoComplete="new-password" />
              </label>
              <p className="panel-note" style={{ margin: 0 }}>
                仅支持 HTTPS；本机调试可用 http://127.0.0.1 或 http://localhost。留空密钥表示沿用已保存的密钥；「测试编曲连接」会真实请求一次模型，可能产生小额调用费用。
              </p>
              {styleError && <p role="alert" style={{ margin: 0 }}>{styleError}</p>}
              {styleNotice && <p role="status" style={{ margin: 0 }}>{styleNotice}</p>}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn" disabled={styleBusy || styleTesting} onClick={() => void testStyleConnection()}>{styleTesting ? '测试中…' : '测试编曲连接'}</button>
                <button className="btn primary" disabled={styleBusy || styleTesting}>{styleBusy ? '处理中…' : '保存编曲模型'}</button>
                <button type="button" className="btn danger" disabled={styleBusy || styleTesting || !styleStatus?.account} onClick={() => void clearStyle()}>清除编曲配置</button>
              </div>
            </form>
          </>
        )}
      </section>
      </>
    )}
    <p>{cloud ? '邮箱用于登录，当前尚未发送验证邮件；暂不支持邮件找回密码。' : '账号和作品保存在这台服务所在电脑。密码至少 8 位；本地版暂不提供邮件找回密码。'}</p>
  </div>;
}
