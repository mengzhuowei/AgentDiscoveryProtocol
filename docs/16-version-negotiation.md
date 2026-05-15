# 16 - 协议版本协商

**更新：** 2026-05-15
**状态：** 草案（v0.1）

---

## 概述

ADP 协议使用语义化版本号。随着协议演进，不同版本的 Agent 需要能够互通。本文档定义版本发现、兼容性判断和降级策略。

---

## 版本号规范

版本号格式：`MAJOR.MINOR.PATCH`

| 版本位 | 变更类型 | 兼容性 |
|---|---|---|
| MAJOR | Envelope 结构不兼容、API 路径变更、必填字段增删 | **不兼容** |
| MINOR | 新增标准能力、新增可选字段、新增端点 | **向前兼容** |
| PATCH | 文档修正、示例更新、勘误 | **完全兼容** |

当前版本：**0.1**（草案阶段，MAJOR = 0 表示 API 不稳定）

---

## 版本发现

### 方式一：能力查询响应

收到 `adp:capability.query` 时，响应中应包含对方的协议版本：

```json
{
  "in_reply_to": "msg_...",
  "status": "ok",
  "data": {
    "agent_id": "adp://bob@home.io/claude",
    "adp_version": "0.1",
    "capabilities": ["adp:ping", "adp:capability.query"]
  }
}
```

### 方式二：Envelope 声明

每个 Envelope 的 `adp_version` 字段声明发送方使用的协议版本：

```json
{
  "adp_version": "0.1",
  "message_id": "msg_2x4k9m7q",
  ...
}
```

### 方式三：Registry 查询

Registry 在解析时返回 Agent 的协议版本：

```json
{
  "agent_id": "adp://bob@home.io/claude",
  "online": true,
  "adp_version": "0.1",
  "routes": [ ... ]
}
```

---

## 兼容性判断

### 兼容矩阵

| 发送方版本 | 接收方版本 | 兼容？ | 说明 |
|---|---|---|---|
| 0.1.0 | 0.1.0 | 兼容 | 同版本 |
| 0.2.0 | 0.1.0 | 兼容 | 高 MINOR → 低 MINOR：低版本忽略未知字段 |
| 0.1.0 | 0.2.0 | 兼容 | 低 MINOR → 高 MINOR：高版本向下兼容 |
| 1.0.0 | 0.9.0 | **不兼容** | 高 MAJOR → 低 MAJOR |
| 0.9.0 | 1.0.0 | 需检查 | 低 MAJOR → 高 MAJOR：取决于高版本是否保留兼容层 |

### 判断逻辑（伪代码）

```
function is_compatible(my_version, peer_version):
    if my_version.major == 0 and peer_version.major == 0:
        return true  // 草案阶段，尽力互通

    if my_version.major != peer_version.major:
        return false

    // 同 MAJOR，MINOR 差异向前兼容
    return true
```

---

## 降级策略

当检测到对方的协议版本低于自己时，高版本 Agent 应降级行为：

### 降级规则

| 场景 | 策略 |
|---|---|
| 发送方 0.2 的新增字段 | 如果对方是 0.1，则发送时移除 0.2 新增的可选字段 |
| 发送方使用新能力（`adp:task.stream`） | 先查询对方 capabilities，不支持则不使用 |
| 发送方使用新消息类型 | 降级为对方支持的等效类型 |
| 接收方收到未知字段 | **必须忽略**，不能报错（Robustness Principle） |

### 示例

```
Agent A (v0.2) 要给 Agent B (v0.1) 发送消息：

1. A 查询 B 的能力 → 得知 B 是 v0.1
2. A 检测到 v0.2 新增了 Envelope 的 "priority" 字段
3. A 发送时移除 "priority"，只使用 v0.1 兼容的字段
4. B 正常处理
```

---

## 版本不兼容时的错误处理

### 新增错误码

当通信无法进行时，返回错误：

```json
{
  "in_reply_to": "msg_...",
  "status": "error",
  "error": {
    "code": "VERSION_MISMATCH",
    "message": "Agent requires ADP >= 1.0, but you are using 0.1",
    "data": {
      "required_version": ">=1.0",
      "your_version": "0.1"
    }
  }
}
```

### 错误码

版本不兼容时返回的标准错误码为 `VERSION_MISMATCH`，参见 [03-message.md](03-message.md) 标准错误码表。

---

## Registry 版本管理

### 注册时声明版本

Agent 注册时，Registry 记录其协议版本：

```json
POST /adp/v1/register
{
  "agent_id": "adp://alice@example.com/hermes",
  "manifest": { /* adp_version 已包含在 manifest 中 */ },
  "routes": [ ... ]
}
```

### 版本过滤搜索

搜索时可指定最低协议版本：

```
GET /adp/v1/search?capability=custom:code.review&min_version=0.2
```

---

## 后续版本规划

### v0.2（计划）

- 新增 `adp:task.stream` 流式任务能力
- Envelope 新增可选 `priority` 字段

### v0.1 → v0.2 兼容确认清单

- [ ] v0.1 Agent 能否接收并正确忽略 v0.2 新增字段
- [ ] v0.1 Agent 收到 v0.2 消息时是否会因未知字段出错
- [ ] v0.2 新增能力是否在查询后使用（不假设对方支持）
- [ ] `VERSION_MISMATCH` 错误处理是否符合预期
