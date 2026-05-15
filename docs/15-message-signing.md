# 15 - 消息签名与验证

**更新：** 2026-05-15
**状态：** 草案（v0.1）

---

## 概述

本文档定义 ADP 消息签名的具体算法、密钥格式、签名/验签流程和密钥管理。消息签名是可选的但强烈推荐的安全保障，用于验证消息来源的真实性和内容完整性。

---

## 推荐算法

| 优先级 | 算法 | 密钥长度 | 说明 |
|---|---|---|---|
| **首选** | Ed25519 | 256 bit | 现代算法，签名短（64 bytes），速度快，无已知侧信道漏洞 |
| **备选** | ECDSA P-256 | 256 bit | 广泛支持，大多数语言标准库原生支持 |
| **兼容** | RSA PKCS#1 v1.5 | 2048 bit | 仅用于兼容旧系统，不推荐新实现 |

所有实现**必须**支持 Ed25519，**应当**支持 ECDSA P-256。

---

## 密钥格式

### 私钥

PKCS#8 PEM 格式：

```
-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEINT0...
-----END PRIVATE KEY-----
```

建议存储在 `~/.adp/keys/` 目录下，权限应为 `0600`（仅所有者可读）。

### 公钥

公钥通过 Manifest 分发。Manifest 新增 `public_key` 字段：

```json
{
  "adp_version": "0.1",
  "agent_id": "adp://alice@example.com/hermes",
  "display_name": "Hermes",
  "version": "1.2.0",
  "capabilities": ["adp:ping", "adp:capability.query"],
  "public_key": {
    "algorithm": "Ed25519",
    "key": "MCowBQYDK2VwAyEA...",
    "format": "spki-base64"
  },
  "updated_at": "2026-05-15T17:00:00Z"
}
```

| 字段 | 说明 |
|---|---|
| `algorithm` | 算法标识：`Ed25519`、`ECDSA-P256`、`RSA-2048` |
| `key` | Base64 编码的公钥（SPKI 格式） |
| `format` | 固定为 `spki-base64`（SubjectPublicKeyInfo DER → Base64） |

---

## 签名流程

### 步骤 1：构造待签名内容

从完整 Envelope 中移除 `signature` 字段（如果存在），得到待签名对象：

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
  "body": {
    "action": "adp:ping",
    "params": {}
  }
}
```

### 步骤 2：构造待签名对象

在序列化之前，从 Envelope 对象中执行以下操作：

1. 移除 `signature` 字段（如果存在）
2. 移除所有值为 `null` 的字段——不要在待签名对象中包含 null 字段，否则不同实现签出的结果不同
3. `body` 及其嵌套对象（`params` 等）的 key 同样参与 JCS 排序

### 步骤 3：Canonical JSON 序列化

将待签名对象按 **RFC 8785 (JCS — JSON Canonicalization Scheme)** 序列化为规范 JSON 字符串：

- 对象的 key 按字典序递归排列（包括 `body`、`body.params` 等所有嵌套层级）
- 字符串使用 Unicode 转义
- 数字使用标准 JSON 数字格式
- 无多余空白字符

**伪代码：**

```
clean_envelope = remove_null_fields(envelope_without_signature)
canonical_bytes = jcs_canonicalize(clean_envelope)
```

### 步骤 4：签名

用私钥对 canonical bytes 签名：

```
signature_bytes = ed25519_sign(private_key, canonical_bytes)
signature_b64 = base64_encode(signature_bytes)
```

### 步骤 5：将签名放入 Envelope

```json
{
  "adp_version": "0.1",
  "message_id": "msg_2x4k9m7q",
  ...
  "signature": {
    "algorithm": "Ed25519",
    "value": "dGhpcyBpcyBhIHNpZ25hdHV...",
    "signed_at": "2026-05-15T17:30:00Z"
  }
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `algorithm` | 是 | 使用的签名算法 |
| `value` | 是 | Base64 编码的签名值 |
| `signed_at` | 是 | 签名时间戳，必须与 Envelope.timestamp 一致或接近（±60秒） |

---

## 验签流程

### 步骤 1：获取公钥

接收方从发送方的 Manifest 中获取 `public_key`。Manifest 可通过以下方式获取：

1. 本地缓存（优先）
2. 查询 Registry（`GET /resolve` 时附带返回 Manifest）
3. 向对方发送 `adp:capability.query`（此时不应依赖签名验证——首次交互应在 TLS/WSS 保护下进行，且接收方可限制仅接受白名单 Agent 的未签名消息）

### 步骤 2：提取 signature 并还原待签名对象

从 Envelope 中移除 `signature` 字段，得到待签名对象。

### 步骤 3：Canonical 序列化并验签

```
canonical_bytes = jcs_canonicalize(envelope_without_signature)
signature_bytes = base64_decode(envelope.signature.value)
is_valid = ed25519_verify(public_key, canonical_bytes, signature_bytes)
```

### 步骤 4：时间窗口校验

检查 `signature.signed_at` 与 `envelope.timestamp` 的差值：

```
abs(signed_at - timestamp) <= 60 seconds
```

超出窗口的消息视为重放攻击，直接丢弃。

---

## 验证失败处理

| 失败原因 | 错误码 | 处理方式 |
|---|---|---|
| 公钥未找到 | `PUBLIC_KEY_NOT_FOUND` | 无法验签，按 Agent 的安全策略处理 |
| 签名不匹配 | `SIGNATURE_INVALID` | 丢弃消息，记录警告 |
| 时间窗口超出 | `SIGNATURE_EXPIRED` | 丢弃消息（可能是重放攻击） |
| 不支持的算法 | `UNSUPPORTED_ALGORITHM` | 返回错误，要求使用支持的算法 |

---

## 密钥轮换

### 轮换策略

- 建议每 **90 天** 轮换一次密钥
- 旧公钥在轮换后保留 **7 天**（grace period），期间新旧公钥均有效
- Grace period 内，接收方应同时尝试新旧公钥验签
- Grace period 结束后，旧公钥失效，仅新公钥有效

### Manifest 中的公钥表示

轮换期间，Manifest 可包含两个公钥：

```json
{
  "public_key": {
    "algorithm": "Ed25519",
    "key": "new_key_base64...",
    "format": "spki-base64",
    "previous_key": "old_key_base64...",
    "previous_expires_at": "2026-05-22T00:00:00Z"
  }
}
```

---

## 安全考量

- 私钥绝不能通过网络传输或在 Envelope 中泄露
- 签名不加密消息内容 —— 如需保密，应配合传输层加密（TLS/WSS）或端到端加密
- 签名覆盖 Envelope 的所有顶层字段（含 `message_id`、`timestamp`、`ttl`），可以有效防止重放和篡改
- 日志中不应记录完整签名值，建议只记录前 8 字符 + `...`
- 接收方应缓存最近见过的 `message_id`（保留时长为 TTL 的两倍），用于去重和防重放
