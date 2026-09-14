# 部署飞书卡片回调（腾讯云 SCF）

## 为什么需要这一步

GitHub Actions 是**短任务**——跑完就退出，不能常驻监听端口。但飞书卡片上的按钮（"交卷"、"提交复盘"）需要把数据**回传**到一个公网可达的 HTTPS 地址。

所以需要一个常驻的服务端。本方案选腾讯云 SCF（云函数），原因：

- 有 **100 万次/月**免费额度，个人用完全够
- 国内直连飞书，延迟低、不需要代理
- 自带 HTTPS API 网关，不用买域名和证书
- 不用自己管服务器和运维

> 海外用户或想省钱可以用 **Cloudflare Workers** 替代，逻辑一样，只需改入口文件。

---

## 前置准备

| 需要 | 从哪拿 |
|---|---|
| 腾讯云账号 | 需**实名认证**才能用 SCF |
| 飞书自建应用的 `App ID` / `App Secret` | 飞书开放平台 → 你的应用 → 凭证与基础信息 |
| 一个 GitHub Token | 用于写回日记（可选，若 SCF 用 git 方式写回） |

### 飞书应用需要的权限

到飞书开放平台 → 你的应用 → 「权限管理」，开通：

| 权限 | 用途 |
|---|---|
| `im:message` | 发消息 |
| `im:message:send_as_bot` | 以机器人身份发消息 |
| `im:chat:readonly` | 读取群信息（拿 chat_id 用） |

还需要在「事件与回调」→「卡片请求网址」里填入后面拿到的 SCF 地址。

---

## 步骤

### 1. 创建云函数

1. 登录 [腾讯云 SCF 控制台](https://console.cloud.tencent.com/scf)
2. 左上角切换到**中国大陆**地域（推荐广州或上海，离飞书服务器近）
3. 「函数服务」→「新建」
4. 填写：
   - **创建方式**：从头开始
   - **函数名称**：`feishu-callback`
   - **运行环境**：Node.js 20
   - **函数类型**：事件函数
   - **提交方法**：本地上传文件夹 / 在线编辑

### 2. 上传代码

把本仓库 `scf/feishu-callback/` 整个目录的内容传上去：

```
index.mjs           # 主入口
grade.mjs           # 判分
rebuild.mjs         # 卡片重建
send-tz-card.mjs    # 时区切换卡
server.mjs          # 本地调试用
package.json
```

**执行入口**设为 `scf_bootstrap`（仓库根目录那个脚本），或者直接指定 `index.main_handler`。

> `scf_bootstrap` 的内容是 `#!/bin/bash` + `node scf/feishu-callback/server.mjs`——它把函数包成一个常驻 HTTP 服务。

### 3. 配置环境变量

在函数配置 → 「函数管理」→「环境变量」里添加：

| 变量名 | 值 |
|---|---|
| `FEISHU_APP_ID` | 你的飞书 App ID |
| `FEISHU_APP_SECRET` | 你的飞书 App Secret |
| `GH_TOKEN` | GitHub Personal Access Token（若需要写回仓库） |

> ⚠️ **不要**把这些值写进代码或提交进仓库。SCF 的环境变量是加密存储的。
> ⚠️ 本地调试可以设 `DRY_RUN=1`，此时不会真正写文件，只打印将要执行的动作。

### 4. 创建 API 网关触发器

1. 函数详情页 → 「触发管理」→「创建触发器」
2. **触发方式**：API 网关
3. **请求方法**：`ANY`（飞书会发 POST）
4. 创建后会得到一个 URL，形如：

   ```
   https://service-xxxxxxxx-1234567890.gz.apigw.tencentcs.com/release/
   ```

5. **复制这个 URL**

### 5. 填回飞书后台

1. 飞书开放平台 → 你的应用 → 「事件与回调」
2. 找到「卡片请求网址」（或「消息卡片请求地址」）
3. 粘贴第 4 步的 URL
4. 保存

飞书会立刻发一个 `challenge` 验证请求，SCF 的 `index.mjs` 里已经处理了（原样返回 `challenge` 值）。

### 6. 验证

在飞书群里触发一次卡片操作（比如点"交卷"），然后：

- SCF 控制台 → 「日志查询」→ 应该能看到调用记录
- 飞书群里应该收到回执消息
- 你的 Obsidian 笔记应该在下次 `obsidian-git` pull 后出现更新的内容

---

## 本地调试

不想每次都传代码到云上：

```bash
cd scf/feishu-callback
node server.mjs
# 监听 http://localhost:9000
```

配合 ngrok 或 cloudflared 暴露到公网，就能本地接飞书回调：

```bash
ngrok http 9000
# 把 ngrok 给的 https 地址填到飞书后台
```

`DRY_RUN=1` 时不会真正写文件，可以安全地反复测试。

---

## 排错

<details>
<summary><b>飞书后台保存回调地址时报错</b></summary>

- 检查 SCF 的 API 网关触发器是否已发布到 `release` 环境
- 检查 URL 是否带上了 `/release/` 后缀
- 用 curl 测一下：

  ```bash
  curl -X POST <你的URL> -H 'Content-Type: application/json' \
    -d '{"challenge":"test","type":"url_verification"}'
  ```

  正常应该返回 `{"challenge":"test"}`

</details>

<details>
<summary><b>收到回调但报错 19021</b></summary>

飞书错误码 19021 = 签名校验失败。如果你在机器人设置里开了「签名校验」，需要在代码里验签。

本项目默认**不开启**签名校验（走飞书自建应用的事件订阅机制，安全由 App Secret 保证）。如果你额外配了自定义机器人的签名校验，需要自行在 `index.mjs` 里加验签逻辑。

</details>

<details>
<summary><b>SCF 冷启动慢</b></summary>

首次调用或长时间无调用后，SCF 会冷启动（约 1–3 秒）。飞书的卡片回调要求 3 秒内响应，偶尔会超时。

对策：在 SCF 配置里设置**预置并发**（会产生少量费用），或接受偶发超时（用户再点一次即可）。

</details>

<details>
<summary><b>想换成 Cloudflare Workers</b></summary>

把 `scf/feishu-callback/index.mjs` 的 `main_handler` 包一层 Workers 的 `fetch` handler 即可：

```js
export default {
  async fetch(request, env, ctx) {
    const body = await request.text();
    const result = await main_handler({ body, ...env });
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
```

环境变量改用 `env.FEISHU_APP_ID` 读取。Workers 免费额度是每天 10 万次请求，比 SCF 更充裕，且海外访问快。

</details>
