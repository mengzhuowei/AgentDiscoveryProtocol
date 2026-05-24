#!/usr/bin/env node
/**
 * Hermes Agent 接入 ADP 网络的完整示例
 *
 * 运行方式:
 *   npx ts-node skill/example-hermes-agent.ts
 *
 * 这个示例展示了:
 * 1. 启动一个 Hermes Agent 并暴露自己的能力
 * 2. 发现网络中的其他 Agent
 * 3. 调用其他 Agent 的能力
 */

import { QuickAdpClient, quickCall } from './hermes-skill';

// ============================================================================
// 示例 1: 启动一个 Hermes Agent 并暴露能力
// ============================================================================

async function runAsServer() {
  const agent = new QuickAdpClient({
    name: 'hermes-server',
    displayName: 'Hermes Demo Server',
    // 声明本 Agent 支持的能力
    capabilities: [
      'adp:ping',
      'adp:capability.query',
      {
        capability: 'custom:echo',
        description: '回显收到的消息',
        input_schema: {
          type: 'object',
          properties: {
            message: { type: 'string', description: '要回显的消息' },
          },
          required: ['message'],
        },
      },
      {
        capability: 'custom:calculate',
        description: '简单数学计算',
        input_schema: {
          type: 'object',
          properties: {
            expression: { type: 'string', description: '数学表达式，如 "1 + 2"' },
          },
          required: ['expression'],
        },
      },
    ],
    // 处理收到的能力调用请求
    handlers: {
      'custom:echo': async (msg, reply) => {
        const message = msg.params.message as string;
        console.log(`[Server] 收到 echo 请求: "${message}" from ${msg.from}`);
        reply({
          echoed: message,
          timestamp: new Date().toISOString(),
        });
      },

      'custom:calculate': async (msg, reply) => {
        const expression = msg.params.expression as string;
        console.log(`[Server] 收到计算请求: "${expression}" from ${msg.from}`);
        try {
          // 注意：eval 有安全风险，生产环境请用安全计算库
          const result = eval(expression);
          reply({ result, expression });
        } catch (err) {
          reply({ error: 'Invalid expression', expression });
        }
      },
    },
    // 可选：连接 Registry 跨网络发现
    // registryUrl: 'http://localhost:3000',
  });

  await agent.start();

  console.log('\n========================================');
  console.log('Hermes Agent 已启动');
  console.log(`Agent ID: ${agent.agentId}`);
  console.log('按 Ctrl+C 停止\n');

  // 每 10 秒打印一次已发现的 peers
  const interval = setInterval(async () => {
    const peers = agent.peerList;
    if (peers.length > 0) {
      console.log(`[Discovery] 已发现 ${peers.length} 个 peers:`);
      peers.forEach((p) => {
        console.log(`  - ${p.displayName || 'Unknown'} (${p.agentId.slice(0, 40)}...) @ ${p.address}`);
      });
    }
  }, 10000);

  process.on('SIGINT', async () => {
    clearInterval(interval);
    await agent.stop();
    process.exit(0);
  });
}

// ============================================================================
// 示例 2: 发现并调用其他 Agent
// ============================================================================

async function runAsClient() {
  const client = new QuickAdpClient({
    name: 'hermes-client',
    displayName: 'Hermes Demo Client',
    capabilities: ['adp:ping', 'adp:capability.query'],
  });

  await client.start();

  console.log('\n[Client] 等待 5 秒发现网络中的 peers...');
  const peers = await client.discover(5000);

  if (peers.length === 0) {
    console.log('[Client] 没有发现任何 peer，请确保网络中有其他 ADP Agent 在运行。');
    console.log('[Client] 可以尝试在另一个终端启动: npm start agent1');
    await client.stop();
    return;
  }

  console.log(`[Client] 发现了 ${peers.length} 个 peers:`);
  peers.forEach((p) => {
    console.log(`  - ${p.displayName || 'Unknown'} @ ${p.address}`);
  });

  const target = peers[0];
  console.log(`\n[Client] 尝试调用 ${target.displayName || target.agentId.slice(0, 40)}...`);

  // 1. Ping
  const pingResult = await client.ping(target.agentId);
  console.log('[Client] Ping 结果:', pingResult);

  // 2. 查询能力
  const manifest = await client.queryCapabilities(target.agentId);
  console.log('[Client] 对方能力:', manifest?.capabilities || manifest);

  // 3. 调用 custom:echo（如果对方支持）
  try {
    const echoResult = await client.call(target.agentId, 'custom:echo', {
      message: 'Hello from Hermes!',
    });
    console.log('[Client] Echo 结果:', echoResult);
  } catch (err) {
    console.log('[Client] Echo 调用失败:', (err as Error).message);
  }

  await client.stop();
  process.exit(0);
}

// ============================================================================
// 示例 3: 一次性调用（不启动服务）
// ============================================================================

async function runQuickCall() {
  const targetAddress = process.env.TARGET_ADDRESS || 'localhost:9900';
  const targetAgentId = process.env.TARGET_AGENT_ID;

  if (!targetAgentId) {
    console.log('请设置 TARGET_AGENT_ID 环境变量');
    console.log('示例: TARGET_AGENT_ID=adp://xxx@local/hermes-server npx ts-node skill/example-hermes-agent.ts quick');
    process.exit(1);
  }

  console.log(`[QuickCall] 发送 ping 到 ${targetAddress}...`);
  const result = await quickCall(targetAddress, targetAgentId, 'adp:ping', {}, {
    name: 'hermes-quick',
    timeoutMs: 5000,
  });
  console.log('[QuickCall] 响应:', result);
}

// ============================================================================
// 主入口
// ============================================================================

const mode = process.argv[2] || 'server';

if (mode === 'server') {
  runAsServer();
} else if (mode === 'client') {
  runAsClient();
} else if (mode === 'quick') {
  runQuickCall();
} else {
  console.log('用法: npx ts-node skill/example-hermes-agent.ts [server|client|quick]');
  process.exit(1);
}
