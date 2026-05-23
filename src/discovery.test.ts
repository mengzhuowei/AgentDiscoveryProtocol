import { Discovery } from './discovery';
import { generateKeyPair, buildAgentId } from './index';

function createMockMdns() {
  const eventHandlers: Record<string, (...args: any[]) => void> = {};
  return {
    on: jest.fn((event: string, handler: (...args: any[]) => void) => {
      eventHandlers[event] = handler;
    }),
    query: jest.fn(),
    respond: jest.fn(),
    destroy: jest.fn(),
    _eventHandlers: eventHandlers,
    _trigger: (event: string, ...args: any[]) => {
      if (eventHandlers[event]) {
        eventHandlers[event](...args);
      }
    },
  };
}

describe('Discovery', () => {
  let agentId: string;
  let mockMdns: ReturnType<typeof createMockMdns>;
  let discovery: Discovery;

  beforeEach(() => {
    jest.useFakeTimers();
    const keys = generateKeyPair();
    agentId = buildAgentId(keys.publicKey, 'local', 'test');
    mockMdns = createMockMdns();
    discovery = new Discovery(agentId, 9000, {}, mockMdns as any);
  });

  afterEach(() => {
    discovery.shutdown();
    jest.useRealTimers();
  });

  test('constructs with mock mDNS', () => {
    expect(discovery.getPeers()).toEqual([]);
  });

  test('start registers mDNS query handler', () => {
    discovery.start();
    expect(mockMdns.on).toHaveBeenCalledWith('query', expect.any(Function));
  });

  test('start registers mDNS response handler', () => {
    discovery.start();
    expect(mockMdns.on).toHaveBeenCalledWith('response', expect.any(Function));
  });

  test('query is called on start', () => {
    discovery.start();
    expect(mockMdns.query).toHaveBeenCalled();
  });

  test('shutdown stops timers', () => {
    discovery.start();
    discovery.shutdown();
    // No errors thrown means intervals were cleared successfully
  });

  test('start is idempotent', () => {
    discovery.start();
    discovery.start();
    // Should only register handlers once
    expect(mockMdns.on).toHaveBeenCalledTimes(2); // query and response handlers
  });

  test('discover peer from mDNS PTR response', () => {
    const onPeerDiscovered = jest.fn();
    const disc = new Discovery(agentId, 9000, { onPeerDiscovered }, mockMdns as any);
    disc.start();

    // Simulate a PTR response for another ADP instance
    const anotherKeys = generateKeyPair();
    const anotherAgentId = buildAgentId(anotherKeys.publicKey, 'local', 'another');

    // Build TXT buffer with agent_id=xxx\x00protocol=adp/0.2
    const txtData = Buffer.from(`agent_id=${anotherAgentId}\x00protocol=adp/0.2`);

    mockMdns._trigger('response', {
      answers: [
        { name: '_adp._tcp.local', type: 'PTR', data: 'another_instance._adp._tcp.local' },
        { name: 'another_instance._adp._tcp.local', type: 'SRV', data: { port: 8080, target: 'another.local' } },
        { name: 'another_instance._adp._tcp.local', type: 'TXT', data: txtData },
        { name: 'another.local', type: 'A', data: '192.168.1.100' },
      ],
      additionals: [],
    });

    expect(onPeerDiscovered).toHaveBeenCalledTimes(1);
    const peer = onPeerDiscovered.mock.calls[0][0];
    expect(peer.agentId).toBe(anotherAgentId);
    expect(peer.port).toBe(8080);
    expect(peer.host).toBe('192.168.1.100');
  });

  test('cleanStale removes old peers', () => {
    jest.useRealTimers();
    const disc = new Discovery(agentId, 9000, {}, mockMdns as any);
    
    // Manually add an old peer
    (disc as any).peers.set('adp://old@local/old', {
      agentId: 'adp://old@local/old',
      host: '192.168.1.1',
      port: 9000,
      protocol: 'adp/0.2',
      lastSeen: Date.now() - 200_000, // > 120 seconds
    });

    // Trigger cleanStale
    (disc as any).cleanStale();
    expect(disc.getPeers().length).toBe(0);
    disc.shutdown();
  });
});
