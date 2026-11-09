# 本地 Agent 后端

2026-11-09。本文件描述已实现的本地单文件游戏链路；原 MVP 方案中的云端 Worker、多文件 Phaser 工程与账号系统不因此视为已实现。

## 启动与使用

```bash
cd /home/sakara/MYolGame
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

这是项目自定义网关协议，不能直接填写模型供应商的聊天接口地址。服务错误不会进入模板兜底。响应限制 1 MiB，最终 HTML 限制 512 KiB。地址必须为 HTTPS 或本机 HTTP；重定向不跟随。密钥仅通过服务端配置传递，不写入游戏、前端、任务消息或 Git。

### 可选配置

| 环境变量 | 默认值 / 说明 |
| --- | --- |
| `MYOLGAME_AGENT_PROVIDER` | 未设置时不启用；支持 `qoder`、`http` |
| `MYOLGAME_AGENT_COMMAND` | `qoderclicn`，仅管理员可配置的可执行文件路径 |
| `MYOLGAME_AGENT_NAME` | `Qoder CLI` 或 `自定义 Agent` |
| `MYOLGAME_AGENT_API_URL` | HTTP 模式完整请求地址 |
| `MYOLGAME_AGENT_API_KEY` | HTTP 模式服务访问令牌 |
| `MYOLGAME_AGENT_TIMEOUT_MS` | `180000`，任务总预算；范围 1000–600000 |
| `MYOLGAME_AGENT_MAX_ATTEMPTS` | `3`，含首次开发；范围 1–3 |
| `MYOLGAME_CHROME_PATH` | `/usr/bin/google-chrome` |

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

`tests/agent.test.ts` 使用受控 HTTP 网关、真实独立 Worker 和系统 Chrome，覆盖生成、二次源码修改、页面刷新继续查询、修复、取消、失败保留旧版、超时、回退冲突、权限、发布隔离和持久化恢复；不会消耗真实模型额度。

本次实现期间实际 Qoder 连通性检查在代理和临时直连下均遭遇上游重试失败，因此真实 Qoder 模型生成尚未验证成功。测试网关通过不等价于真实模型能满足玩法需求。

云端 `functions/index.ts` 仍运行原有模板/规格路径，没有接入本机 Worker。`infra/schema.sql` 补充了新建表时的可选字段形状，现有云端表不会自动迁移；本次没有部署或修改云端数据库。
