import { parseAgentId, buildAgentId, extractPublicKey } from '../../src/agent-id';
import { generateKeyPair, encodeBase64URL } from '../../src/crypto';

describe('Agent ID', () => {
  it('should parse valid agent ID', () => {
    const keypair = generateKeyPair();
    const pubkeyB64URL = encodeBase64URL(keypair.publicKey);
    const agentId = `adp://${pubkeyB64URL}@home.io/claude`;
    
    const parsed = parseAgentId(agentId);
    
    expect(parsed.publicKey).toEqual(keypair.publicKey);
    expect(parsed.namespace).toBe('home.io');
    expect(parsed.agentName).toBe('claude');
  });

  it('should build agent ID from parts', () => {
    const keypair = generateKeyPair();
    const namespace = 'example.com';
    const agentName = 'hermes';
    
    const agentId = buildAgentId(keypair.publicKey, namespace, agentName);
    
    expect(agentId).toMatch(/^adp:\/\/[A-Za-z0-9_-]{43}@example\.com\/hermes$/);
    
    const parsed = parseAgentId(agentId);
    expect(parsed.publicKey).toEqual(keypair.publicKey);
  });

  it('should extract public key from agent ID', () => {
    const keypair = generateKeyPair();
    const agentId = buildAgentId(keypair.publicKey, 'test.io', 'agent');
    
    const extracted = extractPublicKey(agentId);
    
    expect(extracted).toEqual(keypair.publicKey);
  });

  it('should reject invalid agent ID', () => {
    expect(() => parseAgentId('invalid')).toThrow();
    expect(() => parseAgentId('adp://short@home.io/agent')).toThrow();
    expect(() => parseAgentId('adp://mLq3x9Z1KfR7tNwP2bVsQ8cJ5hG4mF6aY0dL3kX1yZIB@invalid domain/agent')).toThrow();
  });
});
