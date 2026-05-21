import * as http from 'http';
import * as https from 'https';
import { WebSocketServer, WebSocket } from 'ws';

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
}

export class Relay {
  private server: http.Server | https.Server;
  private wss: WebSocketServer;
  private sessions: Map<string, Session> = new Map();
  private agentSessions: Map<string, Set<string>> = new Map();
  private offlineCache: CachedMessage[] = [];
  private heartbeatTimer: NodeJS.Timeout | null = null;

  private maxConnections: number;
  private heartbeatIntervalMs: number;
  private heartbeatTimeoutMs: number;
  private offlineMaxAgeMs: number;
  private offlineMaxPerAgent: number;

  constructor(options: RelayOptions) {
    this.maxConnections = options.maxConnections ?? 10000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15000;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 45000;
    this.offlineMaxAgeMs = options.offlineMaxAgeMs ?? 24 * 60 * 60 * 1000;
    this.offlineMaxPerAgent = options.offlineMaxPerAgent ?? 500;

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
  }

  private handleConnection(ws: WebSocket, req: http.IncomingMessage): void {
    const url = new URL(req.url || '/', `http://localhost`);
    const agentId = url.searchParams.get('agent_id') || '';

    if (this.sessions.size >= this.maxConnections) {
      ws.send(JSON.stringify({ type: 'busy' }));
      ws.close();
      return;
    }

    const sessionId = 'sess_' + Math.random().toString(36).slice(2, 10);
    const now = Date.now();

    const session: Session = { ws, agentId, connectedAt: now, lastHeartbeat: now };
    this.sessions.set(sessionId, session);

    if (!this.agentSessions.has(agentId)) {
      this.agentSessions.set(agentId, new Set());
    }
    this.agentSessions.get(agentId)!.add(sessionId);

    ws.send(JSON.stringify({ type: 'welcome', session_id: sessionId }));

    this.deliverOfflineMessages(agentId, sessionId);

    ws.on('message', (data) => this.handleMessage(sessionId, agentId, data));

    ws.on('close', () => {
      this.sessions.delete(sessionId);
      const set = this.agentSessions.get(agentId);
      if (set) {
        set.delete(sessionId);
        if (set.size === 0) this.agentSessions.delete(agentId);
      }
    });

    ws.on('error', () => {});
  }

  private handleMessage(sessionId: string, fromAgentId: string, data: unknown): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      const msg = JSON.parse(data as string);

      if (msg.type === 'pong') {
        session.lastHeartbeat = Date.now();
        return;
      }

      if (msg.type === 'relay' && msg.to && msg.payload) {
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
    } catch {
    }
  }

  private cacheMessage(from: string, to: string, payload: unknown): void {
    this.offlineCache.push({ to, payload, storedAt: Date.now() });

    const perAgent = this.offlineCache.filter(m => m.to === to);
    while (perAgent.length > this.offlineMaxPerAgent) {
      const oldest = this.offlineCache.findIndex(m => m.to === to);
      if (oldest >= 0) this.offlineCache.splice(oldest, 1);
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

      for (const [id, session] of this.sessions) {
        if (now - session.lastHeartbeat > this.heartbeatTimeoutMs) {
          session.ws.close();
          this.sessions.delete(id);
          continue;
        }

        if (session.ws.readyState === WebSocket.OPEN) {
          session.ws.ping();
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
    this.wss.close();
    this.server.close();
  }
}

export interface RelayClientCallbacks {
  onWelcome?: (sessionId: string) => void;
  onBusy?: () => void;
  onMessage?: (envelope: unknown) => void;
  onClose?: () => void;
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
    this.relayUrl = relayUrl;
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

      const timeout = setTimeout(() => {
        reject(new Error('Relay connection timeout'));
      }, 10000);

      ws.on('open', () => {
        clearTimeout(timeout);
        // 连接成功，重置重连尝试计数
        this.reconnectAttempts = 0;
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());

          if (msg.type === 'welcome') {
            clearTimeout(timeout);
            this.callbacks.onWelcome?.(msg.session_id);
            this.startHeartbeat();
            resolve();
            return;
          }

          if (msg.type === 'busy') {
            clearTimeout(timeout);
            this.callbacks.onBusy?.();
            ws.close();
            reject(new Error('Relay busy'));
            return;
          }

          if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }));
            return;
          }

          if (msg.type === 'pong') {
            return;
          }

          this.callbacks.onMessage?.(msg);
        } catch {
        }
      });

      ws.on('close', () => {
        this.stopHeartbeat();
        this.callbacks.onClose?.();
        if (this.reconnect && this.ws === ws) {
          this.reconnectToRelay();
        }
      });

      ws.on('error', () => {});
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
      } catch {
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
