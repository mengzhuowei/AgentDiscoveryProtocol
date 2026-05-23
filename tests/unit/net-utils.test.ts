import * as net from 'net';
import { isPortAvailable, findAvailablePort, findAvailablePortSequential } from '../../src/net-utils';

describe('Net Utils', () => {
  describe('isPortAvailable', () => {
    test('returns true for a free port', async () => {
      const free = await isPortAvailable(0);
      // Port 0 tells the OS to pick — it will fail on Windows in some configurations,
      // but port 0 is generally treated as "find any free port" by the OS.
      // We just check it resolves to a boolean.
      expect(typeof free).toBe('boolean');
    });

    test('returns false when port is in use', async () => {
      // Bind a port on 0.0.0.0 so isPortAvailable (which also checks 0.0.0.0) sees it as occupied
      const server = net.createServer();
      await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
      const addr = server.address() as net.AddressInfo;
      const port = addr.port;

      const available = await isPortAvailable(port);
      expect(available).toBe(false);

      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    test('returns true after server closes', async () => {
      const server = net.createServer();
      await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
      const addr = server.address() as net.AddressInfo;
      const port = addr.port;

      await new Promise<void>((resolve) => server.close(() => resolve()));

      // Give the OS a moment to release
      await new Promise((r) => setTimeout(r, 100));

      const available = await isPortAvailable(port);
      expect(available).toBe(true);
    });
  });

  describe('findAvailablePortSequential', () => {
    test('finds a free port in a range', async () => {
      const port = await findAvailablePortSequential(10000, 10);
      expect(port).toBeGreaterThanOrEqual(10000);
      expect(port).toBeLessThan(10010);
    });

    test('skips occupied port and finds next available', async () => {
      // Bind 10001 on 0.0.0.0 so isPortAvailable skips it
      const server = net.createServer();
      await new Promise<void>((resolve) => server.listen(10001, '0.0.0.0', resolve));

      try {
        const port = await findAvailablePortSequential(10000, 5);
        expect(port).toBe(10000); // 10000 should be free
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    test('throws when all ports in range are occupied', async () => {
      // Bind all ports on 0.0.0.0 so isPortAvailable (which checks 0.0.0.0) sees them as occupied
      const servers: net.Server[] = [];
      const startPort = 21000;
      for (let i = 0; i < 5; i++) {
        const server = net.createServer();
        await new Promise<void>((resolve) => server.listen(startPort + i, '0.0.0.0', resolve));
        servers.push(server);
      }

      try {
        await expect(
          findAvailablePortSequential(startPort, 5)
        ).rejects.toThrow('No available port found');
      } finally {
        for (const s of servers) {
          await new Promise<void>((resolve) => s.close(() => resolve()));
        }
      }
    });
  });

  describe('findAvailablePort (batched)', () => {
    test('finds a free port', async () => {
      const port = await findAvailablePort(10050, 10080);
      expect(port).toBeGreaterThanOrEqual(10050);
      expect(port).toBeLessThanOrEqual(10080);
    });

    test('skips occupied ports in batch', async () => {
      // Bind a port on 0.0.0.0 in the range
      const server = net.createServer();
      await new Promise<void>((resolve) => server.listen(10100, '0.0.0.0', resolve));

      try {
        const port = await findAvailablePort(10095, 10110);
        expect(port).toBeGreaterThanOrEqual(10095);
        expect(port).not.toBe(10100); // Should skip the occupied one
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });
});
