# MYolGame

通过提示词在浏览器中创作、修改和发布 2D 网页小游戏的本地原型。

## 当前阶段

初版已实现并本地可运行：

- 五种内置 Canvas 模板（打砖块 / 贪吃蛇 / 太空射击 / 俄罗斯方块 / 2048），由规格配置确定性生成；
- 社区创作模板：官方示例、用户从指定版本发布、参数搭配、试玩、私有套用、上下架与来源许可保留；
- 浏览器内置合成配乐：提示词里的乐器与情绪关键词直接切换音色、调性与旋律，不依赖外部音乐接口；
- 可选的 AI 编曲：配置 OpenAI 兼容模型后，模型只输出受限的音乐风格参数，用于调整浏览器内置霓虹合成配乐的 BPM、和弦与音色，不生成或执行代码；
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

## 内置合成配乐

游戏配乐全部由浏览器实时合成，不调用外部音乐接口，也不产生按次调用费用。配乐选项为「霓虹街机」与「AI 编曲（实时合成）」：前者不依赖模型，提示词里的乐器与情绪关键词直接决定音色、调性与旋律；后者在配置 OpenAI 兼容编曲模型后由模型返回受限参数。所有音频都用 `OfflineAudioContext` 在浏览器内生成，产物仍是可离线运行、无外部请求的单文件 HTML。此前的外部「AI 配乐（音乐模型）」与音乐网关已移除；旧规格中的 `ai-generated` 会自动回退为霓虹街机合成。

### AI 编曲模型（OpenAI 兼容）

霓虹打砖块默认使用浏览器内 `OfflineAudioContext` 实时合成的 32 秒循环配乐。配置一个 OpenAI 兼容模型（如 DeepSeek）后，生成时会额外请求模型，让它只返回一组受限的音乐风格参数：`bpm`、和弦进行、移调、主旋律／贝斯／底鼓波形、主旋律音色（`instrument`：chip、piano、music-box、strings、flute、organ、guitar）、和弦铺底（`pad`：none、warm、strings）、音符密度、swing、八度与随机种子。非 chip 音色由多个振荡器谐波、低通滤波与包络叠加而成；铺底会按每小节和弦加入持续层，默认 `chip`/`none` 保持原版听感。和弦进行提供 minor、major、dorian、phrygian、lydian、mixolydian、harmonic-minor、suspended 八种，`transpose` 支持 −7 到 7 半音移调；种子还会切换旋律型与低频节奏。服务端逐字段白名单与钳制后写入版本规格，再注入 HTML 交给合成器；模型不能输出 JavaScript，也不能改变模板、玩法或页面结构。提示词里明确写钢琴、弦乐、长笛、八音盒、管风琴或吉他时，即使模型不可用，也会按关键词选择音色并在任务阶段标记「按提示词选择音色与调性」。提示词中的情绪词也会直接改变调性与旋律：悬疑／紧张／恐怖 → phrygian 并移调 −2，悲伤／忧郁 → harmonic-minor、−3，明亮／欢快 → major、+2，梦幻／空灵／治愈 → suspended、+1，复古／怀旧 → mixolydian、−1，科幻／赛博 → dorian、+3；同时按提示词的 FNV-1a 哈希生成 1–9999 的旋律种子，相同提示词得到相同结果。模型只返回部分字段时，未给出的和弦进行、移调与种子由关键词补齐，不会覆盖模型明确选择的值。

```bash
# 本地通过 shell 导出；不要写入前端或提交到 Git
MYOLGAME_MUSIC_STYLE_API_URL=https://api.deepseek.com
MYOLGAME_MUSIC_STYLE_API_KEY=服务端密钥
MYOLGAME_MUSIC_STYLE_MODEL=deepseek-chat
```

地址可填基址（自动追加 `/chat/completions`）、`/v1` 基址或完整地址；无路径的基址在首个请求返回 404 时会自动补试 `/v1/chat/completions`，兼容 OpenAI 等要求版本前缀的服务。请求为 `POST`，携带 `Authorization: Bearer <key>` 与 `{ model, messages, temperature, max_tokens, stream: false }`，20 秒超时、响应上限 64KB。模型输出会被提取为首个 JSON 对象，至少包含一个已知字段才被视为有效。系统提示要求模型尽量避开默认调性与和弦，并随机选择种子；提示词提到乐器时优先选择对应 `instrument`，提到铺底或氛围时选择 `pad`。任务阶段会显示实际使用的模型、BPM 与和弦进行。创作页可先用提示词生成编曲试听（`POST /api/music/style/preview`）：模型返回参数后由 iframe 实时合成播放，生成游戏时携带 `musicStylePreviewed` 明确复用该参数，不再重复请求模型；未生成试听时，下方预览会按提示词关键词实时切换音色、调性与旋律型，没有关键词时保持默认风格。未配置编曲模型但提示词包含乐器或情绪关键词时，创作页可直接使用「按提示词识别风格试听」，服务端生成同样按键词写入 `instrument`/`pad`/和弦进行/移调/种子，不依赖模型。创作页的「AI 编曲（实时合成）」选项在配置模型后启用；选择「霓虹街机」时，若模型已配置也会自动调整。未配置、超时、HTTP 失败、非 JSON 或字段缺失时回退默认霓虹参数；显式选择 AI 编曲但模型未配置时，仍会生成默认合成配乐并在任务阶段标记 `style_model_not_configured`，模型调用失败则标记 `style_model_failed`。默认参数保持原版听感。云端入口预留 `APP_MUSIC_STYLE_API_URL`、`APP_MUSIC_STYLE_API_KEY`、`APP_MUSIC_STYLE_MODEL`；账号级配置保存在 `myol_music_style_settings` 表（迁移草案 [20261117_music_style_settings.sql](infra/migrations/20261117_music_style_settings.sql)，尚未部署），读写接口为 `GET/PUT/DELETE /api/music/style-model`，同样只回传 `hasKey`，密钥不出服务端。登录后可在「账号管理」的「AI 编曲模型（OpenAI 兼容）」面板填写地址、模型名与密钥，保存时只校验地址协议与模型名格式，不请求上游；「测试编曲连接」会用当前填写（或已保存）的配置真实请求一次模型，展示返回的模型名、BPM 与和弦进行，失败时显示错误原因与实际请求地址，便于在保存前确认地址、密钥与模型名可用，测试不会写入配置。

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
- 编曲模型：风格参数钳制与白名单、OpenAI 兼容地址归一化与无路径基址的 `/v1` 回退、代码块 JSON 提取、上游失败／非 JSON／无关字段回退、仅霓虹街机调用、账号级编曲配置的保存、掩码、隔离、环境变量回退与生成接入，以及试听参数复用。
- 创作页试听：编曲试听接口返回模型参数并由 iframe 实际播放，真实 Chrome 确认参数展示与生成时不再重复请求模型；未配置模型时关键词试听与生成保持一致。
- 配乐规格：只接受浏览器合成配乐，旧 `ai-generated` 规格回退为霓虹街机，生成产物不包含外部音频。
- 乐器音色：`instrument`/`pad` 白名单与钳制、模型提示词字段、提示词关键词回退（未配置模型也可用钢琴等音色）、真实 Chrome 中钢琴试听的频谱起伏与生成产物写入。
- 提示词调性：情绪关键词映射和弦进行与移调、FNV-1a 提示词种子、模型部分字段补齐与显式字段保留、默认提示词保持原版参数，以及未配置模型时试听与生成使用同一套参数。

## 限制说明

- 默认启动为**模板模式**；`npm run dev:agent` 使用本机 Qoder CLI，需安装、登录且能访问其模型服务。版本分别标记模板、模型辅助或 Agent 源码开发。
- Agent 当前仅支持本机 Node Worker 与自包含 HTML 游戏；未实现云端 Worker、多文件依赖构建或任意命令执行。
- 浏览器检查为画布、按键状态与重启烟测，不能证明用户需求的所有玩法均正确。
- 本地版支持**用户名＋密码**注册登录，入口为顶部“登录 / 注册”或 `/account`；游客项目、收藏及模板在注册或登录时自动合并，旧游客令牌撤销。同一本地服务内可跨浏览器登录。账号、密码哈希和会话保存在 `data/db.json`，请保护并备份该文件；不要提交到 Git。密码为 8–128 位，使用带随机盐的 scrypt 哈希；登录 Cookie 为 HttpOnly、SameSite=Strict，有效期 7 天。支持退出当前登录、修改密码并撤销所有登录；暂不提供邮件验证、忘记密码恢复、管理员账号面板。云端入口使用独立的邮箱账号模块，两个账号存储不自动同步。
- 云端 M0 需 Qoder `function_backend`、当前注入 SDK 和应用凭据透传支持；独立云端调度调用消费接口。迁移和发布已完成；公网双账号业务验收和后台调度运行仍待完成。
- AI 编曲模型只影响内置霓虹合成配乐的受限参数，不改变模板与玩法，也不执行模型输出；模型调用失败时静默回退默认参数，因此生成成功不代表模型一定参与。模型费用与输出质量由接入的服务决定；账号密钥以明文存放在服务端，接口不回传密钥。
- 运行数据、截图、构建产物与依赖目录均不进入 Git。

## Cloud Agents 实验分支

`experiment/cloud-agents-route` 保留原 M0，新增 `/experiments/qca` 和默认关闭的实验接口，验证单轮 HTML 生成、独立会话和结果恢复。

```bash
npm run test:qca       # 受控 API 和真实 HTTPS Chrome，不调用真实模型
npm run dev:qca-lab    # 本机受控演示，默认 https://127.0.0.1:8790/account
```

初始分支 42 项完整测试通过。经用户授权，已发布[独立私有测试站点](https://myolgame-qca-lab-bq5p9vqwgrc.qoder.zone/#/experiments/qca)，开通平台托管 Cloud Agents 凭据并应用独立实验库；已由普通浏览器使用 dfmodel 完成一次真实单轮生成，数据库保存 4076 字节 HTML，用户截图确认候选预览已渲染。真实关页恢复、持续修改和完整玩法验收仍待完成；原 M0 站点未更新。配置、成本限制和故障边界见 [Cloud Agents 实验](docs/CloudAgents实验.md)。
