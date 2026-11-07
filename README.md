# MYolGame

通过提示词在浏览器中创作、修改和发布 2D 网页小游戏的本地原型。

## 当前阶段

初版已实现并本地可运行：

- 三种内置 Canvas 模板（打砖块 / 贪吃蛇 / 太空射击），由规格配置确定性生成；
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
- 提示词解析、ZIP/源码包、handler 权限、FileStore 持久化。

## 限制说明

- 初版为**模板模式**，未配置真实模型；界面已如实标记「模板生成」。
- 身份为**匿名会话 + 创作者令牌**（浏览器 localStorage），不是完整账号系统；换浏览器或清除数据后无法找回项目。
- 云端 Supabase/Deno 适配按接口实现，但**未在云端实际运行验证**。
- 运行数据、截图、构建产物与依赖目录均不进入 Git。
