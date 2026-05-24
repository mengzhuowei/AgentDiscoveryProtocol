# ADP 使用文档

## 快速开始

```bash
npm install
npm start agent1          # 终端 1
npm start agent2          # 终端 2，自动分配可用端口
```

## 启动方式

```bash
# Agent（端口自动扫描，被占用则 +1）
npm start agent1
npm start agent1 -- --port=9900                # 指定端口
npm start agent1 -- --name=gateway-1           # 自定义名称
npm start agent1 -- --relay=ws://host:3900     # 连接 Relay
npm start agent1 -- --registry=http://host:3800

# 服务器
npm run relay              # WebSocket Relay，默认 ws://0.0.0.0:3900
npm run registry           # REST Registry，需要 MySQL + Redis

# MCP Server（供 OpenClaw 调用）
npm run mcp agent1
```

> `--` 后的参数会被传给脚本而非 npm。

## 配置

优先级：命令行 > 环境变量 > `~/.adp/config.json`

### config.json

```json
{
  "registry": { "url": "http://192.168.6.174:3800", "token": "xxx" },
  "relay": { "url": "ws://relay.example.com:3900" },
  "name": "my-agent",
  "namespace": "my-team"
}
```

### 环境变量

| 变量 | 说明 |
|------|------|
| `ADP_REGISTRY` | Registry 地址 |
| `ADP_REGISTRY_TOKEN` | 认证 Token |
| `ADP_RELAY` | Relay 地址 |
| `ADP_NAME` | Agent 名称 |
| `ADP_NAMESPACE` | 命名空间 |
| `ADP_DISPLAY` | 显示名称 |
| `ADP_NO_MDNS` | 设为 `1` 禁用 mDNS |

### `~/.adp/` 目录

```
~/.adp/
├── config.json
├── contacts.json
├── trust_store.json
└── keys/
    └── agent1.key      # Ed25519 私钥
```

## Agent Name

Agent ID 格式为 `adp://<公钥>@<namespace>/<name>`，`name` 默认为 `peer-{N}`，可通过 `--name=`、`ADP_NAME` 或 `config.json` 中的 `name` 字段自定义。变更 Name 不影响密钥。

## 网络架构

| 服务 | 端口 | 说明 |
|------|:---:|------|
| Agent | 9900+ | 自动扫描可用端口 |
| Relay | 9700 | WebSocket 中继 |
| Registry | 3800 | 注册中心（可配） |

Agent 通过 mDNS / Relay / Registry 三种方式发现彼此。

## Registry API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| POST | `/v1/agents` | 注册 Agent |
| POST | `/v1/agents/:id/heartbeat` | 心跳续期 |
| PUT | `/v1/agents/:id` | 更新 Manifest/Routes |
| GET | `/v1/agents/:id` | 获取 Agent |
| GET | `/v1/agents` | 搜索 Agent（支持 `namespace`/`capability`） |
| DELETE | `/v1/agents/:id` | 删除注册 |

## MCP Server（OpenClaw 集成）

```bash
# 安装
npm install -g adp-agent

# 启动
adp agent1
adp agent1 --relay=ws://192.168.6.174:3900
```

### OpenClaw 配置 (`~/.openclaw/openclaw.json`)

```json
{
  "mcp": {
    "adp": { "command": "adp", "args": ["agent1"] }
  }
}
```

### Tools

| Tool | 说明 |
|------|------|
| `adp_list_peers` | 列出所有发现的 Agent |
| `adp_ping` | Ping 指定 Agent |
| `adp_query_capabilities` | 查询 Agent Manifest |
| `adp_get_agent_info` | 获取自身信息 |

### Resources

| Resource URI | 说明 |
|------|------|
| `adp://peers` | 已发现 Agent 列表 |
| `adp://manifest` | 自身 Manifest |
| `adp://peers/{agentId}/manifest` | 指定 Agent 的 Manifest |

## 测试

```bash
npm run test:integration   # 签名/Manifest 交换（无需外部服务）
npm run test:registry      # Registry CRUD（需 MySQL + Redis）
npm run test:auth          # Token 认证（需 token.enabled）
npm run test:capability    # 自定义能力
npm run test:task          # 任务生命周期
npm run test:contacts      # 静态联系人 + pinned trust
```

## 构建

```bash
npm run build              # 输出到 dist/
```
