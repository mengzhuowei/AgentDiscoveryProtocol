# 06 — 密码学身份

## 设计原则

v0.2 采用**自认证身份**——Agent ID 中嵌入公钥指纹，持有私钥即拥有该 ID，无需 CA 或 PKI。所有消息强制 Ed25519 签名。

无密钥轮换。换密钥 = 换 ID，与以太坊钱包地址一致。

---

## 密码学原语

| 用途 | 算法 | 输入/输出 |
|------|------|-----------|
| 密钥对 | **Ed25519** (EdDSA over Curve25519) | 私钥 32B，公钥 32B |
| 哈希 | **BLAKE2b**，输出 20 字节 | 公钥 → 指纹 |
| 公钥/签名编码 | **Base64** (RFC 4648，含填充) | 二进制 → 文本 |
| 指纹编码 | **Base58** (Bitcoin alphabet) | 二进制 → 文本 |
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
  "from": "adp://3QJmV3qT2ZxM7WdR9sFb5K@home.io/claude",
  "to": "adp://8aB2cD4eF5gH6iJ7kL8mN9oP@example.com/hermes",
  "action": "adp:ping",
  "params": {},
  "timestamp": "2026-05-16T17:30:00.000Z"
}

规范化:
  {"action":"adp:ping","from":"adp://3QJmV3qT2ZxM7WdR9sFb5K@home.io/claude","id":"msg_2x4k9m7q","params":{},"protocol":"adp/0.2","timestamp":"2026-05-16T17:30:00.000Z","to":"adp://8aB2cD4eF5gH6iJ7kL8mN9oP@example.com/hermes"}
```

---

## proof_of_id 推导

```
输入:  ed25519_public_key  (32 字节原始二进制)
步骤1: fingerprint = BLAKE2b(public_key, output=20)
步骤2: proof_of_id = Base58Encode(fingerprint)
输出:  ~27 字符的字符串
```

20 字节 = 160 位安全空间。与比特币地址（RIPEMD-160）和以太坊地址（keccak256 取 20 字节）的安全强度一致。

BLAKE2b 选型理由：与 Ed25519 同在 libsodium 中，速度快，无长度扩展攻击。

### 示例

```
public_key (Base64): "MCowBQYDK2VwAyEAmLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1y"
proof_of_id:          "3QJmV3qT2ZxM7WdR9sFb5K"
```

---

## Manifest 自签名

### 签名相关字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `public_key` | string (Base64) | Ed25519 公钥，32 字节原始 |
| `proof_of_id` | string (Base58) | 从 public_key 推导的指纹 |
| `signature` | string (Base64) | Manifest 自签名（不含 signature 字段的规范化 JSON 的 Ed25519 签名） |

### 完整 Manifest 示例

```json
{
  "protocol": "adp/0.2",
  "agent_id": "adp://3QJmV3qT2ZxM7WdR9sFb5K@home.io/claude",
  "display_name": "Claude",
  "description": "家庭智能体",
  "capabilities": [
    "adp:ping",
    "adp:capability.query",
    "adp:info",
    { "capability": "custom:code.review", "description": "审查代码 PR" }
  ],
  "public_key": "MCowBQYDK2VwAyEAmLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1y",
  "proof_of_id": "3QJmV3qT2ZxM7WdR9sFb5K",
  "routes": [
    { "type": "direct", "address": "192.168.1.100:9800" }
  ],
  "agent_info": {
    "platform": "linux",
    "runtime": "node/22"
  },
  "updated_at": "2026-05-16T17:00:00.000Z",
  "signature": "iGdF8s0xK3qR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZ9aB2cD4eF5gH6iJ7kL8mN..."
}
```

### 签名过程

```
1. 生成 Ed25519 密钥对 (private_key, public_key)
2. 计算 proof_of_id = Base58(BLAKE2b(public_key, 20))
3. 构建 Manifest 对象 M，包含所有字段但 signature 为空
4. canonical = RFC8785_Canonicalize(M)
5. sig_bytes = Ed25519_Sign(private_key, canonical)
6. M["signature"] = Base64(sig_bytes)
7. 发布 M
```

### 验证过程

```
输入: manifest M

1. 提取 M["public_key"], M["proof_of_id"], M["signature"]
2. 三者任一缺失 → 拒绝 "Missing cryptographic fields"
3. pk_bytes = Base64Decode(public_key)
4. len(pk_bytes) != 32 → 拒绝 "Invalid public key length"
5. computed = Base58(BLAKE2b(pk_bytes, 20))
6. computed != proof_of_id → 拒绝 "PROOF_OF_ID_MISMATCH"
7. M_no_sig = copy(M), 删除 M_no_sig["signature"]
8. canonical = RFC8785_Canonicalize(M_no_sig)
9. sig_bytes = Base64Decode(signature)
10. len(sig_bytes) != 64 → 拒绝 "Invalid signature length"
11. !Ed25519_Verify(pk_bytes, canonical, sig_bytes) → 拒绝 "Invalid signature"
12. 通过 → 返回 (agent_id, public_key, proof_of_id)
```

### 从 Agent ID 中提取 proof_of_id

```
Agent ID: adp://3QJmV3qT2ZxM7WdR9sFb5K@home.io/claude
              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
              user 段 = proof_of_id

接收方验证:
  1. 从 Agent ID 的 user 段提取 proof_of_id
  2. 获取 Manifest → 验证 proof_of_id = Base58(BLAKE2b(public_key, 20))
  3. 两者一致 → Agent ID 与 Manifest 的密码学绑定确认
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
  "from": "adp://3QJmV3qT2ZxM7WdR9sFb5K@home.io/claude",
  "to": "adp://8aB2cD4eF5gH6iJ7kL8mN9oP@example.com/hermes",
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
2. proof_of_id_from_id = extract_proof_of_id(from)  // 从 Agent ID user 段提取

3. sig_b64 = E["sig"]
4. sig 不存在 → 拒绝 "INVALID_SIGNATURE"（签名缺失）
5. sig_bytes = Base64Decode(sig_b64)
6. len(sig_bytes) != 64 → 拒绝 "INVALID_SIGNATURE"

7. timestamp = E["timestamp"]
8. |now - timestamp| > 60s → 拒绝 "INVALID_PARAMS"（消息已过期或时钟偏差过大）

9. E_verify = copy(E), 删除 E_verify["sig"]
10. canonical = RFC8785_Canonicalize(E_verify)

11. public_key = TS.lookup(from)
12. if public_key is None:
13.     // 首次相遇 → 获取并验证 Manifest
14.     manifest = fetch_manifest(from)
15.     result = verify_manifest(manifest)
16.     result 验证失败 → 拒绝，附具体错误码
17.
18.     // 交叉验证：Manifest.proof_of_id 必须等于 Agent ID 的 user 段
19.     if result.proof_of_id != proof_of_id_from_id:
20.         → 拒绝 "PROOF_OF_ID_MISMATCH"
21.
22.     TS.store(from, result.public_key, result.proof_of_id)
23.     public_key = result.public_key

24. if Ed25519_Verify(public_key, canonical, sig_bytes):
25.     通过
26. else:
27.     拒绝 "INVALID_SIGNATURE"
```

### Trust Store

本地持久化存储，记录已验证的身份映射：

```json
{
  "adp://3QJmV3qT2ZxM7WdR9sFb5K@home.io/claude": {
    "public_key": "MCowBQYDK2VwAyEA...",
    "proof_of_id": "3QJmV3qT2ZxM7WdR9sFb5K",
    "first_seen": "2026-05-16T17:00:00.000Z",
    "last_verified": "2026-05-16T17:30:00.000Z",
    "origin": "tofu"
  }
}
```

存储位置：`~/.adp/trust_store.json`

---

## 信任模型（TOFU）

### 首次相遇

```
1. 接收方获取发送方的 Manifest
2. 验证 Manifest 自签名
3. 验证 proof_of_id 与 Agent ID user 段一致
4. 钉扎 (agent_id, public_key, proof_of_id)
5. 信任锚定
```

### 后续通信

```
1. 从 trust store 取出已钉扎的 public_key
2. 验证消息 sig 字段
3. 通过 → 消息来自持有该私钥的 Agent
4. 失败 → 身份不匹配 → 拒绝
```

### proof_of_id 变化

如果收到的消息 `from` 与已知的 Agent ID 相同但 proof_of_id 不同（意味着对方换了一个密钥对但仍然宣称自己是同一个 agent_name）：

```
→ "TRUST_CONFLICT" 告警
→ 用户手动决定是否信任新密钥
→ 新密钥 = 新 Agent ID，应作为新身份处理
```

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

## 标准错误码

| 错误码 | 含义 |
|--------|------|
| `INVALID_SIGNATURE` | 消息签名缺失或验签失败 |
| `PROOF_OF_ID_MISMATCH` | Manifest 的 proof_of_id 与 public_key 不匹配，或与 Agent ID 的 user 段不匹配 |
| `TRUST_CONFLICT` | 已钉扎的 proof_of_id 与当前收到的不同 |

---

## 安全边界

| 威胁 | 应对 |
|------|------|
| 伪造 Agent 消息 | 无对应私钥，签不出有效 sig |
| 替换 Manifest 公钥 | proof_of_id 变化 → TOFU 钉扎检测 |
| 重放 | 消息 `id` 去重 + `timestamp` 新鲜度校验（60s 窗口）+ sig 绑定 id/timestamp |
| 首次相遇 MITM | TOFU 固有局限；多通道交叉验证 proof_of_id；用户手动比对（类似 SSH known_hosts / Signal safety number） |

首次相遇的 TOFU 局限是刻意的——与 SSH 首次连接信任模型一致，在去中心化场景下是合理的折衷。
