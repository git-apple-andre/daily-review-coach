// scf/feishu-callback/server.mjs — Web 函数 HTTP 适配层：HTTP 请求 → main_handler(event) → HTTP 响应
// 腾讯云 Web 函数要求 scf_bootstrap 启动一个监听 9000 端口的服务
import http from 'node:http';
import { main_handler } from './index.mjs';

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    try {
      const event = {
        body,
        headers: req.headers,
        httpMethod: req.method,
        path: req.url,
      };
      const result = await main_handler(event, {});
      res.statusCode = result.statusCode || 200;
      if (result.headers) {
        for (const [k, v] of Object.entries(result.headers)) res.setHeader(k, v);
      }
      res.end(result.body || '');
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ code: 5, msg: 'internal: ' + e.message }));
    }
  });
});

const port = Number(process.env.SCF_RUNTIME_PORT || 9000);
server.listen(port, () => console.log(`feishu-callback listening on ${port}`));
