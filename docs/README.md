# Agent Discovery & Protocol (ADP)

**版本：** v0.1（草案）
**状态：** 讨论阶段
**更新：** 2026-05-15

## 概述

ADP 是一套开放的、轻量级的协议标准，用于智能体（Agent）之间的**互相发现**与**消息通信**。目标是在不依赖中心化平台的前提下，让每个人拥有的智能体能相互联通与协作。

## 设计原则

1. **最小核心** — 协议只定义发现与消息投递的最小原语，上层协作模式留给具体实现
2. **运输无关** — Agent 不需要关心消息走的是直连、Relay 还是局域网，Gateway 层自动路由
3. **身份优先** — Agent 间以 `Agent ID` 为唯一标识，不绑定 IP、域名或具体网络拓扑
4. **渐进信任** — 初期信任基于白名单 + 签名，后期可扩展证书/DID 等方案
5. **实现自由** — 协议层只定义交互格式与流程，不限定编程语言、运行时或部署方式

## 架构概览

```
┌─────────────────────────────────────────────┐
│                Registry                      │
│  存: Agent ID → 当前接入点地址                │
│  不存消息，不转发数据                          │
│  可选部署（可自建 / 用公共实例 / 本地缓存）    │
└──────────────────┬──────────────────────────┘
                   │
        ┌──────────┼──────────┐
        │          │          │
   ┌────▼────┐ ┌──▼────┐ ┌──▼──────┐
   │Gateway A│ │Gateway B│ │  Relay  │
   │ (Agent) │ │ (Agent) │ │(中继节点)│
   └─────────┘ └─────────┘ └─────────┘
```

- **Agent**：智能体本体，运行在用户设备上（NAS、PC、服务器、边缘设备）
- **Gateway**：每个 Agent 本地运行的守护进程，负责消息路由、NAT 穿透、Relay 选择
- **Registry**：轻量目录服务，存储 Agent ID 到当前接入点的映射
- **Relay**：可选的公网中转节点，部署在 VPS 上，用于双方都在 NAT 后的场景

## 文档结构

| 文件 | 内容 |
|---|---|
| [`01-identifiers.md`](01-identifiers.md) | Agent ID 格式、命名规则、解析方式 |
| [`02-manifest.md`](02-manifest.md) | Manifest 结构、能力声明规范 |
| [`03-message.md`](03-message.md) | Envelope 格式、消息类型、签名字段定义 |
| [`04-registry.md`](04-registry.md) | 注册、发现、解析的 API 定义 |
| [`05-transport.md`](05-transport.md) | 传输层：直连 / Relay / 回退策略 |
| [`06-gateway.md`](06-gateway.md) | Gateway 职责与内部接口 |
| [`07-capabilities.md`](07-capabilities.md) | 标准动作原语定义 |
| [`08-sdk-design.md`](08-sdk-design.md) | SDK 开发者设计草案 |
| [`09-security.md`](09-security.md) | 安全模型（威胁模型、传输安全、身份认证） |
| [`10-communication-patterns.md`](10-communication-patterns.md) | 六种标准通信模式 |
| [`11-implementation-guide.md`](11-implementation-guide.md) | 实现指南（SDK / Registry / Relay） |
| [`12-use-cases.md`](12-use-cases.md) | 典型使用场景 |
| [`13-task-lifecycle.md`](13-task-lifecycle.md) | 任务生命周期、状态机与异常恢复 |
| [`14-relay-protocol.md`](14-relay-protocol.md) | Relay 完整协议（会话管理、转发、缓存） |
| [`15-message-signing.md`](15-message-signing.md) | 消息签名与验证规范 |
| [`16-version-negotiation.md`](16-version-negotiation.md) | 协议版本协商与兼容性 |
| [`17-configuration.md`](17-configuration.md) | Gateway 统一配置规范 |
| [`ROADMAP.md`](ROADMAP.md) | 项目路线图 |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | 贡献指南 |
| [`CHANGELOG.md`](CHANGELOG.md) | 版本演进记录 |

## 术语表

| 术语 | 含义 |
|---|---|
| **Agent** | 智能体实体，ADP 协议的参与者 |
| **Agent ID** | Agent 的唯一标识符，形如 `adp://user@domain/agent` |
| **Gateway** | Agent 本地的通信守护进程 |
| **Registry** | Agent ID 到接入点的解析服务 |
| **Relay** | 公网消息中转节点 |
| **Manifest** | Agent 公开的能力声明文档 |
| **Envelope** | 消息信封，所有通信的标准包装格式 |
| **Route** | 从源 Gateway 到目标 Gateway 的网络路径 |
| **AccessPoint** | Agent 当前的网络接入点（IP、端口、协议） |
