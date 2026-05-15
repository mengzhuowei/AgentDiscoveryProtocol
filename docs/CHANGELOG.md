# ADP 协议演进记录

**更新：** 2026-05-15

---

本文档记录 ADP 协议各版本的变更，帮助已有实现的开发者了解需要注意的破坏性变更。

## v0.1（草案）

**日期：** 2026-05-15

初始草案，包含以下核心定义：

- Agent ID 格式：`adp://user@domain[/agent_name]`
- Envelope 消息格式（request / response / push / error / ack）
- Manifest 能力声明（`adp:` 标准命名空间 / `custom:` 自定义命名空间）
- Registry API：`/adp/v1/register`、`/refresh`、`/unregister`、`/resolve`、`/search`
- 传输层：WebSocket 直连 + Relay 中继 + HTTP 回调
- Gateway 架构规范
- 标准能力：`adp:ping`、`adp:capability.query`、`adp:info.share`、`adp:task.delegate`（推荐）、`adp:task.status`（推荐）、`adp:task.cancel`（推荐）
- SDK 设计草案

---

## 版本号规范

ADP 协议使用语义化版本号：`MAJOR.MINOR.PATCH`

| 版本位 | 变更类型 | 示例 |
|---|---|---|
| MAJOR | 破坏性变更 | Envelope 结构不兼容、API 路径变更 |
| MINOR | 新增功能，向后兼容 | 新增标准能力、新增端点 |
| PATCH | 勘误、澄清 | 文档修正、示例更新 |
