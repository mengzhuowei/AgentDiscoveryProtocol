# ADP 最佳实践

本文档提供 Agent Discovery Protocol (ADP) 的最佳实践指南，帮助开发者构建安全、高效、可靠的 Agent 通信系统。

## 目录

1. [身份管理](#1-身份管理)
2. [连接管理](#2-连接管理)
3. [消息处理](#3-消息处理)
4. [错误处理](#4-错误处理)
5. [安全实践](#5-安全实践)
6. [性能优化](#6-性能优化)
7. [部署建议](#7-部署建议)

---

## 1. 身份管理

### 1.1 密钥存储

```typescript
import { loadOrCreateIdentity } from 'adp-agent';
import * as fs from 'fs';

const { identity, isNew } = loadOrCreateIdentity('myapp', 'my-agent', 'My Agent');

// 如果是新身份，备份私钥
if (isNew) {
  const backupPath = './.adp/identity-backup.json';
  fs.writeFileSync(backupPath, JSON.stringify({
    secretKey: Array.from(identity.secretKey),
    timestamp: new Date().toISOString(),
  }));
  console.log(`⚠️  新身份已创建，备份到 ${backupPath}`);
}
```

### 1.2 身份命名规范

| 格式 | 示例 | 用途 |
|------|------|------|
| `namespace` | `myapp`, `video-service` | 应用/服务级别隔离 |
| `agent-name` | `video-agent`, `chat-bot` | 具体 Agent 标识 |
| `displayName` | `Video Agent`, `Chat Bot` | 人类可读名称 |

**注意**：
- namespace: 小写字母、数字、点号和连字符
- agent-name: 小写字母、数字、下划线和连字符，最多 32 字符

### 1.3 密钥轮换

定期轮换密钥以降低泄露风险：

```typescript
import { rotateKeys, buildRegistryUpdate } from 'adp-agent';

// 检测是否需要轮换密钥（建议每 90 天）
const lastRotation = await getLastRotationTime();
const daysSinceRotation = (Date.now() - lastRotation) / (1000 * 60 * 60 * 24);

if (daysSinceRotation > 90) {
  const rotation = await rotateKeys(identity, {
    reason: 'Scheduled key rotation',
  });

  if (rotation.success) {
    console.log(`✅ 密钥已轮换，新 ID: ${rotation.newAgentId}`);
  }
}
```

---

## 2. 连接管理

### 2.1 健康检查

定期检查 Agent 连接状态：

```typescript
const gateway = new Gateway({
  port: 9900,
  // ...
});

// 定期检查连接
setInterval(() => {
  const manifest = gateway.getManifest();
  console.log(`Agent: ${manifest.display_name}`);
  console.log(`Capabilities: ${manifest.capabilities.length}`);
}, 30000);
```

### 2.2 心跳配置

根据网络环境调整心跳参数：

```typescript
const gateway = new Gateway({
  port: 9900,
  // ... 其他配置

  // 低延迟网络（如本地 LAN）
  heartbeatIntervalMs: 15000,
  heartbeatTimeoutMs: 45000,

  // 高延迟网络（如跨地域）
  heartbeatIntervalMs: 30000,
  heartbeatTimeoutMs: 90000,
});
```

### 2.3 连接池管理

管理多个 Agent 连接时使用连接池：

```typescript
interface ConnectionPool {
  get(agentId: string): WebSocket | null;
  set(agentId: string, ws: WebSocket): void;
  remove(agentId: string): void;
  getAll(): WebSocket[];
}

class AgentConnectionPool implements ConnectionPool {
  private connections = new Map<string, WebSocket>();

  get(agentId: string): WebSocket | null {
    const ws = this.connections.get(agentId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      return ws;
    }
    return null;
  }

  set(agentId: string, ws: WebSocket): void {
    ws.on('close', () => this.remove(agentId));
    this.connections.set(agentId, ws);
  }

  remove(agentId: string): void {
    const ws = this.connections.get(agentId);
    if (ws) {
      ws.close();
      this.connections.delete(agentId);
    }
  }

  getAll(): WebSocket[] {
    return Array.from(this.connections.values())
      .filter(ws => ws.readyState === WebSocket.OPEN);
  }
}
```

---

## 3. 消息处理

### 3.1 消息验证

始终验证传入消息：

```typescript
const gateway = new Gateway({
  port: 9900,
  // ...
});

// 自定义验证器
const verifier = new MessageVerifier(trustStore, {
  tofuEnabled: true,
  onNewAgent: (agentId) => {
    console.log(`🔐 新 Agent 需要信任: ${agentId}`);
    // 添加人工确认逻辑
  },
});

const gateway = new Gateway({
  // ...
  verifier,
});
```

### 3.2 消息去重

处理重复消息：

```typescript
const processedMessages = new Set<string>();

gateway.customHandlers = {
  'custom:action': async (ws, envelope) => {
    // 检查是否已处理
    if (processedMessages.has(envelope.id)) {
      console.log(`📧 忽略重复消息: ${envelope.id}`);
      return;
    }

    processedMessages.add(envelope.id);

    // 处理消息
    const result = await processAction(envelope.params);

    // 清理旧记录（保留最近 10000 条）
    if (processedMessages.size > 10000) {
      const oldest = processedMessages.values().next().value;
      processedMessages.delete(oldest);
    }
  },
};
```

### 3.3 异步任务处理

对于长时间运行的任务，使用异步模式：

```typescript
const capabilities: (string | Capability)[] = [
  {
    capability: 'custom:video.generate',
    description: '生成视频（异步）',
    async: true,
    preferredMode: 'webhook',
    input_schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
      },
      required: ['prompt'],
    },
  },
];

gateway.customHandlers = {
  'custom:video.generate': async (ws, envelope) => {
    const taskId = `task_${Date.now().toString(36)}`;

    // 立即返回任务 ID
    const pendingReply = signEnvelope({
      protocol: 'adp/0.2',
      id: generateMessageId(),
      from: agentId,
      to: envelope.from,
      action: 'custom:video.generate',
      params: { task_id: taskId, status: 'PENDING' },
      reply_to: envelope.id,
      timestamp: new Date().toISOString(),
    }, secretKey, canonicalize);
    ws.send(JSON.stringify(pendingReply));

    // 后台处理
    process.nextTick(async () => {
      const result = await generateVideo(envelope.params);

      // 发送完成通知
      const completedReply = signEnvelope({
        protocol: 'adp/0.2',
        id: generateMessageId(),
        from: agentId,
        to: envelope.from,
        action: 'custom:video.generate',
        params: { task_id: taskId, status: 'COMPLETED', result },
        reply_to: envelope.id,
        timestamp: new Date().toISOString(),
      }, secretKey, canonicalize);
      ws.send(JSON.stringify(completedReply));
    });
  },
};
```

---

## 4. 错误处理

### 4.1 错误响应格式

标准化错误响应：

```typescript
async function handleRequest(ws: WebSocket, envelope: Envelope) {
  try {
    const result = await doSomething(envelope.params);
    ws.send(JSON.stringify(result));
  } catch (error) {
    const errorCode = error instanceof ValidationError
      ? 'VALIDATION_ERROR'
      : error instanceof NotFoundError
        ? 'NOT_FOUND'
        : 'INTERNAL_ERROR';

    const errorEnvelope = signEnvelope({
      protocol: 'adp/0.2',
      id: generateMessageId(),
      from: agentId,
      to: envelope.from,
      action: envelope.action,
      params: {},
      error: {
        code: errorCode,
        message: error.message,
        details: error.details,
      },
      reply_to: envelope.id,
      timestamp: new Date().toISOString(),
    }, secretKey, canonicalize);

    ws.send(JSON.stringify(errorEnvelope));
  }
}
```

### 4.2 重试机制

实现指数退避重试：

```typescript
async function sendWithRetry(
  fn: () => Promise<void>,
  maxAttempts = 3,
  baseDelay = 1000
): Promise<void> {
  let lastError: Error;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fn();
      return;
    } catch (error) {
      lastError = error as Error;
      console.log(`Attempt ${attempt} failed: ${lastError.message}`);

      if (attempt < maxAttempts) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        console.log(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError!;
}
```

---

## 5. 安全实践

### 5.1 Trust Store 配置

```typescript
const trustStore = new TrustStore();

// 预置信任列表（生产环境推荐）
trustStore.addTrustedKey('adp://xxx@namespace/agent1', trustedPublicKey1);
trustStore.addTrustedKey('adp://xxx@namespace/agent2', trustedPublicKey2);

// 拒绝列表
trustStore.addToBlacklist(blockedAgentId);

const gateway = new Gateway({
  trustStore,
});
```

### 5.2 签名验证

始终验证消息签名：

```typescript
const gateway = new Gateway({
  port: 9900,
  skipVerification: false,  // 永远不要设为 true
  tofuEnabled: true,         // 首次连接自动信任
});
```

### 5.3 输入验证

验证所有输入参数：

```typescript
import { z } from 'zod';

const VideoGenerateSchema = z.object({
  prompt: z.string().min(1).max(1000),
  duration: z.number().int().min(1).max(60).default(5),
  style: z.enum(['realistic', 'cartoon', 'anime']).default('realistic'),
});

gateway.customHandlers = {
  'custom:video.generate': async (ws, envelope) => {
    const result = VideoGenerateSchema.safeParse(envelope.params);

    if (!result.success) {
      await sendError(ws, envelope, 'VALIDATION_ERROR',
        JSON.stringify(result.error.flatten()));
      return;
    }

    const { prompt, duration, style } = result.data;
    // 处理请求...
  },
};
```

---

## 6. 性能优化

### 6.1 消息大小限制

```typescript
// 设置合理的消息大小限制
const gateway = new Gateway({
  port: 9900,
  // 默认 1MB，对于大多数场景足够
});
```

### 6.2 连接复用

复用 WebSocket 连接：

```typescript
const connectionCache = new Map<string, WebSocket>();

async function getConnection(agentId: string, address: string): Promise<WebSocket> {
  const cached = connectionCache.get(agentId);

  if (cached && cached.readyState === WebSocket.OPEN) {
    return cached;
  }

  const ws = await connectToAgent(agentId, address, localAgentId);
  connectionCache.set(agentId, ws);

  ws.on('close', () => connectionCache.delete(agentId));

  return ws;
}
```

### 6.3 并发控制

限制并发处理数量：

```typescript
import pLimit from 'p-limit';

const limit = pLimit(10); // 最多 10 个并发任务

gateway.customHandlers = {
  'custom:process': async (ws, envelope) => {
    await limit(async () => {
      const result = await heavyProcessing(envelope.params);
      ws.send(JSON.stringify(result));
    });
  },
};
```

---

## 7. 部署建议

### 7.1 环境变量配置

```bash
# .env
ADP_NAMESPACE=production
ADP_NAME=my-agent
ADP_RELAY=ws://relay.example.com:9700/adp/relay
ADP_REGISTRY=http://registry.example.com:9800
PORT=9900
LOG_LEVEL=info
```

### 7.2 Docker 部署

```yaml
# docker-compose.yml
version: '3.8'
services:
  adp-agent:
    build: .
    ports:
      - "9900:9900"
    environment:
      - ADP_NAMESPACE=${ADP_NAMESPACE}
      - ADP_NAME=${ADP_NAME}
      - ADP_RELAY=${ADP_RELAY}
    volumes:
      - ./.adp:/app/.adp
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9900/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

### 7.3 监控指标

暴露 Prometheus 指标：

```typescript
import { register, Counter, Histogram } from 'prom-client';

const messageCounter = new Counter({
  name: 'adp_messages_total',
  help: 'Total number of ADP messages',
  labelNames: ['action', 'direction'],
});

const messageDuration = new Histogram({
  name: 'adp_message_duration_seconds',
  help: 'Message processing duration',
  buckets: [0.1, 0.5, 1, 2, 5],
});

gateway.customHandlers = {
  'custom:action': async (ws, envelope) => {
    const end = messageDuration.startTimer();
    try {
      const result = await processAction(envelope.params);
      messageCounter.inc({ action: envelope.action, direction: 'incoming' });
      ws.send(JSON.stringify(result));
    } finally {
      end();
    }
  },
};
```

---

## 总结

遵循这些最佳实践可以：

| 方面 | 好处 |
|------|------|
| 身份管理 | 安全的密钥存储和轮换机制 |
| 连接管理 | 稳定的连接和快速故障恢复 |
| 消息处理 | 可靠的消息传递和去重 |
| 错误处理 | 优雅的错误处理和用户反馈 |
| 安全实践 | 防止恶意攻击和数据泄露 |
| 性能优化 | 高效的资源利用和响应时间 |
| 部署建议 | 可靠的生产环境部署 |

更多信息请参考：
- [故障排查指南](troubleshooting.md)
- [API 文档](api/README.md)
- [通信方式](communication.md)