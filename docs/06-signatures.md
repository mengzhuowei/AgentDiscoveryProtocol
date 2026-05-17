# 06 — 密码学身份

## 设计原则

v0.2 采用**自认证身份**——Agent ID 的 user 段直接为 Base58 编码的 Ed25519 公钥。任何人拿到 Agent ID 即可从中提取完整公钥验签，无需 CA、PKI 或额外查询。所有消息强制 Ed25519 签名。

换密钥 = 换公钥 = 换 Agent ID。旧身份可通过 `adp:key.rotate` 将信任传递给新密钥。详见 [`01-identity.md`](01-identity.md#密钥轮换)。

---

## 密码学原语

| 用途 | 算法 | 输入/输出 |
|------|------|-----------|
| 密钥对 | **Ed25519** (EdDSA over Curve25519) | 私钥 32B，公钥 32B |
| 签名编码 | **Base64** (RFC 4648，含填充) | 二进制 → 文本 |
| 公钥编码 | **Base58** (Bitcoin alphabet) | 二进制 → 文本 |
| JSON 规范化 | **RFC 8785 (JCS)** | JSON → 字节序列 |

Base58 alphabet: `123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz`

---

## JSON 规范化

签名和验签双方必须对同一 JSON 对象生成**完全相同的字节序列**。ADP 采用 **RFC 8785 — JSON Canonicalization Scheme (JCS)**。

核心规则摘要：

- 无空白（无空格、制表符、换行）
- 对象键按 Unicode codepoint 排序
- 字符串统一双引号，按 RFC 8259 转义（`\uXXXX` 使用大写十六进制）
- 数字按 JSON 数字语法（无指数、无前导零、无尾随零、必须有整数部分）
- `undefined` 值对应的键直接省略
- 规范化结果必须是合法 UTF-8

### 与 RFC 8785 的关系

ADP 采用 RFC 8785 全文，无修改。以下测试向量与 RFC 8785 Appendix A 兼容，补充了 ADP 特有场景。

### 测试向量

以下向量用于跨实现一致性验证。任何合规实现必须产生相同的规范化输出。

**向量 1：基本键排序**

```
输入:
  {"b":2,"a":1}

规范化:
  {"a":1,"b":2}
```

**向量 2：嵌套对象**

```
输入:
  {"z":{"b":2,"a":1},"a":1}

规范化:
  {"a":1,"z":{"a":1,"b":2}}
```

**向量 3：数组（不排序）**

```
输入:
  [3,1,2]

规范化:
  [3,1,2]
```

RFC 8785 JCS 仅排序对象键，不排序数组元素。数组保持原始顺序。

**向量 4：字符串转义**

```
输入:
  {"key":"value\nwith\"quotes"}

规范化:
  {"key":"value\nwith\"quotes"}
```

**向量 5：undefined 值省略**

```
输入:
  {"a":1,"b":undefined,"c":3}

规范化:
  {"a":1,"c":3}
```

**向量 6：ADP Envelope（不含 sig）**

```
输入:
{
  "protocol": "adp/0.2",
  "id": "msg_2x4k9m7q",
  "from": "adp://3QJmV3qT2ZxM7WdR9sFb5K8cJ5hG4mF6aY0dL3kX1yZ9aB@home.io/claude",
  "to": "adp://8aB2cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV3wX4yZ5aB6cD@example.com/hermes",
  "action": "adp:ping",
  "params": {},
  "timestamp": "2026-05-16T17:30:00.000Z"
}

规范化:
  {"action":"adp:ping","from":"adp://3QJmV3qT2ZxM7WdR9sFb5K8cJ5hG4mF6aY0dL3kX1yZ9aB@home.io/claude","id":"msg_2x4k9m7q","params":{},"protocol":"adp/0.2","timestamp":"2026-05-16T17:30:00.000Z","to":"adp://8aB2cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV3wX4yZ5aB6cD@example.com/hermes"}
```

---

## Agent ID 中的公钥编码

Agent ID 的 user 段为 Ed25519 公钥的 Base58 编码——**直接嵌入完整公钥，不做哈希**。任何人拿到 Agent ID 即可从中提取公钥验签，无需外部查询。

```
输入:  ed25519_public_key  (32 字节原始二进制)
步骤1: pubkey_b58 = Base58Encode(public_key)
输出:  ~44 字符的字符串
```

32 字节 = 256 位公钥空间，完整编码无信息损失。与 libp2p peer ID、Nostr npub 的设计一致。

### 示例

```
public_key (Base64): "MCowBQYDK2VwAyEAmLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1y"
pubkey_b58 (Agent ID user 段): "3QJmV3qT2ZxM7WdR9sFb5K8cJ5hG4mF6aY0dL3kX1yZ9aB"
```

---

## 消息签名

### Envelope 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sig` | string (Base64) | **是** | Ed25519 签名，覆盖不含 sig 的规范化 Envelope |

### 签名消息示例

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

### 签名过程（发送方）

```
1. 构建 Envelope E，不含 sig 字段
2. canonical = RFC8785_Canonicalize(E)
3. sig_bytes = Ed25519_Sign(private_key, canonical)
4. E["sig"] = Base64(sig_bytes)
5. 发送 E
```

### 验证过程（接收方）

```
输入: envelope E, trust_store TS, current_time now

1. from = E["from"]
2. pubkey = Base58Decode(extract_user(from))  // Agent ID user 段即公钥

3. sig_b64 = E["sig"]
4. sig 不存在 → 拒绝 "INVALID_SIGNATURE"（签名缺失）
5. sig_bytes = Base64Decode(sig_b64)
6. len(sig_bytes) != 64 → 拒绝 "INVALID_SIGNATURE"

7. timestamp = E["timestamp"]
8. |now - timestamp| > 60s → 拒绝 "INVALID_PARAMS"（消息已过期或时钟偏差过大）

9. E_verify = copy(E), 删除 E_verify["sig"]
10. canonical = RFC8785_Canonicalize(E_verify)

11. // Agent ID 即身份：公钥直接从 from 字段提取，无需查询 Manifest
12. if TS.lookup(from) is None:
13.     // 首次相遇 → 钉扎。多通道交叉验证由上层在通信前完成（详见 01-identity.md）
14.     TS.store(from, pubkey)
15.
16. if Ed25519_Verify(pubkey, canonical, sig_bytes):
17.     通过
18. else:
19.     拒绝 "INVALID_SIGNATURE"
```

### Trust Store

本地持久化存储，记录已验证的身份映射：

```json
{
  "adp://3QJmV3qT2ZxM7WdR9sFb5K8cJ5hG4mF6aY0dL3kX1yZ9aB@home.io/claude": {
    "public_key": "MCowBQYDK2VwAyEA...",
    "first_seen": "2026-05-16T17:00:00.000Z",
    "last_verified": "2026-05-16T17:30:00.000Z",
    "origin": "tofu",
    "verified_by": ["mdns", "registry"],
    "superseded_by": null
  }
}
```

| 字段 | 说明 |
|------|------|
| `origin` | `"tofu"` — 首次相遇钉扎；`"pinned"` — 静态配置预信任；`"rotation"` — 通过 `adp:key.rotate` 继承信任 |
| `verified_by` | 验证来源列表：`"mdns"` / `"registry"` / `"static"` / `"tofu_single"` / `"user_confirmed"` |
| `superseded_by` | 指向轮换后的新 Agent ID（`null` 表示当前活跃） |

### 轮换后的 Trust Store

收到有效 `adp:key.rotate` 后，对端写入新记录并链接旧记录：

```json
{
  "adp://3QJmV3qT2ZxM7WdR9sFb5K8cJ5hG4mF6aY0dL3kX1yZ9aB@home.io/claude": {
    "public_key": "MCowBQYDK2VwAyEA...",
    "first_seen": "2026-05-16T17:00:00.000Z",
    "last_verified": "2026-05-16T17:30:00.000Z",
    "origin": "tofu",
    "verified_by": ["mdns", "registry"],
    "superseded_by": "adp://2xK3qR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZ9aB2cD4eF@home.io/claude"
  },
  "adp://2xK3qR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZ9aB2cD4eF@home.io/claude": {
    "public_key": "MCowBQYDK2VwAyEAm...",
    "first_seen": "2026-05-17T10:00:00.000Z",
    "last_verified": "2026-05-17T10:00:00.000Z",
    "origin": "rotation",
    "verified_by": ["rotation"],
    "superseded_by": null
  }
}
```

每次验签时 Gateway 先查活跃身份（`superseded_by: null`）。若旧身份已标记 `superseded_by`，自动跟随链找到最新活跃身份，使用对应公钥验签。

存储位置：`~/.adp/trust_store.json`

---

## 信任模型（TOFU）

ADP 采用 Trust On First Use——首次相遇时钉扎对方公钥，后续通信只验签。首次相遇流程、MITM 风险及缓解措施详见 [`05-security.md`](05-security.md)。

---

## Relay 透传

```
Gateway A          Relay              Gateway B
   │                  │                    │
   │── 签名 Envelope ─►│                    │
   │  (含 sig)        │                    │
   │                  │── 转发 Envelope ──►│
   │                  │  (sig 不变)        │── 验签 ✓
```

Relay 只转发，不修改。`sig` 端到端可验证，Relay 无法伪造。Relay 认证仅做接入控制，Agent 身份安全由消息签名保证。

---

## 安全边界

| 威胁 | 应对 |
|------|------|
| 伪造 Agent 消息 | 无对应私钥，签不出有效 sig |
| 伪造 Agent ID | Agent ID 即公钥——假 ID 没有对应私钥，消息签名必然失败 |
| 重放 | 消息 `id` 去重 + `timestamp` 新鲜度校验（60s 窗口）+ sig 绑定 id/timestamp |
| 首次相遇 MITM | 多通道交叉验证 + visual_code 人工比对 + pinned trust 预信任 |
| Registry 返回虚假记录 | rotation_chain 逐跳验签 + 终端本地验签。Registry 无法让对端接受伪造身份 |
| 私钥泄露 | 泄露前可通过 `adp:key.rotate` 轮换到新身份；泄露后无轮换声明则身份永久失效 |

首次相遇的 TOFU 局限是刻意的——与 SSH 首次连接信任模型一致，在去中心化场景下是合理的折衷。多通道交叉验证和 pinned trust 为不同安全等级的场景提供了分层加固。
