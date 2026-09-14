// scripts/lib/config.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.env.DAILY_ROOT || path.resolve(import.meta.dirname, '..', '..');

export function loadUsers() {
  const raw = JSON.parse(readFileSync(path.join(ROOT, 'users', 'users.json'), 'utf8'));
  return raw.filter(u => u.active);
}
export function loadUserConfig(userId) {
  const cfg = JSON.parse(readFileSync(path.join(ROOT, 'users', userId, 'config.json'), 'utf8'));
  const tz = cfg && cfg.tz;
  if (typeof tz !== 'string' || tz.trim() === '') {
    throw new Error(`loadUserConfig: 用户 ${userId} 的 config.json 缺少有效 tz（实际值：${JSON.stringify(tz)}）`);
  }
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
  } catch {
    throw new Error(`loadUserConfig: 用户 ${userId} 的 config.json tz 非法：${JSON.stringify(tz)}`);
  }
  return cfg;
}
export function hourInTz(tz, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).formatToParts(now);
  const h = parts.find(p => p.type === 'hour').value;
  return Number(h === '24' ? '0' : h); // en-GB 午夜可能返回 24
}
export function dateInTz(tz, now = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const g = t => p.find(x => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
export const inMorningWindow = h => h >= 8 && h <= 13;
export const inEveningWindow = h => h >= 20 && h <= 23;
