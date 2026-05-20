import WebSocket from 'ws';
import { Relay, RelayClient } from './src/relay';
import { Gateway } from './src/gateway';
import { generateKeyPair } from './src/crypto';
import { buildAgentId } from './src/agent-id';
import { signEnvelope } from './src/crypto';
import { canonicalize } from './src/canonical';
import { STANDARD_CAPABILITIES } from './src';

const RELAY_PORT = 9700;
const AGENT1_PORT = 9800;
const AGENT2_PORT = 9801;
const RELAY_URL = `ws://localhost:${RELAY_PORT}/adp/relay`;

async function run() {
  console.log('═══════════════════════════════════════');
  console.log('  ADP Relay — 端到端中继测试');
  console.log('═══════════════════════════════════════\n');

  const relay = new Relay({ port: RELAY_PORT, host: 'localhost' });
  console.log(`🔄  Relay  on ws://localhost:${RELAY_PORT}/adp/relay\n`);

  const kp1 = generateKeyPair();
  const agent1Id = buildAgentId(kp1.publicKey, 'test.local', 'agent1');
  console.log(`🔑  agent1: ${agent1Id}`);

  const kp2 = generateKeyPair();
  const agent2Id = buildAgentId(kp2.publicKey, 'test.local', 'agent2');
  console.log(`🔑  agent2: ${agent2Id}\n`);

  console.log('--- Starting agent1 Gateway + Relay ---\n');

  const g1 = new Gateway({
    port: AGENT1_PORT, host: 'localhost',
    secretKey: kp1.secretKey, agentId: agent1Id,
    displayName: 'Agent 1', capabilities: STANDARD_CAPABILITIES,
    skipVerification: false,
  });

  const rc1 = new RelayClient(RELAY_URL, agent1Id, {
    onWelcome: (sid) => console.log(`   agent1 relay session: ${sid}`),
    onMessage: (msg) => g1.processRelayMessage(msg),
  });
  await rc1.connect();

  await sleep(500);

  console.log('\n--- Starting agent2 Gateway + Relay ---\n');

  const g2 = new Gateway({
    port: AGENT2_PORT, host: 'localhost',
    secretKey: kp2.secretKey, agentId: agent2Id,
    displayName: 'Agent 2', capabilities: STANDARD_CAPABILITIES,
    skipVerification: false,
  });

  const rc2 = new RelayClient(RELAY_URL, agent2Id, {
    onWelcome: (sid) => console.log(`   agent2 relay session: ${sid}`),
    onMessage: (msg) => g2.processRelayMessage(msg),
  });
  await rc2.connect();

  await sleep(500);

  console.log('\n--- Test: agent2 → Relay → agent1 ---\n');

  const pingMsg = signEnvelope({
    protocol: 'adp/0.2',
    id: 'msg_relay_test_001',
    from: agent2Id,
    to: agent1Id,
    action: 'adp:ping',
    params: { via: 'relay' },
    timestamp: new Date().toISOString(),
  }, kp2.secretKey, canonicalize);

  console.log('   agent2 sends adp:ping (via relay)...');
  rc2.send(agent1Id, pingMsg);

  await sleep(1500);

  console.log('\n--- Test: agent1 → Relay → agent2 ---\n');

  const pongMsg = signEnvelope({
    protocol: 'adp/0.2',
    id: 'msg_relay_test_002',
    from: agent1Id,
    to: agent2Id,
    action: 'adp:ping',
    params: { via: 'relay', direction: 'response' },
    timestamp: new Date().toISOString(),
  }, kp1.secretKey, canonicalize);

  console.log('   agent1 sends adp:ping back (via relay)...');
  rc1.send(agent2Id, pongMsg);

  await sleep(1500);

  console.log('\n═══════════════════════════════════════');
  console.log('  ✅ Relay 端到端测试完成');
  console.log('═══════════════════════════════════════\n');

  rc1.close();
  rc2.close();
  g1.close();
  g2.close();
  relay.close();
  process.exit(0);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

run().catch(err => { console.error('❌', err); process.exit(1); });
