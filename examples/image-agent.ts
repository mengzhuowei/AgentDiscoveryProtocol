import { Gateway, loadOrCreateIdentity, Capability, Route, Envelope } from '../src';
import { WebSocket } from 'ws';

const CAPABILITY_IMAGE_GENERATE = 'custom:image.generate';
const CAPABILITY_IMAGE_EDIT = 'custom:image.edit';

interface ImageProvider {
  name: string;
  generate: (prompt: string, style?: string) => Promise<{ url: string; provider: string }>;
}

class StableDiffusionProvider implements ImageProvider {
  name = 'Stable Diffusion';
  private baseUrl = 'https://api.stable-diffusion.example.com';

  async generate(prompt: string, style = 'realistic'): Promise<{ url: string; provider: string }> {
    console.log(`   🎨 使用 ${this.name} 生成图像...`);
    await new Promise(resolve => setTimeout(resolve, 2000));
    const imageId = `sd_${Date.now().toString(36)}`;
    return {
      url: `https://cdn.example.com/images/${imageId}.png`,
      provider: this.name,
    };
  }
}

class DalleProvider implements ImageProvider {
  name = 'DALL-E';
  private apiKey = process.env.OPENAI_API_KEY || 'demo-key';

  async generate(prompt: string, style = 'vivid'): Promise<{ url: string; provider: string }> {
    console.log(`   🎨 使用 ${this.name} 生成图像...`);
    await new Promise(resolve => setTimeout(resolve, 1500));
    const imageId = `dalle_${Date.now().toString(36)}`;
    return {
      url: `https://cdn.example.com/images/${imageId}.png`,
      provider: this.name,
    };
  }
}

async function main() {
  const { identity } = loadOrCreateIdentity('local', 'image-agent', 'ImageAgent');

  const providers: Map<string, ImageProvider> = new Map();
  providers.set('stable-diffusion', new StableDiffusionProvider());
  providers.set('dalle', new DalleProvider());

  const capabilities: (string | Capability)[] = [
    'adp:ping',
    'adp:capability.query',
    {
      capability: CAPABILITY_IMAGE_GENERATE,
      description: 'AI 图像生成（支持多种后端）',
      input_schema: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: '图像描述/提示词',
          },
          provider: {
            type: 'string',
            description: 'AI 提供商',
            enum: ['stable-diffusion', 'dalle', 'auto'],
            default: 'auto',
          },
          style: {
            type: 'string',
            description: '图像风格',
            enum: ['realistic', 'artistic', 'cartoon', 'anime'],
            default: 'realistic',
          },
          size: {
            type: 'string',
            description: '图像尺寸',
            enum: ['512x512', '1024x1024', '1024x1792'],
            default: '1024x1024',
          },
        },
        required: ['prompt'],
      },
    },
    {
      capability: CAPABILITY_IMAGE_EDIT,
      description: 'AI 图像编辑',
      input_schema: {
        type: 'object',
        properties: {
          original_url: {
            type: 'string',
            description: '原始图像 URL',
          },
          instruction: {
            type: 'string',
            description: '编辑指令',
          },
          mask_url: {
            type: 'string',
            description: '蒙版图像 URL（可选）',
          },
        },
        required: ['original_url', 'instruction'],
      },
    },
  ];

  const routes: Route[] = [{ type: 'direct', address: 'localhost:9903' }];

  const gateway = new Gateway({
    port: 9903,
    host: '0.0.0.0',
    secretKey: identity.secretKey,
    agentId: identity.agentId,
    displayName: 'Image Generation Agent',
    capabilities,
    routes,
    customHandlers: {
      [CAPABILITY_IMAGE_GENERATE]: async (ws: WebSocket, envelope: Envelope) => {
        const params = envelope.params as {
          prompt?: string;
          provider?: string;
          style?: string;
          size?: string;
        };

        console.log(`\n🖼️ 收到图像生成请求 from ${envelope.from}`);
        console.log(`   提示词: ${params.prompt}`);
        console.log(`   提供商: ${params.provider || 'auto'}`);
        console.log(`   风格: ${params.style || 'realistic'}`);
        console.log(`   尺寸: ${params.size || '1024x1024'}\n`);

        let selectedProvider: ImageProvider;
        if (params.provider && params.provider !== 'auto') {
          selectedProvider = providers.get(params.provider)!;
        } else {
          const providerKeys = Array.from(providers.keys());
          const randomProvider = providerKeys[Math.floor(Math.random() * providerKeys.length)];
          selectedProvider = providers.get(randomProvider)!;
        }

        if (!selectedProvider) {
          throw new Error(`Provider not found: ${params.provider}`);
        }

        const result = await selectedProvider.generate(params.prompt!, params.style);

        gateway.signAndBuildEnvelope = (options: {
          to: string;
          action: string;
          params?: unknown;
          reply_to?: string;
        }) => {
          const { signEnvelope, generateMessageId } = require('../src');
          const { canonicalize } = require('../src/canonical');
          const unsigned = {
            protocol: 'adp/0.2',
            id: generateMessageId(),
            from: identity.agentId,
            to: options.to,
            action: options.action,
            params: options.params || {},
            reply_to: options.reply_to,
            timestamp: new Date().toISOString(),
          };
          return signEnvelope(unsigned, identity.secretKey, canonicalize);
        };

        const reply = gateway.signAndBuildEnvelope({
          to: envelope.from,
          action: CAPABILITY_IMAGE_GENERATE,
          params: {
            status: 'COMPLETED',
            result: {
              image_url: result.url,
              provider: result.provider,
              size: params.size || '1024x1024',
              style: params.style || 'realistic',
              generated_at: new Date().toISOString(),
            },
          },
          reply_to: envelope.id,
        });

        ws.send(JSON.stringify(reply));
        console.log(`✅ 图像生成完成! URL: ${result.url}`);
      },
      [CAPABILITY_IMAGE_EDIT]: async (ws: WebSocket, envelope: Envelope) => {
        const params = envelope.params as {
          original_url?: string;
          instruction?: string;
          mask_url?: string;
        };

        console.log(`\n✏️ 收到图像编辑请求 from ${envelope.from}`);
        console.log(`   原始图像: ${params.original_url}`);
        console.log(`   指令: ${params.instruction}\n`);

        await new Promise(resolve => setTimeout(resolve, 3000));

        const editId = `edit_${Date.now().toString(36)}`;
        const result = {
          edited_url: `https://cdn.example.com/edited/${editId}.png`,
          original_url: params.original_url,
          instruction: params.instruction,
        };

        const reply = gateway.signAndBuildEnvelope({
          to: envelope.from,
          action: CAPABILITY_IMAGE_EDIT,
          params: {
            status: 'COMPLETED',
            result,
          },
          reply_to: envelope.id,
        });

        ws.send(JSON.stringify(reply));
        console.log(`✅ 图像编辑完成! URL: ${result.edited_url}`);
      },
    },
  });

  console.log(`
╔══════════════════════════════════════════════════════╗
║          🖼️ Image Generation Agent                  ║
╠══════════════════════════════════════════════════════╣
║  Agent ID: ${identity.agentId.slice(0, 40)}
║  能力: ${CAPABILITY_IMAGE_GENERATE}
║         ${CAPABILITY_IMAGE_EDIT}
║  提供商: Stable Diffusion, DALL-E
║  端口: ws://localhost:9903/adp
╚══════════════════════════════════════════════════════╝
`);

  process.on('SIGINT', () => {
    console.log('\n👋 Shutting down...');
    gateway.close();
    process.exit(0);
  });
}

main().catch(console.error);