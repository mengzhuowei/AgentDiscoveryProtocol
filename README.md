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
  <a href="#-平台定义">平台定义</a> •
  <a href="#-核心组件">核心组件</a> •
  <a href="#-技术目标">技术目标</a> •
  <a href="#-快速开始">快速开始</a> •
  <a href="#-安装">安装</a> •
  <a href="#-使用示例">使用示例</a> •
  <a href="#-架构">架构</a> •
  <a href="#-文档">文档</a>
</div>

<br>

---

## 平台定义

ADP（Agent Discovery Protocol）是一个去中心化的智能体发现与通信协议，旨在让 AI Agent 能够在无需中心化平台的情况下互相发现、建立连接并安全通信。通过自认证密码学身份、mDNS 零配置发现和 Ed25519 强制签名验证，ADP 为 Agent 间协作提供了安全、可靠的基础设施。

## 核心组件

### 1. 自认证身份系统

基于 Ed25519 公钥密码学的自认证身份系统，Agent ID 直接嵌入公钥，持有私钥即拥有该身份。

- **零信任架构** — 无需中心化身份验证服务
- **密钥轮换** — 支持安全的密钥更新机制
- **持久化存储** — 密钥安全存储在本地文件系统

### 2. 发现机制

提供多种发现方式，适应不同网络环境。

- **mDNS 零配置发现** — 局域网内自动发现，无需手动配置
- **Registry 目录服务** — 可选的中心化目录，支持广域网发现
- **Relay 中继服务** — 穿越 NAT 和防火墙的通信中继

### 3. 消息传输层

基于 WebSocket 的实时消息传输，支持多种通信模式。

- **WebSocket 直连** — 点对点直接通信
- **Webhook 回调** — 适合长时异步任务的结果通知
- **混合模式** — 同步响应用 WebSocket，异步回调用 Webhook

### 4. 安全与信任

强制签名验证和灵活的信任管理机制。

- **Ed25519 签名** — 所有消息强制签名验证
- **TOFU（Trust On First Use）** — 首次使用自动信任
- **信任存储** — 可配置的信任策略和黑名单

### 5. MCP 集成

原生支持 Model Context Protocol，可直接作为 MCP 服务运行。

- **MCP Server** — 暴露 ADP 能力为 MCP 工具
- **Claude Desktop 兼容** — 无缝集成到 Claude Desktop
- **工具发现** — 自动发现和调用其他 ADP Agent

## 技术目标

- **去中心化优先** — 局域网内无需任何中心化服务即可工作
- **安全第一** — 所有消息强制签名验证，防止中间人攻击
- **互操作性** — 兼容 OpenClaw、Hermes Agent 等主流 Agent 框架
- **可观测性** — 完整的日志和追踪机制
- **可扩展性** — 模块化设计，支持自定义能力处理器

## 架构

```
┌───────────────────────────────────────────────────────────────────┐
│                    应用层（Agent 框架）                      │
│  OpenClaw • Hermes Agent • MCP Host • 自定义应用              │
└────────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────────▼────────────────────────────────────┐
│                    ADP Gateway                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ 能力处理器    │  │ 任务管理器    │  │ 联系人管理   │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
└────────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────────▼────────────────────────────────────┐
│                    消息层（Envelope）                         │
│  协议版本 • 消息 ID • 发送方 • 接收方 • 动作 • 参数 • 签名  │
└────────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────────▼────────────────────────────────────┐
│                    传输层                                     │
│  ┌──────────────┐              ┌──────────────┐            │
│  │ WebSocket    │              │ Webhook      │            │
│  │ 直连/中继    │              │ 回调通知      │            │
│  └──────────────┘              └──────────────┘            │
└────────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────────▼────────────────────────────────────┐
│                    发现层                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ mDNS        │  │ Registry     │  │ Relay        │   │
│  │ 局域网发现    │  │ 目录服务      │  │ NAT 中继     │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
└───────────────────────────────────────────────────────────────────┘
```

## 快速开始

### 前置要求

- **Node.js** : 18+
- **npm** : 9+
- **TypeScript** : 5.4+（开发时）

### 本地开发

1. **克隆仓库**

```bash
git clone https://github.com/mengzhuowei/AgentDiscoveryProtocol.git
cd AgentDiscoveryProtocol
```

2. **安装依赖**

```bash
npm install
```

3. **启动 Agent**

```bash
# 终端 1：启动第一个 Agent
npm start

# 终端 2：启动第二个 Agent（自动发现第一个）
npm start
```

### Docker 部署

```bash
# 启动完整 ADP 生态系统（Gateway + Registry + Relay）
docker-compose up -d
```

详见 [Docker 部署指南](docs/docker.md)。

## 安装

### 作为库使用

```bash
npm install adp-agent
```

### 全局安装（获得 CLI 工具）

```bash
npm install -g adp-agent
```

安装后，`skill/` 目录会被自动复制到你的项目根目录，包含完整的集成文档。

## 使用示例

### 基础 Gateway

```typescript
import { Gateway, loadOrCreateIdentity } from 'adp-agent';

const { identity } = loadOrCreateIdentity('myapp', 'my-agent', 'My Agent');

const gateway = new Gateway({
  port: 9900,
  host: '0.0.0.0',
  secretKey: identity.secretKey,
  agentId: identity.agentId,
  displayName: 'My Agent',
  capabilities: ['adp:ping', 'adp:capability.query'],
});

console.log(`Agent running at ws://localhost:9900/adp`);
console.log(`Agent ID: ${identity.agentId}`);
```

### 自定义能力处理器

```typescript
import { Gateway, loadOrCreateIdentity, signEnvelope, generateMessageId, canonicalize } from 'adp-agent';

const { identity } = loadOrCreateIdentity('myapp', 'video-agent', 'VideoAgent');

const gateway = new Gateway({
  port: 9900,
  secretKey: identity.secretKey,
  agentId: identity.agentId,
  displayName: 'Video Generator',
  capabilities: [
    'adp:ping',
    'adp:capability.query',
    {
      capability: 'custom:video.generate',
      description: 'Generate video from prompt',
      input_schema: {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          duration: { type: 'integer', default: 5 },
        },
        required: ['prompt'],
      },
    },
  ],
  customHandlers: {
    'custom:video.generate': async (ws, envelope) => {
      const params = envelope.params as { prompt?: string; duration?: number };
      
      console.log(`Generating video: ${params.prompt}`);
      
      const reply = signEnvelope({
        protocol: 'adp/0.2',
        id: generateMessageId(),
        from: identity.agentId,
        to: envelope.from,
        action: 'custom:video.generate',
        params: {
          video_url: 'https://cdn.example.com/video.mp4',
        },
        reply_to: envelope.id,
        timestamp: new Date().toISOString(),
      }, identity.secretKey, canonicalize);
      
      ws.send(JSON.stringify(reply));
    },
  },
});
```

### Agent 发现

```typescript
import { Discovery, loadOrCreateIdentity } from 'adp-agent';

const { identity } = loadOrCreateIdentity('myapp', 'discovery-demo', 'DiscoveryDemo');

const discovery = new Discovery(identity.agentId, 9900, {
  onPeerDiscovered: (peer) => {
    console.log(`Found agent: ${peer.agentId}`);
    console.log(`Address: ${peer.host}:${peer.port}`);
    console.log(`Capabilities:`, peer.manifest?.capabilities);
  },
  onPeerLost: (agentId) => {
    console.log(`Agent lost: ${agentId}`);
  },
});

discovery.start();
```

### MCP Server 模式

```typescript
import { AdpMcpServer } from 'adp-agent';

const server = new AdpMcpServer({
  tag: 'my-agent',
  namespace: 'myapp',
  agentName: 'adp-mcp',
  displayName: 'ADP MCP Agent',
  portBase: 9900,
  capabilities: [
    'adp:ping',
    'adp:capability.query',
    {
      capability: 'custom:my-action',
      description: 'My custom action',
      input_schema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  ],
});

await server.start();
```

更多示例见 [examples/](examples/) 目录。

## 开发

```bash
npm test                             # 运行测试
npm run test:integration     # 集成测试
npm run test:coverage       # 测试覆盖率
npm run build               # 编译到 dist/
npm run dev                # 监听模式编译
```

### 启动服务

```bash
npm run relay               # 启动 Relay 服务
npm run registry            # 启动 Registry 服务
npm run adp                # 启动 MCP Server
```

## 文档

| 文档 | 说明 |
|------|------|
| [使用指南](USAGE.md) | 完整的使用说明和配置选项 |
| [Docker 部署](docs/docker.md) | Docker 部署指南 |
| [身份与 Manifest](docs/01-identity.md) | Agent ID、能力声明、密钥管理 |
| [消息格式](docs/02-message.md) | Envelope、签名、错误码 |
| [发现机制](docs/03-discovery.md) | mDNS、Registry、Relay |
| [传输层](docs/04-transport.md) | WebSocket、Webhook、混合模式 |
| [安全与信任](docs/05-security.md) | TOFU、签名验证、信任存储 |
| [实现检查清单](docs/implementation-checklist.md) | 协议合规性检查 |
| [集成文档](skill/SKILL.md) | OpenClaw、Hermes Agent 集成指南 |

## 路线图

- [x] **v0.2** — 自认证身份、签名验证、TOFU
- [x] **Registry** — 中心化目录服务
- [x] **MCP 集成** — 作为 MCP 服务运行
- [x] **Webhook 通信** — 异步任务回调支持
- [x] **密钥轮换** — 安全的密钥更新机制
- [ ] **任务委派** — 跨 Agent 任务调度
- [ ] **端到端加密** — 可选 E2EE
- [ ] **更多语言实现** — Python、Rust、Go

## 贡献

我们欢迎贡献！请遵循以下步骤：

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

详见 [代码规范](docs/implementation-checklist.md)。

## 许可证

MIT © [ADP Working Group](https://github.com/mengzhuowei/AgentDiscoveryProtocol)

## 支持与联系

- **Issues** : [GitHub Issues](https://github.com/mengzhuowei/AgentDiscoveryProtocol/issues)
- **讨论** : [GitHub Discussions](https://github.com/mengzhuowei/AgentDiscoveryProtocol/discussions)
- **邮件** : mengzhuowei@qq.com
