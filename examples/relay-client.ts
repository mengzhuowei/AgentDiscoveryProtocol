import { RelayClient, loadOrCreateIdentity, generateMessageId, Envelope } from '../src';

async function main() {
  const { identity } = loadOrCreateIdentity('local', 'relay-client', 'RelayClient');

  const relayUrl = process.env.ADP_RELAY_URL || 'ws://localhost:9700/adp/relay';

  console.log(`
╔══════════════════════════════════════════════════════╗
║           🔄 Relay Client 示例                      ║
╠══════════════════════════════════════════════════════╣
║  Agent ID:  ${identity.agentId.slice(0, 40)}
║  Relay URL: ${relayUrl}
╚══════════════════════════════════════════════════════╝
`);

  const relay = new RelayClient({
    relayUrl,
    agentId: identity.agentId,
    secretKey: identity.secretKey,
  });

  relay.on('connected', () => {
    console.log('✅ 已连接到 Relay 服务器');
  });

  relay.on('disconnected', () => {
    console.log('❌ 已断开与 Relay 服务器的连接');
  });

  relay.on('message', (envelope: Envelope) => {
    console.log(`\n📨 收到消息 from ${envelope.from}`);
    console.log(`   Action: ${envelope.action}`);
    console.log(`   Params:`, JSON.stringify(envelope.params, null, 2));
  });

  relay.on('error', (error: Error) => {
    console.error('❌ Relay 错误:', error.message);
  });

  relay.on('offline_message', (envelope: Envelope) => {
    console.log(`\n📬 收到离线消息 from ${envelope.from}`);
    console.log(`   Action: ${envelope.action}`);
    console.log(`   Timestamp: ${envelope.timestamp}`);
  });

  try {
    console.log('🔗 正在连接到 Relay 服务器...\n');
    await relay.connect();
    console.log('✅ 连接成功!\n');

    await relay.registerAddress({
      displayName: 'Relay Client Demo',
      capabilities: ['adp:ping', 'adp:capability.query'],
    });
    console.log('✅ 地址已注册到 Relay\n');

    console.log('📋 可用命令:');
    console.log('   1. send <agent_id> <message> - 发送消息');
    console.log('   2. ping <agent_id>          - Ping 指定的 Agent');
    console.log('   3. list                     - 列出连接的 Agent');
    console.log('   4. quit                    - 退出\n');

    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const askCommand = () => {
      rl.question('> ', async (input) => {
        const [cmd, ...args] = input.trim().split(/\s+/);

        switch (cmd) {
          case 'send': {
            const [targetId, ...msgParts] = args;
            if (!targetId) {
              console.log('用法: send <agent_id> <message>');
              break;
            }
            const message = msgParts.join(' ');
            const envelope = {
              protocol: 'adp/0.2',
              id: generateMessageId(),
              from: identity.agentId,
              to: targetId,
              action: 'adp:info',
              params: { message },
              timestamp: new Date().toISOString(),
            };
            try {
              await relay.sendMessage(targetId, envelope);
              console.log(`✅ 消息已发送到 ${targetId}`);
            } catch (err) {
              console.error('❌ 发送失败:', err);
            }
            break;
          }

          case 'ping': {
            const targetId = args[0];
            if (!targetId) {
              console.log('用法: ping <agent_id>');
              break;
            }
            const envelope = {
              protocol: 'adp/0.2',
              id: generateMessageId(),
              from: identity.agentId,
              to: targetId,
              action: 'adp:ping',
              params: {},
              timestamp: new Date().toISOString(),
            };
            try {
              await relay.sendMessage(targetId, envelope);
              console.log(`✅ Ping 已发送到 ${targetId}`);
            } catch (err) {
              console.error('❌ Ping 失败:', err);
            }
            break;
          }

          case 'list': {
            const agents = relay.getConnectedAgents();
            if (agents.length === 0) {
              console.log('暂无连接的 Agent');
            } else {
              console.log('已连接的 Agent:');
              agents.forEach((agent) => {
                console.log(`   - ${agent}`);
              });
            }
            break;
          }

          case 'quit':
          case 'exit': {
            console.log('👋 正在断开连接...');
            relay.disconnect();
            rl.close();
            return;
          }

          default:
            console.log('未知命令. 可用命令: send, ping, list, quit');
        }

        askCommand();
      });
    };

    askCommand();

  } catch (error) {
    console.error('❌ 连接失败:', error);
    console.log('\n💡 请确保:');
    console.log('   1. Relay 服务器正在运行 (npm run relay)');
    console.log('   2. 或设置 ADP_RELAY_URL 环境变量');
    process.exit(1);
  }
}

main().catch(console.error);