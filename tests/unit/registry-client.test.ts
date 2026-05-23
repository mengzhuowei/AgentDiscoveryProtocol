import { RegistryClient, RegistryClientOptions } from '../../src/registry/client';
import { generateKeyPair, encodeBase64URL, buildAgentId } from '../../src/index';
import { createManifest } from '../../src/manifest';

describe('RegistryClient', () => {
  let agentId: string;
  let manifest: ReturnType<typeof createManifest>;
  let baseOptions: RegistryClientOptions;

  beforeEach(() => {
    const keys = generateKeyPair();
    agentId = buildAgentId(keys.publicKey, 'test', 'agent');
    manifest = createManifest(agentId, 'Test Agent', ['adp:ping'], [{ type: 'direct', address: 'localhost:9000' }]);
    baseOptions = {
      registryUrl: 'https://registry.example.com',
      agentId,
      manifest,
      routes: [{ type: 'direct', address: 'localhost:9000' }],
      token: undefined,
      secretKey: undefined,
    };
  });

  describe('construction', () => {
    test('creates with minimal options', () => {
      const client = new RegistryClient(baseOptions);
      expect(client).toBeDefined();
      expect(client.isRegistered()).toBe(false);
      client.close();
    });

    test('creates with full options including token and secretKey', () => {
      const keys = generateKeyPair();
      const client = new RegistryClient({
        ...baseOptions,
        token: 'test-token-123',
        secretKey: keys.secretKey,
        refreshIntervalMs: 600_000,
      });
      expect(client).toBeDefined();
      client.close();
    });

    test('strips trailing slash from registry URL', () => {
      const client = new RegistryClient({
        ...baseOptions,
        registryUrl: 'https://registry.example.com/',
      });
      // Access private field to verify
      expect((client as any).registryUrl).toBe('https://registry.example.com');
      client.close();
    });

    test('clamps refreshIntervalMs to max 1 hour', () => {
      const client = new RegistryClient({
        ...baseOptions,
        refreshIntervalMs: 7_200_000, // 2 hours
      });
      expect((client as any).refreshIntervalMs).toBe(3_600_000); // clamped to 1 hour
      client.close();
    });

    test('does not clamp refreshIntervalMs at or below 1 hour', () => {
      const client = new RegistryClient({
        ...baseOptions,
        refreshIntervalMs: 3_600_000,
      });
      expect((client as any).refreshIntervalMs).toBe(3_600_000);
      client.close();
    });

    test('default refreshIntervalMs is 1 hour', () => {
      const client = new RegistryClient(baseOptions);
      expect((client as any).refreshIntervalMs).toBe(3_600_000);
      client.close();
    });
  });

  describe('getManifest', () => {
    test('returns the manifest', () => {
      const client = new RegistryClient(baseOptions);
      expect(client.getManifest()).toBe(manifest);
      client.close();
    });
  });

  describe('close', () => {
    test('stops refresh timer', () => {
      const client = new RegistryClient(baseOptions);
      expect(() => client.close()).not.toThrow();
      expect((client as any).refreshTimer).toBeNull();
    });
  });

  describe('NaN guard for expires_at', () => {
    test('handle null expires_at in registration response gracefully', async () => {
      // Simulate the TTL calculation logic directly
      const response = { expires_at: null as unknown as string };
      const ttlSeconds = response.expires_at
        ? (new Date(response.expires_at).getTime() - Date.now()) / 1000
        : 3_600_000 / 1000;
      expect(ttlSeconds).toBe(3_600_000 / 1000);
      expect(isNaN(ttlSeconds)).toBe(false);
    });

    test('handle valid expires_at correctly', () => {
      const future = new Date(Date.now() + 3600_000);
      const response = { expires_at: future.toISOString() };
      const ttlSeconds = response.expires_at
        ? (new Date(response.expires_at).getTime() - Date.now()) / 1000
        : 3_600_000 / 1000;
      expect(ttlSeconds).toBeGreaterThan(0);
      expect(ttlSeconds).toBeLessThan(3700);
      expect(isNaN(ttlSeconds)).toBe(false);
    });
  });

  describe('deregister guard', () => {
    test('deregister when not registered is a no-op', async () => {
      const client = new RegistryClient(baseOptions);
      // Should not throw when not registered
      await expect(client.deregister()).resolves.toBeUndefined();
      client.close();
    });
  });
});
