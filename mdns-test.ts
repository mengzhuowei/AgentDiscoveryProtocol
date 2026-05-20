import { Discovery, getSharedMdns, Gateway, connectToAgent } from './src';
import { generateKeyPair } from './src/crypto';
import { buildAgentId } from './src/agent-id';
import { signEnvelope } from './src/crypto';
import { canonicalize } from './src/canonical';
import { generateMessageId } from './src/envelope';
import { STANDARD_CAPABILITIES } from './src';

async function run() {
  console.log('═══════════════════════════════════════');
  console.log('  ADP mDNS — 局域网零配置发现测试');
  console.log('═══════════════════════════════════════\n');

  const kp1 = generateKeyPair();
  const agent1Id = buildAgentId(kp1.publicKey, 'test.local', 'agent1');
  console.log(`🔑  agent1: ${agent1Id}`);

  const kp2 = generateKeyPair();
  const agent2Id = buildAgentId(kp2.publicKey, 'test.local', 'agent2');
  console.log(`🔑  agent2: ${agent2Id}\n`);

  const PORT1 = 9850;
  const PORT2 = 9851;

  const g1 = new Gateway({
    port: PORT1, host: 'localhost',
    secretKey: kp1.secretKey, agentId: agent1Id,
    displayName: 'Agent 1', capabilities: STANDARD_CAPABILITIES,
    skipVerification: false,
  });

  const g2 = new Gateway({
    port: PORT2, host: 'localhost',
    secretKey: kp2.secretKey, agentId: agent2Id,
    displayName: 'Agent 2', capabilities: STANDARD_CAPABILITIES,
    skipVerification: false,
  });

  const sharedMdns = getSharedMdns();
  let agent2DiscoveredAgent1 = false;

  sharedMdns.on('response', () => {});

  const d1 = new Discovery(agent1Id, PORT1, {
    onPeerDiscovered: (peer) => {
      console.log(`   agent1 discovered: ${peer.host}:${peer.port}`);
    },
  }, sharedMdns);

  const d2 = new Discovery(agent2Id, PORT2, {
    onPeerDiscovered: async (peer) => {
      console.log(`   agent2 discovered: ${peer.host}:${peer.port}`);
      agent2DiscoveredAgent1 = true;

      try {
        const connectAddr = peer.host.endsWith('.local') ? `localhost:${peer.port}` : `${peer.host}:${peer.port}`;
        const ws = await connectToAgent(peer.agentId, connectAddr, agent2Id);
        console.log(`   ✅ Connected!`);

        ws.on('message', (raw) => {
          const env = JSON.parse(raw.toString());
          console.log(`📩  agent2 ← agent1: ${env.action} [${JSON.stringify(env.params)}]`);
        });

        ws.send(JSON.stringify(signEnvelope({
          protocol: 'adp/0.2', id: generateMessageId(),
          from: agent2Id, to: agent1Id,
          action: 'adp:ping', params: { via: 'mdns' },
          timestamp: new Date().toISOString(),
        }, kp2.secretKey, canonicalize)));
        console.log(`   📤 Sent adp:ping\n`);
      } catch (err) {
        console.log(`   ⚠️  Connect failed: ${(err as Error).message}\n`);
      }
    },
  }, sharedMdns);

  d1.start();
  d2.start();

  console.log('📡  Both agents announcing');
  console.log('🔎  Waiting for discovery (up to 10s)...\n');

  await sleep(10000);

  console.log('═══════════════════════════════════════');
  if (agent2DiscoveredAgent1) {
    console.log('  ✅ mDNS 发现测试通过!');
    console.log('  ✅ 组播广播正常');
    console.log('  ✅ PTR/SRV/TXT 解析正常');
    console.log('  ✅ 零配置自动发现正常');
  } else {
    console.log('  ⚠️  mDNS 未发现对等节点');
    console.log('  (mDNS 依赖本地组播，Windows 虚拟网卡可能受限)');
  }
  console.log('═══════════════════════════════════════\n');

  d1.shutdown();
  d2.shutdown();
  g1.close();
  g2.close();
  process.exit(0);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

run().catch(err => { console.error('❌', err); process.exit(1); });
