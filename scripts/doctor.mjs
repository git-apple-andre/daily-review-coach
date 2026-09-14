#!/usr/bin/env node
// scripts/doctor.mjs —— 一条命令检查你的配置是否配好了
//
// 用法：
//   本地检查：  node scripts/doctor.mjs
//   带上密钥：  LLM_API_KEY=xxx FEISHU_APP_ID=xxx ... node scripts/doctor.mjs
//
// 每一项都会告诉你「哪里错了」和「怎么修」。不会打印任何密钥内容。

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.env.DAILY_ROOT || path.resolve(import.meta.dirname, '..');

let pass = 0, warn = 0, fail = 0;
const problems = [];

const OK   = (m) => { console.log(`  \x1b[32m✓\x1b[0m ${m}`); pass++; };
const WARN = (m, fix) => { console.log(`  \x1b[33m!\x1b[0m ${m}`); if (fix) console.log(`      → ${fix}`); warn++; };
const BAD  = (m, fix) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); if (fix) console.log(`      → ${fix}`); fail++; problems.push({ m, fix }); };

const section = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

// ── 1. 运行环境 ───────────────────────────────────────
section('1 / 6　运行环境');

const [major, minor] = process.versions.node.split('.').map(Number);
if (major > 20 || (major === 20 && minor >= 11)) {
  OK(`Node.js v${process.versions.node}`);
} else {
  BAD(`Node.js v${process.versions.node} 版本过低`,
      '需要 20.11 或更高（用了 import.meta.dirname）。到 https://nodejs.org 下载 LTS 版');
}

// ── 2. 目录结构 ───────────────────────────────────────
section('2 / 6　目录结构');

const needDirs = ['scripts', 'scripts/lib', 'scf/feishu-callback', 'templates', 'prompts', 'users'];
const needFiles = ['scripts/morning.mjs', 'scripts/evening.mjs', 'scripts/generate.mjs',
                   'scripts/lib/config.mjs', 'scripts/lib/feishu.mjs', 'scripts/lib/note.mjs',
                   '.github/workflows/morning.yml', '.github/workflows/evening.yml'];

let missing = [];
for (const d of needDirs) if (!existsSync(path.join(ROOT, d))) missing.push(d + '/');
if (missing.length) BAD(`缺少目录：${missing.join('、')}`, '确认你在仓库根目录运行，且 clone 完整');
else OK('目录结构完整');

missing = needFiles.filter((f) => !existsSync(path.join(ROOT, f)));
if (missing.length) BAD(`缺少文件：${missing.join('、')}`, '重新 clone 一次');
else OK('核心文件齐全');

// ── 3. 用户配置 ───────────────────────────────────────
section('3 / 6　你的配置（users/）');

let users = [];
const usersFile = path.join(ROOT, 'users', 'users.json');
if (!existsSync(usersFile)) {
  BAD('找不到 users/users.json', '这个文件列出有哪些用户在用');
} else {
  try {
    users = JSON.parse(readFileSync(usersFile, 'utf8'));
    OK(`users.json 格式正确，共 ${users.length} 个用户`);
  } catch (e) {
    BAD(`users.json 不是合法 JSON：${e.message}`, '检查是不是多了逗号或少了引号');
  }
}

const active = users.filter((u) => u && u.active);
if (users.length && !active.length) {
  BAD('没有任何 active=true 的用户', '把 users.json 里你自己的那条改成 "active": true');
} else if (active.length) {
  OK(`找到 ${active.length} 个启用中的用户`);
}

for (const u of active) {
  const cfgPath = path.join(ROOT, 'users', u.id, 'config.json');
  if (!existsSync(cfgPath)) {
    BAD(`用户 ${u.id} 缺少 config.json`,
        `新建 users/${u.id}/config.json，内容：\n         {"tz":"Asia/Shanghai","chat_id":"oc_你的群ID","note_template":"daily"}`);
    continue;
  }
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  } catch (e) {
    BAD(`用户 ${u.id} 的 config.json 不是合法 JSON：${e.message}`);
    continue;
  }

  // 时区
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: cfg.tz });
    OK(`用户 ${u.id} 时区有效：${cfg.tz}`);
  } catch {
    BAD(`用户 ${u.id} 时区非法：${JSON.stringify(cfg.tz)}`,
        '要填 IANA 时区名，如 Asia/Shanghai、Europe/Warsaw、America/New_York。不能填 "GMT+8"');
  }

  // chat_id —— 区分「还没填」和「填错了」，提示语不一样
  const cid = String(cfg.chat_id ?? '');
  const isPlaceholder = cid === '' || cid.includes('<') || cid.includes('你的') || /x{6,}/.test(cid);
  if (isPlaceholder) {
    WARN(`用户 ${u.id} 还没填 chat_id`,
         '填入你的飞书群 ID（形如 oc_xxxxxxxx）。获取方法见 README「怎么拿 chat_id」');
  } else if (!cid.startsWith('oc_')) {
    BAD(`用户 ${u.id} 的 chat_id 格式不对（应以 oc_ 开头）`,
        '飞书群 ID 形如 oc_xxxxxxxx，注意不要填成群名字或 open_id（ou_ 开头）');
  } else {
    OK(`用户 ${u.id} chat_id 格式正确`);
  }

  // 日记目录
  const dailyDir = path.join(ROOT, 'users', u.id, 'daily');
  if (!existsSync(dailyDir)) {
    WARN(`用户 ${u.id} 还没有 daily/ 目录`, `mkdir -p users/${u.id}/daily —— 第一次运行时会自动建，也可以现在建`);
  }
}

// ── 4. 提示词与模板 ───────────────────────────────────
section('4 / 6　出题提示词与笔记模板');

for (const p of ['prompts/ruankao.txt', 'prompts/ielts.txt']) {
  const f = path.join(ROOT, p);
  if (!existsSync(f)) { BAD(`缺少 ${p}`); continue; }
  const txt = readFileSync(f, 'utf8');
  if (!txt.includes('输出格式') && !txt.includes('JSON')) {
    WARN(`${p} 里没找到「输出格式」约束`, '大模型很容易不按格式输出，建议保留原模板里的格式铁律段');
  } else {
    OK(`${p} 存在且含格式约束`);
  }
}

const tpl = path.join(ROOT, 'templates');
if (existsSync(tpl)) {
  const mds = readdirSafe(tpl).filter((f) => f.endsWith('.md'));
  if (mds.length) OK(`笔记模板 ${mds.length} 个`);
  else BAD('templates/ 里没有 .md 模板', '从仓库重新复制一份');
} else {
  BAD('缺少 templates/ 目录');
}

function readdirSafe(d) {
  try { return readdirSync(d); } catch { return []; }
}

// ── 5. 密钥 ───────────────────────────────────────────
section('5 / 6　密钥（本地从环境变量读，线上从 GitHub Secrets 读）');

const secrets = [
  ['LLM_API_KEY',     '大模型 API Key',  '去你的大模型服务商控制台创建'],
  ['FEISHU_APP_ID',   '飞书 App ID',     '飞书开放平台 → 你的应用 → 凭证与基础信息'],
  ['FEISHU_APP_SECRET', '飞书 App Secret', '同上'],
  ['FEISHU_CHAT_ID',  '飞书群 ID',       '形如 oc_xxxxxxxx，见 README'],
];

const present = {};
for (const [key, label, how] of secrets) {
  const v = process.env[key];
  if (v && v.trim()) { present[key] = v; OK(`${label}（${key}）已设置`); }
  else WARN(`${label}（${key}）未设置`, `本地测试需要它；线上请在 GitHub Secrets 里配。${how}`);
}

// ── 6. 连通性 ─────────────────────────────────────────
section('6 / 6　连通性测试');

if (present.LLM_API_KEY) {
  const base = (process.env.LLM_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
  const model = process.env.LLM_MODEL || 'deepseek-chat';
  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${present.LLM_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ok' }], max_tokens: 1 }),
      signal: AbortSignal.timeout(20000),
    });
    if (r.ok) OK(`大模型连通（${base} / ${model}）`);
    else if (r.status === 401) BAD('大模型 API Key 无效', '去服务商控制台重新生成一个');
    else if (r.status === 402) BAD('大模型账户余额不足', '去服务商控制台充值');
    else BAD(`大模型返回 ${r.status}`, `检查 LLM_BASE_URL 是否正确：${base}`);
  } catch (e) {
    BAD(`连不上大模型：${e.message}`,
        '如果是国内网络连海外服务，需要在 GitHub Actions 里能访问到；本地测试可检查网络/代理');
  }
} else {
  WARN('跳过（没有 LLM_API_KEY）');
}

if (present.FEISHU_APP_ID && present.FEISHU_APP_SECRET) {
  try {
    const r = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: present.FEISHU_APP_ID, app_secret: present.FEISHU_APP_SECRET }),
      signal: AbortSignal.timeout(20000),
    });
    const j = await r.json();
    if (j.code === 0) OK('飞书凭证有效');
    else BAD(`飞书返回错误 ${j.code}：${j.msg}`, '检查 App ID / App Secret 是否复制完整（别带空格）');
  } catch (e) {
    BAD(`连不上飞书：${e.message}`, '飞书是国内服务，确保没有走代理（检查 NO_PROXY）');
  }
} else {
  WARN('跳过（没有飞书凭证）');
}

// ── 汇总 ──────────────────────────────────────────────
console.log('\n' + '─'.repeat(58));
if (fail === 0 && warn === 0) {
  console.log(`\x1b[32m全部通过（${pass} 项）\x1b[0m —— 可以跑了`);
  console.log('\n下一步：把仓库推上 GitHub，在 Settings → Secrets 里配好这 4 个密钥，然后开启 Actions。');
} else if (fail === 0) {
  console.log(`\x1b[33m${pass} 项通过，${warn} 项待确认\x1b[0m —— 通常不影响运行`);
  console.log('\n带 ! 的多半是"本地没设环境变量"，线上走 GitHub Secrets 不受影响。');
} else {
  console.log(`\x1b[31m${pass} 项通过，${warn} 项待确认，${fail} 项必须修复\x1b[0m`);
  console.log('\n必须修复的：');
  problems.forEach((p, i) => console.log(`  ${i + 1}. ${p.m}`));
  console.log('\n按上面的 → 提示逐条改，改完再跑一次本脚本。');
}
console.log('─'.repeat(58));

process.exit(fail > 0 ? 1 : 0);
