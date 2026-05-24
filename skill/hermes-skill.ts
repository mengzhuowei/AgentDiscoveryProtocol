/**
 * Hermes / OpenClaw ADP Skill
 * ===========================
 * 一个为 Hermes Agent 和 OpenClaw 设计的轻量级 ADP 接入层。
 *
 * 核心问题：Hermes Agent 没有内置 MCP Client，无法通过 stdio 与 ADP MCP Server 通信。
 * 解决方案：绕过 MCP，直接使用 ADP 原生 WebSocket 协议通信。
 *
 * 这个 skill 封装了所有复杂的密码学和协议细节，提供简单直观的 API。
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

export interface QuickPeer {
  agentId: string;
  displayName?: string;
  address: string;
  lastSeen: number;
}

export interface QuickMessage {
  from: string;
  action: string;
  params: Record<string, unknown>;
  replyTo?: string;
}

export type QuickHandler = (msg: QuickMessage, reply: (params: Record<string, unknown>) => void) => void | Promise<void>;

export interface QuickClientOptions {
  /** Agent 名称标识，用于生成 Agent ID */
  name: string;
  namespace?: string;
  /** 显示名称 */
  displayName?: string;
  /** 本 Agent 支持的能力列表 */
  capabilities?: (string | Capability)[];
  /** Registry 地址（可选，用于跨网络发现） */
  registryUrl?: string;
  registryToken?: string;
  /** Relay 地址（可选，用于 NAT 穿透） */
  relayUrl?: string;
  /** 是否启用局域网 mDNS 发现，默认 true */
  enableMdns?: boolean;
  /** 自定义端口，0 表示自动分配 */
  port?: number;
  /** 能力处理器 */
  handlers?: Record<string, QuickHandler>;
}

// ============================================================================
// QuickAdpClient —— 快速 ADP 客户端
// ============================================================================

/**
 * QuickAdpClient 让 Hermes Agent 或 OpenClaw 无需理解 MCP 协议即可接入 ADP 网络。
 *
 * 使用方式：
 * ```ts
 * const client = new QuickAdpClient({
 *   name: 'my-hermes-agent',
 *   displayName: 'My Hermes Agent',
 *   capabilities: ['custom:analyze'],
 *   handlers: {
 *     'custom:analyze': async (msg, reply) => {
 *       const result = await doAnalyze(msg.params.text);
 *       reply({ result });
 *     }
 *   }
 * });
 *
 * await client.start();
 *
 * // 发现其他 Agent
 * const peers = await client.discover();
 *
 * // 调用其他 Agent 的能力
 * const response = await client.call(peerAgentId, 'custom:summarize', { text: '...' });
 * ```
 */
export class QuickAdpClient {
  private options: QuickClientOptions;
  private gateway: Gateway | null = null;
  private discovery: Discovery | null = null;
  private relayClient: RelayClient | null = null;
  private registryClient: RegistryClient | null = null;
  private peers: Map<string, QuickPeer> = new Map();
  private identity!: { agentId: string; secretKey: Uint8Array };
  private port: number = 0;
  private contacts: ContactStore;

  constructor(options: QuickClientOptions) {
    this.options = {
      namespace: 'local',
      enableMdns: true,
      capabilities: ['adp:ping', 'adp:capability.query'],
      ...options,
    };
    this.contacts = new ContactStore();
  }

  /** 获取本 Agent 的 ID */
  get agentId(): string {
    return this.identity?.agentId ?? '';
  }

  /** 获取当前已发现的 peers */
  get peerList(): QuickPeer[] {
    return Array.from(this.peers.values()).sort((a, b) => b.lastSeen - a.lastSeen);
  }

  /**
   * 启动 Agent，建立网络连接。
   * 会自动：生成身份、启动 Gateway、连接 Relay/Registry、开始 mDNS 发现。
   */
  async start(): Promise<void> {
    const { name, namespace, displayName, capabilities, enableMdns, port, relayUrl, registryUrl, registryToken, handlers } = this.options;

    // 1. 生成或加载身份（Ed25519 密钥对）
    const { identity } = loadOrCreateIdentity(namespace!, name, displayName || name);
    this.identity = { agentId: identity.agentId, secretKey: identity.secretKey };

    // 2. 找一个可用端口
    this.port = port || await findAvailablePortSequential(9900);

    // 3. 加载已保存的联系人
    await this.contacts.load();

    // 4. 启动 Gateway（WebSocket 服务端）
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

    // 5. 连接 Relay（如果配置了）
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

    // 6. 注册到 Registry（如果配置了）
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

    // 7. 启动 mDNS 局域网发现
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

    // 8. 加载已保存的联系人作为 peers
    for (const cid of this.contacts.listAgentIds()) {
      const routes = this.contacts.getRoutes(cid);
      if (routes && routes.length > 0) {
        const direct = routes.find(r => r.type === 'direct');
        if (direct?.address) {
          this.addPeer(cid, { address: direct.address });
        }
      }
    }

    console.log(`[ADP] Agent started: ${identity.agentId}`);
    console.log(`[ADP] Gateway: ws://localhost:${this.port}/adp`);
  }

  /**
   * 主动发现网络中的 peers。
   * 如果启用了 mDNS，会在局域网内自动发现。
   * 如果连接了 Registry，可以从 Registry 查询。
   */
  async discover(timeoutMs: number = 5000): Promise<QuickPeer[]> {
    // 如果已连接 Registry，尝试从 Registry 获取
    // 注：Registry 列表功能需要额外实现 HTTP GET /v1/agents 调用
    // 这里仅展示架构，实际使用时可扩展 RegistryClient 或直接 HTTP 请求

    // 等待一段时间让 mDNS 发现新的 peer
    if (this.discovery && timeoutMs > 0) {
      await new Promise(r => setTimeout(r, timeoutMs));
    }

    return this.peerList;
  }

  /**
   * 调用指定 Agent 的某个能力。
   * 会自动建立 WebSocket 连接、发送签名消息、等待响应。
   *
   * @param targetAgentId 目标 Agent ID
   * @param action 能力名称，如 'custom:video.generate'
   * @param params 调用参数
   * @param timeoutMs 超时时间，默认 10 秒
   * @returns 对方的响应参数
   */
  async call(
    targetAgentId: string,
    action: string,
    params: Record<string, unknown> = {},
    timeoutMs: number = 10000,
  ): Promise<Record<string, unknown>> {
    const peer = this.peers.get(targetAgentId);
    if (!peer) {
      throw new Error(`Peer not found: ${targetAgentId}. Call discover() first.`);
    }

    const address = peer.address === '__relay__' ? peer.address : peer.address;
    const ws = await connectToAgent(targetAgentId, address, this.identity.agentId);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error(`Call to ${action} on ${targetAgentId} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      ws.on('message', (raw: Buffer) => {
        clearTimeout(timeout);
        try {
          const env = JSON.parse(raw.toString());
          ws.close();
          resolve(env.params || {});
        } catch (err) {
          ws.close();
          reject(new Error(`Failed to parse response: ${(err as Error).message}`));
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      const msg = signEnvelope({
        protocol: PROTOCOL_VERSION,
        id: generateMessageId(),
        from: this.identity.agentId,
        to: targetAgentId,
        action,
        params,
        timestamp: new Date().toISOString(),
      }, this.identity.secretKey, canonicalize);

      ws.send(JSON.stringify(msg));
    });
  }

  /**
   * 向指定 Agent 发送 ping，检查是否可达。
   */
  async ping(targetAgentId: string, timeoutMs: number = 5000): Promise<{ success: boolean; uptime?: number; error?: string }> {
    try {
      const result = await this.call(targetAgentId, 'adp:ping', {}, timeoutMs);
      return { success: true, uptime: result.uptime as number | undefined };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * 查询指定 Agent 的能力列表和 manifest。
   */
  async queryCapabilities(targetAgentId: string, timeoutMs: number = 5000): Promise<Record<string, unknown> | null> {
    try {
      const result = await this.call(targetAgentId, 'adp:capability.query', {}, timeoutMs);
      return (result.manifest as Record<string, unknown>) || result;
    } catch {
      return null;
    }
  }

  /** 关闭所有连接 */
  async stop(): Promise<void> {
    this.discovery?.shutdown();
    this.relayClient?.close();
    this.registryClient?.deregister?.().catch(() => {});
    this.gateway?.close();
  }

  // --------------------------------------------------------------------------
  // 内部方法
  // --------------------------------------------------------------------------

  private addPeer(agentId: string, info: Partial<QuickPeer>): void {
    const existing = this.peers.get(agentId);
    this.peers.set(agentId, {
      agentId,
      displayName: info.displayName ?? existing?.displayName,
      address: info.address ?? existing?.address ?? '',
      lastSeen: Date.now(),
    });
  }

  private wrapHandler(handler: QuickHandler, ws: WebSocket, envelope: any): Promise<void> {
    return new Promise((resolve) => {
      const msg: QuickMessage = {
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
        ws.send(JSON.stringify(response));
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
// 辅助函数
// ============================================================================

/**
 * 快速发送一条消息到指定 Agent（无需启动本地 Gateway）。
 * 适用于一次性调用，比如命令行工具。
 *
 * 注意：这不会启动本地服务，只是作为临时客户端发送一条消息。
 */
export async function quickCall(
  targetAddress: string,
  targetAgentId: string,
  action: string,
  params: Record<string, unknown> = {},
  options: { name?: string; timeoutMs?: number } = {},
): Promise<Record<string, unknown>> {
  const { identity } = loadOrCreateIdentity('local', options.name || 'temp-client', 'TempClient');

  const ws = await connectToAgent(targetAgentId, targetAddress, identity.agentId);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Timeout'));
    }, options.timeoutMs || 10000);

    ws.on('message', (raw: Buffer) => {
      clearTimeout(timeout);
      try {
        const env = JSON.parse(raw.toString());
        ws.close();
        resolve(env.params || {});
      } catch (err) {
        ws.close();
        reject(err);
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
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
}
