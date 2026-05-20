# 部署指南

**协议版本：** `adp/0.2`

本指南涵盖 ADP 组件的部署配置，包括 Gateway、Registry 和 Relay。

---

## 组件概览

```
┌─────────────────────────────────────────────────────────┐
│                    ADP 网络拓扑                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   ┌─────────┐         ┌─────────┐                      │
│   │ Agent A │◄──────►│ Gateway │◄──────► mDNS          │
│   └─────────┘         │  (WS)   │                      │
│                       └────┬────┘                      │
│                            │                            │
│          ┌─────────────────┼─────────────────┐         │
│          │                 │                 │         │
│          ▼                 ▼                 ▼         │
│    ┌───────────┐    ┌───────────┐    ┌───────────┐    │
│    │  Registry │    │   Relay   │    │  直连    │    │
│    │  (HTTP)   │    │   (WS)    │    │  (LAN)   │    │
│    └───────────┘    └───────────┘    └───────────┘    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 1. Gateway 部署

### 1.1 基础配置

```json
// ~/.adp/config.json
{
  "agent_id": "adp://mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB@home.io/claude",
  "gateway": {
    "host": "0.0.0.0",
    "port": 9800,
    "path": "/adp",
    "tls": false
  },
  "discovery": {
    "mdns": {
      "enabled": true,
      "service_type": "_adp._tcp"
    }
  }
}
```

### 1.2 公开 Gateway（WSS）

生产环境应使用 WSS：

```json
{
  "gateway": {
    "host": "0.0.0.0",
    "port": 443,
    "path": "/adp",
    "tls": {
      "cert": "/path/to/cert.pem",
      "key": "/path/to/key.pem"
    }
  }
}
```

### 1.3 高可用配置

```json
{
  "gateway": {
    "host": "0.0.0.0",
    "port": 9800
  },
  "discovery": {
    "mdns": {
      "enabled": true,
      "hostname": "claude.home.io"
    }
  },
  "registry": {
    "url": "https://registry.example.com",
    "initial_id": "adp://mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB@home.io/claude"
  },
  "relay": {
    "urls": [
      "wss://relay1.example.com:9800",
      "wss://relay2.example.com:9800"
    ]
  }
}
```

### 1.4 环境变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `ADP_AGENT_ID` | Agent ID | `adp://...@.../...` |
| `ADP_PORT` | 监听端口 | `9800` |
| `ADP_HOST` | 监听地址 | `0.0.0.0` |
| `ADP_REGISTRY` | Registry URL | `https://registry.example.com` |
| `ADP_RELAY` | Relay URL（逗号分隔） | `wss://relay1.example.com:9800` |
| `ADP_SECRET_KEY` | 私钥（Base64 编码） | `MCowBQYDK2Vw...` |
| `ADP_TLS_CERT` | TLS 证书路径 | `/etc/adp/cert.pem` |
| `ADP_TLS_KEY` | TLS 私钥路径 | `/etc/adp/key.pem` |

### 1.5 Docker 部署

```dockerfile
FROM node:22-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --production

COPY . .

EXPOSE 9800

CMD ["node", "src/index.js"]
```

```yaml
# docker-compose.yml
version: '3.8'

services:
  adp-agent:
    build: .
    ports:
      - "9800:9800"
    volumes:
      - ./config.json:/app/config.json:ro
      - ~/.adp/keys:/app/.adp/keys:ro
    environment:
      - ADP_SECRET_KEY_FILE=/app/.adp/keys/secret_key
    restart: unless-stopped
    network_mode: host
```

---

## 2. Registry 部署

### 2.1 最小配置

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 3000,
    "tls": {
      "enabled": true,
      "cert": "/etc/adp-registry/cert.pem",
      "key": "/etc/adp-registry/key.pem"
    }
  },
  "storage": {
    "type": "sqlite",
    "path": "/var/lib/adp-registry/registry.db"
  },
  "auth": {
    "token_required": false
  },
  "rate_limit": {
    "enabled": true,
    "max_requests_per_minute": 60
  }
}
```

### 2.2 带认证配置

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 3000,
    "tls": {
      "enabled": true
    }
  },
  "storage": {
    "type": "postgresql",
    "url": "postgresql://user:pass@localhost:5432/adp_registry"
  },
  "auth": {
    "token_required": true,
    "tokens": [
      {
        "token": "secret-token-for-agent-1",
        "namespace": "home.io",
        "capabilities": ["read", "write"]
      }
    ]
  },
  "agent_verification": {
    "enabled": true,
    "require_signature": true
  },
  "registration": {
    "max_per_agent": 5,
    "ttl_seconds": 86400
  }
}
```

### 2.3 Docker 部署

```dockerfile
FROM node:22-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 3000

CMD ["node", "src/registry.js"]
```

```yaml
version: '3.8'

services:
  registry:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./registry-config.json:/app/config.json:ro
      - registry-data:/var/lib/adp-registry
    environment:
      - NODE_ENV=production
    restart: unless-stopped

volumes:
  registry-data:
```

### 2.4 生产环境（Nginx 反向代理）

```nginx
server {
    listen 443 ssl;
    server_name registry.example.com;

    ssl_certificate /etc/nginx/certs/cert.pem;
    ssl_certificate_key /etc/nginx/certs/key.pem;

    client_max_body_size 1M;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## 3. Relay 部署

### 3.1 基础配置

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 9800,
    "path": "/adp/relay",
    "tls": {
      "enabled": true,
      "cert": "/etc/adp-relay/cert.pem",
      "key": "/etc/adp-relay/key.pem"
    }
  },
  "relay": {
    "max_connections": 10000,
    "message_buffer_size": 100,
    "offline_cache": {
      "enabled": true,
      "max_age_hours": 24,
      "max_messages_per_agent": 500
    }
  },
  "heartbeat": {
    "interval_seconds": 15,
    "timeout_seconds": 45
  }
}
```

### 3.2 高可用配置

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 9800
  },
  "relay": {
    "max_connections": 50000
  },
  "cluster": {
    "enabled": true,
    "nodes": [
      "wss://relay-1.example.com:9800",
      "wss://relay-2.example.com:9800"
    ]
  }
}
```

### 3.3 Docker 部署

```dockerfile
FROM node:22-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 9800

CMD ["node", "src/relay.js"]
```

```yaml
version: '3.8'

services:
  relay:
    build: .
    ports:
      - "9800:9800"
    volumes:
      - ./relay-config.json:/app/config.json:ro
      - relay-sessions:/var/lib/adp-relay
    environment:
      - NODE_ENV=production
    restart: unless-stopped
    ulimits:
      nofile:
        soft: 65536
        hard: 65536

volumes:
  relay-sessions:
```

### 3.4 性能调优

```bash
# 系统调优
echo 65536 > /proc/sys/net/core/somaxconn
echo 65536 > /proc/sys/net/ipv4/tcp_max_syn_backlog
sysctl -w net.ipv4.tcp_tw_reuse=1
sysctl -w net.ipv4.ip_local_port_range="1024 65535"
```

---

## 4. 安全配置

### 4.1 TLS 配置

```json
{
  "tls": {
    "enabled": true,
    "min_version": "1.2",
    "ciphers": [
      "TLS_AES_256_GCM_SHA384",
      "TLS_AES_128_GCM_SHA256",
      "TLS_CHACHA20_POLY1305_SHA256"
    ],
    "cert": "/path/to/fullchain.pem",
    "key": "/path/to/privkey.pem"
  }
}
```

### 4.2 防火墙规则

```bash
# 仅允许必要的端口
iptables -A INPUT -p tcp --dport 9800 -j ACCEPT  # Gateway/Relay
iptables -A INPUT -p tcp --dport 3000 -j ACCEPT  # Registry (如有)

# 阻止其他入站
iptables -A INPUT -j DROP

# mDNS (局域网发现)
iptables -A INPUT -p udp --dport 5353 -j ACCEPT
```

### 4.3 私钥安全

```bash
# 设置私钥文件权限
chmod 600 ~/.adp/keys/secret_key

# 可选：使用硬件密钥
# YubiKey PIV 插槽 9a
```

---

## 5. 监控与运维

### 5.1 建议的监控指标

| 组件 | 指标 | 说明 |
|------|------|------|
| Gateway | `connections_active` | 当前活跃连接数 |
| Gateway | `messages_received_total` | 收到消息总数 |
| Gateway | `messages_sent_total` | 发送消息总数 |
| Gateway | `signature_verification_failures` | 签名验证失败次数 |
| Registry | `registrations_total` | 注册总数 |
| Registry | `queries_total` | 查询总数 |
| Registry | `active_agents` | 在线 Agent 数 |
| Relay | `sessions_active` | 活跃会话数 |
| Relay | `messages_forwarded_total` | 转发消息总数 |

### 5.2 日志配置

```json
{
  "logging": {
    "level": "info",
    "format": "json",
    "outputs": [
      {
        "type": "stdout"
      },
      {
        "type": "file",
        "path": "/var/log/adp/agent.log",
        "max_size_mb": 100,
        "max_backups": 5
      }
    ]
  }
}
```

### 5.3 健康检查

Gateway 健康检查端点：

```
GET /health

Response:
{
  "status": "ok",
  "version": "1.0.0",
  "uptime": 3600,
  "connections": 5
}
```

Registry 健康检查：

```
GET /health

Response:
{
  "status": "ok",
  "database": "connected",
  "active_agents": 42
}
```

---

## 6. 故障排查

### 常见问题

| 问题 | 可能原因 | 解决方案 |
|------|----------|----------|
| 连接被拒绝 | 防火墙/端口 | 检查防火墙规则 |
| 签名验证失败 | 私钥不匹配 | 确认使用的是正确的私钥 |
| mDNS 发现失败 | 跨网段 | mDNS 仅限本地网络 |
| Registry 注册失败 | token 无效 | 检查 token 配置 |
| Relay 连接失败 | TLS 证书问题 | 确认证书有效 |

### 诊断命令

```bash
# 检查端口监听
netstat -tlnp | grep 9800

# 检查 TLS 配置
openssl s_client -connect relay.example.com:9800

# 测试 mDNS
avahi-browse -r _adp._tcp

# 检查日志
journalctl -u adp-agent -f
```
