# ADP 故障排查指南

本文档提供 Agent Discovery Protocol (ADP) 常见问题的诊断和解决方案。

## 目录

1. [连接问题](#1-连接问题)
2. [消息问题](#2-消息问题)
3. [身份问题](#3-身份问题)
4. [发现服务问题](#4-发现服务问题)
5. [中继服务问题](#5-中继服务问题)
6. [安全问题](#6-安全问题)
7. [性能问题](#7-性能问题)
8. [部署问题](#8-部署问题)

---

## 1. 连接问题

### 1.1 Agent 无法连接

**症状**：
```
Error: connect ECONNREFUSED 127.0.0.1:9900
```

**可能原因**：
1. 目标 Agent 未启动
2. 端口被占用
3. 防火墙阻止连接
4. 地址错误

**解决方案**：

```bash
# 检查端口是否监听
lsof -i :9900

# 检查防火墙规则
sudo iptables -L -n | grep 9900

# 验证 Agent 是否运行
curl http://localhost:9900/health
```

**代码检查**：
```typescript
const gateway = new Gateway({
  port: 9900,
  host: '0.0.0.0',  // 确保绑定到正确地址
  // ...
});

// 验证连接
try {
  const ws = await connectToAgent(
    targetAgentId,
    'localhost:9900',
    localAgentId
  );
  console.log('✅ 连接成功');
} catch (error) {
  console.error('❌ 连接失败:', error.message);
}
```

### 1.2 WebSocket 连接断开

**症状**：
```
WebSocket connection closed unexpectedly
Connection timeout
```

**可能原因**：
1. 网络不稳定
2. 心跳间隔太短
3. 服务器负载过高
4. 中间代理超时

**解决方案**：

```typescript
const gateway = new Gateway({
  port: 9900,
  // 调整心跳参数
  heartbeatIntervalMs: 30000,   // 30 秒（适合跨地域）
  heartbeatTimeoutMs: 90000,    // 90 秒无响应超时
});
```

**重连逻辑**：
```typescript
function createReconnectingSocket(url: string, options?: {
  maxRetries?: number;
  retryDelay?: number;
}) {
  let retries = 0;
  const maxRetries = options?.maxRetries ?? 5;
  const retryDelay = options?.retryDelay ?? 1000;

  function connect() {
    const ws = new WebSocket(url);

    ws.on('close', () => {
      if (retries < maxRetries) {
        retries++;
        const delay = retryDelay * Math.pow(2, retries - 1);
        console.log(`重连中... (${retries}/${maxRetries}), ${delay}ms 后`);
        setTimeout(connect, delay);
      } else {
        console.error('重连失败，已达最大重试次数');
      }
    });

    ws.on('open', () => {
      console.log('✅ 连接已恢复');
      retries = 0;
    });

    return ws;
  }

  return connect();
}
```

### 1.3 连接数过多

**症状**：
```
Error: WebSocket server reached max connections
```

**可能原因**：
1. 未正确关闭连接
2. 恶意连接尝试
3. 配置的最大连接数太低

**解决方案**：

```typescript
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({
  maxConnections: 1000,  // 增加最大连接数
});

wss.on('connection', (ws, req) => {
  // 限制单个 IP 的连接数
  const ip = req.socket.remoteAddress;
  const ipConnections = getIpConnectionCount(ip);

  if (ipConnections > 10) {
    ws.close(1008, 'Too many connections from this IP');
    return;
  }

  // 处理连接...
});
```

---

## 2. 消息问题

### 2.1 消息签名验证失败

**症状**：
```
Verification failed: INVALID_SIGNATURE
```

**可能原因**：
1. 发送方使用了错误的私钥
2. 消息在传输中被篡改
3. 签名算法不匹配
4. 时间戳过期

**解决方案**：

```typescript
const verifier = new MessageVerifier(trustStore, {
  tofuEnabled: true,
  onVerificationFailed: (envelope, error) => {
    console.error('签名验证失败:', {
      from: envelope.from,
      action: envelope.action,
      error: error.message,
      timestamp: envelope.timestamp,
    });
  },
});

const gateway = new Gateway({
  verifier,
  // ...
});
```

**调试签名**：
```typescript
import { verify, canonicalize } from 'adp-agent';

const isValid = await verify(envelope, canonicalize);

console.log('签名验证详情:', {
  from: envelope.from,
  id: envelope.id,
  action: envelope.action,
  signature: envelope.signature ? '存在' : '缺失',
  valid: isValid,
});
```

### 2.2 消息丢失

**症状**：
- 消息发送成功但对方未收到
- 消息顺序错乱

**可能原因**：
1. WebSocket 连接已断开
2. 服务器重启
3. 网络分区

**解决方案**：

```typescript
// 添加消息确认机制
const pendingMessages = new Map<string, {
  resolve: (msg: Envelope) => void;
  reject: (err: Error) => void;
  timeout: NodeJS.Timeout;
}>();

async function sendWithAck(
  ws: WebSocket,
  envelope: Envelope,
  timeout = 5000
): Promise<Envelope> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingMessages.delete(envelope.id);
      reject(new Error('消息确认超时'));
    }, timeout);

    pendingMessages.set(envelope.id, {
      resolve,
      reject,
      timeout: timeoutId,
    });

    ws.send(JSON.stringify(envelope));
  });
}

// 处理确认回复
ws.on('message', (data) => {
  const reply = JSON.parse(data.toString());

  if (reply.reply_to && pendingMessages.has(reply.reply_to)) {
    const pending = pendingMessages.get(reply.reply_to)!;
    clearTimeout(pending.timeout);
    pending.resolve(reply);
    pendingMessages.delete(reply.reply_to);
  }
});
```

### 2.3 消息格式错误

**症状**：
```
JSON parse error: Unexpected token
Invalid envelope format
```

**解决方案**：

```typescript
ws.on('message', (data) => {
  try {
    const raw = typeof data === 'string' ? data : data.toString();
    const envelope = JSON.parse(raw);

    // 验证必需字段
    const requiredFields = ['protocol', 'id', 'from', 'to', 'action'];
    for (const field of requiredFields) {
      if (!envelope[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // 处理消息...
    processMessage(envelope);
  } catch (error) {
    console.error('消息解析失败:', error.message);
  }
});
```

---

## 3. 身份问题

### 3.1 Agent ID 格式错误

**症状**：
```
Error: Invalid Agent ID format
```

**正确格式**：
```
adp://{base64url_public_key}@{namespace}/{agent-name}
```

**示例**：
```
adp://ABC123xyz__ABC123xyz__ABC123@myapp/video-agent
```

**解决方案**：
```typescript
import { buildAgentId } from 'adp-agent';

// 验证公钥长度（Ed25519 = 32 字节）
if (publicKey.length !== 32) {
  throw new Error('公钥长度必须是 32 字节');
}

// 构建正确的 Agent ID
const agentId = buildAgentId(
  publicKey,
  'myapp',
  'video-agent'
);

console.log('生成的 Agent ID:', agentId);
```

### 3.2 私钥丢失

**症状**：
```
Error: Identity file not found
Cannot load identity: file corrupted
```

**预防措施**：
```typescript
import * as fs from 'fs';

const { identity, isNew } = loadOrCreateIdentity('myapp', 'agent', 'Agent');

// 备份私钥
if (isNew) {
  const backup = {
    secretKey: Buffer.from(identity.secretKey).toString('base64'),
    agentId: identity.agentId,
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync('.adp/identity-backup.json', JSON.stringify(backup, null, 2));
  console.log('✅ 私钥已备份到 .adp/identity-backup.json');
}
```

**恢复私钥**：
```typescript
import * as fs from 'fs';
import { KeyPair } from 'tweetnacl';

const backup = JSON.parse(fs.readFileSync('.adp/identity-backup.json', 'utf-8'));
const secretKey = Uint8Array.from(Buffer.from(backup.secretKey, 'base64'));

// 使用恢复的密钥
const identity = {
  secretKey,
  agentId: backup.agentId,
};
```

### 3.3 密钥轮换失败

**症状**：
```
Error: Key rotation failed
Rotation chain verification failed
```

**解决方案**：
```typescript
import { rotateKeys, buildRegistryUpdate } from 'adp-agent';

try {
  const rotation = await rotateKeys(identity, {
    reason: 'Scheduled rotation',
  });

  if (rotation.success) {
    // 更新本地存储
    identity.secretKey = rotation.newSecretKey;
    identity.agentId = rotation.newAgentId;

    // 如果使用 Registry，更新远程记录
    if (registryUrl) {
      const update = buildRegistryUpdate(
        identity.initialId,
        identity.agentId,
        identity.secretKey,
        rotation.rotationChain
      );

      await registryClient.update(update);
    }
  }
} catch (error) {
  console.error('密钥轮换失败:', error);
}
```

---

## 4. 发现服务问题

### 4.1 mDNS 发现不到其他 Agent

**症状**：
```
No agents discovered on LAN
mDNS query timeout
```

**可能原因**：
1. 网络隔离（Docker 网络、VPN）
2. 防火墙阻止 UDP 5353 端口
3. 多网卡环境

**解决方案**：

```bash
# macOS: 允许 mDNS
sudo mdnsd enable

# Linux: 检查防火墙
sudo ufw allow 5353/udp

# Docker: 使用 host 网络
docker run --network host my-agent
```

**代码配置**：
```typescript
import { Discovery } from 'adp-agent';

const discovery = new Discovery(agentId, port, {
  multicastInterface: '192.168.1.100',  // 指定网络接口
  onPeerDiscovered: (peer) => {
    console.log('发现 Agent:', peer.agentId);
  },
});

discovery.start();
```

### 4.2 Registry 连接失败

**症状**：
```
Error: Registry connection failed
HTTP 401 Unauthorized
```

**解决方案**：
```typescript
const registry = new RegistryClient({
  registryUrl: 'http://localhost:9800',
  agentId: identity.agentId,
  secretKey: identity.secretKey,
  token: process.env.ADP_REGISTRY_TOKEN,  // 设置访问令牌
});

// 测试连接
try {
  await registry.ping();
  console.log('✅ Registry 连接正常');
} catch (error) {
  console.error('❌ Registry 连接失败:', error);
}
```

---

## 5. 中继服务问题

### 5.1 Relay 连接超时

**症状**：
```
Error: Relay connection timeout
WebSocket handshake failed
```

**解决方案**：
```typescript
const relay = new RelayClient({
  relayUrl: 'ws://relay.example.com:9700/adp/relay',
  agentId: identity.agentId,
  secretKey: identity.secretKey,
  connectTimeout: 10000,  // 10 秒超时
  heartbeatInterval: 15000,
});

relay.on('error', (error) => {
  console.error('Relay 错误:', error);

  if (error.message.includes('timeout')) {
    // 尝试备用 Relay
    relay.connect('ws://backup-relay.example.com:9700/adp/relay');
  }
});
```

### 5.2 离线消息丢失

**症状**：
- 离线消息未被送达
- 消息顺序错乱

**解决方案**：
```typescript
relay.on('offline_message', (envelope) => {
  console.log('收到离线消息:', envelope.id);

  // 验证消息
  if (!envelope.signature) {
    console.error('离线消息缺少签名');
    return;
  }

  // 处理消息
  processMessage(envelope);
});

// 设置消息保留策略
relay.setMessageRetention({
  maxAge: 7 * 24 * 60 * 60 * 1000,  // 7 天
  maxPerAgent: 100,
});
```

---

## 6. 安全问题

### 6.1 签名验证被跳过

**危险症状**：
```
WARNING: Signature verification is disabled
skipVerification: true
```

**立即修复**：
```typescript
// 错误配置 ❌
const gateway = new Gateway({
  skipVerification: true,  // 危险！禁用所有安全验证
});

// 正确配置 ✅
const gateway = new Gateway({
  skipVerification: false,  // 始终保持签名验证
  tofuEnabled: true,         // 首次连接自动信任
});
```

### 6.2 恶意 Agent 连接

**症状**：
- 未知 Agent 尝试连接
- 异常签名验证失败
- 可疑消息内容

**解决方案**：
```typescript
const trustStore = new TrustStore();

// 严格模式：只有预信任的 Agent 才能连接
trustStore.setPolicy('strict');

// 添加信任列表
const knownAgents = [
  'adp://xxx@myapp/trusted-agent-1',
  'adp://xxx@myapp/trusted-agent-2',
];

for (const agentId of knownAgents) {
  trustStore.addTrustedKey(agentId, getPublicKey(agentId));
}

// 拒绝所有未知 Agent
const verifier = new MessageVerifier(trustStore);

verifier.on('untrusted_agent', (agentId) => {
  console.error('拒绝未信任的 Agent:', agentId);
  return false;  // 拒绝连接
});
```

---

## 7. 性能问题

### 7.1 内存泄漏

**症状**：
```
FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory
```

**诊断**：
```typescript
import * as v8 from 'v8';

// 定期检查堆内存
setInterval(() => {
  const heapStats = v8.getHeapStatistics();
  console.log('堆内存使用:', {
    total: `${Math.round(heapStats.total_heap_size / 1024 / 1024)}MB`,
    used: `${Math.round(heapStats.used_heap_size / 1024 / 1024)}MB`,
    percentage: `${((heapStats.used_heap_size / heapStats.total_heap_size) * 100).toFixed(1)}%`,
  });
}, 60000);
```

**常见原因和修复**：
```typescript
// 问题 1: 消息缓存无限增长
const messageCache = new Set<string>();
// 修复：限制缓存大小
const MAX_CACHE_SIZE = 10000;
if (messageCache.size > MAX_CACHE_SIZE) {
  const oldest = messageCache.values().next().value;
  messageCache.delete(oldest);
}

// 问题 2: WebSocket 连接未清理
ws.on('close', () => {
  connections.delete(ws);
  messageCache.clear();
});

// 问题 3: 定时器未清除
function cleanup() {
  clearInterval(heartbeatInterval);
  clearTimeout(reconnectTimeout);
}
```

### 7.2 高延迟

**症状**：
- 消息响应时间长
- 心跳超时频繁

**优化**：
```typescript
// 1. 启用消息压缩
const gateway = new Gateway({
  port: 9900,
  // WebSocket permessage-deflate 压缩默认已启用
});

// 2. 批量处理消息
import pQueue from 'p-queue';

const queue = new pQueue({
  concurrency: 10,
  intervalCap: 100,
  interval: 1000,
});

gateway.customHandlers = {
  'custom:process': async (ws, envelope) => {
    await queue.add(async () => {
      const result = await processMessage(envelope);
      ws.send(JSON.stringify(result));
    });
  },
};
```

---

## 8. 部署问题

### 8.1 Docker 容器启动失败

**症状**：
```
Error: Cannot start container
Port already in use
```

**解决方案**：
```bash
# 检查端口占用
lsof -i :9900

# 如果端口被占用，使用环境变量指定新端口
docker run -e PORT=9901 -p 9901:9901 my-agent
```

### 8.2 环境变量配置错误

**常见错误**：

| 变量名 | 常见错误 | 正确格式 |
|--------|----------|----------|
| `ADP_RELAY` | `ws://relay:9700` | `ws://relay:9700/adp/relay` |
| `ADP_REGISTRY` | `relay:9800` | `http://registry:9800` |
| `ADP_NAMESPACE` | `MyApp` | `my-app` |

**解决方案**：
```typescript
import * as z from 'zod';

const EnvSchema = z.object({
  ADP_NAMESPACE: z.string().regex(/^[a-z0-9.-]+$/, '必须是小写字母、数字、点和连字符'),
  ADP_NAME: z.string().regex(/^[a-z0-9_-]{1,32}$/, '无效的名称格式'),
  ADP_RELAY: z.string().url().optional(),
  ADP_REGISTRY: z.string().url().optional(),
});

const env = EnvSchema.parse(process.env);
```

### 8.3 日志无法查看

**解决方案**：
```bash
# Docker 环境
docker logs my-agent-container

# 实时跟踪
docker logs -f my-agent-container

# 查看最近 100 行
docker logs --tail 100 my-agent-container
```

**应用内日志配置**：
```typescript
import { setLogger, LogLevel } from 'adp-agent';

setLogger({
  level: process.env.LOG_LEVEL as LogLevel || 'info',
  format: 'json',  // JSON 格式便于日志收集
  output: process.env.NODE_ENV === 'production'
    ? '/var/log/adp/app.log'
    : 'stdout',
});
```

---

## 获取帮助

如果以上方案无法解决您的问题：

1. **检查日志**：查看详细错误日志
2. **GitHub Issues**：提交问题并附上日志和复现步骤
3. **讨论区**：在 GitHub Discussions 提问

```bash
# 收集诊断信息
echo "=== 系统信息 ===" > diagnostics.txt
uname -a >> diagnostics.txt
node --version >> diagnostics.txt
npm --version >> diagnostics.txt
echo "=== 网络状态 ===" >> diagnostics.txt
netstat -tlnp | grep -E '(9900|9700|9800)' >> diagnostics.txt
echo "=== 进程状态 ===" >> diagnostics.txt
lsof -i :9900 >> diagnostics.txt
```