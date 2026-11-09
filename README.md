# MYolGame

通过提示词在浏览器中创作、修改和发布 2D 网页小游戏的本地原型。

## 当前阶段

初版已实现并本地可运行：

- 五种内置 Canvas 模板（打砖块 / 贪吃蛇 / 太空射击 / 俄罗斯方块 / 2048），由规格配置确定性生成；
- 可选的本地 Agent 源码开发：异步任务、独立 Worker、单文件源码修改、浏览器烟测、失败修复、取消与版本回退；
- 社区首页、创作页、工作台、我的项目、我的收藏、游戏详情与试玩；
- 本地文件持久化与匿名会话 + 创作者令牌；
- 源码包 ZIP、单文件 HTML 下载；
- 端到端浏览器测试与 node:test 单元测试。

**尚未验证云端部署**：Qoder Sites / Supabase / Deno Edge Function 适配已按接口设计完成，但未在云端实际部署或联调。

## 本地启动

```bash
npm install
npm run dev
```

服务启动后：

- 前端：http://127.0.0.1:5173
- API：http://127.0.0.1:8787/functions/v1/app/api/meta
- 数据文件：`data/db.json`（真实持久化，Git 忽略）

也可以只启动 API：

```bash
npm run dev:api
```

## 启动 Agent 后端

本机已安装并登录 Qoder CLI 时：

```bash
npm run dev:agent
```

这会为本次服务启用 Qoder 源码开发模式。普通 `npm run dev` 保留模板/规格调整模式。
模型失败会记录失败并保留旧版本，不会伪装成 Agent 成功或回退模板。
也支持接入自定义 HTTP Agent 服务，配置、协议与运行边界见 [Agent 后端说明](docs/Agent后端.md)。

## 验证

```bash
npm run typecheck
npm run build
npm test
```

测试使用系统 Chrome（`/usr/bin/google-chrome`）与 `playwright-core`，覆盖：

- 首页浏览与进入游戏详情；
- 三种内置游戏在真实 Chrome 中启动，空格/方向键/R 操作后 Canvas HUD 与画面持续渲染，并收集页面错误；
- 创建项目 → 工作台生成版本 → 提示词修改实际规格值 → 回退版本恢复原规格；
- 发布到社区；
- 第二个浏览器会话浏览、收藏、下载 HTML；
- 私有项目他人无法访问；
- 提示词解析、ZIP/源码包、handler 权限、FileStore 持久化；
- Agent 异步源码生成、二次修改、检查后修复、取消、超时、回退冲突、重启恢复和私有预览资源限制。

## 限制说明

- 默认启动为**模板模式**；`npm run dev:agent` 使用本机 Qoder CLI，需安装、登录且能访问其模型服务。版本分别标记模板、模型辅助或 Agent 源码开发。
- Agent 当前仅支持本机 Node Worker 与自包含 HTML 游戏；未实现云端 Worker、多文件依赖构建或任意命令执行。
- 浏览器检查为画布、按键状态与重启烟测，不能证明用户需求的所有玩法均正确。
- 身份为**匿名会话 + 创作者令牌**（浏览器 localStorage），不是完整账号系统；换浏览器或清除数据后无法找回项目。
- 云端 Supabase/Deno 适配按接口实现，但**未在云端实际运行验证**。
- 运行数据、截图、构建产物与依赖目录均不进入 Git。
