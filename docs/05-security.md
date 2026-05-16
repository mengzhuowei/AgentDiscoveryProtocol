# 05 — 安全模型

## 设计原则

v0.2 引入**自认证密码学身份**：Agent ID 的 user 段为公钥指纹，持有私钥即拥有该身份。无密钥轮换——换密钥 = 换 ID。

与 v0.1 的白名单模型向后兼容：无签名的消息降级为白名单检查。

---

## 威胁模型

| 级别 | 攻击 | v0.1 应对 | v0.2 应对 |
|------|------|-----------|-----------|
| L1 | 窃听消息 | TLS/WSS 加密 | 不变 |
| L2 | 伪造 Agent ID 发消息 | 白名单 | **Ed25519 签名 + proof_of_id 嵌入 Agent ID** |
| L2b | 篡改传输中的消息 | TLS（点对点） | **Ed25519 端到端签名**（Relay 无法篡改） |
| L2c | 篡改 Manifest | TLS（点对点） | **Manifest 自签名验证** |
| L3 | 重放消息 | 缓存已处理消息 ID（5 分钟） | 不变 + 签名绑定 id/timestamp |
| L4 | 大量虚假注册 | Registry token + 速率限制 | 不变 |
| L5 | **新增** 降级攻击（剥离 sig） | — | **可配置 required 模式强制签名** |
| L6 | **新增** 首次相遇 MITM | — | **多通道交叉验证 proof_of_id + 用户手动比对** |

### 不在范围内的威胁

- Agent 内部安全（由实现者负责）
- DDoS（由部署者负责）
- 已加入白名单的 Agent 作恶行为
- 私钥泄露后的身份恢复（无密钥轮换，换密钥 = 换 ID）

---

## 传输加密

| 链路 | 要求 |
|------|------|
| Agent ↔ Agent（内网） | 推荐 WSS，允许 WS |
| Agent ↔ Agent（跨公网） | **必须** WSS |
| Agent ↔ Relay | **必须** WSS |
| Agent ↔ Registry | 推荐 HTTPS |

---

## 密码学身份

### Agent ID 的自认证属性

```
adp://3QJmV3qT2ZxM7WdR9sFb5K@home.io/claude
      ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
      proof_of_id = Base58(BLAKE2b(ed25519_pubkey, 20))

验证链:
  Agent ID 的 user 段
    == Manifest.proof_of_id
    == Base58(BLAKE2b(Manifest.public_key, 20))
    → Manifest.signature 用 public_key 验签通过
    → 消息 sig 用 public_key 验签通过
    → ✅ 该消息确实来自 Agent ID 所标识的私钥持有者
```

无需 CA，无需 PKI，无需外部信任。详见 [`06-signatures.md`](06-signatures.md)。

### 无密钥轮换

与以太坊一致：换密钥 = 换 proof_of_id = 换 Agent ID。私钥丢失意味着 Agent ID 永久失效，需以新身份重建所有信任关系。

私钥管理建议：
- 存储于操作系统安全存储（如 Windows DPAPI、macOS Keychain、Linux keyring）
- 可选硬件安全模块（TPM、YubiKey）保护私钥
- 定期备份私钥（加密存储于离线介质）

---

## 信任模型

### TOFU（Trust On First Use）

```
首次相遇:
  1. 获取对方 Manifest
  2. 验证 Manifest 自签名
  3. 验证 proof_of_id 与 Agent ID user 段一致
  4. 钉扎 (agent_id, public_key, proof_of_id) 到 trust store
  5. 信任锚定

后续通信:
  1. 从 trust store 取出已钉扎的 public_key
  2. 验证消息 sig 字段
  3. 失败 → INVALID_SIGNATURE
```

### proof_of_id 变化检测

若已钉扎的 proof_of_id 发生变化（同一 Agent ID 出现不同 proof_of_id）：

```
→ "TRUST_CONFLICT" 告警
→ 用户手动决定是否接受新密钥
→ 实质上是新身份，应作为新 Agent ID 处理
```

### TOFU 首次相遇 MITM 风险

攻击者若在首次相遇时控制网络，可替换 Manifest 中的公钥，钉扎到错误的密钥。

缓解措施：
- **手动验证**：用户通过带外渠道（二维码、口述、消息应用）比对 proof_of_id
- **多通道验证**：Agent 通过多个发现渠道（mDNS + Registry）分别获取 Manifest，交叉比对 proof_of_id
- **SSH 风格警告**：proof_of_id 变化时大幅告警，拒绝自动更新

这与 SSH `known_hosts` 和 Signal safety number 的信任模型一致——是去中心化场景下的合理折衷。

### 信任模式配置

`~/.adp/config.json`：

```json
{
  "trust": {
    "mode": "optional",
    "require_signatures_for": [
      "adp://*@untrusted-domain.com/*"
    ]
  }
}
```

| 模式 | 行为 |
|------|------|
| `optional`（默认） | 有 sig 则验签，无 sig 则白名单降级 |
| `required` | 拒绝所有未签名消息。所有通信方必须是 v0.2+ |
| `whitelist_only` | 完整 v0.1 行为，忽略 sig |

### 信任模式选择指南

| 部署场景 | 推荐模式 |
|----------|----------|
| 家庭局域网（全自控 Agent） | `optional` |
| 跨组织协作 | `required`（按对方域名配置） |
| 开放网络/公网 Relay | `required` |
| 向后兼容过渡期 | `optional` |

---

## 白名单（v0.1 降级路径）

v0.2 保留白名单作为降级机制，仅对未签名的 v0.1 消息生效：

```json
{
  "whitelist": [
    "adp://bob@home.io/claude",
    "adp://team@company.com/ops-bot"
  ]
}
```

有 `sig` 的消息不受白名单影响——走完整验签流程。

---

## Registry 认证

Registry 的 PUT 请求支持可选的 `token` 字段（参见 [`03-discovery.md`](03-discovery.md)）。Registry 实现方可校验该 token（预共享密钥、JWT 等），防止未授权的注册。token 的分发与轮换由部署者自行管理。

---

## 后续版本展望

| 功能 | 状态 |
|------|------|
| 白名单信任 | v0.1 ✅，v0.2 降级保留 |
| Ed25519 消息签名 | v0.2 ✅ |
| Manifest 自签名 | v0.2 ✅ |
| proof_of_id 自认证身份 | v0.2 ✅ |
| TOFU trust store | v0.2 ✅ |
| 端到端加密 | 后续版本 |
| DID 集成 | 后续版本 |
| 证书/PKI | 后续版本 |
| 门限签名（多签 Agent） | 后续版本 |
