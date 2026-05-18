# 06 — 密码学身份

## 设计原则

v0.2 采用**自认证身份**——Agent ID 的 user 段直接为 Base64URL 编码的 Ed25519 公钥。任何人拿到 Agent ID 即可从中提取完整公钥验签，无需 CA、PKI 或额外查询。所有消息强制 Ed25519 签名。

换密钥 = 换公钥 = 换 Agent ID。旧身份可通过 `adp:key.rotate` 将信任传递给新密钥。详见 [`01-identity.md`](01-identity.md#密钥轮换)。

---

## 密码学原语

| 用途 | 算法 | 输入/输出 |
|------|------|-----------|
| 密钥对 | **Ed25519** (EdDSA over Curve25519) | 私钥 32B，公钥 32B |
| 签名编码 | **Base64URL** (RFC 7515，无填充) | 二进制 → 文本 |
| 公钥编码 | **Base64URL** (RFC 7515，无填充) | 二进制 → 文本 |
| JSON 规范化 | **ADP Canonical JSON** | JSON → 字节序列 |

Base64URL alphabet: `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_`（RFC 7515，无 `=` 填充）

---

## JSON 规范化

签名和验签双方必须对同一 JSON 对象生成**完全相同的字节序列**。ADP 定义 **ADP Canonical JSON**——一个易于在任何语言中实现的实用规范化方案：

核心规则：

- **紧凑序列化**：无空格、制表符、换行
- **键排序**：对象键按 Unicode codepoint 升序排列
- **标准字符串转义**：按 RFC 8259（`\n`、`\"`、`\\` 等，`\uXXXX` 使用小写十六进制）
- **跳过 undefined**：值为 `undefined` 的键直接省略（不序列化为 `null`）
- **合法 UTF-8**：规范化结果必须是合法 UTF-8 字节序列

**数字约束**：ADP Envelope 的顶层字段（`protocol`、`id`、`from`、`to`、`action`、`timestamp`、`sig`、`reply_to`）全部是字符串或对象类型，不存在数字规范化歧义。`params` 中如需数值，应使用整数（JSON 标准整数语法），避免依赖浮点精度。数组保持原始顺序，不排序。

实现提示：大多数 JSON 库开启 `sort_keys` + 紧凑模式（无缩进）即可满足上述规则。

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

数组保持原始顺序，不排序。

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
  "from": "adp://mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB@home.io/claude",
  "to": "adp://zLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIC@example.com/hermes",
  "action": "adp:ping",
  "params": {},
  "timestamp": "2026-05-16T17:30:00.000Z"
}

规范化:
  {"action":"adp:ping","from":"adp://mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB@home.io/claude","id":"msg_2x4k9m7q","params":{},"protocol":"adp/0.2","timestamp":"2026-05-16T17:30:00.000Z","to":"adp://zLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIC@example.com/hermes"}
```

---

## Agent ID 中的公钥编码

Agent ID 的 user 段为 Ed25519 公钥的 Base64URL（无填充）编码——**直接嵌入完整公钥，不做哈希**。任何人拿到 Agent ID 即可从中提取公钥验签，无需外部查询。

```
输入:  ed25519_public_key  (32 字节原始二进制)
步骤1: pubkey_b64url = Base64URL_NoPad_Encode(public_key)
输出:  43 字符的字符串
```

32 字节 = 256 位公钥空间，完整编码无信息损失。Base64URL 无填充编码标准化于 RFC 7515（JWS），生态成熟。与 libp2p peer ID、Nostr npub 的原理一致（编码格式不同，语义相同）。

### 示例

```
public_key (hex):  "98bab7c7d67529f47bb4dc0fd9b56c43c709e611b8985e9a63474bdc9f15f264"
pubkey_b64url (Agent ID user 段): "mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB"
```

---

## 消息签名

### Envelope 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sig` | string (Base64URL, 无填充) | **是** | Ed25519 签名，覆盖不含 sig 的规范化 Envelope |

### 签名消息示例

```json
{
  "protocol": "adp/0.2",
  "id": "msg_2x4k9m7q",
  "from": "adp://mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB@home.io/claude",
  "to": "adp://zLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIC@example.com/hermes",
  "action": "adp:ping",
  "params": {},
  "timestamp": "2026-05-16T17:30:00.000Z",
  "sig": "dGhpcyBpcyBhIHNpZ25hdHVyZSBleGFtcGxlIGZvciB0aGUgYWRwIHByb3RvY29s..."
}
```

### 签名过程（发送方）

```
1. 构建 Envelope E，不含 sig 字段
2. canonical = ADP_Canonicalize(E)
3. sig_bytes = Ed25519_Sign(private_key, canonical)
4. E["sig"] = Base64URL_NoPad(sig_bytes)
5. 发送 E
```

### 验证过程（接收方）

```
输入: envelope E, trust_store TS, current_time now

1. from = E["from"]
2. pubkey = Base64URLDecode(extract_user(from))  // Agent ID user 段即公钥

3. sig_b64url = E["sig"]
4. sig 不存在 → 拒绝 "INVALID_SIGNATURE"（签名缺失）
5. sig_bytes = Base64URLDecode(sig_b64url)
6. len(sig_bytes) != 64 → 拒绝 "INVALID_SIGNATURE"

7. timestamp = E["timestamp"]
8. |now - timestamp| > 300s → 拒绝 "INVALID_PARAMS"（消息已过期或时钟偏差过大）

9. E_verify = copy(E), 删除 E_verify["sig"]
10. canonical = ADP_Canonicalize(E_verify)

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
  "adp://mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB@home.io/claude": {
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
  "adp://mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB@home.io/claude": {
    "public_key": "MCowBQYDK2VwAyEA...",
    "first_seen": "2026-05-16T17:00:00.000Z",
    "last_verified": "2026-05-16T17:30:00.000Z",
    "origin": "tofu",
    "verified_by": ["mdns", "registry"],
    "superseded_by": "adp://xLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZID@home.io/claude"
  },
  "adp://xLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZID@home.io/claude": {
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
| 重放 | 消息 `id` 去重 + `timestamp` 新鲜度校验（300s 窗口）+ sig 绑定 id/timestamp |
| 首次相遇 MITM | 多通道交叉验证 + visual_code 人工比对 + pinned trust 预信任 |
| Registry 返回虚假记录 | rotation_chain 逐跳验签 + 终端本地验签。Registry 无法让对端接受伪造身份 |
| 私钥泄露 | 泄露前可通过 `adp:key.rotate` 轮换到新身份；泄露后无轮换声明则身份永久失效 |

首次相遇的 TOFU 局限是刻意的——在无中心化 CA 的去中心化场景下，这是必要的安全基线。ADP 在此基础上提供多通道交叉验证和 pinned trust 作为分层加固，满足更高安全等级的场景。ADP TOFU 与 SSH TOFU 的关键差异详见 [`05-security.md`](05-security.md)。
