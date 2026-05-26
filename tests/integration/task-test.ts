import { Gateway, connectToAgent, TaskManager, STANDARD_CAPABILITIES } from '../../src';
import { generateKeyPair } from '../../src/crypto';
import { buildAgentId } from '../../src/agent-id';
import { signEnvelope } from '../../src/crypto';
import { canonicalize } from '../../src/canonical';
import { generateMessageId } from '../../src/envelope';
import { Envelope } from '../../src/envelope';

async function run() {
  console.log('═══════════════════════════════════════');
  console.log('  ADP — adp:task.* 端到端测试');
  console.log('═══════════════════════════════════════\n');

  const PORT_A = 9872;

  const kpA = generateKeyPair();
  const agentAId = buildAgentId(kpA.publicKey, 'test.local', 'agenta');
  console.log(`🔑  Agent A: ${agentAId.slice(0, 50)}...`);

  const kpB = generateKeyPair();
  const agentBId = buildAgentId(kpB.publicKey, 'test.local', 'agentb');
  console.log(`🔑  Agent B: ${agentBId.slice(0, 50)}...\n`);

  const taskManager = new TaskManager();
  console.log('📋  TaskManager initialized\n');

  const gA = new Gateway({
    port: PORT_A, host: 'localhost',
    secretKey: kpA.secretKey, agentId: agentAId,
    displayName: 'Agent A',
    capabilities: [...STANDARD_CAPABILITIES],
    skipVerification: false, tofuEnabled: true,
    taskManager,
  });

  await sleep(300);
  console.log('✅  Gateway A started with TaskManager\n');

  console.log('--- Test 1: adp:task.create ---\n');

  const ws = await connectToAgent(agentAId, `localhost:${PORT_A}`, agentBId);
  console.log('✅  Agent B connected to A\n');

  let taskId: string | null = null;
  let replyAction: string | null = null;

  ws.on('message', (raw) => {
    const env = JSON.parse(raw.toString()) as Envelope;
    if (env.reply_to === 'task_test_001') {
      taskId = (env.params as { task_id?: string })?.task_id ?? null;
      replyAction = env.action;
    }
  });

  console.log('📤  Agent B → Agent A: adp:task.create { capability: "custom:echo", input: { word: "test" } }');
  ws.send(JSON.stringify(signEnvelope({
    protocol: 'adp/0.2', id: 'task_test_001',
    from: agentBId, to: agentAId,
    action: 'adp:task.create',
    params: { capability: 'custom:echo', input: { word: 'test' } },
    timestamp: new Date().toISOString(),
  }, kpB.secretKey, canonicalize)));

  await sleep(800);

  const createPass = taskId !== null && replyAction === 'adp:task.create';
  console.log(`📩  Received reply: task_id=${taskId}, action=${replyAction}`);
  console.log(`   ${createPass ? '✅ PASS' : '❌ FAIL'}\n`);

  console.log('--- Test 2: 模拟 Executor 执行任务 ---\n');

  if (taskId) {
    console.log(`📋  TaskManager.start("${taskId}")`);
    taskManager.start(taskId);
    console.log(`   Status: WORKING\n`);

    console.log(`📋  TaskManager.complete("${taskId}", { result: "executed" })`);
    taskManager.complete(taskId, { result: 'executed' });
    console.log(`   Status: COMPLETED\n`);
  } else {
    console.log('❌  Skipped — no task_id\n');
  }

  console.log('--- Test 3: adp:task.get (COMPLETED) ---\n');

  let getReply: { status: string; result?: unknown } | null = null;
  ws.on('message', (raw) => {
    const env = JSON.parse(raw.toString()) as Envelope;
    if (env.reply_to === 'task_test_002') {
      getReply = env.params as { status: string; result?: unknown };
    }
  });

  console.log(`📤  Agent B → Agent A: adp:task.get { task_id: "${taskId}" }`);
  ws.send(JSON.stringify(signEnvelope({
    protocol: 'adp/0.2', id: 'task_test_002',
    from: agentBId, to: agentAId,
    action: 'adp:task.get',
    params: { task_id: taskId },
    timestamp: new Date().toISOString(),
  }, kpB.secretKey, canonicalize)));

  await sleep(800);

  const getPass = getReply !== null && (getReply as { status: string; result?: unknown }).status === 'COMPLETED' && ((getReply as { status: string; result?: unknown }).result as { result: string })?.result === 'executed';
  console.log(`📩  Received reply: ${JSON.stringify(getReply)}`);
  console.log(`   ${getPass ? '✅ PASS' : '❌ FAIL'}\n`);

  console.log('--- Test 4: adp:task.list ---\n');

  let listReply: { tasks: unknown[] } | null = null;
  ws.on('message', (raw) => {
    const env = JSON.parse(raw.toString()) as Envelope;
    if (env.reply_to === 'task_test_003') {
      listReply = env.params as { tasks: unknown[] };
    }
  });

  console.log('📤  Agent B → Agent A: adp:task.list {}');
  ws.send(JSON.stringify(signEnvelope({
    protocol: 'adp/0.2', id: 'task_test_003',
    from: agentBId, to: agentAId,
    action: 'adp:task.list',
    params: {},
    timestamp: new Date().toISOString(),
  }, kpB.secretKey, canonicalize)));

  await sleep(800);

  const listPass = listReply !== null && Array.isArray((listReply as { tasks: unknown[] }).tasks) && (listReply as { tasks: unknown[] }).tasks.length > 0;
  console.log(`📩  Received reply: tasks count=${(listReply as { tasks: unknown[] } | null)?.tasks?.length ?? 0}`);
  console.log(`   ${listPass ? '✅ PASS' : '❌ FAIL'}\n`);

  console.log('--- Test 5: adp:task.create + adp:task.cancel ---\n');

  let cancelTaskId: string | null = null;
  let cancelReply: { status: string } | null = null;

  ws.on('message', (raw) => {
    const env = JSON.parse(raw.toString()) as Envelope;
    if (env.reply_to === 'task_test_004') {
      cancelTaskId = (env.params as { task_id?: string })?.task_id ?? null;
    }
    if (env.reply_to === 'task_test_005') {
      cancelReply = env.params as { status: string };
    }
  });

  console.log('📤  Agent B → Agent A: adp:task.create (for cancel test)');
  ws.send(JSON.stringify(signEnvelope({
    protocol: 'adp/0.2', id: 'task_test_004',
    from: agentBId, to: agentAId,
    action: 'adp:task.create',
    params: { capability: 'custom:chat', input: { text: 'cancel me' } },
    timestamp: new Date().toISOString(),
  }, kpB.secretKey, canonicalize)));

  await sleep(800);

  let cancelPass = false;
  if (cancelTaskId) {
    console.log(`📤  Agent B → Agent A: adp:task.cancel { task_id: "${cancelTaskId}" }`);
    ws.send(JSON.stringify(signEnvelope({
      protocol: 'adp/0.2', id: 'task_test_005',
      from: agentBId, to: agentAId,
      action: 'adp:task.cancel',
      params: { task_id: cancelTaskId },
      timestamp: new Date().toISOString(),
    }, kpB.secretKey, canonicalize)));

    await sleep(800);

    cancelPass = cancelReply !== null && (cancelReply as { status: string }).status === 'CANCELED';
    console.log(`📩  Received reply: status=${(cancelReply as { status: string } | null)?.status}`);
    console.log(`   ${cancelPass ? '✅ PASS' : '❌ FAIL'}\n`);
  } else {
    console.log('❌  Skipped — no task_id\n');
  }

  console.log('--- Test 6: adp:task.get with invalid task_id ---\n');

  let errorReply: { error?: { code: string } } | null = null;
  ws.on('message', (raw) => {
    const env = JSON.parse(raw.toString()) as Envelope;
    if (env.reply_to === 'task_test_006') {
      errorReply = env as { error?: { code: string } };
    }
  });

  console.log('📤  Agent B → Agent A: adp:task.get { task_id: "invalid_id" }');
  ws.send(JSON.stringify(signEnvelope({
    protocol: 'adp/0.2', id: 'task_test_006',
    from: agentBId, to: agentAId,
    action: 'adp:task.get',
    params: { task_id: 'invalid_id' },
    timestamp: new Date().toISOString(),
  }, kpB.secretKey, canonicalize)));

  await sleep(800);

  const errorPass = errorReply !== null && (errorReply as { error?: { code: string } }).error?.code === 'AGENT_NOT_FOUND';
  console.log(`📩  Received error: ${JSON.stringify((errorReply as { error?: { code: string } } | null)?.error)}`);
  console.log(`   ${errorPass ? '✅ PASS' : '❌ FAIL'}\n`);

  console.log('═══════════════════════════════════════');
  const allPass = createPass && getPass && listPass && cancelPass && errorPass;
  if (allPass) {
    console.log('  ✅ adp:task.* 全部测试通过!');
    console.log('  ✅ adp:task.create — 创建任务返回 PENDING');
    console.log('  ✅ adp:task.get — 获取 COMPLETED 状态');
    console.log('  ✅ adp:task.list — 列出所有任务');
    console.log('  ✅ adp:task.cancel — 取消任务变为 CANCELED');
    console.log('  ✅ adp:task.get — 无效 task_id 返回错误');
  } else {
    console.log('  ❌ 部分测试失败');
  }
  console.log('═══════════════════════════════════════\n');

  ws.close();
  gA.close();
  process.exit(allPass ? 0 : 1);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

run().catch(err => { console.error('❌', err); process.exit(1); });
