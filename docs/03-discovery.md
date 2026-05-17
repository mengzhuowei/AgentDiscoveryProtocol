# 03 — 发现机制

## 概述

ADP 不假定中心化基础设施。Agent 可通过以下三种方式互相发现，按场景自然选择：

| 方式 | 适用场景 | 依赖 |
|------|----------|------|
| **mDNS** | 同一局域网 | 零依赖 |
| **静态配置** | 已知 Agent 地址 | 本地文件 |
| **Registry** | 跨网络、动态发现 | Registry 服务 |

---

## 方式一：mDNS（局域网零配置）

### 广播

Agent 启动后通过 mDNS/DNS-SD 广播自身：

- **服务类型**：`_adp._tcp.local`
- **端口**：Gateway 的 WebSocket 监听端口（默认 9800）
- **TXT 记录**：

```
agent_id=adp://3QJmV3qT2ZxM7WdR9sFb5K8cJ5hG4mF6aY0dL3kX1yZ9aB@home.io/claude
protocol=adp/0.2
```

Agent ID 的 user 段即为 Base58 编码的公钥——发现方可直接在连接前提取公钥并与已知公钥比对。

### 发现

局域网内的其他 Agent 浏览 `_adp._tcp.local` 服务，获取 Agent ID 列表。对感兴趣的 Agent，通过 mDNS 解析到的 `host:port` 发起 WebSocket 连接，然后发送 `adp:capability.query` 获取完整 Manifest。

### 生命周期

- Agent 下线时发送 mDNS "goodbye" 包
- 未收到 goodbye 的记录在 120 秒后自然过期

---

## 方式二：静态配置

适合固定的 Agent 集合。配置文件 `~/.adp/contacts.json`：

```json
{
  "adp://3QJmV3qT2ZxM7WdR9sFb5K8cJ5hG4mF6aY0dL3kX1yZ9aB@home.io/claude": {
    "routes": [
      { "type": "direct", "address": "192.168.1.100:9800" }
    ]
  },
  "adp://8aB2cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV3wX4yZ5aB6cD@example.com/hermes": {
    "routes": [
      { "type": "relay", "relay": "relay.example.com:9800", "session_id": "sess_abc" },
      { "type": "direct", "address": "10.0.0.5:9800" }
    ]
  }
}
```

Gateway 优先使用静态配置中的路由，跳过发现步骤。静态配置以 Agent ID 为键。

**预信任（pinned trust）**：高安全场景可在静态配置中预埋信任，跳过 TOFU：

```json
{
  "adp://8aB2cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV3wX4yZ5aB6cD@example.com/hermes": {
    "routes": [
      { "type": "relay", "relay": "relay.example.com:9800", "session_id": "sess_abc" }
    ],
    "trust": "pinned",
    "public_key": "MCowBQYDK2VwAyEA..."
  }
}
```

`trust: "pinned"` 表示通信前已通过带外渠道确认 Agent ID = 公钥，Gateway 直接使用预埋的 `public_key` 验签，不获取 Manifest 也不走 TOFU。`public_key` 必须与 Agent ID user 段解码一致——协议层不做信任决策，只做密码学比对。

---

## 方式三：Registry（跨网络）

### 定位

Registry 是轻量目录服务——**只存 Agent ID 到路由的映射，不存消息、不转发数据**。Registry 可以是公开实例、自建实例或本地缓存。

**Registry 是不可信服务**——它不验证 Manfiest 签名，不参与信任决策。对端永远在本地用 Agent ID 中的公钥验签确认身份。Registry 被攻破最多造成 DoS 或返回过期数据，无法让对端接受伪造身份。

### 稳定 URL 标识（initial_id）

Agent ID 在密钥轮换时会变化（`adp://old_pubkey@...` → `adp://new_pubkey@...`）。如果 URL 直接使用当前 Agent ID，轮换后 URL 就变了——对端收藏的地址、搜索引擎索引全部失效。

解决方案：**首次注册时的 Agent ID 作为 `initial_id`，永久稳定。URL 始终使用 `initial_id`。后续轮换时，Registry 记录指向最新的 `current_agent_id`。**

```
首次注册：POST /v1/agents → initial_id = 首次 agent_id
后续操作：/v1/agents/{initial_id}  ← URL 永远不变
```

`initial_id` 的 user 段就是 Base58 公钥——首次注册后公钥刻在 URL 中。对端拿到 URL 就拿到了初始公钥，可沿 rotation_chain 逐跳验证到当前公钥。

Agent 应将 `initial_id` 持久化到本地配置。

### API

Registry 定义以下端点：

#### 首次注册

Agent 首次接入 Registry 时使用 `POST`：

```
POST /v1/agents
```

**请求体：**

```json
{
  "agent_id": "adp://3QJmV3qT2ZxM7WdR9sFb5K8cJ5hG4mF6aY0dL3kX1yZ9aB@home.io/claude",
  "manifest": { /* 完整 Manifest */ },
  "routes": [
    { "type": "direct", "address": "192.168.1.100:9800" },
    { "type": "relay", "relay": "relay-us-east.adp.io:9800", "session_id": "sess_abc123" }
  ],
  "token": "optional-auth-token"
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `agent_id` | 是 | 当前 Agent ID |
| `manifest` | 是 | 完整 Manifest |
| `routes` | 是 | 路由数组，至少一条 |
| `token` | 否 | Registry 认证 token |

**响应（201 Created）：**

```json
{
  "initial_id": "adp://3QJmV3qT2ZxM7WdR9sFb5K8cJ5hG4mF6aY0dL3kX1yZ9aB@home.io/claude",
  "status": "ok",
  "expires_at": "2026-05-16T18:00:00.000Z"
}
```

`initial_id` 等于首次注册时的 `agent_id`。Agent 须将其持久化到本地（`~/.adp/config.json` 的 `registry.initial_id`）。

#### 更新 / 刷新

更新路由、Manifest 或密钥轮换时，向 `initial_id` 的 URL 发送 `PUT`：

```
PUT /v1/agents/adp%3A%2F%2F3QJmV3qT...%40home.io%2Fclaude
```

**普通更新（无密钥轮换）：**

请求体与首次注册相同——`agent_id` 不变，仅更新 `manifest`（如能力、路由、心跳间隔）。

**密钥轮换更新：**

`agent_id` 变化时，必须附带 `rotation_sig`——旧私钥对新 Agent ID 的签名声明：

```json
{
  "agent_id": "adp://2xK3qR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZ9aB2cD4eF@home.io/claude",
  "manifest": { /* 新 Manifest，新 agent_id */ },
  "routes": [
    { "type": "direct", "address": "192.168.1.100:9800" }
  ],
  "rotation_sig": "<Ed25519_Sign(old_private_key, SHA256('adp:key.rotate:' + new_agent_id))>",
  "token": "optional-auth-token"
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `agent_id` | 是 | 新 Agent ID（仅密钥轮换时变化） |
| `manifest` | 是 | 新 Manifest（新 agent_id） |
| `routes` | 是 | 更新后的路由 |
| `rotation_sig` | 条件必填 | `agent_id` 变化时必填。旧私钥签名，内容为 `"adp:key.rotate:" + 新 agent_id` 的 SHA256 哈希 |
| `token` | 否 | Registry 认证 token |

**响应：**

```json
{
  "initial_id": "adp://3QJmV3qT2ZxM7WdR9sFb5K8cJ5hG4mF6aY0dL3kX1yZ9aB@home.io/claude",
  "current_agent_id": "adp://2xK3qR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZ9aB2cD4eF@home.io/claude",
  "status": "ok",
  "expires_at": "2026-05-17T18:00:00.000Z"
}
```

Agent 应在过期前刷新。重复 `POST` 到 `/v1/agents` 会创建新的 `initial_id`（产生重复记录），部署者应避免此操作。

#### 注销

```
DELETE /v1/agents/adp%3A%2F%2F3QJmV3qT...%40home.io%2Fclaude
```

**响应（200）：**

```json
{ "status": "ok" }
```

#### 请求签名验证

Registry **应当**验证写请求（POST/PUT/DELETE）来自 `agent_id` 的私钥持有者——从 `agent_id` 的 user 段提取公钥验签请求签名。详细机制见 [`05-security.md`](05-security.md#registry-认证)。

#### Manifest 一致性校验

收到注册 / 更新请求时，Registry **应当**验证 Manifest 内部一致性：

1. 验证 `manifest.agent_id` 与请求体中的 `agent_id` 完全一致
2. `agent_id` 的 user 段必须是合法 Base58 字符串（44 字符左右）
3. 不一致 → 返回 `400 INVALID_PARAMS`

Manifest 不包含公钥或签名字段——身份由 Agent ID 自保证。Registry 不验证 `rotation_sig`（这是接收方的职责）。Registry 仅确保不会存储内部不一致的垃圾数据。

#### 解析

```
GET /v1/agents/adp%3A%2F%2F3QJmV3qT...%40home.io%2Fclaude
```

**响应（Agent 在线）：**

```json
{
  "initial_id": "adp://3QJmV3qT2ZxM7WdR9sFb5K8cJ5hG4mF6aY0dL3kX1yZ9aB@home.io/claude",
  "current_agent_id": "adp://2xK3qR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZ9aB2cD4eF@home.io/claude",
  "online": true,
  "manifest": { /* 缓存的 Manifest */ },
  "routes": [
    { "type": "direct", "address": "192.168.1.100:9800" }
  ],
  "rotation_chain": [
    {
      "previous_agent_id": "adp://3QJmV3qT2ZxM7WdR9sFb5K8cJ5hG4mF6aY0dL3kX1yZ9aB@home.io/claude",
      "rotation_sig": "<old_private_key signs SHA256('adp:key.rotate:' + current_agent_id)>",
      "timestamp": "2026-05-17T10:00:00.000Z"
    }
  ],
  "last_seen": "2026-05-16T17:00:00.000Z"
}
```

| 字段 | 说明 |
|------|------|
| `initial_id` | 首次注册时的 Agent ID，URL 标识 |
| `current_agent_id` | 当前活跃的 Agent ID，可能等于 initial_id（无轮换）或不同（已轮换） |
| `rotation_chain` | 从 initial_id 到 current_agent_id 的轮换历史。无轮换时为空数组 `[]` |
| `rotation_chain[].previous_agent_id` | 上一跳的 Agent ID |
| `rotation_chain[].rotation_sig` | 上一跳私钥对当前跳 Agent ID 的签名 |

**接收方验证 rotation_chain：**

```
1. 提取 initial_id 的 user 段 → 初始公钥 pk₀
2. 遍历 rotation_chain：
   a. 用 pk₀ 验签 rotation_sig → 通过
   b. 提取 previous_agent_id 的 user 段 → 得到下一跳公钥 pk₁
   c. 继续用 pk₁ 验签下一跳 → ... → 直到链尾
3. 链尾公钥 == Base58Decode(current_agent_id.user) ✓
4. 任一失败 → 拒绝，走纯 TOFU 或告警
```

rotation_sig 的签名消息格式：`"adp:key.rotate:" + 下一跳 agent_id`（先 SHA256 哈希再签名，避免签名原始可变长度字符串）。

**响应（Agent 未注册或已过期）：**

```json
{
  "initial_id": "adp://3QJmV3qT2ZxM7WdR9sFb5K8cJ5hG4mF6aY0dL3kX1yZ9aB@home.io/claude",
  "online": false,
  "error": {
    "code": "AGENT_NOT_FOUND",
    "message": "未注册或注册已过期"
  }
}
```

`online` 为 `true` 当且仅当注册未过期。

### HTTP 约定

| 场景 | HTTP 状态码 |
|------|-------------|
| 成功 | `200` |
| 创建成功 | `201` |
| 参数校验失败 (`INVALID_PARAMS`) | `400` |
| Agent 未找到 (`AGENT_NOT_FOUND`) | `404` |
| Token 无效 (`UNAUTHORIZED`) | `401` |
| 频率超限 (`RATE_LIMITED`) | `429` |
| 内部故障 (`INTERNAL_ERROR`) | `500` |

### 搜索

Registry 实现**应当**提供搜索端点：

```
GET /v1/agents?namespace=home.io&capability=custom%3Acode.review&cursor=&limit=20
```

**参数：**

| 参数 | 必填 | 说明 |
|------|------|------|
| `namespace` | 否 | 按 namespace 过滤 |
| `capability` | 否 | 按能力过滤（需 percent-encoding） |
| `cursor` | 否 | 分页游标，首次请求为空 |
| `limit` | 否 | 每页条数，默认 20，最大 100 |

**响应：**

```json
{
  "agents": [
    {
      "initial_id": "adp://3QJmV3qT2ZxM7WdR9sFb5K8cJ5hG4mF6aY0dL3kX1yZ9aB@home.io/claude",
      "current_agent_id": "adp://2xK3qR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZ9aB2cD4eF@home.io/claude",
      "manifest": { /* 缓存的 Manifest */ },
      "routes": [
        { "type": "direct", "address": "192.168.1.100:9800" }
      ],
      "rotation_chain": [],
      "last_seen": "2026-05-16T17:00:00.000Z"
    }
  ],
  "next_cursor": "eyJvZmZzZXQiOjIwfQ"
}
```

- `next_cursor` 为 `null` 表示最后一页
- 游标格式由 Registry 实现自行定义（推荐 Base64 编码的内部偏移量）
- 搜索结果按 `last_seen` 倒序排列

### Registry 连接配置

Gateway 需要以下 Registry 连接信息，按优先级：

1. 环境变量 `ADP_REGISTRY` — Registry URL
2. 环境变量 `ADP_REGISTRY_INITIAL_ID` — 已分配的 `initial_id`（可选）
3. 配置文件 `~/.adp/config.json`：

```json
{
  "registry": {
    "url": "https://registry.adp.io",
    "initial_id": "adp://3QJmV3qT2ZxM7WdR9sFb5K8cJ5hG4mF6aY0dL3kX1yZ9aB@home.io/claude"
  }
}
```

`initial_id` 在首次 `POST /v1/agents` 成功后写入。Gateway 启动时若存在 `initial_id`，直接使用 `PUT` 刷新；若不存在，使用 `POST` 首次注册。

### 本地缓存

无网络 Registry 时，Gateway 可用本地静态文件替代。格式与 `contacts.json` 相同，以 Agent ID 为键，额外附加缓存的 `manifest`：

```json
{
  "adp://3QJmV3qT2ZxM7WdR9sFb5K8cJ5hG4mF6aY0dL3kX1yZ9aB@home.io/claude": {
    "routes": [
      { "type": "direct", "address": "192.168.1.100:9800" }
    ],
    "manifest": { /* ... */ }
  }
}
```
