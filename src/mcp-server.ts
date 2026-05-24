import * as os from 'os';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod/v4';

import {
  Gateway, connectToAgent,
  loadOrCreateIdentity, generateMessageId,
  Discovery, RelayClient, RegistryClient, ContactStore,
  signEnvelope, canonicalize,
  STANDARD_CAPABILITIES,
  findAvailablePort,
  type DiscoveredPeer, type Manifest, type Route, type Capability,
  type CommunicationConfig
} from './index';

const PROTOCOL_VERSION = 'adp/0.2';

function log(...args: unknown[]) {
  process.stderr.write(`[ADP] ${args.join(' ')}\n`);
}

interface PeerInfo {
  agentId: string;
  displayName?: string;
  routes: Route[];
  lastSeen: number;
}

export interface AdpMcpConfig {
  tag: string;
  namespace?: string;
  agentName?: string;
  relayUrl?: string;
  registryUrl?: string;
  registryToken?: string;
  portBase?: number;
  displayName?: string;
  capabilities?: (string | Capability)[];
  description?: string;
  communication?: CommunicationConfig;
}

export class AdpMcpServer {
  private gateway: Gateway | null = null;
  private discovery: Discovery | null = null;
  private relayClient: RelayClient | null = null;
  private registryClient: RegistryClient | null = null;
  private contacts: ContactStore | null = null;
  private mcp: McpServer;

  private peers: Map<string, PeerInfo> = new Map();
  private peerManifests: Map<string, Manifest> = new Map();

  private identity!: { agentId: string; secretKey: Uint8Array };
  private port!: number;

  constructor(private config: AdpMcpConfig) {
    this.mcp = new McpServer(
      { name: 'adp-agent', version: '0.2.0' },
      {
        capabilities: { tools: {}, resources: {} },
        instructions: 'ADP Agent Discovery Protocol - discover and communicate with agents in the ADP network',
      }
    );
    this.registerTools();
    this.registerResources();
  }

  private registerTools(): void {
    this.mcp.registerTool(
      'adp_list_peers',
      {
        description: '列出当前网络中所有发现的 ADP 对等代理。返回 agent ID、display name、路由信息。',
      },
      async () => {
        const peers = this.getPeerList();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ peers, count: peers.length }, null, 2) }],
        };
      }
    );

    this.mcp.registerTool(
      'adp_get_agent_info',
      {
        description: '获取当前 ADP MCP 服务器（本代理）的信息，包括 agent ID、manifest、协议版本。',
      },
      async () => {
        const info = {
          agent_id: this.identity.agentId,
          protocol: PROTOCOL_VERSION,
          port: this.port,
          namespace: this.config.namespace || 'local',
          relay_connected: this.relayClient?.isConnected() ?? false,
          registry_registered: this.registryClient?.isRegistered() ?? false,
          peer_count: this.peers.size,
        };

        if (this.gateway) {
          const manifest = this.gateway.getManifest();
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ ...info, manifest }, null, 2) }],
          };
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(info, null, 2) }],
        };
      }
    );

    this.mcp.registerTool(
      'adp_ping',
      {
        description: '向指定的 ADP 代理发送 adp:ping 消息并等待响应。返回代理的 uptime 信息。',
        inputSchema: {
          agent_id: z.string().describe('目标代理的完整 Agent ID，如 adp://pubkey@ns/name'),
        },
      },
      async ({ agent_id }: { agent_id: string }) => {
        const result = await this.pingPeer(agent_id as string);
        if (!result.success) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }, null, 2) }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result.response, null, 2) }],
        };
      }
    );

    this.mcp.registerTool(
      'adp_query_capabilities',
      {
        description: '查询指定 ADP 代理的能力（capabilities）列表。返回该代理完整的 manifest。',
        inputSchema: {
          agent_id: z.string().describe('目标代理的完整 Agent ID，如 adp://pubkey@ns/name'),
        },
      },
      async ({ agent_id }: { agent_id: string }) => {
        const manifest = await this.queryPeerCapabilities(agent_id as string);
        if (!manifest) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Failed to query capabilities' }, null, 2) }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(manifest, null, 2) }],
        };
      }
    );
  }

  private registerResources(): void {
    this.mcp.registerResource(
      'adp-peers',
      'adp://peers',
      { description: '当前 ADP 网络中所有已发现的对等代理列表', mimeType: 'application/json' },
      async () => {
        const peers = this.getPeerList();
        return {
          contents: [{ uri: 'adp://peers', mimeType: 'application/json', text: JSON.stringify({ peers, count: peers.length }, null, 2) }],
        };
      }
    );

    this.mcp.registerResource(
      'adp-manifest',
      'adp://manifest',
      { description: '当前 MCP 服务器的 ADP manifest', mimeType: 'application/json' },
      async () => {
        const manifest = this.gateway?.getManifest() ?? {};
        return {
          contents: [{ uri: 'adp://manifest', mimeType: 'application/json', text: JSON.stringify(manifest, null, 2) }],
        };
      }
    );

    this.mcp.registerResource(
      'adp-peer-manifest',
      new ResourceTemplate('adp://peers/{peerId}/manifest', { list: undefined }),
      { description: '指定对等代理的 manifest（通过 agent_id 查询）', mimeType: 'application/json' },
      async (uri, _variables) => {
        const peerId = _variables.peerId as string;
        const cached = this.peerManifests.get(peerId);
        if (cached) {
          return {
            contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(cached, null, 2) }],
          };
        }
        const manifest = await this.queryPeerCapabilities(peerId);
        if (!manifest) {
          return {
            contents: [{ uri: uri.href, mimeType: 'text/plain', text: 'Peer manifest not available' }],
          };
        }
        return {
          contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(manifest, null, 2) }],
        };
      }
    );
  }

  private getPeerList(): Array<{ agent_id: string; display_name?: string; routes: PeerInfo['routes']; last_seen: number }> {
    const list: Array<{ agent_id: string; display_name?: string; routes: PeerInfo['routes']; last_seen: number }> = [];
    for (const [agentId, info] of this.peers) {
      list.push({
        agent_id: agentId,
        display_name: info.displayName,
        routes: info.routes,
        last_seen: info.lastSeen,
      });
    }
    list.sort((a, b) => b.last_seen - a.last_seen);
    return list;
  }

  private addPeer(agentId: string, info: Partial<PeerInfo>): void {
    const existing = this.peers.get(agentId);
    this.peers.set(agentId, {
      agentId,
      displayName: info.displayName ?? existing?.displayName,
      routes: info.routes ?? existing?.routes ?? [],
      lastSeen: Date.now(),
    });
  }

  private async pingPeer(targetAgentId: string): Promise<{ success: boolean; response?: unknown; error?: string }> {
    const addr = this.resolvePeerAddress(targetAgentId);
    if (!addr) {
      return { success: false, error: `找不到目标代理 ${targetAgentId} 的路由地址` };
    }

    try {
      const ws = await connectToAgent(targetAgentId, addr, this.identity.agentId);
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          ws.close();
          resolve({ success: false, error: 'Ping 超时' });
        }, 10_000);

        ws.on('message', (raw: Buffer) => {
          clearTimeout(timeout);
          try {
            const env = JSON.parse(raw.toString());
            ws.close();
            resolve({ success: true, response: { action: env.action, params: env.params } });
          } catch {
            ws.close();
            resolve({ success: true, response: { raw: raw.toString() } });
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
          action: 'adp:ping',
          params: { via: 'mcp' },
          timestamp: new Date().toISOString(),
        }, this.identity.secretKey, canonicalize)));
      });
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  private async queryPeerCapabilities(targetAgentId: string): Promise<Manifest | null> {
    const addr = this.resolvePeerAddress(targetAgentId);
    if (!addr) {
      log(`无法解析 ${targetAgentId} 的地址`);
      return null;
    }

    try {
      const ws = await connectToAgent(targetAgentId, addr, this.identity.agentId);
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          ws.close();
          resolve(null);
        }, 10_000);

        ws.on('message', (raw: Buffer) => {
          clearTimeout(timeout);
          try {
            const env = JSON.parse(raw.toString());
            ws.close();
            if (env.params?.manifest) {
              this.peerManifests.set(targetAgentId, env.params.manifest);
              resolve(env.params.manifest as Manifest);
            } else {
              resolve(env.params as Manifest);
            }
          } catch {
            ws.close();
            resolve(null);
          }
        });

        ws.on('error', () => {
          clearTimeout(timeout);
          resolve(null);
        });

        ws.send(JSON.stringify(signEnvelope({
          protocol: PROTOCOL_VERSION,
          id: generateMessageId(),
          from: this.identity.agentId,
          to: targetAgentId,
          action: 'adp:capability.query',
          params: {},
          timestamp: new Date().toISOString(),
        }, this.identity.secretKey, canonicalize)));
      });
    } catch {
      return null;
    }
  }

  private resolvePeerAddress(agentId: string): string | null {
    const peer = this.peers.get(agentId);
    if (!peer) return null;

    const directRoute = peer.routes.find(r => r.type === 'direct' && r.address);
    if (directRoute?.address) return directRoute.address;

    const relayRoute = peer.routes.find(r => r.type === 'relay');
    if (relayRoute && this.relayClient?.isConnected()) {
      return '__relay__';
    }

    return null;
  }

  async start(): Promise<void> {
    const tag = this.config.tag;
    const ns = this.config.namespace || 'local';
    const name = this.config.agentName || tag.replace('agent', 'peer-');

    const { identity, isNew } = loadOrCreateIdentity(ns, name, tag);
    this.identity = { agentId: identity.agentId, secretKey: identity.secretKey };

    log(`Agent ID: ${identity.agentId}`);

    const portBase = this.config.portBase || 9900;
    this.port = await findAvailablePort(portBase);

    this.contacts = new ContactStore();
    await this.contacts.load();

    const displayName = this.config.displayName || tag.toUpperCase();
    const capabilities = this.config.capabilities || STANDARD_CAPABILITIES;

    this.gateway = new Gateway({
      port: this.port,
      host: '0.0.0.0',
      secretKey: identity.secretKey,
      agentId: identity.agentId,
      displayName,
      capabilities,
      description: this.config.description,
      skipVerification: false,
      tofuEnabled: true,
      contacts: this.contacts,
      communication: this.config.communication,
    });

    log(`Gateway listening on port ${this.port}`);

    const relayUrl = this.config.relayUrl;
    if (relayUrl) {
      log(`Connecting to relay: ${relayUrl}`);
      this.relayClient = new RelayClient(relayUrl, identity.agentId, {
        onWelcome: (sid) => log(`Relay session: ${sid}`),
        onMessage: (msg) => this.gateway?.processRelayMessage(msg).catch(err => {
          console.warn('[ADP] Failed to process relay message:', err);
        }),
        onPeerUpdate: (type, peerAgentId) => {
          if (type === 'peer_joined') {
            log(`Peer joined via relay: ${peerAgentId}`);
            this.addPeer(peerAgentId, { routes: [{ type: 'relay', relay: relayUrl }] });
          } else {
            log(`Peer left: ${peerAgentId}`);
            this.peers.delete(peerAgentId);
          }
        },
      });
      await this.relayClient.connect();
    }

    const registryUrl = this.config.registryUrl;
    if (registryUrl) {
      const token = this.config.registryToken;
      const routes: Route[] = [{ type: 'direct', address: `${getLanIp()}:${this.port}` }];
      this.registryClient = new RegistryClient({
        registryUrl,
        agentId: identity.agentId,
        manifest: this.gateway.getManifest(),
        routes,
        token,
        secretKey: identity.secretKey,
      });
      try {
        await this.registryClient.register();
        log('Registered with registry');
      } catch (err) {
        log(`Registry registration failed: ${(err as Error).message}`);
      }
    }

    if (!relayUrl) {
      log('Starting mDNS discovery');
      this.discovery = new Discovery(identity.agentId, this.port, {
        onPeerDiscovered: (peer: DiscoveredPeer) => {
          this.addPeer(peer.agentId, {
            displayName: peer.agentId.split('/').pop(),
            routes: [{ type: 'direct', address: `${peer.host}:${peer.port}` }],
          });
        },
        onPeerLost: (agentId: string) => {
          this.peers.delete(agentId);
        },
      });
      this.discovery.start();
    }

    const contactIds = this.contacts.listAgentIds();
    for (const cid of contactIds) {
      const routes = this.contacts.getRoutes(cid);
      if (routes) {
        this.addPeer(cid, {
          routes: routes.map(r => ({ type: r.type, address: r.address, relay: r.relay, session_id: r.session_id })),
        });
      }
    }
  }

  async connect(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.mcp.connect(transport);
    log('MCP server connected via stdio');
  }

  async shutdown(): Promise<void> {
    this.relayClient?.close();
    this.discovery?.shutdown();
    this.gateway?.close();
    await this.mcp.close();
  }
}

function getLanIp(): string {
  const interfaces = os.networkInterfaces();
  for (const [, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  return 'localhost';
}
