import { createEchoHandler, createChatHandler } from '../../src/capabilities';
import { generateKeyPair, buildAgentId } from '../../src/index';

describe('Capabilities', () => {
  test('createEchoHandler returns function', () => {
    const keys = generateKeyPair();
    const agentId = buildAgentId(keys.publicKey, 'local', 'test');
    const handler = createEchoHandler(agentId, keys.secretKey);
    expect(typeof handler).toBe('function');
  });

  test('createChatHandler returns function', () => {
    const keys = generateKeyPair();
    const agentId = buildAgentId(keys.publicKey, 'local', 'test');
    const onMessage = jest.fn();
    const handler = createChatHandler(agentId, keys.secretKey, onMessage);
    expect(typeof handler).toBe('function');
  });
});
