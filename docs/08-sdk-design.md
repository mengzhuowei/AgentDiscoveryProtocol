# ADP SDK 开发者设计草案

## 定位

一个 npm package，安装后 Agent 自动获得 ADP 能力：
- 自动注册到 Registry
- 监听传入消息
- 解析并直连/Relay 其他 Agent
- 提供简洁的 Agent 回调接口

## 目标

开发者接入 ADP 只需要做两件事：

```ts
import { createADP } from 'adp-gateway'

const agent = createADP({
  agentId: 'adp://alice@example.com/hermes',
  // 定义 Agent 能做什么
  handlers: {
    'adp:ping': async () => ({ uptime: process.uptime() }),
    'custom:code.review': async (params) => { /* ... */ },
  }
})

await agent.start()
```

## 设计草案

```ts
// adp-gateway 的开发者入口

import { createADP, type ADPConfig } from 'adp-gateway'

/**
 * 配置
 */
type ADPConfig = {
  // Agent 身份
  agentId: string
  displayName?: string
  description?: string

  // Registry 地址（可选，默认 registry.adp.io）
  registry?: string

  // 监听端口（可选，默认自动分配）
  port?: number

  // Relay 配置（可选，默认自动选择）
  relay?: string | string[]

  // Relay Token（可选，如果 relay 需要认证）
  relayToken?: string

  // 能力处理器
  handlers: Record<string, ADPMessageHandler>

  // Agent 信息
  agentInfo?: {
    vendor?: string
    runtime?: string
    platform?: string
    public?: boolean
  }

  // 可选的 manifest 扩展字段
  manifestExtra?: Record<string, any>
}

type ADPMessageHandler = (params: any, context: MessageContext) => Promise<any>
```

### 最简单的 Demo

```ts
import { createADP } from 'adp-gateway'

const agent = createADP({
  agentId: 'adp://demo@example.com/bot',
  handlers: {
    'adp:ping': async () => {
      // SDK 自动补充 agent_id、version、timestamp 到响应中
      return { uptime: process.uptime() }
    },
    'adp:capability.query': async () => {
      return {
        capabilities: ['adp:ping', 'adp:capability.query']
      }
    },
    'custom:echo': async (params) => {
      return { echoed: params }
    },
  }
})

await agent.start()
console.log('Agent 已上线:', agent.agentId)
```

### 向其他 Agent 发消息

SDK 提供 `send()` 方法：

```ts
// 发送并等待响应
const result = await agent.send({
  to: 'adp://bob@home.io/claude',
  action: 'adp:ping',
})
// => { message_id: '...', data: { uptime: 12345 } }

// 单向推送（不需要回复）
await agent.send({
  to: 'adp://bob@home.io/claude',
  action: 'adp:info.share',
  params: { content_type: 'text/plain', content: 'hello' }
}, { expectReply: false })
```

### 事件监听

对于需要异步处理的场景（如持续接收推送）：

```ts
agent.on('message', (envelope) => {
  console.log('收到消息:', envelope)
})

agent.on('error', (err) => {
  console.error('通信错误:', err)
})

agent.on('agentOnline', (agentId) => {
  console.log('检测到 Agent 上线:', agentId)
})

agent.on('agentOffline', (agentId) => {
  console.log('Agent 下线:', agentId)
})
```

### 关闭

```ts
await agent.stop()
// 自动：注销注册、关闭连接、释放端口
```

## 内部模块结构（面向开发者透明）

```
adp-gateway/
├── index.ts              # 入口：createADP()
├── core/
│   ├── identity.ts       # Agent ID 解析与校验
│   ├── manifest.ts       # Manifest 构建
│   └── envelope.ts       # 消息封装与解析
├── transport/
│   ├── websocket.ts      # WebSocket 服务端/客户端
│   ├── http.ts           # HTTP 回调支持
│   └── router.ts         # 路由选择（直连/Relay/回退）
├── registry/
│   └── client.ts         # Registry 注册/刷新/解析/搜索
├── relay/
│   └── client.ts         # Relay 连接与重连
└── handlers/
    └── builtin.ts        # 内置处理器（ping, capability.query）
```

## 依赖（最小化）

- `ws` — WebSocket 客户端+服务端
- `uuid` — 消息 ID 生成
- 零其他运行时依赖

## Node.js 版本要求

- Node.js >= 18（原生 fetch + WebSocket）

## 后续可能的扩展

- TypeScript 类型定义导出
- 中间件机制（日志、鉴权、限流）
- 文件传输通道
- 端到端加密
