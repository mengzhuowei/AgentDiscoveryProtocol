# 01 — 身份与能力

## Agent ID

Agent 使用自认证 URI 标识，`user` 段为从 Ed25519 公钥推导的指纹，与网络地址解耦：

```
adp://{proof_of_id}@domain[/agent_name]
```

示例：

```
adp://3QJmV3qT2ZxM7WdR9sFb5K@home.io/claude
adp://8aB2cD4eF5gH6iJ7kL8mN9oP@example.com/hermes
adp://2xK3qR7tNwP2bVsQ8cJ5hG4mF6a@company.com/ops-bot
```

### 为什么 user 段是公钥指纹

持有 Ed25519 私钥 → 推导公钥 → 哈希得 proof_of_id。`proof_of_id` 嵌入 Agent ID，任何人可离线验证"这个 Agent ID 确实属于持有对应私钥的人"。无需 CA，无需 PKI——与以太坊钱包地址原理相同。

换密钥 = 换 proof_of_id = 换 Agent ID。无密钥轮换机制。

### 字段规则

| 段 | 必填 | 规则 |
|---|---|---|
| `proof_of_id` | 是 | Base58 编码的 BLAKE2b(ed25519_pubkey, 20)，~27 字符 |
| `@domain` | 是 | 合法域名，小写，最长 255 字符。路由/发现基于此域名 |
| `/agent_name` | 否 | 小写字母、数字、`_`、`-`，最长 32 字符 |

整体不超过 512 字符。省略 `agent_name` 时，由发现机制决定如何解析：
- **Registry**：指向该 proof_of_id + domain 在 Registry 中设置的默认 Agent
- **mDNS / 静态配置**：不支持省略，必须使用完整 ID

### 本地别名

Agent ID 中 user 段不可读，Agent 可维护本地别名方便记忆：

```json
{ "nick": "bob", "target_id": "adp://3QJmV3qT2ZxM7WdR9sFb5K@home.io/claude" }
```

发送时 Gateway 展开为完整 ID。别名仅本地有效，不跨 Agent 共享。

---

## Manifest

每个 Agent 公开一份 Manifest，声明身份和能力。Manifest 为**自签名**——`signature` 字段证明发布者持有对应 `public_key` 的私钥。

### 结构

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
    "custom:code.review"
  ],
  "public_key": "MCowBQYDK2VwAyEAmLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1y",
  "proof_of_id": "3QJmV3qT2ZxM7WdR9sFb5K",
  "endpoints": {
    "gateway": "ws://192.168.1.100:9800/adp"
  },
  "agent_info": {
    "platform": "linux",
    "runtime": "node/22"
  },
  "updated_at": "2026-05-16T17:00:00Z",
  "signature": "iGdF8s0xK3qR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZ9aB2cD4eF5gH6iJ7kL8mN..."
}
```

### 字段说明

| 字段 | 必填 | 说明 |
|---|---|---|
| `protocol` | 是 | 协议版本，当前 `"adp/0.2"` |
| `agent_id` | 是 | 完整 Agent ID，user 段为 proof_of_id |
| `display_name` | 是 | 可读名称 |
| `description` | 否 | 简短描述 |
| `capabilities` | 是 | 支持的能力列表，格式 `[namespace]:[action]` |
| `public_key` | 是 | Ed25519 公钥，Base64 编码（原始 32 字节） |
| `proof_of_id` | 是 | BLAKE2b(public_key, 20)，Base58 编码。必须与 agent_id 的 user 段一致 |
| `endpoints` | 推荐 | 接入点；Gateway 地址用于直连 |
| `agent_info` | 否 | 可选的实现元信息（`platform`、`runtime` 等自由字段） |
| `updated_at` | 是 | 最后更新时间，ISO 8601 UTC |
| `signature` | 是 | Manifest 自签名，覆盖不含 signature 字段的规范化 JSON |

### 身份验证

接收方获取 Manifest 后按以下步骤验证：

1. `Base58(BLAKE2b(Base64Decode(public_key), 20)) == proof_of_id` — 公钥与指纹一致
2. `proof_of_id == Agent ID 的 user 段` — Manifest 与 Agent ID 绑定
3. Manifest 自签名 `signature` 验签通过 — 发布者持有私钥

三条全部通过，身份确认。任何一条失败，拒绝。详细算法见 [`06-signatures.md`](06-signatures.md)。

### 获取方式

1. 发送 `adp:capability.query` 请求，对方返回 Manifest
2. 通过 mDNS 发现 Agent 后，再发起 `adp:capability.query` 获取 Manifest（局域网场景）
3. 从 Registry 解析时一并获取缓存的 Manifest（跨网络场景）

Gateway 应缓存已知 Agent 的 Manifest，定时刷新。

### 首次相遇（TOFU）

```
1. 获取 Manifest → 验证自签名 → 验证 proof_of_id 与 Agent ID 一致
2. 钉扎 (agent_id, public_key, proof_of_id) 到本地 trust store
3. 后续通信只验签，不再重复获取 Manifest（除非 Manifest 更新）
4. 若已钉扎的 proof_of_id 与新收到的不同 → "TRUST_CONFLICT" 告警
```

TOFU 的局限：首次相遇若遭遇 MITM，攻击者可替换 Manifest。缓解：多通道交叉验证 proof_of_id、用户手动比对指纹（同 SSH known_hosts）。详见 [`05-security.md`](05-security.md)。

---

## 能力标识

两段式命名空间：`[namespace]:[action]`

### 标准能力（`adp:` 命名空间）

| 标识 | 级别 | 说明 |
|---|---|---|
| `adp:ping` | **必须** | 探活 |
| `adp:capability.query` | **必须** | 查询对方能力清单 |
| `adp:info` | 推荐 | 发送简短文本通知（无固定结构，由收发双方约定语义） |

> 标准能力只定义互操作的最小基线。`adp:ping` 和 `adp:capability.query` 是所有 Agent 必须实现的。

### 标准能力参数

**`adp:ping`**

请求方 `params` 为空 `{}`。响应方在 `params` 中可附带任意信息（如 `uptime`、`version`），不做强制约定。

**`adp:capability.query`**

请求方 `params` 为空 `{}`。响应方在 `params` 中返回完整 Manifest：

```json
{
  "params": {
    "manifest": { /* 完整 Manifest 对象 */ }
  }
}
```

**`adp:info`**

请求方 `params` 中附带消息内容，无强制格式——由发送方和接收方自行约定：

```json
{
  "params": {
    "message": "晚饭准备好了"
  }
}
```

### 自定义能力

```
custom:code.review
custom:file.share
custom:weather.query
```

自定义能力可附带 JSON Schema 描述输入输出（可选，初期不强制）：

```json
{
  "capability": "custom:code.review",
  "input_schema": {
    "type": "object",
    "properties": {
      "repo": { "type": "string" },
      "pr": { "type": "integer" }
    },
    "required": ["repo", "pr"]
  }
}
```
