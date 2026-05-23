import { Discovery } from '../../src/discovery';
import { generateKeyPair, buildAgentId } from '../../src/index';

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
    expect(mockMdns.on).toHaveBeenCalledTimes(2); // query and response handlers
  });

  test('discover peer from mDNS PTR response', () => {
    const onPeerDiscovered = jest.fn();
    const disc = new Discovery(agentId, 9000, { onPeerDiscovered }, mockMdns as any);
    disc.start();

    const anotherKeys = generateKeyPair();
    const anotherAgentId = buildAgentId(anotherKeys.publicKey, 'local', 'another');

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

    (disc as any).peers.set('adp://old@local/old', {
      agentId: 'adp://old@local/old',
      host: '192.168.1.1',
      port: 9000,
      protocol: 'adp/0.2',
      lastSeen: Date.now() - 200_000,
    });

    (disc as any).cleanStale();
    expect(disc.getPeers().length).toBe(0);
    disc.shutdown();
  });

  // --- new edge case tests ---

  test('handles mDNS response with no answers array gracefully', () => {
    const onPeerDiscovered = jest.fn();
    const disc = new Discovery(agentId, 9000, { onPeerDiscovered }, mockMdns as any);
    disc.start();

    // malformed response: no 'answers' field at all
    expect(() => {
      mockMdns._trigger('response', {
        // answers is missing completely
      });
    }).not.toThrow();

    expect(onPeerDiscovered).not.toHaveBeenCalled();
    disc.shutdown();
  });

  test('handles mDNS response with empty answers array', () => {
    const onPeerDiscovered = jest.fn();
    const disc = new Discovery(agentId, 9000, { onPeerDiscovered }, mockMdns as any);
    disc.start();

    expect(() => {
      mockMdns._trigger('response', {
        answers: [],
        additionals: [],
      });
    }).not.toThrow();

    expect(onPeerDiscovered).not.toHaveBeenCalled();
    disc.shutdown();
  });

  test('handles mDNS response with null answers', () => {
    const onPeerDiscovered = jest.fn();
    const disc = new Discovery(agentId, 9000, { onPeerDiscovered }, mockMdns as any);
    disc.start();

    expect(() => {
      mockMdns._trigger('response', {
        answers: null,
        additionals: null,
      });
    }).not.toThrow();

    expect(onPeerDiscovered).not.toHaveBeenCalled();
    disc.shutdown();
  });

  test('handles TXT record with no agent_id', () => {
    const onPeerDiscovered = jest.fn();
    const disc = new Discovery(agentId, 9000, { onPeerDiscovered }, mockMdns as any);
    disc.start();

    const txtData = Buffer.from('protocol=adp/0.2\x00other=value');

    mockMdns._trigger('response', {
      answers: [
        { name: '_adp._tcp.local', type: 'PTR', data: 'peer._adp._tcp.local' },
        { name: 'peer._adp._tcp.local', type: 'SRV', data: { port: 8080, target: 'peer.local' } },
        { name: 'peer._adp._tcp.local', type: 'TXT', data: txtData },
        { name: 'peer.local', type: 'A', data: '10.0.0.1' },
      ],
      additionals: [],
    });

    expect(onPeerDiscovered).not.toHaveBeenCalled();
    disc.shutdown();
  });

  test('handles TXT record as array of buffers', () => {
    const onPeerDiscovered = jest.fn();
    const disc = new Discovery(agentId, 9000, { onPeerDiscovered }, mockMdns as any);
    disc.start();

    const anotherKeys = generateKeyPair();
    const anotherAgentId = buildAgentId(anotherKeys.publicKey, 'local', 'array-txt');

    const part1 = Buffer.from(`agent_id=${anotherAgentId}\x00`);
    const part2 = Buffer.from('protocol=adp/0.2');

    mockMdns._trigger('response', {
      answers: [
        { name: '_adp._tcp.local', type: 'PTR', data: 'array_peer._adp._tcp.local' },
        { name: 'array_peer._adp._tcp.local', type: 'SRV', data: { port: 7777, target: 'array.local' } },
        { name: 'array_peer._adp._tcp.local', type: 'TXT', data: [part1, part2] },
        { name: 'array.local', type: 'A', data: '10.0.0.2' },
      ],
      additionals: [],
    });

    expect(onPeerDiscovered).toHaveBeenCalledTimes(1);
    const peer = onPeerDiscovered.mock.calls[0][0];
    expect(peer.agentId).toBe(anotherAgentId);
    expect(peer.port).toBe(7777);
    disc.shutdown();
  });

  test('ignores own PTR response (self-discovery prevention)', () => {
    const onPeerDiscovered = jest.fn();
    const disc = new Discovery(agentId, 9000, { onPeerDiscovered }, mockMdns as any);
    disc.start();

    // Simulate a response from our own instance name
    const ownInstanceName = (disc as any).instanceName;
    const txtData = Buffer.from(`agent_id=${agentId}\x00protocol=adp/0.2`);

    mockMdns._trigger('response', {
      answers: [
        { name: '_adp._tcp.local', type: 'PTR', data: ownInstanceName },
        { name: ownInstanceName, type: 'SRV', data: { port: 9000, target: 'self.local' } },
        { name: ownInstanceName, type: 'TXT', data: txtData },
        { name: 'self.local', type: 'A', data: '127.0.0.1' },
      ],
      additionals: [],
    });

    expect(onPeerDiscovered).not.toHaveBeenCalled();
    disc.shutdown();
  });

  test('handles additionals-only records in response', () => {
    const disc = new Discovery(agentId, 9000, {}, mockMdns as any);
    disc.start();

    expect(() => {
      mockMdns._trigger('response', {
        answers: [],
        additionals: [
          { name: 'extra.local', type: 'A', data: '10.0.0.99' },
        ],
      });
    }).not.toThrow();

    disc.shutdown();
  });

  test('handles PTR with missing SRV or TXT gracefully', () => {
    const onPeerDiscovered = jest.fn();
    const disc = new Discovery(agentId, 9000, { onPeerDiscovered }, mockMdns as any);
    disc.start();

    // PTR exists but SRV is missing — should not discover
    mockMdns._trigger('response', {
      answers: [
        { name: '_adp._tcp.local', type: 'PTR', data: 'orphan._adp._tcp.local' },
      ],
      additionals: [],
    });

    expect(onPeerDiscovered).not.toHaveBeenCalled();
    disc.shutdown();
  });

  test('onPeerLost callback fires on stale cleanup', () => {
    jest.useRealTimers();
    const onPeerLost = jest.fn();
    const disc = new Discovery(agentId, 9000, { onPeerLost }, mockMdns as any);

    (disc as any).peers.set('adp://stale@local/test', {
      agentId: 'adp://stale@local/test',
      host: '10.0.0.1',
      port: 9000,
      protocol: 'adp/0.2',
      lastSeen: Date.now() - 200_000,
    });

    (disc as any).cleanStale();

    expect(onPeerLost).toHaveBeenCalledWith('adp://stale@local/test');
    expect(disc.getPeers().length).toBe(0);
    disc.shutdown();
  });
});
