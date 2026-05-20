export { generateKeyPair, generateKeyPairFromSeed, sign, verify, encodeBase64URL, decodeBase64URL, signEnvelope } from './crypto';
export { canonicalize, testVectors } from './canonical';
export { parseAgentId, buildAgentId, extractPublicKey, extractVisualCode } from './agent-id';
export { Envelope, MessageVerifier, generateMessageId, buildEnvelope } from './envelope';
export { TrustStore } from './trust-store';
export { Manifest, Capability, Route, createManifest, hasCapability, getCapability } from './manifest';
export { Gateway, GatewayOptions, connectToAgent } from './gateway';
export { TaskManager, Task, TaskStatus, CreateTaskParams, GetTaskResult } from './task-manager';
export { loadOrCreateIdentity, loadIdentity, Identity } from './key-store';
export { Relay, RelayOptions, RelayClient, RelayClientCallbacks } from './relay';
export { Discovery, DiscoveredPeer, DiscoveryCallbacks, getSharedMdns } from './discovery';

export const VERSION = '0.2.0';

export const PROTOCOL_VERSION = 'adp/0.2';

export const TIMESTAMP_TOLERANCE_MS = 300_000;

export const MESSAGE_SIZE_LIMIT = 1024 * 1024;

export const HEARTBEAT_INTERVALS = {
  LAN: 30_000,
  RELAY: 15_000,
  IoT: 60_000,
};

export const STANDARD_CAPABILITIES = [
  'adp:ping',
  'adp:capability.query',
  'adp:info',
  'adp:key.rotate',
  'adp:task.create',
  'adp:task.get',
  'adp:task.list',
  'adp:task.cancel',
];

export const ERROR_CODES = {
  UNKNOWN_ACTION: 'UNKNOWN_ACTION',
  CAPABILITY_NOT_FOUND: 'CAPABILITY_NOT_FOUND',
  INVALID_PARAMS: 'INVALID_PARAMS',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  AGENT_NOT_FOUND: 'AGENT_NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  TOO_BUSY: 'TOO_BUSY',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  TRUST_CONFLICT: 'TRUST_CONFLICT',
  UNSUPPORTED_PROTOCOL: 'UNSUPPORTED_PROTOCOL',
};
