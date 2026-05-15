# 04 - Registry：注册与发现

## 概述

Registry 是 ADP 协议中的目录服务，负责将 Agent ID 解析为当前可用的接入点（AccessPoint）。Registry **不存储、不转发消息**，仅做寻址。

Registry 可以是公开的中心化实例，也可以是自建的私有实例，甚至可以是本地的静态缓存。

## API 定义

### HTTP 状态码约定

除非特别说明，所有 Registry API 端点业务成功时返回 HTTP `200`，应用层错误（如 `AGENT_NOT_FOUND`、`REGISTRATION_EXPIRED`）也通过 HTTP `200` 响应体中的 `"status": "error"` 表达。仅在以下情况使用非 200 HTTP 状态码：

| HTTP 状态码 | 场景 |
|---|---|
| `401 Unauthorized` | 注册/刷新/注销时 token 无效或不匹配 |
| `429 Too Many Requests` | 触发速率限制 |
| `500 Internal Server Error` | Registry 内部故障 |

### 基础路径

所有 API 路径以 `/adp/v1` 为前缀。

```
https://registry.adp.io/adp/v1/...
```

### 注册（Register）

Agent 启动时向 Registry 注册，并定时刷新。

```
POST /adp/v1/register
```

**请求体：**

```json
{
  "agent_id": "adp://alice@example.com/hermes",
  "manifest": { /* 完整 Manifest 对象 */ },
  "default": false,
  "routes": [
    {
      "type": "direct",
      "address": "192.168.1.100:9800",
      "priority": 10,
      "ttl": 3600
    },
    {
      "type": "relay",
      "relay_id": "relay-us-east-1",
      "session": "sess_abc123",
      "priority": 30,
      "ttl": 3600
    }
  ],
  "token": "optional-auth-token"
}
```

**响应：**

```json
{
  "status": "ok",
  "registered_at": "2026-05-15T17:00:00Z",
  "expires_at": "2026-05-15T18:00:00Z",
  "refresh_interval": 1800
}
```

- `expires_at`：注册过期时间，过期后 Registry 视为 Agent 离线
- `online`：`true` 当且仅当注册未过期（`expires_at > now`）。这表示 Agent 在注册窗口内，不保证实时在线
- `default`：是否标记为该用户/域的默认 Agent。当发往 `adp://user@domain`（省略 agent_name）时，Registry 解析到此 Agent。每个 user@domain 最多一个 Agent 标记为 default
- `refresh_interval`：建议的刷新间隔（秒），在此间隔内重发 `POST /register` 续期
- 路由中的 `ttl`（秒）由 Registry 转换为 `expires_at`（ISO 8601 时间戳）后存入，解析时返回 `expires_at`
- `routes` 优先于 `manifest.endpoints`：如果两者冲突（如地址不同），以 `routes` 为准。`manifest.endpoints` 是发布时的静态声明，`routes` 是运行时的实时路由

### 重复注册

当 Agent 使用已注册（且未过期）的 Agent ID 再次调用 `POST /register` 时：

- Registry 接受新注册，覆盖旧的路由和 Manifest，重置过期时间（last-write-wins）
- 如果请求携带的 `token` 与上次注册不同，Registry 应拒绝（HTTP `401`），响应体为 `{"status": "error", "error": {"code": "UNAUTHORIZED", "message": "Token mismatch"}}`，旧注册保持不变
- 响应中附带 `"previous_registration": "overwritten"` 提示旧注册已被覆盖。首次注册时此字段为 `null`

### 请求校验

Registry 应对注册/刷新/注销请求做基本校验：

| 校验项 | 失败时错误码 |
|---|---|
| `agent_id` 格式不合法 | `INVALID_PARAMS` |
| `manifest` 缺少必填字段（`adp_version`、`agent_id`、`display_name`、`capabilities`） | `INVALID_PARAMS` |
| `routes` 为空数组 | `INVALID_PARAMS` |
| `token` 无效或不匹配 | `UNAUTHORIZED` |

**首次注册响应示例：**

```json
{
  "status": "ok",
  "registered_at": "2026-05-15T17:00:00Z",
  "expires_at": "2026-05-15T18:00:00Z",
  "refresh_interval": 1800,
  "previous_registration": null
}
```

**重复注册（覆盖）响应示例：**

```json
{
  "status": "ok",
  "registered_at": "2026-05-15T17:05:00Z",
  "expires_at": "2026-05-15T18:05:00Z",
  "refresh_interval": 1800,
  "previous_registration": "overwritten"
}
```

### 注册过期与清理

- 注册在 `expires_at` 后自动失效。Registry 应定期清理过期注册（建议每 60 秒扫描一次）
- `POST /adp/v1/refresh` 用于续期：如果注册已过期，返回 `{"status": "error", "error": {"code": "REGISTRATION_EXPIRED", "message": "Registration expired, please re-register"}}`；如果 Agent ID 从未注册过，返回 `AGENT_NOT_FOUND`
- `POST /adp/v1/unregister` 对不存在的 Agent ID 返回静默成功（`{"status": "ok"}`），因为期望状态已达到

### 刷新（Refresh）

续期注册，不改变已有路由信息。

```
POST /adp/v1/refresh
```

**请求体：**

```json
{
  "agent_id": "adp://alice@example.com/hermes",
  "token": "optional-auth-token"
}
```

### 注销（Unregister）

Agent 下线时主动注销。

```
POST /adp/v1/unregister
```

**请求体：**

```json
{
  "agent_id": "adp://alice@example.com/hermes",
  "token": "optional-auth-token"
}
```

### 解析（Resolve）

根据 Agent ID 获取当前接入点。

```
GET /adp/v1/resolve?agent_id=adp://bob@home.io/claude
```

**成功响应：**

```json
{
  "agent_id": "adp://bob@home.io/claude",
  "adp_version": "0.1",
  "online": true,
  "last_seen": "2026-05-15T17:00:00Z",
  "manifest": { /* 缓存的 Manifest */ },
  "routes": [
    {
      "type": "direct",
      "address": "192.168.1.100:9800",
      "priority": 10,
      "expires_at": "2026-05-15T18:00:00Z"
    },
    {
      "type": "relay",
      "relay_id": "relay-us-east-1",
      "session": "sess_abc123",
      "priority": 30,
      "expires_at": "2026-05-15T18:00:00Z"
    }
  ]
}
```

**Agent 未注册或已过期时的响应：**

```json
{
  "agent_id": "adp://unknown@domain/agent",
  "online": false,
  "error": {
    "code": "AGENT_NOT_FOUND",
    "message": "Agent has never been registered or registration has expired"
  }
}
```

### 搜索（Search）

按域或能力搜索 Agent。Registry 可选择性实现。

```
GET /adp/v1/search?domain=home.io
GET /adp/v1/search?capability=custom:code.review
GET /adp/v1/search?q=hermes
GET /adp/v1/search?domain=home.io&page=1&limit=20
```

| 参数 | 说明 |
|---|---|
| `domain` | 按域名筛选 |
| `capability` | 按能力筛选 |
| `q` | 自由文本搜索 |
| `page` | 分页页码，默认 `1` |
| `limit` | 每页条数，默认 `20`，最大 `100` |

**响应：**

```json
{
  "results": [
    {
      "agent_id": "adp://bob@home.io/claude",
      "display_name": "Claude",
      "capabilities": ["adp:ping", "custom:code.review"],
      "online": true
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20
}
```

### Relay 列表

查询 Registry 知道的可用 Relay 节点。

```
GET /adp/v1/relays
```

**响应：**

```json
{
  "relays": [
    {
      "id": "relay-us-east-1",
      "address": "relay-us-east.adp.io:9800",
      "region": "us-east",
      "load": 0.45,
      "requires_auth": true
    }
  ]
}
```

Registry 可选择性实现此端点。Relay 自身也可以向 Registry 注册，Registry 通过此端点公布已知 Relay。

### 健康检查

```
GET /health
```

**响应：** HTTP 200，可附带可选的 `{ "status": "ok" }` 负载。

---

## Registry 发现

Gateway 需要知道 Registry 的地址才能注册和查询。发现方式：

1. **硬编码默认 Registry**：`registry.adp.io`
2. **环境变量**：`ADP_REGISTRY=https://my-registry.example.com`
3. **本地配置**：`~/.adp/config.json` 中指定
4. **DNS 记录**：查询 `_adp._tcp.example.com` 的 SRV 记录

## 隐私考虑

- Registry 默认只公开 Agent ID、Manifest 和在线状态
- 路由信息（IP、端口）应仅对已授权的查询者可见
- Agent 可将 `agent_info.public` 设为 `false` 以禁止在搜索结果中暴露
- Registry 实现可要求注册时提供认证 token

## 可选实现：本地缓存 Registry

不需要网络 Registry 时，Gateway 可使用本地静态文件作为"通讯录"：

```json
{
  "adp://bob@home.io/claude": {
    "routes": [
      { "type": "direct", "address": "192.168.1.100:9800", "priority": 10 }
    ],
    "manifest": { /* ... */ }
  }
}
```

适合家庭内网场景，Agent 之间直接通过局域网 IP 通信。
