# 02 — 消息格式

## 设计原则

ADP 使用**单一消息格式**——不区分 request/push/ack/error 类型。消息的方向和语义由字段决定，而非类型标签。

- 有 `reply_to` → 这是对某条消息的回复
- 有 `error` → 这是一个错误回复
- 都没有 → 这是一条新消息

v0.2 新增 `sig` 字段用于密码学身份验证，有 `sig` → 消息发送方可验证。

---

## Envelope 结构

```json
{
  "protocol": "adp/0.2",
  "id": "msg_2x4k9m7q",
  "from": "adp://3QJmV3qT2ZxM7WdR9sFb5K@home.io/claude",
  "to": "adp://8aB2cD4eF5gH6iJ7kL8mN9oP@example.com/hermes",
  "action": "adp:ping",
  "params": {},
  "timestamp": "2026-05-16T17:30:00Z",
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
| `timestamp` | 是 | ISO 8601 时间戳，UTC |
| `sig` | 否 | Ed25519 签名（Base64），覆盖不含 `sig` 的规范化 Envelope。存在则验签，缺失则降级为白名单模式 |

### 示例：`adp:info`

```json
{
  "protocol": "adp/0.2",
  "id": "msg_info001",
  "from": "adp://3QJmV3qT2ZxM7WdR9sFb5K@home.io/claude",
  "to": "adp://8aB2cD4eF5gH6iJ7kL8mN9oP@example.com/hermes",
  "action": "adp:info",
  "params": {
    "message": "晚饭准备好了"
  },
  "timestamp": "2026-05-16T18:30:00Z",
  "sig": "YW5vdGhlciBzaWduYXR1cmUgZXhhbXBsZSBmb3IgdGhlIGFkcCBwcm90b2Nvb..."
}
```

`adp:info` 的 `params` 无强制结构，由收发双方约定语义。

### 回复

在以上字段基础上，添加 `reply_to` 表示是对某条消息的回复：

```json
{
  "protocol": "adp/0.2",
  "id": "msg_abc123",
  "from": "adp://8aB2cD4eF5gH6iJ7kL8mN9oP@example.com/hermes",
  "to": "adp://3QJmV3qT2ZxM7WdR9sFb5K@home.io/claude",
  "reply_to": "msg_2x4k9m7q",
  "action": "adp:ping",
  "params": {
    "uptime": 86400
  },
  "timestamp": "2026-05-16T17:30:01Z",
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
  "from": "adp://8aB2cD4eF5gH6iJ7kL8mN9oP@example.com/hermes",
  "to": "adp://3QJmV3qT2ZxM7WdR9sFb5K@home.io/claude",
  "reply_to": "msg_2x4k9m7q",
  "action": "custom:code.review",
  "params": {},
  "error": {
    "code": "CAPABILITY_NOT_FOUND",
    "message": "不支持 custom:code.review"
  },
  "timestamp": "2026-05-16T17:30:01Z",
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
| `UNAUTHORIZED` | 不在白名单 |
| `RATE_LIMITED` | 请求频率超限 |
| `TOO_BUSY` | 当前无法处理 |
| `INVALID_SIGNATURE` | 消息签名验签失败 |
| `SIGNATURE_REQUIRED` | 接收方要求签名但收到未签名消息 |
| `PROOF_OF_ID_MISMATCH` | Manifest 的 proof_of_id 与 public_key 或 Agent ID 不匹配 |
| `TRUST_CONFLICT` | 已钉扎的 proof_of_id 与当前收到的不同 |

---

## 消息签名（v0.2）

### 签名过程（发送方）

```
1. 构建 Envelope，不含 sig 字段
2. 按 JSON 规范化算法（排序键、无空白）转为字节序列
3. 用 Ed25519 私钥签名
4. Base64 编码签名，设为 sig 字段
5. 发送
```

### 验证过程（接收方）

```
1. 提取 sig 字段
2. 若无 sig → 降级为白名单模式（v0.1 兼容）
3. 删除 sig，规范化剩余字段
4. 从 from 的 user 段提取 proof_of_id
5. 从 trust store 查找该 Agent 的已钉扎 public_key
6. 若 trust store 无记录 → 获取 Manifest → 验证自签名 →
   验证 proof_of_id 与 Agent ID user 段一致 → 钉扎
7. 用 public_key 验签规范化 Envelope
8. 通过 → 接受；失败 → INVALID_SIGNATURE
```

详细算法与 JSON 规范化定义见 [`06-signatures.md`](06-signatures.md)。

### 降级模式

| 发送方 | 接收方配置 | 行为 |
|--------|-----------|------|
| v0.1（无 sig） | mode=optional | 白名单检查 |
| v0.1（无 sig） | mode=required | 拒绝 `SIGNATURE_REQUIRED` |
| v0.2（有 sig） | 任意 | 完整验签 |

---

## 消息大小限制

- 单个消息不超过 **1 MB**
- `sig` 约 88 字节（64 字节原始签名 Base64 编码），忽略不计
- 大文件应通过 URL 引用或 `adp:info` 附带下载链接
- 二进制数据需 Base64 编码，字段名以 `_b64` 后缀标识

---

## 可靠性与投递语义

v0.2 采用 **at-most-once** 语义。传输层（WebSocket）保证单条消息的完整投递。协议层不做 ack、不做重试。

- 发送方发完即忘，不等待确认
- 需要回复的场景，发送方自行超时和重试（如果有必要）
- 需要可靠投递的场景，由上层应用协议自行保证

### 重放防护

协议层不做消息去重，但实现方**应当**利用消息 `id` 的唯一性做重放防护：缓存已处理的消息 ID 集合（建议至少保留 5 分钟），拒绝重复 `id` 的消息。签名将 `id` 纳入签名覆盖范围，防止攻击者替换 `id` 后重放。详见 [`05-security.md`](05-security.md) 威胁模型 L3。

这是有意的最小化设计——保持协议核心简单，可靠投递是传输层和应用层的事。
