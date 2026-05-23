import { createEchoHandler, createChatHandler } from '../../src/capabilities';
import { generateKeyPair, buildAgentId } from '../../src/index';
import { buildEnvelope } from '../../src/envelope';

describe('Capabilities', () => {
  let keys: ReturnType<typeof generateKeyPair>;
  let agentId: string;
  let fromId: string;

  beforeEach(() => {
    keys = generateKeyPair();
    agentId = buildAgentId(keys.publicKey, 'local', 'test');
    fromId = buildAgentId(generateKeyPair().publicKey, 'local', 'from');
  });

  test('createEchoHandler calls ws.send with echo reply', async () => {
    const handler = createEchoHandler(agentId, keys.secretKey);
    const ws = { send: jest.fn() };
    const envelope = buildEnvelope(fromId, agentId, 'custom:echo', { data: 'hello' });

    await handler(ws as any, envelope as any);

    expect(ws.send).toHaveBeenCalledTimes(1);
    const reply = JSON.parse(ws.send.mock.calls[0][0]);
    expect(reply.action).toBe('custom:echo');
    expect(reply.from).toBe(agentId);
    expect(reply.to).toBe(fromId);
  });

  test('createChatHandler calls onMessage and sends reply', async () => {
    const onMessage = jest.fn();
    const handler = createChatHandler(agentId, keys.secretKey, onMessage);
    const ws = { send: jest.fn() };
    const envelope = buildEnvelope(fromId, agentId, 'custom:chat', { text: 'hi there' });

    await handler(ws as any, envelope as any);

    expect(onMessage).toHaveBeenCalledWith(fromId, 'hi there');
    expect(ws.send).toHaveBeenCalledTimes(1);
    const reply = JSON.parse(ws.send.mock.calls[0][0]);
    expect(reply.action).toBe('custom:chat');
    expect(reply.params).toEqual({ ok: true });
  });

  test('createChatHandler handles empty text', async () => {
    const onMessage = jest.fn();
    const handler = createChatHandler(agentId, keys.secretKey, onMessage);
    const ws = { send: jest.fn() };
    const envelope = buildEnvelope(fromId, agentId, 'custom:chat', {});

    await handler(ws as any, envelope as any);

    expect(onMessage).toHaveBeenCalledWith(fromId, '');
    expect(ws.send).toHaveBeenCalledTimes(1);
  });
});
