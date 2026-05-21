# ADP 使用文档

## 快速开始

```bash
# 安装
npm install

# 最基本的两个 Agent 通信
npm start agent1          # 终端 1：Agent 1（9900 端口，监听连接）
npm start agent2          # 终端 2：Agent 2（9901 端口，自动连接 Agent 1）
```

---

## 所有启动命令

```bash
# Agent（默认 mDNS 发现 + 直连）
npm start agent1                  # ws://0.0.0.0:9900
npm start agent2                  # ws://localhost:9901，连 agent1
npm start agent3                  # ws://localhost:9902，连 agent1

# 纯直连模式（禁用 mDNS）
npm start agent1 -- --direct      # agent1 绑定 localhost
npm start agent2 -- --direct      # agent2 连 agent1

# Agent + Relay（先连 Relay 再注册）
npm start agent1 -- --relay=wss://relay.example.com:9800

# Agent + Registry
npm start agent1 -- --registry=http://192.168.6.174:3800

# Agent + Relay + Registry
npm start agent1 -- --registry=http://192.168.6.174:3800 --relay=wss://relay.example.com:9800

# Relay 服务器
npm run relay

# Registry 服务器（需要 MySQL + Redis）
npm run registry
```

> **注意**：`--direct`、`--registry=`、`--relay=` 这些参数前必须加 `--` 分隔符，否则会被 npm 自身拦截。

---

## 持久化配置

Agent 端创建 `~/.adp/config.json` 后，启动时无需命令行参数：

```json
{
  "registry": {
    "url": "http://192.168.6.174:3800",
    "token": "your-secret-token"
  },
  "relay": {
    "url": "wss://relay.example.com:9800"
  },
  "namespace": "my-team",
  "display_name": "My Agent"
}
```

```bash
# 配置后直接启动
npm start agent1
```

优先级：命令行 > 环境变量 > config.json

---

## 环境变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `ADP_REGISTRY` | Registry 地址 | `http://192.168.6.174:3800` |
| `ADP_REGISTRY_TOKEN` | Registry 认证 Token | `your-secret` |
| `ADP_RELAY` | Relay 地址 | `wss://relay.example.com` |
| `ADP_NAMESPACE` | 命名空间 | `my-team` |
| `ADP_DISPLAY` | 显示名称 | `Gateway-A` |
| `ADP_NO_MDNS` | 禁用 mDNS | `1` |

```bash
# 示例
$env:ADP_REGISTRY="http://192.168.6.174:3800"; npm start agent1
```

---

## Registry 服务器

### 部署前准备

```sql
-- 先删除旧表（如果存在）
DROP TABLE IF EXISTS agent_capabilities, rotation_chain, tokens, agents;
```

### 配置文件 `config.json`

```json
{
  "port": 3800,
  "host": "0.0.0.0",
  "mysql": {
    "host": "127.0.0.1",
    "port": 3306,
    "user": "root",
    "password": "your-password",
    "database": "adp_registry"
  },
  "redis": {
    "host": "127.0.0.1",
    "port": 6379
  },
  "registration": {
    "ttlSeconds": 86400,
    "maxAgents": 10000
  },
  "token": {
    "enabled": false,
    "tokens": {}
  },
  "cors": {
    "enabled": false,
    "origins": ["*"]
  }
}
```

### 启动

```bash
npm run registry
```

Registry 启动后自动创建所有表，无需手动执行 SQL。

### 测试

```bash
ADP_REGISTRY=http://192.168.6.174:3800 npm run test:registry
ADP_REGISTRY=http://192.168.6.174:3800 npm run test:auth       # 需要 token.enabled=true
```

---

## Registry API

| 方法 | 路径 | 说明 | 需要认证 |
|------|------|------|:---:|
| GET | `/health` | 健康检查 | |
| POST | `/v1/agents` | 注册 Agent | 可选 |
| POST | `/v1/agents/:id/heartbeat` | 轻量心跳续期 | 可选 |
| PUT | `/v1/agents/:id` | 更新 Manifest/Routes/轮换 | 可选 |
| GET | `/v1/agents/:id` | 获取单个 Agent | |
| GET | `/v1/agents?namespace=x&capability=y` | 搜索 Agent | |
| DELETE | `/v1/agents/:id` | 删除注册 | 可选 |

---

## Relay 服务器

```bash
npm run relay      # 默认 ws://0.0.0.0:9800
```

---

## `~/.adp/` 目录结构

```
~/.adp/
├── config.json         # Agent 持久化配置（registry/relay/namespace）
├── contacts.json       # 静态联系人（直连路由 + pinned trust）
├── trust_store.json    # 信任存储（TOFU / pinned / rotation）
└── keys/
    └── agent1.key      # Ed25519 私钥
```

---

## 测试命令

```bash
npm run test:integration   # 签名/验签/Manifest 交换（不需要外部服务）
npm run test:capability    # 自定义能力测试
npm run test:task          # adp:task.* 生命周期测试
npm run test:contacts      # 静态联系人 + pinned trust 测试
npm run test:registry      # Registry CRUD（需要 MySQL + Redis）
npm run test:auth          # Token + 签名认证（需要 token.enabled）
```

---

## 常用操作

```bash
# 构建
npm run build

# TypeScript 构建监听
tsc --watch

# 编译输出目录
dist/
```

---

## 网络端口

| 服务 | 默认端口 |
|------|:---:|
| Agent1 | 9900 |
| Agent2 | 9901 |
| Agent3 | 9902 |
| Relay | 9800 |
| Registry | 3000 (config.json 可配) |
