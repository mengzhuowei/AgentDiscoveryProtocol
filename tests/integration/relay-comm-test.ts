import WebSocket from 'ws';
import { Relay } from '../../src/relay';
import { generateKeyPair } from '../../src/crypto';
import { buildAgentId } from '../../src/agent-id';
import { signEnvelope } from '../../src/crypto';
import { canonicalize } from '../../src/canonical';

const RELAY_PORT = 9706;
const RELAY_URL = `ws://localhost:${RELAY_PORT}/adp/relay`;

async function run() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  ADP Relay — Agent1 ↔ Agent2 双向通信测试');
  console.log('═══════════════════════════════════════════════════════════\n');

  const relay = new Relay({ port: RELAY_PORT, host: 'localhost' });
  console.log(`🔄  Relay on ws://localhost:${RELAY_PORT}/adp/relay\n`);

  const kp1 = generateKeyPair();
  const agent1Id = buildAgentId(kp1.publicKey, 'test.local', 'agent1');

  const kp2 = generateKeyPair();
  const agent2Id = buildAgentId(kp2.publicKey, 'test.local', 'agent2');

  console.log(`🔑  agent1: ${agent1Id}`);
  console.log(`🔑  agent2: ${agent2Id}\n`);

  const agent1Received: any[] = [];
  const agent2Received: any[] = [];

  const conn1 = await connectAsAgent(agent1Id, (msg) => {
    agent1Received.push(msg);
    console.log(`   📥 agent1 收到: ${msg.action} (from ${msg.from})`);
  });

  const conn2 = await connectAsAgent(agent2Id, (msg) => {
    agent2Received.push(msg);
    console.log(`   📥 agent2 收到: ${msg.action} (from ${msg.from})`);
  });

  await sleep(500);

  // ─────────────────────────────────────────────────────────────
  // Test 1: agent2 → agent1 via relay
  // ─────────────────────────────────────────────────────────────
  console.log('\n━━━ Test 1: agent2 → agent1 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const msg1 = signEnvelope({
    protocol: 'adp/0.2',
    id: 'msg_a2_to_a1_' + Date.now(),
    from: agent2Id,
    to: agent1Id,
    action: 'adp:ping',
    params: { hello: 'from agent2' },
    timestamp: new Date().toISOString(),
  }, kp2.secretKey, canonicalize);

  console.log('   agent2 发送 adp:ping → agent1');
  conn2.send(JSON.stringify({ type: 'relay', to: agent1Id, payload: msg1 }));

  await sleep(500);

  // ─────────────────────────────────────────────────────────────
  // Test 2: agent1 → agent2 via relay
  // ─────────────────────────────────────────────────────────────
  console.log('\n━━━ Test 2: agent1 → agent2 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const msg2 = signEnvelope({
    protocol: 'adp/0.2',
    id: 'msg_a1_to_a2_' + Date.now(),
    from: agent1Id,
    to: agent2Id,
    action: 'adp:pong',
    params: { hello: 'from agent1' },
    timestamp: new Date().toISOString(),
  }, kp1.secretKey, canonicalize);

  console.log('   agent1 发送 adp:pong → agent2');
  conn1.send(JSON.stringify({ type: 'relay', to: agent2Id, payload: msg2 }));

  await sleep(500);

  // ─────────────────────────────────────────────────────────────
  // Test 3: 多消息连续发送
  // ─────────────────────────────────────────────────────────────
  console.log('\n━━━ Test 3: 多消息连续发送 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  for (let i = 1; i <= 3; i++) {
    const msg = signEnvelope({
      protocol: 'adp/0.2',
      id: 'msg_batch_' + Date.now() + '_' + i,
      from: agent2Id,
      to: agent1Id,
      action: 'adp:ping',
      params: { sequence: i },
      timestamp: new Date().toISOString(),
    }, kp2.secretKey, canonicalize);

    console.log(`   agent2 发送第 ${i} 条消息`);
    conn2.send(JSON.stringify({ type: 'relay', to: agent1Id, payload: msg }));
    await sleep(200);
  }

  await sleep(500);

  // ─────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  📊 测试结果汇总');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`   agent1 收到消息数: ${agent1Received.length}`);
  agent1Received.forEach((msg, i) => console.log(`     [${i + 1}] ${msg.action} (id: ${msg.id})`));

  console.log(`\n   agent2 收到消息数: ${agent2Received.length}`);
  agent2Received.forEach((msg, i) => console.log(`     [${i + 1}] ${msg.action} (id: ${msg.id})`));

  const success = agent1Received.length >= 4 && agent2Received.length >= 1;
  console.log(`\n   ${success ? '✅ 双向通信测试通过' : '❌ 测试失败 (期望: agent1≥4, agent2≥1)'}\n`);

  conn1.close();
  conn2.close();
  relay.close();
  process.exit(success ? 0 : 1);
}

function connectAsAgent(
  agentId: string,
  onMessage: (msg: any) => void
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${RELAY_URL}?agent_id=${encodeURIComponent(agentId)}`);

    const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);

    ws.on('open', () => {
      clearTimeout(timeout);
      console.log(`   ✓ ${agentId.split('@')[1]} 已连接`);
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        // Relay 直接转发 envelope，不包装在 relay type 里
        if (msg.protocol === 'adp/0.2' && msg.action) {
          onMessage(msg);
        } else if (msg.type === 'welcome') {
          console.log(`     session: ${msg.session_id}`);
        } else if (msg.type === 'peer_joined' || msg.type === 'peer_left') {
          console.log(`   👤 ${msg.type}: ${msg.agent_id.split('@')[1]}`);
        } else if (msg.type === 'peers_list' && msg.peers) {
          console.log(`   👥 peers: ${msg.peers.map((p: string) => p.split('@')[1]).join(', ')}`);
        }
      } catch (e) {
        console.log(`   消息解析失败: ${data.toString().slice(0, 100)}`);
      }
    });

    ws.on('error', (err) => {
      console.error(`   ❌ WebSocket error for ${agentId}:`, err.message);
    });

    ws.on('close', (code, reason) => {
      console.log(`   🔌 ${agentId.split('@')[1]} closed: code=${code}`);
    });

    resolve(ws);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

run().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});