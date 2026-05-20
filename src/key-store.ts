import * as fs from 'fs';
import * as path from 'path';
import { generateKeyPair } from './crypto';
import { buildAgentId } from './agent-id';

const KEYS_DIR = process.env.ADP_KEY_DIR
  || path.join(process.cwd(), '.adp', 'keys');

export interface Identity {
  agentId: string;
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadOrCreateIdentity(
  namespace: string,
  agentName: string,
  tag: string = 'default'
): { identity: Identity; isNew: boolean } {
  const keyFile = path.join(KEYS_DIR, `${tag}.key`);

  if (fs.existsSync(keyFile)) {
    const raw = fs.readFileSync(keyFile, 'utf-8').trim();
    const secretKey = Buffer.from(raw, 'base64url');
    const publicKey = secretKey.slice(32);
    const agentId = buildAgentId(publicKey, namespace, agentName);

    return {
      identity: { agentId, publicKey, secretKey },
      isNew: false,
    };
  }

  const keypair = generateKeyPair();
  const agentId = buildAgentId(keypair.publicKey, namespace, agentName);

  ensureDir(KEYS_DIR);
  fs.writeFileSync(keyFile, Buffer.from(keypair.secretKey).toString('base64url'), { mode: 0o600 });

  return {
    identity: { agentId, publicKey: keypair.publicKey, secretKey: keypair.secretKey },
    isNew: true,
  };
}

export function loadIdentity(
  namespace: string,
  agentName: string,
  tag: string = 'default'
): Identity | null {
  const keyFile = path.join(KEYS_DIR, `${tag}.key`);

  if (!fs.existsSync(keyFile)) {
    return null;
  }

  const raw = fs.readFileSync(keyFile, 'utf-8').trim();
  const secretKey = Buffer.from(raw, 'base64url');
  const publicKey = secretKey.slice(32);
  const agentId = buildAgentId(publicKey, namespace, agentName);

  return { agentId, publicKey, secretKey };
}
