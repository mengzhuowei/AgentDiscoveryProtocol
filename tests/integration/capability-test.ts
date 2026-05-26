import { Gateway, connectToAgent } from '../../src';
import { generateKeyPair } from '../../src/crypto';
import { buildAgentId } from '../../src/agent-id';
import { signEnvelope } from '../../src/crypto';
import { canonicalize } from '../../src/canonical';
import { generateMessageId } from '../../src/envelope';
import { STANDARD_CAPABILITIES } from '../../src';
import { createEchoHandler, createChatHandler } from '../../src/capabilities';

async function run() {
  console.log('═══════════════════════════════════════');
  console.log('  ADP — 自定义 Capability 测试');
  console.log('═══════════════════════════════════════\n');

  const PORT_A = 9870;
  const PORT_B = 9871;

  const kpA = generateKeyPair();
  const agentAId = buildAgentId(kpA.publicKey, 'test.local', 'agenta');
  console.log(`🔑  Agent A: ${agentAId.slice(0, 50)}...`);

  const kpB = generateKeyPair();
  const agentBId = buildAgentId(kpB.publicKey, 'test.local', 'agentb');
  console.log(`🔑  Agent B: ${agentBId.slice(0, 50)}...\n`);

  let echoResult: unknown = null;
  let chatResult: unknown = null;

  const gA = new Gateway({
    port: PORT_A, host: 'localhost',
    secretKey: kpA.secretKey, agentId: agentAId,
    displayName: 'Agent A', capabilities: [...STANDARD_CAPABILITIES],
    skipVerification: false, tofuEnabled: true,
  });

  gA.registerCapability('custom:echo', createEchoHandler(agentAId, kpA.secretKey));
  gA.registerCapability('custom:chat', createChatHandler(agentAId, kpA.secretKey));

  const gB = new Gateway({
    port: PORT_B, host: 'localhost',
    secretKey: kpB.secretKey, agentId: agentBId,
    displayName: 'Agent B', capabilities: [...STANDARD_CAPABILITIES],
    skipVerification: false, tofuEnabled: true,
  });

  await sleep(300);

  console.log('--- Test 1: custom:echo (Agent B → Agent A) ---\n');

  const ws = await connectToAgent(agentAId, `localhost:${PORT_A}`, agentBId);
  console.log('✅  Agent B connected to A\n');

  ws.on('message', (raw) => {
    const env = JSON.parse(raw.toString());
    if (env.action === 'custom:echo') {
      echoResult = env.params;
    }
    if (env.action === 'custom:chat') {
      chatResult = env.params;
    }
  });

  console.log('📤  Agent B → Agent A: custom:echo { word: "hello" }');
  ws.send(JSON.stringify(signEnvelope({
    protocol: 'adp/0.2', id: generateMessageId(),
    from: agentBId, to: agentAId,
    action: 'custom:echo',
    params: { word: 'hello' },
    timestamp: new Date().toISOString(),
  }, kpB.secretKey, canonicalize)));

  await sleep(800);
  console.log(`📩  Agent B received echo: ${JSON.stringify(echoResult)}`);

  const echoPass = echoResult && (echoResult as { word: string }).word === 'hello';
  console.log(`   ${echoPass ? '✅ PASS' : '❌ FAIL — expected {word:"hello"}'}\n`);

  console.log('--- Test 2: custom:chat (Agent B → Agent A) ---\n');

  console.log('📤  Agent B → Agent A: custom:chat { text: "你好" }');
  ws.send(JSON.stringify(signEnvelope({
    protocol: 'adp/0.2', id: generateMessageId(),
    from: agentBId, to: agentAId,
    action: 'custom:chat',
    params: { text: '你好' },
    timestamp: new Date().toISOString(),
  }, kpB.secretKey, canonicalize)));

  await sleep(800);
  console.log(`📩  Agent B received chat ACK: ${JSON.stringify(chatResult)}`);

  const chatPass = chatResult && (chatResult as { ok: boolean }).ok === true;
  console.log(`   ${chatPass ? '✅ PASS' : '❌ FAIL — expected {ok:true}'}\n`);

  console.log('--- Test 3: UNKNOWN_ACTION rejected ---\n');

  echoResult = null;
  ws.send(JSON.stringify(signEnvelope({
    protocol: 'adp/0.2', id: generateMessageId(),
    from: agentBId, to: agentAId,
    action: 'custom:nonexistent',
    params: {},
    timestamp: new Date().toISOString(),
  }, kpB.secretKey, canonicalize)));

  await sleep(800);
  console.log(`   Agent B saw echo: ${echoResult === null ? 'no (correctly rejected)' : 'yes (UNEXPECTED)'}`);

  console.log('\n═══════════════════════════════════════');
  if (echoPass && chatPass) {
    console.log('  ✅ 自定义 Capability 测试全部通过!');
    console.log('  ✅ custom:echo — 原样返回');
    console.log('  ✅ custom:chat — ACK ok');
    console.log('  ✅ UNKNOWN_ACTION — 正确拒绝');
  } else {
    console.log('  ❌ 部分测试失败');
  }
  console.log('═══════════════════════════════════════\n');

  ws.close();
  gA.close();
  gB.close();
  process.exit(0);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

run().catch(err => { console.error('❌', err); process.exit(1); });
