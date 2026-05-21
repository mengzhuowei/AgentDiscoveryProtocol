import { Gateway, connectToAgent, loadOrCreateIdentity, Discovery, DiscoveredPeer, Capability } from '../src';
import { signEnvelope, generateMessageId } from '../src/envelope';
import { canonicalize } from '../src/canonical';

const CAPABILITY_VIDEO_GENERATE = 'custom:video.generate';

async function discoverAndCallVideoCapability() {
  const { identity } = loadOrCreateIdentity('local', 'video-client', 'VideoClient');

  const gateway = new Gateway({
    port: 9901,
    host: 'localhost',
    secretKey: identity.secretKey,
    agentId: identity.agentId,
    displayName: 'Video Requester',
    capabilities: ['adp:ping', 'adp:capability.query'],
  });

  console.log(`\n🔍 正在通过 mDNS 发现视频生成 Agent...\n`);

  const discovery = new Discovery(identity.agentId, 9901, {
    onPeerDiscovered: async (peer: DiscoveredPeer) => {
      console.log(`\n📡 发现 Agent: ${peer.agentId}`);
      console.log(`   地址: ${peer.host}:${peer.port}\n`);

      try {
        console.log(`🔗 连接到 ${peer.agentId.slice(0, 40)}...`);
        const ws = await connectToAgent(peer.agentId, `${peer.host}:${peer.port}`, identity.agentId);

        ws.on('message', (data) => {
          const env = JSON.parse(data.toString());
          console.log(`\n📩 收到响应 from ${env.from}:`);
          console.log(`   Action: ${env.action}`);
          console.log(`   Params: ${JSON.stringify(env.params, null, 2)}\n`);

          if (env.params?.result?.video_url) {
            console.log(`🎉 视频生成成功!`);
            console.log(`   视频: ${env.params.result.video_url}`);
            console.log(`   缩略图: ${env.params.result.thumbnail_url}`);

            setTimeout(() => {
              ws.close();
              discovery.shutdown();
              gateway.close();
              process.exit(0);
            }, 1000);
          }
        });

        await new Promise(r => setTimeout(r, 500));

        console.log(`📋 查询对方能力列表...`);
        const queryMsg = signEnvelope({
          protocol: 'adp/0.2',
          id: generateMessageId(),
          from: identity.agentId,
          to: peer.agentId,
          action: 'adp:capability.query',
          params: {},
          timestamp: new Date().toISOString(),
        }, identity.secretKey, canonicalize);
        ws.send(JSON.stringify(queryMsg));

        await new Promise(r => setTimeout(r, 500));

        console.log(`\n🎬 请求生成视频...`);
        const videoMsg = signEnvelope({
          protocol: 'adp/0.2',
          id: generateMessageId(),
          from: identity.agentId,
          to: peer.agentId,
          action: CAPABILITY_VIDEO_GENERATE,
          params: {
            prompt: '一只猫在草地上追逐蝴蝶',
            duration: 10,
            style: 'cartoon',
          },
          timestamp: new Date().toISOString(),
        }, identity.secretKey, canonicalize);
        ws.send(JSON.stringify(videoMsg));

      } catch (err) {
        console.error(`❌ 连接失败: ${(err as Error).message}`);
      }
    },

    onPeerLost: (agentId: string) => {
      console.log(`🔌 Agent 离线: ${agentId.slice(0, 40)}...`);
    },
  });

  discovery.start();

  setTimeout(() => {
    console.log(`\n⏰ 30秒超时，关闭...`);
    discovery.shutdown();
    gateway.close();
    process.exit(0);
  }, 30000);
}

async function directCall() {
  const { identity } = loadOrCreateIdentity('local', 'video-client', 'VideoClient');

  const TARGET_AGENT = process.env.TARGET_AGENT_ID || 'adp://test@local/openclaw';
  const TARGET_ADDRESS = process.env.TARGET_ADDRESS || 'localhost:9900';

  const gateway = new Gateway({
    port: 9901,
    host: 'localhost',
    secretKey: identity.secretKey,
    agentId: identity.agentId,
    displayName: 'Video Requester',
    capabilities: ['adp:ping', 'adp:capability.query'],
  });

  console.log(`\n🔗 直接连接到 ${TARGET_ADDRESS}...\n`);

  try {
    const ws = await connectToAgent(TARGET_AGENT, TARGET_ADDRESS, identity.agentId);

    ws.on('message', (data) => {
      const env = JSON.parse(data.toString());
      console.log(`\n📩 收到响应:`);
      console.log(`   ${JSON.stringify(env.params, null, 2)}\n`);

      if (env.params?.result?.video_url) {
        console.log(`✅ 视频就绪: ${env.params.result.video_url}`);
        setTimeout(() => process.exit(0), 1000);
      }
    });

    await new Promise(r => setTimeout(r, 500));

    console.log(`🎬 发送视频生成请求...`);
    const videoMsg = signEnvelope({
      protocol: 'adp/0.2',
      id: generateMessageId(),
      from: identity.agentId,
      to: TARGET_AGENT,
      action: CAPABILITY_VIDEO_GENERATE,
      params: {
        prompt: 'AI agent 在月球上跳舞',
        duration: 5,
        style: '3d',
      },
      timestamp: new Date().toISOString(),
    }, identity.secretKey, canonicalize);
    ws.send(JSON.stringify(videoMsg));

  } catch (err) {
    console.error(`❌ 失败: ${(err as Error).message}`);
  }

  process.on('SIGINT', () => {
    gateway.close();
    process.exit(0);
  });
}

const mode = process.argv[2] || 'discover';

if (mode === 'direct') {
  directCall();
} else {
  discoverAndCallVideoCapability();
}
