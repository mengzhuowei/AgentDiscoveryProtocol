import * as nacl from 'tweetnacl';

export interface KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export function generateKeyPair(): KeyPair {
  const keypair = nacl.sign.keyPair();
  return {
    publicKey: keypair.publicKey,
    secretKey: keypair.secretKey,
  };
}

export function generateKeyPairFromSeed(seed: Uint8Array): KeyPair {
  if (seed.length !== 32) {
    throw new Error('Seed must be 32 bytes');
  }
  const keypair = nacl.sign.keyPair.fromSeed(seed);
  return {
    publicKey: keypair.publicKey,
    secretKey: keypair.secretKey,
  };
}

export function sign(secretKey: Uint8Array, message: Uint8Array): Uint8Array {
  return nacl.sign.detached(message, secretKey);
}

export function verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  return nacl.sign.detached.verify(message, signature, publicKey);
}

export function signEnvelope(
  envelope: Record<string, unknown>,
  secretKey: Uint8Array,
  canonicalize: (obj: unknown) => string
): Record<string, unknown> {
  const { sig: _ignoredSig, ...unsigned } = envelope;
  const canonical = canonicalize(unsigned);
  const messageBytes = new TextEncoder().encode(canonical);
  const signatureBytes = sign(secretKey, messageBytes);
  const sig = encodeBase64URL(signatureBytes);
  return { ...unsigned, sig };
}

export function encodeBase64URL(data: Uint8Array): string {
  let result = '';
  for (let i = 0; i < data.length; i += 3) {
    const b1 = data[i];
    const b2 = i + 1 < data.length ? data[i + 1] : 0;
    const b3 = i + 2 < data.length ? data[i + 2] : 0;

    result += BASE64_URL_CHARS[b1 >> 2];
    result += BASE64_URL_CHARS[((b1 & 0x03) << 4) | (b2 >> 4)];
    if (i + 1 < data.length) {
      result += BASE64_URL_CHARS[((b2 & 0x0f) << 2) | (b3 >> 6)];
    }
    if (i + 2 < data.length) {
      result += BASE64_URL_CHARS[b3 & 0x3f];
    }
  }
  return result;
}

export function decodeBase64URL(data: string): Uint8Array {
  const padded = data.padEnd(data.length + (4 - data.length % 4) % 4, '=');
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  
  const binary = Buffer.from(base64, 'base64').toString('binary');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

const BASE64_URL_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
