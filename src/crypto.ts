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
  return Buffer.from(data).toString('base64url');
}

export function decodeBase64URL(data: string): Uint8Array {
  // RFC 4648 §3.5: add padding so length is divisible by 4
  const paddingNeeded = (4 - data.length % 4) % 4;
  const padded = data.padEnd(data.length + paddingNeeded, '=');
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  return new Uint8Array(Buffer.from(base64, 'base64'));
}