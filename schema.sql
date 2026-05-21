-- Agent Discovery Protocol Registry Database Schema
-- Version: 0.2

CREATE DATABASE IF NOT EXISTS adp_registry CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE adp_registry;

-- Agents table: stores initial_id and current state
CREATE TABLE IF NOT EXISTS agents (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    initial_id VARCHAR(1024) NOT NULL UNIQUE COMMENT '首次注册时的 Agent ID，稳定 URL 标识',
    current_agent_id VARCHAR(1024) NOT NULL COMMENT '当前活跃的 Agent ID',
    namespace VARCHAR(256) GENERATED ALWAYS AS (SUBSTRING_INDEX(SUBSTRING_INDEX(initial_id, '@', -1), '/', 1)) STORED COMMENT '从 initial_id 提取的 namespace',
    manifest JSON NOT NULL COMMENT '缓存的完整 Manifest',
    routes JSON NOT NULL COMMENT '路由数组',
    last_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL COMMENT '注册过期时间',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_initial_id (initial_id),
    INDEX idx_namespace (namespace),
    INDEX idx_last_seen (last_seen),
    INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rotation chain table: stores key rotation history
CREATE TABLE IF NOT EXISTS rotation_chain (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    initial_id VARCHAR(1024) NOT NULL COMMENT '关联的 initial_id',
    sequence INT NOT NULL COMMENT '轮换顺序，从 0 开始',
    from_agent_id VARCHAR(1024) NOT NULL COMMENT '上一跳 Agent ID',
    to_agent_id VARCHAR(1024) NOT NULL COMMENT '下一跳 Agent ID',
    envelope JSON NOT NULL COMMENT '完整的 adp:key.rotate Envelope',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (initial_id) REFERENCES agents(initial_id) ON DELETE CASCADE,
    INDEX idx_initial_id (initial_id),
    INDEX idx_sequence (sequence),
    UNIQUE KEY uk_initial_sequence (initial_id, sequence)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tokens table: optional authentication tokens
CREATE TABLE IF NOT EXISTS tokens (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    token_hash VARCHAR(512) NOT NULL UNIQUE COMMENT 'token 哈希值',
    namespace VARCHAR(256) COMMENT '可访问的 namespace，NULL 表示全权限',
    capabilities JSON COMMENT '权限列表',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    INDEX idx_token_hash (token_hash),
    INDEX idx_namespace (namespace)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Agent capabilities index: for search by capability
CREATE TABLE IF NOT EXISTS agent_capabilities (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    initial_id VARCHAR(1024) NOT NULL COMMENT '关联的 initial_id',
    capability VARCHAR(512) NOT NULL COMMENT '能力名称',
    FOREIGN KEY (initial_id) REFERENCES agents(initial_id) ON DELETE CASCADE,
    INDEX idx_initial_id (initial_id),
    INDEX idx_capability (capability),
    UNIQUE KEY uk_initial_capability (initial_id, capability)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

