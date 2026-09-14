// scripts/evening.mjs — 晚间主流程（端到端编排）
// 对照 W2 节点顺序（部署版 20260909-fix/W2-export.json）：
//   守卫（20-23 窗口，W2「准备数据」）→ 读日记（不存在跳过记日志）→ 幂等（evening_pushed 非空跳过，W2「未推送过？」）
//   → 提取数据（答案/交卷成绩/词表/青蛙/生活todo，W2「提取数据」）→ 组装晚间卡（buildEveningCard）
//   → 发卡 → 标记 evening_pushed（W2「标记evening_pushed」）→ usage.json 累计
// DRY_RUN=1：守卫/幂等/存在检查通过后打印将执行的步骤并退出 0（不调飞书、不写文件）
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadUsers, loadUserConfig, hourInTz, dateInTz, inEveningWindow } from './lib/config.mjs';
import { readNote, getFm, setFm, atomicWrite, notePath } from './lib/note.mjs';
import { sendCard, buildEveningCard } from './lib/feishu.mjs';

const isDryRun = () => process.env.DRY_RUN === '1'; // 惰性求值：测试可中途切换

function rootDir() {
  // 与 scripts/lib/note.mjs 同款根目录解析；延迟到调用时求值以便测试注入 DAILY_ROOT
  return process.env.DAILY_ROOT || path.resolve(import.meta.dirname, '..');
}

// 星期中文映射（W2「准备数据」wdMap 逐字移植）
const WD = { Sun: '周日', Mon: '周一', Tue: '周二', Wed: '周三', Thu: '周四', Fri: '周五', Sat: '周六' };
function weekdayInTz(tz, now = new Date()) {
  return WD[new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now)] || '';
}
// 本地时间 YYYY-MM-DD HH:mm:ss（W2 sv-SE 同款，用于 evening_pushed）
function datetimeInTz(tz, now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(now);
}

// ===== W2「提取数据」逐字移植（输入改写：$json.data/$json.body → note 参数） =====
export function extractEveningData(note) {
  if (typeof note !== 'string' || !note) {
    throw new Error('读取今日笔记失败：内容为空或非字符串');
  }

  // getFmRaw：保留外层 YAML 引号的原始值——双重 JSON 编码的字段（ruankao_answer/ielts_card/ruankao_user）
  // 必须带引号整体第一次 parse（W2 原注释：getFm 剥引号会让转义序列失效）
  const getFmRaw = (key) => {
    const m = note.match(new RegExp('^\\s{2}' + key + ':\\s*(.*)$', 'm'));
    return m ? m[1].trim() : '';
  };

  let ruankao = null, ielts = null;
  try { ruankao = JSON.parse(JSON.parse(getFmRaw('ruankao_answer'))); } catch (e) {}
  try { ielts = JSON.parse(JSON.parse(getFmRaw('ielts_card'))); } catch (e) {}

  // 隐藏注释：全量题目/词表 + 用户交卷记录（ruankao_user 由 SCF 判分写回）
  let rkFull = null, ieltsWords = [], rkUser = null;
  let cm = note.match(/<!-- automation:ruankao_json ([^\n]*?) -->/);
  if (cm) { try { rkFull = JSON.parse(cm[1]); } catch (e) {} }
  cm = note.match(/<!-- automation:ielts_json ([^\n]*?) -->/);
  if (cm) { try { const j = JSON.parse(cm[1]); ieltsWords = j.words || []; } catch (e) {} }
  try { rkUser = JSON.parse(JSON.parse(getFmRaw('ruankao_user'))); } catch (e) {}

  // 单词自测采样：每 5 个取 1 个（0,5,10,...,45），与 W3 判分一致
  const sampleIelts = ieltsWords.filter((_, i) => i % 5 === 0).slice(0, 10);

  // 今日任务行（🔴🟡🟢 标记的即“青蛙”，最多 10 项）
  const frogs = [];
  const re = /^-\s\[([ x])\]\s*(🔴|🟡|🟢)\s*(.*)$/gm;
  let m;
  while ((m = re.exec(note)) !== null && frogs.length < 10) {
    frogs.push({ done: m[1] === 'x', color: m[2], name: (m[3] || '').trim() || '未命名任务' });
  }

  // 生活备忘节内的 todo 行（节作用域，最多 10 项，空名跳过）
  const lifeTodos = [];
  const lifeSec = note.match(/### 🏠 生活备忘[^\n]*\n([\s\S]*?)(?=\n#{2,3} |\n---)/);
  if (lifeSec) {
    const lre = /^-\s\[([ x])\]\s*(.+)$/gm;
    let lm;
    while ((lm = lre.exec(lifeSec[1])) !== null && lifeTodos.length < 10) {
      const nm = lm[2].trim();
      if (nm) lifeTodos.push({ done: lm[1] === 'x', name: nm });
    }
  }

  // 今日核心策略（模板「Today's Focus / 今日核心策略」行）
  const strategy = ((note.match(/今日核心策略\**：\s*([^\n]*)/) || [])[1] || '').trim();

  return {
    frogs,
    lifeTodos,
    ruankao,
    ielts,
    strategy,
    rkFull,
    ieltsWords,
    rkUser,
    sampleIelts,
    evening_pushed: getFm(note, 'evening_pushed'),
    evening_submitted: getFm(note, 'evening_submitted'),
  };
}

// usage.json 累计：runs+1、tokens_total+estimate。
// 晚间流程无 LLM 调用（仅组装已生成的日记数据），故 estimate 恒为 0；与晨间共用同一文件/结构。
async function bumpUsage(userId, tokensEstimate) {
  const file = path.join(rootDir(), 'users', userId, 'usage.json');
  let u = { tokens_total: 0, runs: 0 };
  try { u = { ...u, ...JSON.parse(readFileSync(file, 'utf8')) }; } catch { /* 首跑或文件损坏 */ }
  u.runs = (u.runs || 0) + 1;
  u.tokens_total = (u.tokens_total || 0) + tokensEstimate;
  await atomicWrite(file, JSON.stringify(u) + '\n');
}

export async function runEvening(user, now = new Date()) {
  const cfg = loadUserConfig(user.id);
  const chatId = (cfg.chat_id || '').trim();
  if (!chatId) throw new Error(`[${user.id}] config.json 缺少 chat_id，无法发卡`);

  const hour = hourInTz(cfg.tz, now);
  if (!inEveningWindow(hour)) {
    console.log(`[${user.id}] ${hour} 点不在晚间窗口（20-23），跳过`);
    return { skipped: true, reason: 'window' };
  }

  const date = dateInTz(cfg.tz, now);
  const ymd = date.replaceAll('-', '');
  const datetime = datetimeInTz(cfg.tz, now);
  const weekday = weekdayInTz(cfg.tz, now);

  // 读日记（晨间流程产物）；不存在说明晨间未跑/未同步，记日志跳过（不新建，避免误建空笔记）
  const note = readNote(user.id, ymd);
  if (!note) {
    console.log(`[${user.id}] ${ymd} 日记不存在（晨间流程未跑或尚未同步），晚间跳过`);
    return { skipped: true, reason: 'no-note' };
  }
  if (getFm(note, 'evening_pushed')) {
    console.log(`[${user.id}] ${ymd} evening_pushed 已标记，幂等跳过`);
    return { skipped: true, reason: 'already-pushed' };
  }

  // W2「提取数据」：日记 → 卡片组装所需数据
  const ex = extractEveningData(note);
  const prep = { date, weekday };

  if (isDryRun()) {
    console.log(`[${user.id}] DRY_RUN：守卫通过（${hour} 点），将执行的步骤：`);
    console.log(`  1. 读日记 晨间日记+复盘 - ${ymd}.md 并提取数据（W2「提取数据」）`);
    console.log(`  2. 组装晚间复盘卡：答案揭晓 ${(ex.rkFull?.questions || ex.ruankao?.answers || []).length} 题 · 交卷 ${ex.rkUser ? `${ex.rkUser.score}/${ex.rkUser.total}` : '未交卷'} · 单词自测 ${ex.sampleIelts.length} 题 · 青蛙 ${ex.frogs.length} 项 · 生活todo ${ex.lifeTodos.length} 项`);
    console.log(`  3. 发卡到 chat_id ${chatId}`);
    console.log(`  4. 标记 evening_pushed = "${datetime}"`);
    console.log('  5. usage.json 累计（runs+1、tokens_total+0——晚间无 LLM 调用）');
    return { skipped: true, reason: 'dry-run' };
  }

  const card = buildEveningCard({ prep, ...ex });
  const res = await sendCard(chatId, JSON.stringify(card));
  if (!res || res.statusCode !== 200 || (res.body && res.body.code !== 0)) {
    throw new Error(`发送晚间复盘卡失败: HTTP ${res?.statusCode} code ${res?.body?.code} msg ${res?.body?.msg || ''}`);
  }
  console.log(`[${user.id}] 晚间复盘卡已发送`);

  // 标记 evening_pushed（W2 语义：始终覆盖为本次推送时间，值带引号；发卡失败不标记 → 下小时整流程重试）
  const file = path.join(rootDir(), notePath(user.id, ymd));
  await atomicWrite(file, setFm(note, 'evening_pushed', `"${datetime}"`));
  console.log(`[${user.id}] 已标记 evening_pushed = ${datetime}`);

  await bumpUsage(user.id, 0);
  console.log(`[${user.id}] usage 累计：runs+1、tokens_total+0（晚间无 LLM 调用）`);

  return { skipped: false };
}

async function main() {
  const users = loadUsers();
  if (!users.length) { console.log('无 active 用户，退出'); return; }
  for (const user of users) {
    await runEvening(user);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`晚间流程失败: ${e.message}`); process.exit(1); });
}
