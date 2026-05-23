import http from 'http';
import https from 'https';
import { randomBytes } from 'crypto';
import { Manifest, Route } from '../manifest';
import { Envelope } from '../envelope';
import { signEnvelope } from '../crypto';
import { canonicalize } from '../canonical';

export interface RegistryClientOptions {
  registryUrl: string;
  agentId: string;
  manifest: Manifest;
  routes: Route[];
  refreshIntervalMs?: number;
  token?: string;
  secretKey?: Uint8Array;
}

export interface RegistryRegistration {
  initial_id: string;
  current_agent_id?: string;
  status: string;
  expires_at: string;
}

export class RegistryClient {
  private registryUrl: string;
  private agentId: string;
  private manifest: Manifest;
  private routes: Route[];
  private refreshIntervalMs: number;
  private refreshTimer: NodeJS.Timeout | null = null;
  private registered: boolean = false;
  private token?: string;
  private secretKey?: Uint8Array;
  private lastSyncedRoutes: string = '';
  private consecutiveFailures: number = 0;

  constructor(options: RegistryClientOptions) {
    this.registryUrl = options.registryUrl.replace(/\/$/, '');
    if (options.token && this.registryUrl.startsWith('http://')) {
      console.warn('[ADP Registry Client] ⚠️  Bearer token sent over HTTP — use HTTPS in production.');
    }
    this.agentId = options.agentId;
    this.manifest = options.manifest;
    this.routes = options.routes;
    this.token = options.token;
    this.secretKey = options.secretKey;
    this.refreshIntervalMs = Math.min(
      options.refreshIntervalMs || 3600_000,
      3600_000
    );
  }

  async register(): Promise<RegistryRegistration> {
    const body = JSON.stringify({
      agent_id: this.agentId,
      manifest: this.manifest,
      routes: this.routes,
    });

    try {
      const response = await this.request('POST', '/v1/agents', body);
      this.registered = true;
      this.lastSyncedRoutes = JSON.stringify(this.routes);

      const ttlSeconds = (new Date(response.expires_at).getTime() - Date.now()) / 1000;
      const ttlFromResponse = response.expires_at
        ? Math.max(1, Math.floor(ttlSeconds * 1000))
        : this.refreshIntervalMs;

      this.startRefresh(Math.min(ttlFromResponse, this.refreshIntervalMs));

      console.log(`📋 Registered with Registry: ${this.agentId}`);
      return response;
    } catch (err) {
      throw err;
    }
  }

  async updateManifest(manifest: Manifest, routes: Route[]): Promise<void> {
    this.manifest = manifest;
    this.routes = routes;

    if (this.registered) {
      const body = JSON.stringify({
        agent_id: this.agentId,
        manifest: this.manifest,
        routes: this.routes,
      });

      await this.request('PUT', `/v1/agents/${encodeURIComponent(this.agentId)}`, body);
      this.lastSyncedRoutes = JSON.stringify(routes);
      console.log(`🔄 Registry updated: ${this.agentId}`);
    }
  }

  async updateWithRotation(
    rotationEnvelope: Envelope,
    newManifest: Manifest,
    newRoutes: Route[],
    newAgentId: string
  ): Promise<void> {
    const body = JSON.stringify({
      agent_id: newAgentId,
      manifest: newManifest,
      routes: newRoutes,
      rotation: rotationEnvelope,
    });

    await this.request('PUT', `/v1/agents/${encodeURIComponent(this.agentId)}`, body);

    this.manifest = newManifest;
    this.routes = newRoutes;
    this.agentId = newAgentId;
    this.lastSyncedRoutes = JSON.stringify(newRoutes);

    console.log(`🔑 Registry updated with key rotation: ${this.agentId}`);
  }

  async deregister(): Promise<void> {
    if (!this.registered) return;

    try {
      await this.request('DELETE', `/v1/agents/${encodeURIComponent(this.agentId)}`);
      this.stopRefresh();
      this.registered = false;
      console.log(`🗑️  Deregistered from Registry: ${this.agentId}`);
    } catch (err) {
      console.warn('[ADP Registry Client] Failed to deregister:', err);
    }
  }

  async refresh(): Promise<void> {
    if (!this.registered) return;

    const currentRoutes = JSON.stringify(this.routes);
    if (currentRoutes !== this.lastSyncedRoutes) {
      const body = JSON.stringify({
        agent_id: this.agentId,
        manifest: this.manifest,
        routes: this.routes,
      });
      await this.request('PUT', `/v1/agents/${encodeURIComponent(this.agentId)}`, body);
      this.lastSyncedRoutes = currentRoutes;
      console.log(`🔄 Registry routes synced: ${this.agentId}`);
    } else {
      await this.request('POST', `/v1/agents/${encodeURIComponent(this.agentId)}/heartbeat`);
    }
  }

  private startRefresh(intervalMs: number): void {
    this.stopRefresh();
    const jitter = randomBytes(4).readUInt32BE(0) / 0xFFFFFFFF;
    const firstDelay = intervalMs * (0.5 + jitter * 0.5);
    this.scheduleRefresh(firstDelay, intervalMs);
  }

  private scheduleRefresh(delayMs: number, intervalMs: number): void {
    this.refreshTimer = setTimeout(async () => {
      let success = false;
      try {
        await this.refresh();
        success = true;
      } catch (err) {
        console.warn('[ADP Registry Client] Failed to refresh registration:', err);
      }

      if (success) {
        this.consecutiveFailures = 0;
        if (this.registered) {
          this.scheduleRefresh(intervalMs, intervalMs);
        }
      } else {
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= 3) {
          console.log(`⚠️  Registry unavailable, re-registering...`);
          this.consecutiveFailures = 0;
          this.registered = false;
          try {
            await this.register();
          } catch (err) {
            console.warn('[ADP Registry Client] Failed to re-register:', err);
            console.log(`⚠️  Re-registration failed, retrying in 30s...`);
            this.scheduleRefresh(30_000, intervalMs);
          }
        } else {
          this.scheduleRefresh(60_000, intervalMs);
        }
      }
    }, delayMs);
  }

  private stopRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private request(method: string, path: string, body?: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.registryUrl);
      const isHttps = url.protocol === 'https:';

      const headers: Record<string, string | number> = {
        'Content-Type': 'application/json',
        'Content-Length': body ? Buffer.byteLength(body) : 0,
      };

      if (this.token) {
        headers['Authorization'] = `Bearer ${this.token}`;
      }

      if (this.secretKey && body) {
        const bodyObj = JSON.parse(body);
        const timestamp = new Date().toISOString();

        const signedPayload: Record<string, unknown> = {};
        if (bodyObj.agent_id) signedPayload.agent_id = bodyObj.agent_id;
        if (bodyObj.manifest) signedPayload.manifest = bodyObj.manifest;
        if (bodyObj.routes) signedPayload.routes = bodyObj.routes;
        if (bodyObj.rotation) signedPayload.rotation = bodyObj.rotation;
        signedPayload.timestamp = timestamp;

        const signed = signEnvelope(signedPayload, this.secretKey, canonicalize) as Record<string, unknown>;
        headers['X-ADP-Signature'] = signed.sig as string;
        headers['X-ADP-Timestamp'] = timestamp;
      }

      const options: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method,
        headers,
        timeout: 10_000,
      };

      const transport = isHttps ? https : http;
      const req = transport.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = data ? JSON.parse(data) : {};
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(parsed);
            } else if (res.statusCode === 409) {
              // 已存在，当作用 UP 刷新
              resolve(parsed);
            } else {
              reject(new Error(
                `Registry responded with ${res.statusCode}: ${parsed.error?.message || data}`
              ));
            }
          } catch {
            reject(new Error(`Registry responded with ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Registry request timeout'));
      });
      req.on('error', (err) => {
        reject(new Error(`Registry connection failed: ${err.message}`));
      });

      if (body) {
        req.write(body);
      }
      req.end();
    });
  }

  close(): void {
    this.stopRefresh();
  }

  isRegistered(): boolean {
    return this.registered;
  }

  getManifest(): Manifest {
    return this.manifest;
  }
}
