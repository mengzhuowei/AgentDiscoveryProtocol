import { Gateway, loadOrCreateIdentity, Capability, Route, Envelope, signEnvelope, generateMessageId } from '../src';
import { WebSocket } from 'ws';
import { canonicalize } from '../src/canonical';
import express, { Request, Response } from 'express';
import { createServer } from 'http';

const CAPABILITY_VIDEO_GENERATE = 'custom:video.generate';

interface PendingTask {
  ws: WebSocket;
  envelope: Envelope;
  startedAt: number;
}

async function main() {
  const { identity } = loadOrCreateIdentity('local', 'async-video', 'AsyncVideoAgent');

  const pendingTasks = new Map<string, PendingTask>();

  const capabilities: (string | Capability)[] = [
    'adp:ping',
    'adp:capability.query',
    {
      capability: CAPABILITY_VIDEO_GENERATE,
      description: '异步视频生成（通过 Webhook 回调）',
      async: true,
      preferredMode: 'webhook',
      input_schema: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: '视频描述/提示词',
          },
          duration: {
            type: 'integer',
            description: '视频时长(秒)',
            default: 5,
          },
        },
        required: ['prompt'],
      },
    },
  ];

  const routes: Route[] = [{ type: 'direct', address: 'localhost:9901' }];

  const gateway = new Gateway({
    port: 9901,
    host: '0.0.0.0',
    secretKey: identity.secretKey,
    agentId: identity.agentId,
    displayName: 'Async Video Agent',
    capabilities,
    routes,
    communication: {
      mode: 'webhook',
      webhook: {
        enabled: true,
        url: 'http://localhost:9902/jsonrpc',
        secret: 'webhook-secret-key',
        retry: { maxAttempts: 3, delayMs: 1000 },
      },
    },
    customHandlers: {
      [CAPABILITY_VIDEO_GENERATE]: async (ws: WebSocket, envelope: Envelope) => {
        const params = envelope.params as {
          prompt?: string;
          duration?: number;
        };

        const taskId = `task_${Date.now().toString(36)}`;

        console.log(`\n🎬 收到异步视频生成请求 from ${envelope.from}`);
        console.log(`   提示词: ${params.prompt}`);
        console.log(`   时长: ${params.duration || 5}s`);
        console.log(`   Task ID: ${taskId}\n`);

        pendingTasks.set(taskId, { ws, envelope, startedAt: Date.now() });

        const pendingReply = signEnvelope({
          protocol: 'adp/0.2',
          id: generateMessageId(),
          from: identity.agentId,
          to: envelope.from,
          action: CAPABILITY_VIDEO_GENERATE,
          params: {
            task_id: taskId,
            status: 'PENDING',
            message: '任务已接收，正在处理...',
          },
          reply_to: envelope.id,
          timestamp: new Date().toISOString(),
        }, identity.secretKey, canonicalize);
        ws.send(JSON.stringify(pendingReply));

        setTimeout(async () => {
          const task = pendingTasks.get(taskId);
          if (!task) {
            console.log(`❌ 任务 ${taskId} 已超时`);
            return;
          }

          const result = {
            task_id: taskId,
            status: 'COMPLETED',
            result: {
              video_url: `https://cdn.example.com/videos/${taskId}.mp4`,
              thumbnail_url: `https://cdn.example.com/thumbs/${taskId}.jpg`,
              duration: params.duration || 5,
              format: 'mp4',
              generated_at: new Date().toISOString(),
            },
          };

          const completedReply = signEnvelope({
            protocol: 'adp/0.2',
            id: generateMessageId(),
            from: identity.agentId,
            to: envelope.from,
            action: CAPABILITY_VIDEO_GENERATE,
            params: result,
            reply_to: envelope.id,
            timestamp: new Date().toISOString(),
          }, identity.secretKey, canonicalize);
          task.ws.send(JSON.stringify(completedReply));

          console.log(`✅ 任务 ${taskId} 完成! URL: ${result.result.video_url}`);
          pendingTasks.delete(taskId);
        }, 5000);
      },
    },
  });

  const app = express();
  app.use(express.json());

  app.post('/jsonrpc', (req: Request, res: Response) => {
    const { method, params, id } = req.body;
    console.log(`\n📡 收到 JSON-RPC 请求: ${method}`);

    if (method === 'task.completed') {
      const { task_id, result } = params;
      console.log(`   任务完成: ${task_id}`);
      console.log(`   结果:`, JSON.stringify(result, null, 2));
    }

    res.json({ jsonrpc: '2.0', result: { received: true }, id });
  });

  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      agent_id: identity.agentId,
      pending_tasks: pendingTasks.size,
    });
  });

  const httpServer = createServer(app);
  httpServer.listen(9902, () => {
    console.log(`\n📡 JSON-RPC 服务器运行在 http://localhost:9902`);
  });

  console.log(`
╔══════════════════════════════════════════════════════╗
║        🎬 Async Video Agent (Webhook Mode)           ║
╠══════════════════════════════════════════════════════╣
║  Agent ID: ${identity.agentId.slice(0, 40)}
║  WebSocket: ws://localhost:9901/adp
║  JSON-RPC:  http://localhost:9902/jsonrpc
║  Webhook:   启用
║  待处理任务: ${pendingTasks.size}
╚══════════════════════════════════════════════════════╝
`);

  process.on('SIGINT', () => {
    console.log('\n👋 Shutting down...');
    gateway.close();
    httpServer.close();
    process.exit(0);
  });
}

main().catch(console.error);