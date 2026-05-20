import * as http from 'http';
import * as https from 'https';
import { WebSocketServer, WebSocket } from 'ws';
import { Envelope, buildEnvelope, MessageVerifier } from './envelope';
import { signEnvelope } from './crypto';
import { canonicalize } from './canonical';
import { Manifest, createManifest, hasCapability, Capability, Route } from './manifest';
import { TrustStore } from './trust-store';
import { TaskManager } from './task-manager';

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
  onInfo?: (from: string, params: unknown) => void;
  customHandlers?: Record<string, ActionHandler>;
  taskManager?: TaskManager;
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

export class Gateway {
  private server: http.Server | https.Server;
  private wss: WebSocketServer;
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

  constructor(options: GatewayOptions) {
    this.secretKey = options.secretKey;
    this.agentId = options.agentId;
    this.trustStore = new TrustStore();
    this.verifier = new MessageVerifier(this.trustStore);
    this.messageIdCache = new Set();
    this.skipVerification = options.skipVerification ?? false;
    this.onInfo = options.onInfo;

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
    
    const routes = options.routes || [{ type: 'direct', address: `${options.host || 'localhost'}:${options.port}` }];
    this.manifest = createManifest(
      options.agentId,
      options.displayName,
      options.capabilities,
      routes
    );

    const wsPath = options.path || '/adp';

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
        res.end(JSON.stringify({ status: 'ok' }));
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

    console.log(`🔗 Connection from: ${remoteAgentId || 'unknown'}`);

    ws.on('message', async (data) => {
      try {
        const envelope = JSON.parse(data.toString()) as Envelope;
        await this.processMessage(ws, envelope);
      } catch (err) {
        console.error('Message handling error:', err);
      }
    });

    ws.on('close', () => {
      console.log(`🔌 Connection closed: ${remoteAgentId || 'unknown'}`);
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
    });
  }

  private async processMessage(ws: WebSocket, envelope: Envelope): Promise<void> {
    if (this.messageIdCache.has(envelope.id)) {
      console.log(`Rejected duplicate message: ${envelope.id}`);
      return;
    }

    if (!this.skipVerification) {
      const result = await this.verifier.verify(envelope);
      if (!result.valid) {
        console.log(`Verification failed from ${envelope.from}: ${result.error} - ${result.message}`);
        if (result.error === 'INVALID_SIGNATURE') {
          await this.sendError(ws, envelope, 'INVALID_SIGNATURE', 'Message signature verification failed');
        } else {
          const errorCode: string = result.error ?? 'INTERNAL_ERROR';
          await this.sendError(ws, envelope, errorCode, result.message);
        }
        return;
      }
      console.log(`✅ Signature verified: ${envelope.from}`);
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
    console.log(`📨 Received ${envelope.action} from ${envelope.from}`);

    if (!hasCapability(this.manifest, envelope.action)) {
      await this.sendError(ws, envelope, 'CAPABILITY_NOT_FOUND');
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
    } catch {
    }
  }

  private async processMessageDirect(envelope: Envelope): Promise<void> {
    if (!this.skipVerification) {
      const result = await this.verifier.verify(envelope);
      if (!result.valid) {
        console.log(`Relay msg verification failed: ${result.error}`);
        return;
      }
      console.log(`✅ Signature verified (relay): ${envelope.from}`);
    }

    await this.handleMessageDirect(envelope);
  }

  private async handleMessageDirect(envelope: Envelope): Promise<void> {
    console.log(`📨 Received ${envelope.action} from ${envelope.from}`);

    switch (envelope.action) {
      case 'adp:ping':
        console.log(`   📊 Ping from ${envelope.from}`);
        break;
      case 'adp:capability.query':
        console.log(`   📋 Capability query from ${envelope.from}`);
        break;
      case 'adp:info':
        console.log(`Info from ${envelope.from}:`, envelope.params);
        break;
      default: {
        const handler = this.customActions.get(envelope.action);
        if (handler) {
          await handler({ send: () => {} } as unknown as WebSocket, envelope);
        }
      }
    }
  }

  close(): void {
    this.wss.close();
    this.server.close();
  }
}

export async function connectToAgent(agentId: string, address: string, localAgentId: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${address}/adp?agent_id=${encodeURIComponent(localAgentId)}`);
    
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}
