// test/note.test.mjs — 日记渲染/注入/标记模块（W1/W3 逻辑移植，v3 正则修复全保留）
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { renderTemplate, injectCards, setLine, getFm, setFm, atomicWrite, notePath, readNote } from '../scripts/lib/note.mjs';

const tpl = readFileSync(path.join(import.meta.dirname, 'fixtures', 'template.md'), 'utf8');
const dayNote = readFileSync(path.join(import.meta.dirname, 'fixtures', 'day-note.md'), 'utf8');

test('renderTemplate 注入 automation 块与日期', () => {
  const out = renderTemplate(tpl, { date: '2026-09-11', weekday: '周五', datetime: '2026-09-11 08:05:00', tz: 'Asia/Shanghai' });
  assert.match(out, /^date created: 2026-09-11 08:05:00$/m);
  assert.match(out, /automation:/);
  assert.match(out, /morning_pushed: ""/);
  assert.match(out, /2026-09-11 周五 Daily Log/); // {{date}} → date + weekday
});

test('injectCards 写入隐藏注释且单行无换行', () => {
  const cards = { ruankao: { questions: [{ topic: 't', question: 'q', options: ['A','B','C','D'], answer: 'A', analysis: 'a', memory_hook: 'm' }] }, ielts: { words: [], listening: {} } };
  const out = injectCards(renderTemplate(tpl, { date: '2026-09-11', weekday: '周五', datetime: 'x', tz: 'Asia/Shanghai' }), cards, { datetime: 'x', dify_ok: true });
  // brief 原断言 \{"topic":"t"\} 要求 } 紧跟 "t"，与真实卡片对象（含 question/options 等字段）矛盾，去掉闭括号修正
  assert.match(out, /<!-- automation:ruankao_json \{"questions":\[\{"topic":"t".{0,400}-->/);
  // 单行：automation:ruankao_json 与 --> 之间不得出现换行（brief 原断言 /automation:ruankao_json[^\n]*\n/ 会命中注释行尾的换行，与 W1 注入格式矛盾，改为语义等价断言）
  assert.doesNotMatch(out, /automation:ruankao_json[^>]*\n[^>]*-->/);
  assert.match(out, /morning_generated: "x"/);
});

test('injectCards 听力块使用新版三链接（ESL Fast / 雅思备考词汇库，W1-patched 版）', () => {
  const cards = { ruankao: { questions: [] }, ielts: { words: [], listening: {} } };
  const out = injectCards(renderTemplate(tpl, { date: '2026-09-11', weekday: '周五', datetime: 'x', tz: 'Asia/Shanghai' }), cards, { datetime: 'x', dify_ok: true });
  assert.match(out, /\[ESL Fast 分级听力\]\(https:\/\/www\.eslfast\.com\/\)/);
  assert.match(out, /\[雅思备考词汇库\]\(https:\/\/hefengxian\.github\.io\/my-ielts\/\)/);
  assert.doesNotMatch(out, /takeielts|dict\.eudic/);
});

test('setLine 兼容 - **key**： 行且不误伤冒号', () => {
  let t = '- **昨夜睡前（活动/饮食/睡眠时间）**：\n';
  t = setLine(t, '昨夜睡前', '23:10', {});
  assert.match(t, /23:10/);
  assert.match(t, /\*\*：23:10/);
});

test('setLine 带 checkbox 标签行填值（value 非空同时打勾，W3 晚间语义）', () => {
  let t = '- [ ] **量化输入**：\n';
  t = setLine(t, '量化输入', '20题 + 第5章', {});
  assert.match(t, /- \[x\] \*\*量化输入\*\*：20题 \+ 第5章/);
});

test('setLine checked 打勾（无值仅勾选）', () => {
  let t = '- [ ] **量化输入**：\n';
  t = setLine(t, '量化输入', '', { checked: true });
  assert.match(t, /- \[x\] \*\*量化输入\*\*：\n?$/);
  t = setLine(t, '量化输入', '', { checked: false });
  assert.match(t, /- \[x\] \*\*量化输入\*\*：/); // 已勾选不回退
});

test('setLine sectionRe 重名节区分（软考/雅思节的「今日计划与完成度」）', () => {
  const RK = /### 📚 软考高项[^\n]*\n/;
  const IE = /### 🇬🇧 英语学习[^\n]*\n/;
  let t = setLine(tpl, '今日计划与完成度', '软考20题', { sectionRe: RK });
  assert.match(t, /- \[x\] \*\*今日计划与完成度\*\*：软考20题/);
  assert.match(t, /- \[ \] \*\*今日计划与完成度\*\*：$/m); // 雅思节未动
  t = setLine(t, '今日计划与完成度', '雅思精听', { sectionRe: IE });
  assert.match(t, /- \[x\] \*\*今日计划与完成度\*\*：雅思精听/);
  assert.equal((t.match(/今日计划与完成度\*\*：[^\n]*/g) || []).length, 2);
});

test('setLine 找不到标签行原样返回', () => {
  const t = '无相关内容\n';
  assert.equal(setLine(t, '不存在的键', 'v', {}), t);
});

test('setLine isFrog 填充带行尾空格的空青蛙行（v3：[ \\t]* 行尾覆盖）', () => {
  let t = '### 💼 工作任务 (Work)\n- [ ] 🔴 \n- [ ] 🟡 \n\n### 下一节\n';
  t = setLine(t, '🔴', '写Task3报告', { isFrog: true });
  assert.match(t, /- \[ \] 🔴 +写Task3报告/);
  assert.equal((t.match(/写Task3报告/g) || []).length, 1);
});

test('setLine isFrog 去重：同值任务不重复填入（v3：scope.includes）', () => {
  let t = '### 💼 工作任务 (Work)\n- [ ] 🔴 \n- [ ] 🟡 \n\n### 下一节\n';
  t = setLine(t, '🔴', '写Task3报告', { isFrog: true });
  t = setLine(t, '🔴', '写Task3报告', { isFrog: true });
  assert.equal((t.match(/写Task3报告/g) || []).length, 1);
});

test('setLine isFrog 青蛙行计数不足 7 时补齐 🟢 空行（v3：计数正则）', () => {
  let t = '### 💼 工作任务 (Work)\n- [ ] 🔴 \n- [ ] 🟡 \n\n### 下一节\n';
  t = setLine(t, '🔴', 'x', { isFrog: true });
  const n = (t.match(/^-\s\[[ x]\]\s*(?:🔴|🟡|🟢)/gm) || []).length;
  assert.equal(n, 7);
});

test('injectCards 重跑移除旧注入块且隐藏注释只留一份', () => {
  const base = renderTemplate(tpl, { date: '2026-09-11', weekday: '周五', datetime: 'x', tz: 'Asia/Shanghai' });
  const c1 = { ruankao: { questions: [{ topic: 't', question: '旧题', options: ['A','B'], answer: 'A', analysis: 'a', memory_hook: 'm' }] }, ielts: { words: [], listening: {} } };
  const c2 = { ruankao: { questions: [{ topic: 't2', question: '新题', options: ['A','B'], answer: 'B', analysis: 'a2', memory_hook: 'm2' }] }, ielts: { words: [], listening: {} } };
  const once = injectCards(base, c1, { datetime: 'x', dify_ok: true });
  assert.ok(once.includes('旧题'));
  const twice = injectCards(once, c2, { datetime: 'y', dify_ok: true });
  assert.ok(!twice.includes('旧题'), '旧 callout 应被移除');
  assert.ok(twice.includes('新题'));
  assert.equal((twice.match(/automation:ruankao_json/g) || []).length, 1, '隐藏注释只留一份');
  assert.match(twice, /morning_generated: "y"/);
});

test('injectCards Dify 失败（cards=null）不覆盖旧卡但刷新 morning_generated', () => {
  const base = renderTemplate(tpl, { date: '2026-09-11', weekday: '周五', datetime: 'x', tz: 'Asia/Shanghai' });
  const cards = { ruankao: { questions: [{ topic: 't', question: 'q', options: ['A','B'], answer: 'A', analysis: 'a', memory_hook: 'm' }] }, ielts: { words: [], listening: {} } };
  const once = injectCards(base, cards, { datetime: 'x', dify_ok: true });
  const out = injectCards(once, null, { datetime: 'y', dify_ok: false });
  assert.ok(out.includes('今日软考 1 题（点击展开作答）'), '旧卡保留');
  assert.equal(getFm(out, 'morning_generated'), 'y');
});

test('getFm/setFm automation 标记', () => {
  assert.equal(getFm(dayNote, 'morning_pushed'), '2026-09-10 08:00:05');
  const t2 = setFm(dayNote, 'morning_pushed', '');
  assert.equal(getFm(t2, 'morning_pushed'), '');
  assert.equal(getFm(t2, '不存在的键'), '');
});

test('setFm 键不存在时插入 automation 块，存在时覆盖', () => {
  const base = renderTemplate(tpl, { date: '2026-09-11', weekday: '周五', datetime: 'x', tz: 'Asia/Shanghai' });
  assert.equal(getFm(base, 'morning_pushed'), '');
  const t1 = setFm(base, 'evening_submitted', '"2026-09-11 20:00:00"');
  assert.equal(getFm(t1, 'evening_submitted'), '2026-09-11 20:00:00');
  const t2 = setFm(t1, 'morning_pushed', '"2026-09-11 08:05:00"');
  assert.equal(getFm(t2, 'morning_pushed'), '2026-09-11 08:05:00');
});

test('notePath 返回 users/<id>/daily/ 路径', () => {
  assert.equal(notePath('u_example', '20260911'), path.join('users', 'u_example', 'daily', '晨间日记+复盘 - 20260911.md'));
});

test('readNote 不存在返回 null，存在返回内容', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'note-root-'));
  process.env.DAILY_ROOT = dir;
  try {
    assert.equal(readNote('u_example', '20260911'), null);
    const p = path.join(dir, notePath('u_example', '20260911'));
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, 'hello');
    assert.equal(readNote('u_example', '20260911'), 'hello');
  } finally {
    delete process.env.DAILY_ROOT;
  }
});

test('atomicWrite 原子替换', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'note-'));
  const f = path.join(dir, 'x.md');
  await atomicWrite(f, 'v1');
  assert.equal(readFileSync(f, 'utf8'), 'v1');
  await atomicWrite(f, 'v2');
  assert.equal(readFileSync(f, 'utf8'), 'v2');
  // brief 原断言 readFileSync(f+'.tmp')==='v2'：writeFile→rename 后 tmp 已被消耗（原子语义），改为断言 tmp 不存在
  assert.ok(!existsSync(f + '.tmp'), 'rename 后临时文件应被消耗');
});

test('atomicWrite 父目录不存在时自动创建（回归：2026-09-15 卡片收不到）', async () => {
  // 真实故障：用户把日记"平铺到仓库根"后，users/<id>/daily/ 成了空目录，
  // git 不跟踪空目录 → GitHub Actions 里 clone 出来根本没有这个目录 →
  // writeFile ENOENT → 晨间流程在"出题完成"之后崩掉 → 卡片收不到。
  const dir = mkdtempSync(path.join(tmpdir(), 'note-'));
  const nested = path.join(dir, 'users', 'u_test', 'daily', '晨间日记+复盘 - 20260915.md');

  assert.ok(!existsSync(path.dirname(nested)), '前置条件：父目录确实不存在');

  await atomicWrite(nested, '内容');
  assert.equal(readFileSync(nested, 'utf8'), '内容', '应该自动建目录并写入成功');
});

test('atomicWrite 多层缺失目录也能创建', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'note-'));
  const deep = path.join(dir, 'a', 'b', 'c', 'd', 'x.md');
  await atomicWrite(deep, 'ok');
  assert.equal(readFileSync(deep, 'utf8'), 'ok');
});
