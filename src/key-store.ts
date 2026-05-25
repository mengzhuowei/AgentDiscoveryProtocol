/**
 * Key store module for loading and persisting ADP agent identities
 * @module key-store
 */

import * as fs from 'fs';
import * as path from 'path';
import { generateKeyPair } from './crypto';
import { buildAgentId } from './agent-id';

/**
 * Directory path for storing key files
 * @default '.adp/keys' in current working directory
 */
const KEYS_DIR = process.env.ADP_KEY_DIR
  || path.join(process.cwd(), '.adp', 'keys');

/**
 * Represents an ADP agent identity with cryptographic key pair
 * @interface
 */
export interface Identity {
  /** Agent ID derived from public key with namespace and agent name */
  agentId: string;
  /** Ed25519 public key (32 bytes) */
  publicKey: Uint8Array;
  /** Ed25519 secret key (64 bytes, first 32 bytes are the actual secret) */
  secretKey: Uint8Array;
}

/**
 * Ensures a directory exists, creating it if necessary
 * @param dir - Directory path to ensure
 */
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Load existing identity or create a new one if not found
 * @param namespace - Application namespace (e.g., 'myapp')
 * @param agentName - Unique agent name within namespace
 * @param tag - Key file tag for identity persistence (default: 'default')
 * @returns Object containing identity and whether it was newly created
 * @example
 * ```typescript
 * const { identity, isNew } = loadOrCreateIdentity('myapp', 'video-agent', 'default');
 * if (isNew) {
 *   console.log('New identity created');
 * }
 * console.log(`Agent ID: ${identity.agentId}`);
 * ```
 */
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

/**
 * Load existing identity from key store
 * @param namespace - Application namespace (e.g., 'myapp')
 * @param agentName - Unique agent name within namespace
 * @param tag - Key file tag for identity persistence (default: 'default')
 * @returns Identity object if found, null otherwise
 * @example
 * ```typescript
 * const identity = loadIdentity('myapp', 'video-agent', 'default');
 * if (identity) {
 *   console.log(`Agent ID: ${identity.agentId}`);
 * } else {
 *   console.log('Identity not found');
 * }
 * ```
 */
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
