# Agent Discovery Protocol (ADP)

**协议版本：** `adp/0.2`（草案）
**更新：** 2026-05-20

## 概述

ADP 是一套轻量协议标准，让智能体（Agent）之间能够**互相发现**并**直接通信**。不依赖中心化平台。

v0.2 引入**自认证密码学身份**——Agent ID 直接嵌入完整 Ed25519 公钥，持有私钥即拥有该 ID，无需 CA 或 PKI。所有 Agent 间 Envelope 消息强制 Ed25519 签名验证。

## 设计原则

1. **最小核心** — 只定义发现与消息投递的原语。`adp:task.*` 提供可选的任务级抽象（5 态最小状态机），复杂工作流编排留给上层扩展
2. **去中心化优先** — 局域网场景用 mDNS 零配置发现，Registry 和 Relay 是可选的增强
3. **自认证身份 + 强制签名** — Agent ID 的 user 段为 Base64URL 编码的 Ed25519 公钥，与 libp2p peer ID、Nostr npub 原理一致（编码格式不同，语义相同）。持有私钥即拥有该 ID，无需 CA 或 PKI。所有 Agent 间 Envelope 消息必须附带 Ed25519 签名，无签名 = 拒绝
4. **实现自由** — 只定义 wire protocol，不限定语言、运行时、部署方式

## 架构

```
┌──────────────────────────────────────────┐
│               消息层                      │
│  统一 Envelope + Ed25519 强制签名        │
└──────────────────┬───────────────────────┘
                   ▲
┌──────────────────┴───────────────────────┐
│               传输层                      │
│  WebSocket 直连 / Relay 中继             │
└──────────────────┬───────────────────────┘
                   ▲
┌──────────────────┴───────────────────────┐
│               发现层                      │
│  mDNS（局域网） / 静态配置 / Registry     │
└──────────────────────────────────────────┘
```

## 文档

### 快速开始

| 文件 | 内容 |
|------|------|
| [`docker.md`](docker.md) | Docker 部署指南，部署 Registry 和相关服务 |
| [`quickstart.md`](quickstart.md) | 快速入门指南，搭建第一个最小 Agent |
| [`communication.md`](communication.md) | Agent 通信方式详解（WebSocket、Webhook、Hybrid） |

### 协议规范

| 文件 | 内容 |
|------|------|
| [`01-identity.md`](01-identity.md) | Agent ID 格式、Manifest、标准能力、I/O 模式、任务抽象 |
| [`02-message.md`](02-message.md) | 统一消息格式、签名、错误码、分布式追踪 |
| [`03-discovery.md`](03-discovery.md) | mDNS / 静态配置 / Registry 三种发现方式 |
| [`04-transport.md`](04-transport.md) | WebSocket 传输、直连、Relay 中继 |
| [`05-security.md`](05-security.md) | 威胁模型、TOFU 信任、TLS、Registry 签名验证 |
| [`06-signatures.md`](06-signatures.md) | 密码学身份规范（公钥编码、消息签名、验证） |
| [`use-cases.md`](use-cases.md) | 典型使用场景 |

### 开发指南

| 文件 | 内容 |
|------|------|
| [`implementation-checklist.md`](implementation-checklist.md) | 实现检查清单，验证协议合规性 |
| [`code-examples.md`](code-examples.md) | TypeScript/Python 代码示例 |
| [`testing.md`](testing.md) | 测试规范，包含测试向量和互操作测试 |
| [`design-decisions.md`](design-decisions.md) | 关键设计决策记录及理由 |
| [`deployment.md`](deployment.md) | Gateway、Registry、Relay 部署指南 |
| [`best-practices.md`](best-practices.md) | ADP 最佳实践指南 |
| [`troubleshooting.md`](troubleshooting.md) | 常见问题诊断和解决方案 |

## 术语

| 术语 | 含义 |
|------|------|
| **Agent** | 智能体实体，ADP 协议的参与者 |
| **Agent ID** | 自认证标识符，格式 `adp://{pubkey_b64url}@namespace/agent` |
| **pubkey_b64url** | Base64URL 编码的 Ed25519 公钥，嵌入 Agent ID user 段 |
| **Manifest** | Agent 公开的能力与路由声明。无签名，身份由消息层的 Ed25519 签名保证 |
| **Gateway** | Agent 的网络通信模块（可嵌入或独立进程） |
| **Registry** | 可选的中心化目录服务，存 Agent 身份 → 接入点映射 |
| **initial_id** | 首次注册时的 Agent ID，作为 Registry 的稳定 URL 标识，密钥轮换后不变 |
| **rotation_chain** | Registry 存储的密钥轮换历史链，对端可逐跳验证从 initial_id 到 current_agent_id 的信任传递 |
| **visual_code** | 从公钥经 BLAKE2b 哈希派生的 8 字符短标识，仅用于带外人工比对 |
| **pinned trust** | 预信任模式——静态配置中预埋 Agent ID + public_key，完全跳过 TOFU |
| **Relay** | 可选的公网中继节点，用于 NAT 穿透 |
| **TOFU** | Trust On First Use，首次相遇钉扎公钥 |
| **Trust Store** | 本地持久化存储，记录已验证的 Agent → public_key 映射 |
| **Task** | 可追踪的异步工作单元，5 态状态机（PENDING → WORKING → COMPLETED/FAILED/CANCELED），通过 `adp:task.*` 能力提供 |

## 协议版本

当前版本 `adp/0.2` 为草案阶段，MAJOR = 0 表示 API 不稳定。版本格式为 `MAJOR.MINOR`——MAJOR 变更表示不兼容，MINOR 变更向前兼容。

### v0.1 → v0.2 变更

| v0.1 | v0.2 |
|------|------|
| 白名单为唯一信任锚 | Ed25519 强制签名验证 + TOFU 信任 |
| Agent ID: `adp://user@namespace/agent` | Agent ID: `adp://{pubkey_b64url}@namespace/agent` |
| 无签名 | Ed25519 消息签名（Agent ID 即公钥，一步验签） |
| 身份自声明，无法证明 | 自认证身份，持有私钥 = 拥有 ID |

### v0.2 后续更新（2026-05-19）

| 新增 | 说明 |
|------|------|
| `input_modes` / `output_modes` | Manifest 能力声明支持 MIME 类型约束，对端在调用前知道该传什么格式 |
| `adp:task.*` | 可选任务抽象——5 态最小状态机（PENDING → WORKING → COMPLETED/FAILED/CANCELED），底层仍是标准 Envelope + 签名 |
| `trace_id` / `span_id` | Envelope 可选追踪字段，与 W3C Trace Context / OpenTelemetry 兼容 |

## 路线图

1. **协议定稿**（当前）— 社区反馈与修订
2. **参考实现** — TypeScript SDK + Registry + Relay
3. **协议扩展** — 任务委派、端到端加密

详见 [GitHub 仓库](https://github.com/mengzhuowei/AgentDiscoveryProtocol)。
