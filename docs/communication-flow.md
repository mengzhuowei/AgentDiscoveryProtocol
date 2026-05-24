# ADP Agent 通信流程详解

## 📚 目录

1. [当前实现分析](#当前实现分析)
2. [架构设计方案](#架构设计方案)
3. [改进实现建议](#改进实现建议)
4. [完整示例代码](#完整示例代码)

---

## 当前实现分析

### 现有流程

```
┌───────────────────────────────────────────────────────────────────────────────────────────────────┐
│ 当前实现 (WebSocket 优先，Webhook 仅用于通知 Agent B 的后端)                                        │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────┐               ┌──────────────────────────────────┐
│    Agent A (请求方)              │               │    Agent B (执行方)              │
│                                  │               │                                  │
│  ┌───────────────────────────┐  │               │  ┌───────────────────────────┐  │
│  │  1. 发送请求             │  │───────────────>│  │  2. 接收请求             │  │
│  │    WebSocket            │  │   WebSocket     │  │    (async: true)        │  │
│  │    action: video.generate│  │               │  └───────────────────────────┘  │
│  └───────────────────────────┘  │               │              │                   │
│                                  │               │              ▼                   │
│  ┌───────────────────────────┐  │               │  ┌───────────────────────────┐  │
│  │  4. 接收 PENDING         │  │<───────────────│  │  3. 立即返回 PENDING     │  │
│  │    WebSocket            │  │   WebSocket     │  │    task_id + status     │  │
│  │    status: PENDING      │  │               │  └───────────────────────────┘  │
│  └───────────────────────────┘  │               │              │                   │
│                                  │               │              ▼                   │
│                                  │               │  ┌───────────────────────────┐  │
│                                  │               │  │  5. 异步处理任务         │  │
│                                  │               │  │    (如生成视频、推理等)  │  │
│                                  │               │  └───────────────────────────┘  │
│                                  │               │              │                   │
│                                  │               │              ▼                   │
│  ┌───────────────────────────┐  │               │  ┌───────────────────────────┐  │
│  │  6. 接收 COMPLETED      │  │<───────────────│  │  7. 发送完成状态        │  │
│  │    WebSocket            │  │   WebSocket     │  │    to Agent A           │  │
│  │    status: COMPLETED   │  │               │  └───────────────────────────┘  │
│  └───────────────────────────┘  │               │              │                   │
│                                  │               │              ▼                   │
│                                  │               │  ┌───────────────────────────┐  │
│                                  │               │  │  8. 发送 Webhook        │  │
│                                  │               │  │    通知 Agent B 后端     │  │
│                                  │               │  └───────────────────────────┘  │
│                                  │               │              │                   │
└──────────────────────────────────┘               └──────────────────────────────────┘
                                                              │
                                                              ▼
                                                ┌──────────────────────────────────┐
                                                │    Agent B 的 Webhook 后端        │
                                                │                                  │
                                                │  - 收到 task.completed           │
                                                │  - 收到最终结果                 │
                                                └──────────────────────────────────┘
```

### 当前流程的关键点

1. **Agent A → Agent B**: 标准 WebSocket 消息
2. **Agent B 立即响应**: PENDING 状态 + task_id
3. **Agent B 处理任务**: 异步，不阻塞
4. **Agent B → Agent A**: 最终结果通过 WebSocket 发送
5. **Agent B → 自己的后端**: Webhook 回调，仅用于通知

---

## 架构设计方案

### 方案对比

| 方案 | 说明 | 适用场景 |
|------|------|----------|
| **方案 A** | Webhook 仅通知 Agent B 后端 | 当前实现 |
| **方案 B** | Webhook 用于 Agent 间通信 | 跨网络 Agent |
| **方案 C** | 双向 Webhook 通信 | 完全无状态 |
| **方案 D** | Webhook + Task Manager | 生产级实现 |

### 方案 D（推荐）：Webhook + Task Manager 架构

```
┌───────────────────────────────────────────────────────────────────────────────────────────────────┐
│ 推荐方案 (Webhook + Task Manager)                                                                │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────────────────────────────────┐
│ 场景 1: Agent A 触发任务，结果通过 Webhook 发送给 Agent B 的后端，再由后端通知 Agent A             │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────┐               ┌──────────────────────────────────┐
│    Agent A                       │               │    Agent B                       │
│                                  │               │                                  │
│  ┌───────────────────────────┐  │               │  ┌───────────────────────────┐  │
│  │  1. 发送请求             │  │───────────────>│  │  2. 接收请求             │  │
│  │    WebSocket            │  │   WebSocket     │  │    (async: true)        │  │
│  │    action: video.generate│  │               │  └───────────────────────────┘  │
│  └───────────────────────────┘  │               │              │                   │
│                                  │               │              ▼                   │
│  ┌───────────────────────────┐  │               │  ┌───────────────────────────┐  │
│  │  4. 接收 PENDING         │  │<───────────────│  │  3. 立即返回 PENDING     │  │
│  │    WebSocket            │  │   WebSocket     │  │    task_id + status     │  │
│  └───────────────────────────┘  │               │  └───────────────────────────┘  │
│                                  │               │              │                   │
│                                  │               │              ▼                   │
│                                  │               │  ┌───────────────────────────┐  │
│                                  │               │  │  5. 异步处理任务         │  │
│                                  │               │  │    (如生成视频、推理等)  │  │
│                                  │               │  └───────────────────────────┘  │
│                                  │               │              │                   │
│                                  │               │              ▼                   │
│                                  │               │  ┌───────────────────────────┐  │
│                                  │               │  │  6. 发送 Webhook        │  │
│                                  │               │  │    通知 Agent B 后端     │  │
│                                  │               │  └───────────────────────────┘  │
│                                  │               │              │                   │
└──────────────────────────────────┘               └──────────────────────────────────┘
                                                              │
                                                              ▼
                                                ┌──────────────────────────────────┐
                                                │    Agent B 的 Webhook 后端        │
                                                │                                  │
                                                │  - 收到 task.completed           │
                                                │  - 收到最终结果                 │
                                                │  - (可选) 转发给 Agent A        │
                                                └──────────────────────────────────┘
                                                              │
                                                              ▼
┌──────────────────────────────────┐
│    Agent A 的 Webhook 后端        │
│                                  │
│  - 收到 task.completed           │
│  - 显示结果给用户                 │
└──────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────────────────────────────────┐
│ 场景 2: Agent A 通过 Webhook 直接触发任务 (无持久连接)                                           │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────┐
│    Agent A 的后端 (HTTP 客户端)  │
│                                  │
│  ┌───────────────────────────┐  │
│  │  1. 发送请求             │  │
│  │    HTTP POST            │  │
│  │    /agent/task          │  │
│  │    body: {...}         │  │
│  └───────────────────────────┘  │
└──────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│    Agent B 的 API 端点            │
│                                  │
│  ┌───────────────────────────┐  │
│  │  2. 验证签名 + 接收请求  │  │
│  │    生成 task_id         │  │
│  └───────────────────────────┘  │
│               │                  │
│               ▼                  │
│  ┌───────────────────────────┐  │
│  │  3. 立即返回 PENDING      │  │
│  │    HTTP 202 Accepted      │  │
│  │    { task_id }           │  │
│  └───────────────────────────┘  │
│               │                  │
│               ▼                  │
│  ┌───────────────────────────┐  │
│  │  4. 异步处理任务         │  │
│  └───────────────────────────┘  │
│               │                  │
│               ▼                  │
│  ┌───────────────────────────┐  │
│  │  5. 发送 Webhook        │  │
│  │    通知 Agent A 后端     │  │
│  └───────────────────────────┘  │
└──────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│    Agent A 的 Webhook 接收端      │
│                                  │
│  ┌───────────────────────────┐  │
│  │  6. 接收 task.completed  │  │
│  │    验证签名              │  │
│  │    处理结果              │  │
│  └───────────────────────────┘  │
└──────────────────────────────────┘
```

---

## 改进实现建议

### 建议 1：增加查询任务状态的能力

```typescript
// 新增标准能力
interface Capabilities {
  'adp:task.get': {
    params: { task_id: string }
    result: {
      task_id: string
      status: 'PENDING' | 'WORKING' | 'COMPLETED' | 'FAILED'
      result?: unknown
      error?: { code: string; message: string }
      progress?: { current: number; total: number; message: string }
    }
  }
  'adp:task.cancel': {
    params: { task_id: string }
    result: { success: boolean }
  }
}
```

### 建议 2：支持多种 Webhook 回调目标

```typescript
// 扩展配置
interface CommunicationConfig {
  mode: 'websocket' | 'webhook' | 'hybrid'
  webhook: {
    enabled: boolean
    // 多个回调目标
    targets: Array<{
      url: string
      events: Array<'task.completed' | 'task.failed' | 'task.progress'>
      secret: string
    }>
    // 或者，直接在请求中指定
    allowInlineUrl: boolean
  }
}
```

### 建议 3：标准 Webhook 载荷

```typescript
// 完整的 Webhook 载荷
interface WebhookPayload {
  protocol: 'adp/0.2'
  event: string
  task_id: string
  agent_id: string
  timestamp: string
  signature: string
  data: {
    // 原始请求
    request?: {
      action: string
      params: unknown
      from: string
    }
    // 结果
    result?: unknown
    // 错误
    error?: {
      code: string
      message: string
    }
    // 进度
    progress?: {
      current: number
      total: number
      message: string
    }
  }
}
```

---

## 完整示例代码

### 示例 1：当前方式（推荐用于简单场景）

```typescript
// Agent B (执行方)
const gateway = new Gateway({
  port: 9900,
  communication: {
    mode: 'hybrid',
    webhook: {
      enabled: true,
      url: 'https://agent-b-backend.example.com/webhook',
      secret: 'agent-b-secret',
      timeout: 30000,
      retry: { maxAttempts: 3, backoffMs: 1000 }
    }
  },
  capabilities: [
    {
      capability: 'custom:video.generate',
      async: true,
      preferredMode: 'webhook'
    }
  ],
  customHandlers: {
    'custom:video.generate': async (ws, envelope) => {
      // 处理任务
      const videoUrl = await generateVideo(envelope.params);
      
      // 通过 WebSocket 发送给请求方 (Agent A)
      const reply = await signEnvelope({
        to: envelope.from,
        action: 'custom:video.generate',
        params: { task_id, status: 'COMPLETED', result: { video_url: videoUrl } },
        reply_to: envelope.id
      }, secretKey, canonicalize);
      ws.send(JSON.stringify(reply));
      
      // 同时 Webhook 会自动发送给 Agent B 的后端 (已在 Gateway 中实现)
    }
  }
});
```

### 示例 2：高级方式（Agent B 的后端转发给 Agent A）

```typescript
// Agent B 的 Webhook 后端
app.post('/webhook/agent-b', async (req, res) => {
  const payload = req.body;
  
  // 验证签名...
  
  if (payload.event === 'task.completed') {
    // 从 request 中找到是谁发起的任务
    const requestAgentId = payload.data.request?.from;
    
    if (requestAgentId) {
      // 方式 1: 通过 Relay 或 Registry 找到 Agent A 并通知
      await notifyAgentThroughRelay(requestAgentId, payload.data);
      
      // 方式 2: 如果是发起方指定的回调地址
      // const callbackUrl = payload.data.request?.callback_url;
      // await fetch(callbackUrl, { method: 'POST', body: JSON.stringify(payload) });
    }
  }
  
  res.status(200).json({ status: 'ok' });
});
```

---

## 📋 总结

### 当前实现

- ✅ WebSocket 用于 Agent 间通信
- ✅ Webhook 仅用于通知 Agent B 的后端
- ✅ 适用于大多数场景

### 扩展可能

1. **Task Manager 查询**: 允许查询任务状态
2. **多个 Webhook 目标**: 支持多个回调
3. **请求中指定回调**: 动态指定 Webhook URL
4. **纯 HTTP API**: 无 WebSocket 的纯 REST 接口
