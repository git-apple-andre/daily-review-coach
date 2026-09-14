# 贡献指南

感谢你有兴趣改进这个项目。这是一个个人效率工具，代码量不大但对可靠性要求高——**它每天要在没人看着的情况下跑两次**。

## 提交 Issue

请用仓库的 Issue 模板，并尽量附上：

- 复现步骤
- 期望结果 vs 实际结果
- GitHub Actions 的运行日志链接（脱敏后）
- Node 版本、操作系统

## 提交 PR

### 基本要求

1. **测试必须通过**：`node --test test/`
2. **新功能要带测试**：这个项目的可靠性靠 81 个测试兜着，不接受到"我本地试过了"
3. **不要提交任何真实凭证**：跑一遍 `python3 tools/audit-secrets.py .` 确认干净
4. **改动范围聚焦**：一个 PR 解决一件事

### 代码风格

- 纯 ESM（`import` / `export`），不用 CommonJS
- 注释用中文，解释**为什么**而不是**做了什么**
- 时间处理一律用 `Intl.DateTimeFormat` + IANA 时区名，不要手算时差
- 写文件用 `note.mjs` 的 `atomicWrite`，不要直接 `writeFileSync`（GitHub Actions 可能并发）

### 提交前检查清单

```bash
node --test test/                          # 测试全绿
python3 tools/audit-secrets.py .           # 无敏感信息
grep -rn "oc_\|ou_\|sk-\|github_pat_" . --exclude-dir=.git   # 无硬编码 ID
```

### Commit 信息

用 `type: 描述` 格式：

```
feat: 支持钉钉推送
fix: 修正跨夏令时窗口判断
docs: 补充 Cloudflare Workers 部署说明
test: 补充 setLine 边界用例
```

## 特别想要的方向

如果你想做这些，欢迎先开 Issue 讨论：

| 方向 | 说明 |
|---|---|
| **换消息渠道** | 钉钉 / 企业微信 / Telegram / Slack。核心逻辑与飞书是解耦的，重写 `scripts/lib/feishu.mjs` 这一层即可 |
| **换回调托管** | Cloudflare Workers 版本（海外用户更友好，免费额度更大） |
| **更多科目模板** | CPA / 法考 / 考研 / 公务员 / 一级建造师……只要改 `prompts/*.txt` |
| **Web 管理界面** | 现在改配置要直接编辑 JSON，对非技术用户不友好 |
| **多用户 SaaS 化** | `users/<id>/` 的多租户结构已经预留好了，缺注册和计费闭环 |

## 不接受的改动

- 引入重型框架（Express / Next.js 等）——这个项目的价值之一是依赖极少
- 把 LLM 调用换成某一家专有 SDK——保持 OpenAI 兼容接口，用户才能自由换服务商
- 在代码里硬编码任何个人配置——一律走 `users/<id>/config.json` 或环境变量

## License

贡献的代码将以 [MIT](LICENSE) 许可发布。
