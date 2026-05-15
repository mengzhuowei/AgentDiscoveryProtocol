# 05 - 传输层（Transport）

## 概述

传输层定义了 ADP 消息如何在 Gateway 之间从源投递到目标。协议层对传输方式透明——Agent 总是通过 Gateway 收发消息，不关心底层走的是直连、Relay 还是局域网。

## 路由选择策略

Gateway 从 Registry 获取的目标路由列表按 `priority` 升序排列。选择流程：

```
1. 按 priority 从小到大遍历 routes
2. 对每条路由，尝试建立连接
3. 连接成功 → 使用该路由，停止遍历
4. 连接失败 → 尝试下一条
5. 全部失败 → 返回投递失败错误
```

Gateway 应当缓存路由选择结果，避免每次发送都重试所有路由。

## WebSocket 成帧规范

所有 ADP 消息通过 WebSocket 传输时，遵循以下成帧规则：

| 规则 | 说明 |
|---|---|
| **消息帧类型** | 使用 WebSocket **文本帧**（opcode 0x1），UTF-8 编码 |
| **帧边界** | 一条 WebSocket 消息 = 一个完整的 JSON 对象（一个 Envelope 或一个控制消息） |
| **分片** | 禁止使用 WebSocket 分片帧（continuation frames）。每条消息必须在单帧内完成 |
| **心跳** | Gateway ↔ Gateway 和 Gateway ↔ Registry 使用 WebSocket **Ping/Pong 控制帧**（opcode 0x9/0xA），参见 [06-gateway.md](06-gateway.md) 心跳周期。Gateway ↔ Relay 也使用 WebSocket 控制帧，间隔 15s |
| **Relay JSON 心跳** | [14-relay-protocol.md](14-relay-protocol.md) 中定义的 `{"type":"ping"}` JSON 消息作为应用层保活备选，当 WebSocket 控制帧不可用时使用 |

## 传输方式

### 1. 直连（Direct）

双方都能直接访问对方网络地址。

**适用场景：**
- 同一局域网
- 双方都有公网 IP
- 一方在 NAT 后，但另一方在公网且 NAT 后的一方发起了出站连接

**传输协议：**

推荐的 Wire Protocol 是 **WebSocket**（`ws://`），理由：
- 全双工，支持消息推送
- 浏览器友好（Gateway 可用 Web 技术实现）
- 有标准的重连机制
- 兼容 HTTP 代理和负载均衡

```
ws://192.168.1.100:9800/adp
wss://gateway.example.com:9800/adp     # 加密
```

Gateway B 启动 WebSocket 服务端，Gateway A 作为客户端连接。

### 2. Relay 中继

双方无法直连时，通过一个公网 Relay 节点中转消息。

**适用场景：**
- 双方都在对称 NAT 后
- 一方短暂离线（Relay 可缓存离线消息）
- 不想暴露内网 IP

**架构：**

```
Agent A ←→ Relay ←→ Agent B
```

Agent A 和 Agent B 各自与 Relay 保持一条 WebSocket 长连接。Relay 根据消息 Envelope 中的 `to` 字段将消息投递到对应连接。

**Relay 的职责：**
- 维护 Agent ID → WebSocket 连接 的映射表
- 消息转发（不做持久化存储）
- 可选：离线消息缓存（投递失败时保留，目标上线后推送）
- 连接健康检测（心跳）

**Relay 消息格式（包装内部使用）：**

```json
{
  "type": "relay",
  "relay_message_id": "rm_abc123",
  "to": "adp://bob@home.io/claude",
  "payload": { /* 原始 Envelope —— from 已包含在 Envelope 中 */ }
}
```

### 3. HTTP 回调

Agent B 没有常驻 Gateway，但暴露了一个 HTTP 端点用于接收消息。

**适用场景：**
- 轻量级 Agent 不想维护长连接
- 与现有 HTTP 服务集成

Agent A 的 Gateway 直接 HTTP POST 到 B 的端点：

```
POST https://agent-b.example.com/adp/inbox
Content-Type: application/json

{ /* 完整 Envelope */ }
```

**响应：**

```json
{ "status": "accepted", "message_id": "msg_2x4k9m7q" }
```

HTTP 回调适合响应方（B），主动方（A）仍需 WebSocket 与自己的 Gateway 通信。

## 回退策略

```
首选: Direct (内网) → Direct (公网) → Relay → HTTP Callback → 失败
```

Gateway 应为每条已知路由缓存优先级，避免每次重试全部路径。

## 心跳与保活

Gateway 之间（直连）应定期发送心跳，断连后自动重连。

- 心跳间隔：30 秒
- 心跳超时：90 秒无响应视为断开
- 断连重试：指数退避（1s → 2s → 4s → ... → 60s 上限）
- 重连后自动重新注册到 Registry

> **注意：** Gateway ↔ Relay 的心跳频率更高（15 秒间隔 / 45 秒超时），详见 [06-gateway.md](06-gateway.md) 和 [14-relay-protocol.md](14-relay-protocol.md)。

## 传输安全

- 内网传输：可明文，但推荐用 `wss://`
- 跨公网传输：必须用 `wss://` 或 TLS
- Relay 传输：Relay 应支持 `wss://`，客户端连接时验证 Relay 证书
