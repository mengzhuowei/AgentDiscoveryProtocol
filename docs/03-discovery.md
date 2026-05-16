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
agent_id=adp://3QJmV3qT2ZxM7WdR9sFb5K@home.io/claude
protocol=adp/0.2
proof_of_id=3QJmV3qT2ZxM7WdR9sFb5K
```

`proof_of_id` 字段（v0.2 新增）允许发现方在连接前做快速 TOFU 检查——比对已知的 proof_of_id 是否一致。

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
  "adp://3QJmV3qT2ZxM7WdR9sFb5K@home.io/claude": {
    "routes": [
      { "type": "direct", "address": "192.168.1.100:9800" }
    ]
  },
  "adp://8aB2cD4eF5gH6iJ7kL8mN9oP@example.com/hermes": {
    "routes": [
      { "type": "relay", "relay": "relay.example.com:9800", "session_id": "sess_abc" }
    ]
  }
}
```

Gateway 优先使用静态配置中的路由，跳过发现步骤。

> **命名说明**：静态配置使用 `routes`（复数）以支持同一 Agent 的多条备用路由；Registry 使用 `access_point`（单数）因为一次只跟踪 Agent 当前的唯一活跃接入点。两者语义等价，差异源于使用场景。
>
> **配置文件说明**：`contacts.json` 存 Agent ID → 路由映射（"我知道谁、怎么连"），`config.json` 存全局设置如 `registry.url` 和 `relay.urls`（"基础设施地址"）。两者独立，部署者可按需只创建其一。本地缓存文件（见下文）是 `contacts.json` 的超集，额外附带 `manifest`。

---

## 方式三：Registry（跨网络）

### 定位

Registry 是轻量目录服务——**只存 Agent ID 到接入点的映射，不存消息、不转发数据**。Registry 可以是公开实例、自建实例或本地缓存。

### API

Registry 只定义两个核心端点：

#### 注册 / 刷新

Agent ID 在 URL 路径中需做 percent-encoding（RFC 3986，等价于 JavaScript `encodeURIComponent`）：

```
PUT /v1/agents/adp%3A%2F%2F3QJmV3qT2ZxM7WdR9sFb5K%40home.io%2Fclaude
```

> 下文示例为可读性使用原始 Agent ID，实际请求中必须编码。

**请求体：**

```json
{
  "manifest": { /* 完整 Manifest */ },
  "access_point": {
    "type": "direct",
    "address": "192.168.1.100:9800"
  },
  "token": "optional-auth-token"
}
```

`access_point` 也可以是 relay 类型：

```json
{
  "type": "relay",
  "relay": "relay-us-east.adp.io:9800",
  "session_id": "sess_abc123"
}
```

**响应：**

```json
{
  "status": "ok",
  "expires_at": "2026-05-16T18:00:00Z"
}
```

PUT 语义为 upsert——已存在的记录被覆盖，不存在的记录被创建。Agent 应在过期前刷新。

#### Registry Manifest 一致性校验（v0.2）

收到注册请求时，Registry **应当**验证 Manifest 内部一致性：

1. 提取 `manifest.public_key` 和 `manifest.proof_of_id`
2. 验证 `proof_of_id == Base58(BLAKE2b(Base64Decode(public_key), 20))`
3. 不一致 → 返回 `400 INVALID_PARAMS`

Registry **不验证** Manifest 的 `signature` 字段——这是接收方的职责。Registry 仅确保不会存储内部不一致的垃圾数据。

#### 解析

```
GET /v1/agents/adp%3A%2F%2F3QJmV3qT2ZxM7WdR9sFb5K%40home.io%2Fclaude
```

**响应：**

```json
{
  "agent_id": "adp://3QJmV3qT2ZxM7WdR9sFb5K@home.io/claude",
  "online": true,
  "manifest": { /* 缓存的 Manifest */ },
  "access_point": {
    "type": "direct",
    "address": "192.168.1.100:9800"
  },
  "last_seen": "2026-05-16T17:00:00Z"
}
```

`online` 为 `true` 当且仅当注册未过期。Agent 未注册或已过期：

```json
{
  "agent_id": "adp://unknown@domain/agent",
  "online": false,
  "error": {
    "code": "AGENT_NOT_FOUND",
    "message": "未注册或注册已过期"
  }
}
```

### HTTP 约定

| 场景 | HTTP 状态码 |
|------|-------------|
| 成功 | `200` |
| 参数校验失败 (`INVALID_PARAMS`) | `400` |
| Agent 未找到 (`AGENT_NOT_FOUND`) | `404` |
| Token 无效 (`UNAUTHORIZED`) | `401` |
| 频率超限 (`RATE_LIMITED`) | `429` |
| 内部故障 (`INTERNAL_ERROR`) | `500` |

### 可选扩展

Registry 实现可选择性提供：

```
GET /v1/agents?domain=home.io&capability=custom%3Acode.review
```

搜索端点的参数和响应格式由实现自行定义，不做协议级规范。

### Registry 发现

Gateway 需要知道 Registry 地址，按优先级：

1. 环境变量 `ADP_REGISTRY`
2. 配置文件 `~/.adp/config.json` 中的 `registry.url`
3. 无默认值——Registry 地址必须由部署者显式配置

### 本地缓存

无网络 Registry 时，Gateway 可用本地静态文件替代——格式与静态配置的 `contacts.json` 相同，额外附加缓存的 `manifest`：

```json
{
  "adp://3QJmV3qT2ZxM7WdR9sFb5K@home.io/claude": {
    "routes": [
      { "type": "direct", "address": "192.168.1.100:9800" }
    ],
    "manifest": { /* ... */ }
  }
}
```
