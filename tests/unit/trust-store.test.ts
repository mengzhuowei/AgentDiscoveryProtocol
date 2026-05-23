import { TrustStore } from '../../src/trust-store';
import { generateKeyPair } from '../../src/index';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('TrustStore', () => {
  let tempDir: string;
  let tempFilePath: string;
  let trustStore: TrustStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adp-test'));
    tempFilePath = path.join(tempDir, 'trust_store.json');
    trustStore = new TrustStore(tempFilePath);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  test('pin a new agent', () => {
    const keys = generateKeyPair();
    const agentId = 'adp://test@local/test';

    trustStore.pin(agentId, keys.publicKey, 'tofu');

    expect(trustStore.has(agentId)).toBe(true);
    expect(trustStore.getPublicKey(agentId)).toEqual(keys.publicKey);
  });

  test('detect trust conflict', () => {
    const keys1 = generateKeyPair();
    const keys2 = generateKeyPair();
    const agentId = 'adp://test@local/test';

    trustStore.pin(agentId, keys1.publicKey, 'tofu');

    expect(trustStore.hasConflict(agentId, keys2.publicKey)).toBe(true);
    expect(trustStore.hasConflict(agentId, keys1.publicKey)).toBe(false);
  });

  test('add key rotation', () => {
    const oldKeys = generateKeyPair();
    const newKeys = generateKeyPair();
    const oldAgentId = 'adp://old@local/test';
    const newAgentId = 'adp://new@local/test';

    trustStore.pin(oldAgentId, oldKeys.publicKey, 'tofu');
    trustStore.addRotation(oldAgentId, newAgentId, newKeys.publicKey);

    expect(trustStore.getPublicKey(oldAgentId)).toEqual(newKeys.publicKey);
    expect(trustStore.getPublicKey(newAgentId)).toEqual(newKeys.publicKey);
  });

  test('updateLastVerified updates time', () => {
    const keys = generateKeyPair();
    const agentId = 'adp://test@local/test';

    trustStore.pin(agentId, keys.publicKey, 'tofu');
    trustStore.updateLastVerified(agentId);

    const record = trustStore.getRecord(agentId);
    expect(record?.last_verified).toBeDefined();
    const date = new Date(record!.last_verified);
    expect(date.getTime()).toBeLessThanOrEqual(Date.now());
  });

  test('save and load round-trip', async () => {
    const keys = generateKeyPair();
    const agentId = 'adp://test@local/test';

    trustStore.pin(agentId, keys.publicKey, 'tofu');
    await trustStore.save();

    const newStore = new TrustStore(tempFilePath);
    await newStore.load();

    expect(newStore.has(agentId)).toBe(true);
    expect(newStore.getPublicKey(agentId)).toEqual(keys.publicKey);
  });

  // --- new edge case tests ---

  test('in-memory mode does not touch filesystem', async () => {
    const memStore = new TrustStore(':memory:');
    const keys = generateKeyPair();

    memStore.pin('adp://mem@local/test', keys.publicKey, 'tofu');
    // Save should be a no-op
    await expect(memStore.save()).resolves.toBeUndefined();
    // Load should be a no-op
    await expect(memStore.load()).resolves.toBeUndefined();

    expect(memStore.has('adp://mem@local/test')).toBe(true);
  });

  test('refuse to overwrite pinned key with different key', () => {
    const keys1 = generateKeyPair();
    const keys2 = generateKeyPair();
    const agentId = 'adp://conflict@local/test';

    // First pin with keys1
    const firstPin = trustStore.pin(agentId, keys1.publicKey, 'pinned');
    expect(firstPin).toBe(true);

    // Try to re-pin same agent with different key
    const secondPin = trustStore.pin(agentId, keys2.publicKey, 'pinned');
    expect(secondPin).toBe(false);

    // Should still have keys1
    expect(trustStore.getPublicKey(agentId)).toEqual(keys1.publicKey);
  });

  test('re-pinning same key is idempotent', () => {
    const keys = generateKeyPair();
    const agentId = 'adp://same@local/test';

    expect(trustStore.pin(agentId, keys.publicKey, 'tofu')).toBe(true);
    expect(trustStore.pin(agentId, keys.publicKey, 'tofu')).toBe(true);
    expect(trustStore.has(agentId)).toBe(true);
  });

  test('upgrade origin from tofu to pinned on re-pin', () => {
    const keys = generateKeyPair();
    const agentId = 'adp://upgrade@local/test';

    trustStore.pin(agentId, keys.publicKey, 'tofu');
    expect(trustStore.getRecord(agentId)?.origin).toBe('tofu');

    // Re-pin same key with 'pinned' origin
    trustStore.pin(agentId, keys.publicKey, 'pinned');
    expect(trustStore.getRecord(agentId)?.origin).toBe('pinned');
  });

  test('rotation chain resolves through multiple rotations', () => {
    const k1 = generateKeyPair();
    const k2 = generateKeyPair();
    const k3 = generateKeyPair();

    trustStore.pin('adp://v1@local/test', k1.publicKey, 'tofu');
    trustStore.addRotation('adp://v1@local/test', 'adp://v2@local/test', k2.publicKey);
    trustStore.addRotation('adp://v2@local/test', 'adp://v3@local/test', k3.publicKey);

    // Following chain from v1 should resolve to k3
    expect(trustStore.getPublicKey('adp://v1@local/test')).toEqual(k3.publicKey);
    expect(trustStore.getPublicKey('adp://v2@local/test')).toEqual(k3.publicKey);
    expect(trustStore.getPublicKey('adp://v3@local/test')).toEqual(k3.publicKey);
  });

  test('rotation cycle detection via internal data manipulation', () => {
    const k1 = generateKeyPair();
    const k2 = generateKeyPair();

    // Create a cycle manually via internal data (defense-in-depth test)
    // addRotation always resets the new record's superseded_by to null,
    // so a real cycle cannot form through the public API. We test the
    // detection by manipulating the internal state directly.
    trustStore.pin('adp://cycle-a@local/test', k1.publicKey, 'tofu');
    trustStore.addRotation('adp://cycle-a@local/test', 'adp://cycle-b@local/test', k2.publicKey);

    // Manually create cycle: b → a
    const data = (trustStore as any).data;
    data['adp://cycle-b@local/test'].superseded_by = 'adp://cycle-a@local/test';
    data['adp://cycle-a@local/test'].superseded_by = 'adp://cycle-b@local/test';

    // Should detect cycle and return null
    expect(trustStore.getPublicKey('adp://cycle-a@local/test')).toBeNull();
  });

  test('hasConflict returns false for unknown agent', () => {
    const keys = generateKeyPair();
    expect(trustStore.hasConflict('adp://unknown@local/test', keys.publicKey)).toBe(false);
  });

  test('getPublicKey returns null for unknown agent', () => {
    expect(trustStore.getPublicKey('adp://unknown@local/test')).toBeNull();
  });

  test('getRecord returns undefined for unknown agent', () => {
    expect(trustStore.getRecord('adp://unknown@local/test')).toBeUndefined();
  });

  test('updateLastVerified on unknown agent does not throw', () => {
    expect(() => trustStore.updateLastVerified('adp://unknown@local/test')).not.toThrow();
  });

  test('load with non-existent file creates empty store', async () => {
    const nonExistentPath = path.join(tempDir, 'does_not_exist', 'store.json');
    const store = new TrustStore(nonExistentPath);
    await store.load();
    expect(store.has('anything')).toBe(false);
  });

  test('save creates directory if needed', async () => {
    const deepPath = path.join(tempDir, 'deep', 'nested', 'store.json');
    const store = new TrustStore(deepPath);
    const keys = generateKeyPair();

    store.pin('adp://deep@local/test', keys.publicKey, 'tofu');
    await store.save();

    expect(fs.existsSync(deepPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(deepPath, 'utf-8'));
    expect(content).toHaveProperty('adp://deep@local/test');
  });

  test('save and load preserves rotation chains', async () => {
    const k1 = generateKeyPair();
    const k2 = generateKeyPair();

    trustStore.pin('adp://rot-a@local/test', k1.publicKey, 'tofu');
    trustStore.addRotation('adp://rot-a@local/test', 'adp://rot-b@local/test', k2.publicKey);
    await trustStore.save();

    const newStore = new TrustStore(tempFilePath);
    await newStore.load();

    expect(newStore.getPublicKey('adp://rot-a@local/test')).toEqual(k2.publicKey);
    expect(newStore.getRecord('adp://rot-a@local/test')?.superseded_by).toBe('adp://rot-b@local/test');
  });
});
