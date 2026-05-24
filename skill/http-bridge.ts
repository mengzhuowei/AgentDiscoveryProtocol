/**
 * ADP HTTP Bridge —— HTTP REST API 代理
 * ======================================
 *
 * 把 ADP 网络暴露为 HTTP REST API，让任何能发 HTTP 请求的系统都能使用：
 * - Python / Go / Rust / Java 等后端服务
 * - 浏览器前端（配合 CORS）
 * - curl / Postman 调试
 * - Serverless 函数（Lambda / Cloud Function）
 * - 低代码/无代码平台（通过 Webhook 调用）
 *
 * 启动方式：
 *   npx ts-node skill/http-bridge.ts
 *   ADP_NAME=my-bridge npx ts-node skill/http-bridge.ts
 *
 * 默认监听 http://localhost:8080
 */

import * as http from 'http';
import { AdpBridge } from './adp-bridge';

const PORT = parseInt(process.env.HTTP_PORT || '8080', 10);

interface JsonResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

function jsonRes(res: http.ServerResponse, status: number, payload: JsonResponse) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(payload));
}

async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

async function main() {
  const bridge = new AdpBridge({
    name: process.env.ADP_NAME || 'http-bridge',
    displayName: process.env.ADP_DISPLAY || 'ADP HTTP Bridge',
    namespace: process.env.ADP_NAMESPACE || 'local',
    capabilities: ['adp:ping', 'adp:capability.query'],
    registryUrl: process.env.ADP_REGISTRY || undefined,
    relayUrl: process.env.ADP_RELAY || undefined,
    enableMdns: !process.env.ADP_NO_MDNS,
  });

  await bridge.start();

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      jsonRes(res, 204, { success: true });
      return;
    }

    const url = new URL(req.url || '/', `http://localhost:${PORT}`);

    // GET /health — 健康检查
    if (req.method === 'GET' && url.pathname === '/health') {
      jsonRes(res, 200, {
        success: true,
        data: {
          agentId: bridge.agentId,
          peerCount: bridge.peerList.length,
          address: bridge.listenAddress,
        },
      });
      return;
    }

    // GET /peers — 列出已发现的 peers
    if (req.method === 'GET' && url.pathname === '/peers') {
      const peers = bridge.peerList;
      jsonRes(res, 200, { success: true, data: { peers, count: peers.length } });
      return;
    }

    // POST /discover — 主动发现 peers
    if (req.method === 'POST' && url.pathname === '/discover') {
      const body = await readBody(req);
      const timeoutMs = (body.timeoutMs as number) || 5000;
      const peers = await bridge.discover(timeoutMs);
      jsonRes(res, 200, { success: true, data: { peers, count: peers.length } });
      return;
    }

    // POST /call — 调用指定 Agent 的能力
    if (req.method === 'POST' && url.pathname === '/call') {
      const body = await readBody(req);
      const targetAgentId = body.agentId as string;
      const action = body.action as string;
      const params = (body.params as Record<string, unknown>) || {};
      const timeoutMs = (body.timeoutMs as number) || 10000;

      if (!targetAgentId || !action) {
        jsonRes(res, 400, { success: false, error: 'agentId and action are required' });
        return;
      }

      const result = await bridge.call(targetAgentId, action, params, timeoutMs);
      jsonRes(res, result.success ? 200 : 502, result);
      return;
    }

    // POST /ping — Ping 指定 Agent
    if (req.method === 'POST' && url.pathname === '/ping') {
      const body = await readBody(req);
      const targetAgentId = body.agentId as string;
      const timeoutMs = (body.timeoutMs as number) || 5000;

      if (!targetAgentId) {
        jsonRes(res, 400, { success: false, error: 'agentId is required' });
        return;
      }

      const result = await bridge.ping(targetAgentId, timeoutMs);
      jsonRes(res, result.success ? 200 : 502, result);
      return;
    }

    // POST /query — 查询指定 Agent 的能力
    if (req.method === 'POST' && url.pathname === '/query') {
      const body = await readBody(req);
      const targetAgentId = body.agentId as string;
      const timeoutMs = (body.timeoutMs as number) || 5000;

      if (!targetAgentId) {
        jsonRes(res, 400, { success: false, error: 'agentId is required' });
        return;
      }

      const result = await bridge.queryCapabilities(targetAgentId, timeoutMs);
      jsonRes(res, result.success ? 200 : 502, result);
      return;
    }

    jsonRes(res, 404, { success: false, error: 'Not found' });
  });

  server.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`ADP HTTP Bridge listening on port ${PORT}`);
    console.log(`Agent ID: ${bridge.agentId}`);
    console.log(`\nAPI Endpoints:`);
    console.log(`  GET  /health      - 健康检查`);
    console.log(`  GET  /peers       - 已发现的 peers`);
    console.log(`  POST /discover    - 主动发现 peers`);
    console.log(`  POST /call        - 调用 Agent 能力`);
    console.log(`  POST /ping        - Ping Agent`);
    console.log(`  POST /query       - 查询 Agent 能力`);
    console.log(`========================================\n`);
  });

  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    server.close();
    await bridge.stop();
    process.exit(0);
  });
}

main().catch(console.error);
