// scf/feishu-callback/server.mjs — Web 函数 HTTP 适配层：HTTP 请求 → main_handler(event) → HTTP 响应
// 腾讯云 Web 函数要求 scf_bootstrap 启动一个监听 9000 端口的服务
import http from 'node:http';
import { main_handler, raceEarly } from './index.mjs';

/**
 * 提前响应的时限（毫秒）。
 *
 * 飞书要求卡片回调 **3 秒内**返回，否则客户端报 200341。
 * 而完整处理（读 users.json → 读 config → 读日记 → 判分 → 写回 → 发回执）
 * 要打 5 次以上跨洋 GitHub API，实测 ~2.6 秒，卡在临界点上抖一下就超时。
 *
 * 取 1800ms 留足余量：本地到飞书还有网络往返，
 * 而且函数冷启动（实测 12–87ms）也要算进去。
 */
const EARLY_MS = Number(process.env.EARLY_RESPONSE_MS || 1800);

/** 提前响应的内容 —— 让用户点下去立刻看到反馈，而不是等 3 秒后报错 */
const EARLY_BODY = JSON.stringify({
  toast: { type: 'info', content: '已收到，正在处理…' },
});

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    const event = {
      body,
      headers: req.headers,
      httpMethod: req.method,
      path: req.url,
    };

    let responded = false;
    const respond = (statusCode, headers, payload) => {
      if (responded) return;      // 只响应一次；后到的结果直接丢弃
      responded = true;
      try {
        res.statusCode = statusCode;
        if (headers) for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
        res.end(payload || '');
      } catch { /* 连接已被客户端关闭，忽略 */ }
    };

    const work = main_handler(event, {});

    try {
      const winner = await raceEarly(work, EARLY_MS);

      if (winner.early) {
        // 先给飞书一个即时反馈，避免 3 秒超时
        respond(200, { 'Content-Type': 'application/json' }, EARLY_BODY);

        // 后台继续跑完判分与写回。腾讯云 Web 函数是常驻 HTTP 服务，
        // 响应结束后进程不会立刻回收，所以这些工作能正常完成，
        // 用户随后会在群里收到回执消息。
        work
          .then((r) => console.log('[后台完成]', r && r.body ? r.body.slice(0, 200) : ''))
          .catch((e) => console.error('[后台失败]', e && e.message));
      } else if (winner.error) {
        throw winner.error;
      } else {
        const r = winner.result || {};
        respond(r.statusCode || 200, r.headers, r.body);
      }
    } catch (e) {
      respond(500, { 'Content-Type': 'application/json' },
        JSON.stringify({ code: 5, msg: 'internal: ' + e.message }));
    }
  });
});

const port = Number(process.env.SCF_RUNTIME_PORT || 9000);
server.listen(port, () => console.log(`feishu-callback listening on ${port}`));
