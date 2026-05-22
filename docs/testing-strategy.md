# 测试策略与覆盖提升方案

本文档分析当前测试覆盖不足的原因，并提供详细的解决方案。

---

## 📊 当前测试现状

### 现有测试覆盖
| 模块 | 测试 | 状态 |
|------|------|------|
| crypto | 4 tests | ✅ |
| agent-id | 4 tests | ✅ |
| canonical | 6 tests | ✅ |
| envelope/MessageVerifier | ❌ 无 | ❌ |
| Gateway | ❌ 无 | ❌ |
| Discovery | ❌ 无 | ❌ |
| Relay | ❌ 无 | ❌ |
| Registry | ❌ 无 | ❌ |
| TaskManager | ❌ 无 | ❌ |
| TrustStore | ❌ 无 | ❌ |
| KeyRotation | ❌ 无 | ❌ |
| MCP Server | ❌ 无 | ❌ |

### 混乱的测试文件
项目根目录存在多个非 Jest 的测试脚本：
- integration-test.ts
- relay-test.ts
- mdns-test.ts
- capability-test.ts
- task-test.ts
- contacts-test.ts
- test-registry.ts
- test-auth.ts

---

## 🎯 测试覆盖不足的原因

### 原因 1：测试组织混乱
**问题**：
- Jest 只检测 `**/*.test.ts` 文件
- 根目录的独立脚本未被覆盖
- 没有统一的测试目录结构

**示例**：
- Jest 只看到 `src/crypto.test.ts` 等
- `relay-test.ts` 虽然存在，但不被测试框架识别

### 原因 2：缺少测试基础设施
**缺失**：
- 测试覆盖率报告工具
- Mock 库（如 `jest-mock`, `ts-mockito`）
- 测试数据库支持
- 集成测试框架

### 原因 3：可测试性设计不足
**问题**：
- 类直接实例化依赖，没有依赖注入
- 与外部服务紧耦合（mDNS、MySQL、Redis）
- 没有清晰的接口边界

**示例**：
- [`Gateway`](file:///Users/a12.11/Documents/code/AgentDiscoveryProtocol/src/gateway.ts#L80-L94) 直接内部创建 TrustStore
- [`Discovery`](file:///Users/a12.11/Documents/code/AgentDiscoveryProtocol/src/discovery.ts#L52-L63) 直接创建 mDNS 实例

### 原因 4：缺少测试策略文档
没有明确的单元/集成/端到端测试规划

---

## 🛠️ 解决方案

### 方案 1：安装测试工具包

**新增依赖**：
```bash
npm install --save-dev @types/jest jest ts-jest
# 可选工具
npm install --save-dev @faker-js/faker ts-mockito jest-mock-extended
npm install --save-dev istanbul-lib-coverage nyc
```

### 方案 2：重新组织测试文件

**目标结构**：
```
src/
  *.ts
  *.test.ts
tests/
  unit/
    *.test.ts
  integration/
    *.test.ts
  e2e/
    *.test.ts
  fixtures/
    *.ts
  mocks/
    *.ts
```

### 方案 3：添加测试覆盖率报告

更新 [`jest.config.js`](file:///Users/a12.11/Documents/code/AgentDiscoveryProtocol/jest.config.js)：
```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts', '**/tests/**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.test.ts'],
  coverageReporters: ['text', 'lcov', 'html'],
  coverageDirectory: 'coverage',
  coveragePathIgnorePatterns: ['/node_modules/'],
  setupFilesAfterEnv: ['./tests/setup.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  rootDir: '.'
};
```

添加 package.json scripts：
```json
{
  "scripts": {
    "test": "jest",
    "test:coverage": "jest --coverage",
    "test:watch": "jest --watch",
    "test:unit": "jest tests/unit",
    "test:integration": "jest tests/integration",
    "test:e2e": "jest tests/e2e"
  }
}
```

### 方案 4：提升可测试性 - 依赖注入

重构示例 - [`Gateway`](file:///Users/a12.11/Documents/code/AgentDiscoveryProtocol/src/gateway.ts)：

**当前**：
```typescript
constructor(options: GatewayOptions) {
  this.trustStore = new TrustStore(); // 直接创建
  this.verifier = new MessageVerifier(this.trustStore);
  // ...
}
```

**重构后**：
```typescript
constructor(options: GatewayOptions & {
  trustStore?: TrustStore;
  verifier?: MessageVerifier;
}) {
  this.trustStore = options.trustStore || new TrustStore();
  this.verifier = options.verifier || new MessageVerifier(this.trustStore);
  // ...
}
```

### 方案 5：优先级 - 先加核心模块测试

#### 优先级 1：MessageVerifier 测试
新建 `src/envelope.test.ts`：
```typescript
import { MessageVerifier, buildEnvelope, generateMessageId } from './envelope';
import { TrustStore } from './trust-store';
import { signEnvelope } from './crypto';
import { canonicalize } from './canonical';
import { generateKeyPair, buildAgentId } from '.';

describe('MessageVerifier', () => {
  let aliceKeys: KeyPair;
  let bobKeys: KeyPair;
  let aliceId: string;
  let bobId: string;
  let trustStore: TrustStore;
  let verifier: MessageVerifier;

  beforeEach(() => {
    aliceKeys = generateKeyPair();
    bobKeys = generateKeyPair();
    aliceId = buildAgentId(aliceKeys.publicKey, 'local', 'alice');
    bobId = buildAgentId(bobKeys.publicKey, 'local', 'bob');
    trustStore = new TrustStore(':memory:');
    verifier = new MessageVerifier(trustStore);
  });

  test('首次消息 - TOFU 自动 pin', async () => {
    // 测试 TOFU 逻辑
  });

  test('签名验证失败', async () => {
    // 测试签名验证
  });

  test('信任冲突检测', async () => {
    // 测试 TRUST_CONFLICT
  });
});
```

#### 优先级 2：Gateway 集成测试
新建 `tests/integration/gateway.test.ts`

#### 优先级 3：Registry 集成测试
需要测试容器支持

---

## 📝 实施路线图

### 阶段 1：基础设施（本周）
- [ ] 安装测试依赖
- [ ] 重构 jest.config.js
- [ ] 添加 coverage 支持
- [ ] 创建 tests 目录结构

### 阶段 2：核心单元测试（1-2 周）
- [ ] MessageVerifier 测试
- [ ] TrustStore 测试
- [ ] KeyRotation 测试
- [ ] TaskManager 测试

### 阶段 3：集成测试（2-3 周）
- [ ] Gateway 集成测试
- [ ] Discovery 集成测试（mock mDNS）
- [ ] Registry 集成测试（测试容器）

### 阶段 4：重构可测试性（持续）
- [ ] 依赖注入重构
- [ ] 定义清晰接口
- [ ] 添加集成测试

---

## 📊 预期结果

| 指标 | 当前 | 目标（3 个月） |
|------|------|---------------|
| 测试覆盖模块 | 3 | 12 |
| 总测试数 | 14 | 50+ |
| 行覆盖率 | ~15% | 70%+ |
| 集成测试数 | 0 | 10+ |

---

## 📝 快速开始指南

### 运行当前测试
```bash
npm test
# 查看覆盖率（先配置）
npm run test:coverage
```

### 添加新测试
1. 在模块旁创建 `*.test.ts` 文件
2. 使用 `describe` 和 `it`
3. 使用 `jest.mock` 进行依赖模拟

---

## 📚 相关文档
- [官方 Jest 文档](https://jestjs.io/)
- [ts-jest 文档](https://kulshekhar.github.io/ts-jest/)

