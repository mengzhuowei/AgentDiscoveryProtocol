import { encodeBase64URL, decodeBase64URL } from './crypto';

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
  const hash = blake2b(publicKey, 6);
  return encodeBase64URL(hash);
}

function blake2b(data: Uint8Array, outputBytes: number): Uint8Array {
  const result = new Uint8Array(outputBytes);
  const blockSize = 64;
  const key = new Uint8Array(0);
  
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  const sigma = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3,
    11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4,
    7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8,
    9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13,
    2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9,
    12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11,
    13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10,
    6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5,
    10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0,
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3,
  ];

  const dataLength = data.length;
  const blocks = Math.ceil((dataLength + key.length) / blockSize);
  
  for (let blockIdx = 0; blockIdx < blocks; blockIdx++) {
    const block = new Uint8Array(blockSize);
    const offset = blockIdx * blockSize;
    
    for (let i = 0; i < blockSize; i++) {
      const dataIdx = offset - key.length + i;
      if (dataIdx >= 0 && dataIdx < dataLength) {
        block[i] = data[dataIdx];
      } else if (dataIdx < 0 && i < key.length) {
        block[i] = key[i];
      } else {
        block[i] = 0;
      }
    }

    const m = new Uint32Array(16);
    for (let i = 0; i < 16; i++) {
      m[i] = (block[i * 4 + 3] << 24) | (block[i * 4 + 2] << 16) | (block[i * 4 + 1] << 8) | block[i * 4];
    }

    const v = new Uint32Array(16);
    for (let i = 0; i < 8; i++) {
      v[i] = h[i];
      v[i + 8] = 0xffffffff;
    }

    for (let round = 0; round < 12; round++) {
      const s = sigma.slice(round * 16, (round + 1) * 16);
      
      for (let i = 0; i < 16; i += 2) {
        const a = s[i];
        const b = s[i + 1];
        
        v[a] = v[a] + v[b] + m[a];
        v[b] = rot64(v[b] ^ v[a], 32);
        v[a] = rot64(v[a], 24);
        v[a] = v[a] + v[b];
        v[b] = rot64(v[b] ^ v[a], 16);
        v[a] = rot64(v[a], 63);
      }
    }

    for (let i = 0; i < 8; i++) {
      h[i] = h[i] ^ v[i] ^ v[i + 8];
    }
  }

  for (let i = 0; i < outputBytes; i++) {
    const idx = i >> 2;
    const shift = (i & 3) * 8;
    result[i] = (h[idx] >> shift) & 0xff;
  }

  return result;
}

function rot64(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}
