# 01 — 身份与能力

## Agent ID

Agent 使用自认证 URI 标识，`user` 段直接为 Base64URL（无填充）编码的 Ed25519 公钥，与网络地址解耦：

```
adp://{pubkey_b64url}@namespace/agent_name
```

`pubkey_b64url` 为 32 字节 Ed25519 公钥的 Base64URL 无填充编码，固定 43 字符。

示例：

```
adp://mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB@home.io/claude
adp://zLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIC@example.com/hermes
adp://xLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZID@company.com/ops-bot
```

### 为什么 user 段是完整公钥

持有 Ed25519 私钥 → 推导公钥 → Base64URL 无填充编码为 `pubkey_b64url`。`pubkey_b64url` 嵌入 Agent ID，任何人拿到 Agent ID 即可提取出完整公钥验签——无需查询 Manifest、无需 CA、无需 PKI。与 libp2p peer ID、Nostr npub 原理一致（编码格式不同，语义相同）。

换密钥 = 换公钥 = 换 Agent ID。旧身份可通过 `adp:key.rotate` 将信任传递给新身份，详见[密钥轮换](#密钥轮换)。

### 字段规则

| 段 | 必填 | 规则 |
|---|---|---|
| `pubkey_b64url` | 是 | Base64URL 无填充编码的 Ed25519 公钥（32 字节），固定 43 字符 |
| `@namespace` | 是 | 身份命名空间，合法域名，小写，最长 255 字符。Registry 场景用作路由域，局域网场景可用保留值 `local` |
| `/agent_name` | 是 | 小写字母、数字、`_`、`-`，最长 32 字符 |

整体不超过 512 字符。

### 本地别名

Agent ID 中 user 段不可读，Agent 可维护本地别名方便记忆：

```json
{ "nick": "bob", "target_id": "adp://mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB@home.io/claude" }
```

发送时 Gateway 展开为完整 ID。别名仅本地有效，不跨 Agent 共享。

### 可视化短码

完整 Agent ID 的 user 段为 43 字符 Base64URL 公钥，不便于人工快速比对。为此定义 **visual_code**——从公钥派生的短视觉标识，仅用于带外展示和人工确认：

```
visual_code = Base64URL_NoPad(BLAKE2b(ed25519_pubkey, output_bytes=6))  →  8 字符
```

分段展示格式：`mLq3-x9Z1`

**用途**：
- 首次相遇时，通过视频通话、二维码、口述等方式互相告知 visual_code
- UI 中与 display_name 一并展示
- visual_code 一致 → 公钥一致 → Agent ID user 段一致

**安全语义**：`visual_code` 仅为 UX 辅助，**不参与协议验证逻辑**。攻击者针对特定公钥找到一个 visual_code 相同的伪造公钥需约 2^48 次原像计算，对即时 MitM 不现实。

### 多通道交叉验证

首次相遇时，Agent 应从所有可用通道获取对方的 Agent ID 并交叉比对。协议定义以下验证流程：

```
1. 从每个可用通道提取 Agent ID:
   - 通道 A: mDNS TXT 记录的 agent_id
   - 通道 B: Registry 返回的 current_agent_id
   - 通道 C: 静态配置 (contacts.json) 中的 Agent ID (键)

2. 从每个 Agent ID 的 user 段提取公钥，交叉比对：
   - 所有通道的 Agent ID 必须完全一致
   - 单通道场景（纯 mDNS / 纯 Registry）跳过比对

3. 全部一致 → 钉扎
4. 任一不一致 → TRUST_CONFLICT:
   - 列出各通道返回的不同值
   - 提示用户手动确认（可借助 visual_code）
   - 用户确认后钉扎选定值

5. trust store 额外记录验证来源:
   "verified_by": ["mdns", "registry", "static"]
```

| `verified_by` 条目 | 含义 |
|---------------------|------|
| `"mdns"` | mDNS 通道确认了该 Agent ID |
| `"registry"` | Registry 通道确认了该 Agent ID |
| `"static"` | 静态配置预埋 |
| `"tofu_single"` | 仅单通道，未交叉验证（当前场景的自然退化） |
| `"user_confirmed"` | 用户手动确认（通道冲突后的人工裁决） |

Gateway 在连接前自动执行交叉验证。单通道场景退化为 `tofu_single`，与现状行为一致，不增加负担。

---

## Manifest

每个 Agent 公开一份 Manifest，声明能力与路由。Manifest 本身不带签名——它的真实性由包含它的消息的 Ed25519 签名保证（Agent ID 即公钥）。

### 结构

```json
{
  "protocol": "adp/0.2",
  "agent_id": "adp://mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB@home.io/claude",
  "display_name": "Claude",
  "description": "家庭智能体",
  "capabilities": [
    "adp:ping",
    "adp:capability.query",
    "adp:info",
    { "capability": "custom:code.review", "description": "审查代码 PR" }
  ],
  "routes": [
    { "type": "direct", "address": "192.168.1.100:9800" }
  ],
  "agent_info": {
    "platform": "linux",
    "runtime": "node/22",
    "heartbeat_interval": 30
  },
  "updated_at": "2026-05-16T17:00:00.000Z"
}
```

### 字段说明

| 字段 | 必填 | 说明 |
|---|---|---|
| `protocol` | 是 | 协议版本，当前 `"adp/0.2"` |
| `agent_id` | 是 | 完整 Agent ID，user 段为 Base64URL 编码的 Ed25519 公钥。身份由包含此 Manifest 的消息签名保证 |
| `display_name` | 是 | 可读名称 |
| `description` | 否 | 简短描述 |
| `capabilities` | 是 | 支持的能力列表。元素可以是字符串（`"ns:action"`）或对象（含 `capability` + 可选 schema） |
| `routes` | **是** | 接入点列表，至少一条。支持多路由备用（direct / relay）。空数组 `[]` 表示仅做身份声明，不可建立连接 |
| `agent_info` | 否 | 可选的实现元信息（`platform`、`runtime`、`heartbeat_interval` 等自由字段） |
| `updated_at` | 是 | 最后更新时间，ISO 8601 UTC，精确到毫秒 |

### 身份验证

Manifest 本身不带签名——身份由消息签名保证。接收方通过 `adp:capability.query` 获取 Manifest 时，响应是一条标准 ADP 消息。接收方从该消息的 `from` 字段提取 Agent ID → Base64URLDecode → 公钥 → 验签消息的 `sig` 字段。

```
获取 Manifest 的完整验证链:
  1. 收到 adp:capability.query 的响应消息
  2. 从 from 提取 Agent ID → Base64URLDecode 得到公钥
  3. 验签消息 sig → 通过 = 该 Manifest 确实来自该 Agent
  4. 无签名验证失败 = 拒绝
```

Agent ID 即身份。没有单独的 Manifest 自签名验证步骤。

### 获取方式

1. 发送 `adp:capability.query` 请求，对方返回包含 Manifest 的签名响应
2. 通过 mDNS 发现 Agent 后，再发起 `adp:capability.query` 获取 Manifest（局域网场景）
3. 从 Registry 解析时一并获取缓存的 Manifest（跨网络场景）

Gateway 应缓存已知 Agent 的 Manifest，定时刷新。

### 首次相遇（TOFU）

```
1. 从消息 from 字段提取 Agent ID → Base64URLDecode → 公钥
2. 多通道交叉比对 Agent ID 一致（详见多通道交叉验证章节）
3. 验签消息 sig → 通过
4. 钉扎 Agent ID 到 trust store
5. 若已钉扎的 Agent ID 与新收到的不同 → "TRUST_CONFLICT" 告警
```

TOFU 的局限及缓解措施详见 [`05-security.md`](05-security.md)。

---

## 密钥轮换

Agent ID 不可变——换密钥必然产生新公钥、新 Agent ID。但旧身份可以在私钥仍安全时，通过签名声明将信任传递给新身份。

### 轮换声明

旧 Agent 向已知对端发送 `adp:key.rotate` 消息：

```json
{
  "protocol": "adp/0.2",
  "id": "msg_rotate_001",
  "from": "adp://mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB@home.io/claude",
  "to": "adp://zLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIC@example.com/hermes",
  "action": "adp:key.rotate",
  "params": {
    "new_agent_id": "adp://xLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZID@home.io/claude",
    "reason": "scheduled"
  },
  "timestamp": "2026-05-17T10:00:00.000Z",
  "sig": "<用旧私钥签名>"
}
```

`to` 为单个对端 Agent ID。如需通知多个对端，逐条发送。

### 对端验证

收到 `adp:key.rotate` 后：

```
1. 用 trust store 中旧 Agent ID 对应的公钥验签 → 确认声明来自旧身份
2. 从 new_agent_id 的 user 段直接提取新公钥（Base64URLDecode）
3. 将新身份写入 trust store，旧记录保留但不活跃
```

### 信任链

```
adp://old_pubkey@home.io/claude ──(key.rotate)──► adp://new_pubkey@home.io/claude
     ↑ 已信任                                          ↑ 继承信任
```

此后对端使用新 Agent ID 通信，签名用新公钥验证。旧密钥可安全废弃。

### 完整流程

轮换方需同步更新三条通道：

```
1. 生成新 Ed25519 密钥对 → 构建新 Manifest（新 Agent ID）
2. 向已知对端逐条发送 adp:key.rotate → 维护现有信任关系
3. 向 Registry 更新（URL 不变）：
   PUT /v1/agents/{initial_id}
   {
     "agent_id": "adp://new_pubkey@...",
     "manifest": {...},
     "routes": [...],
     "rotation": {
       "protocol": "adp/0.2",
       "id": "msg_rotate_reg_001",
       "from": "adp://old_pubkey@...",
       "to": "adp://new_pubkey@...",
       "action": "adp:key.rotate",
       "params": { "new_agent_id": "adp://new_pubkey@...", "reason": "scheduled" },
       "timestamp": "...",
       "sig": "<旧私钥的标准 Envelope Ed25519 签名>"
     }
   }
4. 旧私钥安全废弃
```

**为什么需要 Registry 更新**：通过 Registry 发现的新对端不走 `adp:key.rotate` 消息通道。Registry 更新后形成 `rotation_chain`——新对端解析时下载整条链，用 initial_id 中的公钥逐跳验证到 current_agent_id，无需信任 Registry。

### 安全语义

- **不广播**：轮换仅对收到声明的对端生效。新对端首次相遇仍走 TOFU
- **单向传递**：信任链仅传递一次，不接受用已废弃私钥签发的二次轮换。如需再次轮换，以新身份签发新的 `adp:key.rotate`
- **审计保留**：旧记录保留在 trust store，标记 `superseded_by` 指向新身份，作为审计线索
- **泄露标识**：`reason: "compromised"` 时对端应提高警觉（如通知用户手动确认新公钥）

信任链的 trust store 记录格式详见 [`06-signatures.md`](06-signatures.md)。

---

## 能力标识

两段式命名空间：`[namespace]:[action]`

### 标准能力（`adp:` 命名空间）

| 标识 | 级别 | 说明 |
|---|---|---|
| `adp:ping` | **必须** | 探活 |
| `adp:capability.query` | **必须** | 查询对方能力清单 |
| `adp:info` | 推荐 | 发送自由格式通知（可选标准化字段） |
| `adp:key.rotate` | 推荐 | 声明密钥轮换，将信任从旧身份传递给新身份 |
| `adp:task.create` | 推荐 | 创建任务并返回 `task_id` |
| `adp:task.get` | 推荐 | 查询任务状态与结果 |
| `adp:task.list` | 推荐 | 列出当前 Agent 管理的任务（支持筛选） |
| `adp:task.cancel` | 推荐 | 取消进行中的任务 |

> 标准能力只定义互操作的最小基线。`adp:ping` 和 `adp:capability.query` 是所有 Agent 必须实现的。

### 标准能力参数

**`adp:ping`**

请求方 `params` 为空 `{}`。响应方在 `params` 中可附带任意信息（如 `uptime`、`version`），不做强制约定。

**`adp:capability.query`**

请求方 `params` 为空 `{}`。响应方在 `params` 中返回 Manifest（无签名、无公钥字段，身份由消息 sig 保证）：

```json
{
  "params": {
    "manifest": { /* Manifest 对象 */ }
  }
}
```

**`adp:info`**

`adp:info` 是自由格式通知——不强制内部结构，由收发双方约定语义。为促进互操作，建议使用以下可选标准化字段：

```json
{
  "params": {
    "text": "晚饭准备好了",
    "severity": "info",
    "category": "home",
    "data": {}
  }
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `text` | 否 | 可读文本内容 |
| `severity` | 否 | `info` / `warn` / `error` |
| `category` | 否 | 分类标签，由应用定义 |
| `data` | 否 | 任意附加数据（JSON 对象） |

所有字段均可选——实现方可只用 `text`，也可完全不使用这些字段。结构化消息需求留给上层扩展。

**`adp:key.rotate`**

请求方 `params`：

| 字段 | 必填 | 说明 |
|------|------|------|
| `new_agent_id` | 是 | 新 Agent ID |
| `reason` | 否 | 轮换原因（如 `scheduled`、`compromised`） |

响应方验证通过后返回空 `params: {}`。验证失败返回 `INVALID_SIGNATURE`。

### 任务抽象（Task）

ADP 核心只定义消息投递原语。任务委派是可选的薄抽象——底层仍然是标准 Envelope + Ed25519 签名，不做独立的 Task RPC。

Agent 在 Manifest 的 `capabilities` 中声明 `adp:task.*` 即表示支持任务语义。

#### 状态机

5 态最小模型：

```
         ┌──→ CANCELED (终态)
         │
PENDING ─┼──→ WORKING ──→ COMPLETED (终态)
         │            ├─→ FAILED    (终态)
         │            └─→ CANCELED  (终态)
         │
         └──→ (直接完成/失败，跳过 WORKING)
```

#### 消息模式

**创建任务：**

```json
{
  "protocol": "adp/0.2",
  "id": "msg_task001",
  "from": "adp://mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB@home.io/claude",
  "to": "adp://zLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIC@example.com/hermes",
  "action": "adp:task.create",
  "params": {
    "capability": "custom:code.review",
    "input": { "repo": "my-project", "pr": 42 },
    "context_id": "optional-grouping-key"
  },
  "timestamp": "2026-05-19T10:00:00.000Z",
  "sig": "..."
}
```

接收方返回：

```json
{
  "protocol": "adp/0.2",
  "id": "msg_task001_resp",
  "from": "adp://zLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIC@example.com/hermes",
  "to": "adp://mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB@home.io/claude",
  "reply_to": "msg_task001",
  "action": "adp:task.create",
  "params": {
    "task_id": "task_7k2m9x4q",
    "status": "PENDING"
  },
  "timestamp": "2026-05-19T10:00:00.150Z",
  "sig": "..."
}
```

**查询任务：**

```json
{
  "action": "adp:task.get",
  "params": { "task_id": "task_7k2m9x4q" }
}
```

响应 `params`：

| 字段 | 必填 | 说明 |
|------|------|------|
| `task_id` | 是 | 任务标识 |
| `status` | 是 | 当前状态：`PENDING` / `WORKING` / `COMPLETED` / `FAILED` / `CANCELED` |
| `result` | 否 | 任务结果（`COMPLETED` 时） |
| `error` | 否 | 错误信息（`FAILED` 时，结构同 Envelope `error` 字段） |
| `created_at` | 是 | 创建时间，ISO 8601 毫秒 UTC |
| `updated_at` | 是 | 最后更新时间，ISO 8601 毫秒 UTC |

**列出任务：**

```json
{
  "action": "adp:task.list",
  "params": { "status": "WORKING", "cursor": "", "limit": 20 }
}
```

响应 `params`：

| 字段 | 必填 | 说明 |
|------|------|------|
| `tasks` | 是 | 任务摘要数组，每项含 `task_id`、`status`、`capability`、`created_at` |
| `next_cursor` | 是 | 分页游标，`null` 表示最后一页 |

`status` 省略时返回全部。`next_cursor` 为 `null` 表示最后一页。

**取消任务：**

```json
{
  "action": "adp:task.cancel",
  "params": { "task_id": "task_7k2m9x4q" }
}
```

仅创建方可取消。取消后 `status` 变为 `CANCELED`（终态）。

#### 设计约束

- 任务 ID 由接收方（执行方）生成，格式推荐 `task_` 前缀
- 任务状态变更时，执行方可主动推送 `adp:info` 通知（可选，`category: "task"`，`data.task_id` + `data.status`）
- `context_id` 用于将多个任务分组关联（如同一次对话的多个步骤），不强制
- 任务层不定义超时——调用方自行决定何时放弃并发送 `adp:task.cancel`
- 不引入 A2A 那样的 `INPUT_REQUIRED` 多轮中断——需要澄清时直接回复 `adp:info`，由调用方决定是否创建新任务

---

### 自定义能力

Manifest 的 `capabilities` 数组中，能力声明可以是以下两种形式：

**简写（字符串）：** 仅声明能力标识，无参数约束。

```
custom:code.review
custom:file.share
custom:weather.query
```

**完整声明（对象）：** 附带 JSON Schema 描述输入输出及支持的媒体类型（可选）。

```json
{
  "capability": "custom:code.review",
  "description": "审查代码 PR",
  "input_modes": ["application/json"],
  "output_modes": ["application/json"],
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
      "approved": { "type": "boolean" },
      "comments": { "type": "array", "items": { "type": "string" } }
    }
  }
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `capability` | 是 | 能力标识，格式 `[namespace]:[action]` |
| `description` | 否 | 能力功能描述 |
| `input_modes` | 否 | 接受的 MIME 类型数组，如 `["image/png", "application/json"]`。省略或空数组表示不约束 |
| `output_modes` | 否 | 产出的 MIME 类型数组。省略或空数组表示不约束 |
| `input_schema` | 否 | JSON Schema，描述 `params` 的期望结构 |
| `output_schema` | 否 | JSON Schema，描述响应 `params` 的期望结构 |

`capabilities` 数组可混合使用字符串和对象。实现方可通过 `adp:capability.query` 获取完整声明。
