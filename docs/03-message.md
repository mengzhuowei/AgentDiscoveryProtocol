# 03 - 消息格式（Envelope）

## 概述

所有 Agent 间的通信都包装在标准化的 **Envelope**（信封）中。Envelope 是协议中唯一的消息容器，请求、响应、推送、错误均使用同一格式。

## Envelope 结构

```json
{
  "adp_version": "0.1",
  "message_id": "msg_2x4k9m7q",
  "thread_id": "thr_a1b2c3d4",
  "from": "adp://alice@example.com/hermes",
  "to": "adp://bob@home.io/claude",
  "type": "request",
  "timestamp": "2026-05-15T17:30:00Z",
  "ttl": 300,
  "signature": {
    "algorithm": "Ed25519",
    "value": "base64...",
    "signed_at": "2026-05-15T17:30:00Z"
  },

  "body": {
    "action": "adp:capability.query",
    "params": {}
  }
}
```

### 顶层字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `adp_version` | 是 | 协议版本号，当前为 `"0.1"` |
| `message_id` | 是 | 消息唯一标识，发送方生成，推荐用 `msg_` 前缀。实现必须忽略并保留未知的顶层字段，以保证向前兼容 |
| `thread_id` | 是 | 会话标识（关联 ID），由发起方在首次通信时生成，同一次逻辑会话中的所有消息沿用相同的 `thread_id`。Gateway 可据此优先复用同一连接，但不强制——连接断开后 `thread_id` 不变，在新连接上继续使用 |
| `from` | 是 | 发送方 Agent ID |
| `to` | 是 | 接收方 Agent ID（字符串）。v0.1 仅支持单目标，未来版本可能扩展为数组以支持多目标 |
| `type` | 是 | 消息类型，见下文 |
| `timestamp` | 是 | ISO 8601 时间戳，UTC |
| `ttl` | 否 | 消息存活时间（秒），超时可丢弃，默认 `300`（5分钟）。注意：当目标离线且依赖 Relay 缓存投递时，应设置更长的 TTL（如 3600 或更高），否则消息可能在目标上线前过期。参见 [14-relay-protocol.md](14-relay-protocol.md) 离线缓存策略
| `signature` | 否 | 消息签名，见签名章节 |
| `body` | 是 | 消息体，格式由 `type` 决定 |

## 消息类型（`type`）

| 类型 | 方向 | 说明 |
|---|---|---|
| `request` | A → B | 请求，期望收到一个 `response` |
| `response` | B → A | 对 `request` 的回复，必须引用相同的 `message_id` 和 `thread_id` |
| `push` | A → B | 单向通知，不期望回复 |
| `error` | 任意 | 错误响应 |
| `ack` | B → A | 确认收到消息（无论是否处理），用于可靠投递 |

## Body 结构

### request / push

```json
{
  "action": "adp:capability.query",
  "params": {},
  "idempotency_key": "optional-key-for-retry"
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `action` | 是 | 动作标识，参见 [07-capabilities.md](07-capabilities.md) |
| `params` | 是 | 动作参数，由各能力定义 |
| `idempotency_key` | 否 | 幂等键，用于任务级去重。详见 [13-task-lifecycle.md](13-task-lifecycle.md) |

### response

```json
{
  "in_reply_to": "msg_2x4k9m7q",
  "status": "ok",
  "data": { ... }
}
```

### error

```json
{
  "in_reply_to": "msg_2x4k9m7q",
  "status": "error",
  "error": {
    "code": "CAPABILITY_NOT_FOUND",
    "message": "Agent does not support custom:code.review",
    "data": {}
  }
}
```

| `error.code` | 是 | 标准错误码，见下表 |
| `error.message` | 是 | 人类可读的错误描述 |
| `error.data` | 否 | 附加的错误上下文（如版本号、字段名），由具体错误码决定 |

> 标准错误码不使用命名空间前缀（区别于能力标识的 `adp:` 前缀）。所有 ADP 协议定义的错误码均为大写下划线格式。

| 错误码 | 生成方 | 说明 |
|---|---|---|
| `UNKNOWN_ACTION` | Agent | 不支持的 action |
| `INVALID_PARAMS` | Agent | 参数校验失败 |
| `INTERNAL_ERROR` | Agent | Agent 内部错误 |
| `TIMEOUT` | Gateway / Agent | 处理或投递超时 |
| `UNAUTHORIZED` | Agent | 未授权（不在白名单） |
| `CAPABILITY_NOT_FOUND` | Agent | 不具备请求的能力 |
| `TOO_BUSY` | Agent | Agent 当前无法处理 |
| `VERSION_MISMATCH` | Agent / Gateway | 协议版本不兼容 |
| `AGENT_NOT_FOUND` | Gateway / Registry | 目标 Agent 不存在或未注册 |
| `PUBLIC_KEY_NOT_FOUND` | Gateway / Agent | 发送方公钥未找到，无法验签 |
| `SIGNATURE_INVALID` | Gateway / Agent | 消息签名验证失败 |
| `SIGNATURE_EXPIRED` | Gateway / Agent | 签名时间戳超出有效窗口 |
| `UNSUPPORTED_ALGORITHM` | Gateway / Agent | 不支持的签名算法 |
| `REGISTRATION_EXPIRED` | Registry | 注册已过期，需重新注册 |
| `RATE_LIMITED` | Registry / Relay | 请求频率超限 |
| `UNKNOWN_TASK_TYPE` | Agent | 不支持的任务类型 |

## 签名

消息签名规范详见 [15-message-signing.md](15-message-signing.md)。此处仅保留顶层字段说明。

Envelope 的 `signature` 字段为可选对象，结构如下：

```json
"signature": {
  "algorithm": "Ed25519",
  "value": "base64...",
  "signed_at": "2026-05-15T17:30:00Z"
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `algorithm` | 是 | 签名算法：`Ed25519`（首选）、`ECDSA-P256` |
| `value` | 是 | Base64 编码的签名值 |
| `signed_at` | 是 | 签名时间戳，须与 Envelope.timestamp 接近（±60s） |

接收方通过 Manifest 中的 `public_key` 获取公钥并验签。初期不强校验，保留字段以备扩展。

## 消息大小限制

- 单个 Envelope 不超过 **1 MB**
- 大文件应通过 `info.share` 附带文件引用，而非内联
- `body.params` 中的二进制数据（如图片、文件内容）需 Base64 编码，接收方根据字段名约定（`_b64` 后缀）识别二进制字段

## Ack 与可靠投递

### Ack 语义

当 Envelope 中 `type = "request"` 时，接收方在收到消息后应尽快发送 `ack`，表示消息已完整接收（不等同于已处理）。

**Ack 格式：**

```json
{
  "adp_version": "0.1",
  "message_id": "msg_abc123_ack",
  "thread_id": "thr_a1b2c3d4",
  "from": "adp://bob@home.io/claude",
  "to": "adp://alice@example.com/hermes",
  "type": "ack",
  "timestamp": "2026-05-15T17:30:01Z",
  "body": {
    "in_reply_to": "msg_2x4k9m7q",
    "status": "received"
  }
}
```

| 字段 | 说明 |
|---|---|
| `in_reply_to` | 被确认的消息 ID |
| `status` | `"received"` — 消息已收到，处理结果待后续 response/error 通知 |

**Ack 发送规则：**

| 消息类型 | 是否需要 Ack |
|---|---|
| `request` | 必须 Ack |
| `push` | 不需要 Ack |
| `response` | 不需要 Ack |
| `error` | 不需要 Ack |
| `ack` | 不对 Ack 再发 Ack（防止无限循环） |

### 可靠投递（At-Least-Once）

`request` 类型消息采用 at-least-once 语义：

1. 发送方发出 request，启动超时计时器（默认 30 秒）
2. 如果超时未收到 `ack` → 重发（携带相同 `message_id`）
3. 收到 `ack` → 等待 `response`，响应超时默认 60 秒（或取 Envelope TTL 剩余值，取较小者）
4. 收到 `response` → 完成

### 幂等性保证

接收方通过 `message_id` 去重，确保重发的消息只处理一次。

**去重缓存：**

| 参数 | 值 |
|---|---|
| 缓存 key | `message_id` |
| 保留时长 | 消息 TTL × 2（默认 600 秒） |
| 最大缓存条数 | 10000 条 |

收到重复 `message_id` 时，如果之前已处理：
- 返回原 `response`（如果已生成）
- 或返回原 `ack`（如果仍在处理中）

不要重新执行处理逻辑。

## 重试策略

### 发送方重试

```
第 1 次重试: 1s 后
第 2 次重试: 2s 后
第 3 次重试: 4s 后
第 4 次重试: 8s 后
第 5 次重试: 16s 后
```

- 最大重试次数：5 次（不含首次发送）
- 超过最大重试次数后，Gateway 向发送方返回 `TIMEOUT` 错误
- 重试总时长不超过 TTL，如果消息 `ttl` 已过期，立即停止重试并返回 `TIMEOUT`
- 重试期间不取消消息，由 Gateway 自动执行
