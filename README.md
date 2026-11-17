# MYolGame

通过提示词在浏览器中创作、修改和发布 2D 网页小游戏的本地原型。

## 当前阶段

初版已实现并本地可运行：

- 五种内置 Canvas 模板（打砖块 / 贪吃蛇 / 太空射击 / 俄罗斯方块 / 2048），由规格配置确定性生成；
- 社区创作模板：官方示例、用户从指定版本发布、参数搭配、试玩、私有套用、上下架与来源许可保留；
- 可选的 AI 配乐：服务端配置音乐 HTTP 网关后，生成内置模板游戏时调用 API 制作循环配乐并内嵌到单文件 HTML，失败回退为无配乐；
- 可选的本地 Agent 源码开发：异步任务、独立 Worker、单文件源码修改、浏览器烟测、失败修复、取消与版本回退；
- 社区首页、创作页、工作台、我的项目、我的收藏、游戏详情与试玩；
- 本地文件持久化、账号注册／登录／密码修改，以及游客身份；
- 源码包 ZIP、单文件 HTML 下载；
- 端到端浏览器测试与 node:test 单元测试。

**云端 M0 已创建并发布**：[邮箱账号](https://myol-game-bq5p9vqwgrc.qoder.zone/#/account)、[模拟任务](https://myol-game-bq5p9vqwgrc.qoder.zone/#/m0)。数据库迁移和健康接口已验证，用户截图确认普通浏览器登录页可访问；注册登录业务验收及后台调度仍待完成。Qoder Function 后端入口支持邮箱账号、数据库模拟任务队列、后台消费接口和 SSE 进度恢复。公网 M0 只执行明确标记的模拟任务，不生成游戏。执行 `npm run package:cloud` 可生成部署输入归档；迁移、配置、独立云端调度和验收步骤见 [M0 云端部署](docs/M0云端部署.md)。

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

## 社区创作模板

启动后点击导航栏「社区模板」。作者在工作台选择预览版本，再通过「发布创作模板」填写需求、参数与许可。
其他用户可试玩、原样套用，或启用 Agent 后按参数开发自己的私有副本。
示例源码固定保存，原作者更新、删除源项目或下架模板，不会覆盖已有副本。

使用说明、API 和已有云端数据库迁移要求见 [社区模板说明](docs/社区模板.md)。

## AI 配乐

默认关闭。服务端配置音乐网关后，或登录账号并在「账号管理」中保存自己的网关后，创作页会启用「AI 生成配乐」；生成时按模板、主题与速度确定音乐提示词，调用区域外部的 HTTP 接口制作 20 秒循环配乐，并以 data URI 内嵌到游戏，产物仍是可离线运行、无外部请求的单文件 HTML。

```bash
# 本地通过 shell 导出；不要写入前端或提交到 Git
MYOLGAME_MUSIC_API_URL=https://your-music-gateway.example/generate
MYOLGAME_MUSIC_API_KEY=服务端密钥
MYOLGAME_MUSIC_NAME=可选模型名
```

网关契约：`POST` JSON `{ prompt, durationSeconds, format: "mp3", loop: true, model? }`，请求头带 `Authorization: Bearer <key>`。响应可以是 `content-type: audio/*` 的音频字节，也可以是 JSON `{ "audioBase64": "...", "mimeType": "audio/mpeg" }`。仅接受常见音频类型，原始音频上限 240KB；超时 30 秒。

未配置、请求失败、超时、类型不符或超限时会回退为无配乐，并在任务阶段与提示中如实标记，不会伪装成生成成功。相同提示词在单个进程内复用缓存；当前只对内置模板游戏生效，Agent 源码游戏保持原样。云端入口预留 `APP_MUSIC_API_URL`、`APP_MUSIC_API_KEY`、`APP_MUSIC_NAME`，尚未部署或联调。

登录后可在「账号管理」的「AI 配乐 API」面板保存接口地址、密钥与可选模型名。配置按账号保存在服务端，读写接口（`GET/PUT/DELETE /api/music/settings`）只返回是否已保存密钥，不回传密钥；生成时账号配置优先于服务端环境变量。接口地址仅接受 HTTPS，本机调试放行 `http://127.0.0.1` 与 `http://localhost`；保存时不会主动请求上游校验，首次生成失败同样回退。面板提供「测试连接」（`POST /api/music/settings/test`）：用当前表单值发起一次约 5 秒的短配乐请求，密钥留空时沿用已保存的密钥，成功展示返回类型、大小与耗时，失败展示错误原因；测试不会保存配置、不回传音频，但会真实调用上游并可能产生费用。创作页选择「AI 生成配乐」后可填写最多 200 字的配乐提示词，它会作为附加风格描述与自动生成的提示词一起发送，并随版本规格保存。云端需要新增 `myol_music_settings` 表，迁移草案见 [20261117_music_settings.sql](infra/migrations/20261117_music_settings.sql)，尚未部署。

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
- Agent 异步源码生成、二次修改、检查后修复、取消、超时、回退冲突、重启恢复和私有预览资源限制；
- 社区模板发布、参数约束、跨会话套用、源码继承、许可导出、上下架与副本隔离；
- AI 配乐网关的字节／base64 响应、参数契约、缓存、失败回退，以及真实 Chrome 中的播放与暂停。
- 账号级配乐设置：保存、密钥掩码读取、会话隔离、账号配置优先与清除回退，以及真实 Chrome 中注册 → 保存接口 → 创作页生成。
- 配乐接口的连接测试：临时参数直连、已保存密钥回退、上游失败码、非法地址与测试不落库，以及真实 Chrome 中留空密钥测试后仍能正常生成。
- 配乐提示词的清理、长度限制、规格持久化，以及生成请求实际携带附加风格描述。

## 限制说明

- 默认启动为**模板模式**；`npm run dev:agent` 使用本机 Qoder CLI，需安装、登录且能访问其模型服务。版本分别标记模板、模型辅助或 Agent 源码开发。
- Agent 当前仅支持本机 Node Worker 与自包含 HTML 游戏；未实现云端 Worker、多文件依赖构建或任意命令执行。
- 浏览器检查为画布、按键状态与重启烟测，不能证明用户需求的所有玩法均正确。
- 本地版支持**用户名＋密码**注册登录，入口为顶部“登录 / 注册”或 `/account`；游客项目、收藏及模板在注册或登录时自动合并，旧游客令牌撤销。同一本地服务内可跨浏览器登录。账号、密码哈希和会话保存在 `data/db.json`，请保护并备份该文件；不要提交到 Git。密码为 8–128 位，使用带随机盐的 scrypt 哈希；登录 Cookie 为 HttpOnly、SameSite=Strict，有效期 7 天。支持退出当前登录、修改密码并撤销所有登录；暂不提供邮件验证、忘记密码恢复、管理员账号面板。云端入口使用独立的邮箱账号模块，两个账号存储不自动同步。
- 云端 M0 需 Qoder `function_backend`、当前注入 SDK 和应用凭据透传支持；独立云端调度调用消费接口。迁移和发布已完成；公网双账号业务验收和后台调度运行仍待完成。
- AI 配乐依赖外部音乐服务，其费用、授权与内容合规由接入的服务决定；当前没有按用户计费、内容审核或持久缓存，进程重启后会重新生成。Agent 源码游戏不自动注入配乐。账号保存的接口密钥以明文存放在服务端（`data/db.json` 或云端数据库），读写接口不回传密钥；请保护数据文件，并使用仅限配乐生成的专用密钥。
- 运行数据、截图、构建产物与依赖目录均不进入 Git。

## Cloud Agents 实验分支

`experiment/cloud-agents-route` 保留原 M0，新增 `/experiments/qca` 和默认关闭的实验接口，验证单轮 HTML 生成、独立会话和结果恢复。

```bash
npm run test:qca       # 受控 API 和真实 HTTPS Chrome，不调用真实模型
npm run dev:qca-lab    # 本机受控演示，默认 https://127.0.0.1:8790/account
```

初始分支 42 项完整测试通过。经用户授权，已发布[独立私有测试站点](https://myolgame-qca-lab-bq5p9vqwgrc.qoder.zone/#/experiments/qca)，开通平台托管 Cloud Agents 凭据并应用独立实验库；已由普通浏览器使用 dfmodel 完成一次真实单轮生成，数据库保存 4076 字节 HTML，用户截图确认候选预览已渲染。真实关页恢复、持续修改和完整玩法验收仍待完成；原 M0 站点未更新。配置、成本限制和故障边界见 [Cloud Agents 实验](docs/CloudAgents实验.md)。
