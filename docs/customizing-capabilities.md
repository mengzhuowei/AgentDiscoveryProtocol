# 自定义 Agent 能力

**协议版本：** `adp/0.2`

本文档补充 [`01-identity.md`](01-identity.md) 中关于 `Manifest.capabilities` **数据格式**之外的另一面：**运行时代码如何声明、注入和扩展能力**。如果你只想了解能力长什么样、字段含义，请直接阅读 `01-identity.md` 的「自定义能力」一节。

## 1. 默认能力集：`STANDARD_CAPABILITIES`

参考实现导出了一个开箱即用的能力常量 [`STANDARD_CAPABILITIES`](file:///e:/code/AgentDiscoveryProtocol/src/index.ts#L614-L625)：

```typescript
export const STANDARD_CAPABILITIES = [
  'adp:ping',              // 健康检查
  'adp:capability.query',  // 查询对端能力声明
  'adp:info',              // 描述查询
  'adp:key.rotate',        // 密钥轮换
  'adp:task.create',       // 任务创建
  'adp:task.get',          // 查询任务
  'adp:task.list',         // 列出任务
  'adp:task.cancel',       // 取消任务
  'custom:echo',           // 回显（用于调试）
  'custom:chat',           // 简单聊天
];
```

`start.ts` / `chat.ts` 启动的 Agent 默认就会携带这套能力。**这是协议层的最低要求**（`adp:ping` 和 `adp:capability.query` 必须存在，参见 [`implementation-checklist.md`](implementation-checklist.md)），其余项是参考实现提供的常用能力。

需要自己实现时，**至少**保留 `adp:ping` 和 `adp:capability.query`，否则对端无法发现和探测你。

## 2. 三种声明方式

| 方式 | 时机 | 适用场景 |
|---|---|---|
| 构造 `Gateway` 时传 `capabilities` 字段 | 启动时 | 能力集静态可知，写在代码里最直观 |
| `gateway.registerCapability(name, handler)` | 运行时 | 能力按需注入、条件启用、动态加载 |
| `AdpMcpServer` 配置文件 | 启动时 | 走 MCP 协议的 Agent，能力通过 `mcp-config.json` 注入 |

### 2.1 构造时传入

```typescript
import { Gateway, STANDARD_CAPABILITIES, Capability } from 'adp-agent';
import { loadOrCreateIdentity } from 'adp-agent';

const { identity } = loadOrCreateIdentity('myapp', 'video-agent', 'VideoAgent');

const customCaps: (string | Capability)[] = [
  ...STANDARD_CAPABILITIES,
  {
    capability: 'custom:video.generate',
    description: 'Generate video from prompt',
    input_modes: ['application/json'],
    output_modes: ['video/mp4'],
    async: true,
    preferredMode: 'webhook',
    input_schema: {
      type: 'object',
      properties: { prompt: { type: 'string' }, duration: { type: 'integer' } },
      required: ['prompt'],
    },
  },
];

const gateway = new Gateway({
  port: 9900,
  host: '0.0.0.0',
  secretKey: identity.secretKey,
  agentId: identity.agentId,
  displayName: 'Video Generator',
  capabilities: customCaps,
  customHandlers: {
    'custom:video.generate': async (ws, envelope) => { /* ... */ },
  },
});
```

完整字段说明见 [`01-identity.md` §自定义能力](file:///e:/code/AgentDiscoveryProtocol/docs/01-identity.md#L455-L501)。

### 2.2 运行时注册：`registerCapability()`

[`Gateway.registerCapability()`](file:///e:/code/AgentDiscoveryProtocol/src/gateway.ts#L769) 用于在 Gateway 已经创建之后**追加**能力 + 处理器，常用于插件式加载或条件启用：

```typescript
import { Gateway, loadOrCreateIdentity, STANDARD_CAPABILITIES } from 'adp-agent';
import { createEchoHandler, createChatHandler } from 'adp-agent/capabilities';

const gateway = new Gateway({
  port: 9900,
  secretKey: identity.secretKey,
  agentId: identity.agentId,
  displayName: 'Demo',
  capabilities: STANDARD_CAPABILITIES,
});

// 注册内置能力对应的处理器
gateway.registerCapability('custom:echo', createEchoHandler(identity.agentId, identity.secretKey));
gateway.registerCapability('custom:chat', createChatHandler(identity.agentId, identity.secretKey));

// 注册自定义能力
gateway.registerCapability('custom:image.upscale', async (ws, envelope) => {
  const { image_url, scale = 2 } = envelope.params as { image_url: string; scale?: number };
  // ...业务逻辑
  ws.send(JSON.stringify(/* 签名后的回复 envelope */));
});
```

> **注意：**`registerCapability()` 会同时注册处理器**并**将能力追加到 Manifest 的 `capabilities` 数组中。对端通过 `adp:capability.query` 可以看到该能力。

### 2.3 MCP 启动：配置文件注入

通过 [`AdpMcpServer`](file:///e:/code/AgentDiscoveryProtocol/src/mcp-server.ts) 启动时，能力从构造配置中读取，缺省回退到 `STANDARD_CAPABILITIES`：

```typescript
this.config.capabilities || STANDARD_CAPABILITIES;
```

可在 [`mcp-config.example.json`](file:///e:/code/AgentDiscoveryProtocol/mcp-config.example.json) 中指定，参考实现读取后会覆盖默认值。

## 3. 修改默认 `start.ts` 支持外部配置

仓库内 [`start.ts`](file:///e:/code/AgentDiscoveryProtocol/start.ts) 默认硬编码使用 `STANDARD_CAPABILITIES`，且 `.adp/config.json` 不读取 `capabilities` 字段。下面给出两种最小改法，按需选用。

### 3.1 扩展 `.adp/config.json`

`.adp/config.json` 的查找路径（参考 [`loadAgentConfig()`](file:///e:/code/AgentDiscoveryProtocol/start.ts#L25-L42)）：

- `process.cwd()/.adp/config.json`
- `~/.adp/config.json`

在配置文件中加入 `capabilities` 字段：

```json
{
  "namespace": "home.io",
  "display_name": "LivingRoomAgent",
  "capabilities": [
    "adp:ping",
    "adp:capability.query",
    "adp:info",
    "custom:light.toggle",
    {
      "capability": "custom:music.play",
      "description": "播放音乐",
      "input_modes": ["application/json"],
      "async": true
    }
  ]
}
```

修改 `start.ts`：

```typescript
// 1. 扩展 AgentConfig
interface AgentConfig {
  registry?: { url?: string; token?: string };
  relay?: { url?: string };
  namespace?: string;
  display_name?: string;
  name?: string;
  capabilities?: (string | Capability)[];
}

// 2. 在 new Gateway() 处使用
const gateway = new Gateway({
  port: finalPort,
  host: gatewayHost,
  secretKey: identity.secretKey,
  agentId: identity.agentId,
  displayName,
  capabilities: agentConfig.capabilities ?? STANDARD_CAPABILITIES,
  // ...
});
```

> 启动逻辑不会**自动**校验配置里的每个能力都有对应处理器，调用前需要自行 `registerCapability()` 或在 `customHandlers` 中提供。

### 3.2 新增 `--capabilities=` CLI 参数

仿照 [`start.ts:59-90`](file:///e:/code/AgentDiscoveryProtocol/start.ts#L59-L90) 的参数解析风格，在 `main()` 顶部加入：

```typescript
const capArg = args.find(a => a.startsWith('--capabilities='));
const extraCaps = capArg
  ? capArg.split('=').slice(1).join('=').split(',').map(s => s.trim()).filter(Boolean)
  : [];

// 合并：配置文件中的能力 + 命令行追加
const capabilities = [
  ...(agentConfig.capabilities ?? STANDARD_CAPABILITIES),
  ...extraCaps,
];
```

调用方式：

```bash
npm start -- --capabilities=custom:foo,custom:bar
```

字符串形式最简单。如需带 schema 的对象形式，建议走配置文件（3.1）。

## 4. 内置处理器速查

[`src/capabilities.ts`](file:///e:/code/AgentDiscoveryProtocol/src/capabilities.ts) 提供两个开箱即用的 `ActionHandler` 工厂：

```typescript
import { createEchoHandler, createChatHandler } from 'adp-agent/capabilities';

// custom:echo — 原样回传 params
gateway.registerCapability('custom:echo', createEchoHandler(agentId, secretKey));

// custom:chat — 文本聊天，可选 onMessage 回调接收消息
gateway.registerCapability('custom:chat', createChatHandler(agentId, secretKey, (from, text) => {
  console.log(`[${from}] ${text}`);
}));
```

它们与 `STANDARD_CAPABILITIES` 中声明的 `custom:echo` / `custom:chat` 是配套的——能力名在 Manifest 中声明，处理逻辑通过 `registerCapability` 注入。

## 5. 注意事项

- **必填下限：** 任何 Manifest 必须包含 `adp:ping` 和 `adp:capability.query`，否则对端无法做基础探测，视为不合规 Agent。
- **声明与实现一致：** Manifest 中列出的能力**必须**有对应处理器，否则收到请求会返回 `UNKNOWN_ACTION`。反过来，处理器存在但未在 Manifest 声明的能力，对端 `adp:capability.query` 看不到，无法被发现。
- **异步与 `preferredMode`：** 长时间任务应在 `Capability` 对象中标记 `async: true` 并选择 `preferredMode`，详见 [`best-practices.md` §异步任务处理](file:///e:/code/AgentDiscoveryProtocol/docs/best-practices.md#L214-L260)。
- **密钥轮换能力 `adp:key.rotate`：** 若未实现该能力，请不要把它放进 `STANDARD_CAPABILITIES` 列表的拷贝里，否则对端调用将失败。

## 6. 相关文档

- [`01-identity.md` §自定义能力](file:///e:/code/AgentDiscoveryProtocol/docs/01-identity.md#L455-L501) — 字段定义、数据格式
- [`implementation-checklist.md`](file:///e:/code/AgentDiscoveryProtocol/docs/implementation-checklist.md) — 必填字段与必含能力检查表
- [`best-practices.md` §异步任务处理](file:///e:/code/AgentDiscoveryProtocol/docs/best-practices.md#L214-L260) — `async` / `preferredMode` 用法
- [`README.md` §Custom Capability Handler](file:///e:/code/AgentDiscoveryProtocol/README.md#L318-L369) — 自定义能力 + `customHandlers` 示例
- [`src/manifest.ts`](file:///e:/code/AgentDiscoveryProtocol/src/manifest.ts) — Manifest / Capability / Route 类型定义
- [`src/gateway.ts` §registerCapability](file:///e:/code/AgentDiscoveryProtocol/src/gateway.ts#L769) — 运行时注册 API
