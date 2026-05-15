# 01 - Agent ID 与标识

## 格式

Agent ID 使用 URI 格式：

```
adp://user@domain[/agent_name]
```

示例：

```
adp://alice@example.com/hermes
adp://bob@home.io/claude
adp://team@company.com/ops-bot
```

### 各段说明

| 段 | 必填 | 说明 |
|---|---|---|
| `adp://` | 是 | 协议标识，所有 ADP 消息均以此开头 |
| `user` | 是 | 所有者标识。可以是用户名、邮箱前缀或 UUID |
| `@domain` | 是 | 所有者的域。可以是域名、邮箱域名或分布式标识 |
| `/agent_name` | 否 | Agent 名称。省略时指向该用户在 Registry 中标记为 `default: true` 的 Agent；如果未设置默认 Agent，则省略 agent_name 的 ID 无效 |

### 规则

- `user`：小写字母、数字、下划线、连字符，最长 64 字符
- `@domain`：符合域名字段标准，小写，最长 255 字符
- `/agent_name`：小写字母、数字、下划线、连字符，最长 32 字符，可选
- 整体长度不超过 512 字符

## 解析机制

Agent ID 不直接对应网络地址。解析流程如下：

1. Agent A 需要给 `adp://bob@home.io/claude` 发消息
2. A 的 Gateway 向 Registry 查询该 ID 的当前接入点
3. Registry 返回一个解析结果（见下文 AccessPoint 及 [04-registry.md](04-registry.md) 解析响应），其中核心部分是 AccessPoint 路由列表
4. Gateway 根据路由优先级选择最优路径

## AccessPoint

Registry 解析响应含两个层次：外层为 Agent 元信息（`adp_version`、`online`、`last_seen`、`manifest`），内层 `routes` 为 AccessPoint 路由列表。AccessPoint 核心结构：

```json
{
  "agent_id": "adp://bob@home.io/claude",
  "online": true,
  "last_seen": "2026-05-15T17:00:00Z",
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
      "address": "relay.adp.io:9800",
      "session": "sess_abc123",
      "priority": 30,
      "expires_at": "2026-05-15T18:00:00Z"
    }
  ]
}
```

- `routes` 按 `priority` 升序排列，Gateway 优先选值最小的可用路由
- 一个 Agent 可以有多个路由（内网直连 + 外网 Relay）
- 路由有时效，过期后 Gateway 必须重新解析
- `session` 是 Relay 分配的路由会话标识（字符串），仅在 `type: "relay"` 时出现，由 Relay 在 Gateway 认证后颁发

## 枚举 vs. 解析

- **枚举**：知道 `@domain`，想查找该域下有哪些公开 Agent → 需要 Registry 支持搜索
- **解析**：知道完整的 Agent ID，想获取其接入点 → 核心功能

## 本地别名（可选实现）

Agent 可维护本地别名表，方便记忆：

```json
{
  "nick": "bob",
  "target_id": "adp://bob@home.io/claude"
}
```

Agent 内部可用 `@bob` 代指，发送时 Gateway 展开为完整 ID。
