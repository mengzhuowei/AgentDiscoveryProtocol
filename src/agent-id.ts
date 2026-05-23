import { encodeBase64URL, decodeBase64URL } from './crypto';
import { createHash } from 'crypto';

export interface ParsedAgentId {
  publicKey: Uint8Array;
  namespace: string;
  agentName: string;
}

export function parseAgentId(agentId: string): ParsedAgentId {
  const match = agentId.match(/^adp:\/\/([^@]+)@([^/]+)\/(.+)$/);
  if (!match) {
    throw new Error('Invalid Agent ID format');
  }

  const [, pubkeyB64URL, namespace, agentName] = match;

  if (pubkeyB64URL.length !== 43) {
    throw new Error('Invalid public key length: must be 43 characters');
  }

  const publicKey = decodeBase64URL(pubkeyB64URL);
  if (publicKey.length !== 32) {
    throw new Error('Invalid public key: must decode to 32 bytes');
  }

  if (!/^[a-z0-9.-]+$/.test(namespace)) {
    throw new Error('Invalid namespace: must be lowercase letters, digits, dots, and hyphens');
  }

  if (!/^[a-z0-9_-]{1,32}$/.test(agentName)) {
    throw new Error('Invalid agent name: must be lowercase letters, digits, underscores, and hyphens, max 32 characters');
  }

  return { publicKey, namespace, agentName };
}

export function buildAgentId(publicKey: Uint8Array, namespace: string, agentName: string): string {
  if (publicKey.length !== 32) {
    throw new Error('Public key must be 32 bytes');
  }
  const pubkeyB64URL = encodeBase64URL(publicKey);
  return `adp://${pubkeyB64URL}@${namespace}/${agentName}`;
}

export function extractPublicKey(agentId: string): Uint8Array {
  return parseAgentId(agentId).publicKey;
}

export function extractVisualCode(publicKey: Uint8Array): string {
  const hash = createHash('blake2b512').update(publicKey).digest().slice(0, 6);
  return encodeBase64URL(hash);
}
