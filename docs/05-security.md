# 05 — 安全模型

## 设计原则

v0.2 采用**强制密码学身份**：所有消息必须附带 Ed25519 签名，所有 Manifest 必须自签名。无签名 = 拒绝。Agent ID 的 user 段为公钥指纹，持有私钥即拥有该身份。无密钥轮换——换密钥 = 换 ID。

---

## 威胁模型

| 级别 | 攻击 | 应对 |
|------|------|------|
| L1 | 窃听消息 | TLS/WSS 加密 |
| L2 | 伪造 Agent ID 发消息 | **Ed25519 强制签名** + proof_of_id 嵌入 Agent ID |
| L2b | 篡改传输中的消息 | TLS（点对点）+ **Ed25519 端到端签名**（Relay 无法篡改） |
| L2c | 篡改 Manifest | **Manifest 自签名验证** |
| L3 | 重放消息 | 消息 ID 去重（5 分钟缓存）+ timestamp 新鲜度校验（60 秒窗口）+ 签名绑定 id/timestamp |
| L4 | 大量虚假注册 | Registry token + 速率限制 |
| L5 | 首次相遇 MITM | 多通道交叉验证 proof_of_id + 用户手动比对 |

### 不在范围内的威胁

- Agent 内部安全（由实现者负责）
- DDoS（由部署者负责）
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

## 信任模型（TOFU）

ADP 采用 Trust On First Use（TOFU）信任模型——首次相遇时钉扎对方公钥，后续通信只验签。完整密码学流程见 [`06-signatures.md`](06-signatures.md)，此处聚焦安全语义。

### 首次相遇

1. 获取对方 Manifest → 验证自签名 → 验证 proof_of_id 与 Agent ID 一致
2. 钉扎 `(agent_id, public_key, proof_of_id)` 到本地 trust store
3. 信任锚定

此后任何签名验签失败均拒绝，不自动更新密钥。

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
- **标准化展示格式**：proof_of_id 应以分段形式展示便于人工比对（如 `3QJmV 3qT2Zx M7WdR 9sFb5K`）

这与 SSH `known_hosts` 和 Signal safety number 的信任模型一致——是去中心化场景下的合理折衷。

---

## Registry 认证

Registry 的 PUT 请求支持可选的 `token` 字段（参见 [`03-discovery.md`](03-discovery.md)）。Registry 实现方可校验该 token（预共享密钥、JWT 等），防止未授权的注册。token 的分发与轮换由部署者自行管理。

---

## 后续版本展望

| 功能 | 状态 |
|------|------|
| Ed25519 消息签名（强制） | v0.2 ✅ |
| Manifest 自签名（强制） | v0.2 ✅ |
| proof_of_id 自认证身份 | v0.2 ✅ |
| TOFU trust store | v0.2 ✅ |
| 端到端加密 | 后续版本 |
| DID 集成 | 后续版本 |
| 证书/PKI | 后续版本 |
| 门限签名（多签 Agent） | 后续版本 |
