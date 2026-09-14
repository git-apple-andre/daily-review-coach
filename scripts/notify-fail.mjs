// scripts/notify-fail.mjs —— 任何 workflow 失败时发 🚨 到飞书（替代 W5「发送告警」）
import { sendAlert } from './lib/feishu.mjs';

const text = process.env.FAIL_MSG || '自动化任务失败，请检查 GitHub Actions';
sendAlert(process.env.FEISHU_CHAT_ID, '🚨 ' + text)
  .then((res) => {
    // 发送请求本身成功但飞书返回业务错误码时也按失败退出（不吞业务失败）
    if (res && res.body && res.body.code !== 0) {
      console.error(`告警发送被飞书拒绝: code ${res.body.code} ${res.body.msg || ''}`);
      process.exit(1);
    }
    process.exit(0);
  })
  .catch((e) => {
    // 错误信息不含 token/key（feishu.mjs 保证 token 不落日志）
    console.error(`告警发送失败: ${e.message}`);
    process.exit(1);
  });
