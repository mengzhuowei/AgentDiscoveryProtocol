#!/usr/bin/env node

import * as http from 'http';
import { WebSocket } from 'ws';
import { Gateway, loadOrCreateIdentity, signEnvelope, canonicalize, generateMessageId } from '../../src/index';

const WEBHOOK_SERVER_PORT = 8080;
const AGENT_PORT = 9900;

interface WebhookPayload {
  event: string;
  task_id: string;
  agent_id: string;
  timestamp: string;
  signature: string;
  data: unknown;
}

let webhookServerReceived: WebhookPayload[] = [];

function startWebhookServer(): Promise<void> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/webhook') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
          try {
            const payload = JSON.parse(body) as WebhookPayload;
            webhookServerReceived.push(payload);
            console.log(`📬 Webhook 服务器收到 ${payload.event} 事件！`);
            console.log(`   Task ID: ${payload.task_id}`);
            console.log(`   Agent ID: ${payload.agent_id}`);
            if (payload.data) {
              console.log(`   Data: ${JSON.stringify(payload.data).slice(0, 100)}...`);
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok' }));
          } catch (e) {
            res.writeHead(400);
            res.end('Invalid JSON');
          }
        });
      } else if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    server.listen(WEBHOOK_SERVER_PORT, () => {
      console.log(`✅ Webhook 服务器启动成功: http://localhost:${WEBHOOK_SERVER_PORT}/webhook\n`);
      resolve();
    });
  });
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║         ADP Webhook 通信方式测试                          ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  webhookServerReceived = [];

  await startWebhookServer();

  const result = loadOrCreateIdentity('test', 'webhook-agent', 'WebhookAgent');
  const identity = result.identity;
  console.log(`🔑 Agent ID: ${identity.agentId}\n`);

  const gateway = new Gateway({
    port: AGENT_PORT,
    host: '0.0.0.0',
    secretKey: identity.secretKey,
    agentId: identity.agentId,
    displayName: 'Webhook Test Agent',
    capabilities: [
      'adp:ping',
      'adp:capability.query',
      {
        capability: 'custom:video.generate',
        description: '模拟视频生成（异步任务）',
        async: true,
        preferredMode: 'webhook',
      },
      {
        capability: 'custom:quick.echo',
        description: '快速响应（同步任务）',
        async: false,
        preferredMode: 'websocket',
      },
    ],
    communication: {
      mode: 'hybrid',
      webhook: {
        enabled: true,
        url: `http://localhost:${WEBHOOK_SERVER_PORT}/webhook`,
        secret: 'test_webhook_secret',
        timeout: 30000,
        retry: { maxAttempts: 3, backoffMs: 500 }
      }
    },
    customHandlers: {
      'custom:video.generate': async (ws, envelope) => {
        console.log('\n📹 收到视频生成请求 (async + webhook):');
        console.log(`   From: ${envelope.from}`);
        console.log(`   Params: ${JSON.stringify(envelope.params)}`);
        
        const params = envelope.params as Record<string, unknown> || {};
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const reply = await signEnvelope({
          to: envelope.from,
          action: 'custom:video.generate',
          params: {
            task_id: (params.task_id as string) || 'unknown',
            status: 'COMPLETED',
            result: {
              video_url: 'https://example.com/video.mp4',
              thumbnail_url: 'https://example.com/thumb.jpg',
              duration: 5
            }
          },
          reply_to: envelope.id,
        }, identity.secretKey, canonicalize);
        
        ws.send(JSON.stringify(reply));
        console.log('✅ 视频生成完成，结果已发送');
      },
      'custom:quick.echo': async (ws, envelope) => {
        console.log('\n🔄 收到快速响应请求 (sync + websocket):');
        console.log(`   From: ${envelope.from}`);
        console.log(`   Params: ${JSON.stringify(envelope.params)}`);
        
        const reply = await signEnvelope({
          to: envelope.from,
          action: 'custom:quick.echo',
          params: {
            echo: envelope.params,
            processed_at: new Date().toISOString()
          },
          reply_to: envelope.id,
        }, identity.secretKey, canonicalize);
        
        ws.send(JSON.stringify(reply));
        console.log('✅ 快速响应完成');
      },
    },
    skipVerification: true,
  });

  console.log(`✅ Gateway 启动成功: ws://localhost:${AGENT_PORT}/adp\n`);
  console.log('等待连接...\n');

  await new Promise(resolve => setTimeout(resolve, 2000));

  const ws = new WebSocket(`ws://localhost:${AGENT_PORT}/adp?agent_id=test-client`);
  
  ws.on('open', () => {
    console.log('🔌 已连接到 Gateway\n');
    
    console.log('═══════════════════════════════════════════════════════════');
    console.log('测试 1: 同步任务 (WebSocket)');
    console.log('═══════════════════════════════════════════════════════════\n');
    
    const echoEnvelope = signEnvelope({
      id: generateMessageId(),
      from: 'test-client',
      to: identity.agentId,
      action: 'custom:quick.echo',
      params: { message: 'Hello WebSocket!' },
      timestamp: new Date().toISOString(),
    }, identity.secretKey, canonicalize);
    
    ws.send(JSON.stringify(echoEnvelope));
  });

  ws.on('message', (data) => {
    const response = JSON.parse(data.toString());
    console.log('\n📨 收到响应:');
    console.log(`   Action: ${response.action}`);
    console.log(`   Params: ${JSON.stringify(response.params)}`);
    
    if (response.action === 'custom:quick.echo') {
      console.log('\n═══════════════════════════════════════════════════════════');
      console.log('测试 2: 异步任务 (Webhook)');
      console.log('═══════════════════════════════════════════════════════════\n');
      
      const videoEnvelope = signEnvelope({
        id: generateMessageId(),
        from: 'test-client',
        to: identity.agentId,
        action: 'custom:video.generate',
        params: { 
          prompt: 'A beautiful sunset over mountains',
          duration: 10
        },
        timestamp: new Date().toISOString(),
      }, identity.secretKey, canonicalize);
      
      ws.send(JSON.stringify(videoEnvelope));
    } else if (response.action === 'custom:video.generate') {
      console.log('\n⏳ 等待 Webhook 回调...\n');
      
      setTimeout(() => {
        console.log('\n═══════════════════════════════════════════════════════════');
        console.log('测试结果');
        console.log('═══════════════════════════════════════════════════════════\n');
        
        console.log('📊 Webhook 回调统计:');
        console.log(`   收到 ${webhookServerReceived.length} 个 Webhook 请求\n`);
        
        if (webhookServerReceived.length > 0) {
          webhookServerReceived.forEach((payload, index) => {
            console.log(`   [${index + 1}] Event: ${payload.event}`);
            console.log(`       Task ID: ${payload.task_id}`);
            console.log(`       Timestamp: ${payload.timestamp}`);
            console.log('');
          });
          console.log('✅ Webhook 通信测试成功！');
        } else {
          console.log('⚠️  未收到 Webhook 回调（可能是超时或配置问题）');
        }
        
        console.log('\n🧹 清理资源...\n');
        ws.close();
        gateway.close();
        process.exit(0);
      }, 3000);
    }
  });

  ws.on('error', (error) => {
    console.error('❌ WebSocket 错误:', error);
    process.exit(1);
  });
}

main().catch(console.error);
