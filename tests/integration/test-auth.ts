import http from 'http';
import { generateKeyPair, encodeBase64URL, sign } from '../../src/crypto';
import { buildAgentId } from '../../src/agent-id';
import { canonicalize } from '../../src/canonical';

const REGISTRY_URL = process.env.ADP_REGISTRY || 'http://localhost:3000';
const TEST_TOKEN = 'adp-test-token-' + Date.now();

const kpA = generateKeyPair();
const agentAId = buildAgentId(kpA.publicKey, 'test.local', 'agenta');

function httpRequest(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, REGISTRY_URL);
    const bodyStr = body ? JSON.stringify(body) : undefined;

    const reqHeaders: Record<string, string | number> = {
      'Content-Type': 'application/json',
    };
    if (bodyStr) {
      reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr);
    }
    if (headers) {
      Object.assign(reqHeaders, headers);
    }

    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: reqHeaders,
      timeout: 5000,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode || 0, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode || 0, body: data });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function signPayload(payload: Record<string, unknown>, secretKey: Uint8Array): string {
  const canonical = canonicalize(payload);
  const msgBytes = new TextEncoder().encode(canonical);
  const sig = sign(secretKey, msgBytes);
  return encodeBase64URL(sig);
}

async function run() {
  console.log('═══════════════════════════════════════');
  console.log('  ADP — Registry Token + 签名认证测试');
  console.log('═══════════════════════════════════════');
  console.log(`  Registry: ${REGISTRY_URL}`);
  console.log('  (Requires MySQL + Redis + token.enabled=true)');
  console.log('  Set ADP_REGISTRY env var to override.\n');

  const health = await httpRequest('GET', '/health').catch(() => ({ status: 0, body: 'unreachable' }));
  if (health.status !== 200) {
    console.log('❌ Registry not reachable. Please start: npm run registry\n');
    console.log('   Update config.json: "token": { "enabled": true, "tokens": { "' + TEST_TOKEN + '": {} } }\n');
    process.exit(1);
  }
  console.log('✅ Registry reachable\n');

  const body = {
    agent_id: agentAId,
    manifest: {
      agent_id: agentAId,
      protocol: 'adp/0.2',
      display_name: 'Test Agent',
      capabilities: ['adp:ping'],
    },
    routes: [{ type: 'direct', address: '10.0.0.1:9800' }],
  };

  let passCount = 0;

  console.log('--- Test 1: POST without token (expect 401) ---\n');
  const r1 = await httpRequest('POST', '/v1/agents', body);
  console.log(`Status: ${r1.status}`);
  const t1Passed = r1.status === 401;
  console.log(`  ${t1Passed ? '✅ PASS' : '❌ FAIL — expected 401'}\n`);
  if (t1Passed) passCount++;

  console.log('--- Test 2: POST with invalid token (expect 401) ---\n');
  const r2 = await httpRequest('POST', '/v1/agents', body, {
    'Authorization': 'Bearer invalid-token-xyz',
  });
  console.log(`Status: ${r2.status}`);
  const t2Passed = r2.status === 401;
  console.log(`  ${t2Passed ? '✅ PASS' : '❌ FAIL — expected 401'}\n`);
  if (t2Passed) passCount++;

  console.log('--- Test 3: POST with valid token (token passes, DB may fail) ---\n');
  const r3 = await httpRequest('POST', '/v1/agents', body, {
    'Authorization': `Bearer ${TEST_TOKEN}`,
  });
  console.log(`Status: ${r3.status}`);
  const t3Passed = r3.status !== 401;
  console.log(`  ${t3Passed ? '✅ PASS — token accepted' : '❌ FAIL — token rejected'}\n`);
  if (t3Passed) passCount++;

  console.log('--- Test 4: POST with valid token + valid X-ADP-Signature ---\n');
  const timestamp = new Date().toISOString();
  const signedPayload = {
    agent_id: agentAId,
    manifest: body.manifest,
    routes: body.routes,
    timestamp,
  };
  const sig4 = signPayload(signedPayload, kpA.secretKey);
  const r4 = await httpRequest('POST', '/v1/agents', body, {
    'Authorization': `Bearer ${TEST_TOKEN}`,
    'X-ADP-Signature': sig4,
    'X-ADP-Timestamp': timestamp,
  });
  console.log(`Status: ${r4.status} ${JSON.stringify(r4.body).slice(0, 120)}`);
  const t4Passed = r4.status !== 401;
  console.log(`  ${t4Passed ? '✅ PASS — signature accepted' : '❌ FAIL — signature rejected'}\n`);
  if (t4Passed) passCount++;

  console.log('--- Test 5: POST with valid token + invalid X-ADP-Signature (expect 401) ---\n');
  const kpEvil = generateKeyPair();
  const sigEvil = signPayload(signedPayload, kpEvil.secretKey);
  const r5 = await httpRequest('POST', '/v1/agents', body, {
    'Authorization': `Bearer ${TEST_TOKEN}`,
    'X-ADP-Signature': sigEvil,
    'X-ADP-Timestamp': timestamp,
  });
  console.log(`Status: ${r5.status} ${JSON.stringify(r5.body)}`);
  const t5Passed = r5.status === 401;
  console.log(`  ${t5Passed ? '✅ PASS' : '❌ FAIL — expected 401'}\n`);
  if (t5Passed) passCount++;

  console.log('--- Test 6: GET without token (expect 200, reads are public) ---\n');
  const r6 = await httpRequest('GET', '/v1/agents');
  console.log(`Status: ${r6.status}`);
  const t6Passed = r6.status === 200;
  console.log(`  ${t6Passed ? '✅ PASS — public read allowed' : '❌ FAIL'}\n`);
  if (t6Passed) passCount++;

  console.log('═══════════════════════════════════════');
  console.log(`  Results: ${passCount}/6 passed`);
  if (passCount === 6) {
    console.log('  ✅ Token + 签名认证全部测试通过!');
    console.log('  ✅ Missing token → 401');
    console.log('  ✅ Invalid token → 401');
    console.log('  ✅ Valid token → accepted');
    console.log('  ✅ Valid signature → accepted');
    console.log('  ✅ Invalid signature → 401');
    console.log('  ✅ Public reads → 200');
  } else {
    console.log('  ❌ 部分测试失败');
  }
  console.log('═══════════════════════════════════════\n');

  process.exit(passCount === 6 ? 0 : 1);
}

run().catch(err => { console.error('❌', err); process.exit(1); });
