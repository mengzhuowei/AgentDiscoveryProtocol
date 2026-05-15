# 06 - Gateway 规范

## 概述

Gateway 是每个 Agent 本地的通信守护进程，是 Agent 接入 ADP 网络的唯一入口。Agent 自身不直接处理网络通信，而是通过本地接口与 Gateway 交互。

## Gateway 的职责

1. **消息路由** — 接收 Agent 发出的消息，选择最优路径投递到目标 Gateway
2. **注册与刷新** — 定期向 Registry 注册/刷新本 Agent 的存在状态
3. **NAT 穿透** — 自动选择直连或 Relay
4. **多路复用** — 同时维护到多个目标的连接
5. **离线缓冲** — Agent 临时离线时缓存待发送消息
6. **会话管理** — 维护 thread_id 与连接状态的关系
7. **消息重试** — 投递失败后按策略重试

## Gateway 内部架构

```
┌────────────────────────────────┐
│           Agent (进程)          │
│  adp://alice@example.com/hermes│
└──────────────┬─────────────────┘
               │ localhost:9700 (HTTP/Unix Socket)
               ▼
┌────────────────────────────────┐
│         Gateway 守护进程         │
│                                │
│  ┌──────┐ ┌──────┐ ┌───────┐  │
│  │ Router│ │Relay │ │Registry│  │
│  │       │ │Client│ │Client  │  │
│  └──────┘ └──────┘ └───────┘  │
│                                │
│  ┌─────────────────────────┐   │
│  │   连接管理器 (ConnPool)    │   │
│  │  WebSocket / HTTP / ...  │   │
│  └─────────────────────────┘   │
└────────────────────────────────┘
               │
               ▼
          ADP 网络（其他 Gateway / Relay / Registry）
```

## Agent → Gateway 接口

Gateway 监听本地端口供 Agent 使用。**安全提醒：** 本地接口应仅绑定 `127.0.0.1`（不暴露到外网）。如果使用 Unix Socket，应设置文件权限为 `0600` 限制其他用户访问。生产环境可增加本地 token 认证（`Authorization: Bearer <local_token>`）。

推荐两种模式：

### 模式 A：HTTP REST（推荐）

```
localhost:9700/adp/v1/send      POST   → 发送消息
localhost:9700/adp/v1/inbox     GET    → 拉取待处理消息
localhost:9700/adp/v1/status    GET    → 查询 Gateway 状态
localhost:9700/adp/v1/agents    GET    → 列出已知 Agent
```

### 模式 B：Unix Domain Socket

```
/var/run/adp-gateway.sock
```

与 HTTP REST 语义相同，通过 Unix Socket 访问避免端口冲突。

### 发送消息

```
POST /adp/v1/send
{
  "to": "adp://bob@home.io/claude",
  "type": "request",
  "body": {
    "action": "adp:ping",
    "params": {}
  }
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `to` | 是 | 目标 Agent ID |
| `type` | 是 | 消息类型：`"request"`、`"push"`。Agent 通过此字段告诉 Gateway 期望的投递语义 |
| `body.action` | 是 | 动作标识 |
| `body.params` | 是 | 动作参数 |
| `thread_id` | 否 | 会话 ID。若不提供，Gateway 自动生成新的 |

**Gateway 自动填充：** Gateway 负责补全 `from`（本 Agent ID）、`message_id`（`msg_` 前缀 UUID）、`adp_version`、`timestamp`（发送时刻）、`ttl`（默认 300）。若 Agent 提供了 `thread_id` 则沿用，否则 Gateway 生成新的 `thread_id`。

**响应：**

```json
{
  "message_id": "msg_2x4k9m7q",
  "status": "queued",
  "thread_id": "thr_a1b2c3d4"
}
```

- `status: "queued"` — Gateway 已接受，正在投递
- `status: "delivered"` — 已送达目标 Gateway
- `status: "failed"` — 投递失败

### 接收消息

Gateway 支持两种接收方式：

**1. 长轮询：**

```
GET /adp/v1/inbox?last_id=msg_xxx&timeout=30
```

Gateway 保持连接，有新消息时立即返回，或等 timeout 秒后返回空列表。

**2. WebSocket 推送（推荐）：**

Agent 连接 Gateway 的 WebSocket 端点，Gateway 实时推送新消息。

```
ws://localhost:9700/adp/ws
```

## 错误处理

Gateway 应健壮地处理以下场景：

| 场景 | 行为 |
|---|---|
| 目标离线 | 缓存消息（最多 500 条/目标，最多保留 1 小时），重试 3 次。若 Gateway 已连接 Relay 且消息通过 Relay 投递，由 Relay 负责离线缓存；若消息通过直连投递则 Gateway 自行缓存。Gateway 根据当前使用的路由类型（直连 vs Relay）自动决定 |
| 目标不存在 | 立即返回错误 `AGENT_NOT_FOUND` |
| 消息超时 | 检查 TTL，超时则丢弃，返回 `TIMEOUT` |
| 网络断开 | 指数退避重连 Relay/Registry |
| Registry 调用失败 | 每 60 秒重试一次注册/刷新（`retry_interval`），直到成功或达到最大重试次数 |
| Registry 不可用 | 使用本地缓存的路由信息 |

## Gateway 心跳周期

| 连接 | 心跳间隔 | 超时 |
|---|---|---|
| Gateway ↔ Registry | 30 秒 | 90 秒 |
| Gateway ↔ Gateway (直连) | 30 秒 | 90 秒 |
| Gateway ↔ Relay | 15 秒 | 45 秒 |

## 最小实现

一个 Gateway 最小实现需要：

1. 一个 WebSocket 服务端（监听外网/内网连接）
2. 一个 HTTP 服务端（供本地 Agent 通信）
3. 一个 Registry 客户端（注册 + 解析）
4. 一个连接管理器（维护到其他 Gateway/Relay 的连接池）
5. 一个路由选择器（从多个 path 中选择最优）
