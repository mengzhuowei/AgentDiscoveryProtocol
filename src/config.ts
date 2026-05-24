import { Capability, Route } from './manifest';

export interface RetryConfig {
  maxAttempts: number;
  backoffMs: number;
}

export interface WebhookConfig {
  enabled: boolean;
  url: string;
  secret: string;
  timeout?: number;
  retry?: RetryConfig;
}

export interface CommunicationConfig {
  mode: 'websocket' | 'webhook' | 'hybrid';
  webhook?: WebhookConfig;
}

export interface AgentConfig {
  agentId: string;
  displayName: string;
  capabilities: (string | Capability)[];
  routes?: Route[];
  communication?: CommunicationConfig;
  description?: string;
}

export interface GatewayConfig extends AgentConfig {
  port: number;
  host?: string;
  secretKey: Uint8Array;
  tls?: { cert: string; key: string };
  skipVerification?: boolean;
  tofuEnabled?: boolean;
}
