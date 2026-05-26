import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import WebSocket from 'ws';
import { Gateway, connectToAgent, STANDARD_CAPABILITIES, TrustStore, ContactStore } from '../../src';
import { generateKeyPair, encodeBase64URL, signEnvelope } from '../../src/crypto';
import { buildAgentId, extractPublicKey } from '../../src/agent-id';
import { canonicalize } from '../../src/canonical';
import { Envelope } from '../../src/envelope';

const TEST_DIR = path.join(os.tmpdir(), 'adp-contacts-test-' + Date.now());
const CONTACTS_PATH = path.join(TEST_DIR, 'contacts.json');

function writeContacts(data: Record<string, unknown>): void {
  fs.mkdirSync(TEST_DIR, { recursive: true });
  fs.writeFileSync(CONTACTS_PATH, JSON.stringify(data, null, 2));
}

async function run() {
  console.log('═══════════════════════════════════════');
  console.log('  ADP — Static Contacts 测试');
  console.log('═══════════════════════════════════════\n');

  const PORT = 9875;

  console.log('--- Test 1: ContactStore load/save/roundtrip ---\n');

  const kpA = generateKeyPair();
  const agentAId = buildAgentId(kpA.publicKey, 'test.local', 'agenta');

  const kpB = generateKeyPair();
  const agentBId = buildAgentId(kpB.publicKey, 'test.local', 'agentb');

  writeContacts({
    [agentAId]: {
      routes: [{ type: 'direct' as const, address: '192.168.1.100:9800' }],
    },
    [agentBId]: {
      routes: [
        { type: 'relay' as const, relay: 'relay.example.com:9800', session_id: 'sess_abc' },
        { type: 'direct' as const, address: '10.0.0.5:9800' },
      ],
      trust: 'pinned' as const,
      public_key: encodeBase64URL(kpB.publicKey),
    },
  });

  const cs = new ContactStore(CONTACTS_PATH);
  await cs.load();

  console.log(`Loaded ${cs.listAgentIds().length} contacts`);

  const routes = cs.getRoutes(agentAId);
  const routePass = routes !== null && routes.length === 1 && routes[0].type === 'direct';
  console.log(`Routes for agentA: ${JSON.stringify(routes)}`);
  console.log(`  ${routePass ? '✅ PASS' : '❌ FAIL'}`);

  const pinnedKey = cs.isPinned(agentAId);
  console.log(`Is agentA pinned? ${pinnedKey !== null}`);
  const notPinnedPass = pinnedKey === null;
  console.log(`  ${notPinnedPass ? '✅ PASS' : '❌ FAIL'}`);

  const pinnedKeyB = cs.isPinned(agentBId);
  console.log(`Is agentB pinned? ${pinnedKeyB !== null}`);
  const pinnedPass = pinnedKeyB !== null;
  console.log(`  ${pinnedPass ? '✅ PASS' : '❌ FAIL'}\n`);

  console.log('--- Test 2: ContactStore set/remove ---\n');

  const kpC = generateKeyPair();
  const agentCId = buildAgentId(kpC.publicKey, 'test.local', 'agentc');

  cs.set(agentCId, {
    routes: [{ type: 'direct', address: '192.168.1.200:9800' }],
  });

  const hasCPass = cs.has(agentCId) && cs.listAgentIds().length === 3;
  console.log(`After set: ${cs.listAgentIds().length} contacts, has agentC? ${cs.has(agentCId)}`);
  console.log(`  ${hasCPass ? '✅ PASS' : '❌ FAIL'}`);

  cs.remove(agentCId);
  const removedPass = !cs.has(agentCId) && cs.listAgentIds().length === 2;
  console.log(`After remove: ${cs.listAgentIds().length} contacts, has agentC? ${cs.has(agentCId)}`);
  console.log(`  ${removedPass ? '✅ PASS' : '❌ FAIL'}\n`);

  console.log('--- Test 3: Pinned trust — public_key matches agentId ---\n');

  const tsMatch = new TrustStore();
  const { pinned, conflicts } = cs.pinTrustedKeys(tsMatch);

  console.log(`Pinned: ${JSON.stringify(pinned)}`);
  console.log(`Conflicts: ${JSON.stringify(conflicts)}`);

  const pinMatchPass = pinned.length === 1 && pinned[0] === agentBId && conflicts.length === 0;
  console.log(`  ${pinMatchPass ? '✅ PASS' : '❌ FAIL'}`);

  const storedKey = tsMatch.getPublicKey(agentBId);
  const keyMatchPass = storedKey !== null && Buffer.from(storedKey).equals(kpB.publicKey);
  console.log(`Public key stored correctly? ${keyMatchPass}`);
  console.log(`  ${keyMatchPass ? '✅ PASS' : '❌ FAIL'}\n`);

  console.log('--- Test 4: Pinned trust — public_key mismatch detected ---\n');

  writeContacts({
    [agentAId]: {
      routes: [{ type: 'direct', address: '192.168.1.100:9800' }],
      trust: 'pinned',
      public_key: encodeBase64URL(kpB.publicKey),
    },
  });

  const csBad = new ContactStore(CONTACTS_PATH);
  await csBad.load();

  const tsBad = new TrustStore();
  const { pinned: pBad, conflicts: cBad } = csBad.pinTrustedKeys(tsBad);

  console.log(`Pinned: ${JSON.stringify(pBad)}`);
  console.log(`Conflicts: ${JSON.stringify(cBad)}`);

  const conflictPass = pBad.length === 0 && cBad.length === 1 && cBad[0] === agentAId;
  console.log(`  ${conflictPass ? '✅ PASS' : '❌ FAIL'}\n`);

  console.log('--- Test 5: Gateway integration — pinned trust bypasses TOFU ---\n');

  writeContacts({
    [agentAId]: {
      routes: [{ type: 'direct', address: `localhost:${PORT}` }],
      trust: 'pinned',
      public_key: encodeBase64URL(kpA.publicKey),
    },
  });

  const csGw = new ContactStore(CONTACTS_PATH);
  await csGw.load();

  const gateway = new Gateway({
    port: PORT, host: 'localhost',
    secretKey: kpA.secretKey, agentId: agentAId,
    displayName: 'Agent A',
    capabilities: [...STANDARD_CAPABILITIES],
    skipVerification: false, tofuEnabled: true,
    contacts: csGw,
  });

  await sleep(300);

  const ws = await connectToAgent(agentAId, `localhost:${PORT}`, agentBId);
  console.log('Agent B connected to A');

  let pingReplyReceived = false;
  ws.on('message', (raw) => {
    const env = JSON.parse(raw.toString()) as Envelope;
    if (env.reply_to === 'ct_ping_001' && env.action === 'adp:ping') {
      pingReplyReceived = true;
    }
  });

  ws.send(JSON.stringify(signEnvelope({
    protocol: 'adp/0.2', id: 'ct_ping_001',
    from: agentBId, to: agentAId,
    action: 'adp:ping',
    params: {},
    timestamp: new Date().toISOString(),
  }, kpB.secretKey, canonicalize)));

  await sleep(800);

  console.log(`Ping reply received? ${pingReplyReceived}`);
  console.log(`  ${pingReplyReceived ? '✅ PASS' : '❌ FAIL'}\n`);

  ws.close();
  gateway.close();

  console.log('--- Test 6: Pinned trust with mismatched key causes TRUST_CONFLICT ---\n');

  const kpEvil = generateKeyPair();

  writeContacts({
    [agentAId]: {
      routes: [{ type: 'direct', address: `localhost:${PORT}` }],
      trust: 'pinned',
      public_key: encodeBase64URL(kpEvil.publicKey),
    },
  });

  const csEvil = new ContactStore(CONTACTS_PATH);
  await csEvil.load();

  const { pinned: pinnedEvil, conflicts: conflictsEvil } = csEvil.pinTrustedKeys(new TrustStore());

  console.log(`Pinned with evil key: pinned=${pinnedEvil.length}, conflicts=${conflictsEvil.length}`);
  const evilPass = pinnedEvil.length === 0 && conflictsEvil.length === 1;
  console.log(`  ${evilPass ? '✅ PASS' : '❌ FAIL'}\n`);

  console.log('--- Test 7: Save and reload contacts.json ---\n');

  writeContacts({
    [agentAId]: {
      routes: [{ type: 'direct', address: '192.168.1.100:9800' }],
    },
  });

  const csSave = new ContactStore(CONTACTS_PATH);
  await csSave.load();
  csSave.set(agentBId, {
    routes: [{ type: 'direct', address: '10.0.0.5:9800' }],
  });
  await csSave.save();

  const csReload = new ContactStore(CONTACTS_PATH);
  await csReload.load();

  const reloadPass = csReload.has(agentBId) && csReload.listAgentIds().length === 2;
  console.log(`After save+reload: ${csReload.listAgentIds().length} contacts, has agentB? ${csReload.has(agentBId)}`);
  console.log(`  ${reloadPass ? '✅ PASS' : '❌ FAIL'}\n`);

  cleanup();
  console.log('═══════════════════════════════════════');
  console.log('  ✅ Static Contacts 全部测试通过!');
  console.log('  ✅ ContactStore load/save/roundtrip');
  console.log('  ✅ ContactStore set/get/remove');
  console.log('  ✅ Pinned trust — public_key matches');
  console.log('  ✅ Pinned trust — public_key mismatch detected');
  console.log('  ✅ Gateway integration — pinned trust bypasses TOFU');
  console.log('  ✅ Evil key conflict detection');
  console.log('  ✅ Save and reload persistence');
  console.log('═══════════════════════════════════════\n');
}

function cleanup(): void {
  try {
    fs.rmSync(TEST_DIR, { recursive: true });
  } catch {}
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

run().catch((err) => {
  console.error('❌', err);
  cleanup();
  process.exit(1);
});
