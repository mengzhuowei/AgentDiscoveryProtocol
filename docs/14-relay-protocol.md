# 14 - Relay 协议规范

**更新：** 2026-05-15
**状态：** 草案（v0.1）

---

## 概述

Relay 是 ADP 网络中的公网中继节点，负责在两个无法直连的 Agent 之间中转消息。本文档定义 Relay 的完整协议，包括会话管理、认证、消息转发、离线缓存和速率限制。

---

## 架构定位

```
Agent A ◄── WebSocket ──► Relay ◄── WebSocket ──► Agent B
   │                         │                         │
   │    (双方都在 NAT 后)      │    (公网 IP)             │
   │                         │                         │
   └── 各自 Gateway 与 Relay   │   各自 Gateway 与 Relay ──┘
       保持一条长连接              保持一条长连接
```

Relay 不解析 Envelope 内容，只根据 `to` 字段做投递。

---

## 会话生命周期

### 状态机

```
connect ──► auth ──► active ──► disconnect
               │         │
               ▼         ▼
             error     expired
```

| 状态 | 说明 |
|---|---|
| `connect` | WebSocket 连接已建立，等待认证 |
| `auth` | 认证中（挑战-响应） |
| `active` | 认证通过，正常收发消息 |
| `disconnect` | 正常断开（客户端发送 disconnect 或心跳超时） |
| `error` | 认证失败（token 无效、签名错误等） |
| `expired` | 会话过期（超过 `expires_at` 未续期），与 `disconnect` 不同：disconnect 是连接级断开，expired 是会话级失效。当消息到达时若目标会话已 expired：Relay 关闭连接，将消息视为目标离线处理（进入离线缓存队列，等待 Agent 重新认证后推送） |

### 1. 连接建立

Gateway 默认在启动后自动连接 Relay（`auto_connect: true`）。Gateway 在同一时间只连接一个 Relay。如果配置了多个 Relay URL 且有 `preferred` 设置，优先连接首选 Relay；若首选不可用，按 URL 列表顺序尝试下一个。若所有 Relay 均不可用则回退到直连模式。

Agent 的 Gateway 通过 WebSocket 连接 Relay：

```
wss://relay.adp.io:9800/adp/relay
```

连接时携带 Agent ID 作为查询参数：

```
wss://relay.adp.io:9800/adp/relay?agent_id=adp://alice@example.com/hermes
```

### 2. 认证（Auth）

连接建立后，Relay 发起认证挑战。Gateway 必须在 **10 秒** 内完成认证，否则 Relay 断开连接。认证失败时，Gateway 应尝试列表中的下一个 Relay；如果所有 Relay 认证均失败，回退到直连模式。

**认证流程：**

```
Gateway                              Relay
  │                                     │
  │◄──── { "type": "challenge",         │
  │        "nonce": "abc123..." } ──────┤
  │                                     │
  │──── { "type": "auth",               │
  │       "agent_id": "adp://...",      │
  │       "token": "relay_token_xxx",   │
  │       "response": "hmac_signature" }│──►
  │                                     │
  │◄──── { "type": "auth_ok",           │
  │        "session_id": "sess_xyz",    │
  │        "expires_at": "..." } ───────┤
  │                                     │
```

**签名计算：**

```
response = HMAC-SHA256(relay_token, nonce)
```

如果 Relay 不需要认证（内网 Relay），可跳过认证步骤，连接后直接进入 `active` 状态。

### 3. 活跃状态（Active）

认证成功后进入活跃状态。此状态下：

- Gateway 可以收发消息
- 必须定期发送心跳
- Relay 维护 Agent ID → 连接的映射

### 4. 心跳

心跳机制分两层：

- **首选（传输层）：** WebSocket Ping/Pong 控制帧（opcode 0x9/0xA），由 WebSocket 协议栈直接处理，效率最高
- **备选（应用层）：** JSON 消息 `{"type":"ping"}` / `{"type":"pong"}`，当 WebSocket 控制帧不可用时使用

| 参数 | 值 |
|---|---|
| 心跳间隔 | 15 秒 |
| 心跳超时 | 45 秒（3 个心跳周期无响应即断开） |

**应用层心跳消息（备选）：**

```
Gateway → Relay:  { "type": "ping" }
Relay → Gateway:  { "type": "pong" }
```

### 5. 断开

正常断开：Gateway 发送 `{ "type": "disconnect" }`，Relay 清理连接映射。

异常断开：Relay 检测到心跳超时，自动清理连接。如果启用了离线缓存，消息进入缓存队列。

---

## 消息转发

### Relay 内部消息格式

Gateway 将原始 Envelope 包装在 Relay 消息中发送：

```json
{
  "type": "relay",
  "relay_message_id": "rm_abc123",
  "to": "adp://bob@home.io/claude",
  "payload": { /* 原始 Envelope */ }
}
```

- `relay_message_id`：Relay 生成的消息追踪 ID（用于 ACK）。区别于 Envelope 自带的 `message_id`——前者追踪 Relay 内部投递，后者是端到端的消息标识
- `to`：目标 Agent ID（Relay 据此查表转发）
- `payload`：完整的 ADP Envelope

### 转发流程

```
1. Gateway A → Relay: 发送 relay 消息
2. Relay 解析 to 字段
3. Relay 查 connections[to] 获取目标 WebSocket
4. 如果目标在线 → 直接转发 payload
5. 如果目标离线 → 根据缓存策略处理
```

### 送达确认

Relay 支持消息送达确认：

```
Relay → Gateway A:  { "type": "ack", "relay_message_id": "rm_abc123", "status": "delivered" }
Relay → Gateway A:  { "type": "ack", "relay_message_id": "rm_abc123", "status": "cached" }
```

- `delivered`：目标在线，已转发
- `cached`：目标离线，已缓存

**发送方收到 `cached` ack 后的行为：**

- 停止 Envelope 级别的重试（Relay 已接管投递责任）
- 通知本地 Agent 消息状态为"待投递"（pending），可附带预计投递时间
- 不对该消息设置额外的超时——由 Relay 的离线缓存策略决定消息生命周期
- 如果 Agent 在离线缓存期间上线，Relay 自动推送缓存消息并发送最终送达确认

---

## 离线消息缓存

### 缓存策略

| 参数 | 默认值 | 说明 |
|---|---|---|
| 最大缓存时长 | 24 小时 | 超时未投递则丢弃 |
| 最大缓存条数 | 500 条/Agent | 超出后丢弃最旧消息 |
| 单条最大大小 | 1 MB | 与 Envelope 限制一致 |

### 上线回放

Agent 上线后，Relay 按 FIFO 顺序推送缓存消息：

```
Relay → Gateway:  { "type": "cached", "messages": [ ... ] }
Gateway → Relay:  { "type": "cached_ack", "received_ids": ["rm_1", "rm_2"] }
```

- Relay 分批推送，每批最多 50 条。`messages` 数组中的每个元素包含原始 `relay_message_id` 和完整 `payload`（Envelope）：

```json
{
  "type": "cached",
  "messages": [
    {
      "relay_message_id": "rm_abc123",
      "payload": { /* 完整 Envelope */ }
    },
    {
      "relay_message_id": "rm_def456",
      "payload": { /* 完整 Envelope */ }
    }
  ]
}
```

- Gateway 确认后，Relay 删除已投递的缓存消息
- 未确认的消息在下次 Gateway 连接时再次推送

---

## Relay 发现

Gateway 需要知道可用的 Relay 地址。发现方式（按优先级）：

1. **硬编码列表**：SDK 内置默认 Relay 列表
2. **Registry 查询**：Registry 可返回推荐的 Relay 节点
3. **DNS SRV 记录**：`_adp-relay._tcp.example.com`
4. **配置文件**：`~/.adp/config.json` 中的 `relay` 字段
5. **环境变量**：`ADP_RELAY=wss://relay.example.com:9800`

### Registry 返回 Relay 列表的格式

```
GET /adp/v1/relays
```

```json
{
  "relays": [
    {
      "id": "relay-us-east-1",
      "address": "relay-us-east.adp.io:9800",
      "region": "us-east",
      "load": 0.45,
      "requires_auth": true
    }
  ]
}
```

---

## Relay 联邦

多个 Relay 节点可互联形成 Relay 网络，提高覆盖范围和容错能力。

### 联邦消息格式

当 Agent A 和 Agent B 连接到不同的 Relay 时，Relay 之间互相转发：

```json
{
  "type": "federated",
  "source_relay": "relay-us-east-1",
  "target_relay": "relay-us-west-1",
  "to": "adp://bob@home.io/claude",
  "hops": 0,
  "max_hops": 5,
  "payload": { /* 原始 Envelope */ }
}
```

- `hops`：当前已跳数，每经过一个 Relay 递增
- `max_hops`：最大跳数，默认 5。超过后丢弃消息，防止无限循环

Relay 维护其他 Relay 节点的路由表，定期同步在线 Agent 摘要（仅 Agent ID 列表，不做全量同步）。

**消息排序：** 联邦模式不保证消息投递顺序。不同 Relay 路径可能导致后发先至。需要排序的场景（如任务取消必须在任务创建之后），实现应使用 `message_id` 去重和幂等性保证（对未知 task_id 的 cancel 视为 no-op），不应依赖网络层的顺序。

联邦为可选特性，初期实现可不支持。

---

## 速率限制

Relay 应实施以下速率限制，防止滥用：

| 限制项 | 阈值 | 超出后处理 |
|---|---|---|
| 连接速率 | 每分钟每 IP 10 次新连接 | 拒绝新连接，返回 429 |
| 消息速率 | 每连接每秒 100 条 | 延迟或丢弃，返回限流提示 |
| 认证尝试 | 每分钟每 IP 5 次 | 临时封禁 5 分钟 |
| 单 Agent 多连接 | 同一 Agent ID 最多 3 个并发连接 | 拒绝新连接，断开最旧连接 |

---

## 部署建议

- Relay 必须有公网 IP 或通过反向代理暴露
- 使用 Nginx/Caddy 做 TLS 终止 + 反向代理 WebSocket
- 不在 Relay 上存储消息持久化数据（仅内存缓存离线消息）
- 不与 Registry 部署在同一节点（减少单点故障影响）
- 推荐最小配置：1 vCPU / 512MB RAM / 10GB 磁盘

### 反向代理示例（Nginx）

```nginx
server {
    listen 443 ssl;
    server_name relay.example.com;

    location /adp/relay {
        proxy_pass http://127.0.0.1:9800;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }
}
```
