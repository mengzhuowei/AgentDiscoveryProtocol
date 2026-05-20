# 实现检查清单

**协议版本：** `adp/0.2`

本清单用于验证 ADP Agent 实现是否符合协议规范。必须项（MUST）是合规实现的最低要求，可选项（SHOULD/MAY）提供更好的用户体验。

---

## 核心加密模块

### Ed25519 密钥对

| 检查项 | 级别 | 说明 |
|--------|------|------|
| 生成 32 字节 Ed25519 密钥对 | MUST | 使用标准 Ed25519 实现 |
| 支持从种子恢复密钥对 | SHOULD | 用于密钥备份/恢复 |
| 私钥安全存储 | MUST | 操作系统密钥存储或加密文件 |

### Base64URL 编解码

| 检查项 | 级别 | 说明 |
|--------|------|------|
| 支持 Base64URL 无填充编码 | MUST | 43 字符 = 32 字节 Ed25519 公钥 |
| 支持 Base64URL 解码 | MUST | 包含合法性校验 |
| 拒绝非法字符或错误填充 | MUST | 防止解析错误 |

### JSON 规范化（ADP Canonical JSON）

| 检查项 | 级别 | 说明 |
|--------|------|------|
| 紧凑序列化（无缩进） | MUST | |
| 对象键按 Unicode 排序 | MUST | 确保跨实现一致性 |
| 标准字符串转义 | MUST | `\n`, `\"`, `\\`, `\uXXXX` |
| 跳过 undefined 值 | MUST | 不序列化为 null |
| 输出合法 UTF-8 | MUST | |

**测试向量验证：** 实现必须通过 [`06-signatures.md`](06-signatures.md#测试向量) 中的全部 6 个测试向量。

### 签名与验签

| 检查项 | 级别 | 说明 |
|--------|------|------|
| Ed25519 签名 | MUST | 64 字节签名输出 |
| Ed25519 验签 | MUST | 验证成功/失败布尔值 |
| 签名覆盖不含 sig 的规范化 Envelope | MUST | |
| 从 Agent ID 提取公钥 | MUST | Base64URLDecode user 段 |
| 拒绝无签名消息 | MUST | |

---

## Agent ID 与 Manifest

### Agent ID

| 检查项 | 级别 | 说明 |
|--------|------|------|
| 格式验证：`adp://{43字符}@{域名}/{32字符}` | MUST | |
| user 段为合法 Base64URL | MUST | 43 字符 |
| namespace 为合法域名格式 | MUST | |
| agent_name 为小写字母数字下划线短横 | MUST | 最长 32 字符 |
| 生成本地 visual_code | SHOULD | 用于 UI 展示 |

### Manifest

| 检查项 | 级别 | 说明 |
|--------|------|------|
| 必填字段：`protocol`, `agent_id`, `display_name`, `capabilities`, `routes`, `updated_at` | MUST | |
| `protocol` 必须为 `"adp/0.2"` | MUST | |
| `routes` 至少一条 | MUST | 允许空数组表示仅声明 |
| `capabilities` 包含 `adp:ping` 和 `adp:capability.query` | MUST | |
| `updated_at` 为 ISO 8601 UTC | MUST | 精确到毫秒 |

---

## 消息处理

### Envelope 解析与构建

| 检查项 | 级别 | 说明 |
|--------|------|------|
| 解析 JSON 为 Envelope 对象 | MUST | |
| 验证必填字段存在 | MUST | protocol, id, from, to, action, params, timestamp, sig |
| 时间戳格式验证 | MUST | ISO 8601 UTC，精确到毫秒 |
| 构建签名消息 | MUST | |
| 规范化后序列化 | MUST | |

### 消息验证流程

| 检查项 | 级别 | 说明 |
|--------|------|------|
| 签名存在性检查 | MUST | 不存在 → INVALID_SIGNATURE |
| 签名长度检查 | MUST | 64 字节 |
| 时间戳新鲜度 | MUST | 偏差 ≤ 300 秒 |
| 从 from 提取公钥 | MUST | |
| Ed25519 验签 | MUST | |
| 信任存储查找/钉扎 | MUST | |
| 消息 ID 去重 | MUST | 至少保留 5 分钟 |

### 错误处理

| 检查项 | 级别 | 说明 |
|--------|------|------|
| 正确返回标准错误码 | MUST | |
| 错误消息包含 code, message | MUST | |
| 错误回复带签名 | MUST | |
| `reply_to` 指向原消息 | MUST | |

---

## 标准能力（adp: 命名空间）

### 必须实现

| 能力 | 检查项 | 级别 |
|------|--------|------|
| `adp:ping` | 接收 ping 返回 pong（带 params） | MUST |
| `adp:capability.query` | 返回 Manifest | MUST |

### 推荐实现

| 能力 | 检查项 | 级别 |
|------|--------|------|
| `adp:info` | 处理自由格式通知 | SHOULD |
| `adp:key.rotate` | 验证轮换签名，更新 trust store | SHOULD |
| `adp:task.create` | 创建任务，返回 task_id | SHOULD |
| `adp:task.get` | 查询任务状态 | SHOULD |
| `adp:task.list` | 列出任务（分页支持） | SHOULD |
| `adp:task.cancel` | 取消任务 | SHOULD |

---

## 传输层

### WebSocket 服务器

| 检查项 | 级别 | 说明 |
|--------|------|------|
| 监听 `/adp` 路径 | MUST | |
| 处理文本帧 JSON | MUST | |
| 连接时提取 agent_id 参数 | SHOULD | |
| 心跳检测（Ping/Pong） | MUST | |
| 空闲超时断开 | SHOULD | |

### WebSocket 客户端

| 检查项 | 级别 | 说明 |
|--------|------|------|
| 连接时携带 agent_id | SHOULD | |
| 发送文本帧 JSON | MUST | |
| 接收消息回调 | MUST | |
| 断线重连（指数退避） | SHOULD | 1s → 2s → 4s → ... → 60s |
| 心跳保持 | SHOULD | |

### Relay 支持

| 检查项 | 级别 | 说明 |
|--------|------|------|
| 解析 welcome 消息获取 session_id | MUST | |
| 处理 busy 消息并退避重试 | MUST | |
| 包装消息为 relay 格式 | MUST | |
| 区分控制消息和 Agent 消息 | MUST | |

---

## 发现机制

### mDNS

| 检查项 | 级别 | 说明 |
|--------|------|------|
| 发布 `_adp._tcp` 服务 | SHOULD | |
| TXT 包含 agent_id 和 protocol | MUST | |
| 发布 goodbye 包 | SHOULD | |
| 浏览服务发现其他 Agent | SHOULD | |
| 120 秒过期处理 | MUST | |

### 静态配置

| 检查项 | 级别 | 说明 |
|--------|------|------|
| 读取 `~/.adp/contacts.json` | SHOULD | |
| 支持 pinned trust | SHOULD | |
| 支持多路由备用 | SHOULD | |

### Registry

| 检查项 | 级别 | 说明 |
|--------|------|------|
| POST /v1/agents 注册 | SHOULD | |
| PUT /v1/agents/{initial_id} 更新 | SHOULD | |
| DELETE 注销 | SHOULD | |
| GET 解析 Agent | SHOULD | |
| 处理 rotation_chain 验证 | SHOULD | |
| 签名写请求 | SHOULD | |
| 搜索能力 | MAY | |

---

## 信任存储

| 检查项 | 级别 | 说明 |
|--------|------|------|
| 持久化到 `~/.adp/trust_store.json` | MUST | |
| 首次相遇钉扎公钥 | MUST | |
| 验签时查找信任记录 | MUST | |
| 支持 pinned trust | SHOULD | |
| 支持 rotation 继承 | SHOULD | |
| 记录 verified_by 来源 | SHOULD | |
| 标记 superseded_by | SHOULD | |
| 公钥变化检测 | MUST | TRUST_CONFLICT |

---

## 任务抽象（adp:task.*）

| 检查项 | 级别 | 说明 |
|--------|------|------|
| 5 态状态机实现 | MUST | PENDING → WORKING → COMPLETED/FAILED/CANCELED |
| 任务 ID 唯一生成 | MUST | 推荐 task_ 前缀 |
| 任务创建返回 task_id 和状态 | MUST | |
| 任务查询返回完整状态 | MUST | |
| 任务取消仅创建方可操作 | MUST | |
| 支持分页列表查询 | SHOULD | |

---

## 分布式追踪

| 检查项 | 级别 | 说明 |
|--------|------|------|
| 识别 trace_id (32 hex) | SHOULD | |
| 识别 span_id (16 hex) | SHOULD | |
| 转发时保留 trace_id | SHOULD | |
| 生成新 span_id | SHOULD | |
| OpenTelemetry 集成 | MAY | |

---

## 配置与部署

| 检查项 | 级别 | 说明 |
|--------|------|------|
| 读取配置文件 `~/.adp/config.json` | SHOULD | |
| 环境变量覆盖 | SHOULD | ADP_REGISTRY, ADP_RELAY 等 |
| 私钥持久化 | MUST | |
| Trust store 持久化 | MUST | |

---

## 协议版本兼容性

| 检查项 | 级别 | 说明 |
|--------|------|------|
| 支持 `adp/0.2` | MUST | |
| 发送 UNSUPPORTED_PROTOCOL 错误 | MUST | |
| 拒绝无签名消息 | MUST | |
| 忽略未知可选字段 | MUST | 前向兼容 |

---

## 测试覆盖

| 检查项 | 级别 | 说明 |
|--------|------|------|
| Canonical JSON 测试向量全部通过 | MUST | |
| 签名/验签测试 | MUST | |
| Envelope 构建/解析测试 | MUST | |
| 错误码测试 | SHOULD | |
| mDNS 发现测试 | SHOULD | |
| WebSocket 连接测试 | MUST | |
| 任务状态机测试 | SHOULD | |
| 跨实现互操作测试 | SHOULD | 与其他实现通信 |

---

## 合规性声明

实现可在文档或代码中声明合规性：

```
ADP v0.2 Compliant Implementation
- Core Cryptography: Ed25519, Base64URL, Canonical JSON ✅
- Standard Capabilities: adp:ping, adp:capability.query ✅
- Optional: adp:task.*, Registry, Relay ⚠️
```
