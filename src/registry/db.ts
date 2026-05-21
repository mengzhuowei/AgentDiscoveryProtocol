import mysql from 'mysql2/promise';
import { RegistryConfig } from './config';

export class Database {
  private pool: mysql.Pool;

  constructor(config: RegistryConfig) {
    this.pool = mysql.createPool({
      host: config.mysql.host,
      port: config.mysql.port,
      user: config.mysql.user,
      password: config.mysql.password,
      database: config.mysql.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });
  }

  async initialize(): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      console.log('Connected to MySQL database');
      await this.createTables(connection);
    } finally {
      connection.release();
    }
  }

  private async createTables(connection: mysql.PoolConnection): Promise<void> {
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS agents (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        initial_id VARCHAR(512) NOT NULL UNIQUE,
        current_agent_id VARCHAR(512) NOT NULL,
        namespace VARCHAR(256) NOT NULL,
        manifest JSON NOT NULL,
        routes JSON NOT NULL,
        last_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_namespace (namespace),
        INDEX idx_last_seen (last_seen),
        INDEX idx_expires_at (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS rotation_chain (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        initial_id VARCHAR(512) NOT NULL,
        sequence INT NOT NULL,
        from_agent_id VARCHAR(512) NOT NULL,
        to_agent_id VARCHAR(512) NOT NULL,
        envelope JSON NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (initial_id) REFERENCES agents(initial_id) ON DELETE CASCADE,
        INDEX idx_sequence (sequence),
        UNIQUE KEY uk_initial_sequence (initial_id, sequence)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS agent_capabilities (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        initial_id VARCHAR(512) NOT NULL,
        capability VARCHAR(255) NOT NULL,
        FOREIGN KEY (initial_id) REFERENCES agents(initial_id) ON DELETE CASCADE,
        INDEX idx_capability (capability),
        UNIQUE KEY uk_initial_capability (initial_id, capability)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS tokens (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        token_hash VARCHAR(128) NOT NULL UNIQUE,
        namespace VARCHAR(256),
        capabilities JSON,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        INDEX idx_namespace (namespace)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC
    `);

    console.log('Tables initialized');
  }

  getConnection(): Promise<mysql.PoolConnection> {
    return this.pool.getConnection();
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
