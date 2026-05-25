import { encodeBase64URL, decodeBase64URL } from './crypto';
import { createHash } from 'crypto';

/**
 * Functions for parsing, building, and extracting components from ADP Agent IDs
 * @module agent-id
 */

/**
 * Interface representing parsed components of an ADP Agent ID
 */
export interface ParsedAgentId {
  /** Ed25519 public key (32 bytes) */
  publicKey: Uint8Array;
  /** Agent namespace (e.g., 'myapp') */
  namespace: string;
  /** Agent name (e.g., 'video-agent') */
  agentName: string;
}

/**
 * Parse an Agent ID string into its components
 *
 * Parses an ADP-formatted Agent ID and validates each component.
 * The Agent ID format is: `adp://{pubkey}@{namespace}/{name}`
 *
 * @param agentId - Agent ID string in format adp://{pubkey}@{namespace}/{name}
 * @returns Parsed agent ID containing publicKey, namespace, and agentName
 * @throws Error if the Agent ID format is invalid
 * @throws Error if the public key is not 43 characters (invalid Base64URL encoding)
 * @throws Error if the public key does not decode to 32 bytes
 * @throws Error if the namespace contains invalid characters (must be lowercase letters, digits, dots, and hyphens)
 * @throws Error if the agent name contains invalid characters (must be lowercase letters, digits, underscores, and hyphens, max 32 characters)
 * @example
 * ```typescript
 * const parsed = parseAgentId('adp://abc123@myapp/video-agent');
 * console.log(parsed.namespace);  // 'myapp'
 * console.log(parsed.agentName);  // 'video-agent'
 * console.log(parsed.publicKey);   // Uint8Array(32)
 * ```
 */
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

/**
 * Build an Agent ID string from its components
 *
 * Constructs a valid ADP Agent ID string by encoding the public key
 * as Base64URL and combining it with the namespace and agent name.
 *
 * @param publicKey - Ed25519 public key (must be exactly 32 bytes)
 * @param namespace - Agent namespace (e.g., 'myapp')
 * @param agentName - Agent name (e.g., 'video-agent')
 * @returns Agent ID string in format adp://{pubkey}@{namespace}/{name}
 * @throws Error if the public key is not exactly 32 bytes
 * @example
 * ```typescript
 * const publicKey = new Uint8Array(32); // 32-byte Ed25519 public key
 * const agentId = buildAgentId(publicKey, 'myapp', 'video-agent');
 * console.log(agentId);  // 'adp://{pubkey}@myapp/video-agent'
 * ```
 */
export function buildAgentId(publicKey: Uint8Array, namespace: string, agentName: string): string {
  if (publicKey.length !== 32) {
    throw new Error('Public key must be 32 bytes');
  }
  const pubkeyB64URL = encodeBase64URL(publicKey);
  return `adp://${pubkeyB64URL}@${namespace}/${agentName}`;
}

/**
 * Extract the public key from an Agent ID string
 *
 * Parses the Agent ID and returns the embedded Ed25519 public key.
 *
 * @param agentId - Agent ID string in format adp://{pubkey}@{namespace}/{name}
 * @returns The Ed25519 public key (32 bytes)
 * @throws Error if the Agent ID format is invalid or contains invalid components
 * @example
 * ```typescript
 * const agentId = 'adp://abc123@myapp/video-agent';
 * const publicKey = extractPublicKey(agentId);
 * console.log(publicKey.length);  // 32
 * ```
 */
export function extractPublicKey(agentId: string): Uint8Array {
  return parseAgentId(agentId).publicKey;
}

/**
 * Extract a visual code from a public key
 *
 * Generates a short visual identifier by hashing the public key with BLAKE2b-512
 * and encoding the first 6 bytes as Base64URL. This creates a memorable,
 * human-readable 8-character code for quick identification.
 *
 * @param publicKey - Ed25519 public key (32 bytes)
 * @returns Visual code string (8 characters, Base64URL encoded)
 * @example
 * ```typescript
 * const publicKey = new Uint8Array(32);
 * const visualCode = extractVisualCode(publicKey);
 * console.log(visualCode);  // e.g., 'a1b2c3d4'
 * ```
 */
export function extractVisualCode(publicKey: Uint8Array): string {
  const hash = createHash('blake2b512').update(publicKey).digest().slice(0, 6);
  return encodeBase64URL(hash);
}
