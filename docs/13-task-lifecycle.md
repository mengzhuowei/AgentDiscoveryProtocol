# 13 - 任务生命周期与状态机

**更新：** 2026-05-15
**状态：** 草案（v0.1）

---

## 概述

本文档定义 `adp:task.delegate` 委派任务的完整生命周期、状态转换规则、异常恢复机制和回调约定。阅读本文档前请先了解 [07-capabilities.md](07-capabilities.md) 中的任务基础定义。

---

## 状态机

### 状态转换图

```
                    ┌──────────┐
          ┌────────►│ accepted │
          │         └────┬─────┘
          │              │
          │         ┌────▼──────┐
          │         │ in_progress│◄──────────┐
          │         └────┬──┬───┘           │
          │              │  │               │
          │      ┌───────┘  └──────┐        │
          │      ▼                 ▼        │
          │ ┌─────────┐     ┌──────────┐    │
          │ │completed│     │  failed  │    │
          │ └─────────┘     └──────────┘    │
          │                                 │
          │         ┌──────────┐            │
          └─────────┤ cancelled │◄───────────┘
                    └──────────┘
```

### 状态定义

| 状态 | 说明 | 持有方职责 |
|---|---|---|
| `accepted` | 任务已被接收，等待开始执行 | 执行方必须在此状态后返回 `estimated_completion` |
| `in_progress` | 任务正在执行 | 执行方应定期发送进度更新 |
| `completed` | 任务成功完成 | 执行方附带 `result` 数据 |
| `failed` | 任务执行失败 | 执行方附带 `error` 信息，包含失败原因 |
| `cancelled` | 任务被取消 | 发起方或执行方均可触发 |

### 状态转换规则

| 起始状态 | 允许的目标状态 | 触发方式 |
|---|---|---|
| (新建) | `accepted` | 执行方接受 task.delegate 请求 |
| (新建) | `failed` | 执行方拒绝任务（如 `TOO_BUSY`、`UNKNOWN_TASK_TYPE`） |
| `accepted` | `in_progress` | 执行方开始处理 |
| `accepted` | `cancelled` | 发起方发送 `task.cancel` |
| `in_progress` | `completed` | 执行方成功完成 |
| `in_progress` | `failed` | 执行方遇到不可恢复错误 |
| `in_progress` | `cancelled` | 发起方发送 `task.cancel`，或执行方检测到超时 |
| `completed` | (终态) | 不可再转换 |
| `failed` | (终态) | 不可再转换 |
| `cancelled` | (终态) | 不可再转换 |

---

## 任务超时与心跳

### 任务 TTL

发起方在 `task.delegate` 请求中设置 `timeout`（秒）。执行方如果在超时内未完成，应当：

1. 将任务标记为 `failed`，错误码 `TIMEOUT`
2. 向发起方发送任务失败通知

### 心跳机制

长时间运行的任务（预估 > 30 秒），执行方应定期发送心跳，告知发起方自己仍在处理。

**心跳消息格式：**

```json
{
  "action": "adp:task.status",
  "params": {
    "task_id": "task_xyz789",
    "status": "in_progress",
    "progress": 45,
    "message": "正在处理第 12/30 项..."
  }
}
```

**心跳间隔建议：**

| 预估执行时长 | 心跳间隔 |
|---|---|
| < 1 分钟 | 不强制心跳 |
| 1 ~ 10 分钟 | 每 30 秒 |
| 10 分钟 ~ 1 小时 | 每 2 分钟 |
| > 1 小时 | 每 5 分钟 |

---

## 异常恢复

### 执行方宕机

Gateway 通过以下方式检测 Agent 宕机：

- **进程监控：** Gateway 监控 Agent 进程（Agent 作为 Gateway 的子进程，或通过定期健康检查）。Agent 进程无响应超过 30 秒视为宕机
- **连接断开：** 如果 Agent 通过 Unix Socket 或 localhost 与 Gateway 通信，连接断开即视为宕机

宕机后，当前排队的任务按以下策略处理。任务状态应持久化到 Gateway 的本地存储（文件或 SQLite），确保 Gateway 自身重启后也能恢复：

| 策略 | 说明 | 适用场景 |
|---|---|---|
| **fail-fast** | 立即标记所有运行中任务为 `failed` | 任务不可重试（如发送通知） |
| **requeue** | 任务重新排队，下次启动后重新执行 | 幂等任务（如数据处理） |
| **timeout** | 不做处理，等待发起方超时自行处理 | 默认策略 |

执行方应在 Manifest 的 `agent_info` 中声明自己的任务恢复策略：

```json
{
  "agent_info": {
    "task_recovery": "requeue"
  }
}
```

### 发起方超时

发起方等待超时后，可以：

1. 发送 `task.cancel` 尝试取消
2. 发送 `task.status` 查询任务是否仍在执行
3. 将任务标记为本地 `failed`

---

## 回调约定

### 任务进度回调

执行方通过 `adp:task.status` 推送或响应来传递进度。进度字段约定：

```json
{
  "task_id": "task_xyz789",
  "status": "in_progress",
  "progress": 60,
  "message": "正在分析第 3 个文件..."
}
```

- `progress`：0-100 的整数百分比，`-1` 表示进度不可量化
- `message`：人类可读的进度描述，不超过 256 字符

### 任务完成回调

任务完成后，如果发起方在委托时指定了 `callback.target`，执行方应向该目标发送完成通知：

```json
{
  "adp_version": "0.1",
  "message_id": "msg_notify_xyz",
  "thread_id": "thr_a1b2c3d4",
  "from": "adp://bob@home.io/claude",
  "to": "adp://alice@example.com/hermes",
  "type": "push",
  "timestamp": "2026-05-15T18:00:00Z",
  "body": {
    "action": "adp:info.share",
    "params": {
      "content_type": "application/json",
      "summary": "任务 task_xyz789 已完成",
      "content": {
        "event": "task.completed",
        "task_id": "task_xyz789",
        "result": { /* 任务结果 */ }
      }
    }
  }
}
```

---

## 任务幂等性

### idempotency_key

发起方可为每个任务分配 `idempotency_key`。执行方检测到重复 key 时：

- 如果任务已完成 → 直接返回之前的结果
- 如果任务正在执行 → 返回当前状态
- 如果任务尚未开始 → 去重，不重复创建

执行方应保留 `idempotency_key` 至少 **24 小时** 或任务完成后的 **1 小时**（取较大值）。

### 重试语义

- 发起方在超时后重试同一个 `task_id`，应携带相同的 `idempotency_key`
- 任务级重试由实现自行决定，消息级重试策略见 [03-message.md](03-message.md)

---

## 任务优先级（非强制）

执行方可选择性实现优先级队列：

| 优先级 | 说明 |
|---|---|
| `high` | 插队执行，适用于紧急任务 |
| `normal` | 默认优先级，FIFO |
| `low` | 后台任务，资源空闲时执行 |

优先级通过 `task.delegate` 的 `priority` 字段传递。不实现优先级队列的执行方可忽略此字段。
