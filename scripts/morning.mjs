// scripts/morning.mjs — 晨间主流程（端到端编排）
// 对照 W1 节点顺序（20260909-fix/W1-patched.json）：
//   守卫（8-13 窗口）→ 幂等（morning_pushed 非空跳过）→ 笔记存在检查 → 模板渲染（仅新建）
//   → 生成题目（generateCards）→ 注入卡片 → 写库 → 发 3 卡 → 标记 morning_pushed → usage.json 累计
// DRY_RUN=1：守卫/幂等/存在检查通过后打印将执行的步骤并退出 0（不调 GLM/飞书、不写文件）
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadUsers, loadUserConfig, hourInTz, dateInTz, inMorningWindow } from './lib/config.mjs';
import { generateCards } from './generate.mjs';
import { readNote, renderTemplate, injectCards, atomicWrite, notePath, getFm, setFm } from './lib/note.mjs';
import { sendCard, buildRuankaoCard, buildIeltsCard, buildMorningFormCard } from './lib/feishu.mjs';

const ROOT = process.env.DAILY_ROOT || path.resolve(import.meta.dirname, '..');
const DRY_RUN = process.env.DRY_RUN === '1';

// 星期中文映射（W1「准备数据」wdMap 逐字移植）
const WD = { Sun: '周日', Mon: '周一', Tue: '周二', Wed: '周三', Thu: '周四', Fri: '周五', Sat: '周六' };
function weekdayInTz(tz, now = new Date()) {
  return WD[new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now)] || '';
}
// 本地时间 YYYY-MM-DD HH:mm:ss（W1 sv-SE 同款，用于 date created/morning_pushed）
function datetimeInTz(tz, now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(now);
}

// note_template → templates/ 内文件名（Ruling 3：模板放仓库 templates/每日复盘-Dify.md，config.json 的 note_template 指向它）
const TEMPLATE_FILES = { daily: '每日复盘-Dify.md' };
function templatePath(cfg) {
  const key = (cfg && typeof cfg.note_template === 'string' && cfg.note_template.trim()) || 'daily';
  return path.join(ROOT, 'templates', TEMPLATE_FILES[key] || key);
}

// TODO(usage)：chatGLM/generateCards 未透出 GLM usage 字段（本任务不允许改这两个文件），
// 先按字符估算累计：中文≈1 token/字，其余≈4 字符/token；后续让 chatGLM 返回真实 usage 后替换。
function estimateTokens(s) {
  if (!s) return 0;
  const cjk = (s.match(/[一-鿿　-〿＀-￯]/g) || []).length;
  return cjk + Math.ceil((s.length - cjk) / 4);
}

// usage.json 累计：runs+1、tokens_total+估算值（缺失/损坏时从零重建）
async function bumpUsage(userId, tokensEstimate) {
  const file = path.join(ROOT, 'users', userId, 'usage.json');
  let u = { tokens_total: 0, runs: 0 };
  try { u = { ...u, ...JSON.parse(readFileSync(file, 'utf8')) }; } catch { /* 首跑或文件损坏 */ }
  u.runs = (u.runs || 0) + 1;
  u.tokens_total = (u.tokens_total || 0) + tokensEstimate;
  await atomicWrite(file, JSON.stringify(u) + '\n');
}

export async function runMorning(user, now = new Date()) {
  const cfg = loadUserConfig(user.id);
  const chatId = (cfg.chat_id || '').trim();
  if (!chatId) throw new Error(`[${user.id}] config.json 缺少 chat_id，无法发卡`);

  const hour = hourInTz(cfg.tz, now);
  if (!inMorningWindow(hour)) {
    console.log(`[${user.id}] ${hour} 点不在晨间窗口（8-13），跳过`);
    return { skipped: true, reason: 'window' };
  }

  const date = dateInTz(cfg.tz, now);
  const ymd = date.replaceAll('-', '');
  const datetime = datetimeInTz(cfg.tz, now);
  const weekday = weekdayInTz(cfg.tz, now);

  const existing = readNote(user.id, ymd);
  if (existing && getFm(existing, 'morning_pushed')) {
    console.log(`[${user.id}] ${ymd} morning_pushed 已标记，幂等跳过`);
    return { skipped: true, reason: 'already-pushed' };
  }

  if (DRY_RUN) {
    console.log(`[${user.id}] DRY_RUN：守卫通过（${hour} 点），将执行的步骤：`);
    console.log(`  1. 笔记：${existing ? '已存在，复用并注入（不重渲染模板）' : '不存在 → 渲染 templates/每日复盘-Dify.md'}`);
    console.log('  2. 生成题目：generateCards({ weakPoints: [], recentContext: "" })（TODO：近3天错题上下文 Task 6/7 后接入）');
    console.log(`  3. 注入卡片 → atomicWrite 晨间日记+复盘 - ${ymd}.md`);
    console.log(`  4. 发 3 卡到 chat_id ${chatId}：软考作答卡 / 单词听力卡 / 晨间打卡卡`);
    console.log(`  5. 标记 morning_pushed = "${datetime}"`);
    console.log('  6. usage.json 累计（runs+1、tokens_total+估算）');
    return { skipped: true, reason: 'dry-run' };
  }

  // 近 3 天错题上下文：本任务先用空串（Task 6/7 完整后数据才存在）。
  // TODO(数据来源)：对应 W1「近3天URL/GET 近3天笔记/提取学习上下文」三节点——从最近 3 篇日记的
  // automation:ruankao_json 错题/归纳节提取，届时替换此空实现并传入 generateCards.recentContext。
  const recent = '';

  const cards = await generateCards({ weakPoints: [], recentContext: recent });
  console.log(`[${user.id}] 出题完成：软考 ${cards.ruankao.questions.length} 题 / 雅思 ${cards.ielts.words.length} 词`);

  let note = existing ?? renderTemplate(readFileSync(templatePath(cfg), 'utf8'), { date, weekday, datetime, tz: cfg.tz });
  note = injectCards(note, cards, { datetime, tz: cfg.tz });
  const file = path.join(ROOT, notePath(user.id, ymd));
  await atomicWrite(file, note);
  console.log(`[${user.id}] 日记已写入 ${notePath(user.id, ymd)}`);

  // 发 3 张卡（sendCard 的 cardJson 参数是字符串）；任一张失败即抛错 → 不标记 → 下一小时整流程重试（幂等注入）
  const prep = { date, weekday, noteName: `晨间日记+复盘 - ${ymd}.md` };
  const results = [
    ['软考作答卡', await sendCard(chatId, JSON.stringify(buildRuankaoCard(cards, prep)))],
    ['单词听力卡', await sendCard(chatId, JSON.stringify(buildIeltsCard(cards, prep)))],
    ['晨间打卡卡', await sendCard(chatId, JSON.stringify(buildMorningFormCard(prep)))],
  ];
  for (const [name, res] of results) {
    if (!res || res.statusCode !== 200 || (res.body && res.body.code !== 0)) {
      throw new Error(`发送${name}失败: HTTP ${res?.statusCode} code ${res?.body?.code} msg ${res?.body?.msg || ''}`);
    }
  }
  console.log(`[${user.id}] 3 张晨间卡已发送`);

  // 标记 morning_pushed（W1 语义：覆盖为本次推送时间，值带引号）
  note = setFm(note, 'morning_pushed', `"${datetime}"`);
  await atomicWrite(file, note);
  console.log(`[${user.id}] 已标记 morning_pushed = ${datetime}`);

  // usage 估算：出题输出 + 两个静态提示词 + 检索片段（generate.mjs 内部截取 ≤5×800 字符+头部，按 4300 上限）
  const tokensEstimate = estimateTokens(JSON.stringify(cards))
    + estimateTokens(readFileSync(path.join(ROOT, 'prompts', 'ruankao.txt'), 'utf8'))
    + estimateTokens(readFileSync(path.join(ROOT, 'prompts', 'ielts.txt'), 'utf8'))
    + estimateTokens('今日薄弱点：无\n检索资料：\n近3天错题归纳：无')
    + 4300;
  await bumpUsage(user.id, tokensEstimate);
  console.log(`[${user.id}] usage 累计：runs+1、tokens_total+${tokensEstimate}（估算口径，见 estimateTokens TODO）`);

  return { skipped: false };
}

async function main() {
  const users = loadUsers();
  if (!users.length) { console.log('无 active 用户，退出'); return; }
  for (const user of users) {
    await runMorning(user);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`晨间流程失败: ${e.message}`); process.exit(1); });
}
