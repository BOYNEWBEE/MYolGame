# 本地 Agent 后端

2026-11-09，2026-11-19 更新 OpenAI 兼容 provider 与账号级游戏模型配置。本文件描述已实现的本地单文件游戏链路；原 MVP 方案中的真实云端 Worker 和多文件 Phaser 工程不因此视为已实现。账号和云端 M0 模拟任务的最新范围见 [M0 云端部署](M0云端部署.md)。

## 启动与使用

```bash
cd <项目目录>
npm install
npm run dev:agent
```

需要本机 `qoderclicn` 已安装、已登录且能正常调用模型，以及系统 Chrome。默认前端 `http://127.0.0.1:5173`，API 为 `http://127.0.0.1:8787`。

进入「创作游戏」，填写实际玩法需求，选择起始模板后提交。请求立即返回并进入工作台；Agent 在后台修改源码，执行浏览器检查，必要时修复。成功后自动预览新版本；可继续对话修改、下载源码、回退或手动发布。窗口刷新或暂时离开不影响任务执行。

普通 `npm run dev` 不主动开启 Agent，仍使用模板或原有模型规格接口。`MYOLGAME_MODEL_*` 是原有规格调整服务；`MYOLGAME_AGENT_*` 是新的源码开发服务，两者协议不同；开启 Agent 后优先走 Agent。

## 数据与执行过程

```text
业务 API → 持久化 queued 任务 → 本地调度器 → 独立 Node Worker
                                              ↓
                                    读取基础版本完整 HTML
                                              ↓
                                  请求 Agent 返回完整新 HTML
                                              ↓
                                  写入任务独立目录 index.html
                                              ↓
                               Chrome 检查 → 失败反馈 → 有限修复
                                              ↓
                              原子保存源码版本、项目指针和任务结果
```

- API 进程独占文件数据库，Worker 只通过 IPC 返回阶段与结果。只运行一个使用相同 `data/db.json` 的 API 实例；这是本地原型，未实现多实例文件数据库协调。
- `data/db.json` 保存任务、消息、完整 HTML 源码快照、父版本、SHA-256、浏览器检查结果和当前版本。单文件 HTML 本身即源码与运行产物，不需要 npm 构建。平台前端仍单独执行 Vite 构建。
- `.sandboxes/<task-id>/` 为任务独立目录，保存候选 `index.html` 和检查截图 `preview.png`，不作为版本唯一数据源。清理前先停止服务；源码快照已写入数据库的版本不依赖此目录。当前不自动清理历史沙箱。
- Agent 版本中的模板分类和参数作为起始配置参考，具体新玩法以保存的 HTML 和实际试玩为准。
- 同一项目仅允许一个活动任务，全局同时执行一个 Worker，最多等待 20 个任务。重复提交活动项目返回 `409 task_active`。
- 提交时记录基础版本和项目更新时间。完成提交与项目修改共用锁，并再次核对基础信息；执行期间发生回退等变更时，新结果拒绝提交，用户选择保持有效。
- 取消、删除项目或超时会终止 Worker 所在进程组，清理 CLI/Chrome 后代。服务正常关闭会取消未完成任务；异常重启时持久化的未完成任务标为失败，用户可重新提交，不自动重放。
- 工作台以轮询显示真实阶段；刷新后从数据库恢复。浏览器断开不取消任务。当前没有 SSE、自动重试队列或外部队列服务。
- 发布记录绑定具体版本；生成草稿和回退不改变公开游戏，须用户手动再次发布。

## Agent 提供方式

### Qoder CLI

`npm run dev:agent` 等价于为本次服务设置 `MYOLGAME_AGENT_PROVIDER=qoder` 后启动。

Worker 通过标准输入传入需求、规格参考和基础源码；CLI 以非交互文本模式返回完整 HTML。关闭全部内置工具、MCP 和会话持久化，仅加载用户级设置。模型无权运行命令或读写宿主文件；产物写入与浏览器检查由固定 Worker 代码完成。

Qoder 仍使用当前系统用户的登录配置及网络代理。新旧 CLI 的行为可能不同，升级后应复测。不要将浏览器中的请求参数当作 CLI 命令或参数。

### 自定义 HTTP Agent

不使用 Qoder 时，可运行自己的模型适配服务：

```bash
export MYOLGAME_AGENT_PROVIDER=http
export MYOLGAME_AGENT_API_URL=https://your-agent.example/generate-html
read -rsp "Agent 访问令牌: " MYOLGAME_AGENT_API_KEY
echo
export MYOLGAME_AGENT_API_KEY
npm run dev
```

Worker 请求如下，`prompt` 已包含用户需求、当前完整 HTML、输出约束和上次检查失败的反馈。适配服务将这些内容交给所选模型，并提取完整 HTML：

```http
POST /generate-html
Content-Type: application/json
Authorization: Bearer <MYOLGAME_AGENT_API_KEY>
```

```json
{"prompt":"完整开发或修复要求及基础源码", "response_format":"html"}
```

返回：

```json
{"html":"<!doctype html><html>完整游戏源码</html>"}
```

这是项目自定义网关协议，不能直接填写模型供应商的聊天接口地址；需要直接调用聊天接口时使用 `openai` provider。服务错误不会进入模板兜底。响应限制 1 MiB，最终 HTML 限制 512 KiB。地址默认必须为 HTTPS；本机回环 HTTP 仅在 `MYOLGAME_AGENT_ALLOW_LOCAL=1` 时放行，重定向不跟随。密钥仅通过服务端配置传递，不写入游戏、前端、任务消息或 Git。

### OpenAI 兼容游戏开发模型

`MYOLGAME_AGENT_PROVIDER=openai` 时，Worker 直接请求 OpenAI 兼容的聊天接口，不经过自定义网关：

```http
POST <API_URL 归一化后的 /chat/completions>
Content-Type: application/json
Authorization: Bearer <MYOLGAME_AGENT_API_KEY>
```

```json
{
  "model": "your-model-name",
  "temperature": 0.2,
  "max_tokens": 8192,
  "stream": false,
  "messages": [
    {"role": "system", "content": "只输出 JSON 修改指令，不要输出完整 HTML..."},
    {"role": "user", "content": "用户需求 + 当前完整源码 + 输出约束 + 上次检查反馈"}
  ]
}
```

模型只返回修改片段，不重写整份游戏，避免完整源码超出输出 token 上限：

```json
{"edits":[
  {"find":"源码中逐字复制且全文中唯一的原文","replace":"替换后的代码"},
  {"find":"另一处唯一锚点","replace":""}
]}
```

服务端只读取 `choices[0].message.content`（字符串或 `{type:"text"}` 分段数组），从纯文本或 Markdown 代码块中解析 `{"edits":[...]}`。修改按数组顺序应用：每条 `find` 必须与当前源码完全一致且只出现一次，`replace` 可为空字符串表示删除；任一条失败会把具体原因作为反馈进入下一次修复请求。应用后的结果必须仍是完整 `<!doctype html>`…`</html>` 文档且不超过 512 KiB。若模型仍返回完整 HTML，提取成功时也兼容接受。`finish_reason=length` 仍视为截断并失败。地址可填基址、`/v1` 基址或完整 `/chat/completions` 地址；无路径基址仅在首个地址返回 404 时补试 `/v1/chat/completions`，其他错误不重试。请求不跟随重定向，避免把密钥带到未配置目标。

首次请求的源码基底是用户选择的模板源码；后续请求使用当前有效版本的完整 HTML；回退后基于回退版本继续。模型输出只作为 HTML 数据保存和检查，不在宿主机执行。

#### 账号级模型配置

以 `MYOLGAME_AGENT_PROVIDER=openai` 启动后，登录账号可在「账号管理」→「游戏源码开发模型（OpenAI 兼容）」保存自己的接口地址、模型名与密钥，并对当前填写（未填写时依次沿用已保存配置、服务端默认配置）执行一次连接测试。

- 任务按项目所有者执行：账号配置优先于 `MYOLGAME_AGENT_API_URL`／`MYOLGAME_AGENT_API_KEY`／`MYOLGAME_AGENT_MODEL` 环境默认值；两者都缺失时任务以 `model_not_configured` 失败并保留原版本，不回退模板。
- 接口为 `GET/PUT/DELETE /api/agent/model` 与 `POST /api/agent/model/test`，均需创作者令牌。仅在 openai provider 下开放保存与测试，Qoder CLI 或自定义 HTTP 网关模式返回 `agent_model_unavailable`。
- 读取结果只返回 `hasKey`；密钥保存在服务端 FileStore（`data/db.json`），不进入前端、任务、日志、错误响应或导出源码。游客保存的配置在注册/登录时迁移到账号。
- 连接测试发送一次 `max_tokens: 16` 的最小请求，不生成游戏、不保存配置，可能产生少量模型费用；404 时按同样规则补试 `/v1`，错误沿用 `model_*` 分类。
- 地址默认 HTTPS；回环 HTTP 需服务端显式设置 `MYOLGAME_AGENT_ALLOW_LOCAL=1`。云端入口尚未建表，也未开放该功能。

错误分类（任务会记录 `errorCode`，界面显示中文说明）：

| 错误码 | 含义 |
| --- | --- |
| `model_timeout` | 请求超时或任务总预算耗尽 |
| `model_auth_failed` | 401/403，密钥或权限不足 |
| `model_rate_limited` | 429 |
| `model_empty_output` | 模型返回空内容 |
| `model_truncated` | `finish_reason=length` |
| `model_invalid_response` | 非 JSON、缺少 choices 或无法解析文本 |
| `model_too_large` | 响应超过 `MYOLGAME_AGENT_MAX_RESPONSE_BYTES` |
| `model_unreachable` | 网络不可达 |
| `model_not_configured` | 地址、密钥或模型名缺失 |
| `invalid_html` | 模型没有返回完整 HTML 文档 |
| `invalid_edit` | 修改片段 JSON 无效、锚点缺失/重复或结果不再完整 |
| `check_failed` | 浏览器检查连续未通过 |
| `browser_unavailable` | 无法启动或创建浏览器上下文 |
| `version_conflict` | 执行期间项目版本发生变化 |
| `interrupted` / `worker_failed` / `cancelled` | 重启中断、Worker 异常、用户取消 |

只有 `invalid_html`、`invalid_edit` 与浏览器检查失败会带着当前源码和错误信息进入下一次修复；模型请求本身失败直接结束任务并保留原版本，不会自动重放结果未知的生成请求。密钥只进入发往模型的 `Authorization` 头，不写入任务、错误、版本、导出源码或前端。

### 可选配置

| 环境变量 | 默认值 / 说明 |
| --- | --- |
| `MYOLGAME_AGENT_PROVIDER` | 未设置时不启用；支持 `qoder`、`http`、`openai` |
| `MYOLGAME_AGENT_COMMAND` | `qoderclicn`，仅管理员可配置的可执行文件路径 |
| `MYOLGAME_AGENT_NAME` | `Qoder CLI`、`自定义 Agent` 或 `OpenAI 兼容（model）` |
| `MYOLGAME_AGENT_API_URL` | HTTP 模式必填；OpenAI 模式可选，作为账号配置缺失时的默认地址；默认仅 HTTPS |
| `MYOLGAME_AGENT_API_KEY` | HTTP 模式必填；OpenAI 模式可选默认密钥 |
| `MYOLGAME_AGENT_MODEL` | HTTP/Qoder 模式不需要；OpenAI 模式可选默认模型，账号配置可覆盖；1–128 位字母、数字或 `._:/-` |
| `MYOLGAME_AGENT_TIMEOUT_MS` | `180000`，任务总预算；范围 1000–600000 |
| `MYOLGAME_AGENT_REQUEST_TIMEOUT_MS` | 单次模型请求超时，默认 `min(TIMEOUT_MS, 120000)` |
| `MYOLGAME_AGENT_MAX_REPAIRS` | 可选 0–3；设置后总尝试数 = 修复次数 + 1 |
| `MYOLGAME_AGENT_MAX_ATTEMPTS` | 未设置 `MAX_REPAIRS` 时生效，默认 3；范围 1–4 |
| `MYOLGAME_AGENT_MAX_OUTPUT_TOKENS` | `8192`；范围 256–32768 |
| `MYOLGAME_AGENT_MAX_RESPONSE_BYTES` | `1048576`；范围 64 KiB–4 MiB |
| `MYOLGAME_AGENT_ALLOW_LOCAL` | 设为 `1`/`true` 时允许回环 HTTP 模型地址；默认拒绝 |
| `MYOLGAME_CHROME_PATH` | 未设置时按平台查找 Chrome/Edge |

`.env.example` 仅为配置参考；当前启动器不会自动加载 `.env`。

## 检查与隔离边界

生成源码只在启用 Chrome 自身沙箱的全新浏览器上下文中执行，不在 Node 执行。游戏响应使用 CSP `sandbox allow-scripts`，无同源权限，禁用网络连接与外部资源加载、嵌入页面、Worker 和表单；检查时另行拦截全部外部请求与导航。CSP 并非完整网络防火墙，未经检查或恶意延时导航等行为不能靠有限烟测完全排除。浏览器上下文不含平台令牌或数据库配置。游戏不得使用外部 CDN、网络素材或任意依赖。

每个游戏需暴露烟测接口：

```js
// 返回玩法状态，不包含时间、随机值与纯动画；重启同步恢复初次加载的状态。
window.__MYOLGAME_TEST__ = {
  getState: () => ({ /* 与玩法有关的可序列化状态 */ }),
  reset: () => { /* 重启游戏 */ }
};
```

检查完整 HTML、体积、非空 Canvas 2D 画面、空格和方向键后状态变化、重启后状态恢复、400×360 视口内画布边界、脚本/控制台错误，并保存截图哈希。检查失败会连同候选源码交给 Agent 修复，达到次数或总时间上限即失败。通过检查仍须人工试玩确认碰撞、胜负、关卡、难度及具体用户需求；模型提供的检查接口不能独立证明这些语义正确。

这是受限的 HTML 生成循环，不向 Agent 开放 shell、任意文件工具或平台数据库。任务目录本身不是完整操作系统容器。不能将本地匿名会话原型直接当作开放公网的多租户执行平台。

## API

启用 Agent 后：

- `POST /api/projects`、`POST /api/projects/:id/tasks` 返回 `202 { project, task }`，不会等待模型。
- `GET /api/projects/:id` 返回项目、版本、消息与任务列表。
- `GET /api/projects/:id/tasks/:taskId` 查询单个任务。
- `POST /api/projects/:id/tasks/:taskId/cancel` 取消任务，重复取消终态任务无副作用。
- 所有项目与任务接口验证创作者令牌；读取他人任务被拒绝。

状态为 `queued → running → checking → succeeded`；失败检查可进入 `repairing`；其他终态为 `failed`、`cancelled`、`timed_out`。

## 验证及当前限制

```bash
npm run typecheck
npm run build
npm test
```

`tests/agent.test.ts` 使用受控 HTTP 网关、真实独立 Worker 和系统 Chrome，覆盖生成、二次源码修改、页面刷新继续查询、修复、取消、失败保留旧版、超时、回退冲突、权限、发布隔离和持久化恢复；不会消耗真实模型额度。`tests/openai-provider.test.ts` 使用受控 OpenAI 兼容假服务，覆盖请求格式、Markdown 提取、模板/上一版本/回退版本源码链、修复、401/429/超时/空输出/截断/非法响应、并发与取消、密钥边界；`tests/game-model.test.ts` 覆盖账号级配置解析、连接测试与 404 回退、保存/掩码/清除、账号隔离、账号配置优先于服务端默认、缺失配置失败，以及真实 Chrome 中的账号管理面板保存与连接测试；`tests/platform.test.ts` 覆盖数据文件损坏保护、Windows 启动与浏览器路径解析。

本次实现期间实际 Qoder 连通性检查在代理和临时直连下均遭遇上游重试失败，因此真实 Qoder 模型生成尚未验证成功。测试网关通过不等价于真实模型能满足玩法需求。

云端 `functions/index.ts` 仍运行原有模板/规格路径，没有接入本机 Worker。`infra/schema.sql` 补充了新建表时的可选字段形状，现有云端表不会自动迁移；本次没有部署或修改云端数据库。
