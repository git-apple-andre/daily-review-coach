# AI 每日复盘与备考追踪系统

> 每天早上 8 点，飞书自动递给你一张答题卡；晚上 8 点，自动把当天的表现复盘成卡片推回来，并写进你的 Obsidian 笔记。
> **全程不需要你的电脑开机。**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.11-brightgreen)](https://nodejs.org/)
[![Tests](https://img.shields.io/badge/tests-90%20passing-brightgreen)](#跑测试)
[![Cost](https://img.shields.io/badge/月成本-¥3-blue)](#花多少钱)

**中文** | [English](#english)

---

## 这是什么（30 秒读懂）

想坚持每天复盘、每天备考，最难的不是"不知道方法"，而是**没有东西在推你**。

打卡 App 要你主动打开；Notion 模板要你自己填；日历提醒点一下就划走了。

这个项目换了个思路——**让复盘和备考变成别人递到你手上的两张卡片**：

| 时间 | 你收到 | 你要做 |
|---|---|---|
| 早上 8:00 | 答题卡 + 单词/听力卡 + 今日打卡卡 | 在飞书里点选项，交卷 |
| 白天 | —— | 正常上班 |
| 晚上 20:00 | 复盘卡（今日对错、错题归纳、明日计划） | 勾选、填两句、提交 |
| 提交后 | 你的 Obsidian 笔记里已经写好了这一天 | 什么都不用做 |

**最重要的特点**：整套系统跑在云上。你的电脑关机、带出门、断网，卡片照发。

---

## 效果预览

```
早上 8:00  飞书群里                         晚上 20:00  飞书群里
┌────────────────────────┐                ┌────────────────────────┐
│ 📝 今日软考 20 题        │                │ 🌙 晚间复盘卡            │
│ 1.〔挣值分析〕CPI 为？    │                │ 今日 20 题答案：1-B 2-B… │
│   A. 0.90  B. 0.82      │   ──作答──▶    │ 📝 今日交卷 17/20        │
│   C. 1.10  D. 1.22      │                │ ❌ 第1题〔挣值分析〕      │
│ …                       │                │    你选 A，正确 B        │
│ [ 交卷 ]                 │                │ [ 提交复盘 ]             │
└────────────────────────┘                └────────────────────────┘
                                                        │
                                                        ▼
                                        Obsidian 笔记自动写好这一天
```

---

## 开始之前

### 先认识 4 个词（不懂也能往下做）

| 词 | 说人话 |
|---|---|
| **仓库（Repository）** | 一个存放代码和文件的网盘文件夹 |
| **Fork** | 把别人的仓库复制一份到你自己的账号下，变成你的 |
| **Secret（密钥）** | GitHub 提供的"保险箱"，放密码用的。放进去之后就看不见了，但程序能用 |
| **Actions** | GitHub 免费送的"定时机器人"，可以在云端按时间自动跑代码 |

### 你需要准备什么

| 需要 | 怎么弄 | 花钱吗 |
|---|---|---|
| GitHub 账号 | github.com 注册 | 免费 |
| 腾讯云账号 | cloud.tencent.com 注册 + **实名认证** | 免费额度够用 |
| 飞书自建应用 | 见 [附录 A](#附录-a创建飞书应用) | 免费 |
| 一个大模型 API Key | DeepSeek / 智谱 / Kimi / OpenAI 任选 | 约 ¥3/月 |
| Obsidian | obsidian.md 下载，装 `obsidian-git` 插件 | 免费 |

---

## 五步跑起来

### 第 0 步：检查环境

先确认你电脑上有 Node.js 20.11 或更高版本。在终端输入：

```bash
node -v
```

- 显示 `v20.11.0` 以上 → ✅ 继续
- 显示 `command not found` 或版本低于 20.11 → 去 [nodejs.org](https://nodejs.org) 下载 LTS 版安装

### 第 1 步：把仓库复制到你的 GitHub

1. 打开本仓库页面，点右上角 **Fork** 按钮
2. 下一页点 **Create fork**
3. **重要**：fork 完成后，进入你的新仓库 → **Settings** → 拉到最下面 → **Change repository visibility** → 选 **Private** → 确认

> **为什么必须设成私有？** 你的日记会存在这个仓库里。私有仓库只有你能看到。

### 第 2 步：配置 4 个密钥

1. 在你的仓库页面，点 **Settings**（顶部菜单栏）
2. 左侧菜单找到 **Secrets and variables** → 点 **Actions**
3. 点绿色按钮 **New repository secret**
4. 逐个添加下面 4 个（**名字必须一模一样**，包括大小写）：

| Name（名字） | Secret（值） | 从哪拿 |
|---|---|---|
| `LLM_API_KEY` | 你的大模型 Key | 服务商控制台 |
| `FEISHU_APP_ID` | `cli_` 开头 | 见[附录 A](#附录-a创建飞书应用) |
| `FEISHU_APP_SECRET` | 一串字符 | 同上 |
| `FEISHU_CHAT_ID` | `oc_` 开头 | 见[附录 B](#附录-b拿到-chat_id) |

**可选**（想换大模型服务商时才需要）：

| Name | 说明 |
|---|---|
| `LLM_BASE_URL` | 默认 `https://api.deepseek.com`。换 Kimi 就填 `https://api.moonshot.cn/v1` |
| `LLM_MODEL` | 默认 `deepseek-chat`。换 Kimi 就填 `moonshot-v1-32k` |

> **加完应该看到什么**：4 条记录列在页面上，每条的 Value 显示为 `••••••`。

### 第 3 步：改你的个人配置

1. 在你的仓库里，点进 **`users`** 文件夹
2. 点 **`users.json`** → 右上角铅笔图标（Edit）→ 改成：

```json
[
  {
    "id": "u_me",
    "open_id": "",
    "plan": "free",
    "active": true
  }
]
```

3. 拉到下面点 **Commit changes**
4. 回到 `users` 文件夹 → 点 **Add file** → **Create new file**
5. 文件名填 `u_me/config.json`（**输入斜杠会自动建文件夹**），内容：

```json
{
  "tz": "Asia/Shanghai",
  "chat_id": "oc_你的群ID填这里",
  "note_template": "daily"
}
```

6. 点 **Commit changes**

> ⚠️ `id` 的名字（`u_me`）必须和文件夹名字**完全一致**。你也可以叫 `u_zhangsan`，两边都改就行。

### 第 4 步：打开自动运行开关

1. 在你的仓库页面，点 **Actions**（顶部菜单栏）
2. 会看到提示"Workflows aren't being run on this forked repository"，点绿色按钮 **I understand my workflows, go ahead and enable them**
3. 左侧应该出现 **Morning** 和 **Evening** 两个工作流

> **想立刻测试**：点左侧 **Morning** → 右侧 **Run workflow** 下拉 → 绿色 **Run workflow** 按钮。
> 等 1–2 分钟刷新，看有没有绿色对勾。

### 第 5 步：部署飞书回调（让按钮能用）

卡片上的按钮要把数据传回来，需要一个公网地址。这一步稍复杂，完整步骤见 **[docs/部署SCF回调.md](docs/部署SCF回调.md)**。

> 如果暂时不想弄这一步，**前 4 步已经能收到卡片了**——只是点按钮没反应。你可以先跑起来看看效果。

### 验证一下

如果你的电脑上已经 clone 了仓库，可以做一次全面自检：

```bash
cd 你的仓库目录

# 只检查配置（不需要密钥）
npm run doctor

# 连密钥一起检查（会测试大模型和飞书能不能连通）
LLM_API_KEY=xxx FEISHU_APP_ID=xxx FEISHU_APP_SECRET=xxx FEISHU_CHAT_ID=xxx npm run doctor
```

它会逐项告诉你哪里配好了、哪里有问题、**怎么修**。

---

## 卡住了怎么办（按症状查）

<details>
<summary><b>Actions 里看不到 Morning / Evening 工作流</b></summary>

说明还没启用。点 **Actions** 标签页，中间会有一个绿色按钮让你确认启用工作流。

如果连按钮都没有，检查 `.github/workflows/` 目录下有没有 `morning.yml` 和 `evening.yml`（Fork 时有时会漏）。

</details>

<details>
<summary><b>Actions 跑了，但是红色的 ✗</b></summary>

点进那次运行，展开红色的步骤看错误信息。常见原因：

| 错误信息含 | 原因 | 怎么修 |
|---|---|---|
| `用户 u_xxx 的 config.json 缺少有效 tz` | 时区填错 | 填 IANA 时区名，如 `Asia/Shanghai`。**不能填 `GMT+8`** |
| `软考题目数 0≠20` | 大模型没按格式输出 | 检查 `prompts/ruankao.txt` 结尾的「输出格式·铁律」段有没有被删 |
| `401` / `Unauthorized` | LLM_API_KEY 不对 | 重新生成一个 Key，注意别把空格复制进去 |
| `chat_id` 相关 | 群 ID 不对 | 必须 `oc_` 开头，不是群名字 |
| `Cannot find module` | 文件缺失 | 重新 Fork 一次 |

</details>

<details>
<summary><b>没收到飞书卡片</b></summary>

按顺序检查：

1. **Actions 里有没有运行记录** —— 如果没有，多半是下面那个「GitHub cron 丢触发」的问题
2. **机器人拉进群了吗** —— 飞书开放平台 → 你的应用 → 添加应用能力 → 机器人；然后在群里 @ 一次机器人
3. **时间窗口对吗** —— 晨间只在**你配置的时区** 8:00–13:00 执行，晚间 20:00–23:00。**时间没到不会发**
4. **Actions 是不是没开** —— 见上面的问题
5. **日志里看 `ENOENT`** —— 如果是 `no such file or directory ... users/<id>/daily/`，
   说明日记目录不存在。git 不跟踪空目录，clone 出来可能没有这个目录。
   本项目的 `atomicWrite` 会自动创建，如果你改过这块代码要留意
6. **想看详细日志** —— Actions → 点那次运行 → 点 `Run morning flow` 展开

</details>

<details>
<summary><b>⚠️ 卡片经常收不到？GitHub 的 cron 其实很不可靠</b></summary>

**这是最容易踩、也最难自己诊断的坑。**

GitHub Actions 的 `schedule` 在高负载时会延迟 5–15 分钟，**但更严重的是它会直接丢触发**。实测数据（私有仓库、免费额度）：

| 预期 | 实际 |
|---|---|
| 每小时 1 次 = 24 次/天 | **一天只触发 2–3 次，时间随机** |

而且**日志里什么都看不到** —— 没触发就是没有运行记录，很容易误以为是自己代码写错了。

### 判断方法

```bash
gh run list --repo <你的仓库> --limit 60 --json createdAt \
  --jq '.[] | .createdAt[11:13]' | sort | uniq -c
```

每小时都该有记录，却只有零星几个 —— 就是这个问题。

### 解法：加一个外部定时器

用 [cron-job.org](https://cron-job.org)（免费）每天准点调 GitHub 的 `workflow_dispatch` 接口：

| 配置 | 值 |
|---|---|
| URL | `https://api.github.com/repos/<owner>/<repo>/actions/workflows/morning.yml/dispatches` |
| Method | **POST** |
| Body | `{"ref":"main"}` |
| Headers | `Authorization: Bearer <token>`<br>`Accept: application/vnd.github+json`<br>`Content-Type: application/json` |

Token 只需要 **`workflow`** 权限（不需要 `repo`），建议设为不过期。

**两个必踩的坑**：

1. **必须先选 POST，请求体的输入框才会出现。** 先填 body 再改方法，body 会被丢掉，报 422。
2. **保存时可能报「URL 错误」，那是误报。** cron-job.org 保存时会用 GET 预检 URL，而 GitHub 的 dispatch 接口只接受 POST、对 GET 返回 404。**看 History 里的真实状态码**：**204 就是成功了**。

> **GitHub 自己的 schedule 不用关** —— 代码里有幂等保护（`morning_pushed` / `evening_pushed`），同一天只会执行一次，留着当备份。

</details>

<details>
<summary><b>卡片的按钮点了没反应</b></summary>

按这个顺序查（**从最常见到最罕见**）：

**① `open_id` 没填** ← 首次部署最常见

`users/users.json` 里的 `open_id` 还是占位符。代码有个安全白名单，只处理已注册的 `open_id`，所以一律拒绝。

**怎么拿真实值**：SCF 日志里会有

```
[未注册] 收到 open_id=ou_xxxxxxxx，不在白名单内
```

把它填进 `users/users.json`，**不用重新部署 SCF**（函数每次都从 GitHub 读这个文件）。

**② 返回了 200341**

飞书要求卡片回调 **3 秒内**响应。完整处理要打 5+ 次跨洋 GitHub API，实测 2.6 秒，卡在临界点上。

本项目的 `server.mjs` 已经做了提前响应（1.8 秒未完成就先返回 toast，后台继续跑），
如果你改过这块，用 SCF 日志的 `Duration` 判断。

**③ `exec format error`**

部署包坏了 —— 多半是用了腾讯云**在线代码编辑器**逐文件粘贴，
把 `scf_bootstrap` 的行尾改成了 CRLF，或丢了可执行位。**用 zip 包上传，别用在线编辑器。**

**④ 其他**

- 腾讯云 SCF 的 API 网关触发器是否已发布
- 飞书开放平台 → 事件与回调 → 「卡片请求网址」是否填了 SCF 的地址
- 用 curl 测一下：`curl 你的SCF地址/health` 应该返回 `{"ok":true}`

详见 [docs/部署SCF回调.md](docs/部署SCF回调.md)。

</details>

<details>
<summary><b>按钮有回执消息，但笔记没更新</b></summary>

回执发出去了说明函数跑到了最后，那问题在**写回 GitHub 那一步**：

1. **`GITHUB_TOKEN` 过期了** —— 这是最典型的症状。GitHub PAT 到期后，
   函数读得到数据但写不回去。**去腾讯云 SCF 换环境变量**（不是 GitHub Secrets）
2. **token 权限不足** —— 需要 `repo` 全选（或 fine-grained 的 Contents 读写）
3. **看 SCF 日志** —— 搜索 `GITHUB_TOKEN` 或 `401` / `403`

> 建议把 SCF 用的 token 设为**不过期**。它是给程序用的，到期只会在你最忙的时候突然坏掉。

</details>

<details>
<summary><b>时区不对，卡片在奇怪的时间发</b></summary>

GitHub Actions 的定时任务固定用 UTC 时间，这是平台限制。

本项目的做法是**每小时触发一次，然后在脚本里判断你所在时区现在是不是早上**。所以：

- 改时区只需改 `config.json` 里的 `tz` 字段，**不用动定时配置**
- Actions 有时会延迟 5–15 分钟，这是正常的，不影响使用

</details>

<details>
<summary><b>我的日记会不会泄露</b></summary>

只要你的仓库是 **Private** 就不会。做完第 1 步后一定要去 Settings 里确认一下可见性。

另外可以随时跑一次审计：

```bash
npm run audit
```

它会扫描常见的密钥格式和个人信息，**报告位置但不会打印真值**。

</details>

---

## 跑测试

```bash
npm test
```

90 个测试覆盖：判分逻辑、笔记读写、时区守卫、飞书卡片组装、模板渲染、原子写。

---

## 目录结构

```
daily-review-coach/
├── .github/workflows/
│   ├── morning.yml              # 晨间定时任务
│   ├── evening.yml              # 晚间定时任务
│   └── ci.yml                   # 自动跑测试 + 敏感信息扫描
├── scripts/
│   ├── doctor.mjs               # 自检脚本（npm run doctor）
│   ├── generate.mjs             # 出题：读提示词 → 调大模型 → 解析 JSON
│   ├── morning.mjs              # 晨间主流程
│   ├── evening.mjs              # 晚间主流程
│   ├── notify-fail.mjs          # 失败告警到飞书
│   └── lib/
│       ├── config.mjs           # 配置加载 + 时区工具
│       ├── feishu.mjs           # 飞书 API 封装
│       ├── glm.mjs              # 大模型客户端（OpenAI 兼容接口）
│       └── note.mjs             # 笔记渲染 / 注入 / 原子写
├── scf/feishu-callback/         # 腾讯云 SCF：飞书卡片回调处理
├── prompts/
│   ├── ruankao.txt              # 出题提示词（← 换成你的科目）
│   └── ielts.txt
├── templates/                   # Obsidian 笔记模板
├── users/
│   ├── users.json               # 用户列表
│   └── u_example/               # 每个用户一个目录
│       ├── config.json          # 时区 / 群 ID / 模板
│       └── daily/               # 该用户的日记
├── test/                        # 90 个测试
└── tools/audit-secrets.py       # 敏感信息审计
```

---

## 换成你自己的科目

内置了两门考试作为示例（软考高项 + 雅思），但**科目本身是数据，不是代码**。

| 想改成 | 改哪里 |
|---|---|
| 换考试科目（CPA / 法考 / 考研…） | `prompts/ruankao.txt` 里的出题规则 |
| 换题目数量 | `prompts/*.txt` 里的数字 + `scripts/generate.mjs` 里的校验数字 |
| 换每日任务类型 | `templates/` 里的笔记模板 |
| 只保留一门（比如只背单词） | 删掉 `scripts/morning.mjs` 里发对应卡片的行 |

> ⚠️ 提示词末尾的「**输出格式·铁律**」段落**不要删**。大模型经常不听话，那段是让它稳定输出 JSON 的关键。

---

## 花多少钱

| 项 | 用量 | 费用 |
|---|---|---|
| GitHub 私有仓库 + Actions | 约 500 分钟/月（免费额度 2000） | ¥0 |
| 腾讯云 SCF | 约 2000 次/月（免费额度 100 万） | ¥0 |
| 大模型 token | 约 0.6M/月 | **约 ¥3** |
| 域名 | 不需要（SCF 自带 HTTPS） | ¥0 |
| **合计** | | **约 ¥3/月** |

---

## 这个项目是怎么长出来的

| 版本 | 技术栈 | 问题 |
|---|---|---|
| v1 | Mac 常驻 + n8n + Dify + Obsidian REST API | 电脑一关机就断 |
| v2 | 加 launchd + 内网穿透保活 | 地址会变、费电、还是不稳 |
| **v3（当前）** | **GitHub Actions + 腾讯云 SCF + 大模型 API** | **¥3/月，不依赖任何常开设备** |

每一次迭代的驱动力都是同一个问题：**"我要出门了，它还能跑吗？"**

---

## 贡献

欢迎提 Issue 和 PR。特别想要的方向：

- 换掉飞书，接入钉钉 / 企业微信 / Telegram
- 换掉 SCF，用 Cloudflare Workers（海外用户更友好）
- 更多科目提示词模板
- Web 端管理界面（现在改配置要直接编辑 JSON）

请先看 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## 附录 A：创建飞书应用

1. 打开 [飞书开放平台](https://open.feishu.cn/app)，点 **创建企业自建应用**
2. 填名字（比如"我的复盘助手"）和图标 → 创建
3. 左侧 **凭证与基础信息** → 记下 **App ID**（`cli_` 开头）和 **App Secret**
4. 左侧 **添加应用能力** → 找到 **机器人** → 点 **添加**
5. 左侧 **权限管理** → 搜索并开通这几个权限：

   | 权限 | 用途 |
   |---|---|
   | `im:message` | 发消息 |
   | `im:message:send_as_bot` | 以机器人身份发消息 |
   | `im:chat:readonly` | 读取群信息 |

6. 左侧 **版本管理与发布** → 创建版本 → 申请发布（企业内应用通常自动通过）

## 附录 B：拿到 chat_id

1. 把机器人拉进目标群（群设置 → 群机器人 → 添加机器人）
2. 在群里 @ 一下机器人，随便说句话
3. 回到 [飞书开放平台](https://open.feishu.cn/app) → 你的应用 → **事件与回调** → **事件日志**
4. 找到刚才那条消息，里面的 `chat_id` 字段就是（`oc_` 开头）

> 也可以用 API：`GET https://open.feishu.cn/open-apis/im/v1/chats`（需要 `im:chat:readonly` 权限）

---

## 免责声明

- 本项目**不收集任何用户数据**，所有数据都在你自己的仓库里
- 使用本项目产生的 API 费用由使用者自行承担
- 请遵守你所使用的大模型服务商和飞书的服务条款
- 题目由大模型生成，**不保证正确性**，请自行核验

## License

[MIT](LICENSE)

本项目中的工作流、脚本与文档以 MIT 许可发布。项目依赖的第三方服务（GitHub Actions、腾讯云 SCF、飞书开放平台、Obsidian）版权归各自所有，本项目不包含、不再分发其源代码或服务。

---

<a id="english"></a>
## English Summary

**AI Daily Review & Exam Prep Coach** — a cloud-native automation that pushes a daily study card and an evening review card to your Feishu (Lark) chat, then writes everything back into your Obsidian vault. Your computer can stay off.

**How it works**: GitHub Actions acts as the scheduler (hourly cron + timezone-aware window guard), Tencent Cloud SCF handles Feishu card callbacks (grading, write-back), and a private Git repo serves as the data store. The only client-side piece is the `obsidian-git` plugin.

**Why it's built this way**: no always-on machine required; ~$0.50/month total cost; all logic is plain Node.js with 81 unit tests.

**Quick start**: fork the repo (set it private) → add 4 GitHub Secrets → edit `users/users.json` → enable Actions. Run `npm run doctor` anytime to check your setup. Feishu callback deployment is documented in `docs/`.

**Make it yours**: the exam subject is data, not code — swap `prompts/*.txt` to target any exam (CPA, bar exam, grad school, civil service…).

MIT licensed.
