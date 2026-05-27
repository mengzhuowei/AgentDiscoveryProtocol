import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { encodeBase64URL, decodeBase64URL } from './crypto';
import { getLogger } from './logger';

interface TrustRecord {
  public_key: string;
  first_seen: string;
  last_verified: string;
  origin: 'tofu' | 'pinned' | 'rotation';
  verified_by: string[];
  superseded_by: string | null;
}

interface TrustStoreData {
  [agentId: string]: TrustRecord;
}

export class TrustStore {
  private data: TrustStoreData = {};
  private filePath: string;
  private inMemory: boolean;

  constructor(filePath?: string) {
    this.inMemory = filePath === ':memory:';
    this.filePath = filePath || path.join(homedir(), '.adp', 'trust_store.json');
  }

  async load(): Promise<void> {
    if (this.inMemory) return;
    try {
      const content = await fs.promises.readFile(this.filePath, 'utf-8');
      this.data = JSON.parse(content);
    } catch {
      this.data = {};
    }
  }

  async save(): Promise<void> {
    if (this.inMemory) return;
    const dir = path.dirname(this.filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    const tmpFile = this.filePath + '.tmp.' + process.pid;
    try {
      await fs.promises.writeFile(tmpFile, JSON.stringify(this.data, null, 2));
      await fs.promises.rename(tmpFile, this.filePath);
    } catch (err) {
      // Clean up temp file if rename failed
      await fs.promises.unlink(tmpFile).catch(() => {});
      throw err;
    }
  }

  has(agentId: string): boolean {
    return agentId in this.data;
  }

  pin(agentId: string, publicKey: Uint8Array, origin: TrustRecord['origin'], verifiedBy: string[] = ['tofu_single']): boolean {
    const encodedKey = encodeBase64URL(publicKey);
    if (this.data[agentId]) {
      if (this.data[agentId].public_key !== encodedKey) {
        getLogger().error(
          `[ADP TrustStore] KEY MISMATCH: refusing to overwrite ${agentId} ` +
          `(existing ${this.data[agentId].origin} → requested ${origin}). ` +
          `Existing key: ${this.data[agentId].public_key.slice(0, 12)}..., ` +
          `New key: ${encodedKey.slice(0, 12)}...`
        );
        return false;
      }
      if (origin !== 'tofu') {
        this.data[agentId].origin = origin;
      }
    } else {
      this.data[agentId] = {
        public_key: encodedKey,
        first_seen: new Date().toISOString(),
        last_verified: new Date().toISOString(),
        origin,
        verified_by: verifiedBy,
        superseded_by: null,
      };
    }
    return true;
  }

  getPublicKey(agentId: string): Uint8Array | null {
    if (!(agentId in this.data)) {
      return null;
    }

    const visited = new Set<string>();
    let current = agentId;
    while (current in this.data) {
      if (visited.has(current)) {
        getLogger().warn('[ADP TrustStore] Rotation cycle detected for:', agentId);
        return null;
      }
      visited.add(current);
      const record = this.data[current];
      if (!record.superseded_by) {
        return decodeBase64URL(record.public_key);
      }
      current = record.superseded_by;
    }
    return null;
  }

  updateLastVerified(agentId: string): void {
    if (this.data[agentId]) {
      this.data[agentId].last_verified = new Date().toISOString();
    }
  }

  addRotation(oldAgentId: string, newAgentId: string, publicKey: Uint8Array): void {
    if (this.data[oldAgentId]) {
      this.data[oldAgentId].superseded_by = newAgentId;
    } else {
      // Create a forwarding record so getPublicKey(oldAgentId) follows the chain
      this.data[oldAgentId] = {
        public_key: this.data[newAgentId]?.public_key ?? encodeBase64URL(publicKey),
        first_seen: new Date().toISOString(),
        last_verified: new Date().toISOString(),
        origin: 'rotation',
        verified_by: ['rotation'],
        superseded_by: newAgentId,
      };
    }

    this.data[newAgentId] = {
      public_key: encodeBase64URL(publicKey),
      first_seen: new Date().toISOString(),
      last_verified: new Date().toISOString(),
      origin: 'rotation',
      verified_by: ['rotation'],
      superseded_by: null,
    };
  }

  hasConflict(agentId: string, publicKey: Uint8Array): boolean {
    const existing = this.getPublicKey(agentId);
    if (!existing) return false;
    return !Buffer.from(existing).equals(Buffer.from(publicKey));
  }

  getRecord(agentId: string): TrustRecord | undefined {
    return this.data[agentId];
  }
}
