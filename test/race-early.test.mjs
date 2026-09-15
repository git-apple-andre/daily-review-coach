// test/race-early.test.mjs —— 卡片回调的超时兜底逻辑
//
// 背景：飞书要求卡片回调 3 秒内响应，但完整处理要打 5 次以上跨洋
// GitHub API，实测 ~2.6 秒，卡在临界点。超时后必须"先响应、后台继续跑"，
// 否则用户看到 200341 报错（虽然回执最后还是发了）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { raceEarly } from '../scf/feishu-callback/index.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('任务快于时限：走正常分支，返回真实结果', async () => {
  const r = await raceEarly(Promise.resolve({ statusCode: 200, body: 'ok' }), 1000);
  assert.equal(r.early, false);
  assert.equal(r.result.body, 'ok');
});

test('任务慢于时限：提前返回，不阻塞', async () => {
  let done = false;
  const slow = sleep(300).then(() => { done = true; return { body: 'late' }; });

  const t0 = Date.now();
  const r = await raceEarly(slow, 60);
  const elapsed = Date.now() - t0;

  assert.equal(r.early, true, '应判定为提前返回');
  assert.ok(elapsed < 200, `应在时限附近返回，实际 ${elapsed}ms`);

  // 关键：提前返回不等于放弃任务
  await sleep(400);
  assert.equal(done, true, '后台任务必须继续跑完（否则判分写回就丢了）');
});

test('任务失败时如实返回错误，不吞掉', async () => {
  const r = await raceEarly(Promise.reject(new Error('boom')), 1000);
  assert.equal(r.early, false);
  assert.ok(r.error, '错误必须传出来，否则会变成 unhandledRejection');
  assert.equal(r.error.message, 'boom');
});

test('任务失败但已超时：仍走提前返回分支', async () => {
  const r = await raceEarly(sleep(300).then(() => { throw new Error('late boom'); }), 60);
  assert.equal(r.early, true, '已经超时了，不该等任务失败');
});

test('任务失败后的 rejection 不会变成 unhandledRejection', async () => {
  const seen = [];
  const onUnhandled = (e) => seen.push(e);
  process.on('unhandledRejection', onUnhandled);

  try {
    // 先超时返回，之后任务才失败 —— 这个 rejection 必须有人接住
    const p = sleep(150).then(() => { throw new Error('orphan'); });
    const r = await raceEarly(p, 30);
    assert.equal(r.early, true);

    // 挂上兜底，模拟 server.mjs 里的 .catch()
    await p.catch(() => {});
    await sleep(100);

    assert.deepEqual(seen, [], '不应产生 unhandledRejection');
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('时限为 0：立即返回 early', async () => {
  const r = await raceEarly(sleep(50).then(() => ({ body: 'x' })), 0);
  assert.equal(r.early, true);
});

test('定时器被清理：正常分支不会拖住事件循环', async () => {
  // 若忘了 clearTimeout，Node 进程会多挂 5 秒
  const t0 = Date.now();
  await raceEarly(Promise.resolve({ body: 'fast' }), 5000);
  assert.ok(Date.now() - t0 < 100, '正常完成后应立即返回，不等满时限');
});
