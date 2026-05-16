# 04 — 传输层

## 概述

ADP 的传输协议是 **WebSocket**（`ws://` 或 `wss://`）。所有 Agent 间通信通过 WebSocket 进行——不定义 HTTP 回调、不定义其他传输方式。

```
Agent A ◄── WebSocket ──► Agent B        (直连)
Agent A ◄── WebSocket ──► Relay ◄── WebSocket ──► Agent B  (中继)
```

---

## Gateway 概念

Gateway 是 Agent 接入 ADP 网络的通道。它**不是必选组件**——可以嵌入 Agent 进程，也可以作为独立守护进程运行。

```
嵌入模式：              独立进程模式：

┌──────────┐           ┌──────────┐   localhost   ┌─────────┐
│  Agent   │           │  Agent   │◄────────────►│ Gateway │
│ +Gateway │── ADP 网络 ──► │          │  (HTTP/WS)    │         │── ADP 网络 ──►
└──────────┘           └──────────┘               └─────────┘
```

无论哪种模式，Gateway 的职责是：
1. 监听 WebSocket 端口，接收传入连接
2. 发起对其他 Agent/Relay 的出站连接
3. 按发现机制解析 Agent ID → 网络地址

---

## 直连（Direct）

双方网络可达时，直接建立 WebSocket 连接：

```
ws://192.168.1.100:9800/adp
wss://gateway.example.com:9800/adp
```

WebSocket 路径统一为 `/adp`（Relay 使用 `/adp/relay`）。每条消息是一个完整的文本帧（UTF-8 JSON），不使用分片帧。

### 心跳

- 间隔：30 秒，使用 WebSocket Ping/Pong 控制帧
- 超时：90 秒无响应视为断开
- 断连后指数退避重连：1s → 2s → 4s → ... → 60s 上限

> 直连场景（局域网或双方均有公网 IP）心跳可相对宽松。

---

## Relay（中继）

双方都在 NAT 后无法直连时，通过公网 Relay 中转。

### 连接建立

Gateway 通过 WebSocket 连接 Relay：

```
wss://relay.adp.io:9800/adp/relay?agent_id=adp://3QJmV3qT2ZxM7WdR9sFb5K@home.io/claude
```

连接后 Relay 发起认证（挑战-响应）：

```
Gateway                            Relay
  │                                   │
  │◄── { "type": "challenge",         │
  │      "nonce": "abc123..." } ──────┤
  │                                   │
  │── { "type": "auth",               │
  │     "agent_id": "adp://...",      │
  │     "response": "hmac_sig" } ────►│
  │                                   │
  │◄── { "type": "auth_ok",           │
  │      "session_id": "sess_xyz" } ──┤
```

签名：`HMAC-SHA256(relay_token, nonce)`。`relay_token` 是部署者预先配置的共享密钥，存储在 `~/.adp/config.json` 的 `relay.token` 字段中。如果 Relay 无需认证（内网 Relay），跳过认证直接进入 active 状态。

### 消息转发

Gateway 将原始消息包装后发送给 Relay：

```json
{
  "type": "relay",
  "to": "adp://8aB2cD4eF5gH6iJ7kL8mN9oP@example.com/hermes",
  "payload": { /* 原始 Envelope */ }
}
```

Relay 根据 `to` 查找到目标 Gateway 的 WebSocket 连接并转发 `payload`。Relay **不解析** Envelope 内容。

### 心跳

- 间隔：15 秒
- 超时：45 秒
- 首选 WebSocket Ping/Pong 控制帧；不可用时回退到 `{"type":"ping"}` / `{"type":"pong"}` JSON 消息

> Relay 链路穿越 NAT/防火墙，中间盒的 UDP/TCP 映射表超时通常在 30–60 秒，因此心跳需更密集。

### 离线缓存

Relay 可选择性实现离线消息缓存：

| 参数 | 默认值 |
|---|---|
| 最大缓存时长 | 24 小时 |
| 最大缓存条数 | 500 条/Agent |

目标上线后，Relay 按 FIFO 推送缓存消息。消息通过 WebSocket 帧成功发送（TCP 确认）后 Relay 删除该缓存。

### Relay 发现

Gateway 发现 Relay 的方式（按优先级）：

1. 环境变量 `ADP_RELAY`
2. 配置文件 `~/.adp/config.json` 中的 `relay.urls`
3. 无默认值——Relay 地址必须由部署者显式配置

---

传输安全要求详见 [`05-security.md`](05-security.md)。
