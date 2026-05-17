# 05 — 安全模型

## 设计原则

v0.2 采用**强制密码学身份**：所有消息必须附带 Ed25519 签名，无签名 = 拒绝。Agent ID 即公钥——持有私钥即拥有该身份。

---

## 威胁模型

| 级别 | 攻击 | 应对 |
|------|------|------|
| L1 | 窃听消息 | TLS/WSS 加密 |
| L2 | 伪造 Agent ID 发消息 | **Ed25519 强制签名** + 公钥嵌入 Agent ID |
| L2b | 篡改传输中的消息 | TLS（点对点）+ **Ed25519 端到端签名**（Relay 无法篡改） |
| L2c | 篡改 Manifest | Manifest 由消息 sig 保护——篡改内容导致 Envelope 变化，验签失败 |
| L3 | 重放消息 | 消息 ID 去重（5 分钟缓存）+ timestamp 新鲜度校验（60 秒窗口）+ 签名绑定 id/timestamp |
| L4 | 大量虚假注册 | Registry token + 速率限制 |
| L5 | 首次相遇 MITM | 多通道交叉验证 Agent ID + visual_code 人工比对 + pinned trust 预信任 |
| L6 | Registry 返回虚假记录 | **终端验签**——rotation_chain 逐跳验证 + 消息 sig 验签。Registry 无法让终端接受伪造身份 |

### Registry 的安全定位

Registry 是**不可信服务**——协议明确不依赖 Registry 做任何信任决策：

| Registry 能做到的 | Registry 做不到的 |
|---------------------|---------------------|
| 返回过期数据 → 终端发现 Agent 不在线 | 伪造 Manifest → 携带此 Manifest 的消息 sig 验签失败，直接拒绝 |
| 不返回数据 → DoS | 伪造 rotation_sig → 旧公钥验签失败，直接拒绝 |
| 返回空的 rotation_chain → 终端走纯 TOFU | 伪造 rotation_sig → 旧公钥验签失败，拒绝整条链 |
| 注册虚假 Agent → 该 Agent 拿不出对应私钥 | 让终端接受一个假的 Agent ID → Agent ID 即公钥，假 ID 没有对应私钥 |

Registry 被完全攻破的后果上限：**DoS 或迫使终端退化为纯 TOFU**。终端永远在本地用密码学验证。

### 不在范围内的威胁

- Agent 内部安全（由实现者负责）
- DDoS（由部署者负责）
- 私钥泄露后无轮换声明的情况——若旧私钥已不可用，身份无法恢复（需以新身份重建信任关系）

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

Agent ID 的 user 段为 Base58 编码的 Ed25519 公钥——任何人拿到 Agent ID 即可提取公钥验签，无需 CA、PKI 或外部查询。详见 [`06-signatures.md`](06-signatures.md)。

密钥轮换机制及轮换不可恢复的场景见 [`01-identity.md`](01-identity.md#密钥轮换)。

私钥管理建议：
- 存储于操作系统安全存储（如 Windows DPAPI、macOS Keychain、Linux keyring）
- 可选硬件安全模块（TPM、YubiKey）保护私钥
- 定期备份私钥（加密存储于离线介质）
- **定期轮换密钥**：私钥安全时主动轮换，在 trust store 中建立信任链。不要等到泄露才处理

---

## 信任模型（TOFU）

ADP 采用 Trust On First Use（TOFU）信任模型——首次相遇时钉扎对方公钥，后续通信只验签。完整密码学流程见 [`06-signatures.md`](06-signatures.md)，此处聚焦安全语义。

### 首次相遇

1. 获取对方 Agent ID → Base58Decode user 段 → 公钥
2. 多通道交叉比对 Agent ID 一致（见 01-identity.md）
3. 验签消息 sig → 通过
4. 钉扎 Agent ID 到本地 trust store
5. 信任锚定

此后任何签名验签失败均拒绝，不自动更新密钥。

### 公钥变化检测

若已钉扎的 public_key 发生变化（同一 Agent ID 出现不同公钥）：

```
→ "TRUST_CONFLICT" 告警
→ 用户手动决定是否接受新密钥
→ 实质上是新身份，应作为新 Agent ID 处理
```

### TOFU 首次相遇 MITM 风险

攻击者若在首次相遇时控制网络，可替换 Manifest 或 mDNS 广播中的 Agent ID，导致对端钉扎到攻击者的公钥。

缓解措施（由强到弱）：

**L1：预信任（pinned trust）** — 用户通过带外渠道获取对方 Agent ID 后写入 `contacts.json`：
```json
{ "adp://8aB2cD4eF5gH6iJ7kL8mN9oP...@example.com/hermes": {
    "routes": [...], "trust": "pinned", "public_key": "..." } }
```
Gateway 直接使用预埋公钥验签，完全绕过 TOFU。适用于高安全场景。

**L2：多通道交叉验证** — Agent 自动从 mDNS + Registry + 静态配置等所有可用通道获取 Agent ID 并交叉比对。所有通道必须返回完全相同的 Agent ID（`01-identity.md` 定义具体流程）。攻击者需同时控制所有通道才能成功——对局域网 + 公网混合场景不现实。

**L3：visual_code 人工比对** — 仅单通道可用时，用户通过带外渠道比对 8 字符 visual_code（`3QJm-V3qT`）。碰撞概率 2^48，即时攻击不现实。

**L4：SSH 风格告警** — 公钥变化时大幅告警，拒绝自动更新。通信断开前需用户确认。

这与 SSH `known_hosts` 和 Signal safety number 的信任模型一致——是去中心化场景下的合理折衷。

---

## Registry 认证

**身份验证（内建）**：Registry **应当**用请求中 `agent_id` 的公钥验签写请求（POST/PUT/DELETE），确认请求来自私钥持有者。Agent 方对请求体签名后附于 HTTP 头 `X-ADP-Signature`。Registry 从 `agent_id` 的 user 段提取公钥验签——无需额外查询。这消除了 Manifest 缓存验证断层：Registry 存储的 Manifest 有密码学保证来自真实 Agent。API 细节见 [`03-discovery.md`](03-discovery.md#请求签名验证)。

**访问控制（可选）**：Registry 可校验请求中的 `token` 字段（预共享密钥、JWT 等），控制谁可以使用 Registry 服务。token 的分发与轮换由部署者自行管理。

---

## 后续版本展望

| 功能 | 状态 |
|------|------|
| Ed25519 消息签名（强制） | v0.2 ✅ |
| Agent ID 即公钥 | v0.2 ✅ |
| 公钥自认证身份 | v0.2 ✅ |
| TOFU trust store | v0.2 ✅ |
| 端到端加密 | 后续版本 |
| DID 集成 | 后续版本 |
| 证书/PKI | 后续版本 |
| 门限签名（多签 Agent） | 后续版本 |
