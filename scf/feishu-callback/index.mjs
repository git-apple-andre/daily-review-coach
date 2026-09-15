// scf/feishu-callback/index.mjs — 腾讯云 SCF 回调函数：飞书卡片回调 → 判分写回 GitHub 日记 + 时区切换
// 移植源：n8n W3-飞书回调-写回笔记.json（20260909-fix 部署版）节点对应：
//   Webhook→main_handler 入口（API 网关触发器路径 /feishu-card-cb）；解析回调→parseCallback；
//   URL验证？/有效表单？/重复？→handler 内分支；防重放→模块级 Map（10 分钟窗口，W3 静态数据语义）；
//   GET 笔记/PUT 保存→GitHub Contents API backend（读-改-写重试 3 次）；重建笔记(晨间/晚间/交卷)→rebuild.mjs；
//   获取飞书token/发送确认→scripts/lib/feishu.mjs sendAlert（回执目标：event.open_chat_id，缺省 users/<id>/config.json chat_id）
// 新增（W3 无）：userId 白名单（Task 1 审查裁决）、时区切换表单（form_type=tz）、必填飞书回调 token 校验
//   （I1 审查修复：FEISHU_VERIFICATION_TOKEN 未设置时拒绝处理所有回调，防伪造交卷/打卡）
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { notePath } from '../../scripts/lib/note.mjs';
import { sendAlert } from '../../scripts/lib/feishu.mjs';
import { rebuildRuankao, rebuildMorning, rebuildEvening } from './rebuild.mjs';

// ================= 响应工具（SCF API 网关集成响应形态） =================
const json = (payload, statusCode = 200) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
const ok = (payload) => json({ code: 0, msg: 'ok', ...payload });

// ================= 解析回调（W3「解析回调」逐字移植 + 2.0 value 兜底 + chat_id 提取） =================
export function parseCallback(body) {
  const p = body;

  // 1. 飞书 URL 验证（W3 原样）
  if (p && p.type === 'url_verification' && p.challenge) {
    return { kind: 'verify', challenge: String(p.challenge) };
  }

  // 2. 防御式递归提取 form_value 与 open_id（W3 原样；补充 open_chat_id/chat_id 供回执）
  let formValue = null;
  let openId = '';
  let chatId = '';
  const dig = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 8) return;
    if (Array.isArray(o)) { for (const x of o) dig(x, depth + 1); return; }
    for (const [k, v] of Object.entries(o)) {
      // W3 只接受对象 form_value；1.0 卡片回调的 form_value 是 JSON 字符串（W3 解析段实为死代码），SCF 版补字符串接受
      if (k === 'form_value' && v && (typeof v === 'object' || typeof v === 'string') && !formValue) formValue = v;
      if ((k === 'open_id' || k === 'openId') && typeof v === 'string' && !openId) openId = v;
      if ((k === 'open_chat_id' || k === 'chat_id' || k === 'chatId') && typeof v === 'string' && !chatId) chatId = v;
      if (v && typeof v === 'object') dig(v, depth + 1);
    }
  };
  dig(p, 0);

  // 2b. 2.0 卡片 form_submit/按钮回调的表单值在 event.action.value（W3 只挖 form_value 键，SCF 版补 value 兜底：
  //     仅接受含 form_type/note_date/q1/tz 任一键的对象，避免误抓回调体其他 value 字段）
  if (!formValue) {
    const digValue = (o, depth) => {
      if (!o || typeof o !== 'object' || depth > 8) return;
      if (Array.isArray(o)) { for (const x of o) digValue(x, depth + 1); return; }
      for (const [k, v] of Object.entries(o)) {
        if (k === 'value' && v && typeof v === 'object' && !Array.isArray(v)
          && ['form_type', 'note_date', 'q1', 'tz'].some((kk) => kk in v)) { formValue = v; return; }
        if (v && typeof v === 'object') digValue(v, depth + 1);
      }
    };
    digValue(p, 0);
  }

  // 表单值可能整体是 JSON 字符串（W3 原样）
  if (formValue && typeof formValue === 'string') {
    try { formValue = JSON.parse(formValue); } catch (e) {}
  }

  if (!formValue || typeof formValue !== 'object') {
    return { kind: 'ignore', reason: 'no form_value' };
  }

  // note_date 校验（YYYY-MM-DD）；tz 表单无 note_date（W3 无 tz 表单，此为例外放行）
  let noteDate = String(formValue.note_date || '').trim();
  const rawType = String(formValue.form_type || '').trim().toLowerCase();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(noteDate)) {
    if (rawType !== 'tz') return { kind: 'ignore', reason: 'bad note_date: ' + noteDate };
  }

  // multi_select 可能是数组、逗号分隔字符串、或 JSON 字符串（W3 原样）
  const normMulti = (v) => {
    if (v == null) return [];
    if (Array.isArray(v)) return v.map(String);
    if (typeof v === 'string') {
      try {
        const j = JSON.parse(v);
        if (Array.isArray(j)) return j.map(String);
      } catch (e) {}
      return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
    }
    return [String(v)];
  };
  const fv = {};
  const MULTI_KEYS = ['frogs_done', 'study_done_rk', 'study_done_ie', 'exercise', 'life_done'];
  for (const [k, v] of Object.entries(formValue)) {
    fv[k] = MULTI_KEYS.includes(k) ? normMulti(v) : (v == null ? '' : String(v));
  }
  // 表单类型：优先显式字段，缺失时按特征键推断（W3 原样）
  let formType = String(fv.form_type || '').trim().toLowerCase();
  if (!formType) {
    if (fv.q1 !== undefined) formType = 'ruankao';
    else if (fv.frog_1 !== undefined || fv.frog_red !== undefined || fv.bedtime !== undefined) formType = 'morning';
    else formType = 'evening';
  }

  return { kind: 'form', openId, chatId, noteDate, formType, formValue: fv };
}

// ================= userId 白名单（Task 1 审查裁决：open_id 映射 userId 前必须校验存在且 active） =================
const SAFE_USER_ID = /^[A-Za-z0-9_-]+$/; // 防路径穿越：userId 只允许安全字符
export function resolveUser(users, openId) {
  if (!openId) return null;
  const list = Array.isArray(users) ? users : [];
  const u = list.find((x) => x && x.active && x.open_id === openId);
  if (!u || !u.id || !SAFE_USER_ID.test(u.id)) return null;
  return u.id;
}

// ================= 防重放（W3「防重放」：open_id|note_date|form_type，10 分钟窗口） =================
// W3 用 $getWorkflowStaticData（跨执行持久）；SCF 实例无持久化 → 模块级 Map（单实例内有效，
// 多实例并发时可能漏判——飞书 3s 重试通常落在同实例，README 已注明局限与 Redis 升级路径）
const REPLAY_WINDOW_MS = 10 * 60 * 1000;
const REPLAY_MAX = 200;
const _submitted = new Map();
export function replayKey(cb) {
  // tz 表单无 note_date，key 追加 tz 值避免「10 分钟内切换两次不同时区被误判重复」（W3 无 tz 表单）
  const tzSuffix = cb.formType === 'tz' ? `|${cb.formValue.tz || ''}` : '';
  return `${cb.openId}|${cb.noteDate}|${cb.formType || 'evening'}${tzSuffix}`;
}
export function checkReplay(key, now = Date.now()) {
  const last = _submitted.get(key) || 0;
  const dup = last > 0 && (now - last) < REPLAY_WINDOW_MS;
  if (!dup) {
    _submitted.set(key, now);
    // 只保留最近 200 条（W3 原语义）
    if (_submitted.size > REPLAY_MAX) {
      const oldest = [..._submitted.keys()].slice(0, _submitted.size - REPLAY_MAX);
      for (const k of oldest) _submitted.delete(k);
    }
  }
  return dup;
}
export function __resetReplay() { _submitted.clear(); }

// ================= 后端抽象：本地 dry-run（DRY_RUN=1）/ GitHub Contents API =================
const isDryRun = () => process.env.DRY_RUN === '1';

function localRoot() {
  return process.env.DAILY_ROOT || path.resolve(import.meta.dirname, '..', '..');
}

const localBackend = {
  async getUsers() {
    return JSON.parse(readFileSync(path.join(localRoot(), 'users', 'users.json'), 'utf8'));
  },
  async getUserConfig(userId) {
    try {
      return { config: JSON.parse(readFileSync(path.join(localRoot(), 'users', userId, 'config.json'), 'utf8')), sha: null };
    } catch { return null; }
  },
  async getNote(userId, ymd) {
    try {
      return { content: readFileSync(path.join(localRoot(), notePath(userId, ymd)), 'utf8'), sha: null };
    } catch { return null; }
  },
  async putNote(userId, ymd, content, sha, message) {
    return { sha: null, dryRun: true }; // dry-run 不写盘（与 DRY_RUN=1 的既有约定一致），内容经响应回传供 diff 验证
  },
  async putConfig(userId, config, sha, message) {
    return { sha: null, dryRun: true };
  },
};

// GitHub Contents API 客户端（GET 当前文件 → 改 → PUT；GITHUB_TOKEN/GITHUB_REPO 环境变量）
const gh = (env) => {
  const repo = env.GITHUB_REPO || '';
  const token = env.GITHUB_TOKEN || '';
  if (!repo || !token) throw new Error('GITHUB_REPO/GITHUB_TOKEN 未设置（SCF 环境变量）');
  const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');
  const headers = { Authorization: `token ${token}`, 'User-Agent': 'daily-review-scf', 'X-GitHub-Api-Version': '2022-11-28' };
  const api = async (method, urlPath, body) => {
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/${encPath(urlPath)}`, {
      method, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      const err = new Error(`GitHub API ${method} ${urlPath} 失败: HTTP ${res.status}`);
      err.status = res.status;
      err.conflict = res.status === 409 || res.status === 422;
      throw err;
    }
    return res.json();
  };
  return {
    async getUsers() {
      const r = await api('GET', 'users/users.json');
      if (!r) throw new Error('users/users.json 不存在于仓库');
      return JSON.parse(Buffer.from(r.content, 'base64').toString('utf8'));
    },
    async getUserConfig(userId) {
      const r = await api('GET', `users/${userId}/config.json`);
      if (!r) return null;
      return { config: JSON.parse(Buffer.from(r.content, 'base64').toString('utf8')), sha: r.sha };
    },
    async getNote(userId, ymd) {
      const r = await api('GET', notePath(userId, ymd));
      if (!r) return null;
      return { content: Buffer.from(r.content, 'base64').toString('utf8'), sha: r.sha };
    },
    async putNote(userId, ymd, content, sha, message) {
      const r = await api('PUT', notePath(userId, ymd), {
        message: message || `[scf] 飞书回调写回 ${ymd}`,
        content: Buffer.from(content, 'utf8').toString('base64'),
        ...(sha ? { sha } : {}),
      });
      return { sha: r && r.content && r.content.sha, dryRun: false };
    },
    async putConfig(userId, config, sha, message) {
      const r = await api('PUT', `users/${userId}/config.json`, {
        message: message || '[scf] 时区切换',
        content: Buffer.from(JSON.stringify(config, null, 2) + '\n', 'utf8').toString('base64'),
        ...(sha ? { sha } : {}),
      });
      return { sha: r && r.content && r.content.sha, dryRun: false };
    },
  };
};

function pickBackend(env) {
  return isDryRun() ? localBackend : gh(env);
}

// ================= 读-改-写重试（写冲突重读重写，最多 3 次） =================
async function writeNoteWithRetry(backend, userId, ymd, mutate, message) {
  for (let attempt = 0; ; attempt++) {
    const cur = await backend.getNote(userId, ymd);
    if (!cur) throw Object.assign(new Error('日记不存在'), { code: 4 });
    const out = mutate(cur.content);
    try {
      const put = await backend.putNote(userId, ymd, out.content, cur.sha, message);
      return { ...out, sha: put.sha };
    } catch (e) {
      if (!e.conflict || attempt >= 2) throw e; // 冲突 → 重读重试（最多 3 次）
    }
  }
}
async function writeConfigWithRetry(backend, userId, mutate, message) {
  for (let attempt = 0; ; attempt++) {
    const cur = await backend.getUserConfig(userId);
    if (!cur) throw Object.assign(new Error('config.json 不存在'), { code: 6 });
    const next = mutate(cur.config);
    try {
      const put = await backend.putConfig(userId, next, cur.sha, message);
      return { config: next, sha: put.sha };
    } catch (e) {
      if (!e.conflict || attempt >= 2) throw e;
    }
  }
}

// ================= IANA 时区校验 =================
export function isValidIana(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

// ================= 回执文案（W3「组装确认」逐字 + tz 新增） =================
export function buildReceipt(kind, rb) {
  if (kind === 'morning') {
    const suffix = rb.unmatchedCount ? `，未匹配 ${rb.unmatchedCount} 项已追加到「📥 飞书回传」` : '';
    return `✅ 晨间打卡已写入 Obsidian《${rb.noteName}》（填写 ${rb.filled} 项${suffix}）。今天的骨架立好了 🌱`;
  }
  if (kind === 'ruankao') {
    const w = rb.wrong || [];
    const u = rb.unanswered || [];
    let extra = '';
    if (u.length) extra += `，${u.length} 题未作答`;
    return w.length
      ? `📚 交卷完成：${rb.score}/${rb.total}${extra}。错题：${w.map((x) => x.n).join('、')}，晚间复盘卡已备好错题归纳 ✍️`
      : `📚 交卷完成：${rb.score}/${rb.total} 🎉 全对！成绩已写入笔记`;
  }
  if (kind === 'tz') return `🌏 时区已切换到 ${rb.tz}，后续晨间/晚间窗口按该时区判断生效`;
  const suffix = rb.unmatchedCount ? `，未匹配 ${rb.unmatchedCount} 项已追加到「📥 飞书回传」` : '';
  let wt = '';
  if (rb.wordScore !== null && rb.wordScore !== undefined) {
    wt = rb.wordWrong && rb.wordWrong.length
      ? `｜单词自测 ${rb.wordScore}/10（错：${rb.wordWrong.join('、')}）`
      : `｜单词自测 ${rb.wordScore}/10 🎉 全对`;
  }
  return `✅ 复盘已写入 Obsidian《${rb.noteName}》（填写 ${rb.filled} 项${suffix}）。${wt ? wt + '。' : ''}数据沉淀 +1 📈`;
}

// ================= 时区切换卡（按钮卡：schema 2.0 action） =================
export function buildTzCard() {
  const TZS = ['Asia/Shanghai', 'Asia/Hong_Kong', 'Pacific/Tarawa', 'Pacific/Fiji'];
  return {
    schema: '2.0',
    config: { update_multi: true },
    header: {
      template: 'blue',
      title: { tag: 'plain_text', content: '🌏 时区切换' },
      subtitle: { tag: 'plain_text', content: '选择生效时区（影响晨间/晚间窗口判断）' },
    },
    body: { elements: [
      { tag: 'markdown', content: '窗口判断基于 **users/<id>/config.json 的 tz**，点击按钮即时切换：' },
      { tag: 'action', actions: TZS.map((tz) => ({
        tag: 'button', type: 'default',
        text: { tag: 'plain_text', content: tz },
        value: { form_type: 'tz', tz },
      })) },
    ] },
  };
}

// ================= handler =================

// API 网关事件 → { body }（body 可能为 JSON 字符串或已解析对象；SCF 测试入口可直接传 body 对象）
function parseEvent(event) {
  if (typeof event === 'string') {
    try { return { body: JSON.parse(event) }; } catch { return { body: null }; }
  }
  const ev = (event && typeof event === 'object') ? event : {};
  let body = ev.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  return { body };
}

// 飞书 verification token 在 body.header.token（url_verification 在 body.token），不在 HTTP 头（M2 修复）
function bodyToken(body) {
  if (!body || typeof body !== 'object') return '';
  const h = body.header;
  if (h && typeof h === 'object' && typeof h.token === 'string') return h.token;
  if (typeof body.token === 'string') return body.token;
  return '';
}

async function handleTz(cb, userId, backend, chatId) {
  const tz = String(cb.formValue.tz || '').trim();
  if (!isValidIana(tz)) return ok({ code: 5, msg: `tz 非法：${tz}` });
  const { config, sha } = await writeConfigWithRetry(backend, userId, (cur) => ({ ...cur, tz }), `[scf] 时区切换 → ${tz}`);
  const receipt = buildReceipt('tz', { tz });
  if (!isDryRun() && chatId) {
    try { await sendAlert(chatId, receipt); } catch (e) { console.error('发送回执失败', e.message); }
  }
  return ok({ receipt, ...(isDryRun() ? { config, sha } : { sha }) });
}

async function handleForm(cb, userId, backend, chatId, env) {
  const ymd = cb.noteDate.replaceAll('-', '');
  const noteName = `晨间日记+复盘 - ${ymd}.md`;
  const datetime = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(new Date()); // W3「防重放」默认时区（重建节点会用笔记 timezone 重新计算）

  const rebuild = cb.formType === 'ruankao' ? rebuildRuankao : cb.formType === 'morning' ? rebuildMorning : rebuildEvening;
  const result = await writeNoteWithRetry(
    backend, userId, ymd,
    (content) => rebuild(content, cb.formValue, { datetime }),
    `[scf] 飞书回调写回 ${ymd}（${cb.formType}）`,
  );
  const receipt = buildReceipt(cb.formType, { ...result, noteName });
  if (!isDryRun() && chatId) {
    try { await sendAlert(chatId, receipt); } catch (e) { console.error('发送回执失败', e.message); }
  }
  return ok({
    receipt,
    ...(isDryRun() ? { content: result.content, noteName } : { sha: result.sha }),
  });
}

/** 腾讯云 SCF 入口（API 网关触发器路径 /feishu-card-cb；开启「集成响应」） */
export async function main_handler(event, context) {
  const env = { GITHUB_TOKEN: process.env.GITHUB_TOKEN, GITHUB_REPO: process.env.GITHUB_REPO };
  const parsed = parseEvent(event);

  // 必填飞书回调 token 校验（I1 修复：env 未设置 → 拒绝所有回调、不写数据；
  //   设置后强制比对 body.header.token，url_verification 比对 body.token，M2 修复）
  const want = process.env.FEISHU_VERIFICATION_TOKEN;
  if (!want) return json({ code: 2, msg: 'FEISHU_VERIFICATION_TOKEN 未设置，拒绝处理所有回调（部署必填）' });
  if (bodyToken(parsed.body) !== want) return json({ code: 2, msg: 'token mismatch' });

  const cb = parseCallback(parsed.body);

  // URL 验证（W3「回challenge」）
  if (cb.kind === 'verify') return json({ challenge: cb.challenge });

  if (cb.kind !== 'form') return ok({ msg: `ignored: ${cb.reason || 'no form'}` });

  try {
    const backend = pickBackend(env);

    // userId 白名单（Task 1 审查裁决：未注册/未激活一律拒绝处理）
    const users = await backend.getUsers();
    const userId = resolveUser(users, cb.openId);
    if (!userId) {
      // 把收到的 open_id 同时打进日志和**回执**。
      //
      // 为什么放进回执：users.json 里 open_id 还是占位符时，这是唯一能拿到
      // 真实值的途径 —— 点一下按钮，飞书卡片上直接显示出来，不用翻腾讯云日志，
      // 也不用为了调试重新部署函数。
      //
      // open_id 是应用内标识，不是凭证；能点到这张卡片的人本来就在这个群里。
      const who = cb.openId || '(回调里没带 open_id)';
      console.warn(`[未注册] 收到 open_id=${who}，不在白名单内`);
      return ok({
        code: 3,
        msg: `open_id 未注册，请把这串值填入 users/users.json：${who}`,
      });
    }

    // 防重放（飞书 3s 超时重试拦截；10 分钟后允许重新提交修正）
    if (checkReplay(replayKey(cb))) return ok({ msg: 'duplicate ignored (replay window)' });

    // 回执目标：event.open_chat_id → 缺省 users/<id>/config.json chat_id
    let chatId = cb.chatId;
    if (!chatId) {
      const cfg = await backend.getUserConfig(userId);
      chatId = (cfg && cfg.chat_id) || '';
    }

    if (cb.formType === 'tz') return await handleTz(cb, userId, backend, chatId);
    return await handleForm(cb, userId, backend, chatId, env);
  } catch (e) {
    console.error('[feishu-callback] 处理失败', e.code || '', e.message);
    // 非 2xx 会触发飞书重试，统一 200 + 错误码（W3「回OK」语义）
    return ok({ code: e.code || 1, msg: e.message || 'internal error' });
  }
}

/** 别名：SCF 控制台「执行方法」填 index.handler 或 index.main_handler 均可 */
export const handler = main_handler;

// ================= 提前响应（飞书 3 秒超时兜底） =================

/**
 * 让 work 与"提前返回"赛跑。
 *
 * 飞书要求卡片回调 3 秒内响应，但完整处理要打 5 次以上跨洋 GitHub API，
 * 实测 ~2.6 秒 —— 卡在临界点，抖一下就报 200341。
 * 所以超时后先返回一个 toast，让 work 继续在后台跑完。
 *
 * @param work      Promise，已完成时返回 handler 的 {statusCode, headers, body}
 * @param earlyMs   超过这个毫秒数就先响应
 * @returns { early: true } 或 { early: false, result }
 */
export async function raceEarly(work, earlyMs) {
  let timer;
  const early = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ early: true }), earlyMs);
  });

  const settled = work.then(
    (result) => ({ early: false, result }),
    // 失败也要如实返回，由调用方决定怎么响应；吞掉会变成 unhandledRejection
    (error) => ({ early: false, error }),
  );

  const winner = await Promise.race([settled, early]);
  if (!winner.early) clearTimeout(timer);
  return winner;
}
