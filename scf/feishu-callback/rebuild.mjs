// scf/feishu-callback/rebuild.mjs — 日记重建（写回）纯函数
// 移植源：n8n W3-飞书回调-写回笔记.json「重建笔记(晨间)」「重建笔记(晚间)」「重建笔记(交卷)」（20260909-fix 部署版，v3 修复全保留）
// 数据引用改写：$json.data/$json.body → text；$('防重放').first().json → fv/参数；
//   setLine/scopeOf 复用 scripts/lib/note.mjs（Task 3 已逐字移植）；W3 的 writeScope 改为纯函数切片拼接；unmatched.push 改为返回 unmatchedCount
import { setLine, getFm, setFm } from '../../scripts/lib/note.mjs';
import { gradeRuankao, gradeWords } from './grade.mjs';

export const SEC = {
  RK: /### 📚 软考高项[^\n]*\n/,
  IE: /### 🇬🇧 英语学习[^\n]*\n/,
  ZUOXI: /### 🕒 作息记录\n/,
  HEALTH: /### 🏃 身体与精神营养\n/,
  WORK: /### 💼 工作任务[^\n]*\n/,
  LIFE: /### 🏠 生活备忘[^\n]*\n/,
};

// W3 scopeOf：取节标题到下一个 ##/### 标题之间的范围
function scopeOf(text, sectionRe) {
  const sm = text.match(sectionRe);
  if (!sm) return null;
  const rest = text.slice(sm.index + sm[0].length);
  const nm = rest.match(/\n#{2,3} /);
  const end = nm ? sm.index + sm[0].length + nm.index : text.length;
  return { start: sm.index, end, scope: text.slice(sm.index, end) };
}

// W3 本地时区时间戳：用笔记 timezone（替代容器时区的 ctx.datetime）
export function tsFromNote(text, fallbackTs, now = new Date()) {
  let ts = fallbackTs;
  try {
    const tz = ((text.match(/^\s{2}timezone:\s*"?([^"\n]+)"?/m) || [])[1] || '').trim();
    if (tz) {
      ts = new Intl.DateTimeFormat('sv-SE', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
      }).format(now);
    }
  } catch (e) {}
  return ts;
}

// W3 未匹配兜底：追加「📥 飞书回传」节
export function appendUnmatched(text, unmatched) {
  if (!unmatched.length) return text;
  const lines = unmatched.map((u) => '- ' + u).join('\n');
  if (text.includes('## 📥 飞书回传')) {
    return text.replace(/## 📥 飞书回传\n/, `## 📥 飞书回传\n\n${lines}\n`);
  }
  return text.replace(/\s*$/, '') + `\n## 📥 飞书回传\n\n${lines}\n`;
}

// setLine 包装：note.mjs setLine 未匹配时原样返回 → 与调用前对比探测 unmatched（W3 语义：仅在 value 非空时记录）
function setLineU(text, unmatched, key, value, opts) {
  const out = setLine(text, key, value, opts);
  if (out === text && value) unmatched.push(`${key}：${value}`);
  return out;
}

// W3 表单非空字段计数（note_date/form_type 等一律计入，原语义）
function filledCount(fv) {
  return Object.values(fv).filter((v) => (Array.isArray(v) ? v.length : v)).length;
}

// ================= 重建笔记(交卷)（W3 逐字） =================
export function rebuildRuankao(text, fv, { datetime, now } = {}) {
  if (typeof text !== 'string' || !text) {
    throw new Error('读取笔记失败，不执行写回');
  }

  // 题目全量数据（topic/options/answer/analysis）藏在笔记隐藏注释里；缺失则退回 frontmatter 答案
  let rkFull = null;
  const m = text.match(/<!-- automation:ruankao_json ([^\n]*?) -->/);
  if (m) { try { rkFull = JSON.parse(m[1]); } catch (e) {} }
  if (!rkFull || !Array.isArray(rkFull.questions)) {
    try {
      const raw = (text.match(/^\s{2}ruankao_answer:\s*(.*)$/m) || [])[1] || '""';
      const rka = JSON.parse(JSON.parse(raw));
      if (rka && Array.isArray(rka.answers)) rkFull = { questions: rka.answers.map((a) => ({ answer: a })) };
    } catch (e) { rkFull = { questions: [] }; }
  }
  const qs = rkFull.questions || [];

  // 本地时区时间戳（用笔记 timezone）
  const ts = tsFromNote(text, datetime, now);

  // 用户答案 q1..q20（统一大写、去空白；W3 固定 20 题）
  const user = [];
  for (let i = 1; i <= 20; i++) {
    user.push(String(fv['q' + i] || '').trim().toUpperCase());
  }
  const { score, wrong, unanswered } = gradeRuankao(qs, user);

  // frontmatter 写 ruankao_user（双层 JSON，与 ruankao_answer 一致；evening.mjs getFmRaw 消费）
  const payload = JSON.stringify(JSON.stringify({ score, total: qs.length, wrong, unanswered, at: ts }));
  text = setFm(text, 'ruankao_user', payload);

  // 软考高项节内追加交卷记录行
  const sm = text.match(SEC.RK);
  if (sm && qs.length) {
    const rest = text.slice(sm.index + sm[0].length);
    const nm = rest.match(/\n#{2,3} /);
    const end = nm ? sm.index + sm[0].length + nm.index : text.length;
    const line = `- 今日交卷：${score}/${qs.length}` + (wrong.length ? `（错：${wrong.map((w) => w.n).join('、')}）` : ' 🎉 全对');
    const scope = text.slice(sm.index, end);
    if (/- 今日交卷：/.test(scope)) {
      text = text.slice(0, sm.index) + scope.replace(/- 今日交卷：.*$/m, line) + text.slice(end);
    } else {
      text = text.slice(0, sm.index) + scope.replace(/\s*$/, `\n${line}\n`) + text.slice(end);
    }
  }

  return { content: text, filled: filledCount(fv), score, total: qs.length, wrong, unanswered };
}

// ================= 重建笔记(晨间)（W3 逐字） =================
export function rebuildMorning(text, fv, { datetime, now } = {}) {
  if (typeof text !== 'string' || !text) {
    throw new Error('读取笔记失败，不执行写回');
  }

  const unmatched = [];
  let frogCount = 0, lifeCount = 0;
  const ts = tsFromNote(text, datetime, now);

  // 1. 作息记录：昨夜睡前 + 今晨状态
  const bedParts = [];
  if (fv.bedtime) bedParts.push(`${fv.bedtime} 入睡`);
  if (fv.last_night) bedParts.push(fv.last_night);
  if (bedParts.length) text = setLineU(text, unmatched, '昨夜睡前', bedParts.join('；'), { sectionRe: SEC.ZUOXI });

  const mornParts = [];
  if (fv.wake_time) mornParts.push(`${fv.wake_time} 起床`);
  if (fv.weight) mornParts.push(`体重 ${fv.weight}kg`);
  if (mornParts.length) text = setLineU(text, unmatched, '今晨状态', mornParts.join('；'), { sectionRe: SEC.ZUOXI });

  // 2. 晨间锻炼 → 身体活动
  const exList = Array.isArray(fv.exercise) ? fv.exercise.filter((x) => x && x !== '今日休息') : [];
  if (exList.length) {
    text = setLineU(text, unmatched, '身体活动', `晨间：${exList.join('、')}`, { sectionRe: SEC.HEALTH });
  } else if (Array.isArray(fv.exercise) && fv.exercise.includes('今日休息')) {
    text = setLineU(text, unmatched, '身体活动', '晨间：休息日', { sectionRe: SEC.HEALTH });
  }

  // 3. 七只青蛙：🔴🟡 + 5×🟢 依次填入工作任务节（note.mjs setLine isFrog = W3 ensureFrogLines + fillFrog）
  const fillFrog = (emoji, val) => {
    if (!val) return;
    // W3 原语义：该任务已在节内 → 静默跳过（防重复提交，不记 unmatched；M1 修复）
    const sc = scopeOf(text, SEC.WORK);
    if (sc && sc.scope.includes(val)) return;
    const before = text;
    text = setLine(text, emoji, val, { isFrog: true });
    if (text !== before) frogCount++;
    else unmatched.push(`青蛙（${emoji}）：${val}`);
  };
  fillFrog('🔴', fv.frog_1 || fv.frog_red);
  fillFrog('🟡', fv.frog_2 || fv.frog_yellow);
  ['frog_3', 'frog_4', 'frog_5', 'frog_6', 'frog_7'].forEach((k) => fillFrog('🟢', fv[k]));
  if (fv.frog_green) fillFrog('🟢', fv.frog_green);

  // 4. 生活 todo：逗号分隔 → 依次填进生活备忘的空 checkbox 行
  const lifeItems = String(fv.life_todos || '').split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
  if (lifeItems.length) {
    const sc = scopeOf(text, SEC.LIFE);
    if (sc) {
      const existing = new Set((sc.scope.match(/^-\s\[[ x]\]\s+(\S.*)$/gm) || []).map((l) => l.replace(/^-\s\[[ x]\]\s+/, '').trim()));
      const toFill = lifeItems.filter((x) => !existing.has(x));
      let idx = 0;
      const newScope = sc.scope.replace(/^-\s\[ \][ \t]*$/gm, (line) => {
        if (idx < toFill.length) {
          const out = `- [ ] ${toFill[idx]}`;
          idx++;
          lifeCount++;
          return out;
        }
        return line;
      });
      text = text.slice(0, sc.start) + newScope + text.slice(sc.end);
      for (; idx < toFill.length; idx++) unmatched.push(`生活todo：${toFill[idx]}`);
    } else {
      lifeItems.forEach((x) => unmatched.push(`生活todo：${x}`));
    }
  }

  // 5. 未匹配兜底 + 6. frontmatter 标记 morning_submitted
  text = appendUnmatched(text, unmatched);
  text = setFm(text, 'morning_submitted', `"${ts}（飞书表单）"`);

  return { content: text, filled: filledCount(fv), frogCount, lifeCount, unmatchedCount: unmatched.length };
}

// ================= 重建笔记(晚间)（W3 逐字） =================
export function rebuildEvening(text, fv, { datetime, now } = {}) {
  if (typeof text !== 'string' || !text) {
    throw new Error('读取笔记失败，不执行写回');
  }

  const unmatched = [];
  const ts = tsFromNote(text, datetime, now);

  // 1. 七只青蛙勾选（全文本作用域 + 序号计数，W3 原语义）
  if (Array.isArray(fv.frogs_done) && fv.frogs_done.length) {
    const done = new Set(fv.frogs_done);
    let i = 0;
    text = text.replace(/^-\s\[[ x]\]\s*(?:🔴|🟡|🟢).*$/gm, (line) => {
      if (done.has('frog_' + i) && /^-\s\[ \]/.test(line)) line = line.replace(/^-\s\[ \]/, '- [x]');
      i++;
      return line;
    });
  }

  // 1b. 生活 todo 勾选（生活备忘节作用域）
  if (Array.isArray(fv.life_done) && fv.life_done.length) {
    const doneLife = new Set(fv.life_done);
    const sc = scopeOf(text, SEC.LIFE);
    if (sc) {
      let ii = 0;
      const newScope = sc.scope.replace(/^-\s\[[ x]\]\s*.*$/gm, (line) => {
        if (doneLife.has('life_' + ii) && /^-\s\[ \]/.test(line)) line = line.replace(/^-\s\[ \]/, '- [x]');
        ii++;
        return line;
      });
      text = text.slice(0, sc.start) + newScope + text.slice(sc.end);
    }
  }

  // 1c. 身体活动 / 精神阅读（晚间补填）
  if (fv.exercise_done) text = setLineU(text, unmatched, '身体活动', `今日：${fv.exercise_done}`, { sectionRe: SEC.HEALTH });
  if (fv.reading_done) text = setLineU(text, unmatched, '精神阅读', fv.reading_done, { sectionRe: SEC.HEALTH });

  // 2. 软考勾选 + 填值（RK 节）
  const rkDone = new Set(Array.isArray(fv.study_done_rk) ? fv.study_done_rk : []);
  text = setLineU(text, unmatched, '今日计划与完成度', '', { sectionRe: SEC.RK, checked: rkDone.has('rk_plan') });
  text = setLineU(text, unmatched, '量化输入', fv.rk_input_val || '', { sectionRe: SEC.RK, checked: rkDone.has('rk_input') });
  text = setLineU(text, unmatched, '错题复盘与知识盲区', fv.rk_mistake_val || '', { sectionRe: SEC.RK, checked: rkDone.has('rk_mistake') });

  // 3. 雅思勾选 + 填值（IE 节）
  const ieDone = new Set(Array.isArray(fv.study_done_ie) ? fv.study_done_ie : []);
  text = setLineU(text, unmatched, '今日计划与完成度', '', { sectionRe: SEC.IE, checked: ieDone.has('ie_plan') });
  text = setLineU(text, unmatched, '量化输入/输出', fv.ie_listen_val || '', { sectionRe: SEC.IE, checked: ieDone.has('ie_io') });
  text = setLineU(text, unmatched, '核心积累', fv.ie_words_val || '', { sectionRe: SEC.IE, checked: ieDone.has('ie_core') });

  // 3b. 单词自测判分（ie_w1..ie_w10 对照词表）
  let wordScore = null;
  let wordWrong = [];
  const wcm = text.match(/<!-- automation:ielts_json ([^\n]*?) -->/);
  let wordsFull = [];
  if (wcm) { try { const j = JSON.parse(wcm[1]); wordsFull = j.words || []; } catch (e) {} }
  if (wordsFull.length) {
    ({ score: wordScore, wrong: wordWrong } = gradeWords(wordsFull, fv));
    if (wordScore !== null) {
      const sc = scopeOf(text, SEC.IE);
      if (sc) {
        const sampleN = Math.min(10, wordsFull.filter((_, i) => i % 5 === 0).length);
        const line = `- 单词自测：${wordScore}/${sampleN}` + (wordWrong.length ? `（错：${wordWrong.join('、')}）` : ' 🎉 全对');
        let scope = sc.scope;
        if (/- 单词自测：/.test(scope)) scope = scope.replace(/- 单词自测：.*$/m, line);
        else scope = scope.replace(/\s*$/, `\n${line}\n`);
        text = text.slice(0, sc.start) + scope + text.slice(sc.end);
      }
    }
  }

  // 4. 今日三省填值（覆盖语义：匹配整行，替换值）
  const reflMap = [
    ['reflect_1', '今日成就感'],
    ['reflect_2', '我问了AI什么'],
    ['reflect_3', '遇到什么卡点'],
    ['reflect_4', '改进与明日动作'],
  ];
  for (const [k, kw] of reflMap) {
    if (fv[k]) {
      const re = new RegExp('^(\\d+\\. \\*\\*[^\\n]*' + kw + '[^\\n]*?：)[^\\n]*$', 'm');
      if (re.test(text)) {
        text = text.replace(re, (m2, g1) => g1 + fv[k]);
      } else {
        unmatched.push(`${kw}：${fv[k]}`);
      }
    }
  }

  // 5. 未匹配兜底 + 6. frontmatter 标记 evening_submitted（仅首次填写，W3 原语义）
  text = appendUnmatched(text, unmatched);
  if (!getFm(text, 'evening_submitted')) {
    text = setFm(text, 'evening_submitted', `"${ts}（飞书表单）"`);
  }

  return { content: text, filled: filledCount(fv), wordScore, wordWrong, unmatchedCount: unmatched.length };
}
