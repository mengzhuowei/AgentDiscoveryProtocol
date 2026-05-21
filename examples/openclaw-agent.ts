import { Gateway, loadOrCreateIdentity, ActionHandler, Capability, Route } from '../src';
import { WebSocket } from 'ws';
import { Envelope, signEnvelope, generateMessageId } from '../src';
import { canonicalize } from '../src/canonical';

const CAPABILITY_VIDEO_GENERATE = 'custom:video.generate';

function createVideoHandler(agentId: string, secretKey: Uint8Array): ActionHandler {
  return async (ws: WebSocket, envelope: Envelope) => {
    const params = envelope.params as {
      prompt?: string;
      duration?: number;
      style?: string;
    };

    console.log(`\n🎬 收到视频生成请求 from ${envelope.from}`);
    console.log(`   提示词: ${params.prompt}`);
    console.log(`   时长: ${params.duration || 5}s`);
    console.log(`   风格: ${params.style || 'auto'}\n`);

    const taskId = `task_${Date.now().toString(36)}`;
    console.log(`⏳ 开始生成视频... (task_id: ${taskId})`);

    setTimeout(() => {
      const reply = signEnvelope({
        protocol: 'adp/0.2',
        id: generateMessageId(),
        from: agentId,
        to: envelope.from,
        action: CAPABILITY_VIDEO_GENERATE,
        params: {
          task_id: taskId,
          status: 'COMPLETED',
          result: {
            video_url: `https://cdn.example.com/videos/${taskId}.mp4`,
            thumbnail_url: `https://cdn.example.com/thumbs/${taskId}.jpg`,
            duration: params.duration || 5,
            format: 'mp4',
          },
        },
        reply_to: envelope.id,
        timestamp: new Date().toISOString(),
      }, secretKey, canonicalize);

      ws.send(JSON.stringify(reply));
      console.log(`✅ 视频生成完成! URL: https://cdn.example.com/videos/${taskId}.mp4`);
    }, 3000);
  };
}

async function main() {
  const { identity } = loadOrCreateIdentity('local', 'openclaw', 'OpenClaw');

  const capabilities: (string | Capability)[] = [
    'adp:ping',
    'adp:capability.query',
    'adp:info',
    {
      capability: CAPABILITY_VIDEO_GENERATE,
      description: '根据提示词生成短视频',
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
          style: {
            type: 'string',
            description: '视频风格',
            enum: ['realistic', 'cartoon', 'anime', '3d'],
            default: 'realistic',
          },
        },
        required: ['prompt'],
      },
      output_schema: {
        type: 'object',
        properties: {
          task_id: { type: 'string' },
          status: {
            type: 'string',
            enum: ['PENDING', 'WORKING', 'COMPLETED', 'FAILED'],
          },
          result: {
            type: 'object',
            properties: {
              video_url: { type: 'string' },
              thumbnail_url: { type: 'string' },
              duration: { type: 'integer' },
              format: { type: 'string' },
            },
          },
        },
      },
    },
  ];

  const routes: Route[] = [{ type: 'direct', address: 'localhost:9900' }];

  const gateway = new Gateway({
    port: 9900,
    host: '0.0.0.0',
    secretKey: identity.secretKey,
    agentId: identity.agentId,
    displayName: 'OpenClaw AI',
    capabilities,
    routes,
    customHandlers: {
      [CAPABILITY_VIDEO_GENERATE]: createVideoHandler(identity.agentId, identity.secretKey),
    },
  });

  console.log(`
╔══════════════════════════════════════════════════════╗
║            🎬 OpenClaw Video Agent                  ║
╠══════════════════════════════════════════════════════╣
║  Agent ID: ${identity.agentId.slice(0, 40)}
║  能力: ${CAPABILITY_VIDEO_GENERATE}
║  端口: ws://localhost:9900/adp
╚══════════════════════════════════════════════════════╝
`);

  process.on('SIGINT', () => {
    console.log('\n👋 Shutting down...');
    gateway.close();
    process.exit(0);
  });
}

main().catch(console.error);
