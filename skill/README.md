# Hermes / OpenClaw ADP Skill

让 **没有 MCP Client** 的 Agent（如 Hermes Agent）直接接入 ADP 网络的轻量级封装。

## 为什么需要这个 Skill？

| 问题 | 说明 |
|------|------|
| MCP Server 需要 stdio | ADP 的 `start-mcp.ts` 通过 stdin/stdout 通信，要求 Host 主动发起 `initialize` 请求 |
| Hermes 只能被动响应 | Hermes Agent 没有内置 MCP Client，无法主动发起 MCP 会话 |
| **解决方案** | **绕过 MCP，直接使用 ADP 原生 WebSocket 协议** |

这个 Skill 封装了所有复杂的密码学和协议细节，提供 5 分钟上手的 API。

---

## 核心概念（30 秒理解）

```
Hermes Agent (你的 Agent)
    ↓ WebSocket
ADP Gateway (监听某个端口)
    ↓ WebSocket / mDNS / Registry / Relay
其他 ADP Agent
```

- **Agent ID**: 你的身份，格式 `adp://公钥@命名空间/名称`，持有私钥即拥有身份
- **Envelope**: ADP 的消息格式，每条消息都要 Ed25519 签名
- **Gateway**: 你的 WebSocket 服务端，其他 Agent 连进来与你通信
- **Discovery**: 自动在局域网发现其他 Agent（mDNS）
- **Registry**: 可选的中央目录，用于跨网络发现
- **Relay**: 可选的中继，用于 NAT 穿透

---

## 快速开始

### 1. 启动一个 Agent 并暴露能力

```typescript
import { QuickAdpClient } from './hermes-skill';

const agent = new QuickAdpClient({
  name: 'hermes-analyzer',
  displayName: 'Hermes Text Analyzer',
  capabilities: [
    'adp:ping',
    'adp:capability.query',
    {
      capability: 'custom:text.analyze',
      description: '分析文本情感、关键词提取',
      input_schema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '要分析的文本' }
        },
        required: ['text']
      }
    }
  ],
  handlers: {
    'custom:text.analyze': async (msg, reply) => {
      const text = msg.params.text as string;
      // ... 你的分析逻辑 ...
      reply({
        sentiment: 'positive',
        keywords: ['AI', 'agent'],
        word_count: text.length
      });
    }
  }
});

await agent.start();
console.log(`Agent ID: ${agent.agentId}`);
```

### 2. 发现网络中的其他 Agent

```typescript
// 等待局域网 mDNS 发现
const peers = await agent.discover(5000);
console.log(peers);
// [
//   { agentId: 'adp://xxx@local/openclaw', displayName: 'OpenClaw AI', address: '192.168.1.5:9900' }
// ]
```

### 3. 调用其他 Agent 的能力

```typescript
const peerId = 'adp://xxxxx@local/openclaw';

// Ping 检查连通性
const ping = await agent.ping(peerId);
console.log(ping); // { success: true, uptime: 120 }

// 查询对方能力
const manifest = await agent.queryCapabilities(peerId);
console.log(manifest.capabilities);

// 调用对方能力
const result = await agent.call(peerId, 'custom:video.generate', {
  prompt: '一只猫在草地上追逐蝴蝶',
  duration: 10,
  style: 'cartoon'
});
console.log(result.video_url);
```

### 4. 使用 Registry 跨网络发现

```typescript
const agent = new QuickAdpClient({
  name: 'hermes-agent',
  capabilities: ['custom:analyze'],
  registryUrl: 'http://192.168.1.100:3000',
  handlers: { ... }
});

await agent.start();

// 会自动注册到 Registry，也能从 Registry 发现其他 Agent
const peers = await agent.discover();
```

### 5. 一次性调用（无需启动服务）

如果你只是临时想调用某个 Agent，不需要启动本地 Gateway：

```typescript
import { quickCall } from './hermes-skill';

const result = await quickCall(
  'localhost:9900',           // 目标地址
  'adp://xxx@local/openclaw', // 目标 Agent ID
  'adp:ping',                  // 动作
  {}                           // 参数
);
```

---

## 与 OpenClaw 集成

### 方式 A：OpenClaw 原生 MCP 方式（推荐）

OpenClaw **内置 MCP Client**，可以直接配置 ADP MCP Server：

```json
{
  "mcp": {
    "adp": {
      "command": "npx",
      "args": ["ts-node", "/path/to/AgentDiscoveryProtocol/start-mcp.ts", "agent1"]
    }
  }
}
```

配置后 OpenClaw 可直接调用 Tools：
- `adp_list_peers` — 列出 ADP 网络中的 Agent
- `adp_ping` — Ping 指定 Agent
- `adp_query_capabilities` — 查询 Agent 能力
- `adp_get_agent_info` — 获取自身信息

### 方式 B：绕过 MCP，直接嵌入代码（高级）

如果 OpenClaw 插件系统允许执行自定义代码，可以用本 Skill 获得更灵活的控制：

```typescript
// tools/adp-caller.ts
import { QuickAdpClient } from '../skill/hermes-skill';

let client: QuickAdpClient | null = null;

export async function ensureAdpClient() {
  if (!client) {
    client = new QuickAdpClient({
      name: 'openclaw-adp-bridge',
      displayName: 'OpenClaw ADP Bridge',
      capabilities: ['adp:ping'],
    });
    await client.start();
  }
  return client;
}

export async function callAdpAgent(agentId: string, action: string, params: any) {
  const c = await ensureAdpClient();
  return c.call(agentId, action, params);
}

export async function listAdpPeers() {
  const c = await ensureAdpClient();
  return c.discover(3000);
}
```

---

## 常见问题

**Q: 我需要理解 MCP 协议吗？**
A: 不需要。这个 Skill 完全绕过 MCP，使用 ADP 原生 WebSocket 通信。

**Q: 需要配置 MCP Server 吗？**
A: 不需要 `start-mcp.ts`。直接用 `QuickAdpClient`，它会启动一个 Gateway。

**Q: 如何与 ADP MCP Server（start-mcp.ts）通信？**
A: 你无法直接与 `start-mcp.ts` 通信（因为它是 stdio MCP Server，需要 MCP Client）。
   但 ADP 网络中的其他 Agent 会同时运行 Gateway 和 MCP Server，你可以通过 Gateway 与它们通信。

**Q: Agent ID 是怎么生成的？**
A: 第一次启动时自动生成 Ed25519 密钥对，保存在 `.adp/keys/` 目录。Agent ID = `adp://base64(公钥)@namespace/name`。

**Q: 消息安全吗？**
A: 所有消息都有 Ed25519 签名，Gateway 默认验证签名。首次通信使用 TOFU（首次使用时信任）模式。

---

## API 参考

### `QuickAdpClient`

| 方法 | 说明 |
|------|------|
| `start()` | 启动 Agent（生成身份、启动 Gateway、连接 Registry/Relay、开始发现） |
| `stop()` | 关闭所有连接 |
| `discover(timeoutMs?)` | 发现网络中的 peers |
| `call(agentId, action, params?, timeoutMs?)` | 调用指定 Agent 的能力 |
| `ping(agentId, timeoutMs?)` | Ping 指定 Agent |
| `queryCapabilities(agentId, timeoutMs?)` | 查询指定 Agent 的 manifest |
| `agentId` | 本 Agent 的 ID |
| `peerList` | 当前已发现的 peers 列表 |

### `quickCall(targetAddress, targetAgentId, action, params?, options?)`

一次性发送消息，不启动本地服务。
