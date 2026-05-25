/**
 * Agent Discovery Protocol (ADP) - A decentralized protocol for discovering and
 * communicating with AI agents in a local network.
 *
 * This library provides cryptographic signing, agent identity management, message
 * envelopes, service discovery via mDNS, relay services, and registry integration.
 *
 * @module
 * @version 0.2.0
 */

/**
 * Cryptographic operations including key generation, signing, and verification
 * using Ed25519 (via TweetNaCl).
 *
 * @example
 * ```typescript
 * import { generateKeyPair, sign, verify, encodeBase64URL, decodeBase64URL } from 'agent-discovery-protocol';
 *
 * // Generate a new key pair
 * const keyPair = generateKeyPair();
 *
 * // Sign a message
 * const message = new TextEncoder().encode('Hello, ADP!');
 * const signature = sign(keyPair.secretKey, message);
 *
 * // Verify the signature
 * const isValid = verify(keyPair.publicKey, message, signature);
 * console.log('Signature valid:', isValid);
 * ```
 */
export { generateKeyPair, generateKeyPairFromSeed, sign, verify, encodeBase64URL, decodeBase64URL, signEnvelope } from './crypto';

/**
 * Canonicalization utilities for producing deterministic JSON representations
 * suitable for cryptographic signing.
 *
 * @example
 * ```typescript
 * import { canonicalize, testVectors } from 'agent-discovery-protocol';
 *
 * // Canonicalize an object (keys sorted alphabetically)
 * const obj = { b: 2, a: 1, c: null };
 * const canonical = canonicalize(obj);
 * // Result: '{"a":1,"b":2,"c":null}'
 *
 * // Get test vectors for verification
 * const vectors = testVectors();
 * ```
 */
export { canonicalize, testVectors } from './canonical';

/**
 * Agent ID parsing and construction utilities.
 *
 * Agent IDs follow the format: `adp://{publicKey}@{namespace}/{agentName}`
 * - publicKey: Base64URL-encoded 32-byte Ed25519 public key
 * - namespace: Lowercase alphanumeric with dots and hyphens
 * - agentName: 1-32 lowercase alphanumeric with underscores and hyphens
 *
 * @example
 * ```typescript
 * import { buildAgentId, parseAgentId, extractPublicKey, extractVisualCode } from 'agent-discovery-protocol';
 *
 * // Build an Agent ID from public key components
 * const agentId = buildAgentId(publicKey, 'local', 'my-agent');
 * // Result: 'adp://{base64url_publickey}@local/my-agent'
 *
 * // Parse an Agent ID
 * const parsed = parseAgentId(agentId);
 * console.log(parsed.namespace); // 'local'
 * console.log(parsed.agentName);  // 'my-agent'
 *
 * // Extract public key from Agent ID
 * const key = extractPublicKey(agentId);
 *
 * // Generate a visual code from public key
 * const visualCode = extractVisualCode(publicKey);
 * ```
 */
export { parseAgentId, buildAgentId, extractPublicKey, extractVisualCode } from './agent-id';

/**
 * Message envelope structure and verification utilities.
 *
 * Envelopes are the core message format in ADP, containing protocol metadata,
 * sender/recipient information, action type, parameters, and cryptographic signature.
 *
 * @example
 * ```typescript
 * import { Envelope, buildEnvelope, generateMessageId, MessageVerifier, VerifierOptions } from 'agent-discovery-protocol';
 *
 * // Generate a unique message ID
 * const msgId = generateMessageId();
 *
 * // Build an unsigned envelope
 * const envelope = buildEnvelope(
 *   'adp://sender@ns/name',
 *   'adp://receiver@ns/other',
 *   'adp:ping',
 *   { data: 'optional' }
 * );
 *
 * // Create a message verifier
 * const verifier = new MessageVerifier(trustStore, {
 *   tofuEnabled: true,
 *   timestampToleranceMs: 300000
 * });
 *
 * // Verify an incoming envelope
 * const result = await verifier.verify(envelope);
 * console.log('Valid:', result.valid);
 * ```
 */
export { Envelope, MessageVerifier, VerifierOptions, generateMessageId, buildEnvelope, MESSAGE_SIZE_LIMIT } from './envelope';

/**
 * Trust store for managing trusted agent public keys.
 *
 * Implements Trust-On-First-Use (TOFU) and key pinning with rotation support.
 *
 * @example
 * ```typescript
 * import { TrustStore } from 'agent-discovery-protocol';
 *
 * const trustStore = new TrustStore();
 * await trustStore.load();
 *
 * // Pin a trusted agent
 * trustStore.pin(agentId, publicKey, 'pinned');
 *
 * // Check if agent is trusted
 * const isTrusted = trustStore.has(agentId);
 *
 * // Get trusted public key (follows rotation chain)
 * const trustedKey = trustStore.getPublicKey(agentId);
 * ```
 */
export { TrustStore } from './trust-store';

/**
 * Agent manifest structure and capability management.
 *
 * Manifests describe an agent's identity, capabilities, and routes. They are
 * exchanged during capability queries and registration.
 *
 * @example
 * ```typescript
 * import { Manifest, Capability, Route, createManifest, hasCapability, getCapability } from 'agent-discovery-protocol';
 *
 * // Define capabilities
 * const capabilities: (string | Capability)[] = [
 *   'adp:ping',
 *   { capability: 'custom:chat', description: 'Chat capability', async: true }
 * ];
 *
 * // Define routes
 * const routes: Route[] = [
 *   { type: 'direct', address: '192.168.1.100:9000' }
 * ];
 *
 * // Create a manifest
 * const manifest = createManifest(agentId, 'My Agent', capabilities, routes, {
 *   description: 'A friendly ADP agent'
 * });
 *
 * // Check capabilities
 * if (hasCapability(manifest, 'adp:ping')) {
 *   console.log('Agent supports ping');
 * }
 *
 * const chatCap = getCapability(manifest, 'custom:chat');
 * console.log(chatCap?.description);
 * ```
 */
export { Manifest, Capability, Route, createManifest, hasCapability, getCapability } from './manifest';

/**
 * ADP Gateway - WebSocket server for agent communication.
 *
 * The Gateway handles incoming connections, message verification, routing,
 * and capability dispatching. It supports both direct WebSocket connections
 * and relay-based message passing.
 *
 * @example
 * ```typescript
 * import { Gateway, GatewayOptions, connectToAgent, ActionHandler } from 'agent-discovery-protocol';
 *
 * const gateway = new Gateway({
 *   port: 9000,
 *   secretKey,
 *   agentId,
 *   displayName: 'My Agent',
 *   capabilities: ['adp:ping', 'custom:echo'],
 *   customHandlers: {
 *     'custom:echo': async (ws, envelope) => {
 *       const reply = buildEnvelope(agentId, envelope.from, 'custom:echo', envelope.params);
 *       ws.send(JSON.stringify(signEnvelope(reply, secretKey, canonicalize)));
 *     }
 *   }
 * });
 *
 * // Connect to another agent
 * const ws = await connectToAgent(targetAgentId, '192.168.1.101:9000', agentId);
 * ```
 */
export { Gateway, GatewayOptions, connectToAgent, ActionHandler } from './gateway';

/**
 * Task management for tracking long-running operations.
 *
 * Supports creating, tracking, and retrieving task results with status updates.
 *
 * @example
 * ```typescript
 * import { TaskManager, Task, TaskStatus, CreateTaskParams, GetTaskResult } from 'agent-discovery-protocol';
 *
 * const taskManager = new TaskManager();
 *
 * // Create a task
 * const task = taskManager.create('custom:process', { input: 'data' });
 * console.log('Task ID:', task.taskId);
 *
 * // Update task status
 * taskManager.start(task.taskId);
 * taskManager.complete(task.taskId, { result: 'processed' });
 *
 * // List tasks
 * const { tasks, nextCursor } = taskManager.list({ status: 'COMPLETED', limit: 10 });
 * ```
 */
export { TaskManager, Task, TaskStatus, CreateTaskParams, GetTaskResult } from './task-manager';

/**
 * Identity key management - load or create persistent agent identities.
 *
 * Keys are stored securely in the file system with restricted permissions.
 *
 * @example
 * ```typescript
 * import { loadOrCreateIdentity, loadIdentity, Identity } from 'agent-discovery-protocol';
 *
 * // Load existing identity or create new one
 * const { identity, isNew } = loadOrCreateIdentity('local', 'my-agent', 'default');
 *
 * if (isNew) {
 *   console.log('New identity created!');
 * }
 *
 * console.log('Agent ID:', identity.agentId);
 * console.log('Public key length:', identity.publicKey.length);
 *
 * // Or just load existing identity (returns null if not found)
 * const existing = loadIdentity('local', 'my-agent', 'default');
 * if (!existing) {
 *   console.log('Identity not found');
 * }
 * ```
 */
export { loadOrCreateIdentity, loadIdentity, Identity } from './key-store';

/**
 * Relay server and client for agent-to-agent messaging when direct
 * connections are not possible.
 *
 * Supports offline message caching, session management, and automatic reconnection.
 *
 * @example
 * ```typescript
 * import { Relay, RelayClient, RelayOptions, RelayClientCallbacks } from 'agent-discovery-protocol';
 *
 * // Server: Create a relay server
 * const relay = new Relay({
 *   port: 9001,
 *   heartbeatIntervalMs: 15000,
 *   offlineMaxAgeMs: 86400000  // 24 hours
 * });
 *
 * // Client: Connect to relay
 * const relayClient = new RelayClient('ws://relay.example.com:9001', agentId, {
 *   onWelcome: (sessionId) => console.log('Connected:', sessionId),
 *   onMessage: (envelope) => handleMessage(envelope),
 *   onPeerUpdate: (type, peerId) => console.log('Peer update:', type, peerId)
 * }, { reconnect: true });
 *
 * await relayClient.connect();
 *
 * // Send message through relay
 * relayClient.send(targetAgentId, envelope);
 * ```
 */
export { Relay, RelayOptions, RelayClient, RelayClientCallbacks } from './relay';

/**
 * Service discovery via mDNS (multicast DNS).
 *
 * Automatically discovers ADP agents on the local network using the
 * _adp._tcp.local service type.
 *
 * @example
 * ```typescript
 * import { Discovery, DiscoveredPeer, DiscoveryCallbacks, getSharedMdns, destroySharedMdns } from 'agent-discovery-protocol';
 *
 * // Get shared mDNS instance (for multiple Discovery instances)
 * const mdns = getSharedMdns();
 *
 * const discovery = new Discovery(agentId, 9000, {
 *   onPeerDiscovered: (peer: DiscoveredPeer) => {
 *     console.log('Peer found:', peer.agentId);
 *     console.log('Address:', `${peer.host}:${peer.port}`);
 *   },
 *   onPeerLost: (peerAgentId) => {
 *     console.log('Peer lost:', peerAgentId);
 *   }
 * }, mdns);
 *
 * discovery.start();
 *
 * // Later, get all discovered peers
 * const peers = discovery.getPeers();
 *
 * // Cleanup when done
 * discovery.shutdown();
 * destroySharedMdns();
 * ```
 */
export { Discovery, DiscoveredPeer, DiscoveryCallbacks, getSharedMdns, destroySharedMdns } from './discovery';

/**
 * Built-in capability handlers for common operations.
 *
 * @example
 * ```typescript
 * import { createEchoHandler, createChatHandler } from 'agent-discovery-protocol';
 *
 * // Echo handler - echoes back the received parameters
 * const echoHandler = createEchoHandler(agentId, secretKey);
 *
 * // Chat handler - processes chat messages with optional callback
 * const chatHandler = createChatHandler(agentId, secretKey, (from, text) => {
 *   console.log(`Message from ${from}: ${text}`);
 * });
 *
 * // Register with gateway
 * gateway.registerCapability('custom:echo', echoHandler);
 * gateway.registerCapability('custom:chat', chatHandler);
 * ```
 */
export { createEchoHandler, createChatHandler } from './capabilities';

/**
 * Key rotation utilities for key management and registry updates.
 *
 * Supports secure key rotation with proof-of-rotation messages.
 *
 * @example
 * ```typescript
 * import { rotateKeys, buildRegistryUpdate, buildKeyRotateMessage, KeyRotationResult, KeyRotationParams } from 'agent-discovery-protocol';
 *
 * // Rotate to a new key pair
 * const result = rotateKeys({
 *   oldSecretKey,
 *   oldAgentId,
 *   displayName: 'My Agent',
 *   capabilities,
 *   routes,
 *   reason: 'scheduled_rotation'
 * });
 *
 * console.log('New Agent ID:', result.newAgentId);
 * console.log('Rotation proof:', result.rotationEnvelope);
 *
 * // Build registry update with rotation
 * const registryUpdate = buildRegistryUpdate(
 *   oldAgentId,
 *   result.newAgentId,
 *   result.newManifest,
 *   routes,
 *   result.rotationEnvelope
 * );
 *
 * // Build standalone rotation message
 * const rotateMsg = buildKeyRotateMessage(
 *   oldAgentId,
 *   trustedAgentId,
 *   result.newAgentId,
 *   oldSecretKey,
 *   'key_refresh'
 * );
 * ```
 */
export { rotateKeys, buildRegistryUpdate, buildKeyRotateMessage, KeyRotationResult, KeyRotationParams } from './key-rotation';

/**
 * Registry client for agent registration and discovery.
 *
 * Registers agents with a central registry for discovery by remote clients.
 *
 * @example
 * ```typescript
 * import { RegistryClient, RegistryClientOptions } from 'agent-discovery-protocol';
 *
 * const registry = new RegistryClient({
 *   registryUrl: 'https://registry.example.com',
 *   agentId,
 *   manifest,
 *   routes,
 *   token: 'optional-auth-token',
 *   secretKey
 * });
 *
 * // Register the agent
 * const registration = await registry.register();
 * console.log('Expires at:', registration.expires_at);
 *
 * // Update manifest/routess later
 * await registry.updateManifest(newManifest, newRoutes);
 *
 * // Cleanup on shutdown
 * await registry.deregister();
 * registry.close();
 * ```
 */
export { RegistryClient, RegistryClientOptions } from './registry/client';

/**
 * Contact store for managing known agents and their routes.
 *
 * Persists agent contact information including routes and trust status.
 *
 * @example
 * ```typescript
 * import { ContactStore, ContactEntry, ContactsData } from 'agent-discovery-protocol';
 *
 * const contacts = new ContactStore();
 * await contacts.load();
 *
 * // Add a contact
 * contacts.set('adp://peer@ns/name', {
 *   routes: [{ type: 'direct', address: '192.168.1.100:9000' }],
 *   trust: 'pinned',
 *   public_key: 'base64url_encoded_key'
 * });
 *
 * // Get contact routes
 * const routes = contacts.getRoutes('adp://peer@ns/name');
 *
 * // List all contacts
 * const allAgentIds = contacts.listAgentIds();
 * await contacts.save();
 * ```
 */
export { ContactStore, ContactEntry, ContactsData } from './contacts';

/**
 * MCP (Model Context Protocol) server adapter for ADP.
 *
 * Exposes ADP functionality as MCP tools and resources for integration
 * with AI coding assistants.
 *
 * @example
 * ```typescript
 * import { AdpMcpServer, AdpMcpConfig } from 'agent-discovery-protocol';
 *
 * const server = new AdpMcpServer({
 *   tag: 'my-agent',
 *   namespace: 'local',
 *   relayUrl: 'ws://relay.example.com:9001',
 *   registryUrl: 'https://registry.example.com',
 *   displayName: 'My ADP Agent'
 * });
 *
 * await server.start();
 * await server.connect();
 *
 * // Cleanup
 * await server.shutdown();
 * ```
 */
export { AdpMcpServer, AdpMcpConfig } from './mcp-server';

/**
 * Logging utilities for the ADP library.
 *
 * Uses a pluggable logger interface. Default is silent.
 *
 * @example
 * ```typescript
 * import { setLogger, getLogger, Logger, LogLevel } from 'agent-discovery-protocol';
 *
 * // Set a custom logger
 * setLogger({
 *   debug: (...args) => console.debug('[DEBUG]', ...args),
 *   info: (...args) => console.info('[INFO]', ...args),
 *   warn: (...args) => console.warn('[WARN]', ...args),
 *   error: (...args) => console.error('[ERROR]', ...args)
 * });
 *
 * // Get the current logger
 * const logger = getLogger();
 * logger.info('Agent started');
 * ```
 */
export { setLogger, getLogger, Logger, LogLevel } from './logger';

/**
 * Network utility functions for port management.
 *
 * @example
 * ```typescript
 * import { findAvailablePort, findAvailablePortSequential, isPortAvailable } from 'agent-discovery-protocol';
 *
 * // Check if a specific port is available
 * const available = await isPortAvailable(9000);
 * console.log('Port 9000 available:', available);
 *
 * // Find an available port (batch search, faster)
 * const port = await findAvailablePort(9000, 9100);
 * console.log('Found available port:', port);
 *
 * // Find an available port (sequential search)
 * const port2 = await findAvailablePortSequential(9000, 100);
 * console.log('Found port:', port2);
 * ```
 */
export { findAvailablePort, findAvailablePortSequential, isPortAvailable } from './net-utils';

/**
 * Configuration interfaces for various ADP components.
 *
 * @example
 * ```typescript
 * import type { CommunicationConfig, WebhookConfig, RetryConfig, AgentConfig, GatewayConfig } from 'agent-discovery-protocol';
 *
 * // Webhook configuration
 * const webhookConfig: WebhookConfig = {
 *   enabled: true,
 *   url: 'https://example.com/webhook',
 *   secret: 'webhook-secret',
 *   timeout: 30000,
 *   retry: { maxAttempts: 3, backoffMs: 1000 }
 * };
 *
 * // Communication configuration
 * const commConfig: CommunicationConfig = {
 *   mode: 'hybrid',
 *   webhook: webhookConfig
 * };
 * ```
 */
export { CommunicationConfig, WebhookConfig, RetryConfig, AgentConfig, GatewayConfig } from './config';

/**
 * Webhook client for sending task results to external systems.
 *
 * Supports signed payloads with retry logic and signature verification.
 *
 * @example
 * ```typescript
 * import { WebhookClient, WebhookEvent, WebhookPayload, TaskResult } from 'agent-discovery-protocol';
 *
 * const webhookClient = new WebhookClient({
 *   enabled: true,
 *   url: 'https://example.com/webhook',
 *   secret: 'webhook-secret',
 *   retry: { maxAttempts: 3, backoffMs: 1000 }
 * });
 *
 * // Send task completion webhook
 * await webhookClient.sendWebhook(
 *   'task.completed',
 *   taskId,
 *   agentId,
 *   { result: { output: 'processed data' } },
 *   secretKey
 * );
 *
 * // Verify incoming webhook signature
 * const isValid = WebhookClient.verifyWebhookSignature(payload, publicKey);
 * ```
 */
export { WebhookClient, WebhookEvent, WebhookPayload, TaskResult } from './webhook-client';

/**
 * The current version of the ADP library.
 */
export const VERSION = '0.2.0';

/**
 * Standard capabilities that most ADP agents should implement.
 *
 * These capabilities are automatically available when using AdpMcpServer
 * or can be registered with a Gateway instance.
 *
 * @example
 * ```typescript
 * import { STANDARD_CAPABILITIES } from 'agent-discovery-protocol';
 *
 * console.log('Standard capabilities:', STANDARD_CAPABILITIES);
 * // [
 * //   'adp:ping',
 * //   'adp:capability.query',
 * //   'adp:info',
 * //   'adp:key.rotate',
 * //   'adp:task.create',
 * //   'adp:task.get',
 * //   'adp:task.list',
 * //   'adp:task.cancel',
 * //   'custom:echo',
 * //   'custom:chat',
 * // ]
 * ```
 */
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
