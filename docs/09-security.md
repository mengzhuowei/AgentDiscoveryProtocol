# ADP 安全模型

**更新：** 2026-05-15
**状态：** 草案（v0.1）

---

## 概述

本文档定义 ADP 协议的安全考量和设计。当前版本（v0.1）为"渐进信任"模型——初期信任基于白名单和消息签名，后期可扩展为证书/PKI/DID 体系。

---

## 威胁模型

### 假设的攻击者能力

| 级别 | 能力 | 应对措施 |
|---|---|---|
| L1 | 窃听 ADP 消息 | 传输层加密（TLS/WSS） |
| L2 | 伪造 Agent ID | 消息签名 + 白名单 |
| L3 | 重放消息 | Envelope 含 message_id + timestamp + TTL |
| L4 | Sybil 攻击（注册大量虚假 Agent） | Registry 认证 + 速率限制 |
| L5 | Registry 沦陷 | 多 Registry 互备 / P2P 状态传播（未来） |

### 不在当前范围内的威胁

- Agent 内部安全（由 Agent 实现者负责）
- Registry 的 DDoS 防护（由部署者负责）
- 应用层的恶意行为（如 Agent 发送恶意任务）

---

## 传输层安全

### 通信加密

| 链路 | 要求 |
|---|---|
| Agent → Registry | 推荐 HTTPS，初期允许 HTTP |
| Agent → Agent（直连） | 推荐 WSS，初期允许 WS |
| Agent → Relay | 必须 WSS |
| Gateway → Gateway（跨公网） | 必须 WSS/TLS |

### 实现建议

Gateway 应支持配置 TLS 证书：

```json
{
  "tls": {
    "enabled": true,
    "cert_path": "/etc/adp/cert.pem",
    "key_path": "/etc/adp/key.pem"
  }
}
```

---

## 身份与认证

### Agent ID 的真实性

ADP 不强制验证 Agent ID 的真实身份——`adp://alice@example.com/hermes` 只表示"声称来自 alice 的 Agent"，不保证"真的是 alice"。

**信任建立的四种方式（由接入方决定）：**

| 方式 | 说明 | 适用场景 |
|---|---|---|
| **白名单** | A 手动添加 B 的 Agent ID 到信任列表 | 家庭/团队内网 |
| **签名验证** | 消息通过公私钥签名，与 Manifest 中的公钥匹配 | 半开放网络 |
| **邀请制** | B 通过 A 的邀请链接注册，A 确认后加入白名单 | 介于开放与封闭之间 |
| **证书/PKI** | 第三方 CA 签发 Agent 身份证书 | 企业/开放网络（未来） |

### 消息签名（可选，但推荐）

完整的签名规范（算法、密钥格式、签名/验签流程、密钥轮换）见 [15-message-signing.md](15-message-signing.md)。

签名流程概述：

```
1. 发送方对 Envelope（不含 signature 字段）做 JCS canonical JSON 序列化
2. 用 Ed25519 私钥签名：signature_value = Ed25519_sign(privateKey, canonical_bytes)
3. 将签名放入 Envelope.signature 对象（含 algorithm / value / signed_at）
4. 接收方从 Manifest.public_key 获取公钥，验签并校验时间窗口
```

---

## Registry 安全

### 认证

Registry 可配置接入 token。Agent 注册/刷新/注销时可通过以下两种方式之一携带：

- **HTTP Header（推荐）：** `Authorization: Bearer <registry_token>`
- **请求体字段（备选）：** 在请求 JSON 中附带 `"token": "<registry_token>"`

如果两种方式同时存在，以 HTTP Header 为准。

### 速率限制

建议 Registry 实现以下限制（超限时返回 HTTP `429 Too Many Requests`，响应体可附带 `{ "error": { "code": "RATE_LIMITED", "message": "..." } }`）：

| 端点 | 限制 |
|---|---|
| `POST /register` | 每分钟每 IP 最多 10 次 |
| `POST /refresh` | 每分钟每 Agent ID 最多 60 次 |
| `GET /resolve` | 每分钟每 IP 最多 1000 次 |
| `GET /search` | 每分钟每 IP 最多 100 次 |

### 隐私控制

Agent 可通过 Manifest 字段控制可见性：

```json
{
  "agent_info": {
    "public": false
  }
}
```

- `public: true` — 出现在搜索结果中
- `public: false` — 仅可通过精确的 Agent ID 解析找到

---

## 消息层安全

### Envelope 防篡改

```json
{
  "adp_version": "0.1",
  "message_id": "msg_2x4k9m7q",
  "from": "adp://alice@example.com/hermes",
  "to": "adp://bob@home.io/claude",
  "type": "request",
  "timestamp": "2026-05-15T17:30:00Z",
  "ttl": 300,
  "body": { "action": "adp:ping", "params": {} },
  "signature": {
    "algorithm": "Ed25519",
    "value": "base64...",
    "signed_at": "2026-05-15T17:30:00Z"
  }
}
```

- `message_id`：全局唯一，接收方可缓存用于去重
- `timestamp` + `ttl`：防止重放攻击，超时消息直接丢弃
- `signature`：可选对象（非字符串），含 algorithm / value / signed_at，防止中间人篡改

### 敏感信息保护

- 消息体中不应包含明文密码、API Key 等敏感信息
- 大文件应通过引用传递（如 IPFS hash、临时下载链接），而非内联
- 端到端加密（E2EE）将在后续版本中定义

---

## 中继节点（Relay）安全

Relay 的完整协议规范见 [14-relay-protocol.md](14-relay-protocol.md)。

Relay 是中继节点，理论上可以读取所有经过的消息。

### 对 Relay 的信任分级

| 级别 | 说明 |
|---|---|
| **不可信 Relay** | Relay 只做字节转发，不存不读。Agent 自做端到端加密 |
| **半可信 Relay** | Relay 可查看消息元数据（from/to），不读消息体 |
| **可信 Relay** | Relay 可查看完整消息（适用于内网或自建 Relay） |

初期默认 Relay 为半可信级别。

---

## 安全相关环境变量

| 变量 | 用途 |
|---|---|
| `ADP_TLS_ENABLED` | 启用 TLS |
| `ADP_TLS_CERT_PATH` | 证书路径 |
| `ADP_TLS_KEY_PATH` | 私钥路径 |
| `ADP_REGISTRY_TOKEN` | Registry 接入 token |
| `ADP_SIGNING_PRIVATE_KEY_PATH` | Agent 签名私钥路径 |
