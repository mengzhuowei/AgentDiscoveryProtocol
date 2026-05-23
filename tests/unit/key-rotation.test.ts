import { rotateKeys, buildRegistryUpdate, buildKeyRotateMessage } from '../../src/key-rotation';
import { generateKeyPair, buildAgentId } from '../../src/index';

describe('KeyRotation', () => {
  let oldKeys: ReturnType<typeof generateKeyPair>;
  let oldAgentId: string;

  beforeEach(() => {
    oldKeys = generateKeyPair();
    oldAgentId = buildAgentId(oldKeys.publicKey, 'local', 'test');
  });

  test('rotateKeys - 创建新密钥对', async () => {
    const result = rotateKeys({
      oldSecretKey: oldKeys.secretKey,
      oldAgentId,
      displayName: 'Test Agent',
      capabilities: ['adp:ping', 'adp:info'],
      routes: [],
    });

    expect(result.oldAgentId).toBe(oldAgentId);
    expect(result.newAgentId).not.toEqual(oldAgentId);
    expect(result.newSecretKey).not.toEqual(oldKeys.secretKey);
  });

  test('buildRegistryUpdate', async () => {
    const result = rotateKeys({
      oldSecretKey: oldKeys.secretKey,
      oldAgentId,
      displayName: 'Test Agent',
      capabilities: [],
      routes: [],
    });

    const update = buildRegistryUpdate(
      oldAgentId,
      result.newAgentId,
      result.newManifest,
      [],
      result.rotationEnvelope
    );

    expect(update.agent_id).toBe(result.newAgentId);
    expect(update.rotation).toEqual(result.rotationEnvelope);
  });

  test('buildKeyRotateMessage', () => {
    const newKeys = generateKeyPair();
    const newAgentId = buildAgentId(newKeys.publicKey, 'local', 'test');

    const msg = buildKeyRotateMessage(oldAgentId, newAgentId, newAgentId, oldKeys.secretKey);

    expect(msg.action).toBe('adp:key.rotate');
  });
});
