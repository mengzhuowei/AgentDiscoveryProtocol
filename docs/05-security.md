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
| L3 | 重放消息 | 消息 ID 去重（5 分钟缓存）+ timestamp 新鲜度校验（300 秒窗口）+ 签名绑定 id/timestamp |
| L4 | 大量虚假注册 | Registry token + 速率限制 |
| L5 | 首次相遇 MITM | 多通道交叉验证 Agent ID + visual_code 人工比对 + pinned trust 预信任 |
| L6 | Registry 返回虚假记录 | **终端验签**——rotation_chain 逐跳验证 + 消息 sig 验签。Registry 无法让终端接受伪造身份 |

### Registry 的安全定位

Registry 是**不可信服务**——协议明确不依赖 Registry 做任何信任决策：

| Registry 能做到的 | Registry 做不到的 |
|---------------------|---------------------|
| 返回过期数据 → 终端发现 Agent 不在线 | 伪造 Manifest → 携带此 Manifest 的消息 sig 验签失败，直接拒绝 |
| 不返回数据 → DoS | 伪造 rotation envelope → 旧公钥验签失败，直接拒绝 |
| 返回空的 rotation_chain → 终端走纯 TOFU | 伪造 rotation envelope → 旧公钥验签失败，拒绝整条链 |
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

Agent ID 的 user 段为 Base64URL 编码的 Ed25519 公钥——任何人拿到 Agent ID 即可提取公钥验签，无需 CA、PKI 或外部查询。详见 [`06-signatures.md`](06-signatures.md)。

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

1. 获取对方 Agent ID → Base64URLDecode user 段 → 公钥
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

**L4：公钥变化告警** — 公钥变化时大幅告警，拒绝自动更新。通信断开前需用户确认。

ADP 的 TOFU 与 SSH 有关键差异：SSH 将信任绑定到 `hostname + IP`，攻击者须持续占据该网络位置才能 MITM。ADP 的 Agent ID 是网络无关的密码学身份——攻击者只需在受害者首次发现的任何网络中在场即可发动 MITM。正因如此，ADP 提供多通道交叉验证和 pinned trust 作为分层加固，高于标准 TOFU 的基线安全。

---

## Registry 认证

**身份验证（内建）**：Registry **应当**用请求中 `agent_id` 的公钥验签写请求（POST/PUT/DELETE），确认请求来自私钥持有者。Agent 方对请求体签名后附于 HTTP 头 `X-ADP-Signature`。Registry 从 `agent_id` 的 user 段提取公钥验签——无需额外查询。这消除了 Manifest 缓存验证断层：Registry 存储的 Manifest 有密码学保证来自真实 Agent。API 细节见 [`03-discovery.md`](03-discovery.md#请求签名验证)。

**访问控制（可选）**：Registry 可校验请求中的 `token` 字段（预共享密钥、JWT 等），控制谁可以使用 Registry 服务。token 的分发与轮换由部署者自行管理。

### Registry HTTP 请求签名

Registry 写请求使用 Ed25519 签名进行身份验证，与 Agent 间消息签名原理一致，但覆盖不同的数据结构。

#### 签名覆盖内容

签名覆盖以下字段的规范化 JSON：

```json
{
  "method": "POST",
  "path": "/v1/agents",
  "timestamp": "2026-05-20T10:00:00.000Z",
  "body": { /* 请求体，仅 POST/PUT 有 */ }
}
```

| 字段 | 说明 |
|------|------|
| `method` | HTTP 方法：`POST`、`PUT`、`DELETE` |
| `path` | URL 路径，不含查询参数 |
| `timestamp` | ISO 8601 UTC 毫秒时间戳，用于重放防护 |
| `body` | 仅 POST/PUT 有，DELETE 无此字段 |

#### HTTP 头

| 头 | 说明 |
|----|------|
| `X-ADP-Signature` | Ed25519 签名（Base64URL，无填充），64 字节 |
| `X-ADP-Timestamp` | 签名时的时间戳（ISO 8601） |
| `X-ADP-Agent-Id` | 当前 Agent ID（可选，Registry 可从 path 提取） |

#### 签名过程（Agent 方）

```
1. 提取 HTTP 方法、path、body（空对象 {} 用于无 body 的请求）
2. 获取当前时间戳
3. 构建签名覆盖对象
4. ADP Canonical JSON 规范化
5. Ed25519 签名
6. Base64URL 编码签名
7. 发送请求
```

#### 验证过程（Registry 方）

```
1. 提取 X-ADP-Signature 和 X-ADP-Timestamp
2. 检查时间戳偏差 ≤ 300 秒
3. 从请求 path 中的 agent_id 提取公钥（URL 编码需解码）
4. 构建签名覆盖对象（method、path、timestamp、body）
5. ADP Canonical JSON 规范化
6. Ed25519 验签
7. 通过 → 处理请求；失败 → 401 Unauthorized
```

#### 示例：POST 注册签名

**请求：**
```
POST /v1/agents
Content-Type: application/json
X-ADP-Signature: dGhpcyBpcyBhIHNhbXBsZSBzaWduYXR1cmUgZm9yIHJlZ2lzdHJ5IHJlcXVlc3Q...
X-ADP-Timestamp: 2026-05-20T10:00:00.000Z
```

**签名覆盖对象：**
```json
{
  "method": "POST",
  "path": "/v1/agents",
  "timestamp": "2026-05-20T10:00:00.000Z",
  "body": {
    "agent_id": "adp://mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB@home.io/claude",
    "manifest": { /* ... */ },
    "routes": [ /* ... */ ]
  }
}
```

#### 示例：DELETE 注销签名

**请求：**
```
DELETE /v1/agents/adp%3A%2F%2FmLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB%40home.io%2Fclaude
X-ADP-Signature: YW5vdGhlciBzYW1wbGUgc2lnbmF0dXJlIGZvciBkZWxldGUgcmVxdWVzdC4uLg...
X-ADP-Timestamp: 2026-05-20T10:00:00.000Z
```

**签名覆盖对象（DELETE 无 body）：**
```json
{
  "method": "DELETE",
  "path": "/v1/agents/adp%3A%2F%2FmLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB%40home.io%2Fclaude",
  "timestamp": "2026-05-20T10:00:00.000Z"
}
```

#### 安全考虑

- **时间戳重放防护**：签名包含时间戳，Registry 应拒绝时间戳偏差超过 300 秒的请求
- **Path 一致性**：签名覆盖完整 path，攻击者无法篡改 URL 路径将请求导向其他资源
- **Body 完整性**：签名覆盖请求体，Registry 可检测请求体篡改
- **Agent ID 不可伪造**：公钥从 Agent ID 的 user 段直接提取，攻击者无法伪造签名

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
