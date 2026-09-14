# scf/feishu-callback — 飞书卡片回调函数（判分写回 + 时区切换）

n8n W3「飞书回调-写回笔记」的云原生移植（腾讯云 SCF）。接收飞书卡片回调（交卷/晨间打卡/晚间复盘/时区切换按钮），判分并写回 GitHub 仓库中的当日日记，回执发回飞书群。

## 文件结构

| 文件 | 说明 |
|---|---|
| `index.mjs` | SCF 入口 `main_handler`（别名 `handler`）：解析回调、userId 白名单、防重放、GitHub 写回、飞书回执、时区切换卡 `buildTzCard` |
| `grade.mjs` | 判分纯函数（供单测）：`gradeRuankao(questions, userAnswers)`、`gradeWords(words, fv)` |
| `rebuild.mjs` | 日记重建纯函数：`rebuildRuankao/rebuildMorning/rebuildEvening`（复用 `scripts/lib/note.mjs` 的 setLine/getFm/setFm） |
| `send-tz-card.mjs` | 本地 CLI：发时区切换卡（部署后由任意有飞书凭证的机器执行） |
| `package.json` | Node 20 ESM（无第三方依赖，不需要 npm install） |

依赖（相对导入，打包时必须一并带上）：`../../scripts/lib/note.mjs`、`../../scripts/lib/feishu.mjs`。

## 本地验证（部署前必做）

```bash
cd ~/obsidian-feishu-automation/daily-review
node --test test/grade.test.mjs          # 判分对照 + handler dry-run，33 项
DRY_RUN=1 DAILY_ROOT=/tmp/xx node -e "…" # 或直接 import main_handler 用样例事件直调
```

`DRY_RUN=1` 时：读本地仓库 `users/`（`DAILY_ROOT` 指向），**不写文件、不发飞书、不访问 GitHub**，写回内容与回执随响应返回供 diff 验证。

## 部署步骤（腾讯云 SCF）

> Step 4 的真实部署与飞书后台切换需用户提供 SecretId/SecretKey 后由主控执行，以下为完整手册。

### 1. 建函数

- 控制台 → 云函数 SCF → 新建 → **从头开始**（事件函数）
- 运行环境 **Node.js 20**，内存 **256 MB**，超时 **30 s**
- 执行方法：`index.main_handler`（或 `index.handler`）

### 2. 上传代码（zip）

函数只依赖同仓库两个 lib 文件，打包保持相对目录结构：

```bash
cd ~/obsidian-feishu-automation/daily-review
zip -r scf-callback.zip scf/feishu-callback scripts/lib
```

控制台「函数代码 → 本地上传 zip 包」上传，或 CLI `scf deploy`（需 SecretId/SecretKey）。

### 3. 配置环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `GITHUB_TOKEN` | 是 | GitHub PAT（repo contents 读写权限，即本仓库部署所用 token） |
| `GITHUB_REPO` | 是 | 日记仓库，格式 `owner/repo`（如 `andre-z/daily-review`，**以实际创建的远程仓库为准**；本仓库当前未配置 git remote，部署前先确认） |
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | 是 | 飞书应用凭证（tenant_access_token 换取，用于回执消息） |
| `FEISHU_VERIFICATION_TOKEN` | 是 | 飞书「事件订阅 → 请求地址」校验 token；**必填**：未设置时函数拒绝处理所有回调（防伪造交卷/打卡）；设置后强制比对 **body.header.token**（url_verification 比对 body.token） |

### 4. 配置 API 网关触发器

- 触发器 → API 网关触发 → 新建 API 服务，路径 **`/feishu-card-cb`**，方法 POST，**开启「集成响应」**（函数已按 `{statusCode, headers, body}` 形态返回）
- 发布后复制 HTTPS 请求 URL，形如 `https://service-xxx.gz.apigw.tencentcs.com/release/feishu-card-cb`

### 5. 飞书后台切换「卡片请求网址」

- 飞书开放平台 → 应用 → **事件与回调 → 回调配置**：卡片请求网址 改为上一步的 `<SCF 网关 URL>`
- 飞书会发送 `url_verification` 验证请求（函数回 `challenge` 原值）——飞书会重试 3 次，每次都要通过，如失败检查 API 网关集成响应设置
- **切换点**：改完后旧 n8n W3 不再收到回调；保留 ngrok 隧道半小时以便回滚

### 6. 上线前检查清单

1. `users/users.json` 中把 `open_id` 占位符替换为真实 open_id（Task 1 白名单按 open_id 校验且须 `active: true`，未注册 open_id 一律拒绝处理）
2. `users/<id>/config.json` 含 `tz` 与 `chat_id`（回执目标：事件 `open_chat_id` 优先，缺省用 config.chat_id）
3. GitHub 仓库中日记路径与仓库内 `users/<id>/daily/晨间日记+复盘 - YYYYMMDD.md` 一致
4. 飞书群里发时区切换卡验证一次：`FEISHU_APP_ID=xxx FEISHU_APP_SECRET=xxx node scf/feishu-callback/send-tz-card.mjs <chat_id>`

### 7. 验证（brief Step 4 验收）

交卷一次 → 日记写回（`ruankao_user` frontmatter + 「今日交卷」行）+ 飞书回执 + GitHub 仓库出现该日记更新 commit（message 前缀 `[scf] 飞书回调写回`）。

## 与 n8n W3 的差异（明示）

| 项 | W3（n8n） | 本实现 |
|---|---|---|
| 笔记读写 | Obsidian REST API（host.docker.internal + Bearer） | GitHub Contents API（GET→改→PUT，读-改-写冲突重试 3 次） |
| 回执目标 | 硬编码 chat_id | 事件 `open_chat_id` → 缺省 config.chat_id |
| userId 白名单 | 无 | Task 1 审查裁决：open_id → users/users.json 校验存在且 active，否则拒绝（含 userId 字符白名单防路径穿越） |
| 防重放 | n8n 静态数据（跨执行持久） | 模块级 Map（**单实例内** 10 分钟窗口；多实例冷启动并发时可能漏判——飞书 3s 重试通常落在同实例；如需强一致可升级 Redis，key 设计不变） |
| 时区切换 | 无 | 新增 `form_type=tz` 按钮卡 → 校验 IANA → 写 `users/<id>/config.json` 的 tz → 回执 |
| 回调 token 校验 | 无 | 必填（`FEISHU_VERIFICATION_TOKEN` 未设置时拒绝所有回调） |
| 表单值解析 | 只挖 `form_value` 键（对象） | 挖 `form_value`（对象或 JSON 字符串）+ `event.action.value` 兜底（2.0 卡片） |

判分与写回逻辑（`grade.mjs`/`rebuild.mjs`）为 W3 部署版（20260909-fix）**逐字移植**，对照测试见 `test/grade.test.mjs`。
