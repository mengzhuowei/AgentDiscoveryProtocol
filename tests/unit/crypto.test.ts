import {
  generateKeyPair, generateKeyPairFromSeed,
  sign, verify, signEnvelope,
  encodeBase64URL, decodeBase64URL
} from '../../src/crypto';
import { canonicalize } from '../../src/canonical';

describe('Crypto', () => {
  it('should generate key pair', () => {
    const keypair = generateKeyPair();

    expect(keypair.publicKey.length).toBe(32);
    expect(keypair.secretKey.length).toBe(64);
  });

  it('should sign and verify', () => {
    const keypair = generateKeyPair();
    const message = new TextEncoder().encode('Hello, ADP!');

    const signature = sign(keypair.secretKey, message);

    expect(signature.length).toBe(64);

    const isValid = verify(keypair.publicKey, message, signature);
    expect(isValid).toBe(true);
  });

  it('should reject invalid signature', () => {
    const keypair = generateKeyPair();
    const message = new TextEncoder().encode('Hello, ADP!');
    const wrongMessage = new TextEncoder().encode('Hello, World!');

    const signature = sign(keypair.secretKey, message);

    const isValid = verify(keypair.publicKey, wrongMessage, signature);
    expect(isValid).toBe(false);
  });

  it('should encode and decode Base64URL', () => {
    const data = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]);
    const encoded = encodeBase64URL(data);
    const decoded = decodeBase64URL(encoded);

    expect(decoded).toEqual(data);
  });

  it('should handle Ed25519 public key encoding', () => {
    const keypair = generateKeyPair();
    const encoded = encodeBase64URL(keypair.publicKey);

    expect(encoded.length).toBe(43);

    const decoded = decodeBase64URL(encoded);
    expect(decoded).toEqual(keypair.publicKey);
  });

  // --- new tests for generateKeyPairFromSeed ---

  describe('generateKeyPairFromSeed', () => {
    it('should generate deterministic key pair from 32-byte seed', () => {
      const seed = new Uint8Array(32).fill(0x42);
      const kp1 = generateKeyPairFromSeed(seed);
      const kp2 = generateKeyPairFromSeed(seed);

      expect(kp1.publicKey).toEqual(kp2.publicKey);
      expect(kp1.secretKey).toEqual(kp2.secretKey);
    });

    it('should produce valid signing keys', () => {
      const seed = new Uint8Array(32).fill(0xAA);
      const kp = generateKeyPairFromSeed(seed);
      const message = new TextEncoder().encode('test message');
      const signature = sign(kp.secretKey, message);
      expect(verify(kp.publicKey, message, signature)).toBe(true);
    });

    it('should throw if seed is not 32 bytes', () => {
      expect(() => generateKeyPairFromSeed(new Uint8Array(16))).toThrow('Seed must be 32 bytes');
      expect(() => generateKeyPairFromSeed(new Uint8Array(64))).toThrow('Seed must be 32 bytes');
      expect(() => generateKeyPairFromSeed(new Uint8Array(0))).toThrow('Seed must be 32 bytes');
    });

    it('should produce different keys for different seeds', () => {
      const seed1 = new Uint8Array(32).fill(0x01);
      const seed2 = new Uint8Array(32).fill(0x02);
      const kp1 = generateKeyPairFromSeed(seed1);
      const kp2 = generateKeyPairFromSeed(seed2);

      expect(kp1.publicKey).not.toEqual(kp2.publicKey);
      expect(kp1.secretKey).not.toEqual(kp2.secretKey);
    });
  });

  // --- signEnvelope tests ---

  describe('signEnvelope', () => {
    it('should add sig field to envelope', () => {
      const kp = generateKeyPair();
      const envelope = { protocol: 'adp/0.2', id: 'msg_1', from: 'adp://a@b/c', to: 'adp://d@e/f', action: 'adp:ping', params: {}, timestamp: new Date().toISOString() };
      const signed = signEnvelope(envelope, kp.secretKey, canonicalize);

      expect(signed).toHaveProperty('sig');
      expect(typeof signed.sig).toBe('string');
      // Should not have modified original
      expect(envelope).not.toHaveProperty('sig');
    });

    it('should produce verifiable signatures', () => {
      const kp = generateKeyPair();
      const envelope = { protocol: 'adp/0.2', id: 'msg_2', from: 'adp://a@b/c', to: 'adp://d@e/f', action: 'adp:ping', params: {}, timestamp: new Date().toISOString() };
      const signed = signEnvelope(envelope, kp.secretKey, canonicalize);

      const sigBytes = decodeBase64URL(signed.sig as string);
      const { sig: _, ...unsigned } = signed;
      const canonical = canonicalize(unsigned);
      const messageBytes = new TextEncoder().encode(canonical);

      expect(verify(kp.publicKey, messageBytes, sigBytes)).toBe(true);
    });

    it('should strip any existing sig before signing', () => {
      const kp = generateKeyPair();
      const envelope = { protocol: 'adp/0.2', id: 'msg_3', from: 'adp://a@b/c', to: 'adp://d@e/f', action: 'adp:ping', params: {}, timestamp: new Date().toISOString(), sig: 'old_bogus_sig' };
      const signed = signEnvelope(envelope, kp.secretKey, canonicalize);

      expect(signed.sig).not.toBe('old_bogus_sig');
    });

    it('signatures differ for different payloads', () => {
      const kp = generateKeyPair();
      const ts = new Date().toISOString();
      const env1 = { protocol: 'adp/0.2', id: 'msg_a', from: 'adp://a@b/c', to: 'adp://d@e/f', action: 'adp:ping', params: { seq: 1 }, timestamp: ts };
      const env2 = { protocol: 'adp/0.2', id: 'msg_b', from: 'adp://a@b/c', to: 'adp://d@e/f', action: 'adp:ping', params: { seq: 2 }, timestamp: ts };

      const s1 = signEnvelope(env1, kp.secretKey, canonicalize);
      const s2 = signEnvelope(env2, kp.secretKey, canonicalize);

      expect(s1.sig).not.toBe(s2.sig);
    });
  });
});
