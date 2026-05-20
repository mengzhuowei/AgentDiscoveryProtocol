import { generateKeyPair, sign, verify, encodeBase64URL, decodeBase64URL } from './crypto';

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
});
