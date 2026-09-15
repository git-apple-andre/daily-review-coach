// scripts/lib/note.mjs — 日记渲染/注入/标记模块
// 移植源：n8n W1「渲染模板」「注入卡片」「标记morning_pushed」+ W3「重建笔记(晨间)」setLine/fillFrog（20260909-fix 备份的已部署版）
// 数据引用改写：$json.data/$('准备数据').first().json → 函数参数；W3 的节内 writeScope 改为纯函数返回
import { readFileSync } from 'node:fs';
import { writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';

function rootDir() {
  // 与 scripts/lib/config.mjs 同款根目录解析；延迟到调用时求值以便测试注入 DAILY_ROOT
  return process.env.DAILY_ROOT || path.resolve(import.meta.dirname, '..', '..');
}

/** 日记文件相对路径（vault 内 users/<id>/daily/） */
export function notePath(userId, ymd) {
  return path.join('users', userId, 'daily', `晨间日记+复盘 - ${ymd}.md`);
}

/** 读取日记全文；不存在返回 null */
export function readNote(userId, ymd) {
  try {
    return readFileSync(path.join(rootDir(), notePath(userId, ymd)), 'utf8');
  } catch {
    return null;
  }
}

/** 原子写入：先写 <path>.tmp 再 rename 覆盖（POSIX 原子替换） */
export async function atomicWrite(file, content) {
  // 必须先确保父目录存在。
  //
  // git 不跟踪空目录 —— 用户把日记"平铺到仓库根"之后，users/<id>/daily/
  // 就成了空目录，下次 clone 时它根本不存在，直接写会 ENOENT，
  // 让整个晨间流程在"出题完成"之后崩掉，表现是"卡片收不到"。
  await mkdir(path.dirname(file), { recursive: true });

  const tmp = file + '.tmp';
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, file);
}

// ===== 渲染模板（W1「渲染模板」逐字移植） =====
export function renderTemplate(tpl, { date, weekday, datetime, tz }) {
  let t = tpl;
  // 模板占位符替换（W1：{{date}} → "date weekday"）
  t = t.replace(/\{\{date\}\}/g, `${date} ${weekday}`);
  t = t.replace(/\{\{weekday\}\}/g, weekday); // brief 要求；模板当前无此占位符，防御性补充
  t = t.replace(/^date created:.*$/m, `date created: ${datetime}`);
  t = t.replace(/^date modified:.*$/m, `date modified: ${datetime}`);

  // 注入 automation 状态块到 frontmatter（W1 原样）
  t = t.replace(/^---\n([\s\S]*?)\n---/, (m, fm) =>
    `---\n${fm}\nautomation:\n  timezone: "${tz}"\n  morning_pushed: ""\n  evening_pushed: ""\n  evening_submitted: ""\n---`
  );
  return t;
}

// ===== 注入卡片（W1「注入卡片」逐字移植，dify_ok 仅透传：W1 中 dify_ok = !!cards，故以 cards 为门控） =====
export function injectCards(note, cards, { datetime, tz = '' } = {}) {
  let text = note;
  if (typeof text !== 'string' || !text) {
    throw new Error('今日笔记读取失败，为防止覆盖不执行写入');
  }

  // 重跑时先移除旧注入块（callout + 隐藏注释 + frontmatter 行）
  if (cards) {
    text = text.replace(/(^|\n)> \[!quote\]-?\s*(?:🃏|🎧|📝)?\s*(?:今日软考|雅思今日卡|今日 ?\d+ ?词|今日听力任务|今日 ?\d+ ?题答案)[^\n]*\n(?:>[^\n]*\n?)*/g, '\n');
    text = text.replace(/<!-- automation:(ruankao_json|ielts_json)[^\n]*? -->\n?/g, '');
    text = text.replace(/^  (ruankao_answer|ielts_card):.*$\n?/gm, '');
  }
  text = text.replace(/^  morning_generated:.*$\n?/gm, '');

  let fmAdd = `  morning_generated: "${datetime}"`;
  const RK_SEC = /(### 📚 软考高项[^\n]*\n)/;
  const IE_SEC = /(### 🇬🇧 英语学习[^\n]*\n)/;

  // ===== 软考：v3 二十题（折叠 callout；全量题目藏注释供 W2/W3 判分归纳） =====
  if (cards && cards.ruankao && Array.isArray(cards.ruankao.questions)) {
    const qs = cards.ruankao.questions;
    let blk = `> [!quote]- 🃏 今日软考 ${qs.length} 题（点击展开作答）\n`;
    qs.forEach((q, i) => {
      blk += `> **${i + 1}.〔${q.topic}〕${q.question}**\n`;
      (q.options || []).forEach((o) => { blk += `> ${o}\n`; });
      blk += `>\n`;
    });
    blk += `> *飞书晨卡作答后自动判分，错题进晚间归纳*\n`;
    let ans = `> [!quote]- 📝 今日 ${qs.length} 题答案与解析（点击展开）\n`;
    qs.forEach((q, i) => {
      ans += `> **${i + 1}. ${q.answer}**〔${q.topic}〕${q.analysis || ''}\n`;
      if (q.memory_hook) ans += `> 🧠 ${q.memory_hook}\n`;
    });
    const rkJson = `<!-- automation:ruankao_json ${JSON.stringify({ questions: qs })} -->`;
    text = text.replace(RK_SEC, `$1\n${blk}\n${ans}\n${rkJson}\n`);
    fmAdd += `\n  ruankao_answer: ${JSON.stringify(JSON.stringify({ answers: qs.map((q) => q.answer) }))}`;
  } else if (cards && cards.ruankao && cards.ruankao.question) {
    // 旧格式（单题）
    const rk = cards.ruankao;
    const opt = (rk.options || []).join('\n> ');
    text = text.replace(/(### 📚 软考高项[^\n]*\n)/, `$1\n> [!quote] 🃏 今日软考一题 · ${rk.topic}\n> ${rk.question}\n> ${opt}\n> *答案将在晚间复盘卡中揭晓*\n\n`);
    fmAdd += `\n  ruankao_answer: ${JSON.stringify(JSON.stringify({ answer: rk.answer, analysis: rk.analysis, memory_hook: rk.memory_hook }))}`;
  }

  // ===== 雅思：v3 五十词（词根拆解+完整释义+例句）+ 听力任务（含新三链接） =====
  if (cards && cards.ielts && Array.isArray(cards.ielts.words)) {
    const ws = cards.ielts.words;
    const ls = cards.ielts.listening || {};
    let lblk = `> [!quote] 🎧 今日听力任务（${ls.minutes || 15} 分钟 · ${ls.type || '精听'}）\n> **${ls.topic || 'BBC 6 Minute English'}**\n> 方法：${ls.tip || '先盲听抓大意，再逐句精听'}\n> 直达：[BBC 6 Minute English](https://www.bbc.co.uk/learningenglish/english/features/6-minute-english) ｜ [ESL Fast 分级听力](https://www.eslfast.com/) ｜ [雅思备考词汇库](https://hefengxian.github.io/my-ielts/)\n`;
    let wblk = `> [!quote]- 🃏 今日 ${ws.length} 词（点击展开）\n`;
    ws.forEach((w, i) => {
      wblk += `> ${i + 1}. **${w.w}** ${w.ph || ''}\n> 　词根：${w.rt || '—'}　｜　${w.def || ''}\n> 　例：${w.st || ''}${w.st_cn ? '（' + w.st_cn + '）' : ''}${w.c ? '　｜　搭配：' + w.c : ''}\n`;
    });
    const ieJson = `<!-- automation:ielts_json ${JSON.stringify({ words: ws })} -->`;
    text = text.replace(IE_SEC, `$1\n${lblk}\n${wblk}\n${ieJson}\n`);
    fmAdd += `\n  ielts_card: ${JSON.stringify(JSON.stringify({ words_n: ws.length, listening: `${ls.topic || ''}（${ls.type || '精听'} ${ls.minutes || 15}分钟）` }))}`;
  } else if (cards && cards.ielts && cards.ielts.word) {
    // 旧格式（单词卡）
    const ie = cards.ielts;
    text = text.replace(/(### 🇬🇧 英语学习 \/ 雅思\n)/, `$1\n> [!quote] 🃏 雅思今日卡 · ${ie.word} /${ie.phonetic}/\n> ${ie.definition_cn}\n> 例句：${ie.example_en}\n> 听力提示：${ie.listening_tip}\n> 搭配：${(ie.collocations || []).join('；')}\n\n`);
    fmAdd += `\n  ielts_card: ${JSON.stringify(JSON.stringify({ word: ie.word, definition_cn: ie.definition_cn }))}`;
  }

  // 写入/刷新 frontmatter 状态（W1 三分支；兜底分支的 tz 取自 options）
  // 用函数替换器避免 fmAdd 中 $ 序列被误解释为替换组（W1 字符串替换的隐患）
  if (text.includes('automation:\n')) {
    text = text.replace(/(automation:\n)/, () => `automation:\n${fmAdd}\n`);
  } else if (/^---\n[\s\S]*?\n---/.test(text)) {
    text = text.replace(/^---\n([\s\S]*?)\n---/, (m, fm) => `---\n${fm}\nautomation:\n${fmAdd}\n---`);
  } else {
    // 兜底：裸 markdown 无 frontmatter → 补最小 frontmatter（键集与渲染模板一致，保证后续标记/写回可落）
    text = `---\nautomation:\n  timezone: "${tz}"\n  morning_pushed: ""\n  evening_pushed: ""\n  evening_submitted: ""\n${fmAdd}\n---\n\n${text.replace(/^\n+/, '')}`;
  }
  return text;
}

// ===== frontmatter automation 读写 =====
/** 读 automation.<key>（去 YAML 引号；W2「提取数据」getFm 移植）；缺失返回 '' */
export function getFm(text, key) {
  const m = text.match(new RegExp('^\\s{2}' + key + ':\\s*(.*)$', 'm'));
  if (!m) return '';
  let v = m[1].trim();
  if (v.length > 1 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  return v;
}

/** 写 automation.<key>（W1「标记morning_pushed」泛化）：存在则整行覆盖，否则插入 automation: 之后；空值归一为 "" */
export function setFm(text, key, value) {
  const v = value === '' ? '""' : value;
  const re = new RegExp('^\\s{2}' + key + ':\\s*(.*)$', 'm');
  if (re.test(text)) {
    return text.replace(re, () => `  ${key}: ${v}`);
  }
  if (text.includes('automation:\n')) {
    return text.replace(/(automation:\n)/, () => `automation:\n  ${key}: ${v}\n`);
  }
  return text;
}

// ===== setLine：W3「重建笔记(晨间)」setLine + ensureFrogLines + fillFrog、W3「重建笔记(晚间)」setLine(checked/sectionRe) 移植（v3 正则修复全保留） =====
const WORK_SEC = /### 💼 工作任务[^\n]*\n/;

// W3 scopeOf：取节标题到下一个 ##/### 标题之间的范围
function scopeOf(text, sectionRe) {
  const sm = text.match(sectionRe);
  if (!sm) return null;
  const rest = text.slice(sm.index + sm[0].length);
  const nm = rest.match(/\n#{2,3} /);
  const end = nm ? sm.index + sm[0].length + nm.index : text.length;
  return { start: sm.index, end, scope: text.slice(sm.index, end) };
}

/**
 * 填一行：key 为标签词（如 昨夜睡前/量化输入），value 覆盖分隔冒号之后的内容。
 * - sectionRe 提供时先切出该节再匹配（模板里「今日计划与完成度」软考/雅思节重名，靠节区分；W3 晚间语义）
 * - checked=true（或 value 非空，W3 晚间语义）时把 `- [ ]` 置为 `- [x]`
 * - isFrog=true 时 key 为青蛙 emoji（🔴/🟡/🟢）：填入工作任务节内对应空行，不足 7 行先补齐（W3 fillFrog 固定 WORK 节，不受 sectionRe 影响）
 * W3 语义：找不到行或已存在同值任务 → 不改动（W3 记为 unmatched，纯函数版原样返回）。
 */
export function setLine(text, key, value, { isFrog = false, sectionRe = null, checked = false } = {}) {
  if (isFrog) {
    // ===== fillFrog（v3）：scope.includes 去重 + 行尾 [ \t]* 覆盖 =====
    if (!value) return text;
    const sc = scopeOf(text, WORK_SEC);
    if (!sc) return text;
    // ensureFrogLines（v3 计数：含已填内容行）
    let scope = sc.scope;
    const n = (scope.match(/^-\s\[[ x]\]\s*(?:🔴|🟡|🟢)/gm) || []).length;
    if (n < 7) {
      const add = '\n- [ ] 🟢 '.repeat(7 - n);
      scope = scope.replace(/\s*$/, add + '\n');
    }
    if (scope.includes(value)) return text; // 该任务已在笔记中，跳过（防重复提交）
    const re = new RegExp('^(-\\s\\[ \\])[ \\t]*' + key + '[ \\t]*$', 'm');
    if (re.test(scope)) {
      scope = scope.replace(re, (m) => m + ' ' + value);
      return text.slice(0, sc.start) + scope + text.slice(sc.end);
    }
    return text;
  }

  // ===== 标签行（W3「重建笔记(晚间)」setLine）：节作用域 + checkbox 打勾 + 分隔冒号 lookbehind（v3） =====
  let start = 0, end = text.length, scope = text;
  if (sectionRe) {
    const sm = text.match(sectionRe);
    if (!sm) return text; // W3: unmatched.push；纯函数版原样返回
    start = sm.index;
    const rest = text.slice(sm.index + sm[0].length);
    const nm = rest.match(/\n#{2,3} /);
    end = nm ? sm.index + sm[0].length + nm.index : text.length;
    scope = text.slice(start, end);
  }
  const lineRe = new RegExp('^(-\\s(\\[[ x]\\])?\\s*)?\\*\\*' + key + '[^\\n]*$', 'm');
  const lm = scope.match(lineRe);
  if (!lm) return text;
  let line = lm[0];
  if ((checked || value) && /^-\s\[ \]/.test(line)) line = line.replace(/^-\s\[ \]/, '- [x]');
  if (value) {
    const cm = line.match(/^(.*?)(?<=[*＊）)])([：:])(.*)$/);
    line = cm ? cm[1] + cm[2] + value : line + value;
  }
  return text.slice(0, start) + scope.replace(lineRe, () => line) + text.slice(end);
}
