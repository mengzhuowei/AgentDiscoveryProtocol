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
  <a href="#-架构">架构</a> •
  <a href="#-文档">文档</a>
</div>

<br>

---

## 特性

- **自认证密码学身份** — Agent ID 嵌入 Ed25519 公钥，持有私钥即拥有 ID
- **去中心化优先** — 局域网 mDNS 零配置发现，Registry/Relay 可选
- **强制签名验证** — 所有消息 Ed25519 签名
- **模块化架构** — Gateway、Registry、Relay 独立部署
- **MCP 兼容** — 直接作为 MCP（Model Context Protocol）服务运行
- **开箱即用** — TypeScript 完整实现，含示例和测试

## 快速开始

```bash
git clone https://github.com/mengzhuowei/AgentDiscoveryProtocol.git
cd AgentDiscoveryProtocol
npm install
npm start agent1          # 终端 1
npm start agent2          # 终端 2，自动发现 agent1
```

## 安装

```bash
npm install adp-agent             # 作为库
npm install -g adp-agent          # 全局安装，获得 adp 命令
```

## 使用示例

```typescript
import { Gateway, loadOrCreateIdentity } from 'adp-agent';

const { identity } = loadOrCreateIdentity('local', 'my-agent', 'My Agent');
const gateway = new Gateway({
  port: 9900,
  host: '0.0.0.0',
  secretKey: identity.secretKey,
  agentId: identity.agentId,
  displayName: 'My Agent',
  capabilities: ['adp:ping', 'adp:capability.query'],
});
```

详细的启动参数、配置、MCP Server 集成等见 [USAGE.md](USAGE.md)。

## 架构

```
┌───────────────────────────────────┐
│              应用层               │
│  自定义能力（视频生成、计算等）   │
└──────────────┬────────────────────┘
               │
┌──────────────▼────────────────────┐
│             消息层                │
│  Envelope + Ed25519 签名 + 任务   │
└──────────────┬────────────────────┘
               │
┌──────────────▼────────────────────┐
│             传输层                │
│  WebSocket 直连 ── Relay 中继    │
└──────────────┬────────────────────┘
               │
┌──────────────▼────────────────────┐
│             发现层                │
│  mDNS ── Registry 目录（可选）   │
└───────────────────────────────────┘
```

## 开发

```bash
npm test                    # 核心测试
npm run test:integration    # 集成测试
npm run relay               # 启动 Relay
npm run registry            # 启动 Registry
npm run build               # 编译到 dist/
```

## 文档

| 文档 | 说明 |
|------|------|
| [Docker 部署指南](docs/docker.md) | 使用 Docker 部署 |
| [身份与 Manifest](docs/01-identity.md) | Agent ID、能力声明 |
| [消息格式](docs/02-message.md) | Envelope、签名、错误码 |
| [发现机制](docs/03-discovery.md) | mDNS、Registry |
| [传输层](docs/04-transport.md) | WebSocket、Relay |
| [安全与信任](docs/05-security.md) | TOFU、签名验证 |
| [实现检查清单](docs/implementation-checklist.md) | 协议合规性 |

## 路线图

- [x] **v0.2** — 自认证身份、签名验证、TOFU
- [x] **Registry** — 中心化目录服务
- [x] **MCP 集成** — 作为 MCP 服务运行
- [ ] **任务委派** — 跨 Agent 任务调度
- [ ] **端到端加密** — 可选 E2EE
- [ ] **更多语言实现** — Python、Rust

## 许可证

MIT © [ADP Working Group](https://github.com/mengzhuowei/AgentDiscoveryProtocol)
