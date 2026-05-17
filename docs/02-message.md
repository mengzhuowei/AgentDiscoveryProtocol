# 02 — 消息格式

## 设计原则

ADP 使用**单一消息格式**——不区分 request/push/ack/error 类型。消息的方向和语义由字段决定，而非类型标签。

- 有 `reply_to` → 这是对某条消息的回复
- 有 `error` → 这是一个错误回复
- 都没有 → 这是一条新消息

所有消息必须附带 Ed25519 签名（`sig` 字段），任何未签名消息直接拒绝。

### 协议版本协商

`protocol` 字段同时出现在 Manifest 和 Envelope 中，作为发送方的版本声明。版本协商规则：

1. Manifest 中的 `protocol` 声明 Agent 自身实现的最高协议版本
2. Envelope 中的 `protocol` 声明本条消息所使用的协议版本（≤ Manifest 中的版本）
3. 收到无法处理的版本 → 返回 `UNSUPPORTED_PROTOCOL` 错误，`error.data` 中附带本端支持的版本列表

```json
{
  "error": {
    "code": "UNSUPPORTED_PROTOCOL",
    "message": "不支持 adp/0.2，本端最高支持 adp/0.1",
    "data": { "accepted": ["adp/0.1"] }
  }
}
```

MAJOR 变更不兼容，MINOR 变更向前兼容。发送方应在发送前通过 Manifest 了解对方版本，避免发送不可处理的消息。

---

## Envelope 结构

```json
{
  "protocol": "adp/0.2",
  "id": "msg_2x4k9m7q",
  "from": "adp://3QJmV3qT2ZxM7WdR9sFb5K8cJ5hG4mF6aY0dL3kX1yZ9aB@home.io/claude",
  "to": "adp://8aB2cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV3wX4yZ5aB6cD@example.com/hermes",
  "action": "adp:ping",
  "params": {},
  "timestamp": "2026-05-16T17:30:00.000Z",
  "sig": "dGhpcyBpcyBhIHNpZ25hdHVyZSBleGFtcGxlIGZvciB0aGUgYWRwIHByb3RvY29s..."
}
```

### 顶层字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `protocol` | 是 | 协议版本，当前 `"adp/0.2"` |
| `id` | 是 | 消息唯一标识，发送方生成，推荐 `msg_` 前缀 |
| `from` | 是 | 发送方 Agent ID |
| `to` | 是 | 接收方 Agent ID |
| `action` | 是 | 动作标识，如 `adp:ping`。错误回复时为原消息的 action |
| `params` | 是 | 动作参数，无参数时用 `{}` |
| `timestamp` | 是 | ISO 8601 时间戳，UTC，**精确到毫秒**（`YYYY-MM-DDTHH:mm:ss.sssZ`） |
| `sig` | **是** | Ed25519 签名（Base64），覆盖不含 `sig` 的规范化 Envelope |
| `encoding` | 否 | 有效载荷编码，默认 `"json"`。保留 `"cbor"` 用于未来二进制模式 |
| `expires_at` | 否 | 消息过期时间，ISO 8601 毫秒 UTC。用于应用层时效控制 |

### 示例：`adp:info`

```json
{
  "protocol": "adp/0.2",
  "id": "msg_info001",
  "from": "adp://3QJmV3qT2ZxM7WdR9sFb5K8cJ5hG4mF6aY0dL3kX1yZ9aB@home.io/claude",
  "to": "adp://8aB2cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV3wX4yZ5aB6cD@example.com/hermes",
  "action": "adp:info",
  "params": {
    "text": "晚饭准备好了",
    "severity": "info",
    "category": "home"
  },
  "timestamp": "2026-05-16T18:30:00.500Z",
  "sig": "YW5vdGhlciBzaWduYXR1cmUgZXhhbXBsZSBmb3IgdGhlIGFkcCBwcm90b2Nvb..."
}
```

`adp:info` 的 `params` 无强制结构，推荐使用 `text`、`severity`、`category`、`data` 等可选标准化字段，详见 [`01-identity.md`](01-identity.md)。

### 回复

在以上字段基础上，添加 `reply_to` 表示是对某条消息的回复：

```json
{
  "protocol": "adp/0.2",
  "id": "msg_abc123",
  "from": "adp://8aB2cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV3wX4yZ5aB6cD@example.com/hermes",
  "to": "adp://3QJmV3qT2ZxM7WdR9sFb5K8cJ5hG4mF6aY0dL3kX1yZ9aB@home.io/claude",
  "reply_to": "msg_2x4k9m7q",
  "action": "adp:ping",
  "params": {
    "uptime": 86400
  },
  "timestamp": "2026-05-16T17:30:01.150Z",
  "sig": "c2lnbmF0dXJlIGV4YW1wbGUgZm9yIHJlcGx5IG1lc3NhZ2UgaW4gYWRwIHByb3RvY29s..."
}
```

接收方通过 `reply_to` 将回复与原始消息关联。不强制何时回复——发送方不关心回复则不处理，发送方关心则自行超时。

### 错误

在回复消息上添加 `error` 字段：

```json
{
  "protocol": "adp/0.2",
  "id": "msg_err001",
  "from": "adp://8aB2cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV3wX4yZ5aB6cD@example.com/hermes",
  "to": "adp://3QJmV3qT2ZxM7WdR9sFb5K8cJ5hG4mF6aY0dL3kX1yZ9aB@home.io/claude",
  "reply_to": "msg_2x4k9m7q",
  "action": "custom:code.review",
  "params": {},
  "error": {
    "code": "CAPABILITY_NOT_FOUND",
    "message": "不支持 custom:code.review"
  },
  "timestamp": "2026-05-16T17:30:01.200Z",
  "sig": "ZXJyb3Igc2lnbmF0dXJlIGV4YW1wbGUgZm9yIGFkcCBwcm90b2NvbA..."
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `error.code` | 是 | 大写下划线错误码 |
| `error.message` | 是 | 人类可读描述 |
| `error.data` | 否 | 附加上下文 |

### 标准错误码

| 错误码 | 说明 |
|---|---|
| `UNKNOWN_ACTION` | 无法识别的 action |
| `CAPABILITY_NOT_FOUND` | Agent 未声明该能力 |
| `INVALID_PARAMS` | 参数校验失败 |
| `INTERNAL_ERROR` | 内部错误 |
| `AGENT_NOT_FOUND` | 目标 Agent 不存在 |
| `RATE_LIMITED` | 请求频率超限 |
| `TOO_BUSY` | 当前无法处理 |
| `INVALID_SIGNATURE` | 消息签名验签失败 |
| `TRUST_CONFLICT` | 已钉扎的 Agent ID 与当前通道返回的不一致 |
| `UNSUPPORTED_PROTOCOL` | 收到无法处理的协议版本 |

---

## 消息签名

### 签名过程（发送方）

```
1. 构建 Envelope，不含 sig 字段
2. 按 JSON 规范化算法（RFC 8785 JCS）转为字节序列
3. 用 Ed25519 私钥签名
4. Base64 编码签名，设为 sig 字段
5. 发送
```

### 验证过程（接收方）

```
1. 提取 sig 字段。sig 不存在 → 拒绝 INVALID_SIGNATURE
2. 提取 timestamp 字段。偏差超过 60 秒 → 拒绝 INVALID_PARAMS（时钟偏差过大）
3. 删除 sig，规范化剩余字段
4. 从 from 的 user 段 Base58Decode 得到公钥
5. 从 trust store 查找该 Agent 的已钉扎 public_key
6. 若 trust store 无记录 → 钉扎该 Agent ID（公钥从 Agent ID 的 user 段直接提取）
7. 用 public_key 验签规范化 Envelope
8. 通过 → 接受；失败 → INVALID_SIGNATURE
```

详细算法与 JSON 规范化定义见 [`06-signatures.md`](06-signatures.md)。

---

## 消息大小限制

- 单个消息不超过 **1 MB**
- `sig` 约 88 字节（64 字节原始签名 Base64 编码），忽略不计
- 大文件应通过 URL 引用或 `adp:info` 附带下载链接
- 二进制数据需 Base64 编码，字段名以 `_b64` 后缀标识

---

## 可靠性与投递语义

v0.2 采用 **at-most-once** 语义。WebSocket 底层 TCP 保证每条消息帧的完整、有序投递，协议层不额外做 ACK 或重试。

- 消息发出即认为投递完成，不等待确认
- 需要回复的场景，发送方自行超时和重试（如果有必要）
- 需要可靠投递的场景（如文件传输），由上层应用协议自行保证

### 重放防护

两层防护：

1. **消息 ID 去重**：缓存已处理的消息 ID 集合（建议至少保留 5 分钟），拒绝重复 `id` 的消息
2. **时间戳新鲜度**：拒绝 `timestamp` 与当前时间偏差超过 **60 秒**的消息（允许合理时钟偏差）。签名将 `id` 和 `timestamp` 纳入覆盖范围，防止攻击者篡改

这是有意的最小化设计——保持协议核心简单，可靠投递是传输层和应用层的事。
