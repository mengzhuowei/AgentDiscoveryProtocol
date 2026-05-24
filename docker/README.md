# ADP Docker 部署

本目录包含用于运行 Agent Discovery Protocol (ADP) 服务的 Docker 配置文件。

## 快速开始

```bash
# 1. 复制示例环境变量文件
cd docker
cp .env.example .env

# 2. 编辑 .env 文件配置
# 根据需要更新密码和设置

# 3. 启动服务
docker-compose up -d

# 4. 检查服务状态
docker-compose ps

# 5. 查看日志
docker-compose logs -f
```

## 服务说明

| 服务 | 镜像 | 端口 | 说明 |
|------|------|------|------|
| mysql | mysql:8.0 | 3306 | Registry 数据库 |
| redis | redis:7-alpine | 6379 | 缓存层 |
| registry | 从 Dockerfile 构建 | 3000 | ADP Registry API |

## 配置

所有可用配置选项请参考 [.env.example](.env.example)。

## 停止服务

```bash
# 停止服务（保留数据）
docker-compose down

# 停止并删除数据（谨慎使用）
docker-compose down -v
```

## 本地构建

```bash
# 构建并启动
docker-compose build
docker-compose up -d
```

## 更多文档

详细部署指南请参考 [../docs/docker.md](../docs/docker.md)。
