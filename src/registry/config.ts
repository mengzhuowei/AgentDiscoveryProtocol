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

export const defaultConfig: RegistryConfig = {
  port: parseInt(process.env.REGISTRY_PORT || '3000'),
  host: process.env.REGISTRY_HOST || '0.0.0.0',
  mysql: {
    host: process.env.MYSQL_HOST || '192.168.6.174',
    port: parseInt(process.env.MYSQL_PORT || '3306'),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '123456',
    database: process.env.MYSQL_DATABASE || 'adp_registry'
  },
  redis: {
    host: process.env.REDIS_HOST || '192.168.6.174',
    port: parseInt(process.env.REDIS_PORT || '63790'),
    password: process.env.REDIS_PASSWORD
  },
  token: {
    enabled: process.env.TOKEN_ENABLED === 'true',
    tokens: {}
  },
  registration: {
    ttlSeconds: parseInt(process.env.REGISTRATION_TTL || '86400'), // 24 hours
    maxAgents: parseInt(process.env.MAX_AGENTS || '10000')
  },
  cors: {
    enabled: process.env.CORS_ENABLED === 'true',
    origins: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : ['*']
  }
};

