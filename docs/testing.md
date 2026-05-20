# 测试规范

**协议版本：** `adp/0.2`

本规范定义了 ADP 实现的一致性测试和互操作性测试要求。

---

## 测试分类

```
┌─────────────────────────────────────────────┐
│              ADP 测试套件                    │
├─────────────────────────────────────────────┤
│  1. 单元测试                                 │
│     - Canonical JSON                        │
│     - Base64URL 编解码                       │
│     - Ed25519 签名/验签                      │
│     - Agent ID 解析                          │
│     - Envelope 构建/验证                     │
│     - 任务状态机                             │
├─────────────────────────────────────────────┤
│  2. 集成测试                                 │
│     - WebSocket 连接                         │
│     - 消息收发                               │
│     - mDNS 发现                              │
│     - Trust Store 持久化                     │
├─────────────────────────────────────────────┤
│  3. 互操作性测试                             │
│     - 与其他实现通信                         │
│     - 跨语言验证                             │
└─────────────────────────────────────────────┘
```

---

## 1. Canonical JSON 测试向量

实现必须通过以下全部测试用例：

### 测试用例 1：基本键排序

**输入：**
```json
{"b":2,"a":1}
```

**期望输出：**
```json
{"a":1,"b":2}
```

### 测试用例 2：嵌套对象

**输入：**
```json
{"z":{"b":2,"a":1},"a":1}
```

**期望输出：**
```json
{"a":1,"z":{"a":1,"b":2}}
```

### 测试用例 3：数组（不排序）

**输入：**
```json
[3,1,2]
```

**期望输出：**
```json
[3,1,2]
```

### 测试用例 4：字符串转义

**输入：**
```json
{"key":"value\nwith\"quotes"}
```

**期望输出：**
```json
{"key":"value\nwith\"quotes"}
```

### 测试用例 5：undefined 值省略

**输入：**
```json
{"a":1,"b":null,"c":3}
```

**期望输出：**
```json
{"a":1,"b":null,"c":3}
```

> 注意：在 JSON 中 `null` 是合法值，会被保留。undefined 才被省略。

### 测试用例 6：完整 Envelope（不含 sig）

**输入：**
```json
{
  "protocol": "adp/0.2",
  "id": "msg_2x4k9m7q",
  "from": "adp://mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB@home.io/claude",
  "to": "adp://zLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIC@example.com/hermes",
  "action": "adp:ping",
  "params": {},
  "timestamp": "2026-05-16T17:30:00.000Z"
}
```

**期望输出（单行，无空格）：**
```
{"action":"adp:ping","from":"adp://mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB@home.io/claude","id":"msg_2x4k9m7q","params":{},"protocol":"adp/0.2","timestamp":"2026-05-16T17:30:00.000Z","to":"adp://zLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIC@example.com/hermes"}
```

---

## 2. Base64URL 测试向量

### 编码测试

| 输入（十六进制） | 期望输出 |
|-----------------|----------|
| `98bab7c7d67529f47bb4dc0fd9b56c43c709e611b8985e9a63474bdc9f15f264` | `mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB` |
| `0000000000000000000000000000000000000000000000000000000000000000` | `AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` |

### 解码测试

| 输入 | 期望输出（十六进制） |
|------|---------------------|
| `mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB` | `98bab7c7d67529f47bb4dc0fd9b56c43c709e611b8985e9a63474bdc9f15f264` |

### 非法输入测试

| 输入 | 期望行为 |
|------|----------|
| `MII=` | 抛出错误（非法填充） |
| `abc!` | 抛出错误（非法字符） |
| `AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`（44字符） | 抛出错误（长度必须为 43） |

---

## 3. 签名测试向量

### 测试密钥对

```
公钥 (hex):  98bab7c7d67529f47bb4dc0fd9b56c43c709e611b8985e9a63474bdc9f15f264
私钥 (hex): 9b35a0e03fc7a9e83e7b6f8b3e8c9a4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0
```

### 待签名消息（Canonical JSON）

```json
{"action":"adp:ping","from":"adp://mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB@home.io/claude","id":"msg_test_001","params":{},"protocol":"adp/0.2","timestamp":"2026-05-20T10:00:00.000Z","to":"adp://zLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIC@example.com/hermes"}
```

### 期望签名结果（Base64URL，无填充）

实现必须能够：
1. 对上述消息产生确定性签名
2. 用对应公钥验签成功
3. 用错误公钥验签失败

---

## 4. Agent ID 解析测试

### 合法 Agent ID

| 输入 | publicKey (hex) | namespace | agent_name |
|------|-----------------|-----------|------------|
| `adp://mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB@home.io/claude` | `98bab7c7d67529f47bb4dc0fd9b56c43c709e611b8985e9a63474bdc9f15f264` | `home.io` | `claude` |
| `adp://zLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIC@example.com/hermes` | `98bab7c7d67529f47bb4dc0fd9b56c43c709e611b8985e9a63474bdc9f15f265` | `example.com` | `hermes` |

### 非法 Agent ID

| 输入 | 期望行为 |
|------|----------|
| `adp://SHORT@home.io/agent` | 抛出错误：pubkey 长度不正确 |
| `adp://mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB@invalid domain/agent` | 抛出错误：namespace 格式非法 |
| `adp://mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB@home.io/AGENT` | 抛出错误：agent_name 必须小写 |
| `http://mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB@home.io/agent` | 抛出错误：必须是 adp:// 前缀 |
| `adp://mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB@home.io/agent_name_too_long_1234567890` | 抛出错误：agent_name 超过 32 字符 |

---

## 5. 消息验证测试用例

### TC-001：有效消息

```json
{
  "protocol": "adp/0.2",
  "id": "msg_001",
  "from": "adp://mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB@home.io/claude",
  "to": "adp://zLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIC@example.com/hermes",
  "action": "adp:ping",
  "params": {},
  "timestamp": "2026-05-20T10:00:00.000Z",
  "sig": "<有效签名>"
}
```

**期望：** 验证通过

### TC-002：缺少签名

```json
{
  "protocol": "adp/0.2",
  "id": "msg_001",
  "from": "adp://mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB@home.io/claude",
  "to": "adp://zLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIC@example.com/hermes",
  "action": "adp:ping",
  "params": {},
  "timestamp": "2026-05-20T10:00:00.000Z"
}
```

**期望：** 拒绝，返回 `INVALID_SIGNATURE`

### TC-003：过期时间戳

```json
{
  "protocol": "adp/0.2",
  "id": "msg_001",
  "from": "adp://mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB@home.io/claude",
  "to": "adp://zLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIC@example.com/hermes",
  "action": "adp:ping",
  "params": {},
  "timestamp": "2026-05-19T10:00:00.000Z",
  "sig": "<有效签名>"
}
```

**期望：** 拒绝，返回 `INVALID_PARAMS`（时间戳偏差 > 300 秒）

### TC-004：未来时间戳

```json
{
  "protocol": "adp/0.2",
  "id": "msg_001",
  "from": "adp://mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB@home.io/claude",
  "to": "adp://zLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIC@example.com/hermes",
  "action": "adp:ping",
  "params": {},
  "timestamp": "2026-05-21T10:00:00.000Z",
  "sig": "<有效签名>"
}
```

**期望：** 拒绝，返回 `INVALID_PARAMS`

### TC-005：无效签名长度

```json
{
  "protocol": "adp/0.2",
  "id": "msg_001",
  "from": "adp://mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB@home.io/claude",
  "to": "adp://zLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIC@example.com/hermes",
  "action": "adp:ping",
  "params": {},
  "timestamp": "2026-05-20T10:00:00.000Z",
  "sig": "SHORT"
}
```

**期望：** 拒绝，返回 `INVALID_SIGNATURE`

### TC-006：伪造签名

```json
{
  "protocol": "adp/0.2",
  "id": "msg_001",
  "from": "adp://mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB@home.io/claude",
  "to": "adp://zLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIC@example.com/hermes",
  "action": "adp:ping",
  "params": {},
  "timestamp": "2026-05-20T10:00:00.000Z",
  "sig": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
}
```

**期望：** 拒绝，返回 `INVALID_SIGNATURE`

### TC-007：消息 ID 重复

**前提：** 消息 ID `msg_001` 已在去重缓存中。

```json
{
  "protocol": "adp/0.2",
  "id": "msg_001",
  "from": "adp://mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB@home.io/claude",
  "to": "adp://zLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIC@example.com/hermes",
  "action": "adp:ping",
  "params": {},
  "timestamp": "2026-05-20T10:00:00.000Z",
  "sig": "<有效签名>"
}
```

**期望：** 拒绝，返回 `DUPLICATE_MESSAGE`

---

## 6. 能力处理测试

### TC-010：adp:ping

**请求：**
```json
{
  "protocol": "adp/0.2",
  "id": "msg_ping_001",
  "from": "adp://mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB@home.io/claude",
  "to": "adp://zLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIC@example.com/hermes",
  "action": "adp:ping",
  "params": {},
  "timestamp": "2026-05-20T10:00:00.000Z",
  "sig": "..."
}
```

**期望响应：**
```json
{
  "protocol": "adp/0.2",
  "id": "msg_ping_resp_001",
  "from": "adp://zLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIC@example.com/hermes",
  "to": "adp://mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB@home.io/claude",
  "reply_to": "msg_ping_001",
  "action": "adp:ping",
  "params": { "uptime": 3600.5 },
  "timestamp": "2026-05-20T10:00:01.000Z",
  "sig": "..."
}
```

### TC-011：adp:capability.query

**请求：**
```json
{
  "protocol": "adp/0.2",
  "id": "msg_capq_001",
  "from": "adp://mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB@home.io/claude",
  "to": "adp://zLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIC@example.com/hermes",
  "action": "adp:capability.query",
  "params": {},
  "timestamp": "2026-05-20T10:00:00.000Z",
  "sig": "..."
}
```

**期望响应：** 包含完整 Manifest

### TC-012：未知 action

**请求：**
```json
{
  "protocol": "adp/0.2",
  "id": "msg_unknown_001",
  "from": "adp://mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB@home.io/claude",
  "to": "adp://zLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIC@example.com/hermes",
  "action": "adp:unknown.action",
  "params": {},
  "timestamp": "2026-05-20T10:00:00.000Z",
  "sig": "..."
}
```

**期望响应：** 错误回复，`error.code` 为 `UNKNOWN_ACTION`

---

## 7. 任务状态机测试

### TC-020：完整生命周期

```
create(PENDING) → start(WORKING) → complete(COMPLETED)
```

```typescript
const task = manager.create('custom:test', { input: 'data' });
expect(task.status).toBe('PENDING');

manager.start(task.taskId);
expect(task.status).toBe('WORKING');

manager.complete(task.taskId, { result: 'success' });
expect(task.status).toBe('COMPLETED');
```

### TC-021：失败路径

```
create(PENDING) → start(WORKING) → fail(FAILED)
```

### TC-022：取消路径

```
create(PENDING) → cancel(CANCELED)
```

### TC-023：非法状态转换

| 当前状态 | 操作 | 期望行为 |
|----------|------|----------|
| COMPLETED | start() | 抛出错误 |
| FAILED | complete() | 抛出错误 |
| CANCELED | cancel() | 抛出错误 |
| PENDING | complete() | 抛出错误（必须先 start） |

---

## 8. WebSocket 测试

### TC-030：建立连接

```typescript
const ws = new WebSocket('ws://localhost:9800/adp?agent_id=...');
await waitForEvent(ws, 'open');
expect(ws.readyState).toBe(WebSocket.OPEN);
```

### TC-031：接收消息

```typescript
ws.on('message', (data) => {
  const envelope = JSON.parse(data.toString());
  expect(envelope.protocol).toBe('adp/0.2');
  expect(envelope.sig).toBeDefined();
});
```

### TC-032：断线重连

模拟断线：
```typescript
ws.close();
await waitForEvent(ws, 'close');

// 重连应该自动进行
await waitForEvent(ws, 'open');
```

---

## 9. 互操作性测试

### 测试环境

```
┌──────────────┐     WebSocket      ┌──────────────┐
│  TypeScript  │◄──────────────────►│   Python     │
│  Implementor │                    │  Implementor  │
└──────────────┘                    └──────────────┘
```

### IT-001：TypeScript → Python ping

1. TypeScript Agent 发送 `adp:ping`
2. Python Agent 接收并返回响应
3. TypeScript Agent 验证响应签名
4. **验收：** 双方完成成功的 ping-pong

### IT-002：Python → TypeScript capability.query

1. Python Agent 发送 `adp:capability.query`
2. TypeScript Agent 返回 Manifest
3. Python Agent 验证签名并解析 Manifest
4. **验收：** Manifest 格式正确，所有字段可解析

### IT-003：跨语言密钥轮换

1. TypeScript Agent 发送 `adp:key.rotate`
2. Python Agent 验证轮换签名
3. Python Agent 更新 trust store
4. **验收：** 新身份可用于后续通信

---

## 10. 测试报告模板

实现应生成如下格式的测试报告：

```json
{
  "implementation": "My ADP Agent",
  "version": "1.0.0",
  "protocol_version": "adp/0.2",
  "timestamp": "2026-05-20T10:00:00.000Z",
  "results": {
    "canonical_json": {
      "passed": 6,
      "failed": 0,
      "total": 6
    },
    "base64url": {
      "passed": 4,
      "failed": 0,
      "total": 4
    },
    "signatures": {
      "passed": 3,
      "failed": 0,
      "total": 3
    },
    "agent_id": {
      "passed": 6,
      "failed": 0,
      "total": 6
    },
    "message_verification": {
      "passed": 7,
      "failed": 0,
      "total": 7
    },
    "capabilities": {
      "passed": 3,
      "failed": 0,
      "total": 3
    },
    "task_state_machine": {
      "passed": 4,
      "failed": 0,
      "total": 4
    },
    "websocket": {
      "passed": 3,
      "failed": 0,
      "total": 3
    }
  },
  "summary": {
    "passed": 36,
    "failed": 0,
    "total": 36,
    "compliance": "FULLY_COMPLIANT"
  }
}
```

---

## 11. 合规性分级

| 级别 | 要求 | 徽章 |
|------|------|------|
| **完全合规** | 通过全部 MUST 测试用例 | ✅ Fully Compliant |
| **基本合规** | 通过核心测试（签名、验证、必选能力） | ⚠️ Mostly Compliant |
| **部分合规** | 仅实现部分功能 | ⚠️ Partially Compliant |

> 互操作性测试是合规性评估的重要参考。声称合规的实现应当能够与其他合规实现成功通信。
