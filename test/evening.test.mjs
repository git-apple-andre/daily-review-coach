// test/evening.test.mjs — Task 6 晚间工作流单测
// 覆盖：extractEveningData（W2「提取数据」移植）/ buildEveningCard（W2「组装晚间卡片」移植）
//      / runEvening 守卫、幂等、无笔记跳过、DRY_RUN 路径（runEvening 用固定 now 注入，
//      临时日记文件放在 users/u_example/daily/ 下日期 20270102，try/finally 清理）
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { buildEveningCard } from '../scripts/lib/feishu.mjs';
import { extractEveningData, runEvening } from '../scripts/evening.mjs';
import { loadUsers } from '../scripts/lib/config.mjs';

const FIXTURE = readFileSync(new URL('./fixtures/day-note.md', import.meta.url), 'utf8');
const RK_LINE = FIXTURE.match(/<!-- automation:ruankao_json [^\n]*? -->/)[0];
const IE_LINE = FIXTURE.match(/<!-- automation:ielts_json [^\n]*? -->/)[0];
const PREP = { date: '2026-09-11', weekday: '周五' };

// 合成笔记：交卷记录 ruankao_user（双重 JSON）+ ielts_card + 全量题/词表注释 + 已填青蛙/生活todo
const RKU = { total: 20, score: 17, unanswered: [5, 9], wrong: [{ n: 1, topic: '挣值分析', user: 'A', correct: 'B', analysis: 'CPI=EV/AC' }] };
const SYNTH = `---
automation:
  timezone: "Asia/Shanghai"
  evening_pushed: ""
  ruankao_user: ${JSON.stringify(JSON.stringify(RKU))}
  ielts_card: ${JSON.stringify(JSON.stringify({ words_n: 50, listening: 'BBC 6 Minute English（精听 15分钟）' }))}
---
## 🎯 任务追踪 (Tasks)
### 💼 工作任务 (Work)
- [x] 🔴 写日报
- [ ] 🟡 代码评审
### 🏠 生活备忘 (Life)
- [x] 买菜
- [ ] 取快递
## 📈 长期目标与专项学习 (Long-term Goals)
${RK_LINE}
${IE_LINE}
`;

// ---------- extractEveningData（W2「提取数据」移植） ----------

test('extractEveningData：fixture 全量解析（答案/词表/采样/青蛙/生活todo/标记）', () => {
  const ex = extractEveningData(FIXTURE);
  assert.equal(ex.ruankao.answers.length, 20);
  assert.equal(ex.ruankao.answers[0], 'B');
  assert.equal(ex.ielts.words_n, 50);
  assert.match(ex.ielts.listening, /BBC/);
  assert.equal(ex.rkFull.questions.length, 20);
  assert.equal(ex.ieltsWords.length, 50);
  // 采样：每 5 取 1（索引 0,5,10,...,45）
  assert.deepEqual(ex.sampleIelts.map(w => w.w), ['hypothesis', 'implication', 'sustainable', 'degradation', 'innovation', 'obsolete', 'curriculum', 'tuition', 'urbanisation', 'subsidy']);
  assert.equal(ex.rkUser, null); // fixture 无交卷记录
  assert.equal(ex.evening_pushed, '2026-09-10 20:57:51');
  assert.equal(ex.evening_submitted, '');
  // 7 行空青蛙 → done=false；名字为空时 W2 正则的 \s* 吞掉行尾与换行，
  // (.*) 会把下一行「📝 进展记录」抓进来——部署版逐字行为，此处按部署行为断言
  assert.equal(ex.frogs.length, 7);
  assert.deepEqual(ex.frogs.map(f => f.color), ['🔴', '🟡', '🟢', '🟢', '🟢', '🟢', '🟢']);
  assert.ok(ex.frogs.every(f => f.done === false));
  assert.ok(ex.frogs.every(f => f.name.startsWith('-   📝 进展记录')));
  // 空 todo 行：与青蛙正则同款级联行为（\s* 吞行尾换行，(.+) 抓下一行）——部署版逐字行为
  assert.deepEqual(ex.lifeTodos, [
    { done: false, name: '- [ ]' },
    { done: false, name: '- [ ]' },
    { done: false, name: '*(公众号/灵感素材积累: )*' },
  ]);
  assert.equal(typeof ex.strategy, 'string');
});

test('extractEveningData：ruankao_user 双重 JSON 交卷记录 + 已填青蛙/生活todo', () => {
  const ex = extractEveningData(SYNTH);
  assert.deepEqual(ex.rkUser, RKU);
  assert.deepEqual(ex.frogs, [
    { done: true, color: '🔴', name: '写日报' },
    { done: false, color: '🟡', name: '代码评审' },
  ]);
  assert.deepEqual(ex.lifeTodos, [
    { done: true, name: '买菜' },
    { done: false, name: '取快递' },
  ]);
  assert.equal(ex.rkFull.questions.length, 20);
  assert.equal(ex.sampleIelts.length, 10);
  assert.equal(ex.ielts.words_n, 50);
});

test('extractEveningData：空/非字符串输入抛错（防误写保护，同 W2）', () => {
  assert.throws(() => extractEveningData(''), /读取今日笔记失败/);
  assert.throws(() => extractEveningData(null), /读取今日笔记失败/);
});

// ---------- buildEveningCard（W2「组装晚间卡片」逐字段移植） ----------

test('buildEveningCard：schema 2.0 + 顶部揭晓/成绩/错题归纳 + 表单字段齐全', () => {
  const card = buildEveningCard({ prep: PREP, ...extractEveningData(SYNTH) });
  const s = JSON.stringify(card);
  assert.match(s, /"schema":"2.0"/);
  assert.match(s, /"template":"indigo"/);
  assert.match(s, /🌙 晚间复盘卡 · 2026-09-11 周五/);
  assert.match(s, /3 分钟填完，提交即写入 Obsidian/);
  // 顶部：答案揭晓（1-B  2-B）+ 交卷 17/20（2 题未作答）+ 错题归纳
  assert.match(s, /今日 20 题答案：\*\*1-B\s+2-B/);
  assert.match(s, /📝 \*\*今日交卷 17\/20\*\*（2 题未作答）/);
  assert.match(s, /❌ 第1题〔挣值分析〕：你选 A，正确 \*\*B\*\* — CPI=EV\/AC/);
  assert.match(s, /下方「错题归纳」填错因与盲区/);
  // 词库/听力
  assert.match(s, /今日 50 词已入库/);
  assert.match(s, /🎧 听力任务：BBC 6 Minute English/);
  // 表单：青蛙/生活todo 勾选项（text≠value 对）
  assert.match(s, /"name":"frogs_done"/);
  assert.ok(s.includes('{"text":{"tag":"plain_text","content":"✅ 写日报"},"value":"frog_0"}'));
  assert.ok(s.includes('"value":"frog_1"'));
  assert.match(s, /"name":"life_done"/);
  assert.ok(s.includes('{"text":{"tag":"plain_text","content":"✅ 买菜"},"value":"life_0"}'));
  // 身体精神 + 三省 4 问 + 学习量化
  assert.match(s, /"name":"exercise_done"/);
  assert.match(s, /"name":"reading_done"/);
  assert.equal((s.match(/"name":"reflect_\d+"/g) || []).length, 4);
  for (const n of ['rk_input_val', 'rk_mistake_val', 'ie_listen_val', 'ie_words_val']) {
    assert.match(s, new RegExp(`"name":"${n}"`));
  }
  // 单词自测 10 题：label 为释义〔词根〕
  assert.equal((s.match(/"name":"ie_w\d+"/g) || []).length, 10);
  assert.match(s, /1\. 假设，假说，前提〔hypo-（在下）\+ thesis（论点）→ 放在底下支撑的论点〕/);
  // 自动带出 + 提交按钮 + form 名
  assert.equal((s.match(/"disabled":true/g) || []).length, 2);
  assert.match(s, /"default_value":"evening"/);
  assert.match(s, /"name":"submit_btn"/);
  assert.match(s, /form_submit/);
  assert.match(s, /"name":"review_form"/);
});

test('buildEveningCard：全对分支（无错题、无未作答）', () => {
  const data = {
    prep: PREP,
    rkFull: { questions: [{ answer: 'B' }] },
    rkUser: { total: 1, score: 1, unanswered: [], wrong: [] },
    ruankao: null, ielts: null, frogs: [], lifeTodos: [], sampleIelts: [],
  };
  const s = JSON.stringify(buildEveningCard(data));
  assert.match(s, /🎉 全对！今天的状态很好/);
  assert.doesNotMatch(s, /❌/);
  assert.doesNotMatch(s, /题未作答/);
});

test('buildEveningCard：未交卷分支', () => {
  const ex = extractEveningData(FIXTURE); // fixture 无 ruankao_user
  const s = JSON.stringify(buildEveningCard({ prep: PREP, ...ex }));
  assert.match(s, /📝 今日未在晨卡交卷（交卷后这里自动生成错题归纳）/);
});

test('buildEveningCard：空青蛙/空生活todo/空词表兜底选项', () => {
  const card = buildEveningCard({ prep: PREP, frogs: [], lifeTodos: [], sampleIelts: [] });
  const s = JSON.stringify(card);
  assert.ok(s.includes('{"text":{"tag":"plain_text","content":"（今日未列任务）"},"value":"none"}'));
  assert.ok(s.includes('{"text":{"tag":"plain_text","content":"（今日无生活todo）"},"value":"none"}'));
  assert.match(s, /（今日词表不可用，跳过本项）/);
  assert.equal((s.match(/"name":"ie_w\d+"/g) || []).length, 0);
});

test('buildEveningCard：无全量题时的旧格式回退（frontmatter answers 数组）', () => {
  const card = buildEveningCard({
    prep: PREP,
    ruankao: { answers: ['B', 'A'] },
    rkFull: null,
    ielts: null, frogs: [], lifeTodos: [], sampleIelts: [],
  });
  assert.match(JSON.stringify(card), /今日 2 题答案：\*\*1-B\s+2-A/);
});

// ---------- runEvening 主流程（守卫/幂等/无笔记/DRY_RUN） ----------

const NOTE_DIR = path.resolve(import.meta.dirname, '..', 'users', 'u_example', 'daily');
const NOTE_FILE = path.join(NOTE_DIR, '晨间日记+复盘 - 20270102.md');
const IN_WINDOW = new Date('2027-01-02T12:00:00Z'); // Asia/Shanghai 20:00
const OUT_WINDOW = new Date('2027-01-02T04:00:00Z'); // Asia/Shanghai 12:00

function userUExample() {
  const u = loadUsers().find(x => x.id === 'u_example');
  assert.ok(u, 'u_example 必须是 active 用户（依赖真实 users.json）');
  return u;
}
function putNote(content) {
  mkdirSync(NOTE_DIR, { recursive: true });
  writeFileSync(NOTE_FILE, content, 'utf8');
}
function removeNote() {
  rmSync(NOTE_FILE, { force: true });
}

test('runEvening：窗口外（12 点）秒退', async () => {
  const r = await runEvening(userUExample(), OUT_WINDOW);
  assert.deepEqual(r, { skipped: true, reason: 'window' });
});

test('runEvening：日记不存在跳过（记日志）', async () => {
  removeNote(); // 确保 20270102 无笔记
  try {
    const r = await runEvening(userUExample(), IN_WINDOW);
    assert.deepEqual(r, { skipped: true, reason: 'no-note' });
  } finally {
    removeNote();
  }
});

test('runEvening：evening_pushed 已标记 → 幂等跳过', async () => {
  putNote(FIXTURE); // fixture 的 evening_pushed = "2026-09-10 20:57:51"
  try {
    const r = await runEvening(userUExample(), IN_WINDOW);
    assert.deepEqual(r, { skipped: true, reason: 'already-pushed' });
  } finally {
    removeNote();
  }
});

test('runEvening：DRY_RUN 打印计划、不写文件不发卡', async () => {
  putNote(FIXTURE.replace(/^  evening_pushed:.*\n/m, '')); // 去掉标记，走到 DRY_RUN 分支
  const prev = process.env.DRY_RUN;
  process.env.DRY_RUN = '1';
  try {
    const r = await runEvening(userUExample(), IN_WINDOW);
    assert.deepEqual(r, { skipped: true, reason: 'dry-run' });
    // 未写标记（文件内容未变：evening_pushed 行仍不存在）
    assert.doesNotMatch(readFileSync(NOTE_FILE, 'utf8'), /evening_pushed: "[^"]/);
  } finally {
    if (prev === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = prev;
    removeNote();
  }
});
