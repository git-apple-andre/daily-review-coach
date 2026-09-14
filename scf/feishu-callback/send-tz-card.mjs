// scf/feishu-callback/send-tz-card.mjs — 发送时区切换卡（CLI）
// 用法：FEISHU_APP_ID=xxx FEISHU_APP_SECRET=xxx node scf/feishu-callback/send-tz-card.mjs <chat_id>
//   （chat_id 缺省取 users/u_example/config.json 的 chat_id；DAILY_ROOT 可覆盖仓库根）
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { sendCard } from '../../scripts/lib/feishu.mjs';
import { buildTzCard } from './index.mjs';

const chatId = process.argv[2] || (() => {
  try {
    const root = process.env.DAILY_ROOT || path.resolve(import.meta.dirname, '..', '..');
    const cfg = JSON.parse(readFileSync(path.join(root, 'users', 'u_example', 'config.json'), 'utf8'));
    return cfg.chat_id || '';
  } catch { return ''; }
})();

if (!chatId) {
  console.error('用法: FEISHU_APP_ID=xxx FEISHU_APP_SECRET=xxx node send-tz-card.mjs <chat_id>');
  process.exit(1);
}

const r = await sendCard(chatId, JSON.stringify(buildTzCard()));
console.log(JSON.stringify(r, null, 2));
process.exit(r.statusCode === 200 ? 0 : 1);
