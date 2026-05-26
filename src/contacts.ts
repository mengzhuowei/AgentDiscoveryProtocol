import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { Route } from './manifest';
import { TrustStore } from './trust-store';
import { extractPublicKey } from './agent-id';
import { decodeBase64URL } from './crypto';

export interface ContactEntry {
  routes: Route[];
  trust?: 'pinned';
  public_key?: string;
}

export interface ContactsData {
  [agentId: string]: ContactEntry;
}

export class ContactStore {
  private data: ContactsData = {};
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath || path.join(homedir(), '.adp', 'contacts.json');
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
    const tmpFile = this.filePath + '.tmp.' + process.pid;
    try {
      await fs.promises.writeFile(tmpFile, JSON.stringify(this.data, null, 2));
      await fs.promises.rename(tmpFile, this.filePath);
    } catch (err) {
      await fs.promises.unlink(tmpFile).catch(() => {});
      throw err;
    }
  }

  getRoutes(agentId: string): Route[] | null {
    const entry = this.data[agentId];
    if (!entry) return null;
    return entry.routes;
  }

  isPinned(agentId: string): Uint8Array | null {
    const entry = this.data[agentId];
    if (!entry || entry.trust !== 'pinned' || !entry.public_key) return null;
    return decodeBase64URL(entry.public_key);
  }

  set(agentId: string, entry: ContactEntry): void {
    this.data[agentId] = entry;
  }

  remove(agentId: string): void {
    delete this.data[agentId];
  }

  has(agentId: string): boolean {
    return agentId in this.data;
  }

  getAll(): ContactsData {
    return { ...this.data };
  }

  listAgentIds(): string[] {
    return Object.keys(this.data);
  }

  pinTrustedKeys(trustStore: TrustStore): { pinned: string[]; conflicts: string[] } {
    const pinned: string[] = [];
    const conflicts: string[] = [];

    for (const [agentId, entry] of Object.entries(this.data)) {
      if (entry.trust !== 'pinned' || !entry.public_key) continue;

      const publicKey = decodeBase64URL(entry.public_key);

      try {
        const agentPublicKey = extractPublicKey(agentId);
        if (!Buffer.from(publicKey).equals(Buffer.from(agentPublicKey))) {
          conflicts.push(agentId);
          continue;
        }
      } catch {
        conflicts.push(agentId);
        continue;
      }

      const pinOk = trustStore.pin(agentId, publicKey, 'pinned', ['static']);
      if (pinOk) {
        pinned.push(agentId);
      } else {
        conflicts.push(agentId);
      }
    }

    return { pinned, conflicts };
  }
}
