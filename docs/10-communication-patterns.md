# ADP 通信模式

**更新：** 2026-05-15
**状态：** 草案（v0.1）

---

## 概述

本文档定义 Agent 之间在 ADP 协议上的典型通信模式，帮助开发者理解协议在实际场景中的运作方式。

---

## 模式一：Ping / Pong（探活）

最简单的通信模式：A 询问 B 是否在线。

```
Agent A                          Agent B
  │                                 │
  ├── request: adp:ping ──────────►│
  │                                 ├── 立即响应
  │◄── response: { status: "ok",     │
  │       data: { agent_id,           │
  │       version, uptime } } ────────┤
  │                                 │
```

**用途：**
- 验证目标 Agent 可达
- 获取目标的基础信息（版本、运行时间）
- 作为连接健康检查

---

## 模式二：能力查询

A 想知道 B 能做什么。

```
Agent A                          Agent B
  │                                 │
  ├── request: capability.query ──►│
  │                                 │
  │◄── response: { capabilities } ─┤
  │                                 │
```

**响应示例：**

```json
{
  "capabilities": [
    "adp:ping",
    "adp:capability.query",
    "adp:info.share",
    "custom:code.review",
    "custom:weather.query"
  ]
}
```

**最佳实践：** Gateway 应缓存结果，避免重复查询。

---

## 模式三：信息推送（单向）

A 主动推送信息给 B，不期望回复。

```
Agent A                          Agent B
  │                                 │
  ├── push: info.share ───────────►│
  │    { content: "..." }            │
  │                                 │
```

**典型场景：**
- 状态通知（"部署完成"）
- 事件广播（"仓库有新的 PR"）
- 心跳汇报

**可靠性：** 如果 B 离线，消息可能丢失。需要可靠投递的场景应使用 Request/Response 模式。

---

## 模式四：任务委派（异步）

A 委托 B 执行一项任务，B 异步处理。

```
Agent A                          Agent B
  │                                 │
  ├── request: task.delegate ─────►│
  │    { task_type, input }         │
  │                                 │
  │◄── response: accepted ─────────┤
  │    { task_id, estimated_time }  │
  │                                 │
  │          ... B 执行中 ...       │
  │                                 │
  │◄── push: task.status ───────────┤
  │    { task_id, status: completed,  │
  │      progress: 100 }              │
  │                                   │
  │          ... B 通过 info.share    │
  │          发送任务结果 ...         │
  │                                   │
  │◄── push: info.share ────────────┤
  │    { event: task.completed,       │
  │      result: {...} }              │
  │                                 │
```

**说明：**
- B 可以接受或拒绝任务（`TOO_BUSY`、`UNKNOWN_TASK_TYPE`）
- 执行进度通过 `task.status` 推送通知（执行方使用 `push` 类型发送进度更新）
- A 也可以主动查询 `task.status`
- A 可以发送 `task.cancel` 取消

---

## 模式五：请求 / 响应（同步 RPC）

最常见的模式：A 请求 B 执行一个操作，等待结果。

```
Agent A                          Agent B
  │                                 │
  ├── request ────────────────────►│
  │    { action, params }           │
  │                                 │
  │                 B 处理请求...   │
  │                                 │
  │◄── response ───────────────────┤
  │    { status, data }             │
  │                                 │
  │       或                        │
  │                                 │
  │◄── error ──────────────────────┤
  │    { code, message }            │
  │                                 │
```

**超时处理：**
- 请求 Envelope 携带 `ttl` 字段
- A 等待超时后应视为失败，可重试或回退
- B 超过 TTL 后不应再回复

---

## 模式六：订阅 / 通知

A 订阅 B 的某个事件，B 在有新事件时通知 A。

```
Agent A                          Agent B
  │                                 │
  ├── request: subscribe ─────────►│
  │    { event: "pr.created" }      │
  │                                 │
  │◄── response: ok ───────────────┤
  │                                 │
  │          ... 事件发生 ...       │
  │                                 │
  │◄── push: event.notify ─────────┤
  │    { event: "pr.created",       │
  │      data: {...} }              │
  │                                 │
```

**说明：** 订阅机制不在当前标准能力中，属于未来的扩展。但基础的消息模式（request + push）已能满足此需求。

---

## 模式对比

| 模式 | 方向 | 期望回复 | 适用场景 |
|---|---|---|---|
| Ping/Pong | 双向 | 是 | 探活 |
| 能力查询 | 双向 | 是 | 发现 |
| 信息推送 | 单向 | 否 | 通知、状态更新 |
| 任务委派 | 异步双向 | 是（初始，结果通过 info.share 回调） | 长时间任务 |
| RPC | 双向 | 是 | 通用 |
| 订阅/通知 | 双向+推送 | 是（初始） | 事件驱动 |
