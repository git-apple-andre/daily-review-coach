// test/feishu.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRuankaoCard, buildIeltsCard, buildMorningFormCard, buildEveningCard, getTenantToken } from '../scripts/lib/feishu.mjs';

const cards = {
  ruankao: { questions: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20].map(i => ({ topic: 't', question: 'q', options: ['A','B','C','D'], answer: 'A' })) },
  ielts: { words: [], listening: { minutes: 15, type: '精听', topic: 'ocean', tip: '先盲听' } },
};
const prep = { date: '2026-09-11', weekday: '周五', noteName: '晨间日记+复盘 - 20260911.md' };

test('作答卡 schema 2.0 + 20 个作答栏 + disabled 自动带出字段', () => {
  const c = buildRuankaoCard(cards, prep);
  const s = JSON.stringify(c);
  assert.match(s, /"schema":"2.0"/);
  // 20 个作答输入 q1–q20（disabled 自动带出字段另有 2 个，不计入作答栏）
  assert.equal((s.match(/"name":"q\d+"/g) || []).length, 20);
  assert.equal((s.match(/"disabled":true/g) || []).length, 2);
  assert.match(s, /"name":"note_date"/);
  assert.match(s, /"name":"form_type"/);
  assert.match(s, /form_submit/);
});
test('单词听力卡含新版链接', () => {
  const c = buildIeltsCard(cards, prep);
  const s = JSON.stringify(c);
  assert.match(s, /eslfast\.com/);
  assert.match(s, /hefengxian\.github\.io\/my-ielts/);
});
test('打卡卡含七只青蛙 + 锻炼 multi_select_static + 提交按钮', () => {
  const c = buildMorningFormCard(prep);
  const s = JSON.stringify(c);
  assert.match(s, /🔴/); assert.match(s, /🟡/); assert.match(s, /🟢/);
  assert.match(s, /multi_select_static/);
  assert.equal((s.match(/"name":"frog_\d+"/g) || []).length, 7);
  assert.match(s, /"name":"exercise"/);
  assert.match(s, /form_submit/);
  assert.match(s, /"disabled":true/);
});
test('buildEveningCard 已实现（Task 6）：schema 2.0 晚间复盘卡', () => {
  const c = buildEveningCard({ prep, frogs: [], lifeTodos: [], sampleIelts: [] });
  const s = JSON.stringify(c);
  assert.match(s, /"schema":"2.0"/);
  assert.match(s, /晚间复盘卡/);
  assert.match(s, /"name":"review_form"/);
});
test('getTenantToken 缺少凭据即抛错（不触网）', async () => {
  const save = [process.env.FEISHU_APP_ID, process.env.FEISHU_APP_SECRET];
  delete process.env.FEISHU_APP_ID;
  delete process.env.FEISHU_APP_SECRET;
  try {
    await assert.rejects(() => getTenantToken(), /FEISHU_APP_ID/);
  } finally {
    if (save[0] !== undefined) process.env.FEISHU_APP_ID = save[0];
    if (save[1] !== undefined) process.env.FEISHU_APP_SECRET = save[1];
  }
});
