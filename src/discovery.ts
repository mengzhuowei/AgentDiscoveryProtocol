import * as os from 'os';
import mDNS from 'multicast-dns';
import { parseAgentId } from './agent-id';
import { encodeBase64URL } from './crypto';

export interface DiscoveredPeer {
  agentId: string;
  host: string;
  port: number;
  protocol: string;
  lastSeen: number;
}

export interface DiscoveryCallbacks {
  onPeerDiscovered?: (peer: DiscoveredPeer) => void;
  onPeerLost?: (agentId: string) => void;
}

let sharedMdns: mDNS.MulticastDNS | null = null;

export function getSharedMdns(): mDNS.MulticastDNS {
  if (!sharedMdns) {
    sharedMdns = mDNS({ loopback: true });
  }
  return sharedMdns;
}

export function destroySharedMdns(): void {
  if (sharedMdns) {
    sharedMdns.destroy();
    sharedMdns = null;
  }
}

export class Discovery {
  private mdns: mDNS.MulticastDNS;
  private ownsMdns: boolean;
  private agentId: string;
  private port: number;
  private instanceName: string;
  private hostname: string;
  private callbacks: DiscoveryCallbacks;
  private peers: Map<string, DiscoveredPeer> = new Map();
  private announceTimer: NodeJS.Timeout | null = null;
  private browseTimer: NodeJS.Timeout | null = null;
  private staleTimer: NodeJS.Timeout | null = null;
  private running: boolean = false;

  constructor(
    agentId: string,
    port: number,
    callbacks: DiscoveryCallbacks = {},
    mdnsInstance?: mDNS.MulticastDNS
  ) {
    this.agentId = agentId;
    this.port = port;
    this.callbacks = callbacks;

    const parsed = parseAgentId(agentId);
    const shortId = encodeBase64URL(parsed.publicKey).slice(0, 12);
    this.instanceName = `${shortId}._adp._tcp.local`;
    this.hostname = `${shortId}.local`;

    if (mdnsInstance) {
      this.mdns = mdnsInstance;
      this.ownsMdns = false;
    } else {
      this.mdns = mDNS({ loopback: true });
      this.ownsMdns = true;
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    const queryHandler = this.createQueryHandler();
    const responseHandler = this.createResponseHandler();

    this.mdns.on('query', queryHandler);
    this.mdns.on('response', responseHandler);

    this.proactiveAnnounce();

    this.announceTimer = setInterval(() => this.proactiveAnnounce(), 60000);
    this.browseTimer = setInterval(() => this.browse(), 30000);
    this.staleTimer = setInterval(() => this.cleanStale(), 30000);

    this.browse();
  }

  private createQueryHandler(): (query: any) => void {
    return (query) => {
      for (const q of query.questions) {
        if (q.type === 'PTR' && q.name === '_adp._tcp.local') {
          this.mdns.respond({
            answers: [{
              name: '_adp._tcp.local',
              type: 'PTR',
              ttl: 120,
              data: this.instanceName,
            }],
            additionals: [
              {
                name: this.instanceName,
                type: 'SRV',
                ttl: 120,
                data: { target: this.hostname, port: this.port },
              },
              {
                name: this.instanceName,
                type: 'TXT',
                ttl: 120,
                data: Buffer.from(`agent_id=${this.agentId}\x00protocol=adp/0.2`),
              },
              {
                name: this.hostname,
                type: 'A',
                ttl: 120,
                data: this.getLocalIP(),
              },
            ],
          });
        }

        if (q.type === 'SRV' && q.name === this.instanceName) {
          this.mdns.respond({
            answers: [{
              name: this.instanceName,
              type: 'SRV',
              ttl: 120,
              data: { target: this.hostname, port: this.port },
            }],
          });
        }

        if (q.type === 'TXT' && q.name === this.instanceName) {
          this.mdns.respond({
            answers: [{
              name: this.instanceName,
              type: 'TXT',
              ttl: 120,
              data: Buffer.from(`agent_id=${this.agentId}\x00protocol=adp/0.2`),
            }],
          });
        }

        if ((q.type === 'A' || q.type === 'AAAA') && q.name === this.hostname) {
          this.mdns.respond({
            answers: [{
              name: this.hostname,
              type: 'A',
              ttl: 120,
              data: this.getLocalIP(),
            }],
          });
        }
      }
    };
  }

  private createResponseHandler(): (response: any) => void {
    return (response) => {
      const srvRecords: Record<string, { port: number; target: string }> = {};
      const txtRecords: Record<string, Buffer> = {};
      const aRecords: Record<string, string> = {};

      const allRecords = [
        ...(response.answers || []),
        ...(response.additionals || []),
      ];

      for (const a of allRecords) {
        if (a.type === 'SRV' && typeof a.data === 'object') {
          srvRecords[a.name] = a.data as unknown as { port: number; target: string };
        }
        if (a.type === 'TXT') {
          if (Buffer.isBuffer(a.data)) {
            txtRecords[a.name] = a.data;
          } else if (Array.isArray(a.data) && a.data.length > 0) {
            try {
              txtRecords[a.name] = Buffer.concat(
                (a.data as Buffer[]).map(b => Buffer.isBuffer(b) ? b : Buffer.from(b as Uint8Array))
              );
            } catch (err) {
              console.warn('[ADP Discovery] Failed to parse TXT record:', err);
            }
          }
        }
        if ((a.type === 'A' || a.type === 'AAAA') && typeof a.data === 'string') {
          aRecords[a.name] = a.data;
        }
      }

      for (const a of response.answers) {
        if (a.type === 'PTR' && a.name === '_adp._tcp.local') {
          const instanceName = a.data as string;
          if (instanceName === this.instanceName) continue;

          const srv = srvRecords[instanceName];
          const txtBuf = txtRecords[instanceName];

          if (srv && txtBuf) {
            const txt = this.parseTXT(txtBuf);
            if (txt.agent_id) {
              const resolvedHost = aRecords[srv.target] || srv.target;
              const peer: DiscoveredPeer = {
                agentId: txt.agent_id,
                host: resolvedHost,
                port: srv.port,
                protocol: txt.protocol || 'adp/0.2',
                lastSeen: Date.now(),
              };

              const existing = this.peers.get(txt.agent_id);
              this.peers.set(txt.agent_id, peer);

              if (!existing) {
                this.callbacks.onPeerDiscovered?.(peer);
              }
            }
          }
        }
      }
    };
  }

  private proactiveAnnounce(): void {
    this.mdns.respond({
      answers: [
        {
          name: '_adp._tcp.local',
          type: 'PTR',
          ttl: 120,
          data: this.instanceName,
        },
        {
          name: this.instanceName,
          type: 'SRV',
          ttl: 120,
          data: { target: this.hostname, port: this.port },
        },
        {
          name: this.instanceName,
          type: 'TXT',
          ttl: 120,
          data: Buffer.from(`agent_id=${this.agentId}\x00protocol=adp/0.2`),
        },
        {
          name: this.hostname,
          type: 'A',
          ttl: 120,
          data: this.getLocalIP(),
        },
      ],
    });
  }

  private browse(): void {
    this.mdns.query({
      questions: [{ name: '_adp._tcp.local', type: 'PTR' }],
    });
  }

  private cleanStale(): void {
    const now = Date.now();
    for (const [id, peer] of this.peers) {
      if (now - peer.lastSeen > 120_000) {
        this.peers.delete(id);
        this.callbacks.onPeerLost?.(id);
      }
    }
  }

  private parseTXT(buf: Buffer): Record<string, string> {
    const result: Record<string, string> = {};
    const text = buf.toString();
    for (const kv of text.split('\x00')) {
      const eq = kv.indexOf('=');
      if (eq > 0) {
        result[kv.slice(0, eq)] = kv.slice(eq + 1);
      }
    }
    return result;
  }

  private getLocalIP(): string {
    const nets = os.networkInterfaces();
    for (const iface of Object.values(nets)) {
      if (!iface) continue;
      for (const addr of iface) {
        if (addr.family === 'IPv4' && !addr.internal) {
          return addr.address;
        }
      }
    }
    return '127.0.0.1';
  }

  getPeers(): DiscoveredPeer[] {
    return Array.from(this.peers.values());
  }

  shutdown(): void {
    this.running = false;
    if (this.announceTimer) clearInterval(this.announceTimer);
    if (this.browseTimer) clearInterval(this.browseTimer);
    if (this.staleTimer) clearInterval(this.staleTimer);

    this.mdns.respond({
      answers: [
        { name: '_adp._tcp.local', type: 'PTR', ttl: 0, data: this.instanceName },
        { name: this.instanceName, type: 'SRV', ttl: 0, data: { target: this.hostname, port: this.port } },
        { name: this.instanceName, type: 'TXT', ttl: 0, data: Buffer.from('') },
      ],
      additionals: [
        { name: this.hostname, type: 'A', ttl: 0, data: this.getLocalIP() },
      ],
    });

    if (this.ownsMdns) {
      setTimeout(() => this.mdns.destroy(), 500);
    }
  }
}
