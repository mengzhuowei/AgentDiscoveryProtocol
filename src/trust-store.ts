import * as fs from 'fs';
import * as path from 'path';
import { encodeBase64URL, decodeBase64URL } from './crypto';

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

  constructor(filePath?: string) {
    this.filePath = filePath || path.join(process.env.HOME || process.env.USERPROFILE || '.', '.adp', 'trust_store.json');
  }

  async load(): Promise<void> {
    try {
      const content = await fs.promises.readFile(this.filePath, 'utf-8');
      this.data = JSON.parse(content);
    } catch {
      this.data = {};
    }
  }

  async save(): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(this.filePath, JSON.stringify(this.data, null, 2));
  }

  has(agentId: string): boolean {
    return agentId in this.data;
  }

  pin(agentId: string, publicKey: Uint8Array, origin: TrustRecord['origin'], verifiedBy: string[] = ['tofu_single']): void {
    this.data[agentId] = {
      public_key: encodeBase64URL(publicKey),
      first_seen: new Date().toISOString(),
      last_verified: new Date().toISOString(),
      origin,
      verified_by: verifiedBy,
      superseded_by: null,
    };
  }

  getPublicKey(agentId: string): Uint8Array | null {
    if (!(agentId in this.data)) {
      return null;
    }

    const record = this.data[agentId];
    if (record.superseded_by) {
      return this.getPublicKey(record.superseded_by);
    }

    return decodeBase64URL(record.public_key);
  }

  updateLastVerified(agentId: string): void {
    if (this.data[agentId]) {
      this.data[agentId].last_verified = new Date().toISOString();
    }
  }

  addRotation(oldAgentId: string, newAgentId: string, publicKey: Uint8Array): void {
    if (this.data[oldAgentId]) {
      this.data[oldAgentId].superseded_by = newAgentId;
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
