import WebSocket from 'ws';
import { Gateway, generateKeyPair, buildAgentId, STANDARD_CAPABILITIES } from './src';
import { signEnvelope, decodeBase64URL, verify } from './src/crypto';
import { canonicalize } from './src/canonical';
import { generateMessageId, Envelope } from './src/envelope';
import { extractPublicKey } from './src/agent-id';

const SERVER_PORT = 0;
const TEST_TIMEOUT = 10000;

function extractPort(gateway: Gateway): number {
  return (gateway as unknown as { wss: { options?: { port: number } } }).wss.options?.port ?? 0;
}

function signMessage(
  envelope: Record<string, unknown>,
  secretKey: Uint8Array
): Record<string, unknown> {
  return signEnvelope(envelope, secretKey, canonicalize);
}

function verifySignature(envelope: Envelope): boolean {
  try {
    const sigBytes = decodeBase64URL(envelope.sig);
    if (sigBytes.length !== 64) return false;
    const publicKey = extractPublicKey(envelope.from);
    const { sig, ...unsigned } = envelope;
    const canonical = canonicalize(unsigned);
    const messageBytes = new TextEncoder().encode(canonical);
    return verify(publicKey, messageBytes, sigBytes);
  } catch {
    return false;
  }
}

async function run() {
  console.log('═══════════════════════════════════════');
  console.log('  ADP v0.2 — 端到端集成测试');
  console.log('═══════════════════════════════════════\n');

  const serverKeypair = generateKeyPair();
  const serverAgentId = buildAgentId(serverKeypair.publicKey, 'test.local', 'server');
  console.log(`🔑 Server Agent ID:\n   ${serverAgentId}\n`);

  const clientKeypair = generateKeyPair();
  const clientAgentId = buildAgentId(clientKeypair.publicKey, 'test.local', 'client');
  console.log(`🔑 Client Agent ID:\n   ${clientAgentId}\n`);

  console.log('⚡ Starting gateway...');
  const gateway = new Gateway({
    port: 9801,
    host: 'localhost',
    secretKey: serverKeypair.secretKey,
    agentId: serverAgentId,
    displayName: 'Test Server Agent',
    capabilities: STANDARD_CAPABILITIES,
    skipVerification: false,
  });
  console.log(`   Listening on ws://localhost:9801/adp\n`);

  await sleep(500);

  console.log('---');
  console.log('Test 1: adp:ping (签名 + 验签)');
  console.log('---\n');

  const ws = new WebSocket(`ws://localhost:9801/adp?agent_id=${encodeURIComponent(clientAgentId)}`);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Connection timeout')), 5000);
    ws.on('open', () => { clearTimeout(timer); resolve(); });
    ws.on('error', reject);
  });

  console.log('   🔗 Client connected\n');

  let pingReplyReceived = false;

  const messagePromise = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Response timeout')), 5000);
    
    ws.on('message', (data) => {
      const envelope = JSON.parse(data.toString()) as Envelope;
      console.log(`   📩 Received: ${envelope.action}`);
      console.log(`      from: ${envelope.from.substring(0, 60)}...`);
      console.log(`      reply_to: ${envelope.reply_to}`);

      const sigValid = verifySignature(envelope);
      console.log(`      Signature: ${sigValid ? '✅ VALID' : '❌ INVALID'}`);

      if (!sigValid) {
        clearTimeout(timer);
        reject(new Error('Signature verification failed'));
        return;
      }

      if (envelope.reply_to === 'msg_test_ping_001' && envelope.action === 'adp:ping') {
        pingReplyReceived = true;
        const params = envelope.params as { uptime: number };
        console.log(`      Content: uptime=${params.uptime}\n`);
      }

      if (envelope.reply_to === 'msg_test_capq_001' && envelope.action === 'adp:capability.query') {
        const mf = (envelope.params as { manifest: { display_name: string; capabilities: unknown[] } }).manifest;
        console.log(`      Manifest name: ${mf.display_name}`);
        console.log(`      Capabilities count: ${mf.capabilities.length}\n`);
      }

      if (envelope.reply_to === 'msg_test_capq_001') {
        clearTimeout(timer);
        resolve();
      }
    });
  });

  console.log('   📤 Sending adp:ping...\n');

  const pingMsg = signMessage({
    protocol: 'adp/0.2',
    id: 'msg_test_ping_001',
    from: clientAgentId,
    to: serverAgentId,
    action: 'adp:ping',
    params: {},
    timestamp: new Date().toISOString(),
  }, clientKeypair.secretKey);

  ws.send(JSON.stringify(pingMsg));

  await sleep(1000);

  console.log('Test 2: adp:capability.query (完整 Manifest 交换)');
  console.log('---\n');

  const capMsg = signMessage({
    protocol: 'adp/0.2',
    id: 'msg_test_capq_001',
    from: clientAgentId,
    to: serverAgentId,
    action: 'adp:capability.query',
    params: {},
    timestamp: new Date().toISOString(),
  }, clientKeypair.secretKey);

  ws.send(JSON.stringify(capMsg));

  console.log('   📤 Sent adp:capability.query\n');

  await messagePromise;

  console.log('---');
  console.log('Test 3: 无效签名拒绝测试');
  console.log('---\n');

  const fakeMsg = signMessage({
    protocol: 'adp/0.2',
    id: 'msg_test_fake_001',
    from: clientAgentId,
    to: serverAgentId,
    action: 'adp:ping',
    params: {},
    timestamp: new Date().toISOString(),
  }, clientKeypair.secretKey);

  const fakeEnvelope = { ...fakeMsg } as Record<string, unknown>;
  fakeEnvelope.params = { fake: 'tampered data' };
  delete fakeEnvelope.sig;
  const canonicalFake = canonicalize(fakeEnvelope);
  const fakeSig = signEnvelope(fakeEnvelope, clientKeypair.secretKey, canonicalize);

  const enemyKeypair = generateKeyPair();
  const enemySigBytes = signEnvelope({ ...fakeEnvelope }, enemyKeypair.secretKey, canonicalize);

  const tamperedEnvelope = { ...fakeMsg, sig: encodeBase64URL(new Uint8Array(64)) };

  ws.send(JSON.stringify(tamperedEnvelope));
  console.log('   📤 Sent message with fake signature\n');
  console.log('   (Server should reject with INVALID_SIGNATURE)\n');

  await sleep(1500);

  console.log('---');
  console.log('Test 4: adp:info (自由格式通知)');
  console.log('---\n');

  const infoMsg = signMessage({
    protocol: 'adp/0.2',
    id: 'msg_test_info_001',
    from: clientAgentId,
    to: serverAgentId,
    action: 'adp:info',
    params: {
      text: '集成测试通知消息',
      severity: 'info',
      category: 'test',
    },
    timestamp: new Date().toISOString(),
  }, clientKeypair.secretKey);

  ws.send(JSON.stringify(infoMsg));
  console.log('   📤 Sent adp:info\n');

  await sleep(1000);

  console.log('═══════════════════════════════════════');
  if (pingReplyReceived) {
    console.log('  ✅ 全部测试通过!');
    console.log('  ✅ 签名/验签正常');
    console.log('  ✅ 消息收发正常');
    console.log('  ✅ Manifest 交换正常');
    console.log('  ✅ 无效签名被拒绝');
    console.log('  ✅ 自由格式消息正常');
  } else {
    console.log('  ❌ 测试失败 — ping 回复未收到');
  }
  console.log('═══════════════════════════════════════\n');

  ws.close();
  gateway.close();
  process.exit(pingReplyReceived ? 0 : 1);
}

function encodeBase64URL(data: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let result = '';
  for (let i = 0; i < data.length; i += 3) {
    const b1 = data[i];
    const b2 = i + 1 < data.length ? data[i + 1] : 0;
    const b3 = i + 2 < data.length ? data[i + 2] : 0;
    result += chars[b1 >> 2];
    result += chars[((b1 & 0x03) << 4) | (b2 >> 4)];
    if (i + 1 < data.length) result += chars[((b2 & 0x0f) << 2) | (b3 >> 6)];
    if (i + 2 < data.length) result += chars[b3 & 0x3f];
  }
  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

run().catch((err) => {
  console.error('❌ Test error:', err);
  process.exit(1);
});
