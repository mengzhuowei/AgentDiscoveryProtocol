export { generateKeyPair, generateKeyPairFromSeed, sign, verify, encodeBase64URL, decodeBase64URL, signEnvelope } from './crypto';
export { canonicalize, testVectors } from './canonical';
export { parseAgentId, buildAgentId, extractPublicKey, extractVisualCode } from './agent-id';
export { Envelope, MessageVerifier, VerifierOptions, generateMessageId, buildEnvelope, MESSAGE_SIZE_LIMIT } from './envelope';
export { TrustStore } from './trust-store';
export { Manifest, Capability, Route, createManifest, hasCapability, getCapability } from './manifest';
export { Gateway, GatewayOptions, connectToAgent, ActionHandler } from './gateway';
export { TaskManager, Task, TaskStatus, CreateTaskParams, GetTaskResult } from './task-manager';
export { loadOrCreateIdentity, loadIdentity, Identity } from './key-store';
export { Relay, RelayOptions, RelayClient, RelayClientCallbacks } from './relay';
export { Discovery, DiscoveredPeer, DiscoveryCallbacks, getSharedMdns, destroySharedMdns } from './discovery';
export { createEchoHandler, createChatHandler } from './capabilities';
export { rotateKeys, buildRegistryUpdate, buildKeyRotateMessage, KeyRotationResult, KeyRotationParams } from './key-rotation';
export { RegistryClient, RegistryClientOptions } from './registry/client';
export { ContactStore, ContactEntry, ContactsData } from './contacts';
export { AdpMcpServer, AdpMcpConfig } from './mcp-server';
export { setLogger, getLogger, Logger, LogLevel } from './logger';
export { findAvailablePort, findAvailablePortSequential, isPortAvailable } from './net-utils';
export { CommunicationConfig, WebhookConfig, RetryConfig, AgentConfig, GatewayConfig } from './config';
export { WebhookClient, WebhookEvent, WebhookPayload, TaskResult } from './webhook-client';

export const VERSION = '0.2.0';

export const STANDARD_CAPABILITIES = [
  'adp:ping',
  'adp:capability.query',
  'adp:info',
  'adp:key.rotate',
  'adp:task.create',
  'adp:task.get',
  'adp:task.list',
  'adp:task.cancel',
  'custom:echo',
  'custom:chat',
];
