# Docker 部署指南

本文档介绍如何使用 Docker 部署 ADP 服务。

## 📋 目录

- [快速开始](#快速开始)
- [服务说明](#服务说明)
- [环境变量配置](#环境变量配置)
- [网络架构](#网络架构)
- [持久化存储](#持久化存储)
- [生产部署建议](#生产部署建议)
- [故障排查](#故障排查)

## 快速开始

### 1. 准备环境

确保已安装 Docker 和 Docker Compose：

```bash
docker --version
docker-compose --version
```

### 2. 配置环境变量

```bash
cd docker
cp .env.example .env
```

编辑 `.env` 文件，修改敏感配置：

```env
# MySQL 配置
MYSQL_ROOT_PASSWORD=your_strong_root_password
MYSQL_PASSWORD=your_strong_user_password

# Registry 配置
REGISTRY_PORT=3000
```

### 3. 启动服务

```bash
# 启动所有服务
docker-compose up -d

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f
```

### 4. 验证部署

访问健康检查端点：

```bash
curl http://localhost:3000/health
```

应该返回：
```json
{"status":"ok"}
```

## 服务说明

| Service | Image | Port | Description |
|---------|-------|------|-------------|
| **mysql** | mysql:8.0 | 3306 | Registry 数据库 |
| **redis** | redis:7-alpine | 6379 | 缓存层 |
| **registry** | Build from Dockerfile | 3000 | ADP Registry API |

### MySQL

- 版本：MySQL 8.0
- 数据持久化：`mysql_data` volume
- 健康检查：每 10 秒执行一次 `mysqladmin ping`
- 初始化：自动执行 `schema.sql`

### Redis

- 版本：Redis 7 (Alpine)
- 数据持久化：`redis_data` volume
- 健康检查：每 10 秒执行一次 `redis-cli ping`

### Registry

- 构建：多阶段构建，先编译 TypeScript，再运行生产镜像
- 端口：默认 3000
- 依赖：等待 MySQL 和 Redis 健康检查通过后启动

## 环境变量配置

完整的环境变量说明：

### Registry 服务

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `REGISTRY_PORT` | 3000 | Registry 服务端口 |
| `REGISTRY_HOST` | 0.0.0.0 | Registry 监听地址 |

### MySQL

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MYSQL_ROOT_PASSWORD` | adp_secret | MySQL root 密码 |
| `MYSQL_DATABASE` | adp_registry | 数据库名 |
| `MYSQL_USER` | adp | 数据库用户 |
| `MYSQL_PASSWORD` | adp_secret | 数据库密码 |
| `MYSQL_PORT` | 3306 | MySQL 端口 |
| `MYSQL_HOST` | mysql | MySQL 主机名（Docker 内部） |

### Redis

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `REDIS_HOST` | redis | Redis 主机名（Docker 内部） |
| `REDIS_PORT` | 6379 | Redis 端口 |
| `REDIS_PASSWORD` | (空) | Redis 密码 |

### 其他配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `REGISTRATION_TTL` | 86400 | 注册过期时间（秒） |
| `MAX_AGENTS` | 10000 | 最大 Agent 数量 |
| `TOKEN_ENABLED` | false | 是否启用 Token 认证 |
| `CORS_ENABLED` | false | 是否启用 CORS |
| `CORS_ORIGINS` | * | CORS 允许的源 |

## 网络架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         Docker Network (adp_network)            │
│                                                                  │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐   │
│  │   registry   │─────▶│    mysql     │      │    redis     │   │
│  │   :3000      │      │    :3306     │      │    :6379     │   │
│  └──────┬───────┘      └──────────────┘      └──────────────┘   │
│         │                                                         │
└─────────┼─────────────────────────────────────────────────────────┘
          │
          │ 3000
          ▼
    外部访问
```

## 持久化存储

Docker Compose 配置了两个数据卷：

| Volume | 说明 |
|--------|------|
| `mysql_data` | MySQL 数据目录 |
| `redis_data` | Redis 数据目录 |

### 备份数据

```bash
# 备份 MySQL
docker exec adp_mysql mysqldump -u root -p adp_registry > backup.sql

# 备份 Redis
docker exec adp_redis redis-cli BGSAVE
docker cp adp_redis:/data/dump.rdb ./redis-backup.rdb
```

### 恢复数据

```bash
# 恢复 MySQL
docker exec -i adp_mysql mysql -u root -p adp_registry < backup.sql

# 恢复 Redis
docker cp ./redis-backup.rdb adp_redis:/data/dump.rdb
docker restart adp_redis
```

## 生产部署建议

### 1. 安全配置

修改 `.env` 文件中的敏感信息：

```env
MYSQL_ROOT_PASSWORD=strong-password-here
MYSQL_PASSWORD=another-strong-password
TOKEN_ENABLED=true
```

### 2. 资源限制

编辑 `docker-compose.yml` 添加资源限制：

```yaml
services:
  mysql:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '1'
          memory: 1G
```

### 3. HTTPS 配置

为 Registry 添加 HTTPS：

```yaml
registry:
  environment:
    - TLS_CERT=/certs/cert.pem
    - TLS_KEY=/certs/key.pem
  volumes:
    - ./certs:/certs:ro
```

### 4. 日志配置

配置日志轮转：

```yaml
services:
  registry:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

### 5. 监控

添加健康监控：

```yaml
registry:
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
    interval: 30s
    timeout: 10s
    retries: 3
```

## 常用命令

### 查看服务状态

```bash
docker-compose ps
```

### 查看日志

```bash
# 查看所有服务日志
docker-compose logs -f

# 查看特定服务日志
docker-compose logs -f registry
docker-compose logs -f mysql
```

### 停止服务

```bash
# 停止但保留数据
docker-compose down

# 停止并删除数据（谨慎使用）
docker-compose down -v
```

### 重新构建

```bash
# 重新构建并启动
docker-compose up -d --build

# 只重新构建特定服务
docker-compose build registry
docker-compose up -d
```

### 进入容器

```bash
# 进入 MySQL
docker exec -it adp_mysql mysql -u root -p

# 进入 Redis
docker exec -it adp_redis redis-cli

# 进入 Registry
docker exec -it adp_registry sh
```

## 故障排查

### Registry 无法启动

检查 MySQL 和 Redis 是否就绪：

```bash
docker-compose logs mysql
docker-compose logs redis
```

### 数据库连接失败

检查环境变量配置，确认 MySQL 容器健康：

```bash
docker-compose ps
docker-compose logs mysql
```

### 端口被占用

修改 `.env` 中的端口配置：

```env
REGISTRY_PORT=3001
MYSQL_PORT=3307
REDIS_PORT=6380
```

### 数据丢失

检查 volumes 是否正确挂载：

```bash
docker volume ls
docker volume inspect adp_mysql_data
```

## 扩展部署

### 多节点部署

使用 Docker Swarm 或 Kubernetes 进行多节点部署：

```bash
# Docker Swarm
docker swarm init
docker stack deploy -c docker-compose.yml adp
```

### Agent 容器化

参考 Registry 的 Dockerfile，为你的 Agent 创建 Docker 镜像：

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
CMD ["node", "dist/your-agent.js"]
```
