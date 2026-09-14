// test/grade.test.mjs — Task 7 判分对照 + 回调 handler dry-run 验证
// 判分对照：fixture（9/10 日记提取）ruankao_json 20 题 / ielts_json 50 词，与 n8n W3 同卷同果
// handler dry-run：样例飞书回调事件直调 main_handler（DRY_RUN=1 + 临时 DAILY_ROOT，不真写 GitHub）
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gradeRuankao, gradeWords } from '../scf/feishu-callback/grade.mjs';
import { rebuildRuankao, rebuildMorning, rebuildEvening, tsFromNote } from '../scf/feishu-callback/rebuild.mjs';
import { main_handler, parseCallback, resolveUser, buildReceipt, buildTzCard, __resetReplay } from '../scf/feishu-callback/index.mjs';

const FIXTURE = readFileSync(new URL('./fixtures/day-note.md', import.meta.url), 'utf8');
const RK_JSON = FIXTURE.match(/<!-- automation:ruankao_json ([^\n]*?) -->/)[1];
const IE_JSON = FIXTURE.match(/<!-- automation:ielts_json ([^\n]*?) -->/)[1];
const QUESTIONS = JSON.parse(RK_JSON).questions; // 20 题 {topic,question,options,answer,analysis,memory_hook}
const WORDS = JSON.parse(IE_JSON).words; // 50 词 {w,ph,rt,def,st,st_cn}
const CORRECT = QUESTIONS.map((q) => q.answer); // 全对答卷（真实正确答案）
const SAMPLE_WORDS = WORDS.filter((_, i) => i % 5 === 0).slice(0, 10); // 与 W3 采样一致

const ansOf = (over = {}) => Object.fromEntries(CORRECT.map((a, i) => [`q${i + 1}`, over[`q${i + 1}`] ?? a]));

// ================= 判分对照（验收级：与 W3 同卷同果） =================

test('判分对照：fixture 20 题全对 → score=20 / wrong=[] / unanswered=[]', () => {
  const r = gradeRuankao(QUESTIONS, CORRECT);
  assert.equal(r.score, 20);
  assert.equal(r.total, 20);
  assert.deepEqual(r.wrong, []);
  assert.deepEqual(r.unanswered, []);
});

test('判分对照：错一题（q1 填 C，正确 B）→ score=19，wrong[0] 含 n/user/correct/topic/analysis', () => {
  const r = gradeRuankao(QUESTIONS, Object.values(ansOf({ q1: 'C' })));
  assert.equal(r.score, 19);
  assert.equal(r.wrong.length, 1);
  assert.deepEqual(r.wrong[0], {
    n: 1,
    user: 'C', // W3 原键名（brief 所称 user_answer），Task 6 晚间卡按 user 消费
    correct: 'B',
    topic: '挣值分析',
    analysis: 'CPI=EV/AC=90/110≈0.82<1，表明成本超支。',
  });
});

test('判分对照：小写/带空白答案归一（W3：trim + toUpperCase）', () => {
  const r = gradeRuankao(QUESTIONS, Object.values(ansOf({ q2: '  b ', q5: 'b' })));
  assert.equal(r.score, 20);
});

test('判分对照：未作答（q3 空）→ 不入 wrong，unanswered=[3]，score=19', () => {
  const r = gradeRuankao(QUESTIONS, Object.values(ansOf({ q3: '' })));
  assert.equal(r.score, 19);
  assert.deepEqual(r.unanswered, [3]);
  assert.equal(r.wrong.length, 0);
});

test('单词自测判分：10 词全对（小写比对，W3 每 5 取 1 采样）', () => {
  const fv = Object.fromEntries(SAMPLE_WORDS.map((w, i) => [`ie_w${i + 1}`, w.w]));
  const r = gradeWords(WORDS, fv);
  assert.equal(r.score, 10);
  assert.equal(r.total, 10);
  assert.deepEqual(r.wrong, []);
});

test('单词自测判分：错一词 → wrong 记录正确拼写；未作答跳过不计分', () => {
  const fv = Object.fromEntries(SAMPLE_WORDS.map((w, i) => [`ie_w${i + 1}`, i === 1 ? 'implcation' : w.w]));
  delete fv.ie_w5; // 第 5 题未作答
  const r = gradeWords(WORDS, fv);
  assert.equal(r.score, 8);
  assert.deepEqual(r.wrong, ['implication']);
});

test('单词自测判分：大小写/首尾空白归一（W3：trim + toLowerCase）', () => {
  const fv = Object.fromEntries(SAMPLE_WORDS.map((w, i) => [`ie_w${i + 1}`, '  ' + w.w.toUpperCase() + ' ']));
  const r = gradeWords(WORDS, fv);
  assert.equal(r.score, 10);
});

// ================= 重建函数（W3「重建笔记」移植，写回内容断言） =================

test('rebuildRuankao：全对 → ruankao_user 双重 JSON + 今日交卷行 + 不改动其他节', () => {
  const r = rebuildRuankao(FIXTURE, { note_date: '2026-09-10', form_type: 'ruankao', ...ansOf() }, { now: new Date('2026-09-10T12:00:00+08:00') });
  assert.equal(r.score, 20);
  const raw = r.content.match(/^  ruankao_user:\s*(.*)$/m)[1];
  const user = JSON.parse(JSON.parse(raw)); // 双重 JSON（与 evening.mjs getFmRaw 消费一致）
  assert.equal(user.score, 20);
  assert.equal(user.total, 20);
  assert.deepEqual(user.wrong, []);
  assert.match(user.at, /^2026-09-10 \d{2}:\d{2}:\d{2}$/);
  assert.match(r.content, /- 今日交卷：20\/20 🎉 全对/);
});

test('rebuildRuankao：错一题 → wrong 与「今日交卷（错：1）」行', () => {
  const r = rebuildRuankao(FIXTURE, { note_date: '2026-09-10', form_type: 'ruankao', ...ansOf({ q1: 'C' }) });
  const user = JSON.parse(JSON.parse(r.content.match(/^  ruankao_user:\s*(.*)$/m)[1]));
  assert.equal(user.score, 19);
  assert.equal(user.wrong[0].n, 1);
  assert.equal(user.wrong[0].user, 'C');
  assert.match(r.content, /- 今日交卷：19\/20（错：1）/);
});

test('rebuildMorning：青蛙/生活todo/作息/锻炼写入 + morning_submitted 标记', () => {
  const fv = {
    note_date: '2026-09-10', form_type: 'morning',
    bedtime: '23:10', last_night: '无夜宵', wake_time: '07:20',
    exercise: ['哑铃'],
    frog_1: '写日报', frog_2: '代码评审', frog_3: '背单词',
    life_todos: '买菜, 取快递',
  };
  const r = rebuildMorning(FIXTURE, fv, { now: new Date('2026-09-10T12:00:00+08:00') });
  assert.equal(r.frogCount, 3);
  assert.equal(r.lifeCount, 2);
  assert.match(r.content, /- \[ \] 🔴\s+写日报/);
  assert.match(r.content, /- \[ \] 🟡\s+代码评审/);
  assert.match(r.content, /- \[ \] 🟢\s+背单词/);
  assert.match(r.content, /- \[ \] 买菜/);
  assert.match(r.content, /- \[ \] 取快递/);
  assert.match(r.content, /- \*\*昨夜睡前（活动\/饮食\/睡眠时间）\*\*：23:10 入睡；无夜宵/);
  assert.match(r.content, /- \*\*今晨状态（起床时间\/晨间习惯）\*\*：07:20 起床/);
  assert.match(r.content, /- \*\*身体活动\*\*：晨间：哑铃/);
  assert.match(r.content, /^  morning_submitted: "[^"]+（飞书表单）"$/m);
});

test('rebuildMorning：同一青蛙值重复提交 → 第二次静默跳过（W3 scope.includes，M1 修复）', () => {
  const fv = { note_date: '2026-09-10', form_type: 'morning', frog_1: '写日报' };
  const r1 = rebuildMorning(FIXTURE, fv, { now: new Date('2026-09-10T12:00:00+08:00') });
  assert.equal(r1.frogCount, 1);
  assert.equal(r1.unmatchedCount, 0);
  // 10 分钟防重放窗口后重交同一值：不产生新行、不追加「📥 飞书回传」、不报 unmatched
  const r2 = rebuildMorning(r1.content, fv, { now: new Date('2026-09-10T12:20:00+08:00') });
  assert.equal(r2.frogCount, 0);
  assert.equal(r2.unmatchedCount, 0);
  assert.equal((r2.content.match(/写日报/g) || []).length, 1);
  assert.ok(!r2.content.includes('## 📥 飞书回传'));
});

test('rebuildEvening：青蛙/生活勾选 + 三省 + 单词自测 10/10 + evening_submitted 仅首次填写', () => {
  const fv = {
    note_date: '2026-09-10', form_type: 'evening',
    frogs_done: ['frog_0', 'frog_1'],
    life_done: ['life_1'],
    exercise_done: '哑铃1组', reading_done: '《XX》30页',
    reflect_1: '完成复盘自动化', reflect_2: '问了AI判分设计', reflect_3: 'GitHub写回冲突', reflect_4: '明日加监控',
    study_done_rk: ['rk_plan', 'rk_input'], rk_input_val: '20题', rk_mistake_val: '第3题混淆',
    study_done_ie: ['ie_plan'], ie_listen_val: '精听25min', ie_words_val: '50词完成',
    ...Object.fromEntries(SAMPLE_WORDS.map((w, i) => [`ie_w${i + 1}`, w.w])),
  };
  const r = rebuildEvening(FIXTURE, fv, { now: new Date('2026-09-10T12:00:00+08:00') });
  assert.equal(r.wordScore, 10);
  assert.deepEqual(r.wordWrong, []);
  assert.equal(r.unmatchedCount, 0);
  assert.match(r.content, /- \[x\] 🔴 /);
  assert.match(r.content, /- \[x\] 🟡 /);
  // 生活备忘节第 2 个 todo 打勾（life_1）
  const life = r.content.match(/### 🏠 生活备忘[^\n]*\n([\s\S]*?)(?=\n#{2,3} |\n---)/)[1];
  assert.equal(life.match(/^-\s\[x\]/gm).length, 1);
  assert.match(r.content, /- 单词自测：10\/10 🎉 全对/);
  assert.match(r.content, /1\. \*\*🎉 今日成就感\/开心事\*\*：完成复盘自动化/);
  assert.match(r.content, /2\. \*\*✨ 我问了AI什么，AI问了我什么\*\*：问了AI判分设计/);
  assert.match(r.content, /4\. \*\*✨ 改进与明日动作\*\*：明日加监控/);
  // 软考/雅思节勾选与量化输入（W3 节作用域区分重名「今日计划与完成度」）
  assert.match(r.content, /^  evening_submitted: "2026-09-10 \d{2}:\d{2}:\d{2}（飞书表单）"$/m);
});

test('rebuildEvening：evening_submitted 已存在 → 不覆盖（W3 语义）', () => {
  const filled = FIXTURE.replace(/^  evening_submitted: ""$/m, '  evening_submitted: "2026-09-10 21:00:00（飞书表单）"');
  const r = rebuildEvening(filled, { note_date: '2026-09-10', form_type: 'evening', frogs_done: ['frog_0'] });
  assert.match(r.content, /^  evening_submitted: "2026-09-10 21:00:00（飞书表单）"$/m);
});

test('tsFromNote：用笔记 timezone（非容器时区）生成时间戳', () => {
  const ts = tsFromNote(FIXTURE, '2026-09-10 00:00:00', new Date('2026-09-10T20:00:00Z'));
  assert.equal(ts, '2026-09-11 04:00:00'); // Asia/Shanghai = UTC+8
});

// ================= parseCallback（W3「解析回调」移植） =================

const BASE_EVENT = (action) => ({
  schema: '2.0',
  header: { event_id: 'ev1', token: 'vt', event_type: 'card.action.trigger', app_id: 'cli_test' },
  event: { operator: { open_id: 'ou_test_openid_123' }, action, open_message_id: 'om1', open_chat_id: 'oc_test_chat' },
});

test('parseCallback：URL 验证 → challenge 原样回传', () => {
  assert.deepEqual(parseCallback({ type: 'url_verification', challenge: 'abc123', token: 'vt' }), {
    kind: 'verify', challenge: 'abc123',
  });
});

test('parseCallback：2.0 卡片 event.action.value（form_submit/按钮卡）解析', () => {
  const cb = parseCallback(BASE_EVENT({ tag: 'button', value: { note_date: '2026-09-10', form_type: 'ruankao', q1: 'B' } }));
  assert.equal(cb.kind, 'form');
  assert.equal(cb.openId, 'ou_test_openid_123');
  assert.equal(cb.chatId, 'oc_test_chat');
  assert.equal(cb.noteDate, '2026-09-10');
  assert.equal(cb.formType, 'ruankao');
  assert.equal(cb.formValue.q1, 'B');
});

test('parseCallback：1.0 形态 event.action.form_value（字符串 JSON）解析', () => {
  const cb = parseCallback(BASE_EVENT({ tag: 'button', form_value: JSON.stringify({ note_date: '2026-09-10', form_type: 'morning', frog_1: 'x' }) }));
  assert.equal(cb.kind, 'form');
  assert.equal(cb.formType, 'morning');
  assert.equal(cb.formValue.frog_1, 'x');
});

test('parseCallback：无表单 → ignore；note_date 非法 → ignore；类型推断（q1→ruankao / bedtime→morning）', () => {
  assert.equal(parseCallback(BASE_EVENT({ tag: 'button' })).kind, 'ignore');
  assert.equal(parseCallback(BASE_EVENT({ tag: 'button', value: { note_date: '2026/09/10', form_type: 'ruankao' } })).kind, 'ignore');
  assert.equal(parseCallback(BASE_EVENT({ tag: 'button', value: { note_date: '2026-09-10', q1: 'B' } })).formType, 'ruankao');
  assert.equal(parseCallback(BASE_EVENT({ tag: 'button', value: { note_date: '2026-09-10', bedtime: '23:00' } })).formType, 'morning');
  assert.equal(parseCallback(BASE_EVENT({ tag: 'button', value: { note_date: '2026-09-10' } })).formType, 'evening');
});

test('parseCallback：multi_select 逗号字符串归一为数组；tz 表单免 note_date 校验', () => {
  const cb = parseCallback(BASE_EVENT({ tag: 'button', value: { note_date: '2026-09-10', form_type: 'evening', frogs_done: 'frog_0, frog_2' } }));
  assert.deepEqual(cb.formValue.frogs_done, ['frog_0', 'frog_2']);
  const tz = parseCallback(BASE_EVENT({ tag: 'button', value: { form_type: 'tz', tz: 'Pacific/Tarawa' } }));
  assert.equal(tz.kind, 'form');
  assert.equal(tz.formType, 'tz');
});

// ================= 白名单 / 回执 / 时区卡 =================

test('resolveUser：open_id 命中 active 用户 → userId；未注册/inactive/非法 id 一律拒绝', () => {
  const users = [
    { id: 'u_example', open_id: 'ou_a', active: true },
    { id: 'u_off', open_id: 'ou_b', active: false },
  ];
  assert.equal(resolveUser(users, 'ou_a'), 'u_example');
  assert.equal(resolveUser(users, 'ou_b'), null); // inactive
  assert.equal(resolveUser(users, 'ou_stranger'), null); // 未注册
  assert.equal(resolveUser(users, ''), null);
  assert.equal(resolveUser([{ id: '../etc', open_id: 'ou_c', active: true }], 'ou_c'), null); // 路径穿越防御
});

test('buildReceipt：morning/ruankao(全对)/ruankao(错题+未答)/evening/tz 五种文案（W3「组装确认」）', () => {
  assert.match(buildReceipt('morning', { noteName: '晨间日记+复盘 - 20260910.md', filled: 8, unmatchedCount: 0 }), /✅ 晨间打卡已写入/);
  assert.match(buildReceipt('ruankao', { score: 20, total: 20, wrong: [], unanswered: [] }), /20\/20 🎉 全对/);
  assert.match(buildReceipt('ruankao', { score: 17, total: 20, wrong: [{ n: 3 }], unanswered: [9] }), /17\/20，1 题未作答。错题：3/);
  assert.match(buildReceipt('evening', { noteName: 'x.md', filled: 10, unmatchedCount: 0, wordScore: 10, wordWrong: [] }), /单词自测 10\/10 🎉 全对/);
  assert.match(buildReceipt('evening', { noteName: 'x.md', filled: 10, unmatchedCount: 0, wordScore: 8, wordWrong: ['implication'] }), /单词自测 8\/10（错：implication）/);
  assert.match(buildReceipt('tz', { tz: 'Pacific/Tarawa' }), /已切换到 Pacific\/Tarawa/);
});

test('buildTzCard：四个时区按钮 + value 携带 form_type=tz', () => {
  const card = buildTzCard();
  const actions = card.body.elements.find((e) => e.tag === 'action').actions;
  assert.deepEqual(actions.map((a) => a.value.tz), ['Asia/Shanghai', 'Asia/Hong_Kong', 'Pacific/Tarawa', 'Pacific/Fiji']);
  assert.ok(actions.every((a) => a.value.form_type === 'tz'));
});

// ================= handler dry-run（样例事件直调，不真写 GitHub） =================

const OPEN_ID = 'ou_test_openid_123';
const CHAT_ID = 'oc_test_chat';
const NOTE_DATE = '2026-09-10';
const NOTE_NAME = '晨间日记+复盘 - 20260910.md';

function makeRoot() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'scf-cb-'));
  mkdirSync(path.join(tmp, 'users', 'u_example', 'daily'), { recursive: true });
  writeFileSync(path.join(tmp, 'users', 'users.json'), JSON.stringify([
    { id: 'u_example', open_id: OPEN_ID, plan: 'free', active: true },
  ]));
  writeFileSync(path.join(tmp, 'users', 'u_example', 'config.json'), JSON.stringify({
    tz: 'Asia/Shanghai', chat_id: CHAT_ID, note_template: 'daily',
  }));
  writeFileSync(path.join(tmp, 'users', 'u_example', 'daily', NOTE_NAME), FIXTURE);
  return tmp;
}

function gwEvent(inner) {
  return { body: JSON.stringify(inner), headers: {}, httpMethod: 'POST', path: '/feishu-card-cb' };
}
const formEvent = (value) => BASE_EVENT({ tag: 'button', value });
const respJson = (res) => JSON.parse(res.body);

const prevEnv = {};
function setDryRun(root) {
  prevEnv.DAILY_ROOT = process.env.DAILY_ROOT;
  prevEnv.DRY_RUN = process.env.DRY_RUN;
  process.env.DAILY_ROOT = root;
  process.env.DRY_RUN = '1';
}
function restoreEnv() {
  if (prevEnv.DAILY_ROOT === undefined) delete process.env.DAILY_ROOT; else process.env.DAILY_ROOT = prevEnv.DAILY_ROOT;
  if (prevEnv.DRY_RUN === undefined) delete process.env.DRY_RUN; else process.env.DRY_RUN = prevEnv.DRY_RUN;
}
const prevToken = {};
function setToken(v) {
  prevToken.V = process.env.FEISHU_VERIFICATION_TOKEN;
  process.env.FEISHU_VERIFICATION_TOKEN = v;
}
function restoreToken() {
  if (prevToken.V === undefined) delete process.env.FEISHU_VERIFICATION_TOKEN;
  else process.env.FEISHU_VERIFICATION_TOKEN = prevToken.V;
}
test.beforeEach(() => { __resetReplay(); setToken('vt'); }); // BASE_EVENT header.token='vt'：token 校验必填后所有 handler 测试需匹配
test.afterEach(() => { restoreEnv(); restoreToken(); });

test('handler dry-run：url_verification 回 challenge（API 网关事件包裹 body 字符串）', async () => {
  setDryRun(makeRoot());
  const res = await main_handler(gwEvent({ type: 'url_verification', challenge: 'abc123', token: 'vt' }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(respJson(res), { challenge: 'abc123' });
});

test('handler dry-run：交卷全对 → 回执 20/20 全对，写回含 ruankao_user/今日交卷，本地文件未改动', async () => {
  const root = makeRoot();
  setDryRun(root);
  const notePath = path.join(root, 'users', 'u_example', 'daily', NOTE_NAME);
  const res = await main_handler(gwEvent(formEvent({ note_date: NOTE_DATE, form_type: 'ruankao', ...ansOf() })));
  const body = respJson(res);
  assert.equal(body.code, 0);
  assert.match(body.receipt, /📚 交卷完成：20\/20 🎉 全对/);
  // dry-run 输出写回 diff（content 随响应返回，供验证）
  const user = JSON.parse(JSON.parse(body.content.match(/^  ruankao_user:\s*(.*)$/m)[1]));
  assert.equal(user.score, 20);
  assert.match(body.content, /- 今日交卷：20\/20 🎉 全对/);
  // 不真写（dry-run 语义）
  assert.equal(readFileSync(notePath, 'utf8'), FIXTURE);
});

test('handler dry-run：晨间打卡 → 青蛙/生活todo写回 + 回执；笔记不存在 → code 4', async () => {
  const root = makeRoot();
  setDryRun(root);
  const res = await main_handler(gwEvent(formEvent({
    note_date: NOTE_DATE, form_type: 'morning',
    bedtime: '23:10', wake_time: '07:20', exercise: ['哑铃'],
    frog_1: '写日报', frog_2: '代码评审', life_todos: '买菜',
  })));
  const body = respJson(res);
  assert.equal(body.code, 0);
  assert.match(body.receipt, /✅ 晨间打卡已写入 Obsidian《晨间日记\+复盘 - 20260910\.md》/);
  assert.match(body.content, /- \[ \] 🔴\s+写日报/);
  assert.match(body.content, /^  morning_submitted: "[^"]+（飞书表单）"$/m);
  // 日记不存在（无该日期文件）
  const res2 = await main_handler(gwEvent(formEvent({ note_date: '2026-09-11', form_type: 'evening' })));
  assert.equal(respJson(res2).code, 4);
});

test('handler dry-run：晚间复盘 → 单词自测 10/10 回执 + 三省/勾选写回', async () => {
  const root = makeRoot();
  setDryRun(root);
  const res = await main_handler(gwEvent(formEvent({
    note_date: NOTE_DATE, form_type: 'evening',
    frogs_done: ['frog_0'], life_done: ['life_1'],
    reflect_1: '完成复盘自动化', reflect_4: '明日加监控',
    ...Object.fromEntries(SAMPLE_WORDS.map((w, i) => [`ie_w${i + 1}`, w.w])),
  })));
  const body = respJson(res);
  assert.equal(body.code, 0);
  assert.match(body.receipt, /单词自测 10\/10 🎉 全对/);
  assert.match(body.content, /- \[x\] 🔴 /);
  assert.match(body.content, /- 单词自测：10\/10 🎉 全对/);
  assert.match(body.content, /1\. \*\*🎉 今日成就感\/开心事\*\*：完成复盘自动化/);
  assert.match(body.content, /^  evening_submitted: "[^"]+（飞书表单）"$/m);
});

test('handler dry-run：白名单拒绝未知 open_id（不处理、不改文件）', async () => {
  const root = makeRoot();
  setDryRun(root);
  const ev = formEvent({ note_date: NOTE_DATE, form_type: 'ruankao', ...ansOf() });
  ev.event.operator.open_id = 'ou_stranger_999';
  const res = await main_handler(gwEvent(ev));
  assert.equal(respJson(res).code, 3);
  assert.match(respJson(res).msg, /未注册|未激活/);
});

test('handler dry-run：防重放（同 key 10 分钟内第二次忽略）', async () => {
  const root = makeRoot();
  setDryRun(root);
  const ev = gwEvent(formEvent({ note_date: NOTE_DATE, form_type: 'ruankao', ...ansOf() }));
  const r1 = await main_handler(ev);
  assert.equal(respJson(r1).code, 0);
  const r2 = await main_handler(ev);
  assert.equal(respJson(r2).code, 0);
  assert.match(respJson(r2).msg, /dup|重复/);
});

test('handler dry-run：时区切换 → 校验 IANA 写 config；非法 IANA 拒绝', async () => {
  const root = makeRoot();
  setDryRun(root);
  const res = await main_handler(gwEvent(formEvent({ form_type: 'tz', tz: 'Pacific/Tarawa' })));
  const body = respJson(res);
  assert.equal(body.code, 0);
  assert.match(body.receipt, /已切换到 Pacific\/Tarawa/);
  assert.equal(body.config.tz, 'Pacific/Tarawa'); // dry-run 输出将写入的 config 内容
  // 本地 config.json 未被 dry-run 改动
  assert.equal(JSON.parse(readFileSync(path.join(root, 'users', 'u_example', 'config.json'), 'utf8')).tz, 'Asia/Shanghai');
  // 非法 IANA → 拒绝
  const bad = await main_handler(gwEvent(formEvent({ form_type: 'tz', tz: 'Mars/Olympus' })));
  assert.equal(respJson(bad).code, 5);
});

test('handler dry-run：form_value 1.0 形态直调（W3 解析路径同卷同果）', async () => {
  const root = makeRoot();
  setDryRun(root);
  const ev = gwEvent({
    header: { event_type: 'card.action.trigger', token: 'vt' },
    event: {
      operator: { open_id: OPEN_ID },
      action: { form_value: { note_date: NOTE_DATE, form_type: 'ruankao', ...ansOf() } },
      open_chat_id: CHAT_ID,
    },
  });
  const res = await main_handler(ev);
  assert.equal(respJson(res).code, 0);
  assert.match(respJson(res).receipt, /20\/20 🎉 全对/);
});

test('handler：FEISHU_VERIFICATION_TOKEN 设置后按 body.header.token 校验（M2 修复：对→通过/错→拒绝）', async () => {
  const root = makeRoot();
  setDryRun(root);
  setToken('vt_secret');
  const inner = formEvent({ note_date: NOTE_DATE, form_type: 'ruankao', ...ansOf() });
  // 正确 token（body.header.token）→ 通过并处理
  const good = await main_handler(gwEvent({ ...inner, header: { event_id: 'ev1', event_type: 'card.action.trigger', token: 'vt_secret' } }));
  assert.equal(respJson(good).code, 0);
  assert.match(respJson(good).receipt, /20\/20 🎉 全对/);
  // 错误 token → 拒绝（HTTP 头里的 token 不参与比对）
  const bad = await main_handler(gwEvent({ ...inner, header: { event_id: 'ev2', event_type: 'card.action.trigger', token: 'vt_wrong' } }));
  assert.equal(respJson(bad).code, 2);
  const viaHttpHeader = gwEvent(inner);
  viaHttpHeader.headers = { token: 'vt_secret' }; // body.header.token 仍为 'vt' → 拒绝
  assert.equal(respJson(await main_handler(viaHttpHeader)).code, 2);
});

test('handler：url_verification 也做 token 校验（M2 修复：对→challenge/错→code 2）', async () => {
  setDryRun(makeRoot());
  setToken('vt_secret');
  const good = await main_handler(gwEvent({ type: 'url_verification', challenge: 'abc123', token: 'vt_secret' }));
  assert.deepEqual(respJson(good), { challenge: 'abc123' });
  const bad = await main_handler(gwEvent({ type: 'url_verification', challenge: 'abc123', token: 'vt_wrong' }));
  assert.equal(respJson(bad).code, 2);
});

test('handler：未设置 FEISHU_VERIFICATION_TOKEN → 拒绝所有回调不写数据；设置后正确 token 通过（I1 修复）', async () => {
  const root = makeRoot();
  setDryRun(root);
  const notePath = path.join(root, 'users', 'u_example', 'daily', NOTE_NAME);
  const ev = gwEvent(formEvent({ note_date: NOTE_DATE, form_type: 'ruankao', ...ansOf() }));
  // 未设置 token env（覆盖 beforeEach 的默认值）→ 拒绝（code 2），文件未写
  delete process.env.FEISHU_VERIFICATION_TOKEN;
  const noToken = await main_handler(ev);
  assert.equal(respJson(noToken).code, 2);
  assert.match(respJson(noToken).msg, /FEISHU_VERIFICATION_TOKEN 未设置/);
  assert.equal(readFileSync(notePath, 'utf8'), FIXTURE);
  // url_verification 同样拒绝（不因 env 缺失放行）
  const noTokenVerify = await main_handler(gwEvent({ type: 'url_verification', challenge: 'abc123', token: 'vt' }));
  assert.equal(respJson(noTokenVerify).code, 2);
  // 设置后正确 token（body.header.token='vt'）→ 通过并处理
  setToken('vt');
  const good = await main_handler(ev);
  assert.equal(respJson(good).code, 0);
  assert.match(respJson(good).receipt, /20\/20 🎉 全对/);
});
