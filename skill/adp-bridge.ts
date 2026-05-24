/**
 * ADP Universal Bridge —— 通用 ADP 网络接入层
 * =============================================
 *
 * 适用场景：
 * - 没有 MCP Client 的 Agent（如 Hermes、自定义 Agent）
 * - 想通过 HTTP/REST 接入 ADP 的后端服务
 * - Python / Go / Rust 等其他语言项目
 * - 浏览器前端、移动端 App
 * - CLI 脚本、自动化工具
 * - 任何不想理解 MCP 协议或 ADP 协议细节的系统
 *
 * 核心设计：封装所有密码学、签名、发现、连接细节，暴露最简单的 API。
 */

import {
  Gateway, GatewayOptions, connectToAgent, Discovery, DiscoveredPeer,
  loadOrCreateIdentity, signEnvelope, generateMessageId, canonicalize,
  findAvailablePortSequential, ContactStore,
  RegistryClient, RelayClient,
  PROTOCOL_VERSION, type Capability, type Route,
} from '../src';
import { WebSocket } from 'ws';

// ============================================================================
// 类型定义
// ============================================================================

export interface AdpPeer {
  agentId: string;
  displayName?: string;
  address: string;
  lastSeen: number;
}

export interface AdpMessage {
  from: string;
  action: string;
  params: Record<string, unknown>;
  replyTo?: string;
}

export type AdpHandler = (msg: AdpMessage, reply: (params: Record<string, unknown>) => void) => void | Promise<void>;

export interface AdpBridgeOptions {
  /** Agent 名称标识 */
  name: string;
  namespace?: string;
  displayName?: string;
  capabilities?: (string | Capability)[];
  registryUrl?: string;
  registryToken?: string;
  relayUrl?: string;
  enableMdns?: boolean;
  port?: number;
  handlers?: Record<string, AdpHandler>;
  /** 私钥文件路径（可选，默认自动生成） */
  keyPath?: string;
  /** 信任存储目录（可选） */
  dataDir?: string;
}

export interface CallResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

// ============================================================================
// AdpBridge —— 通用 ADP 桥接客户端
// ============================================================================

/**
 * AdpBridge 是接入 ADP 网络的通用入口。
 *
 * 无论你是什么系统（Hermes、OpenClaw 插件、Python 脚本、浏览器、CLI），
 * 只要你能运行 Node.js 或调用 HTTP API，就能通过它接入 ADP。
 *
 * 极简用法：
 * ```ts
 * const bridge = new AdpBridge({ name: 'my-app', handlers: { ... } });
 * await bridge.start();
 * const peers = await bridge.discover();
 * const result = await bridge.call(peerId, 'custom:action', { foo: 'bar' });
 * ```
 */
export class AdpBridge {
  private options: AdpBridgeOptions;
  private gateway: Gateway | null = null;
  private discovery: Discovery | null = null;
  private relayClient: RelayClient | null = null;
  private registryClient: RegistryClient | null = null;
  private peers: Map<string, AdpPeer> = new Map();
  private identity!: { agentId: string; secretKey: Uint8Array };
  private port: number = 0;
  private contacts: ContactStore;

  constructor(options: AdpBridgeOptions) {
    this.options = {
      namespace: 'local',
      enableMdns: true,
      capabilities: ['adp:ping', 'adp:capability.query'],
      ...options,
    };
    this.contacts = new ContactStore();
  }

  get agentId(): string {
    return this.identity?.agentId ?? '';
  }

  get peerList(): AdpPeer[] {
    return Array.from(this.peers.values()).sort((a, b) => b.lastSeen - a.lastSeen);
  }

  get listenAddress(): string {
    return `ws://localhost:${this.port}/adp`;
  }

  /**
   * 启动 Bridge，建立所有网络连接。
   */
  async start(): Promise<void> {
    const { name, namespace, displayName, capabilities, enableMdns, port, relayUrl, registryUrl, registryToken, handlers } = this.options;

    const { identity } = loadOrCreateIdentity(namespace!, name, displayName || name);
    this.identity = { agentId: identity.agentId, secretKey: identity.secretKey };
    this.port = port || await findAvailablePortSequential(9900);
    await this.contacts.load();

    const customHandlers: Record<string, any> = {};
    if (handlers) {
      for (const [action, handler] of Object.entries(handlers)) {
        customHandlers[action] = (ws: WebSocket, envelope: any) => this.wrapHandler(handler, ws, envelope);
      }
    }

    this.gateway = new Gateway({
      port: this.port,
      host: enableMdns ? '0.0.0.0' : 'localhost',
      secretKey: identity.secretKey,
      agentId: identity.agentId,
      displayName: displayName || name,
      capabilities: capabilities || ['adp:ping', 'adp:capability.query'],
      customHandlers,
      contacts: this.contacts,
    });

    if (relayUrl) {
      this.relayClient = new RelayClient(relayUrl, identity.agentId, {
        onWelcome: (sid) => console.log(`[ADP] Relay connected: ${sid}`),
        onMessage: (msg) => this.gateway?.processRelayMessage(msg).catch(() => {}),
        onPeerUpdate: (type, peerAgentId) => {
          if (type === 'peer_joined') {
            this.addPeer(peerAgentId, { address: '__relay__' });
          } else {
            this.peers.delete(peerAgentId);
          }
        },
      });
      await this.relayClient.connect();
    }

    if (registryUrl) {
      const routes: Route[] = [{ type: 'direct', address: `localhost:${this.port}` }];
      this.registryClient = new RegistryClient({
        registryUrl,
        agentId: identity.agentId,
        manifest: this.gateway.getManifest(),
        routes,
        token: registryToken,
        secretKey: identity.secretKey,
      });
      try {
        await this.registryClient.register();
        console.log(`[ADP] Registered with registry`);
      } catch (err) {
        console.log(`[ADP] Registry registration failed: ${(err as Error).message}`);
      }
    }

    if (enableMdns && !relayUrl) {
      this.discovery = new Discovery(identity.agentId, this.port, {
        onPeerDiscovered: (peer: DiscoveredPeer) => {
          this.addPeer(peer.agentId, { address: `${peer.host}:${peer.port}` });
        },
        onPeerLost: (agentId: string) => {
          this.peers.delete(agentId);
        },
      });
      this.discovery.start();
    }

    for (const cid of this.contacts.listAgentIds()) {
      const routes = this.contacts.getRoutes(cid);
      if (routes && routes.length > 0) {
        const direct = routes.find(r => r.type === 'direct');
        if (direct?.address) {
          this.addPeer(cid, { address: direct.address });
        }
      }
    }

    console.log(`[ADP] Bridge started: ${identity.agentId}`);
    console.log(`[ADP] Gateway: ${this.listenAddress}`);
  }

  /**
   * 发现网络中的 peers。
   */
  async discover(timeoutMs: number = 5000): Promise<AdpPeer[]> {
    if (this.discovery && timeoutMs > 0) {
      await new Promise(r => setTimeout(r, timeoutMs));
    }
    return this.peerList;
  }

  /**
   * 调用指定 Agent 的某个能力。
   */
  async call(
    targetAgentId: string,
    action: string,
    params: Record<string, unknown> = {},
    timeoutMs: number = 10000,
  ): Promise<CallResult> {
    const peer = this.peers.get(targetAgentId);
    if (!peer) {
      return { success: false, error: `Peer not found: ${targetAgentId}. Call discover() first.` };
    }

    try {
      const ws = await connectToAgent(targetAgentId, peer.address, this.identity.agentId);
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          ws.close();
          resolve({ success: false, error: `Call to ${action} timed out after ${timeoutMs}ms` });
        }, timeoutMs);

        ws.on('message', (raw: Buffer) => {
          clearTimeout(timeout);
          try {
            const env = JSON.parse(raw.toString());
            ws.close();
            resolve({ success: true, data: env.params || {} });
          } catch (err) {
            ws.close();
            resolve({ success: false, error: `Failed to parse response: ${(err as Error).message}` });
          }
        });

        ws.on('error', (err) => {
          clearTimeout(timeout);
          resolve({ success: false, error: (err as Error).message });
        });

        ws.send(JSON.stringify(signEnvelope({
          protocol: PROTOCOL_VERSION,
          id: generateMessageId(),
          from: this.identity.agentId,
          to: targetAgentId,
          action,
          params,
          timestamp: new Date().toISOString(),
        }, this.identity.secretKey, canonicalize)));
      });
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async ping(targetAgentId: string, timeoutMs: number = 5000): Promise<CallResult> {
    return this.call(targetAgentId, 'adp:ping', {}, timeoutMs);
  }

  async queryCapabilities(targetAgentId: string, timeoutMs: number = 5000): Promise<CallResult> {
    return this.call(targetAgentId, 'adp:capability.query', {}, timeoutMs);
  }

  async stop(): Promise<void> {
    this.discovery?.shutdown();
    this.relayClient?.close();
    this.registryClient?.deregister?.().catch(() => {});
    this.gateway?.close();
  }

  private addPeer(agentId: string, info: Partial<AdpPeer>): void {
    const existing = this.peers.get(agentId);
    this.peers.set(agentId, {
      agentId,
      displayName: info.displayName ?? existing?.displayName,
      address: info.address ?? existing?.address ?? '',
      lastSeen: Date.now(),
    });
  }

  private wrapHandler(handler: AdpHandler, ws: WebSocket, envelope: any): Promise<void> {
    return new Promise((resolve) => {
      const msg: AdpMessage = {
        from: envelope.from,
        action: envelope.action,
        params: envelope.params || {},
        replyTo: envelope.id,
      };

      const reply = (params: Record<string, unknown>) => {
        const response = signEnvelope({
          protocol: PROTOCOL_VERSION,
          id: generateMessageId(),
          from: this.identity.agentId,
          to: envelope.from,
          action: envelope.action,
          params,
          reply_to: envelope.id,
          timestamp: new Date().toISOString(),
        }, this.identity.secretKey, canonicalize);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(response));
        }
      };

      Promise.resolve(handler(msg, reply)).then(() => resolve()).catch((err) => {
        console.error(`[ADP] Handler error for ${envelope.action}:`, err);
        reply({ error: (err as Error).message });
        resolve();
      });
    });
  }
}

// ============================================================================
// 轻量级调用辅助（不启动本地服务）
// ============================================================================

/**
 * 一次性发送消息到指定 Agent，不启动本地 Gateway。
 * 适合 CLI 工具、脚本、临时调用。
 */
export async function adpCall(
  targetAddress: string,
  targetAgentId: string,
  action: string,
  params: Record<string, unknown> = {},
  options: { name?: string; namespace?: string; timeoutMs?: number } = {},
): Promise<CallResult> {
  try {
    const { identity } = loadOrCreateIdentity(options.namespace || 'local', options.name || 'temp-client', 'TempClient');
    const ws = await connectToAgent(targetAgentId, targetAddress, identity.agentId);

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        ws.close();
        resolve({ success: false, error: 'Timeout' });
      }, options.timeoutMs || 10000);

      ws.on('message', (raw: Buffer) => {
        clearTimeout(timeout);
        try {
          const env = JSON.parse(raw.toString());
          ws.close();
          resolve({ success: true, data: env.params || {} });
        } catch (err) {
          ws.close();
          resolve({ success: false, error: (err as Error).message });
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        resolve({ success: false, error: (err as Error).message });
      });

      ws.send(JSON.stringify(signEnvelope({
        protocol: PROTOCOL_VERSION,
        id: generateMessageId(),
        from: identity.agentId,
        to: targetAgentId,
        action,
        params,
        timestamp: new Date().toISOString(),
      }, identity.secretKey, canonicalize)));
    });
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
