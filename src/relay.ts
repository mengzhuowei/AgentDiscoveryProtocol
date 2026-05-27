import * as http from 'http';
import * as https from 'https';
import { WebSocketServer, WebSocket } from 'ws';
import { randomBytes } from 'crypto';

interface Session {
  ws: WebSocket;
  agentId: string;
  connectedAt: number;
  lastHeartbeat: number;
}

interface CachedMessage {
  to: string;
  payload: unknown;
  storedAt: number;
}

export interface RelayOptions {
  host?: string;
  port: number;
  tls?: { cert: string; key: string };
  maxConnections?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  offlineMaxAgeMs?: number;
  offlineMaxPerAgent?: number;
  onCertExpiringSoon?: (daysLeft: number, expiryDate: Date) => void;
}

export class Relay {
  private server: http.Server | https.Server;
  private wss: WebSocketServer;
  private sessions: Map<string, Session> = new Map();
  private agentSessions: Map<string, Set<string>> = new Map();
  private offlineCache: CachedMessage[] = [];
  private relayedMessageIds: Set<string> = new Set();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private certCheckTimer: NodeJS.Timeout | null = null;

  private maxConnections: number;
  private heartbeatIntervalMs: number;
  private heartbeatTimeoutMs: number;
  private offlineMaxAgeMs: number;
  private offlineMaxPerAgent: number;
  private offlineMaxTotal: number;
  private onCertExpiringSoon?: (daysLeft: number, expiryDate: Date) => void;
  private currentTls: { cert: string; key: string } | undefined;

  constructor(options: RelayOptions) {
    this.maxConnections = options.maxConnections ?? 10000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15000;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 45000;
    this.offlineMaxAgeMs = options.offlineMaxAgeMs ?? 24 * 60 * 60 * 1000;
    this.offlineMaxPerAgent = options.offlineMaxPerAgent ?? 500;
    this.offlineMaxTotal = 50000;
    this.onCertExpiringSoon = options.onCertExpiringSoon;
    this.currentTls = options.tls;

    if (options.tls) {
      this.server = https.createServer({ cert: options.tls.cert, key: options.tls.key });
    } else {
      this.server = http.createServer();
    }

    this.server.on('request', (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        sessions: this.sessions.size,
        cached: this.offlineCache.length,
      }));
    });

    this.wss = new WebSocketServer({ server: this.server, path: '/adp/relay' });
    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));

    this.server.listen(options.port, options.host);
    this.startHeartbeat();
    this.startCertMonitor();
  }

  private getCertExpiry(certPem: string): Date | null {
    try {
      const x509 = new (require('node:crypto').X509Certificate)(certPem);
      return x509.validTo ? new Date(x509.validTo) : null;
    } catch {
      return null;
    }
  }

  private startCertMonitor(): void {
    if (!this.currentTls) return;

    const checkInterval = 60 * 60 * 1000; // 每小时检查一次
    this.certCheckTimer = setInterval(() => {
      if (!this.currentTls) return;

      const expiry = this.getCertExpiry(this.currentTls.cert);
      if (!expiry) return;

      const now = new Date();
      const daysLeft = Math.floor((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      // 30 天内过期时触发回调
      if (daysLeft <= 30 && daysLeft > 0) {
        this.onCertExpiringSoon?.(daysLeft, expiry);
      }
    }, checkInterval);

    // 启动时立即检查一次
    const expiry = this.getCertExpiry(this.currentTls.cert);
    if (expiry) {
      const now = new Date();
      const daysLeft = Math.floor((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (daysLeft <= 30 && daysLeft > 0) {
        this.onCertExpiringSoon?.(daysLeft, expiry);
      }
    }
  }

  // 更新 TLS 证书 (热更新)
  public updateTls(cert: string, key: string): void {
    this.currentTls = { cert, key };
    if (this.server instanceof https.Server) {
      this.server.setSecureContext({ cert, key });
    }
  }

  private handleConnection(ws: WebSocket, req: http.IncomingMessage): void {
    const url = new URL(req.url || '/', `http://localhost`);
    const agentId = url.searchParams.get('agent_id');

    if (!agentId) {
      ws.send(JSON.stringify({ type: 'error', message: 'Missing agent_id' }));
      ws.close();
      return;
    }

    if (this.sessions.size >= this.maxConnections) {
      ws.send(JSON.stringify({ type: 'busy' }));
      ws.close();
      return;
    }

    const sessionId = 'sess_' + randomBytes(8).toString('base64url');
    const now = Date.now();

    const session: Session = { ws, agentId, connectedAt: now, lastHeartbeat: now };
    this.sessions.set(sessionId, session);

    if (!this.agentSessions.has(agentId)) {
      this.agentSessions.set(agentId, new Set());
    }
    this.agentSessions.get(agentId)!.add(sessionId);

    ws.send(JSON.stringify({ type: 'welcome', session_id: sessionId }));

    const existingPeers = Array.from(this.agentSessions.keys()).filter(id => id !== agentId);
    if (existingPeers.length > 0) {
      ws.send(JSON.stringify({ type: 'peers_list', peers: existingPeers }));
    }

    this.broadcastToAll(agentId, { type: 'peer_joined', agent_id: agentId });

    this.deliverOfflineMessages(agentId, sessionId);

    ws.on('message', (data) => this.handleMessage(sessionId, agentId, data));

    ws.on('close', () => {
      const set = this.agentSessions.get(agentId);
      if (set) {
        set.delete(sessionId);
        if (set.size === 0) {
          this.agentSessions.delete(agentId);
          this.broadcastToAll(agentId, { type: 'peer_left', agent_id: agentId });
        }
      }
      this.sessions.delete(sessionId);
    });

    ws.on('pong', () => {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.lastHeartbeat = Date.now();
      }
    });

    ws.on('error', (err) => {
      console.warn('[ADP Relay] WebSocket error:', err);
    });
  }

  private handleMessage(sessionId: string, fromAgentId: string, data: unknown): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      const msg = JSON.parse(Buffer.isBuffer(data) ? data.toString() : data as string);

      if (msg.type === 'pong') {
        session.lastHeartbeat = Date.now();
        return;
      }

      if (msg.type === 'relay' && msg.to && msg.payload) {
        const payload = msg.payload as { from?: string; id?: string; sig?: string };

        // Guard against identity spoofing: sender must be the agentId they connected with
        if (payload.from !== fromAgentId) {
          console.warn(
            `[ADP Relay] Spoofing blocked: session ${fromAgentId} attempted to send as ${payload.from}`
          );
          return;
        }

        // Guard against replay: reject if we've already relayed this message id
        if (payload.id && this.relayedMessageIds.has(payload.id)) {
          console.warn(`[ADP Relay] Replay detected: ${payload.id}`);
          return;
        }
        if (payload.id) {
          this.relayedMessageIds.add(payload.id);
          if (this.relayedMessageIds.size > 100_000) {
            const oldest = this.oldestRelayedMessageId();
            if (oldest) this.relayedMessageIds.delete(oldest);
          }
        }

        const targetSessions = this.agentSessions.get(msg.to);

        if (targetSessions && targetSessions.size > 0) {
          for (const targetSessionId of targetSessions) {
            const target = this.sessions.get(targetSessionId);
            if (target && target.ws.readyState === WebSocket.OPEN) {
              target.ws.send(JSON.stringify(msg.payload));
            }
          }
        } else {
          this.cacheMessage(fromAgentId, msg.to, msg.payload);
        }
        return;
      }

      console.warn(`[ADP Relay] Unknown message type: ${(msg as { type?: string }).type} from ${fromAgentId}`);
    } catch (err) {
      console.warn('[ADP Relay] Failed to handle message:', err);
    }
  }

  private cacheMessage(_from: string, to: string, payload: unknown): void {
    if (this.offlineCache.length >= this.offlineMaxTotal) {
      const oldest = this.offlineCache.reduce((minIdx, msg, idx, arr) =>
        msg.storedAt < arr[minIdx].storedAt ? idx : minIdx, 0);
      this.offlineCache.splice(oldest, 1);
    }

    this.offlineCache.push({ to, payload, storedAt: Date.now() });

    while (this.offlineCache.filter(m => m.to === to).length > this.offlineMaxPerAgent) {
      const oldest = this.offlineCache.findIndex(m => m.to === to);
      if (oldest >= 0) this.offlineCache.splice(oldest, 1);
    }
  }

  private oldestRelayedMessageId(): string | undefined {
    for (const id of this.relayedMessageIds) return id;
    return undefined;
  }

  private broadcastToAll(excludeAgentId: string, message: object): void {
    for (const [id, session] of this.sessions) {
      if (session.agentId !== excludeAgentId && session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(JSON.stringify(message));
      }
    }
  }

  private deliverOfflineMessages(agentId: string, sessionId: string): void {
    const now = Date.now();
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const pending = this.offlineCache.filter(m =>
      m.to === agentId && (now - m.storedAt) < this.offlineMaxAgeMs
    );

    for (const msg of pending) {
      if (session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(JSON.stringify(msg.payload));
      }
    }

    this.offlineCache = this.offlineCache.filter(m => m.to !== agentId);
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      const expiredIds: string[] = [];

      for (const [id, session] of this.sessions) {
        if (now - session.lastHeartbeat > this.heartbeatTimeoutMs) {
          expiredIds.push(id);
          continue;
        }

        if (session.ws.readyState === WebSocket.OPEN) {
          session.ws.ping();
        }
      }

      for (const id of expiredIds) {
        const session = this.sessions.get(id);
        if (session) {
          session.ws.close();
          const agentId = session.agentId;
          this.sessions.delete(id);
          const agentSet = this.agentSessions.get(agentId);
          if (agentSet) {
            agentSet.delete(id);
            if (agentSet.size === 0) {
              this.agentSessions.delete(agentId);
              this.broadcastToAll(agentId, { type: 'peer_left', agent_id: agentId });
            }
          }
        }
      }

      this.offlineCache = this.offlineCache.filter(
        m => now - m.storedAt < this.offlineMaxAgeMs
      );
    }, this.heartbeatIntervalMs);
  }

  getSessionCount(): number {
    return this.sessions.size;
  }

  close(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.certCheckTimer) clearInterval(this.certCheckTimer);
    this.wss.close();
    this.server.close();
  }
}

export interface RelayClientCallbacks {
  onWelcome?: (sessionId: string) => void;
  onBusy?: () => void;
  onMessage?: (envelope: unknown) => void;
  onClose?: () => void;
  onPeerUpdate?: (type: 'peer_joined' | 'peer_left', agentId: string) => void;
}

export class RelayClient {
  private ws: WebSocket | null = null;
  private relayUrl: string;
  private agentId: string;
  private callbacks: RelayClientCallbacks;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnect: boolean;
  private heartbeatIntervalMs: number;
  private reconnectAttempts: number = 0;
  private maxReconnectDelayMs: number = 60000;
  private minReconnectDelayMs: number = 1000;

  constructor(
    relayUrl: string,
    agentId: string,
    callbacks: RelayClientCallbacks,
    options?: { reconnect?: boolean; heartbeatIntervalMs?: number; maxReconnectDelayMs?: number }
  ) {
    const url = new URL(relayUrl);
    if (url.pathname === '/') {
      url.pathname = '/adp/relay';
    }
    this.relayUrl = url.toString();
    this.agentId = agentId;
    this.callbacks = callbacks;
    this.reconnect = options?.reconnect ?? true;
    this.heartbeatIntervalMs = options?.heartbeatIntervalMs ?? 15000;
    this.maxReconnectDelayMs = options?.maxReconnectDelayMs ?? 60000;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${this.relayUrl}?agent_id=${encodeURIComponent(this.agentId)}`;
      const ws = new WebSocket(url);
      this.ws = ws;

      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (err) reject(err); else resolve();
      };

      const timeout = setTimeout(() => {
        finish(new Error('Relay connection timeout'));
      }, 10000);

      ws.on('open', () => {
        clearTimeout(timeout);
        this.reconnectAttempts = 0;
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());

          if (msg.type === 'welcome') {
            this.callbacks.onWelcome?.(msg.session_id);
            this.startHeartbeat();
            finish();
            return;
          }

          if (msg.type === 'busy') {
            this.callbacks.onBusy?.();
            ws.close();
            finish(new Error('Relay busy'));
            return;
          }

          if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }));
            return;
          }

          if (msg.type === 'pong') {
            return;
          }

          if (msg.type === 'peer_joined' || msg.type === 'peer_left') {
            this.callbacks.onPeerUpdate?.(msg.type, msg.agent_id);
            return;
          }

          if (msg.type === 'peers_list' && Array.isArray(msg.peers)) {
            for (const peerId of msg.peers) {
              this.callbacks.onPeerUpdate?.('peer_joined', peerId);
            }
            return;
          }

          if (msg.type === 'relay' && msg.payload) {
            this.callbacks.onMessage?.(msg.payload);
            return;
          }

          this.callbacks.onMessage?.(msg);
        } catch (err) {
          console.warn('[ADP Relay Client] Failed to parse relay message:', err);
        }
      });

      ws.on('close', () => {
        this.stopHeartbeat();
        this.callbacks.onClose?.();
        if (!settled) {
          finish(new Error('Relay connection closed unexpectedly'));
        }
        if (this.reconnect && this.ws === ws) {
          this.reconnectToRelay();
        }
      });

      ws.on('error', (err) => {
        if (!settled) {
          finish(new Error(`Relay connection error: ${err.message}`));
        }
      });
    });
  }

  send(to: string, envelope: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'relay', to, payload: envelope }));
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async reconnectToRelay(): Promise<void> {
    // 指数退避计算延迟
    const delay = Math.min(
      this.minReconnectDelayMs * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelayMs
    );
    // 增加重连计数
    this.reconnectAttempts++;

    console.log(`🔄 Reconnecting to relay in ${delay}ms (attempt ${this.reconnectAttempts})...`);

    setTimeout(async () => {
      try {
        await this.connect();
      } catch (err) {
        console.warn('[ADP Relay Client] Reconnection failed:', err);
      }
    }, delay);
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  close(): void {
    this.reconnect = false;
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
