# 07 - 标准能力定义

## 概述

本章定义 ADP 协议标准的动作原语。所有 Agent **必须**实现 `adp:ping` 和 `adp:capability.query`，其余为推荐项（仅最简 Agent 可跳过）。

## adp:ping

探活，验证目标 Agent 是否在线且能响应。

### Request

```json
{
  "action": "adp:ping",
  "params": {}
}
```

### Response

```json
{
  "in_reply_to": "msg_...",
  "status": "ok",
  "data": {
    "agent_id": "adp://bob@home.io/claude",
    "version": "1.2.0",
    "uptime": 86400,
    "timestamp": "2026-05-15T17:00:00Z"
  }
}
```

---

## adp:capability.query

查询目标 Agent 的能力清单。

### Request

```json
{
  "action": "adp:capability.query",
  "params": {}
}
```

### Response

```json
{
  "in_reply_to": "msg_...",
  "status": "ok",
  "data": {
    "agent_id": "adp://bob@home.io/claude",
    "adp_version": "0.1",
    "capabilities": [
      "adp:ping",
      "adp:capability.query",
      "adp:info.share",
      "adp:task.delegate",
      "custom:code.review"
    ]
  }
}
```

---

## adp:info.share

单向推送信息。`info.share` 以 `type: "push"` 发送时不期望任何回复；若以 `type: "request"` 发送则按标准 request 语义（先 ack 后 response），接收方回复 `{ status: "ok", data: { received: true } }`。request 模式下可能的错误响应包括：`INVALID_PARAMS`（无法识别的 content_type）、`TOO_BUSY`（接收方拒绝接收）。

### Push（推荐）

```json
{
  "action": "adp:info.share",
  "params": {
    "content_type": "text/plain",
    "content": "项目已部署完成",
    "summary": "部署通知"
  }
}
```

### 内容类型约定

| content_type | content 类型 | 说明 |
|---|---|---|
| `text/plain` | string | 纯文本 |
| `text/markdown` | string | Markdown 文本 |
| `application/json` | object | 结构化数据 |
| `application/x-url` | string | URL 引用 |

`content` 字段的类型由 `content_type` 决定——`text/*` 和 `application/x-url` 时 `content` 为字符串，`application/json` 时 `content` 为 JSON 对象。

---

## adp:task.delegate（推荐）

向目标 Agent 委派一个任务。这是 ADP 中最复杂的能力，本文档只定义基础框架。

### Request

```json
{
  "action": "adp:task.delegate",
  "params": {
    "task_id": "task_xyz789",
    "task_type": "custom:code.review",
    "input": {
      "repo": "https://github.com/alice/asa-merchant",
      "pr": 42
    },
    "priority": "normal",
    "timeout": 600,
    "callback": {
      "target": "adp://alice@example.com/hermes"
    }
  }
}
```

### 接受响应

```json
{
  "in_reply_to": "msg_...",
  "status": "ok",
  "data": {
    "task_id": "task_xyz789",
    "status": "accepted",
    "estimated_completion": "2026-05-15T18:00:00Z"
  }
}
```

### 拒绝响应

```json
{
  "in_reply_to": "msg_...",
  "status": "error",
  "error": {
    "code": "TOO_BUSY",
    "message": "当前有 5 个任务排队，无法接受新任务"
  }
}
```

---

## adp:task.status（推荐）

查询已委派任务的执行状态。此能力可用于两种模式：
- **请求/响应**：发起方主动查询，使用 `type: "request"`，执行方返回当前状态
- **主动推送**：执行方使用 `type: "push"` 将进度更新推送给发起方（参见 [13-task-lifecycle.md](13-task-lifecycle.md) 心跳机制）

### Request

```json
{
  "action": "adp:task.status",
  "params": {
    "task_id": "task_xyz789"
  }
}
```

### Response

```json
{
  "in_reply_to": "msg_...",
  "status": "ok",
  "data": {
    "task_id": "task_xyz789",
    "status": "in_progress",
    "progress": 60,
    "message": "正在分析第 3 个文件..."
  }
}
```

### 任务状态枚举

| 状态 | 说明 |
|---|---|
| `accepted` | 已接受，排队中 |
| `in_progress` | 执行中 |
| `completed` | 已完成 |
| `failed` | 执行失败 |
| `cancelled` | 已取消 |

---

## adp:task.cancel（推荐）

取消一个已委派但尚未完成的任务。

### Request

```json
{
  "action": "adp:task.cancel",
  "params": {
    "task_id": "task_xyz789",
    "reason": "不再需要"
  }
}
```

### Response

```json
{
  "in_reply_to": "msg_...",
  "status": "ok",
  "data": {
    "task_id": "task_xyz789",
    "status": "cancelled"
  }
}
```
