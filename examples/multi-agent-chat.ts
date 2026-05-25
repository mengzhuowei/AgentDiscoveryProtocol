import { Gateway, loadOrCreateIdentity, Capability, Route, Envelope, signEnvelope, generateMessageId, WebSocket } from '../src';
import { canonicalize } from '../src/canonical';

const CAPABILITY_SEND_MESSAGE = 'custom:message.send';
const CAPABILITY_BROADCAST = 'custom:message.broadcast';
const CAPABILITY_GET_HISTORY = 'custom:message.history';

interface ChatMessage {
  id: string;
  from: string;
  to?: string;
  content: string;
  timestamp: string;
  type: 'direct' | 'broadcast';
}

interface AgentState {
  gateway: Gateway;
  agentId: string;
  displayName: string;
}

class MultiAgentChat {
  private agents: Map<string, AgentState> = new Map();
  private messageHistory: ChatMessage[] = [];

  async createAgent(name: string, port: number): Promise<AgentState> {
    const { identity } = loadOrCreateIdentity('chat', name, name);

    const capabilities: (string | Capability)[] = [
      'adp:ping',
      'adp:capability.query',
      {
        capability: CAPABILITY_SEND_MESSAGE,
        description: '发送私信',
        input_schema: {
          type: 'object',
          properties: {
            to: { type: 'string', description: '目标 Agent ID' },
            content: { type: 'string', description: '消息内容' },
          },
          required: ['to', 'content'],
        },
      },
      {
        capability: CAPABILITY_BROADCAST,
        description: '广播消息给所有 Agent',
        input_schema: {
          type: 'object',
          properties: {
            content: { type: 'string', description: '广播内容' },
          },
          required: ['content'],
        },
      },
      {
        capability: CAPABILITY_GET_HISTORY,
        description: '获取聊天历史',
        input_schema: {
          type: 'object',
          properties: {
            limit: { type: 'integer', default: 50, description: '返回消息数量' },
          },
        },
      },
    ];

    const gateway = new Gateway({
      port,
      host: '0.0.0.0',
      secretKey: identity.secretKey,
      agentId: identity.agentId,
      displayName: name,
      capabilities,
      routes: [{ type: 'direct', address: `localhost:${port}` }],
      customHandlers: {
        [CAPABILITY_SEND_MESSAGE]: this.createSendMessageHandler(identity.agentId, identity.secretKey),
        [CAPABILITY_BROADCAST]: this.createBroadcastHandler(identity.agentId, identity.secretKey),
        [CAPABILITY_GET_HISTORY]: this.createGetHistoryHandler(identity.agentId, identity.secretKey),
      },
    });

    const state: AgentState = {
      gateway,
      agentId: identity.agentId,
      displayName: name,
    };

    this.agents.set(identity.agentId, state);
    return state;
  }

  private createSendMessageHandler(selfId: string, secretKey: Uint8Array) {
    return async (ws: WebSocket, envelope: Envelope) => {
      const params = envelope.params as { to?: string; content?: string };
      const targetAgent = this.agents.get(params.to!);

      if (!targetAgent) {
        const errorReply = signEnvelope({
          protocol: 'adp/0.2',
          id: generateMessageId(),
          from: selfId,
          to: envelope.from,
          action: CAPABILITY_SEND_MESSAGE,
          params: { error: 'Target agent not found' },
          reply_to: envelope.id,
          timestamp: new Date().toISOString(),
        }, secretKey, canonicalize);
        ws.send(JSON.stringify(errorReply));
        return;
      }

      const message: ChatMessage = {
        id: generateMessageId(),
        from: envelope.from,
        to: params.to,
        content: params.content!,
        timestamp: new Date().toISOString(),
        type: 'direct',
      };
      this.messageHistory.push(message);

      const reply = signEnvelope({
        protocol: 'adp/0.2',
        id: generateMessageId(),
        from: selfId,
        to: envelope.from,
        action: CAPABILITY_SEND_MESSAGE,
        params: {
          status: 'DELIVERED',
          message_id: message.id,
          delivered_at: message.timestamp,
        },
        reply_to: envelope.id,
        timestamp: new Date().toISOString(),
      }, secretKey, canonicalize);
      ws.send(JSON.stringify(reply));

      const targetEnvelope = signEnvelope({
        protocol: 'adp/0.2',
        id: generateMessageId(),
        from: envelope.from,
        to: params.to,
        action: 'custom:message.received',
        params: {
          message_id: message.id,
          from: envelope.from,
          content: params.content,
          timestamp: message.timestamp,
        },
        timestamp: new Date().toISOString(),
      }, secretKey, canonicalize);

      console.log(`\n📨 [${selfId.slice(0, 20)}] 发送私信给 [${params.to!.slice(0, 20)}]`);
      console.log(`   内容: ${params.content}`);
    };
  }

  private createBroadcastHandler(selfId: string, secretKey: Uint8Array) {
    return async (ws: WebSocket, envelope: Envelope) => {
      const params = envelope.params as { content?: string };

      const message: ChatMessage = {
        id: generateMessageId(),
        from: envelope.from,
        content: params.content!,
        timestamp: new Date().toISOString(),
        type: 'broadcast',
      };
      this.messageHistory.push(message);

      const reply = signEnvelope({
        protocol: 'adp/0.2',
        id: generateMessageId(),
        from: selfId,
        to: envelope.from,
        action: CAPABILITY_BROADCAST,
        params: {
          status: 'BROADCASTED',
          message_id: message.id,
          recipients: this.agents.size - 1,
        },
        reply_to: envelope.id,
        timestamp: new Date().toISOString(),
      }, secretKey, canonicalize);
      ws.send(JSON.stringify(reply));

      console.log(`\n📢 [${envelope.from.slice(0, 20)}] 广播消息`);
      console.log(`   内容: ${params.content}`);
      console.log(`   接收者: ${this.agents.size - 1} 个 Agent`);
    };
  }

  private createGetHistoryHandler(selfId: string, secretKey: Uint8Array) {
    return async (ws: WebSocket, envelope: Envelope) => {
      const params = envelope.params as { limit?: number };
      const limit = params.limit || 50;

      const myMessages = this.messageHistory
        .filter((m) => m.from === selfId || m.to === selfId)
        .slice(-limit);

      const reply = signEnvelope({
        protocol: 'adp/0.2',
        id: generateMessageId(),
        from: selfId,
        to: envelope.from,
        action: CAPABILITY_GET_HISTORY,
        params: {
          messages: myMessages,
          total: myMessages.length,
        },
        reply_to: envelope.id,
        timestamp: new Date().toISOString(),
      }, secretKey, canonicalize);
      ws.send(JSON.stringify(reply));
    };
  }

  getAgents(): AgentState[] {
    return Array.from(this.agents.values());
  }

  closeAll(): void {
    for (const agent of this.agents.values()) {
      agent.gateway.close();
    }
    this.agents.clear();
  }

  getHistory(): ChatMessage[] {
    return this.messageHistory;
  }
}

async function main() {
  const chat = new MultiAgentChat();

  console.log(`
╔══════════════════════════════════════════════════════╗
║          💬 Multi-Agent Chat 示例                    ║
╠══════════════════════════════════════════════════════╣
║  创建多个 Agent 进行消息传递测试                      ║
╚══════════════════════════════════════════════════════╝
`);

  const alice = await chat.createAgent('Alice', 9910);
  const bob = await chat.createAgent('Bob', 9911);
  const charlie = await chat.createAgent('Charlie', 9912);

  console.log(`
✅ 已创建 3 个 Agent:

🤵 Alice
   ID: ${alice.agentId.slice(0, 40)}
   WS: ws://localhost:9910/adp

🤵 Bob
   ID: ${bob.agentId.slice(0, 40)}
   WS: ws://localhost:9911/adp

🤵 Charlie
   ID: ${charlie.agentId.slice(0, 40)}
   WS: ws://localhost:9912/adp
`);

  console.log('📋 操作选项:');
  console.log('   1. alice.send    - Alice 发送私信给 Bob');
  console.log('   2. bob.send     - Bob 发送私信给 Charlie');
  console.log('   3. alice.bcast  - Alice 广播消息');
  console.log('   4. history     - 查看聊天历史');
  console.log('   5. agents      - 列出所有 Agent');
  console.log('   6. quit        - 退出\n');

  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const runCommand = async (cmd: string) => {
    switch (cmd) {
      case 'alice.send': {
        const { sendMessage } = await import('../src');
        console.log('\n→ Alice 发送私信给 Bob...');
        await sendMessage(bob.agentId, 'adp:info', { message: '你好 Bob!' }, alice.agentId, alice);
        break;
      }
      case 'bob.send': {
        console.log('\n→ Bob 发送私信给 Charlie...');
        break;
      }
      case 'alice.bcast': {
        console.log('\n→ Alice 广播消息...');
        break;
      }
      case 'history': {
        console.log('\n📜 聊天历史:');
        console.log(JSON.stringify(chat.getHistory(), null, 2));
        break;
      }
      case 'agents': {
        console.log('\n👥 Agent 列表:');
        chat.getAgents().forEach((agent) => {
          console.log(`   - ${agent.displayName}: ${agent.agentId.slice(0, 30)}...`);
        });
        break;
      }
      case 'quit':
      case 'exit': {
        console.log('\n👋 关闭所有 Agent...');
        chat.closeAll();
        rl.close();
        return;
      }
      default:
        console.log('未知命令');
    }
    rl.question('\n> ', runCommand);
  };

  rl.question('> ', runCommand);

  process.on('SIGINT', () => {
    console.log('\n👋 Shutting down...');
    chat.closeAll();
    process.exit(0);
  });
}

main().catch(console.error);