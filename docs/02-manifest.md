# 02 - Manifest 与能力声明

## 概述

每个 Agent 应当公开发布一份 Manifest，声明自己是谁、能做什么、如何联系。Manifest 是 Agent 之间的"数字名片"。

## Manifest 结构

```json
{
  "adp_version": "0.1",
  "agent_id": "adp://alice@example.com/hermes",
  "display_name": "Hermes",
  "description": "我的个人智能助手",
  "version": "1.2.0",
  "capabilities": [
    "adp:ping",
    "adp:capability.query",
    "adp:task.delegate",
    "adp:info.share",
    "custom:code.review",
    "custom:file.share"
  ],
  "endpoints": {
    "gateway": {
      "protocol": "adp-ws",
      "address": "ws://192.168.1.100:9800/adp"
    }
  },
  "agent_info": {
    "vendor": "nous-research",
    "runtime": "hermes-1.0",
    "platform": "nas",
    "public": false,
    "task_recovery": "requeue"
  },
  "public_key": {
    "algorithm": "Ed25519",
    "key": "MCowBQYDK2VwAyEA...",
    "format": "spki-base64",
    "previous_key": null,
    "previous_expires_at": null
  },
  "updated_at": "2026-05-15T17:00:00Z"
}
```

### 字段说明

| 字段 | 必填 | 说明 |
|---|---|---|
| `adp_version` | 是 | 协议版本号 |
| `agent_id` | 是 | 完整 Agent ID |
| `display_name` | 是 | 可读名称 |
| `description` | 否 | 一段简短描述 |
| `version` | 推荐 | Agent 自身版本号 |
| `capabilities` | 是 | 支持的能力列表，见下文 |
| `endpoints` | 推荐 | 接入点信息，Registry 可用此自动构建 AccessPoint |
| `agent_info` | 否 | 可选的实现元信息 |
| `agent_info.task_recovery` | 否 | 宕机后任务恢复策略：`"fail-fast"`、`"requeue"`、`"timeout"`。详见 [13-task-lifecycle.md](13-task-lifecycle.md) |
| `public_key` | 否 | 公钥信息，用于消息签名验签。详见 [15-message-signing.md](15-message-signing.md) |
| `public_key.previous_key` | 否 | 密钥轮换期间的旧公钥 |
| `public_key.previous_expires_at` | 否 | 旧公钥的过期时间 |
| `updated_at` | 是 | 最后更新时间 |

## 能力标识

能力使用两段式命名空间：

```
[namespace]:[action]
```

- `adp:` — 协议标准能力，所有 Agent 应当实现
- `custom:` — 自定义能力，由各 Agent 自行定义

### 标准能力（`adp:` 命名空间）

| 标识 | 说明 | 级别 |
|---|---|---|
| `adp:ping` | 探活 | 必须 |
| `adp:capability.query` | 查询对方能力 | 必须 |
| `adp:info.share` | 单向信息推送 | 推荐 |
| `adp:task.delegate` | 委派任务 | 推荐 |
| `adp:task.status` | 查询任务状态 | 推荐 |
| `adp:task.cancel` | 取消任务 | 推荐 |

> 虽然 `task.*` 系列标记为"推荐"而非"必须"，但对于涉及异步协作的场景（家庭智能体网络、分布式任务执行），实现这些能力是保证互操作性的关键。仅在最简 Agent（如 IoT 传感器）上可跳过。

### 自定义能力示例

```
custom:code.review      # 代码审查
custom:file.share       # 文件共享
custom:schedule.check   # 日程查询
custom:weather.query    # 天气查询
custom:search.web       # 网络搜索
```

## 能力语义约定

每个能力可以附带一个 `input` 和 `output` 的 JSON Schema 描述（可选扩展）。初期不强制。

```json
{
  "capability": "custom:code.review",
  "input_schema": {
    "type": "object",
    "properties": {
      "repo": { "type": "string" },
      "pr": { "type": "integer" }
    },
    "required": ["repo", "pr"]
  },
  "output_schema": {
    "type": "object",
    "properties": {
      "status": { "type": "string" },
      "comments": { "type": "array" }
    }
  }
}
```

## Manifest 获取方式

1. **注册到 Registry**：Manifest 随注册请求附带，Registry 缓存
2. **点对点查询**：收到 `adp:capability.query` 请求时返回最新 Manifest
3. **本地缓存**：Gateway 可以缓存已知 Agent 的 Manifest，定时刷新

Gateway 应优先使用本地缓存的 Manifest，避免每次通信都做能力查询。
