# Agent 通信方式

本文档详细介绍 ADP Agent 支持的三种通信模式及其使用场景。

## 📋 目录

- [通信模式概述](#通信模式概述)
- [WebSocket 模式](#websocket-模式)
- [Webhook 模式](#webhook-模式)
- [Hybrid 模式](#hybrid-模式)
- [配置示例](#配置示例)
- [Webhook 协议规范](#webhook-协议规范)
- [最佳实践](#最佳实践)
- [迁移指南](#迁移指南)

## 通信模式概述

ADP 支持三种通信模式，可根据业务场景灵活选择：

| 模式 | 特点 | 适用场景 |
|------|------|----------|
| **WebSocket** | 实时双向通信，低延迟 | 实时交互、聊天、状态同步 |
| **Webhook** | 异步处理，无状态 | 长耗时任务、视频生成、大模型推理 |
| **Hybrid** | 混合模式，自动选择（推荐） | 混合场景，灵活切换 |

### 模式对比

| 维度 | WebSocket | Webhook | Hybrid |
|------|-----------|---------|--------|
| 连接状态 | 持久连接 | 无状态 | 混合 |
| 延迟 | 低 | 较高 | 按需 |
| 超时风险 | 高（连接可能断开） | 低 | 低 |
| 复杂度 | 低 | 中 | 中 |
| 可扩展性 | 中 | 高 | 高 |

## WebSocket 模式

### 工作原理

```
请求方                    响应方
   │                        │
   │─── WebSocket 连接 ─────▶│
   │                        │
   │───── 请求消息 ────────▶│
   │                        │
   │◀──── 响应消息 ─────────│
   │                        │
   │◀─── 心跳 (ping) ──────│
   │─── 心跳 (pong) ──────▶│
   │                        │
```

### 特点

- ✅ 实时双向通信
- ✅ 低延迟
- ✅ 适合短平快的交互
- ❌ 需要保持连接
- ❌ 长任务容易超时
- ❌ 连接断开需要重连

### 使用场景

- 实时聊天
- 状态同步
- 快速查询（ping、capability query）
- 心跳保活

### 配置

```json
{
  "communication": {
    "mode": "websocket"
  }
}
```

## Webhook 模式

### 工作原理

```
请求方                    响应方                   Webhook 接收方
   │                        │                            │
   │─── WebSocket 连接 ─────▶│                            │
   │                        │                            │
   │───── 请求消息 ────────▶│                            │
   │                        │                            │
   │◀─ 任务已接受 (task_id) ─│                            │
   │                        │                            │
   │                        │─── 处理中... ────────────▶│
   │                        │                            │
   │                        │◀─── 进度更新 (可选) ──────│
   │                        │                            │
   │                        │─── 任务完成/失败 ────────▶│
   │                        │                            │
```

### 特点

- ✅ 异步处理，无超时压力
- ✅ 适合长耗时任务
- ✅ 易于水平扩展
- ✅ 支持进度回调
- ❌ 延迟较高
- ❌ 需要额外的 Webhook 接收服务

### 使用场景

- 视频生成
- 大模型推理
- 图片处理
- 文件转码
- 任何耗时超过 10 秒的任务

### 配置

```json
{
  "communication": {
    "mode": "webhook",
    "webhook": {
      "enabled": true,
      "url": "https://your-server.com/webhook",
      "secret": "your_webhook_secret_key",
      "timeout": 30000,
      "retry": {
        "maxAttempts": 3,
        "backoffMs": 1000
      }
    }
  }
}
```

## Hybrid 模式

### 工作原理

Hybrid 模式会根据能力配置自动选择通信方式：

```
能力 A (async=false) ────▶ WebSocket 模式
能力 B (async=true)  ────▶ Webhook 模式
```

### 特点

- ✅ 灵活选择最佳通信方式
- ✅ 保持向后兼容
- ✅ 可逐步迁移
- ❌ 需要配置每个能力的首选模式

### 使用场景

- 混合场景
- 从 WebSocket 逐步迁移到 Webhook
- 既有实时交互又有长耗时任务

### 配置

```json
{
  "communication": {
    "mode": "hybrid",
    "webhook": {
      "enabled": true,
      "url": "https://your-server.com/webhook",
      "secret": "your_webhook_secret_key",
      "timeout": 30000,
      "retry": {
        "maxAttempts": 3,
        "backoffMs": 1000
      }
    }
  },
  "capabilities": [
    "adp:ping",
    "adp:capability.query",
    {
      "capability": "custom:video.generate",
      "async": true,
      "preferredMode": "webhook"
    },
    {
      "capability": "custom:quick.query",
      "async": false,
      "preferredMode": "websocket"
    }
  ]
}
```

## 配置示例

### 完整示例

```json
{
  "namespace": "local",
  "name": "myagent",
  "displayName": "My Agent",
  "portBase": 9900,

  "communication": {
    "mode": "hybrid",
    "webhook": {
      "enabled": true,
      "url": "https://api.example.com/adp/webhook",
      "secret": "wbhk_xxxxxxxxxxxxx",
      "timeout": 30000,
      "retry": {
        "maxAttempts": 3,
        "backoffMs": 1000
      }
    }
  },

  "capabilities": [
    "adp:ping",
    "adp:capability.query",
    {
      "capability": "custom:video.generate",
      "description": "Generate video from prompt",
      "async": true,
      "preferredMode": "webhook",
      "input_schema": {
        "type": "object",
        "properties": {
          "prompt": { "type": "string" },
          "duration": { "type": "integer", "default": 5 }
        },
        "required": ["prompt"]
      }
    },
    {
      "capability": "custom:chat.message",
      "description": "Quick chat response",
      "async": false,
      "preferredMode": "websocket"
    }
  ]
}
```

## Webhook 协议规范

### 请求格式

Webhook 请求是 POST 请求，Content-Type 为 `application/json`。

#### 请求头

| Header | 说明 |
|--------|------|
| `Content-Type` | `application/json` |
| `X-Webhook-Signature` | Ed25519 签名，Base64URL 编码 |
| `X-Webhook-Timestamp` | ISO 8601 时间戳 |
| `X-Webhook-Event` | 事件类型 |
| `X-Webhook-Task-Id` | 任务 ID |

#### 请求体

```json
{
  "event": "task.completed",
  "task_id": "task_abc123xyz",
  "agent_id": "adp://pubkey@namespace/agentname",
  "timestamp": "2024-05-24T10:30:00.000Z",
  "signature": "base64url_encoded_signature",
  "data": {
    "result": {
      "task_id": "task_abc123xyz",
      "status": "COMPLETED",
      "output": {
        "video_url": "https://cdn.example.com/video.mp4",
        "thumbnail_url": "https://cdn.example.com/thumb.jpg",
        "duration": 5
      }
    }
  }
}
```

### 事件类型

| Event | 说明 |
|-------|------|
| `task.completed` | 任务完成 |
| `task.failed` | 任务失败 |
| `task.progress` | 任务进度更新（可选） |

### 响应格式

Webhook 接收方应返回 2xx 状态码表示成功接收。

```json
{
  "status": "ok",
  "message": "Webhook received"
}
```

### 签名验证

1. 从请求头获取 `X-Webhook-Signature` 和 `X-Webhook-Timestamp`
2. 构建待签名数据：移除 `signature` 字段后的完整 payload
3. 使用 Agent 的公钥验证签名

#### 验证示例（Node.js）

```javascript
import nacl from 'tweetnacl';
import { decodeBase64URL } from 'adp-agent';

function verifyWebhook(payload, signature, publicKey) {
  const { signature: _, ...dataToSign } = payload;
  const canonical = JSON.stringify(dataToSign);
  const message = new TextEncoder().encode(canonical);
  const sig = decodeBase64URL(signature);
  const pk = decodeBase64URL(publicKey);
  
  return nacl.sign.detached.verify(message, sig, pk);
}
```

### 重试策略

Webhook 发送失败时会自动重试：

```
尝试 1: 立即发送
尝试 2: 等待 1000ms
尝试 3: 等待 2000ms (1000 * 2)
失败后放弃
```

## 最佳实践

### 1. 选择合适的通信模式

| 任务类型 | 推荐模式 |
|----------|----------|
| < 1 秒 | WebSocket |
| 1-10 秒 | WebSocket 或 Webhook |
| > 10 秒 | Webhook |
| 需要进度反馈 | Webhook |

### 2. Webhook 安全

- 使用 HTTPS
- 定期轮换 `secret`
- 验证签名
- 检查时间戳防止重放攻击

### 3. 错误处理

```javascript
// Webhook 接收方示例
app.post('/webhook', async (req, res) => {
  try {
    // 1. 验证签名
    const signature = req.headers['x-webhook-signature'];
    if (!verifySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // 2. 处理事件
    const event = req.body;
    switch (event.event) {
      case 'task.completed':
        await handleTaskCompleted(event.data);
        break;
      case 'task.failed':
        await handleTaskFailed(event.data);
        break;
    }

    res.status(200).json({ status: 'ok' });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

### 4. 监控和日志

- 记录所有 Webhook 请求和响应
- 监控失败率和延迟
- 设置告警

### 5. 幂等性

Webhook 可能重复发送，确保处理逻辑幂等：

```javascript
const processedTasks = new Set();

async function handleTaskCompleted(data) {
  const taskId = data.result.task_id;
  
  if (processedTasks.has(taskId)) {
    console.log('Task already processed:', taskId);
    return;
  }
  
  // 处理任务...
  
  processedTasks.add(taskId);
}
```

## 迁移指南

### 从 WebSocket 迁移到 Hybrid

1. 添加 `communication` 配置
2. 为长耗时能力设置 `async: true` 和 `preferredMode: "webhook"`
3. 实现 Webhook 接收方
4. 逐步测试和验证

### 回滚方案

如果 Webhook 出现问题，可以快速回滚：

```json
{
  "communication": {
    "mode": "websocket"
  }
}
```

或者将有问题的能力改回 WebSocket：

```json
{
  "capabilities": [
    {
      "capability": "custom:video.generate",
      "async": false,
      "preferredMode": "websocket"
    }
  ]
}
```
