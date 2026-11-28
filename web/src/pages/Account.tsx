import { useEffect, useState, type FormEvent } from 'react';
import { appHref } from '../routing.ts';
import { ApiError, requestJson } from '../api.ts';
import { fetchMusicStyleSettings, musicStyleErrorText, testMusicStyleSettings, type MusicStyleSettingsView } from '../music-style-settings.ts';
import {
  agentModelErrorText,
  clearAgentModelSettings,
  fetchAgentModelSettings,
  saveAgentModelSettings,
  testAgentModelSettings,
  type AgentModelSettingsView,
} from '../game-model-settings.ts';
import { useSession } from '../session.tsx';

export default function Account() {
  const session = useSession();
  const cloud = session.accountKind === 'email';
  const [register, setRegister] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [modelStatus, setModelStatus] = useState<AgentModelSettingsView | null>(null);
  const [modelUrl, setModelUrl] = useState('');
  const [modelName, setModelName] = useState('');
  const [modelKey, setModelKey] = useState('');
  const [modelLoading, setModelLoading] = useState(false);
  const [modelBusy, setModelBusy] = useState(false);
  const [modelTesting, setModelTesting] = useState(false);
  const [modelError, setModelError] = useState('');
  const [modelNotice, setModelNotice] = useState('');

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
    setModelLoading(true);
    setModelError('');
    fetchAgentModelSettings()
      .then((view) => {
        if (cancelled) return;
        setModelStatus(view);
        setModelUrl(view.account?.apiUrl ?? '');
        setModelName(view.account?.model ?? '');
      })
      .catch((e) => {
        if (!cancelled) setModelError(e instanceof Error ? e.message : '游戏模型配置读取失败');
      })
      .finally(() => {
        if (!cancelled) setModelLoading(false);
      });
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
        setStyleError('连接失败：' + musicStyleErrorText(result.error ?? '')
          + (result.url ? '（请求地址：' + result.url + '）' : ''));
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

  async function saveModel(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (modelBusy) return;
    setModelBusy(true);
    setModelError('');
    setModelNotice('');
    try {
      const body: { apiUrl: string; model: string; apiKey?: string } = { apiUrl: modelUrl, model: modelName };
      if (modelKey.trim()) body.apiKey = modelKey;
      const view = await saveAgentModelSettings(body);
      setModelStatus(view);
      setModelKey('');
      setModelNotice('已保存。由本账号创建或修改的项目将使用该模型进行源码开发。');
    } catch (e) {
      setModelError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setModelBusy(false);
    }
  }

  async function testModelConnection(): Promise<void> {
    if (modelBusy || modelTesting) return;
    setModelTesting(true);
    setModelError('');
    setModelNotice('');
    try {
      const body: { apiUrl?: string; apiKey?: string; model?: string } = {};
      if (modelUrl.trim()) body.apiUrl = modelUrl.trim();
      if (modelName.trim()) body.model = modelName.trim();
      if (modelKey.trim()) body.apiKey = modelKey.trim();
      const result = await testAgentModelSettings(body);
      if (!result.ok) {
        setModelError('连接失败：' + agentModelErrorText(result.error ?? '')
          + (result.url ? '（请求地址：' + result.url + '）' : ''));
        return;
      }
      const elapsed = result.elapsedMs === undefined ? '' : '，耗时 ' + (result.elapsedMs / 1000).toFixed(1) + ' 秒';
      const source = result.source === 'server' ? '（使用服务端配置）' : '';
      setModelNotice('连接正常：' + (result.model ?? modelName) + ' 回复「' + (result.reply ?? '') + '」' + elapsed + source + '。');
    } catch (e) {
      if (e instanceof ApiError) setModelError(e.message || agentModelErrorText(e.code));
      else setModelError(e instanceof Error ? e.message : '测试失败');
    } finally {
      setModelTesting(false);
    }
  }

  async function clearModel(): Promise<void> {
    if (modelBusy) return;
    setModelBusy(true);
    setModelError('');
    setModelNotice('');
    try {
      const view = await clearAgentModelSettings();
      setModelStatus(view);
      setModelUrl('');
      setModelName('');
      setModelKey('');
      setModelNotice(view.server ? '已清除账号配置，将改用服务端环境配置。' : '已清除账号配置。');
    } catch (e) {
      setModelError(e instanceof Error ? e.message : '清除失败');
    } finally {
      setModelBusy(false);
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
    {/* 页头与表单都套上液态玻璃（与其它页面一致：.page-head / .panel），
        切页入场动画由 glass-body-in（玻璃）+ content-blur-in（内部内容）统一驱动，
        无需额外写动画。 */}
    <div className="page-head">
      <h1>{session.account ? '账号管理' : register ? (cloud ? '注册邮箱账号' : '注册本地账号') : (cloud ? '登录邮箱账号' : '登录本地账号')}</h1>
      <p>{session.account ? `当前账号：${session.account.username}` : cloud ? '注册或登录后可提交云端 M0 模拟任务，并在刷新或重新登录后查看进度。' : '登录后可在连接同一本地服务的浏览器中访问作品。当前游客的项目和收藏会自动合并到账号。'}</p>
    </div>
    <section className="panel">
      <form onSubmit={submit} style={{ display: 'grid', gap: 16 }}>
        {!session.account && <label>{cloud ? '邮箱' : '用户名'}<input name="username" type={cloud ? 'email' : 'text'} required minLength={3} maxLength={cloud ? 254 : 32} pattern={cloud ? undefined : '[A-Za-z0-9_]+'} autoComplete="username" placeholder={cloud ? '请输入邮箱' : '3–32 位字母、数字或下划线'} /></label>}
        {!session.account && register && <label>昵称<input name="nickname" maxLength={20} autoComplete="nickname" /></label>}
        <label>{session.account ? '当前密码' : '密码'}<input name="password" type="password" required minLength={8} maxLength={128} autoComplete={register ? 'new-password' : 'current-password'} /></label>
        {register && !session.account && <label>确认密码<input name="confirmPassword" type="password" required minLength={8} maxLength={128} autoComplete="new-password" /></label>}
        {session.account && <label>新密码<input name="newPassword" type="password" required minLength={8} maxLength={128} autoComplete="new-password" /></label>}
        {error && <p role="alert">{error}</p>}
        <button className="btn primary" disabled={busy}>{busy ? '处理中…' : session.account ? '修改密码并退出所有登录' : register ? '注册并登录' : '登录'}</button>
      </form>
      <div className="account-actions">
        {session.account ? <button className="btn" disabled={busy} onClick={() => void act('logout', {})}>退出登录</button> : <button className="btn" disabled={busy} onClick={() => { setRegister(!register); setError(''); }}>{register ? '已有账号，去登录' : '没有账号，去注册'}</button>}
        <button className="btn" disabled={busy} onClick={() => {
          setBusy(true); setError('');
          void session.refresh().catch(e => setError(e instanceof Error ? e.message : '身份刷新失败')).finally(() => setBusy(false));
        }}>刷新登录状态</button>
      </div>
      <p className="panel-note">
        账号和作品保存在这台服务所在电脑。密码至少 8 位；本地版暂不提供邮件找回密码。
      </p>
    </section>
    {session.account && (
      <>
      <section className="panel" style={{ marginTop: 20, textAlign: 'left', display: 'grid', gap: 12 }}>
        <h2>游戏源码开发模型（OpenAI 兼容）</h2>
        <p className="panel-note" style={{ margin: 0 }}>
          用于「AI 源码开发模式」直接修改游戏 HTML/JavaScript；与下方编曲模型互相独立，可分别配置。填写 OpenAI 兼容接口地址与模型名，例如 DeepSeek：https://api.deepseek.com + deepseek-chat。密钥只保存在服务端，接口只回传是否已保存。
        </p>
        {session.cloudM0 ? <p className="panel-note" style={{ margin: 0 }}>
          当前部署为云端 M0 模拟阶段，账号级游戏开发模型设置暂不可用。
        </p> : modelLoading ? <p className="muted">正在读取配置…</p> : !modelStatus?.available ? (
          <p className="panel-note" style={{ margin: 0 }}>
            {modelStatus?.provider === 'qoder'
              ? '当前服务端使用 Qoder CLI 进行源码开发，账号级游戏模型配置不适用。'
              : modelStatus?.provider === 'http'
                ? '当前服务端使用自定义 HTTP Agent 进行源码开发，账号级游戏模型配置不适用。'
                : '服务端未启用源码开发模式：请在启动服务的终端运行 npm run dev:openai 后刷新本页。'}
          </p>
        ) : (
          <>
            <p className="muted small" role="status" style={{ margin: 0 }}>
              {modelStatus.account
                ? '账号配置：' + modelStatus.account.apiUrl + '（模型 ' + modelStatus.account.model + '）'
                : modelStatus.server
                  ? '未保存账号配置，当前使用服务端环境配置（模型 ' + (modelStatus.server.model ?? '未知') + '）。'
                  : '当前尚未配置游戏开发模型，提交源码开发任务会失败。'}
            </p>
            <form onSubmit={saveModel} style={{ display: 'grid', gap: 12 }}>
              <label className="field">
                <span className="field-label">游戏模型接口地址</span>
                <input type="text" inputMode="url" required maxLength={512} value={modelUrl} onChange={(e) => setModelUrl(e.target.value)} placeholder="https://api.deepseek.com" autoComplete="off" />
              </label>
              <label className="field">
                <span className="field-label">游戏模型名</span>
                <input type="text" required maxLength={128} value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder="deepseek-chat" autoComplete="off" />
              </label>
              <label className="field">
                <span className="field-label">游戏模型 API 密钥</span>
                <input type="password" maxLength={512} value={modelKey} onChange={(e) => setModelKey(e.target.value)} placeholder={modelStatus.account?.hasKey ? '已保存；留空则保持不变' : '输入服务提供的密钥'} autoComplete="new-password" />
              </label>
              <p className="panel-note" style={{ margin: 0 }}>
                仅支持 HTTPS；本机调试回环 HTTP 需服务端设置 MYOLGAME_AGENT_ALLOW_LOCAL=1。留空密钥表示沿用已保存的密钥（或服务端配置）。「测试连接」会真实请求一次模型，可能产生少量调用费用；测试不会保存配置。
              </p>
              {modelError && <p role="alert" style={{ margin: 0 }}>{modelError}</p>}
              {modelNotice && <p role="status" style={{ margin: 0 }}>{modelNotice}</p>}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn" disabled={modelBusy || modelTesting} onClick={() => void testModelConnection()}>{modelTesting ? '测试中…' : '测试连接'}</button>
                <button className="btn primary" disabled={modelBusy || modelTesting}>{modelBusy ? '处理中…' : '保存模型'}</button>
                <button type="button" className="btn danger" disabled={modelBusy || modelTesting || !modelStatus.account} onClick={() => void clearModel()}>清除账号模型配置</button>
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
    {/* 云端专属补充说明（本地版的那句已放进上方 .panel-note，避免重复） */}
    {cloud && <p className="panel-note">{'邮箱用于登录，当前尚未发送验证邮件；暂不支持邮件找回密码。'}</p>}
  </div>;
}
