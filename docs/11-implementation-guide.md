# ADP 实现指南

**更新：** 2026-05-15
**状态：** 草案（v0.1）

---

## 概述

本文档指导开发者如何实现 ADP 协议的各个组件。如果你是 SDK 开发者、Registry 部署者或 Relay 节点运营者，本文档是你的起点。

---

## 一、实现一个 ADP 客户端（SDK）

### 最小实现需要支持的功能

| 功能 | 说明 | 优先级 |
|---|---|---|
| Agent ID 解析 | 解析 `adp://user@domain/agent` 格式 | 必须 |
| Envelope 构建 | 创建/解析消息信封 | 必须 |
| Manifest 构建 | 构建 Agent 的能力声明 | 必须 |
| WebSocket 监听 | 启动 WS 服务端，接收传入消息 | 必须 |
| Registry 注册 | 启动时注册，定时刷新 | 必须 |
| 消息路由 | 解析目标 ID → 找到地址 → 发送消息 | 必须 |
| 心跳 (Gateway↔Gateway) | 30s ping/pong | 必须 |
| 心跳 (Gateway↔Relay) | 15s ping/pong | Relay 连接时必须 |
| 重连 | 断线后指数退避重连 | 推荐 |
| Relay 支持 | 通过 Relay 中继消息 | 可选 |
| 消息签名 | 可选的消息签名/验签 | 可选 |
| 事件系统 | 对外暴露事件（message/error/online） | 推荐 |

### 参考架构

```
┌────────────────────────────────┐
│            Agent               │
│  (你的 AI Agent / 应用程序)     │
└──────────────┬─────────────────┘
               │ localhost (REST/WS)
               ▼
┌────────────────────────────────┐
│          ADP Client            │
│                                │
│  ┌──────┐ ┌──────┐ ┌───────┐  │
│  │ Router│ │Relay │ │Registry│  │
│  │       │ │Client│ │Client  │  │
│  └──────┘ └──────┘ └───────┘  │
│  ┌─────────────────────────┐   │
│  │   WebSocket Server      │   │
│  └─────────────────────────┘   │
└────────────────────────────────┘
```

### 状态管理

| 状态 | 说明 |
|---|---|
| `stopped` | 初始状态，未启动 |
| `starting` | 正在启动（连接 Registry + 启动 WS） |
| `online` | 正常运行 |
| `reconnecting` | 连接断开，正在重连 |
| `stopping` | 正在关闭 |
| `error` | 不可恢复的错误 |

**状态转换规则：**

| 起始状态 | 目标状态 | 触发条件 |
|---|---|---|
| `stopped` | `starting` | 调用 `agent.start()` |
| `starting` | `online` | Registry 注册成功 + WebSocket 服务启动成功 |
| `starting` | `error` | Registry 注册连续失败 5 次，或端口被占用 |
| `online` | `reconnecting` | 心跳超时（90s 无响应），或 WebSocket 连接断开 |
| `reconnecting` | `online` | 重连成功（Registry 重新注册 + 连接恢复） |
| `reconnecting` | `error` | 重试超过最大次数（5 次），或 TTL 超时 |
| `online` | `stopping` | 调用 `agent.stop()` |
| `reconnecting` | `stopping` | 调用 `agent.stop()` |
| `error` | `stopped` | 错误处理完成后自动或手动重置 |
| `stopping` | `stopped` | 注销 Registry、关闭所有连接、释放端口 |

---

## 二、部署一个 Registry 服务

### 最低要求

| 组件 | 说明 |
|---|---|
| HTTP 服务器 | 处理注册/解析/搜索请求 |
| 存储后端 | MySQL / PostgreSQL / SQLite / 内存 |
| 缓存（可选） | Redis / Memcached，用于加速解析 |

### API 清单

实现 `/adp/v1/` 路径下的 6 个端点：

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/adp/v1/register` | 注册 Agent |
| POST | `/adp/v1/refresh` | 刷新注册 |
| POST | `/adp/v1/unregister` | 注销 |
| GET | `/adp/v1/resolve` | 解析 Agent ID |
| GET | `/adp/v1/search` | 搜索 Agent |
| GET | `/health` | 健康检查 |

完整的请求/响应格式参见 [04-registry.md](04-registry.md)。

### 缓存策略

```
注册: 写 DB → 写 Redis (TTL=30min)
解析: 读 Redis → 命中返回 → 回源 DB → 写 Redis
刷新: 只更新 Redis TTL → 不写 DB
注销: 删 DB → 删 Redis
```

**崩溃恢复：** Registry 重启时，Redis 缓存为空。Registry 应从 DB 中重建路由缓存（扫描所有未过期的注册记录写入 Redis）。DB 是注册数据的持久化来源，Redis 仅为加速层，数据丢失不影响最终一致性。

### 推荐部署

```
        Internet
            │
      ┌─────▼──────┐
      │  Nginx/Caddy │  ← TLS 终止
      └─────┬──────┘
      ┌─────▼──────┐
      │  Registry   │  ← Node.js / Go / Rust
      └──┬──────┬──┘
    ┌────▼──┐ ┌─▼────┐
    │ MySQL │ │ Redis │
    └───────┘ └──────┘
```

---

## 三、部署一个 Relay 节点

Relay 的完整协议规范见 [14-relay-protocol.md](14-relay-protocol.md)。

### 职责

| 功能 | 说明 |
|---|---|
| 连接管理 | 维护 Agent → WebSocket 连接映射 |
| 消息转发 | 根据 Envelope 的 `to` 字段投递消息 |
| 心跳 | 检测 Agent 连接健康 |
| 离线缓存（可选） | Agent 离线时保留消息，上线后推送 |

### 最小功能

```python
# Relay 的核心逻辑 (伪代码)

connections: dict[str, WebSocket] = {}

async def on_connect(ws, agent_id):
    connections[agent_id] = ws

async def on_message(ws, raw):
    envelope = json.parse(raw)
    target_ws = connections.get(envelope.to)
    if target_ws:
        target_ws.send(raw)
    else:
        # 缓存或丢弃
        pass

async def on_disconnect(agent_id):
    connections.pop(agent_id, None)
```

### 部署建议

- 需要公网 IP 或云服务器（最小规格即可）
- 建议启用 `wss://`（通过反向代理加 TLS）
- 不与 Registry 部署在同一节点（避免单点故障）
- 推荐使用 TURN 风格的认证（Relay Token）

---

## 四、实现选择

### 后端语言推荐

| 组件 | 推荐语言 | 理由 |
|---|---|---|
| SDK / 客户端 | TypeScript / Python | 生态成熟，Agent 多基于这两种语言 |
| Registry | Go / Rust / TypeScript | 高并发 HTTP 服务 |
| Relay | Go / Rust / TypeScript | 大量长连接管理，需要高性能 I/O |

### 测试策略

1. **单元测试**：Envelope 构建/解析、Agent ID 校验、Manifest 序列化
2. **集成测试**：两个 Agent 通过本地 Registry 互相 ping
3. **端到端测试**：两个 Agent 在不同机器上通过公网 Registry + Relay 通信
4. **压力测试**：模拟大量 Agent 并发注册、解析

---

## 五、兼容性要求

| 特性 | 要求 |
|---|---|
| Envelope 格式 | 严格遵循规范，新增字段必须可选 |
| 标准能力 | 必须实现 `adp:ping` 和 `adp:capability.query` |
| Registry 端点路径 | 必须使用 `/adp/v1/` 路径前缀 |
| 响应格式 | 统一 `{ status, data, error }` 结构 |
| Agent ID | 必须符合 `adp://user@domain[/agent]` 格式 |
