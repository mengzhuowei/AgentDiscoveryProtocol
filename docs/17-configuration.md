# 17 - Gateway 统一配置规范

**更新：** 2026-05-15
**状态：** 草案（v0.1）

---

## 概述

本文档定义 Gateway 的完整配置 schema，统一各处散落的配置项。Gateway 实现者应以此文档为准。

---

## 配置文件位置

| 操作系统 | 路径 |
|---|---|
| Linux | `~/.adp/config.json` |
| macOS | `~/.adp/config.json` |
| Windows | `%APPDATA%\adp\config.json` |

Gateway 启动时按以下顺序查找配置（先找到的优先）：

1. 命令行参数指定的路径（`--config /path/to/config.json`）
2. 环境变量 `ADP_CONFIG` 指定的路径
3. 上述默认路径
4. 当前工作目录下的 `adp.config.json`

---

## 配置优先级（从高到低）

```
命令行参数 > 环境变量 > 配置文件 > 内置默认值
```

环境变量覆盖配置文件中对应的字段，规则为：`ADP_` + 嵌套路径的大写下划线形式。

例如：
- `ADP_REGISTRY_URL` 覆盖 `registry.url`
- `ADP_TLS_ENABLED` 覆盖 `tls.enabled`
- `ADP_RELAY_TOKEN` 覆盖 `relay.token`

---

## 完整配置 Schema

```json
{
  "agent": {
    "id": "adp://alice@example.com/hermes",
    "display_name": "Hermes",
    "description": "我的个人智能助手",
    "version": "1.2.0",
    "vendor": "nous-research",
    "runtime": "hermes-1.0",
    "platform": "nas",
    "public": false,
    "task_recovery": "timeout"
  },

  "gateway": {
    "listen": {
      "host": "127.0.0.1",
      "port": 9700,
      "socket": null
    },
    "external": {
      "host": "0.0.0.0",
      "port": 9800
    }
  },

  "registry": {
    "url": "https://registry.adp.io",
    "token": null,
    "refresh_interval": 1800,
    "retry_interval": 60
  },

  "relay": {
    "urls": [
      "wss://relay-us-east.adp.io:9800",
      "wss://relay-us-west.adp.io:9800"
    ],
    "token": null,
    "auto_connect": true,
    "preferred": "relay-us-east-1"
  },

  "tls": {
    "enabled": false,
    "cert_path": null,
    "key_path": null,
    "ca_path": null
  },

  "signing": {
    "enabled": false,
    "private_key_path": "~/.adp/keys/ed25519.pem",
    "algorithm": "Ed25519"
  },

  "transport": {
    "heartbeat_interval": 30,
    "heartbeat_timeout": 90,
    "relay_heartbeat_interval": 15,
    "relay_heartbeat_timeout": 45,
    "reconnect_base_delay": 1,
    "reconnect_max_delay": 60,
    "max_message_size": 1048576,
    "default_ttl": 300,
    "response_timeout": 60
  },

  "offline": {
    "cache_enabled": true,
    "max_cache_duration": 3600,
    "max_cache_messages": 500
  },

  "routing": {
    "strategy": "priority",
    "prefer_direct": true,
    "local_agents": {}
  },

  "logging": {
    "level": "info",
    "format": "json",
    "output": "stderr",
    "file_path": null
  }
}
```

---

## 字段说明

### agent

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `id` | string | (必填) | 完整 Agent ID |
| `display_name` | string | (必填) | 可读名称 |
| `description` | string | `""` | 一段简短描述 |
| `version` | string | `"0.0.0"` | Agent 自身版本号 |
| `vendor` | string | `""` | 实现厂商 |
| `runtime` | string | `""` | 运行时标识 |
| `platform` | string | `""` | 部署平台：`nas` / `pc` / `server` / `edge` / `mobile` |
| `public` | boolean | `false` | 是否在搜索中公开 |
| `task_recovery` | string | `"timeout"` | 宕机后任务恢复策略：`"fail-fast"` / `"requeue"` / `"timeout"`。映射到 Manifest 的 `agent_info.task_recovery` |

### gateway

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `listen.host` | string | `"127.0.0.1"` | Agent ↔ Gateway 监听地址 |
| `listen.port` | number | `9700` | Agent ↔ Gateway 监听端口（0 = 自动分配） |
| `listen.socket` | string\|null | `null` | Unix Socket 路径，设置后忽略 host/port |
| `external.host` | string | `"0.0.0.0"` | 外部 Gateway 连接监听地址 |
| `external.port` | number | `9800` | 外部 Gateway 连接监听端口 |

### registry

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `url` | string | `"https://registry.adp.io"` | Registry 服务地址 |
| `token` | string\|null | `null` | Registry 认证 token |
| `refresh_interval` | number | `1800` | Agent 刷新间隔（秒） |
| `retry_interval` | number | `60` | 注册失败后重试间隔（秒） |

### relay

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `urls` | string[] | `[]` | Relay 节点地址列表 |
| `token` | string\|null | `null` | Relay 认证 token |
| `auto_connect` | boolean | `true` | 是否自动连接 Relay |
| `preferred` | string\|null | `null` | 首选 Relay 节点 ID |

### tls

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `enabled` | boolean | `false` | 是否启用 TLS |
| `cert_path` | string\|null | `null` | TLS 证书路径 |
| `key_path` | string\|null | `null` | TLS 私钥路径 |
| `ca_path` | string\|null | `null` | CA 证书路径（用于双向 TLS） |

### signing

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `enabled` | boolean | `false` | 是否启用消息签名 |
| `private_key_path` | string | `"~/.adp/keys/ed25519.pem"` | 签名私钥路径 |
| `algorithm` | string | `"Ed25519"` | 签名算法：`Ed25519` / `ECDSA-P256` / `RSA-2048`（兼容） |

### transport

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `heartbeat_interval` | number | `30` | 心跳间隔（秒）。Gateway ↔ Gateway 直连和 Gateway ↔ Registry 使用此值 |
| `heartbeat_timeout` | number | `90` | 心跳超时（秒） |
| `relay_heartbeat_interval` | number | `15` | Gateway ↔ Relay 心跳间隔（秒）。Relay 连接需要更频繁的心跳 |
| `relay_heartbeat_timeout` | number | `45` | Gateway ↔ Relay 心跳超时（秒） |
| `reconnect_base_delay` | number | `1` | 重连基础延迟（秒） |
| `reconnect_max_delay` | number | `60` | 重连最大延迟（秒） |
| `max_message_size` | number | `1048576` | 消息最大字节数（1 MB） |
| `default_ttl` | number | `300` | 默认消息 TTL（秒） |
| `response_timeout` | number | `60` | 等待 response 的超时（秒），取此值与 Envelope TTL 剩余值的较小者 |

### offline

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `cache_enabled` | boolean | `true` | 是否缓存离线消息 |
| `max_cache_duration` | number | `3600` | 最大缓存时长（秒） |
| `max_cache_messages` | number | `500` | 每目标 Agent 最大缓存消息数 |

### routing

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `strategy` | string | `"priority"` | 路由策略：`priority`（按优先级）/ `random`（随机）/ `latency`（最低延迟） |
| `prefer_direct` | boolean | `true` | 是否优先直连 |
| `local_agents` | object | `{}` | 本地静态路由表（key=Agent ID, value=AccessPoint） |

### logging

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `level` | string | `"info"` | 日志级别：`debug` / `info` / `warn` / `error` |
| `format` | string | `"json"` | 日志格式：`json` / `text` |
| `output` | string | `"stderr"` | 输出目标：`stdout` / `stderr` / `file` |
| `file_path` | string\|null | `null` | `output=file` 时的日志文件路径 |

---

## 环境变量速查表

| 环境变量 | 对应配置字段 |
|---|---|
| `ADP_AGENT_ID` | `agent.id` |
| `ADP_REGISTRY_URL` | `registry.url` |
| `ADP_REGISTRY_TOKEN` | `registry.token` |
| `ADP_RELAY_URLS` | `relay.urls`（逗号分隔） |
| `ADP_RELAY_TOKEN` | `relay.token` |
| `ADP_TLS_ENABLED` | `tls.enabled` |
| `ADP_TLS_CERT_PATH` | `tls.cert_path` |
| `ADP_TLS_KEY_PATH` | `tls.key_path` |
| `ADP_SIGNING_ENABLED` | `signing.enabled` |
| `ADP_SIGNING_PRIVATE_KEY_PATH` | `signing.private_key_path` |
| `ADP_LOG_LEVEL` | `logging.level` |

> 配置文件中 `agent.public` 映射到 Manifest 的 `agent_info.public` 字段。这两个路径在不同上下文中表示同一个概念。

---

## 最小配置示例

```json
{
  "agent": {
    "id": "adp://demo@example.com/bot",
    "display_name": "Demo Bot"
  }
}
```

其余所有字段使用默认值。

---

## 配置热加载

Gateway 应监听配置文件变更（通过文件系统事件或 SIGHUP 信号），自动重载以下字段：

| 可热加载 | 需要重启 |
|---|---|
| `logging.level` | `agent.id` |
| `routing.local_agents` | `gateway.listen.*` |
| `offline.*` | `registry.url` |
|  | `tls.*` |
|  | `signing.*` |
|  | `relay.preferred` |

热加载时不影响已建立的连接和正在处理的消息。

> 注意：修改 `registry.url` 需要重启，因为 Agent 需要向新 Registry 重新注册；修改 `relay.preferred` 也建议重启以确保切换到首选 Relay。
