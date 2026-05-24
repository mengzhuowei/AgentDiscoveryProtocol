# ADP Docker Setup

This directory contains Docker configuration files for running Agent Discovery Protocol (ADP) services.

## Quick Start

```bash
# 1. Copy the example environment file
cd docker
cp .env.example .env

# 2. Edit the .env file with your configuration
# Update passwords and settings as needed

# 3. Start the services
docker-compose up -d

# 4. Check service status
docker-compose ps

# 5. View logs
docker-compose logs -f
```

## Services

| Service | Image | Port | Description |
|---------|-------|------|-------------|
| mysql | mysql:8.0 | 3306 | Registry database |
| redis | redis:7-alpine | 6379 | Cache layer |
| registry | Built from Dockerfile | 3000 | ADP Registry API |

## Configuration

See [.env.example](.env.example) for all available configuration options.

## Stopping Services

```bash
# Stop services
docker-compose down

# Stop and remove volumes
docker-compose down -v
```

## Building Locally

```bash
docker-compose build
docker-compose up -d
```
