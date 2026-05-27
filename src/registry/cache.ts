import { createClient, RedisClientType } from 'redis';
import { RegistryConfig } from './config';

export class Cache {
  private client: RedisClientType;

  constructor(config: RegistryConfig) {
    const options: any = {
      socket: {
        host: config.redis.host,
        port: config.redis.port
      }
    };
    if (config.redis.password) {
      options.password = config.redis.password;
    }
    this.client = createClient(options);
  }

  async initialize(): Promise<void> {
    this.client.on('error', (err) => console.error('Redis Client Error', err));
    await this.client.connect();
    console.log('Connected to Redis');
  }

  async getAgent(initialId: string): Promise<any | null> {
    const data = await this.client.get(`agent:${initialId}`);
    return data ? JSON.parse(data) : null;
  }

  async setAgent(initialId: string, data: any, ttlSeconds: number = 3600): Promise<void> {
    await this.client.setEx(`agent:${initialId}`, ttlSeconds, JSON.stringify(data));
  }

  async deleteAgent(initialId: string): Promise<void> {
    await this.client.del(`agent:${initialId}`);
  }

  async getRotationChain(initialId: string): Promise<any[] | null> {
    const data = await this.client.get(`rotation:${initialId}`);
    return data ? JSON.parse(data) : null;
  }

  async setRotationChain(initialId: string, chain: any[], ttlSeconds: number = 3600): Promise<void> {
    await this.client.setEx(`rotation:${initialId}`, ttlSeconds, JSON.stringify(chain));
  }

  async deleteRotationChain(initialId: string): Promise<void> {
    await this.client.del(`rotation:${initialId}`);
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}

