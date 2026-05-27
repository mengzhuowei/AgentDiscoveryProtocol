import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { Database } from './db';
import { Cache } from './cache';
import { RegistryConfig } from './config';
import { Manifest } from '../manifest';
import { Route } from '../manifest';
import { decodeBase64URL, verify, encodeBase64URL } from '../crypto';
import { extractPublicKey, parseAgentId } from '../agent-id';
import { canonicalize } from '../canonical';

export interface AgentRegistrationRequest {
  agent_id: string;
  manifest: Manifest;
  routes: Route[];
  rotation?: any;
  token?: string;
}

export class RegistryService {
  private app: express.Application;
  private db: Database;
  private cache: Cache;
  private config: RegistryConfig;
  private heartbeatQueue: Set<string> = new Set();
  private heartbeatDrainTimer: NodeJS.Timeout | null = null;
  private heartbeatBatchSize = 500;

  private rateLimitMap: Map<string, { count: number; resetAt: number }> = new Map();
  private rateLimitMax = 100;
  private rateLimitWindowMs = 60000;
  private rateLimitCleanupTimer: NodeJS.Timeout | null = null;

  constructor(config: RegistryConfig, db: Database, cache: Cache) {
    this.config = config;
    this.db = db;
    this.cache = cache;
    this.app = express();
    
    this.setupMiddleware();
    this.setupRoutes();
    this.startHeartbeatDrain();
    this.startRateLimitCleanup();
  }

  private startRateLimitCleanup(): void {
    this.rateLimitCleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [ip, entry] of this.rateLimitMap) {
        if (now > entry.resetAt) {
          this.rateLimitMap.delete(ip);
        }
      }
    }, this.rateLimitWindowMs);
  }

  private startHeartbeatDrain(): void {
    this.heartbeatDrainTimer = setInterval(() => {
      this.drainHeartbeats().catch(err => {
        console.error('Heartbeat drain error:', err);
      });
    }, 5000);
  }

  private setupMiddleware(): void {
    if (this.config.cors.enabled) {
      this.app.use(cors({
        origin: this.config.cors.origins
      }));
    }
    this.app.use(express.json({ limit: '1mb' }));

    this.app.use((req, res, next) => {
      console.log(`${req.method} ${req.path}`);
      next();
    });

    this.app.use((req, res, next) => {
      if (!this.checkRateLimit(req, res)) return;
      next();
    });
  }

  private checkRateLimit(req: Request, res: Response): boolean {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = this.rateLimitMap.get(ip);

    if (!entry || now > entry.resetAt) {
      this.rateLimitMap.set(ip, { count: 1, resetAt: now + this.rateLimitWindowMs });
    } else if (entry.count >= this.rateLimitMax) {
      res.status(429).json({
        error: { code: 'RATE_LIMITED', message: 'Too many requests' }
      });
      return false;
    } else {
      entry.count++;
    }
    return true;
  }

  private tokenAuth(req: Request, res: Response, next: NextFunction): void {
    if (!this.config.token.enabled) {
      next();
      return;
    }

    const token = req.body?.token ?? req.headers.authorization?.replace(/^Bearer\s+/i, '');

    if (!token) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Token is required'
        }
      });
      return;
    }

    const tokenEntries = this.config.token.tokens || {};
    const tokenEntry = tokenEntries[token];

    if (!tokenEntry) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid token'
        }
      });
      return;
    }

    (req as Request & { tokenNamespace?: string; tokenCapabilities?: string[] }).tokenNamespace =
      tokenEntry.namespace;
    (req as Request & { tokenNamespace?: string; tokenCapabilities?: string[] }).tokenCapabilities =
      tokenEntry.capabilities;

    next();
  }

  private signatureAuth(req: Request, res: Response, next: NextFunction): void {
    const signatureHeader = req.headers['x-adp-signature'] as string;
    if (!signatureHeader) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'X-ADP-Signature header is required for this operation'
        }
      });
      return;
    }

    const body = req.body;
    if (!body?.agent_id) {
      res.status(400).json({
        error: {
          code: 'INVALID_PARAMS',
          message: 'agent_id is required in request body for signature verification'
        }
      });
      return;
    }

    try {
      const sigBytes = decodeBase64URL(signatureHeader);
      if (sigBytes.length !== 64) {
        res.status(401).json({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid signature'
          }
        });
        return;
      }

      const publicKey = (() => {
        try {
          if (body.rotation && body.rotation.from) {
            return extractPublicKey(body.rotation.from);
          }
          return extractPublicKey(body.agent_id);
        } catch {
          return null;
        }
      })();
      if (!publicKey) {
        res.status(401).json({
          error: {
            code: 'INVALID_PARAMS',
            message: 'Invalid agent_id format'
          }
        });
        return;
      }

      const signedPayload: Record<string, unknown> = {};
      signedPayload.agent_id = body.agent_id;
      signedPayload.manifest = body.manifest;
      signedPayload.routes = body.routes;
      if (body.rotation) signedPayload.rotation = body.rotation;
      signedPayload.timestamp = req.headers['x-adp-timestamp'] || body.timestamp;

      const canonical = canonicalize(signedPayload);
      const messageBytes = new TextEncoder().encode(canonical);
      const isValid = verify(publicKey, messageBytes, sigBytes);

      if (!isValid) {
        res.status(401).json({
          error: {
            code: 'UNAUTHORIZED',
            message: 'X-ADP-Signature verification failed'
          }
        });
        return;
      }
    } catch {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid signature format'
        }
      });
      return;
    }

    next();
  }

  private setupRoutes(): void {
    this.app.get('/health', this.healthCheck.bind(this));

    this.app.post('/v1/agents', this.tokenAuth.bind(this), this.signatureAuth.bind(this), this.registerAgent.bind(this));
    this.app.put('/v1/agents/:initialId', this.tokenAuth.bind(this), this.signatureAuth.bind(this), this.updateAgent.bind(this));
    this.app.post('/v1/agents/:initialId/heartbeat', this.tokenAuth.bind(this), this.signatureAuth.bind(this), this.heartbeat.bind(this));
    this.app.get('/v1/agents/:initialId', this.getAgent.bind(this));
    this.app.delete('/v1/agents/:initialId', this.tokenAuth.bind(this), this.signatureAuth.bind(this), this.deleteAgent.bind(this));
    this.app.get('/v1/agents', this.searchAgents.bind(this));
  }

  private normalizeInitialId(raw: string | string[]): string | null {
    const decoded = decodeURIComponent(Array.isArray(raw) ? raw[0] : raw);
    if (decoded.startsWith('adp://')) {
      try {
        return encodeBase64URL(extractPublicKey(decoded));
      } catch {
        return null;
      }
    }
    return decoded;
  }

  private healthCheck(req: Request, res: Response): void {
    res.json({
      status: 'ok',
      version: '0.2.0',
      timestamp: new Date().toISOString()
    });
  }

  private async registerAgent(req: Request, res: Response): Promise<void> {
    try {
      const request: AgentRegistrationRequest = req.body;
      
      const validationError = this.validateRegistrationRequest(request);
      if (validationError) {
        res.status(400).json({
          error: {
            code: 'INVALID_PARAMS',
            message: validationError
          }
        });
        return;
      }

      const initialId = (() => {
        try {
          return encodeBase64URL(extractPublicKey(request.agent_id));
        } catch {
          return null;
        }
      })();
      if (!initialId) {
        res.status(400).json({
          error: {
            code: 'INVALID_PARAMS',
            message: 'Invalid agent_id format'
          }
        });
        return;
      }
      const parsed = (() => {
        try {
          return parseAgentId(request.agent_id);
        } catch {
          return null;
        }
      })();
      if (!parsed) {
        res.status(400).json({
          error: {
            code: 'INVALID_PARAMS',
            message: 'Invalid agent_id format'
          }
        });
        return;
      }

      const connection = await this.db.getConnection();
      try {
        const [existing] = await connection.execute(
          'SELECT expires_at FROM agents WHERE initial_id = ?',
          [initialId]
        );
        const rows = existing as any[];

        if (rows.length > 0) {
          const row = rows[0];
          const isExpired = new Date(row.expires_at) <= new Date();

          if (!isExpired) {
            res.status(409).json({
              error: {
                code: 'AGENT_ALREADY_EXISTS',
                message: 'Agent already registered, use PUT to update'
              }
            });
            return;
          }
        }

        const expiresAt = new Date(Date.now() + this.config.registration.ttlSeconds * 1000);

        await connection.execute(
          `INSERT INTO agents (initial_id, current_agent_id, namespace, manifest, routes, last_seen, expires_at)
           VALUES (?, ?, ?, ?, ?, NOW(), ?)
           ON DUPLICATE KEY UPDATE
           current_agent_id = VALUES(current_agent_id),
           namespace = VALUES(namespace),
           manifest = VALUES(manifest),
           routes = VALUES(routes),
           last_seen = NOW(),
           expires_at = VALUES(expires_at)`,
          [
            initialId,
            request.agent_id,
            parsed.namespace,
            JSON.stringify(request.manifest),
            JSON.stringify(request.routes),
            expiresAt
          ]
        );

        await connection.execute(
          'DELETE FROM agent_capabilities WHERE initial_id = ?',
          [initialId]
        );
        const capabilities = request.manifest.capabilities || [];
        for (const cap of capabilities) {
          const capName = typeof cap === 'string' ? cap : cap.capability;
          await connection.execute(
            'INSERT IGNORE INTO agent_capabilities (initial_id, capability) VALUES (?, ?)',
            [initialId, capName]
          );
        }

        const agentData = {
          initial_id: initialId,
          current_agent_id: request.agent_id,
          manifest: request.manifest,
          routes: request.routes,
          last_seen: new Date().toISOString(),
          expires_at: expiresAt.toISOString(),
          rotation_chain: [] as any[]
        };
        await this.cache.setAgent(initialId, agentData, this.config.registration.ttlSeconds);

        const alreadyExisted = rows.length > 0;
        res.status(alreadyExisted ? 200 : 201).json({
          initial_id: initialId,
          current_agent_id: request.agent_id,
          status: 'ok',
          expires_at: expiresAt.toISOString()
        });
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error'
        }
      });
    }
  }

  private async updateAgent(req: Request, res: Response): Promise<void> {
    try {
      const initialId = this.normalizeInitialId(req.params.initialId);
      if (!initialId) {
        res.status(400).json({
          error: {
            code: 'INVALID_PARAMS',
            message: 'Invalid agent_id format in URL'
          }
        });
        return;
      }
      const request: AgentRegistrationRequest = req.body;

      // Validate request
      const validationError = this.validateRegistrationRequest(request);
      if (validationError) {
        res.status(400).json({
          error: {
            code: 'INVALID_PARAMS',
            message: validationError
          }
        });
        return;
      }

      const connection = await this.db.getConnection();
      try {
        // Check if agent exists
        const [agents] = await connection.execute(
          'SELECT current_agent_id FROM agents WHERE initial_id = ?',
          [initialId]
        );
        if ((agents as any[]).length === 0) {
          res.status(404).json({
            error: {
              code: 'AGENT_NOT_FOUND',
              message: 'Agent not found'
            }
          });
          return;
        }

        const currentAgentId = (agents as any[])[0].current_agent_id;
        const currentPublicKey = encodeBase64URL(extractPublicKey(currentAgentId));
        const newPublicKey = (() => {
          try {
            return encodeBase64URL(extractPublicKey(request.agent_id));
          } catch {
            return null;
          }
        })();
        if (!newPublicKey) {
          res.status(400).json({
            error: {
              code: 'INVALID_PARAMS',
              message: 'Invalid agent_id format'
            }
          });
          return;
        }
        const isRotation = newPublicKey !== currentPublicKey;

        if (isRotation && !request.rotation) {
          res.status(400).json({
            error: {
              code: 'INVALID_PARAMS',
              message: 'Key rotation requires rotation envelope'
            }
          });
          return;
        }

        if (isRotation && request.rotation) {
          // Add to rotation chain
          const [maxSeq] = await connection.execute(
            'SELECT MAX(sequence) as max_seq FROM rotation_chain WHERE initial_id = ?',
            [initialId]
          );
          const nextSequence = ((maxSeq as any[])[0].max_seq ?? -1) + 1;
          
          await connection.execute(
            `INSERT INTO rotation_chain (initial_id, sequence, from_agent_id, to_agent_id, envelope) 
             VALUES (?, ?, ?, ?, ?)`,
            [
              initialId,
              nextSequence,
              currentAgentId,
              request.agent_id,
              JSON.stringify(request.rotation)
            ]
          );
          
          // Invalidate rotation cache so it's rebuilt from DB on next read
          await this.cache.deleteRotationChain(initialId);
        }

        // Calculate new expires_at
        const expiresAt = new Date(Date.now() + this.config.registration.ttlSeconds * 1000);
        
        // Update agent
        const parsed = (() => {
          try {
            return parseAgentId(request.agent_id);
          } catch {
            return null;
          }
        })();
        if (!parsed) {
          res.status(400).json({
            error: {
              code: 'INVALID_PARAMS',
              message: 'Invalid agent_id format'
            }
          });
          return;
        }

        await connection.execute(
          `UPDATE agents 
           SET current_agent_id = ?, namespace = ?, manifest = ?, routes = ?, last_seen = NOW(), expires_at = ?
           WHERE initial_id = ?`,
          [
            request.agent_id,
            parsed.namespace,
            JSON.stringify(request.manifest),
            JSON.stringify(request.routes),
            expiresAt,
            initialId
          ]
        );

        // Update capabilities
        await connection.execute(
          'DELETE FROM agent_capabilities WHERE initial_id = ?',
          [initialId]
        );
        const capabilities = request.manifest.capabilities || [];
        for (const cap of capabilities) {
          const capName = typeof cap === 'string' ? cap : cap.capability;
          await connection.execute(
            'INSERT IGNORE INTO agent_capabilities (initial_id, capability) VALUES (?, ?)',
            [initialId, capName]
          );
        }

        // Get updated rotation chain
        const [chainResult] = await connection.execute(
          'SELECT envelope FROM rotation_chain WHERE initial_id = ? ORDER BY sequence ASC',
          [initialId]
        );
        const rotationChain = (chainResult as any[]).map(row => ({
          envelope: row.envelope
        }));

        // Update cache
        const agentData = {
          initial_id: initialId,
          current_agent_id: request.agent_id,
          manifest: request.manifest,
          routes: request.routes,
          last_seen: new Date().toISOString(),
          expires_at: expiresAt.toISOString(),
          rotation_chain: rotationChain
        };
        await this.cache.setAgent(initialId, agentData, this.config.registration.ttlSeconds);
        await this.cache.setRotationChain(initialId, rotationChain, this.config.registration.ttlSeconds);

        res.json({
          initial_id: initialId,
          current_agent_id: request.agent_id,
          status: 'ok',
          expires_at: expiresAt.toISOString()
        });
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Update error:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error'
        }
      });
    }
  }

  private async getAgent(req: Request, res: Response): Promise<void> {
    try {
      const initialId = this.normalizeInitialId(req.params.initialId);
      if (!initialId) {
        res.status(400).json({
          error: { code: 'INVALID_PARAMS', message: 'Invalid agent_id format in URL' }
        });
        return;
      }

      // Check cache first
      const cached = await this.cache.getAgent(initialId);
      if (cached) {
        const now = new Date();
        const expiresAt = new Date(cached.expires_at);
        const online = now < expiresAt;
        
        if (online) {
          res.json({
            ...cached,
            online: true
          });
          return;
        }
      }

      const connection = await this.db.getConnection();
      try {
        const [agents] = await connection.execute(
          'SELECT * FROM agents WHERE initial_id = ?',
          [initialId]
        );
        
        if ((agents as any[]).length === 0) {
          res.status(404).json({
            initial_id: initialId,
            online: false,
            error: {
              code: 'AGENT_NOT_FOUND',
              message: '未注册或注册已过期'
            }
          });
          return;
        }

        const agent = (agents as any[])[0];
        const now = new Date();
        const expiresAt = new Date(agent.expires_at);
        const online = now < expiresAt;

        // Get rotation chain
        const [chainResult] = await connection.execute(
          'SELECT envelope FROM rotation_chain WHERE initial_id = ? ORDER BY sequence ASC',
          [initialId]
        );
        const rotationChain = (chainResult as any[]).map(row => ({
          envelope: row.envelope
        }));

        const agentData = {
          initial_id: agent.initial_id,
          current_agent_id: agent.current_agent_id,
          online,
          manifest: JSON.parse(agent.manifest),
          routes: JSON.parse(agent.routes),
          rotation_chain: rotationChain,
          last_seen: agent.last_seen.toISOString()
        };

        // Cache the result
        if (online) {
          const ttl = Math.max(1, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
          await this.cache.setAgent(initialId, agentData, ttl);
          await this.cache.setRotationChain(initialId, rotationChain, ttl);
        }

        if (!online) {
          res.status(404).json({
            initial_id: initialId,
            online: false,
            error: {
              code: 'AGENT_NOT_FOUND',
              message: '未注册或注册已过期'
            }
          });
          return;
        }

        res.json(agentData);
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Get agent error:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error'
        }
      });
    }
  }

  private async deleteAgent(req: Request, res: Response): Promise<void> {
    try {
      const initialId = this.normalizeInitialId(req.params.initialId);
      if (!initialId) {
        res.status(400).json({
          error: { code: 'INVALID_PARAMS', message: 'Invalid agent_id format in URL' }
        });
        return;
      }

      const connection = await this.db.getConnection();
      try {
        await connection.execute('DELETE FROM agents WHERE initial_id = ?', [initialId]);
        
        await this.cache.deleteAgent(initialId);
        
        res.json({ status: 'ok' });
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Delete agent error:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error'
        }
      });
    }
  }

  private async heartbeat(req: Request, res: Response): Promise<void> {
    try {
      const initialId = this.normalizeInitialId(req.params.initialId);
      if (!initialId) {
        res.status(400).json({
          error: { code: 'INVALID_PARAMS', message: 'Invalid agent_id format in URL' }
        });
        return;
      }

      const cached = await this.cache.getAgent(initialId);
      if (!cached) {
        const connection = await this.db.getConnection();
        try {
          const [agents] = await connection.execute(
            'SELECT 1 FROM agents WHERE initial_id = ? AND expires_at > NOW()',
            [initialId]
          );
          if ((agents as any[]).length === 0) {
            res.status(404).json({
              error: {
                code: 'AGENT_NOT_FOUND',
                message: 'Agent not registered'
              }
            });
            return;
          }
        } finally {
          connection.release();
        }
      }

      this.heartbeatQueue.add(initialId);

      res.json({
        status: 'ok',
        expires_at: new Date(Date.now() + this.config.registration.ttlSeconds * 1000).toISOString()
      });
    } catch (error) {
      console.error('Heartbeat error:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error'
        }
      });
    }
  }

  private async drainHeartbeats(): Promise<void> {
    if (this.heartbeatQueue.size === 0) return;

    const oldQueue = this.heartbeatQueue;
    this.heartbeatQueue = new Set();
    const allIds = Array.from(oldQueue);

    const expiresAt = new Date(Date.now() + this.config.registration.ttlSeconds * 1000);

    for (let i = 0; i < allIds.length; i += this.heartbeatBatchSize) {
      const batch = allIds.slice(i, i + this.heartbeatBatchSize);
      const connection = await this.db.getConnection();
      try {
        const placeholders = batch.map(() => '?').join(',');
        await connection.execute(
          `UPDATE agents SET last_seen = NOW(), expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND) WHERE initial_id IN (${placeholders})`,
          [this.config.registration.ttlSeconds, ...batch]
        );
      } finally {
        connection.release();
      }

      for (const id of batch) {
        const cached = await this.cache.getAgent(id);
        if (cached) {
          cached.last_seen = new Date().toISOString();
          cached.expires_at = expiresAt.toISOString();
          await this.cache.setAgent(id, cached, this.config.registration.ttlSeconds);
        }
      }
    }
  }

  private async searchAgents(req: Request, res: Response): Promise<void> {
    try {
      const namespace = req.query.namespace as string;
      const capability = req.query.capability as string;
      const cursor = req.query.cursor as string;
      const parsedLimit = parseInt(req.query.limit as string || '20', 10);
      const limit = Math.min(100, isNaN(parsedLimit) ? 20 : parsedLimit);
      const offset = cursor ? parseInt(Buffer.from(cursor, 'base64').toString(), 10) : 0;

      const connection = await this.db.getConnection();
      try {
        let query = `
          SELECT DISTINCT a.* 
          FROM agents a 
          WHERE a.expires_at > NOW()
        `;
        const params: any[] = [];

        if (namespace) {
          query += ' AND a.namespace = ?';
          params.push(namespace);
        }

        if (capability) {
          query += `
            AND EXISTS (
              SELECT 1 FROM agent_capabilities ac 
              WHERE ac.initial_id = a.initial_id 
              AND ac.capability = ?
            )
          `;
          params.push(capability);
        }

        query += ` ORDER BY a.last_seen DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        const [agents] = await connection.execute(query, params);
        const agentList = (agents as any[]);

        const results = [];
        if (agentList.length > 0) {
          const initialIds = agentList.map((a: any) => a.initial_id);
          const placeholders = initialIds.map(() => '?').join(',');
          const [chainResults] = await connection.execute(
            `SELECT initial_id, envelope FROM rotation_chain WHERE initial_id IN (${placeholders}) ORDER BY sequence ASC`,
            initialIds
          );
          const chainMap = new Map<string, any[]>();
          for (const row of (chainResults as any[])) {
            if (!chainMap.has(row.initial_id)) {
              chainMap.set(row.initial_id, []);
            }
            chainMap.get(row.initial_id)!.push({ envelope: row.envelope });
          }

          for (const agent of agentList) {
            results.push({
              initial_id: agent.initial_id,
              current_agent_id: agent.current_agent_id,
              manifest: JSON.parse(agent.manifest),
              routes: JSON.parse(agent.routes),
              rotation_chain: chainMap.get(agent.initial_id) || [],
              last_seen: agent.last_seen.toISOString()
            });
          }
        }

        const nextCursor = agentList.length < limit ? null : 
          Buffer.from(String(offset + limit)).toString('base64');

        res.json({
          agents: results,
          next_cursor: nextCursor
        });
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error('Search agents error:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error'
        }
      });
    }
  }

  private validateRegistrationRequest(request: AgentRegistrationRequest): string | null {
    if (!request.agent_id) {
      return 'agent_id is required';
    }
    if (!request.manifest) {
      return 'manifest is required';
    }
    if (!request.routes || !Array.isArray(request.routes) || request.routes.length === 0) {
      return 'routes is required and must be a non-empty array';
    }
    if (request.manifest.agent_id !== request.agent_id) {
      return 'manifest.agent_id must match request.agent_id';
    }
    if (!request.manifest.protocol || request.manifest.protocol !== 'adp/0.2') {
      return 'manifest.protocol must be adp/0.2';
    }
    
    // Validate agent_id format (basic check)
    if (!request.agent_id.startsWith('adp://')) {
      return 'agent_id must start with adp://';
    }
    
    return null;
  }

  start(): void {
    this.app.listen(this.config.port, this.config.host, () => {
      console.log(`Registry server started on ${this.config.host}:${this.config.port}`);
    });
  }

  async stop(): Promise<void> {
    if (this.heartbeatDrainTimer) {
      clearInterval(this.heartbeatDrainTimer);
      this.heartbeatDrainTimer = null;
    }
    if (this.rateLimitCleanupTimer) {
      clearInterval(this.rateLimitCleanupTimer);
      this.rateLimitCleanupTimer = null;
    }
    await this.drainHeartbeats();
    await this.cache.close().catch(() => {});
    await this.db.close();
  }
}

