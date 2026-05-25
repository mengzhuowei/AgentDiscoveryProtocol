# ADP Examples

本目录包含 Agent Discovery Protocol (ADP) 的实际使用示例。

## 目录结构

```
examples/
├── README.md           # 本文件
├── index.ts            # 基础 Gateway 示例
├── openclaw-agent.ts  # OpenClaw 视频生成 Agent
├── video-client.ts    # 视频生成客户端
├── video-agent.ts    # 异步 Webhook 视频生成 Agent
├── image-agent.ts    # 图像生成 Agent（支持多种模型）
├── relay-client.ts   # Relay 中继客户端使用
└── multi-agent-chat.ts # 多 Agent 聊天系统
```

## 示例列表

### 1. [index.ts](index.ts) - 基础 Gateway
最简单的 ADP Agent 示例，展示如何创建 Gateway、注册能力、处理消息。

```bash
npx ts-node examples/index.ts
```

### 2. [openclaw-agent.ts](openclaw-agent.ts) - OpenClaw 视频生成
同步 WebSocket 响应示例，处理视频生成请求并返回结果。

```bash
npx ts-node examples/openclaw-agent.ts
```

### 3. [video-client.ts](video-client.ts) - 视频生成客户端
演示如何向 Agent 发送请求并处理响应。

```bash
npx ts-node examples/video-client.ts
```

### 4. [video-agent.ts](video-agent.ts) - 异步 Webhook Agent
使用 Webhook 回调机制的异步任务处理示例。

```bash
npx ts-node examples/video-agent.ts
```

### 5. [image-agent.ts](image-agent.ts) - 图像生成 Agent
支持多种 AI 图像生成模型的 Agent 示例，展示能力路由。

```bash
npx ts-node examples/image-agent.ts
```

### 6. [relay-client.ts](relay-client.ts) - Relay 客户端
演示如何通过中继服务器与 NAT 后的 Agent 通信。

```bash
npx ts-node examples/relay-client.ts
```

### 7. [multi-agent-chat.ts](multi-agent-chat.ts) - 多 Agent 聊天
展示 Agent 间的协作和消息路由。

```bash
npx ts-node examples/multi-agent-chat.ts
```

## 运行所有示例

### 前置条件

1. 确保已安装依赖：
```bash
npm install
```

2. 构建项目：
```bash
npm run build
```

### 单个运行

每个示例都可以独立运行，通常需要多个终端：

**示例 1: 基础 Gateway**
```bash
# 终端 1: 启动 Agent
npx ts-node examples/index.ts

# 终端 2: 连接并测试（使用 WebSocket 客户端）
```

**示例 2: OpenClaw + 客户端**
```bash
# 终端 1: 启动 Agent
npx ts-node examples/openclaw-agent.ts

# 终端 2: 启动客户端
npx ts-node examples/video-client.ts
```

**示例 3: Relay 通信**
```bash
# 终端 1: 启动 Agent
npx ts-node examples/index.ts

# 终端 2: 启动 Relay 中继
npx ts-node start-relay.ts

# 终端 3: 启动 Relay 客户端
npx ts-node examples/relay-client.ts
```

## 常见模式

### 模式 1: 请求-响应
```
Agent A ──(WebSocket)──> Agent B ──> 同步响应
```

### 模式 2: 异步回调
```
Agent A ──(WebSocket)──> Agent B ──(Webhook)──> OpenClaw
                               │
                               ▼
                         JSON-RPC 回调
                               │
                               ▼
Agent A <──(WebSocket)── Agent B
```

### 模式 3: 中继通信
```
Agent A ──> Relay Server ──> Agent B（跨 NAT）
```

## 故障排查

详见 [故障排查指南](../docs/troubleshooting.md)。

## 扩展阅读

- [最佳实践](../docs/best-practices.md)
- [API 文档](../docs/api/README.md)
- [通信方式](../docs/communication.md)