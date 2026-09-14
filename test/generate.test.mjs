// test/generate.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCardJson } from '../scripts/generate.mjs';

test('parseCardJson 标准 JSON（软考单键输出 {"questions":[...]}）', () => {
  const r = parseCardJson('{"questions":[]}');
  assert.deepEqual(r.questions, []);
});
test('parseCardJson 前置散文容错（GLM 偶发混入 {）', () => {
  const text = '以下是题目：\n{"questions":[{"topic":"t"}]}';
  const r = parseCardJson(text);
  assert.equal(r.questions.length, 1);
  assert.equal(r.questions[0].topic, 't');
});
test('parseCardJson 截断输出抛错', () => {
  assert.throws(() => parseCardJson('{"questions":['));
});
test('parseCardJson 雅思裸数组回退解析为 words', () => {
  const r = parseCardJson('[{"w":"abandon","ph":"/əˈbændən/"}]');
  assert.equal(r.words.length, 1);
  assert.equal(r.words[0].w, 'abandon');
});
test('parseCardJson 剥离 think 块与 markdown 围栏', () => {
  const text = '<think>思考中…</think>\n```json\n{"words":[],"listening":{"topic":"t"}}\n```';
  const r = parseCardJson(text);
  assert.deepEqual(r.words, []);
  assert.equal(r.listening.topic, 't');
});
test('parseCardJson 尾随内容容错', () => {
  const text = '{"questions":[{"topic":"t"}]}\n（以上为输出，请核对）';
  const r = parseCardJson(text);
  assert.equal(r.questions[0].topic, 't');
});
