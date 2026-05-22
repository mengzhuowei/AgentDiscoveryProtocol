# 代码审查 - 剩余待处理问题

本文档记录了 2026-05-22 两次全面代码审查后，暂时未修复的问题。这些问题需要进一步设计或架构调整。

---

## 🔴 High 优先级问题

### 1. TOFU 自动信任缺少用户确认

**问题描述**：
`MessageVerifier` 在首次遇到未知 Agent 时会自动 pin 其公钥，没有任何用户介入或确认机制。

**文件**：[`src/envelope.ts`](file:///Users/a12.11/Documents/code/AgentDiscoveryProtocol/src/envelope.ts#L58-L63)

**当前代码**：
```typescript
// TRUST_CONFLICT 检测
if (this.trustStore.has(envelope.from)) {
  if (this.trustStore.hasConflict(envelope.from, publicKey)) {
    return { valid: false, error: 'TRUST_CONFLICT', ... };
  }
} else {
  this.trustStore.pin(envelope.from, publicKey, 'tofu');
  this.trustStore.save().catch(err => {
    console.warn('[ADP MessageVerifier] Failed to save trust store:', err);
  });
}
```

**建议修复方案**：
1. 在 `GatewayOptions` 中添加 `onUntrustedPeer?: (agentId: string, publicKey: Uint8Array) => Promise<boolean>` 回调
2. 在 `MessageVerifier` 构造时传入此回调
3. 首次遇到未知 Agent 时调用回调，等待用户确认后再 pin

**影响范围**：
- Gateway 构造函数
- MessageVerifier 类
- 可能需要更新 MCP Server 集成

---

## 🟡 Medium 优先级问题

### 2. Relay 消息自定义回复无法发送

**问题描述**：
当收到 Relay 消息并调用自定义能力 handler 时，handler 尝试发送回复时，由于没有真实的 WebSocket 连接，回复消息无法发送回发送者。

**文件**：[`src/gateway.ts`](file:///Users/a12.11/Documents/code/AgentDiscoveryProtocol/src/gateway.ts#L435-L463)

**当前代码**：
```typescript
private async handleMessageDirect(envelope: Envelope): Promise<void> {
  // ...
  default: {
    const handler = this.customActions.get(envelope.action);
    if (handler) {
      // 创建一个安全的 pseudo-websocket，至少记录发送尝试
      const fakeWs = {
        send: (data: string) => {
          console.warn('[ADP Gateway] Attempted to send reply via Relay, but no relay channel available. Message:', data);
        }
      } as unknown as WebSocket;
      await handler(fakeWs, envelope);
    }
  }
}
```

**建议修复方案**：
1. `Gateway` 需要保持对 `RelayClient` 的引用
2. 在调用 `handler` 时，传入一个知道如何通过 Relay 回复的包装对象
3. 当 handler 调用 `send` 时，包装对象会通过 RelayClient 发送回复

**影响范围**：
- Gateway 构造函数需要接受 RelayClient 引用
- processRelayMessage 需要跟踪原始消息的 sender
- RelayClient 需要支持回复发送

---

### 3. Registry 搜索存在 N+1 查询问题

**问题描述**：
`search` 接口对每个搜索结果的 Agent 执行一次单独的 rotation_chain 查询。

**文件**：[`src/registry/service.ts`](file:///Users/a12.11/Documents/code/AgentDiscoveryProtocol/src/registry/service.ts#L656-L664)（需要根据实际位置调整）

**建议修复方案**：
使用 JOIN 或批量查询，一次性获取所有 rotation_chains。

**示例 SQL**：
```sql
SELECT r.* 
FROM rotation_chain r
WHERE r.initial_id IN (?, ?, ?, ...)
ORDER BY r.initial_id, r.sequence ASC
```

---

## ⚪ Info 优先级问题

### 4. 测试覆盖不足

**当前状态**：
- ✅ crypto - 4 个测试
- ✅ agent-id - 4 个测试
- ✅ canonical - 6 个测试
- ❌ envelope / MessageVerifier - 无测试
- ❌ Gateway - 无测试
- ❌ Discovery - 无测试
- ❌ Relay - 无测试
- ❌ Registry (所有模块) - 无测试
- ❌ TaskManager - 无测试
- ❌ TrustStore - 无测试
- ❌ KeyRotation - 无测试
- ❌ MCP Server - 无测试

**建议**：
优先添加以下测试：
1. MessageVerifier TOFU 逻辑测试
2. Gateway 消息处理和签名验证集成测试
3. Registry 注册/心跳/搜索功能集成测试

---

## 📋 问题优先级总结

| 优先级 | 数量 | 问题 |
|--------|------|------|
| 🔴 High | 1 | TOFU 缺少用户确认 |
| 🟡 Medium | 2 | Relay 回复问题、Registry N+1 查询 |
| ⚪ Info | 1 | 测试覆盖 |

---

## 📝 记录历史

- 2026-05-22：首次创建，记录两次完整代码审查后的剩余问题

