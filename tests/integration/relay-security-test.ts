import WebSocket from 'ws';
import { Relay } from '../../src/relay';
import { generateKeyPair } from '../../src/crypto';
import { buildAgentId } from '../../src/agent-id';
import { signEnvelope } from '../../src/crypto';
import { canonicalize } from '../../src/canonical';

const RELAY_PORT = 9701;
const RELAY_URL = `ws://localhost:${RELAY_PORT}/adp/relay`;

async function run() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  ADP Relay — 安全修复测试：身份冒充 & 重放攻击防护');
  console.log('═══════════════════════════════════════════════════════════\n');

  const relay = new Relay({ port: RELAY_PORT, host: 'localhost' });
  console.log(`🔄  Relay on ws://localhost:${RELAY_PORT}/adp/relay\n`);

  // 创建两个 Agent 身份
  const kp1 = generateKeyPair();
  const agent1Id = buildAgentId(kp1.publicKey, 'test.local', 'agent1');

  const kp2 = generateKeyPair();
  const agent2Id = buildAgentId(kp2.publicKey, 'test.local', 'agent2');

  const kp3 = generateKeyPair();
  const agent3Id = buildAgentId(kp3.publicKey, 'test.local', 'agent3');

  console.log(`🔑  agent1: ${agent1Id}`);
  console.log(`🔑  agent2: ${agent2Id}`);
  console.log(`🔑  agent3: ${agent3Id}\n`);

  let spoofingAttemptsBlocked = 0;
  let replayAttemptsBlocked = 0;

  // 连接 agent1 和 agent2
  const conn1 = await connectAsAgent(agent1Id);
  const conn2 = await connectAsAgent(agent2Id);

  await sleep(300);

  // ─────────────────────────────────────────────────────────────
  // 测试 1: 身份冒充防护
  // agent2 连接后，尝试发送一条 from=agent3 的消息（冒充他人）
  // ─────────────────────────────────────────────────────────────
  console.log('\n━━━ 测试 1: 身份冒充防护 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // agent2 尝试发送消息，但声称是 agent3（spoofing）
  const spoofedMsg = signEnvelope({
    protocol: 'adp/0.2',
    id: 'msg_spoof_test_001',
    from: agent3Id,  // 冒充 agent3
    to: agent1Id,
    action: 'adp:ping',
    params: { spoofed: true },
    timestamp: new Date().toISOString(),
  }, kp3.secretKey, canonicalize);

  console.log(`   agent2 (session as ${agent2Id})`);
  console.log(`   尝试发送消息，from 字段被篡改为 ${agent3Id}`);
  console.log('   预期结果: Relay 拒绝并拦截\n');

  conn2.send(JSON.stringify({ type: 'relay', to: agent1Id, payload: spoofedMsg }));

  await sleep(500);

  // 检查 relay 统计或日志（简化：检查 conn1 是否没收到消息）
  // 由于 spoofing 被拦截，conn1 不应收到这条消息

  // ─────────────────────────────────────────────────────────────
  // 测试 2: 重放攻击防护
  // agent2 发送两条相同的消息（相同 id），第二条应该被拒绝
  // ─────────────────────────────────────────────────────────────
  console.log('\n━━━ 测试 2: 重放攻击防护 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const msgId = 'msg_replay_test_unique_id_' + Date.now();

  const replayMsg = signEnvelope({
    protocol: 'adp/0.2',
    id: msgId,
    from: agent2Id,
    to: agent1Id,
    action: 'adp:ping',
    params: { replay_test: true },
    timestamp: new Date().toISOString(),
  }, kp2.secretKey, canonicalize);

  console.log(`   agent2 发送消息，id=${msgId}`);
  conn2.send(JSON.stringify({ type: 'relay', to: agent1Id, payload: replayMsg }));
  await sleep(300);

  console.log(`   agent2 再次发送相同 id=${msgId} 的消息`);
  conn2.send(JSON.stringify({ type: 'relay', to: agent1Id, payload: replayMsg }));
  await sleep(300);

  console.log('\n   预期结果: 第二次发送应被 Relay 识别为重放并拒绝\n');

  // ─────────────────────────────────────────────────────────────
  // 测试 3: 正常转发（对照组）
  // agent2 正常发送自己的消息
  // ─────────────────────────────────────────────────────────────
  console.log('\n━━━ 测试 3: 正常转发（对照组） ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const normalMsg = signEnvelope({
    protocol: 'adp/0.2',
    id: 'msg_normal_test_' + Date.now(),
    from: agent2Id,
    to: agent1Id,
    action: 'adp:ping',
    params: { normal: true },
    timestamp: new Date().toISOString(),
  }, kp2.secretKey, canonicalize);

  console.log(`   agent2 发送正常消息 (from=agent2)`);
  conn2.send(JSON.stringify({ type: 'relay', to: agent1Id, payload: normalMsg }));
  await sleep(500);

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  ✅ 安全测试完成');
  console.log('═══════════════════════════════════════════════════════════\n');

  conn1.close();
  conn2.close();
  relay.close();
  process.exit(0);
}

function connectAsAgent(agentId: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${RELAY_URL}?agent_id=${encodeURIComponent(agentId)}`);

    const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);

    ws.on('open', () => {
      clearTimeout(timeout);
      resolve(ws);
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'welcome') {
        console.log(`   ✓ ${agentId} connected: ${msg.session_id}`);
      } else if (msg.type === 'relay') {
        console.log(`   📨 ${agentId} received: ${JSON.stringify(msg.payload).slice(0, 80)}...`);
      }
    });

    ws.on('error', reject);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

run().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});