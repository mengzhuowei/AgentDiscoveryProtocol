import * as http from 'http';
import * as https from 'https';
import { WebSocketServer, WebSocket } from 'ws';
import { Envelope, buildEnvelope, MessageVerifier, MESSAGE_SIZE_LIMIT } from './envelope';
import { signEnvelope } from './crypto';
import { canonicalize } from './canonical';
import { Manifest, createManifest, hasCapability, getCapability, Capability, Route, AgentInfo } from './manifest';
import { TrustStore } from './trust-store';
import { extractPublicKey } from './agent-id';
import { TaskManager } from './task-manager';
import { ContactStore } from './contacts';
import { getLogger } from './logger';
import { WebhookClient, WebhookEvent, TaskResult } from './webhook-client';
import { CommunicationConfig, WebhookConfig } from './config';

export interface GatewayOptions {
  host?: string;
  port: number;
  path?: string;
  secretKey: Uint8Array;
  agentId: string;
  displayName: string;
  capabilities: (string | Capability)[];
  routes?: Route[];
  tls?: { cert: string; key: string };
  skipVerification?: boolean;
  tofuEnabled?: boolean;
  onNewAgent?: (agentId: string) => void;
  onInfo?: (from: string, params: unknown) => void;
  customHandlers?: Record<string, ActionHandler>;
  taskManager?: TaskManager;
  contacts?: ContactStore;
  description?: string;
  agentInfo?: AgentInfo;
  trustStore?: TrustStore;
  verifier?: MessageVerifier;
  noServer?: boolean;
  communication?: CommunicationConfig;
}

interface TaskState {
  envelope: Envelope;
  ws?: WebSocket;
  startedAt: number;
  status: 'pending' | 'working' | 'completed' | 'failed';
  result?: unknown;
  error?: Error;
}

export type ActionHandler = (ws: WebSocket, envelope: Envelope) => Promise<void>;

function createTaskHandlers(tm: TaskManager, secretKey: Uint8Array): Record<string, ActionHandler> {
  return {
    'adp:task.create': async (ws, envelope) => {
      const reply = await tm.handleCreateTask(envelope, secretKey);
      ws.send(JSON.stringify(reply));
    },
    'adp:task.get': async (ws, envelope) => {
      const reply = await tm.handleGetTask(envelope, secretKey);
      ws.send(JSON.stringify(reply));
    },
    'adp:task.list': async (ws, envelope) => {
      const reply = await tm.handleListTasks(envelope, secretKey);
      ws.send(JSON.stringify(reply));
    },
    'adp:task.cancel': async (ws, envelope) => {
      const reply = await tm.handleCancelTask(envelope, secretKey);
      ws.send(JSON.stringify(reply));
    },
  };
}

const MESSAGE_ID_CACHE_SIZE = 10000;

interface ConnectionState {
  lastActive: number;
  pingInterval: NodeJS.Timeout;
  timeout: NodeJS.Timeout;
}

export class Gateway {
  private server: http.Server | https.Server | null = null;
  private wss: WebSocketServer | null = null;
  private secretKey: Uint8Array;
  private agentId: string;
  private manifest: Manifest;
  private trustStore: TrustStore;
  private verifier: MessageVerifier;
  private messageIdCache: Set<string>;
  private skipVerification: boolean;
  private onInfo?: (from: string, params: unknown) => void;
  private customActions: Map<string, ActionHandler> = new Map();
  private taskManager?: TaskManager;
  private connections: Map<WebSocket, ConnectionState> = new Map();
  private heartbeatIntervalMs: number = 30000;
  private heartbeatTimeoutMs: number = 60000;
  
  private webhookClient?: WebhookClient;
  private communicationConfig?: CommunicationConfig;
  private tasks: Map<string, TaskState> = new Map();

  constructor(options: GatewayOptions & { heartbeatIntervalMs?: number; heartbeatTimeoutMs?: number }) {
    this.secretKey = options.secretKey;
    this.agentId = options.agentId;
    this.trustStore = options.trustStore || new TrustStore();
    this.verifier = options.verifier || new MessageVerifier(this.trustStore, {
      tofuEnabled: options.tofuEnabled,
      onNewAgent: options.onNewAgent,
    });
    this.messageIdCache = new Set();
    this.skipVerification = options.skipVerification ?? false;
    this.onInfo = options.onInfo;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30000;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 60000;

    // Load persisted trust store (only if not injected)
    if (!options.trustStore) {
      this.trustStore.load().catch(err => {
        getLogger().warn('[ADP Gateway] Failed to load trust store:', err);
      });
    }

    if (options.customHandlers) {
      for (const [action, handler] of Object.entries(options.customHandlers)) {
        this.customActions.set(action, handler);
      }
    }

    if (options.taskManager) {
      this.taskManager = options.taskManager;
      for (const [action, handler] of Object.entries(createTaskHandlers(options.taskManager, options.secretKey))) {
        this.customActions.set(action, handler);
      }
    }

    if (options.contacts) {
      const { pinned, conflicts } = options.contacts.pinTrustedKeys(this.trustStore);
      if (pinned.length > 0) {
        getLogger().info(`Pinned trust: ${pinned.join(', ')}`);
      }
      for (const agentId of conflicts) {
        getLogger().warn(`Pinned key mismatch for ${agentId}`);
      }
    }
    
    const routes = options.routes || [{ type: 'direct', address: `${options.host || 'localhost'}:${options.port}` }];
    this.manifest = createManifest(
      options.agentId,
      options.displayName,
      options.capabilities,
      routes,
      {
        description: options.description,
        agentInfo: options.agentInfo,
      }
    );

    if (options.communication?.webhook?.enabled) {
      try {
        this.webhookClient = new WebhookClient(options.communication.webhook);
        this.communicationConfig = options.communication;
        getLogger().info(`Webhook client initialized: ${options.communication.webhook.url}`);
      } catch (error) {
        getLogger().warn('Failed to initialize webhook client:', error);
      }
    }

    const wsPath = options.path || '/adp';

    if (options.noServer) {
      return;
    }

    if (options.tls) {
      this.server = https.createServer({
        cert: options.tls.cert,
        key: options.tls.key,
      });
    } else {
      this.server = http.createServer();
    }

    this.server.on('request', (req, res) => {
      const url = new URL(req.url || '/', `http://localhost`);

      if (req.method === 'GET' && url.pathname === `${wsPath}/agent-id`) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          agent_id: this.agentId,
          display_name: this.manifest.display_name,
          protocol: this.manifest.protocol,
          capabilities_count: this.manifest.capabilities.length,
        }));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', connections: this.connections.size }));
        return;
      }

      res.writeHead(404);
      res.end();
    });

    this.wss = new WebSocketServer({ server: this.server, path: wsPath });
    this.wss.on('connection', this.handleConnection.bind(this));

    this.server.listen(options.port, options.host);
  }

  private async handleConnection(ws: WebSocket, req: http.IncomingMessage): Promise<void> {
    const url = new URL(req.url || '/', `http://localhost`);
    const remoteAgentId = url.searchParams.get('agent_id');

    getLogger().info(`Connection from: ${remoteAgentId || 'unknown'}`);

    // 初始化连接状态
    const state: ConnectionState = {
      lastActive: Date.now(),
      pingInterval: setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      }, this.heartbeatIntervalMs),
      timeout: setTimeout(() => {
        getLogger().info(`Connection timeout: ${remoteAgentId || 'unknown'}`);
        ws.close(1000, 'Heartbeat timeout');
      }, this.heartbeatTimeoutMs),
    };
    this.connections.set(ws, state);

    ws.on('message', async (data) => {
      const raw = typeof data === 'string' ? data : data.toString();
      if (Buffer.byteLength(raw) > MESSAGE_SIZE_LIMIT) {
        getLogger().warn(`Message too large from ${remoteAgentId}: ${Buffer.byteLength(raw)} bytes`);
        return;
      }
      // 更新最后活动时间
      const connState = this.connections.get(ws);
      if (connState) {
        connState.lastActive = Date.now();
        // 重置超时计时器
        clearTimeout(connState.timeout);
        connState.timeout = setTimeout(() => {
          getLogger().info(`Connection timeout: ${remoteAgentId || 'unknown'}`);
          ws.close(1000, 'Heartbeat timeout');
        }, this.heartbeatTimeoutMs);
      }
      try {
        const envelope = JSON.parse(raw) as Envelope;
        await this.processMessage(ws, envelope);
      } catch (err) {
        getLogger().error('Message handling error:', err);
      }
    });

    ws.on('pong', () => {
      // 收到 pong，更新最后活动时间
      const connState = this.connections.get(ws);
      if (connState) {
        connState.lastActive = Date.now();
        clearTimeout(connState.timeout);
        connState.timeout = setTimeout(() => {
          getLogger().info(`Connection timeout: ${remoteAgentId || 'unknown'}`);
          ws.close(1000, 'Heartbeat timeout');
        }, this.heartbeatTimeoutMs);
      }
    });

    ws.on('close', () => {
      getLogger().info(`Connection closed: ${remoteAgentId || 'unknown'}`);
      const connState = this.connections.get(ws);
      if (connState) {
        clearInterval(connState.pingInterval);
        clearTimeout(connState.timeout);
        this.connections.delete(ws);
      }
    });

    ws.on('error', (err) => {
      getLogger().error('WebSocket error:', err);
      const connState = this.connections.get(ws);
      if (connState) {
        clearInterval(connState.pingInterval);
        clearTimeout(connState.timeout);
        this.connections.delete(ws);
      }
    });
  }

  private async processMessage(ws: WebSocket, envelope: Envelope): Promise<void> {
    if (!this.skipVerification) {
      const result = await this.verifier.verify(envelope);
      if (!result.valid) {
        getLogger().warn(`Verification failed from ${envelope.from}: ${result.error} - ${result.message}`);
        if (result.error === 'INVALID_SIGNATURE') {
          await this.sendError(ws, envelope, 'INVALID_SIGNATURE', 'Message signature verification failed');
        } else {
          const errorCode: string = result.error ?? 'INTERNAL_ERROR';
          await this.sendError(ws, envelope, errorCode, result.message);
        }
        return;
      }
      getLogger().info(`Signature verified: ${envelope.from}`);
    }

    if (this.messageIdCache.has(envelope.id)) {
    getLogger().warn(`Rejected duplicate message: ${envelope.id}`);
      return;
    }

    this.messageIdCache.add(envelope.id);
    if (this.messageIdCache.size > MESSAGE_ID_CACHE_SIZE) {
      const iterator = this.messageIdCache.values();
      const first = iterator.next();
      if (!first.done && first.value !== undefined) {
        this.messageIdCache.delete(first.value);
      }
    }

    await this.handleMessage(ws, envelope);
  }

  private async handleMessage(ws: WebSocket, envelope: Envelope): Promise<void> {
    getLogger().info(`Received ${envelope.action} from ${envelope.from}`);

    if (!hasCapability(this.manifest, envelope.action)) {
      await this.sendError(ws, envelope, 'CAPABILITY_NOT_FOUND');
      return;
    }

    const capability = getCapability(this.manifest, envelope.action);
    const mode = this.getCommunicationMode(envelope.action, capability);

    if (mode === 'webhook' && capability?.async) {
      await this.handleAsyncRequest(ws, envelope, capability);
      return;
    }

    switch (envelope.action) {
      case 'adp:ping':
        await this.handlePing(ws, envelope);
        break;
      case 'adp:capability.query':
        await this.handleCapabilityQuery(ws, envelope);
        break;
      case 'adp:info':
        await this.handleInfo(ws, envelope);
        break;
      case 'adp:key.rotate':
        await this.handleKeyRotate(ws, envelope);
        break;
      default: {
        const handler = this.customActions.get(envelope.action);
        if (handler) {
          await handler(ws, envelope);
        } else {
          await this.sendError(ws, envelope, 'UNKNOWN_ACTION');
        }
      }
    }
  }

  private getCommunicationMode(action: string, capability?: Capability): 'websocket' | 'webhook' {
    if (!this.communicationConfig) {
      return 'websocket';
    }

    const preferredMode = capability?.preferredMode;
    const globalMode = this.communicationConfig.mode;

    if (preferredMode === 'webhook' && this.webhookClient) {
      return 'webhook';
    }

    if (globalMode === 'webhook' && this.webhookClient) {
      return 'webhook';
    }

    if (globalMode === 'hybrid' && capability?.async && this.webhookClient) {
      return 'webhook';
    }

    return 'websocket';
  }

  private async handleAsyncRequest(ws: WebSocket, envelope: Envelope, capability: Capability): Promise<void> {
    const taskId = `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    const taskState: TaskState = {
      envelope,
      ws,
      startedAt: Date.now(),
      status: 'pending'
    };
    this.tasks.set(taskId, taskState);

    const pendingReply = await this.signAndBuildEnvelope({
      to: envelope.from,
      action: envelope.action,
      params: { task_id: taskId, status: 'PENDING', message: 'Task accepted' },
      reply_to: envelope.id
    });
    ws.send(JSON.stringify(pendingReply));

    process.nextTick(async () => {
      try {
        taskState.status = 'working';

        const handler = this.customActions.get(envelope.action);
        if (!handler) {
          throw new Error('No handler found for action');
        }

        await handler(ws, envelope);

        taskState.status = 'completed';

        if (this.webhookClient) {
          const result: TaskResult = {
            result: {
              task_id: taskId,
              status: 'COMPLETED'
            }
          };
          await this.webhookClient.sendWebhook('task.completed', taskId, this.agentId, result, this.secretKey);
        }

      } catch (error) {
        taskState.status = 'failed';
        taskState.error = error as Error;

        if (this.webhookClient) {
          const result: TaskResult = {
            error: {
              code: 'TASK_FAILED',
              message: error instanceof Error ? error.message : 'Unknown error'
            }
          };
          try {
            await this.webhookClient.sendWebhook('task.failed', taskId, this.agentId, result, this.secretKey);
          } catch (webhookError) {
            getLogger().error('Failed to send failure webhook:', webhookError);
          }
        }

        getLogger().error(`Async task failed: ${taskId}`, error);
      } finally {
        setTimeout(() => this.tasks.delete(taskId), 60000);
      }
    });
  }

  private async handlePing(ws: WebSocket, envelope: Envelope): Promise<void> {
    const reply = await this.signAndBuildEnvelope({
      to: envelope.from,
      action: 'adp:ping',
      params: { uptime: process.uptime() },
      reply_to: envelope.id,
    });

    ws.send(JSON.stringify(reply));
  }

  private async handleCapabilityQuery(ws: WebSocket, envelope: Envelope): Promise<void> {
    const reply = await this.signAndBuildEnvelope({
      to: envelope.from,
      action: 'adp:capability.query',
      params: { manifest: this.manifest },
      reply_to: envelope.id,
    });

    ws.send(JSON.stringify(reply));
  }

  private async handleInfo(ws: WebSocket, envelope: Envelope): Promise<void> {
    this.onInfo?.(envelope.from, envelope.params);
  }

  private async handleKeyRotate(ws: WebSocket, envelope: Envelope): Promise<void> {
    const params = envelope.params as { new_agent_id: string; reason?: string };
    
    if (!params.new_agent_id) {
      await this.sendError(ws, envelope, 'INVALID_PARAMS', 'new_agent_id is required');
      return;
    }

    try {
      const newPublicKey = extractPublicKey(params.new_agent_id);
      this.trustStore.addRotation(envelope.from, params.new_agent_id, newPublicKey);
      
      getLogger().info(`Key rotation processed: ${envelope.from} → ${params.new_agent_id}`);
      
      const reply = await this.signAndBuildEnvelope({
        to: envelope.from,
        action: 'adp:key.rotate',
        params: {},
        reply_to: envelope.id,
      });

      ws.send(JSON.stringify(reply));
    } catch (err) {
      getLogger().warn('[ADP Gateway] Key rotation failed:', err);
      await this.sendError(ws, envelope, 'INVALID_PARAMS', 'Invalid new_agent_id');
    }
  }

  private async sendError(ws: WebSocket, envelope: Envelope, code: string, message?: string): Promise<void> {
    const errorEnvelope = await this.signAndBuildEnvelope({
      to: envelope.from,
      action: envelope.action,
      params: {},
      reply_to: envelope.id,
      error: { code, message: message || code },
    });

    ws.send(JSON.stringify(errorEnvelope));
  }

  private async signAndBuildEnvelope(options: {
    to: string;
    action: string;
    params?: unknown;
    reply_to?: string;
    error?: { code: string; message: string };
  }): Promise<Envelope> {
    const unsigned = buildEnvelope(
      this.agentId,
      options.to,
      options.action,
      options.params || {},
      {
        reply_to: options.reply_to,
        error: options.error,
      }
    );

    const signed = signEnvelope(unsigned, this.secretKey, canonicalize);
    return signed as unknown as Envelope;
  }

  registerCapability(cap: string | Capability, handler: ActionHandler): void {
    this.customActions.set(typeof cap === 'string' ? cap : cap.capability, handler);
    this.manifest.capabilities.push(cap);
  }

  getManifest(): Manifest {
    return this.manifest;
  }

  getAgentId(): string {
    return this.agentId;
  }

  async processRelayMessage(rawEnvelope: unknown): Promise<void> {
    try {
      const envelope = rawEnvelope as Envelope;
      await this.processMessageDirect(envelope);
    } catch (err) {
      getLogger().warn('[ADP Gateway] Failed to process relay message:', err);
    }
  }

  private async processMessageDirect(envelope: Envelope): Promise<void> {
    if (!this.skipVerification) {
      const result = await this.verifier.verify(envelope);
      if (!result.valid) {
        getLogger().warn(`Relay msg verification failed: ${result.error}`);
        return;
      }
      getLogger().info(`Signature verified (relay): ${envelope.from}`);
    }

    await this.handleMessageDirect(envelope);
  }

  private async handleMessageDirect(envelope: Envelope): Promise<void> {
    getLogger().info(`Received ${envelope.action} from ${envelope.from}`);

    switch (envelope.action) {
      case 'adp:ping':
        getLogger().info(`Ping from ${envelope.from}`);
        // 对于直接消息的 ping，我们不回复，因为没有返回通道
        break;
      case 'adp:capability.query':
        getLogger().info(`Capability query from ${envelope.from}`);
        // 对于直接消息的查询，我们不回复
        break;
      case 'adp:info':
        getLogger().info(`Info from ${envelope.from}:`, envelope.params);
        break;
      default: {
        const handler = this.customActions.get(envelope.action);
        if (handler) {
          const fakeWs = {
            send: (data: string) => {
              const err = new Error(
                `[ADP Gateway] Relay handler attempted reply to ${envelope.from} ` +
                `(msg ${envelope.id}) but no direct relay channel is available. ` +
                `Replies through relay require a back-channel — register a relay sender in GatewayOptions.`
              );
              getLogger().warn(err.message, JSON.stringify(data).slice(0, 200));
            }
          } as unknown as WebSocket;
          try {
            await handler(fakeWs, envelope);
          } catch (err) {
            getLogger().warn('[ADP Gateway] Relay handler error:', err);
          }
        }
      }
    }
  }

  close(): void {
    for (const [, state] of this.connections) {
      clearInterval(state.pingInterval);
      clearTimeout(state.timeout);
    }
    this.connections.clear();
    this.wss?.close();
    this.server?.close();
  }
}

export async function connectToAgent(agentId: string, address: string, localAgentId: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${address}/adp?agent_id=${encodeURIComponent(localAgentId)}`);
    
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Connection timeout'));
    }, 10_000);

    ws.on('open', () => {
      clearTimeout(timeout);
      resolve(ws);
    });
    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}
