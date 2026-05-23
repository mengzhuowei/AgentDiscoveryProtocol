import { WebSocket } from 'ws';
import { Manifest, Capability, Route } from './manifest';
import { ActionHandler } from './gateway';

export interface IGateway {
  registerCapability(cap: string | Capability, handler: ActionHandler): void;
  getManifest(): Manifest;
  getAgentId(): string;
  processRelayMessage(rawEnvelope: unknown): Promise<void>;
  close(): void;
}

export interface ITrustStore {
  has(agentId: string): boolean;
  pin(agentId: string, publicKey: Uint8Array, origin: 'tofu' | 'pinned' | 'rotation', verifiedBy?: string[]): boolean;
  getPublicKey(agentId: string): Uint8Array | null;
  updateLastVerified(agentId: string): void;
  addRotation(oldAgentId: string, newAgentId: string, publicKey: Uint8Array): void;
  hasConflict(agentId: string, publicKey: Uint8Array): boolean;
  load(): Promise<void>;
  save(): Promise<void>;
}

export interface IDiscovery {
  start(): void;
  getPeers(): Array<{ agentId: string; host: string; port: number; protocol: string; lastSeen: number }>;
  shutdown(): void;
}

export interface IRelayClient {
  connect(): Promise<void>;
  send(to: string, envelope: unknown): void;
  isConnected(): boolean;
  close(): void;
}

export interface IRegistryClient {
  register(): Promise<{ initial_id: string; status: string; expires_at: string }>;
  updateManifest(manifest: Manifest, routes: Route[]): Promise<void>;
  deregister(): Promise<void>;
  isRegistered(): boolean;
  close(): void;
}
