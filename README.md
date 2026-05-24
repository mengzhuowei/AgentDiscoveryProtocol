<div align="center">
  <h1>
    <br>
    <br>
    🤖 Agent Discovery Protocol (ADP)
    <br>
    <br>
  </h1>
</div>

<div align="center">

[![npm version](https://img.shields.io/npm/v/adp-agent.svg?style=flat-square)](https://www.npmjs.com/package/adp-agent)
[![GitHub license](https://img.shields.io/github/license/mengzhuowei/AgentDiscoveryProtocol.svg?style=flat-square)](https://github.com/mengzhuowei/AgentDiscoveryProtocol/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4%2B-blue.svg?style=flat-square)](https://www.typescriptlang.org/)
[![protocol version](https://img.shields.io/badge/protocol-adp%2F0.2-orange.svg?style=flat-square)](docs/README.md)
[![MCP Compatible](https://img.shields.io/badge/MCP-compatible-green.svg?style=flat-square)](https://modelcontextprotocol.io/)

</div>

<div align="center">
  <strong>让智能体（Agent）能够互相发现、通信，无需中心化平台</strong>
</div>

<br>

<div align="center">
  <a href="#-特性">特性</a> •
  <a href="#-快速开始">快速开始</a> •
  <a href="#-安装">安装</a> •
  <a href="#-使用示例">示例</a> •
  <a href="#1-零代码接入推荐-">零代码接入</a> •
  <a href="#-配置">配置</a> •
  <a href="#-文档">文档</a> •
  <a href="#-贡献">贡献</a>
</div>

<br>

---

## ✨ 特性

- **🔐 自认证密码学身份** — Agent ID 直接嵌入 Ed25519 公钥，持有私钥即拥有 ID，无需 CA
- **🌐 去中心化优先** — 局域网 mDNS 零配置发现，Registry 和 Relay 可选增强
- **📜 强制签名验证** — 所有消息 Ed25519 签名，无签名直接拒绝
- **🧩 模块化架构** — Gateway、Registry、Relay 组件可独立部署
- **🛠️ MCP 兼容** — 直接作为 MCP（Model Context Protocol）服务运行
- **📦 开箱即用** — TypeScript 完整参考实现，含示例和测试

## 🚀 快速开始

### 方式一：Docker 部署（推荐生产环境）

```bash
# 进入 docker 目录
cd docker

# 配置环境变量
cp .env.example .env
# 编辑 .env 修改密码等配置

# 启动服务
docker-compose up -d

# 查看状态
docker-compose ps
```

详细文档：[Docker 部署指南](docs/docker.md)

### 方式二：本地开发（5 分钟上手）

```bash
# 克隆仓库
git clone https://github.com/mengzhuowei/AgentDiscoveryProtocol.git
cd AgentDiscoveryProtocol

# 安装依赖
npm install

# 启动第一个 Agent
npm start agent1

# 在另一个终端启动第二个 Agent，它会自动发现 agent1
npm start agent2
```

### 试试聊天功能

```bash
# 终端 1
npm run chat

# 终端 2
npm run chat
```

两个 Agent 会自动发现对方并建立连接！

## 📦 安装

### npm 安装

```bash
npm install adp-agent
```

### 从源码构建

```bash
git clone https://github.com/mengzhuowei/AgentDiscoveryProtocol.git
cd AgentDiscoveryProtocol
npm install
npm run build
```

## 💡 使用示例

### 1. 零代码接入（推荐 ⭐）

无需写任何代码，只需两步配置即可将你的 Agent 接入 ADP 网络：

```
你的 Agent ── MCP stdio ──► ADP MCP Server ── mDNS/Registry ──► ADP 网络中其他 Agent
```

接入后，你的 Agent 可直接调用 `adp_list_peers`、`adp_ping`、`adp_query_capabilities` 等 Tool 与其他 Agent 交互。

**第一步：创建 ADP 配置文件**

在 `~/.adp/config.json` 写入：

```json
{
  "namespace": "local",
  "name": "openclaw",
  "displayName": "OpenClaw AI",
  "description": "OpenClaw 视频生成、图片处理等能力",

  "capabilities": [
    "adp:ping",
    "adp:capability.query",
    "adp:info",
    {
      "capability": "custom:video.generate",
      "description": "根据文本描述生成短视频",
      "input_schema": {
        "type": "object",
        "properties": {
          "prompt": { "type": "string", "description": "视频描述" },
          "duration": { "type": "integer", "default": 5 },
          "style": { "type": "string", "enum": ["realistic", "cartoon", "anime"] }
        },
        "required": ["prompt"]
      }
    }
  ],

  "registry": {
    "url": "http://192.168.6.174:3000",
    "token": ""
  }
}
```

`capabilities` 里声明你的 Agent 对外提供的能力，可以写简单字符串（`"adp:ping"`），也可以附带 `input_schema` / `output_schema` 方便其他 Agent 自动理解。

**第二步：在你的 MCP Host 中配置 ADP**

以 OpenClaw 为例，在 MCP 配置文件（通常是 `~/.openclaw/mcp.json`）中添加：

```json
{
  "mcpServers": {
    "adp": {
      "command": "npx",
      "args": ["ts-node", "/path/to/AgentDiscoveryProtocol/start-mcp.ts"]
    }
  }
}
```

配置完毕，重启你的 MCP Host。ADP 会自动：
- 生成 Ed25519 自认证身份（Agent ID 格式：`adp://公钥@local/openclaw`）
- 在局域网内通过 mDNS 自动发现其他 Agent
- 向 Registry 注册，让跨网络 Agent 也能发现你

### 2. 作为 MCP 服务启动

```bash
# 使用配置文件
npm run adp

# 或者通过环境变量
ADP_REGISTRY=http://localhost:3000 npm run adp
```

查看[MCP 配置示例](#-配置)了解更多。

### 3. 嵌入 Gateway 到你的应用（编程方式）

```typescript
import { Gateway, loadOrCreateIdentity } from 'adp-agent';

async function main() {
  // 创建或加载身份
  const { identity } = loadOrCreateIdentity('local', 'my-agent', 'My Awesome Agent');

  // 启动 Gateway
  const gateway = new Gateway({
    port: 9876,
    host: '0.0.0.0',
    secretKey: identity.secretKey,
    agentId: identity.agentId,
    displayName: 'My Agent',
    capabilities: ['adp:ping', 'adp:capability.query'],
  });

  console.log(`Agent ID: ${identity.agentId}`);
}

main();
```

### 4. 发布自定义能力（编程方式，以 OpenClaw 为例）

```typescript
import { Gateway, loadOrCreateIdentity } from 'adp-agent';

const customHandlers = {
  'custom:video.generate': async (ws, envelope) => {
    const { prompt, duration, style } = envelope.params;
    // 调用你的视频生成逻辑...
    const videoUrl = await openclaw.generateVideo(prompt, { duration, style });

    // 返回结果
    ws.send(JSON.stringify({
      protocol: 'adp/0.2',
      id: generateMessageId(),
      from: identity.agentId,
      to: envelope.from,
      action: 'custom:video.generate',
      params: {
        task_id: 'xxx',
        status: 'COMPLETED',
        result: { video_url: videoUrl }
      },
      reply_to: envelope.id,
      timestamp: new Date().toISOString(),
    }));
  }
};

const gateway = new Gateway({
  port: 9900,
  secretKey: identity.secretKey,
  agentId: identity.agentId,
  displayName: 'OpenClaw AI',
  capabilities: [
    'adp:ping',
    'adp:capability.query',
    {
      capability: 'custom:video.generate',
      description: 'Generate video from prompt',
      input_schema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Video description' },
          duration: { type: 'integer', default: 5 },
        },
        required: ['prompt'],
      },
    },
  ],
  customHandlers,
});
```

## ⚙️ 配置

### Agent 通信模式

ADP 支持三种通信模式，可根据场景灵活选择：

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| **websocket** | 所有请求通过 WebSocket 同步处理 | 实时交互、低延迟场景 |
| **webhook** | 所有请求通过 Webhook 异步处理 | 长耗时任务（如视频生成、大模型推理） |
| **hybrid** | 根据能力配置自动选择（推荐） | 混合场景，灵活切换 |

### MCP 配置文件（含 Webhook 配置）

在项目根目录或 `~/.adp/` 创建 `config.json`：

```json
{
  "namespace": "local",
  "name": "openclaw",
  "displayName": "OpenClaw AI Video Agent",
  "description": "AI agent for generating short videos from text prompts",
  "portBase": 9900,

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
    "adp:info",
    {
      "capability": "custom:video.generate",
      "description": "Generate a short video from a text prompt",
      "async": true,
      "preferredMode": "webhook",
      "input_schema": {
        "type": "object",
        "properties": {
          "prompt": {
            "type": "string",
            "description": "Text description of the desired video"
          },
          "duration": {
            "type": "integer",
            "description": "Video duration in seconds",
            "default": 5
          },
          "style": {
            "type": "string",
            "description": "Visual style",
            "enum": ["realistic", "cartoon", "anime", "3d"],
            "default": "realistic"
          }
        },
        "required": ["prompt"]
      }
    }
  ],

  "relay": {
    "url": ""
  },

  "registry": {
    "url": "http://192.168.6.174:3000",
    "token": ""
  }
}
```

### 配置说明

#### communication

通信模式配置：

| 字段 | 类型 | 说明 |
|------|------|------|
| `mode` | string | 通信模式：`websocket`、`webhook`、`hybrid` |
| `webhook.enabled` | boolean | 是否启用 Webhook |
| `webhook.url` | string | Webhook 回调地址 |
| `webhook.secret` | string | Webhook 签名密钥 |
| `webhook.timeout` | number | Webhook 超时时间（毫秒） |
| `webhook.retry.maxAttempts` | number | 最大重试次数 |
| `webhook.retry.backoffMs` | number | 重试退避时间（毫秒） |

#### capabilities 扩展

能力配置新增字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `async` | boolean | 是否为异步任务 |
| `preferredMode` | string | 首选通信模式：`websocket`、`webhook` |

完整配置示例参见：[mcp-config.example.json](mcp-config.example.json)

### Registry 配置

启动 Registry 服务需要 MySQL 和 Redis，配置文件：[config.example.json](config.example.json)

```json
{
  "port": 3000,
  "mysql": {
    "host": "192.168.6.174",
    "port": 3306,
    "user": "root",
    "password": "123456",
    "database": "adp_registry"
  },
  "redis": {
    "host": "192.168.6.174",
    "port": 63790
  }
}
```

Registry 部署推荐使用 Docker，详见 [Docker 部署指南](docs/docker.md)。

## 📚 文档

### 快速开始

| 文档 | 说明 |
|------|------|
| [Docker 部署指南](docs/docker.md) | 使用 Docker 部署 Registry 和相关服务 |
| [快速入门](docs/quickstart.md) | 从零搭建第一个最小 Agent |

### 协议规范

| 文档 | 说明 |
|------|------|
| [身份与 Manifest](docs/01-identity.md) | Agent ID 格式、能力声明、任务抽象 |
| [消息格式](docs/02-message.md) | Envelope、签名、错误码、分布式追踪 |
| [发现机制](docs/03-discovery.md) | mDNS、静态配置、Registry |
| [传输层](docs/04-transport.md) | WebSocket、直连、Relay 中继 |
| [安全与信任](docs/05-security.md) | TOFU、签名验证、威胁模型 |
| [密码学规范](docs/06-signatures.md) | Ed25519 实现细节 |

### 开发指南

| 文档 | 说明 |
|------|------|
| [实现检查清单](docs/implementation-checklist.md) | 验证协议合规性 |
| [代码示例](docs/code-examples.md) | TypeScript / Python 示例 |
| [部署指南](docs/deployment.md) | Gateway、Registry、Relay 部署 |

## 🏗️ 架构

```
┌───────────────────────────────────────────────────┐
│                   应用层                           │
│  自定义能力（视频生成、计算、数据查询等）           │
└───────────────────────────┬───────────────────────┘
                            │
┌───────────────────────────▼───────────────────────┐
│                   消息层                           │
│  Envelope + Ed25519 强制签名 + 任务状态机          │
└───────────────────────────┬───────────────────────┘
                            │
┌───────────────────────────▼───────────────────────┐
│                   传输层                           │
│  WebSocket 直连  ──  Relay 中继（可选）            │
└───────────────────────────┬───────────────────────┘
                            │
┌───────────────────────────▼───────────────────────┐
│                   发现层                           │
│  mDNS（局域网） ──  Registry 目录（可选）          │
└───────────────────────────────────────────────────┘
```

## 🛠️ 开发

### 运行测试

```bash
# 核心测试
npm test

# 集成测试
npm run test:integration

# mDNS 发现测试
npm run test:mdns

# Registry 测试
npm run test:registry
```

### 启动服务

```bash
# 启动 Gateway
npm start agent1

# 启动 Relay
npm run relay

# 启动 Registry
npm run registry
```

### 更多示例

仓库包含完整示例：

- [视频生成 Agent（以 OpenClaw 为例）](examples/openclaw-agent.ts)
- [视频调用客户端（以 OpenClaw 为例）](examples/video-client.ts)

## 🗺️ 路线图

- [x] **v0.2** — 自认证密码学身份、强制签名验证、TOFU 信任
- [x] **Registry** — 中心化目录服务，支持密钥轮换
- [x] **MCP 集成** — 作为 MCP 服务运行
- [ ] **任务委派** — 跨 Agent 任务调度
- [ ] **端到端加密** — 可选 E2EE 通信
- [ ] **更多语言实现** — Python、Rust

## 📄 许可证

MIT © [ADP Working Group](https://github.com/mengzhuowei/AgentDiscoveryProtocol)

## 🤝 贡献

欢迎贡献！请提交 Issue 或 PR。

---

<div align="center">
  <sub>Built with ❤️ by the ADP community</sub>
</div>
