# Agent Discovery Protocol (ADP)

**协议版本：** `adp/0.2`（草案）
**更新：** 2026-05-17

## 概述

ADP 是一套轻量协议标准，让智能体（Agent）之间能够**互相发现**并**直接通信**。不依赖中心化平台。

v0.2 引入**自认证密码学身份**——Agent ID 嵌入公钥指纹，持有私钥即拥有该 ID，无需 CA 或 PKI。所有消息强制 Ed25519 签名验证。

## 设计原则

1. **最小核心** — 只定义发现与消息投递的原语。任务委派、工作流编排留给上层扩展
2. **去中心化优先** — 局域网场景用 mDNS 零配置发现，Registry 和 Relay 是可选的增强
3. **自认证身份** — Agent ID 的 user 段为 Ed25519 公钥指纹（`adp://{proof_of_id}@domain/agent`），与以太坊钱包地址原理一致
4. **强制签名验证** — 所有消息必须附带 Ed25519 签名，Manifest 必须自签名。无签名 = 拒绝
5. **实现自由** — 只定义 wire protocol，不限定语言、运行时、部署方式

## 架构

```
┌──────────────────────────────────────────┐
│               发现层                      │
│  mDNS（局域网） / 静态配置 / Registry     │
└──────────────────┬───────────────────────┘
                   │
┌──────────────────▼───────────────────────┐
│               传输层                      │
│  WebSocket 直连 / Relay 中继             │
└──────────────────┬───────────────────────┘
                   │
┌──────────────────▼───────────────────────┐
│               消息层                      │
│  统一 Envelope + Ed25519 强制签名        │
└──────────────────────────────────────────┘
```

## 文档

| 文件 | 内容 |
|------|------|
| [`01-identity.md`](01-identity.md) | Agent ID 格式、Manifest、标准能力 |
| [`02-message.md`](02-message.md) | 统一消息格式、签名、错误码 |
| [`03-discovery.md`](03-discovery.md) | mDNS / 静态配置 / Registry 三种发现方式 |
| [`04-transport.md`](04-transport.md) | WebSocket 传输、直连、Relay 中继 |
| [`05-security.md`](05-security.md) | 威胁模型、TOFU 信任、TLS |
| [`06-signatures.md`](06-signatures.md) | 密码学身份规范（proof_of_id 推导、签名、验证） |
| [`use-cases.md`](use-cases.md) | 典型使用场景 |

## 术语

| 术语 | 含义 |
|------|------|
| **Agent** | 智能体实体，ADP 协议的参与者 |
| **Agent ID** | 自认证标识符，格式 `adp://{proof_of_id}@domain/agent` |
| **proof_of_id** | 从 Ed25519 公钥推导的指纹，嵌入 Agent ID |
| **Manifest** | Agent 公开的身份与能力声明（自签名） |
| **Gateway** | Agent 的网络通信模块（可嵌入或独立进程） |
| **Registry** | 可选的中心化目录服务，存 Agent ID → 接入点映射 |
| **Relay** | 可选的公网中继节点，用于 NAT 穿透 |
| **TOFU** | Trust On First Use，首次相遇钉扎公钥 |
| **Trust Store** | 本地持久化存储，记录已验证的 Agent → public_key 映射 |

## 协议版本

当前版本 `adp/0.2` 为草案阶段，MAJOR = 0 表示 API 不稳定。版本格式为 `MAJOR.MINOR`——MAJOR 变更表示不兼容，MINOR 变更向前兼容。

### v0.1 → v0.2 变更

| v0.1 | v0.2 |
|------|------|
| 白名单为唯一信任锚 | Ed25519 强制签名验证 + TOFU 信任 |
| Agent ID: `adp://user@domain/agent` | Agent ID: `adp://{proof_of_id}@domain/agent` |
| 无签名 | Ed25519 消息签名 + Manifest 自签名 |
| 身份自声明，无法证明 | 自认证身份，持有私钥 = 拥有 ID |

## 路线图

1. **协议定稿**（当前）— 社区反馈与修订
2. **参考实现** — TypeScript SDK + Registry + Relay
3. **协议扩展** — 任务委派、端到端加密

详见 [GitHub 仓库](https://github.com/nous-research/adp)。
