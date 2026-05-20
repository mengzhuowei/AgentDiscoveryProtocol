# 快速入门

**协议版本：** `adp/0.2`

本指南帮助你快速搭建一个最小可用的 ADP Agent。

## 环境要求

- Node.js 18+ 或 Python 3.11+ 或任何支持 Ed25519 和 WebSocket 的语言
- 网络可达性（局域网或公网）

## 步骤一：生成密钥对

```typescript
import { ed25519 } from './crypto';

const keypair = ed25519.generateKeyPair();
// keypair.publicKey: Uint8Array (32 bytes)
// keypair.secretKey: Uint8Array (64 bytes)
```

```python
from nacl.signing import SigningKey

keypair = SigningKey.generate()
# keypair.verify_key: VerifyKey (32 bytes)
# keypair: SigningKey (64 bytes, includes verify key)
```

## 步骤二：构建 Agent ID

将公钥编码为 Base64URL（无填充）：

```typescript
import { encodeBase64URL } from './base64';

const pubkeyB64URL = encodeBase64URL(publicKey);
// 固定 43 字符

const namespace = 'quickstart.local';
const agentName = 'my-agent';
const agentId = `adp://${pubkeyB64URL}@${namespace}/${agentName}`;
// 示例: adp://mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB@quickstart.local/my-agent
```

## 步骤三：构建 Manifest

```json
{
  "protocol": "adp/0.2",
  "agent_id": "adp://mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB@quickstart.local/my-agent",
  "display_name": "My First Agent",
  "description": "A minimal ADP Agent",
  "capabilities": [
    "adp:ping",
    "adp:capability.query",
    "adp:info"
  ],
  "routes": [
    { "type": "direct", "address": "192.168.1.100:9800" }
  ],
  "agent_info": {
    "platform": "node",
    "runtime": "node/22"
  },
  "updated_at": "2026-05-20T10:00:00.000Z"
}
```

## 步骤四：启动 WebSocket 服务

```typescript
import { createServer } from 'ws';

const wss = createServer({ port: 9800, path: '/adp' });

wss.on('connection', async (ws, req) => {
  // 从 URL 提取对方 Agent ID（可选）
  const url = new URL(req.url, 'http://localhost');
  const remoteAgentId = url.searchParams.get('agent_id');

  console.log(`Connection from: ${remoteAgentId}`);

  ws.on('message', async (data) => {
    const envelope = JSON.parse(data.toString());
    await handleMessage(ws, envelope);
  });
});

console.log('ADP Gateway listening on ws://0.0.0.0:9800/adp');
```

## 步骤五：实现消息处理

```typescript
async function handleMessage(ws: WebSocket, envelope: Envelope): Promise<void> {
  // 1. 验证签名
  const valid = await verifySignature(envelope);
  if (!valid) {
    await sendError(ws, envelope, 'INVALID_SIGNATURE');
    return;
  }

  // 2. 检查时间戳新鲜度
  const now = Date.now();
  const ts = new Date(envelope.timestamp).getTime();
  if (Math.abs(now - ts) > 300_000) { // 300 秒
    await sendError(ws, envelope, 'INVALID_PARAMS');
    return;
  }

  // 3. 分发 action
  switch (envelope.action) {
    case 'adp:ping':
      await handlePing(ws, envelope);
      break;
    case 'adp:capability.query':
      await handleCapabilityQuery(ws, envelope);
      break;
    case 'adp:info':
      await handleInfo(ws, envelope);
      break;
    default:
      await sendError(ws, envelope, 'UNKNOWN_ACTION');
  }
}

async function handlePing(ws: WebSocket, envelope: Envelope): Promise<void> {
  const reply = await signEnvelope({
    protocol: 'adp/0.2',
    id: generateMessageId(),
    from: MY_AGENT_ID,
    to: envelope.from,
    reply_to: envelope.id,
    action: 'adp:ping',
    params: { uptime: process.uptime() },
    timestamp: new Date().toISOString()
  });

  ws.send(JSON.stringify(reply));
}
```

## 步骤六：实现签名

```typescript
import { canonicalize } from './canonical-json';
import { sign as ed25519Sign, verify as ed25519Verify } from './ed25519';
import { encodeBase64URL, decodeBase64URL } from './base64';

async function signEnvelope(envelope: object): Promise<Envelope> {
  // 1. 删除 sig 字段（如果存在）
  const { sig, ...unsigned } = envelope;

  // 2. 规范化 JSON
  const canonical = canonicalize(unsigned);

  // 3. Ed25519 签名
  const signatureBytes = ed25519Sign(secretKey, new TextEncoder().encode(canonical));

  // 4. Base64URL 编码
  const sig = encodeBase64URL(signatureBytes);

  return { ...unsigned, sig } as Envelope;
}

async function verifySignature(envelope: Envelope): Promise<boolean> {
  // 1. 提取签名
  const sigBytes = decodeBase64URL(envelope.sig);
  if (sigBytes.length !== 64) return false;

  // 2. 从 from 提取公钥
  const pubkey = extractPublicKeyFromAgentId(envelope.from);

  // 3. 删除 sig 并规范化
  const { sig, ...unsigned } = envelope;
  const canonical = canonicalize(unsigned);

  // 4. 验签
  return ed25519Verify(pubkey, sigBytes, new TextEncoder().encode(canonical));
}

function extractPublicKeyFromAgentId(agentId: string): Uint8Array {
  // 格式: adp://{pubkey_b64url}@namespace/agent_name
  const match = agentId.match(/^adp:\/\/([^@]+)@/);
  if (!match) throw new Error('Invalid Agent ID format');
  return decodeBase64URL(match[1]);
}
```

## 步骤七：mDNS 发现（可选）

```typescript
import { Bonjour, Service } from 'bonjour';

const bonjour = new Bonjour();

const service: Service = {
  name: 'my-adp-agent',
  type: '_adp._tcp',
  port: 9800,
  txt: {
    agent_id: MY_AGENT_ID,
    protocol: 'adp/0.2'
  }
};

const publisher = bonjour.publishService(service);

// 发现其他 Agent
const browser = bonjour.find({ type: '_adp._tcp' });

browser.on('up', (service) => {
  const agentId = service.txt.agent_id;
  const host = service.host;
  const port = service.port;
  console.log(`Discovered: ${agentId} at ${host}:${port}`);
});
```

## 步骤八：连接其他 Agent

```typescript
async function connectToAgent(agentId: string, address: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://${address}/adp?agent_id=${encodeURIComponent(MY_AGENT_ID)}`);

  return new Promise((resolve, reject) => {
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

async function sendPing(ws: WebSocket, targetAgentId: string): Promise<void> {
  const envelope = await signEnvelope({
    protocol: 'adp/0.2',
    id: generateMessageId(),
    from: MY_AGENT_ID,
    to: targetAgentId,
    action: 'adp:ping',
    params: {},
    timestamp: new Date().toISOString()
  });

  ws.send(JSON.stringify(envelope));
}
```

## 目录结构建议

```
my-adp-agent/
├── src/
│   ├── index.ts              # 入口
│   ├── crypto.ts             # Ed25519 密钥和签名
│   ├── base64.ts             # Base64URL 编解码
│   ├── canonical.ts         # ADP Canonical JSON
│   ├── envelope.ts          # 消息封装/解析
│   ├── gateway.ts           # WebSocket 网关
│   ├── discovery.ts         # mDNS 发现
│   ├── trust-store.ts       # 信任存储
│   └── handlers/            # action 处理器
│       ├── ping.ts
│       ├── capability.ts
│       └── info.ts
├── config.json               # Agent 配置
└── package.json
```

## 下一步

- 完整实现检查清单：[`implementation-checklist.md`](implementation-checklist.md)
- 代码示例参考：[`code-examples.md`](code-examples.md)
- 协议规范完整文档：[`README.md`](README.md)
