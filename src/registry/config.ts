import * as fs from 'fs';
import * as path from 'path';

export interface RegistryConfig {
  port: number;
  host: string;
  mysql: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
  };
  token: {
    enabled: boolean;
    tokens?: Record<string, { namespace?: string; capabilities?: string[] }>;
  };
  registration: {
    ttlSeconds: number;
    maxAgents: number;
  };
  cors: {
    enabled: boolean;
    origins: string[];
  };
}

function loadConfigFile(): Partial<RegistryConfig> {
  const configPath = process.env.ADP_CONFIG ||
    path.join(process.cwd(), 'config.json');

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

const fileConfig = loadConfigFile();

export const defaultConfig: RegistryConfig = {
  port: fileConfig.port ?? parseInt(process.env.REGISTRY_PORT || '3000'),
  host: fileConfig.host ?? process.env.REGISTRY_HOST ?? '0.0.0.0',
  mysql: {
    host: fileConfig.mysql?.host ?? process.env.MYSQL_HOST ?? '127.0.0.1',
    port: fileConfig.mysql?.port ?? parseInt(process.env.MYSQL_PORT || '3306'),
    user: fileConfig.mysql?.user ?? process.env.MYSQL_USER ?? 'root',
    password: fileConfig.mysql?.password ?? process.env.MYSQL_PASSWORD ?? '',
    database: fileConfig.mysql?.database ?? process.env.MYSQL_DATABASE ?? 'adp_registry'
  },
  redis: {
    host: fileConfig.redis?.host ?? process.env.REDIS_HOST ?? '127.0.0.1',
    port: fileConfig.redis?.port ?? parseInt(process.env.REDIS_PORT || '6379'),
    password: fileConfig.redis?.password ?? process.env.REDIS_PASSWORD
  },
  token: {
    enabled: fileConfig.token?.enabled ?? (process.env.TOKEN_ENABLED === 'true'),
    tokens: fileConfig.token?.tokens ?? {}
  },
  registration: {
    ttlSeconds: fileConfig.registration?.ttlSeconds ?? parseInt(process.env.REGISTRATION_TTL || '86400'),
    maxAgents: fileConfig.registration?.maxAgents ?? parseInt(process.env.MAX_AGENTS || '10000')
  },
  cors: {
    enabled: fileConfig.cors?.enabled ?? (process.env.CORS_ENABLED === 'true'),
    origins: fileConfig.cors?.origins ?? (process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : ['*'])
  }
};
