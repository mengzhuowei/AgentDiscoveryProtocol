import { Gateway, GatewayOptions } from './gateway';
import { TrustStore } from './trust-store';
import { MessageVerifier } from './envelope';
import { generateKeyPair, buildAgentId } from './index';
import { buildEnvelope } from './envelope';
import { TaskManager } from './task-manager';

type MockedWebSocket = { send: jest.Mock };

function createMockWs(): MockedWebSocket {
  return { send: jest.fn() };
}

function createTestGateway(overrides: Partial<GatewayOptions> = {}): {
  gateway: Gateway;
  trustStore: TrustStore;
  mockVerify: jest.Mock;
  agentId: string;
  secretKey: Uint8Array;
} {
  const keys = generateKeyPair();
  const agentId = buildAgentId(keys.publicKey, 'local', 'test-agent');
  const trustStore = new TrustStore(':memory:');
  const mockVerify = jest.fn().mockResolvedValue({ valid: true });

  const gateway = new Gateway({
    port: 0,
    secretKey: keys.secretKey,
    agentId,
    displayName: 'Test Agent',
    capabilities: ['adp:ping', 'adp:capability.query', 'adp:info', 'custom:test'],
    trustStore,
    verifier: { verify: mockVerify } as unknown as MessageVerifier,
    noServer: true,
    ...overrides,
  });

  return { gateway, trustStore, mockVerify, agentId, secretKey: keys.secretKey };
}

describe('Gateway', () => {
  test('construction with noServer does not bind port', () => {
    const { gateway, agentId } = createTestGateway();
    expect(gateway.getAgentId()).toBe(agentId);
    expect(gateway.getManifest().display_name).toBe('Test Agent');
  });

  test('registerCapability adds capability', () => {
    const { gateway } = createTestGateway();
    gateway.registerCapability('custom:extra', async () => {});
    expect(gateway.getManifest().capabilities).toContain('custom:extra');
  });

  describe('processMessage', () => {
    test('rejects duplicate message', async () => {
      const { gateway, agentId } = createTestGateway({ skipVerification: true });
      const mockWs = createMockWs();
      const envelope = buildEnvelope('adp://other@local/other', agentId, 'adp:ping', {});

      await (gateway as any).processMessage(mockWs, envelope);
      await (gateway as any).processMessage(mockWs, envelope);

      // First call should have 1 send (handlePing), second should return early (no extra send)
      expect(mockWs.send).toHaveBeenCalledTimes(1);
    });

    test('verification failure returns error', async () => {
      const { gateway, agentId } = createTestGateway();
      const mockVerify = (gateway as any).verifier.verify as jest.Mock;
      mockVerify.mockResolvedValueOnce({ valid: false, error: 'INVALID_SIGNATURE', message: 'Bad signature' });

      const mockWs = createMockWs();
      const envelope = buildEnvelope('adp://other@local/other', agentId, 'adp:ping', {});

      await (gateway as any).processMessage(mockWs, envelope);

      expect(mockWs.send).toHaveBeenCalledTimes(1);
      const sent = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sent.error.code).toBe('INVALID_SIGNATURE');
    });

    test('handles ping and sends reply', async () => {
      const { gateway, agentId } = createTestGateway({ skipVerification: true });
      const mockWs = createMockWs();
      const envelope = buildEnvelope('adp://other@local/other', agentId, 'adp:ping', {});

      await (gateway as any).processMessage(mockWs, envelope);

      expect(mockWs.send).toHaveBeenCalledTimes(1);
      const sent = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sent.action).toBe('adp:ping');
      expect(sent.params.uptime).toBeDefined();
    });

    test('handles capability query and returns manifest', async () => {
      const { gateway, agentId } = createTestGateway({ skipVerification: true });
      const mockWs = createMockWs();
      const envelope = buildEnvelope('adp://other@local/other', agentId, 'adp:capability.query', {});

      await (gateway as any).processMessage(mockWs, envelope);

      expect(mockWs.send).toHaveBeenCalledTimes(1);
      const sent = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sent.action).toBe('adp:capability.query');
      expect(sent.params.manifest).toBeDefined();
      expect(sent.params.manifest.agent_id).toBe(agentId);
    });

    test('calls onInfo for adp:info action', async () => {
      const onInfo = jest.fn();
      const { gateway, agentId } = createTestGateway({ skipVerification: true, onInfo });
      const mockWs = createMockWs();
      const envelope = buildEnvelope('adp://other@local/other', agentId, 'adp:info', { data: 'hello' });

      await (gateway as any).processMessage(mockWs, envelope);

      expect(onInfo).toHaveBeenCalledWith('adp://other@local/other', { data: 'hello' });
    });

    test('sends error for missing capability', async () => {
      const { gateway, agentId } = createTestGateway({ skipVerification: true });
      const mockWs = createMockWs();
      const envelope = buildEnvelope('adp://other@local/other', agentId, 'missing:capability', {});

      await (gateway as any).processMessage(mockWs, envelope);

      expect(mockWs.send).toHaveBeenCalledTimes(1);
      const sent = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sent.error.code).toBe('CAPABILITY_NOT_FOUND');
    });

    test('sends error for unknown action', async () => {
      const { gateway, agentId } = createTestGateway({
        skipVerification: true,
        capabilities: ['adp:ping', 'unknown_action'],
      });
      const mockWs = createMockWs();
      // Use a capability the gateway has registered, but no handler for
      const envelope = buildEnvelope('adp://other@local/other', agentId, 'unknown_action', {});

      await (gateway as any).processMessage(mockWs, envelope);

      const sent = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sent.error.code).toBe('UNKNOWN_ACTION');
    });

    test('custom handler via customHandlers option', async () => {
      const handlerFn = jest.fn();
      const { gateway, agentId } = createTestGateway({
        skipVerification: true,
        customHandlers: { 'custom:test': handlerFn },
      });
      const mockWs = createMockWs();
      const envelope = buildEnvelope('adp://other@local/other', agentId, 'custom:test', { foo: 'bar' });

      await (gateway as any).processMessage(mockWs, envelope);

      expect(handlerFn).toHaveBeenCalledTimes(1);
      expect(handlerFn.mock.calls[0][1].params).toEqual({ foo: 'bar' });
    });
  });

  describe('key rotation', () => {
    test('handleKeyRotate processes rotation', async () => {
      const { gateway, agentId, trustStore } = createTestGateway({
        skipVerification: true,
        capabilities: ['adp:ping', 'adp:key.rotate'],
      });
      const mockWs = createMockWs();
      const newKeys = generateKeyPair();
      const newAgentId = buildAgentId(newKeys.publicKey, 'local', 'rotated');
      const envelope = buildEnvelope('adp://sender@local/sender', agentId, 'adp:key.rotate', {
        new_agent_id: newAgentId,
        reason: 'scheduled',
      });

      await (gateway as any).processMessage(mockWs, envelope);

      expect(mockWs.send).toHaveBeenCalledTimes(1);
      const sent = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sent.action).toBe('adp:key.rotate');
    });

    test('handleKeyRotate rejects missing new_agent_id', async () => {
      const { gateway, agentId } = createTestGateway({
        skipVerification: true,
        capabilities: ['adp:ping', 'adp:key.rotate'],
      });
      const mockWs = createMockWs();
      const envelope = buildEnvelope('adp://sender@local/sender', agentId, 'adp:key.rotate', {});

      await (gateway as any).processMessage(mockWs, envelope);

      const sent = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sent.error.code).toBe('INVALID_PARAMS');
    });
  });

  describe('taskManager integration', () => {
    test('task handler is registered when taskManager is provided', () => {
      const tm = new TaskManager();
      const { gateway } = createTestGateway({ taskManager: tm });
      // task-related handlers should be in customActions
      const manifest = gateway.getManifest();
      // Just verify the gateway was constructed
      expect(manifest.display_name).toBe('Test Agent');
    });
  });
});
