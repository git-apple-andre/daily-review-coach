// test/guard.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { hourInTz, dateInTz, inMorningWindow, inEveningWindow, loadUsers, loadUserConfig } from '../scripts/lib/config.mjs';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FIX = path.join(import.meta.dirname, 'fixtures');

test('hourInTz 上海 vs UTC 差 8 小时', () => {
  const now = new Date('2026-09-11T02:30:00Z'); // 上海 10:30
  assert.equal(hourInTz('Asia/Shanghai', now), 10);
  assert.equal(hourInTz('UTC', now), 2);
});
test('hourInTz 非法时区抛错', () => {
  assert.throws(() => hourInTz('Not/AZone', new Date()));
});
test('窗口判定边界', () => {
  assert.equal(inMorningWindow(7), false);
  assert.equal(inMorningWindow(8), true);
  assert.equal(inMorningWindow(13), true);
  assert.equal(inMorningWindow(14), false);
  assert.equal(inEveningWindow(19), false);
  assert.equal(inEveningWindow(20), true);
  assert.equal(inEveningWindow(23), true);
  assert.equal(inEveningWindow(0), false);
});
test('dateInTz 跨日正确', () => {
  assert.equal(dateInTz('Asia/Shanghai', new Date('2026-09-10T17:00:00Z')), '2026-09-11');
});

// --- loadUsers / loadUserConfig（临时 DAILY_ROOT 隔离） ---

function makeTempRoot(users, config) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'daily-review-guard-'));
  mkdirSync(path.join(dir, 'users'), { recursive: true });
  writeFileSync(path.join(dir, 'users', 'users.json'), JSON.stringify(users));
  if (config !== undefined) {
    mkdirSync(path.join(dir, 'users', 'u_example'), { recursive: true });
    writeFileSync(path.join(dir, 'users', 'u_example', 'config.json'), JSON.stringify(config));
  }
  return dir;
}

// ROOT 在模块加载时求值，故用带 query 的动态 import 拿一份绑定 DAILY_ROOT 的新实例
async function loadConfigModule(root) {
  const prev = process.env.DAILY_ROOT;
  process.env.DAILY_ROOT = root;
  try {
    return await import(`../scripts/lib/config.mjs?root=${encodeURIComponent(root)}`);
  } finally {
    if (prev === undefined) delete process.env.DAILY_ROOT;
    else process.env.DAILY_ROOT = prev;
  }
}

test('loadUsers 仅返回 active 用户', async () => {
  // 仓库真实 users.json：含 u_example 且全部 active
  const real = loadUsers();
  assert.ok(real.some(u => u.id === 'u_example'), '真实 users.json 应含 id==="u_example"');
  assert.ok(real.every(u => u.active), '真实 users.json 返回值应全部 active');

  // 临时 users.json：active:false 必须被过滤
  const dir = makeTempRoot([
    { id: 'u_example', open_id: 'ou_x', plan: 'free', active: true },
    { id: 'u_off', open_id: 'ou_y', plan: 'free', active: false },
  ]);
  try {
    const { loadUsers: loadUsersFrom } = await loadConfigModule(dir);
    const users = loadUsersFrom();
    assert.equal(users.length, 1);
    assert.equal(users[0].id, 'u_example');
    assert.equal(users.some(u => u.id === 'u_off'), false, 'active:false 用户应被过滤');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadUserConfig 返回 tz/chat_id', async () => {
  // 仓库真实 users/u_example/config.json
  const real = loadUserConfig('u_example');
  assert.equal(typeof real.tz, 'string');
  assert.equal(typeof real.chat_id, 'string');

  const dir = makeTempRoot(
    [{ id: 'u_example', open_id: 'ou_x', plan: 'free', active: true }],
    { tz: 'Asia/Shanghai', chat_id: 'oc_test' },
  );
  try {
    const { loadUserConfig: loadUserConfigFrom } = await loadConfigModule(dir);
    const cfg = loadUserConfigFrom('u_example');
    assert.equal(cfg.tz, 'Asia/Shanghai');
    assert.equal(cfg.chat_id, 'oc_test');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadUserConfig 缺 tz / tz 非法时抛错', async () => {
  const badConfigs = [{ chat_id: 'oc_test' }, { tz: '', chat_id: 'oc_test' }, { tz: '   ' }, { tz: 'Not/AZone' }];
  for (const cfg of badConfigs) {
    const dir = makeTempRoot([{ id: 'u_example', open_id: 'ou_x', plan: 'free', active: true }], cfg);
    try {
      const { loadUserConfig: loadUserConfigFrom } = await loadConfigModule(dir);
      assert.throws(
        () => loadUserConfigFrom('u_example'),
        err => {
          assert.equal(err instanceof Error, true);
          assert.match(err.message, /u_example/, '错误消息应含 userId');
          assert.match(err.message, /tz/, '错误消息应含 tz 值');
          return true;
        },
        `config=${JSON.stringify(cfg)} 应抛错`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
