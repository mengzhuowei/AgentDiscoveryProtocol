#!/usr/bin/env node

import * as http from 'http';
import { WebSocket } from 'ws';
import { Gateway, loadOrCreateIdentity, signEnvelope, canonicalize, generateMessageId } from '../../src/index';

const AGENT_B_WS_PORT = 9901;
const AGENT_B_HTTP_PORT = 9902;
const OPENCLAW_PORT = 9903;
const AGENT_A_PORT = 9904;

interface TaskState {
  ws: WebSocket;
  envelope: unknown;
  result?: unknown;
  completed: boolean;
}

const pendingTasks = new Map<string, TaskState>();

console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║          ADP Agent B (Webhook -> OpenClaw -> JSON-RPC)         ║');
console.log('╚══════════════════════════════════════════════════════════════════╝\n');

async function main() {
  const identity = loadOrCreateIdentity('test', 'agent-b', 'AgentB');
  const { identity: id } = identity;
  console.log(`🔑 Agent B ID: ${id.agentId}\n`);

  const gateway = new Gateway({
    port: AGENT_B_WS_PORT,
    host: '0.0.0.0',
    secretKey: id.secretKey,
    agentId: id.agentId,
    displayName: 'Agent B (Video Generator Proxy)',
    capabilities: [
      'adp:ping',
      'adp:capability.query',
      {
        capability: 'custom:video.generate',
        description: '视频生成任务（通过 OpenClaw）',
        async: true,
        preferredMode: 'webhook',
      },
    ],
    customHandlers: {
      'custom:video.generate': async (ws, envelope) => {
        const env = envelope as any;
        const taskId = `task_${Date.now().toString(36)}`;
        const params = env.params as any || {};

        console.log('\n📥 Agent B 收到视频生成请求:');
        console.log(`   From: ${env.from}`);
        console.log(`   Task ID: ${taskId}`);
        console.log(`   Params: ${JSON.stringify(params)}\n`);

        pendingTasks.set(taskId, {
          ws,
          envelope: env,
          completed: false,
        });

        console.log(`📤 Agent B 通过 Webhook 回调 OpenClaw: ${OPENCLAW_PORT}\n`);

        const webhookPayload = {
          event: 'task.start',
          task_id: taskId,
          agent_id: id.agentId,
          callback_url: `http://localhost:${AGENT_B_HTTP_PORT}/jsonrpc`,
          params: params,
        };

        try {
          const response = await fetch(`http://localhost:${OPENCLAW_PORT}/webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(webhookPayload),
          });

          if (!response.ok) {
            throw new Error(`OpenClaw webhook failed: ${response.status}`);
          }

          console.log('✅ OpenClaw 已接收任务\n');
        } catch (error) {
          console.error('❌ Webhook 调用失败:', error);
          pendingTasks.delete(taskId);

          const errorReply = await signEnvelope({
            to: env.from,
            action: 'custom:video.generate',
            params: { task_id: taskId, status: 'FAILED', error: (error as Error).message },
            reply_to: env.id,
          }, id.secretKey, canonicalize);
          ws.send(JSON.stringify(errorReply));
        }
      },
    },
    skipVerification: true,
  });

  console.log(`✅ Agent B WebSocket Gateway 启动: ws://localhost:${AGENT_B_WS_PORT}/adp\n`);

  const httpServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/jsonrpc') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', async () => {
        try {
          const rpcRequest = JSON.parse(body);
          console.log('\n🔔 Agent B 收到 OpenClaw 的 JSON-RPC 通知:');
          console.log(`   Method: ${rpcRequest.method}`);
          console.log(`   Params: ${JSON.stringify(rpcRequest.params)}\n`);

          const { task_id, result, error } = rpcRequest.params || {};
          const taskState = pendingTasks.get(task_id);

          if (!taskState) {
            console.error(`❌ 未找到任务: ${task_id}\n`);
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Task not found' }));
            return;
          }

          if (error) {
            console.log(`❌ 任务失败: ${error}\n`);
            const reply = await signEnvelope({
              to: (taskState.envelope as any).from,
              action: 'custom:video.generate',
              params: { task_id, status: 'FAILED', error },
              reply_to: (taskState.envelope as any).id,
            }, id.secretKey, canonicalize);
            taskState.ws.send(JSON.stringify(reply));
          } else {
            console.log(`✅ 任务完成: ${JSON.stringify(result)}\n`);
            const reply = await signEnvelope({
              to: (taskState.envelope as any).from,
              action: 'custom:video.generate',
              params: { task_id, status: 'COMPLETED', result },
              reply_to: (taskState.envelope as any).id,
            }, id.secretKey, canonicalize);
            taskState.ws.send(JSON.stringify(reply));
          }

          pendingTasks.delete(task_id);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (e) {
          console.error('❌ JSON-RPC 解析失败:', e);
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
    } else if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', agent_id: id.agentId }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  httpServer.listen(AGENT_B_HTTP_PORT, () => {
    console.log(`✅ Agent B HTTP 服务器启动: http://localhost:${AGENT_B_HTTP_PORT}`);
    console.log(`   - JSON-RPC 端点: POST /jsonrpc`);
    console.log(`   - 健康检查: GET /health\n`);
    console.log('等待 Agent A 的请求...\n');
  });

  return { gateway, httpServer, identity };
}

if (require.main === module) {
  main().catch(console.error);
}

export { main, pendingTasks };
